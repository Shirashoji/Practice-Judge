// Gemini（Vertex AI / Gemini Developer API）
//
// 会話ログはAnthropicのMessages API形式（llm_turns.content_json）で保存しているので、
// 保存形式は変えずに、ここで Anthropic形式 ⇄ Gemini形式 の変換を閉じ込める。
// こうしておくと、途中でモデルを変えた会話でもログをそのまま再送でき、
// フロントの描画コードも1種類で済む。
//
// 対応表:
//   system                        → config.systemInstruction
//   {role:'assistant'}            → {role:'model'}
//   {type:'text'}                 → {text}
//   {type:'tool_use'}             → {functionCall:{name, args}}
//   {type:'tool_result'}          → {functionResponse:{name, response}}
//   tools[].input_schema          → functionDeclarations[].parametersJsonSchema

const config = require('../config.js');
const { makeStream } = require('./stream.js');

function loadSDK () {
    // @google/genaiもgoogle-auth-library系を引き込む。Geminiを使うときだけ読み込み、
    // Anthropic直API運用なら未インストールでも起動できるようにする。
    try {
        return require('@google/genai');
    }
    catch (e) {
        throw new Error('Geminiを使うには @google/genai のインストールが必要です（npm i @google/genai）。');
    }
}

function createRawClient (provider) {
    const { GoogleGenAI } = loadSDK();

    if (provider === 'vertex-gemini') {
        // 鍵の検証を先にする。プロジェクトIDは鍵から取ることもあるので、
        // 鍵が壊れている場合に「VERTEX_PROJECT_IDが未設定」とだけ言われても原因に辿り着けない。
        config.assertVertexCredentials();

        if (config.VERTEX_PROJECT_ID === '') {
            throw new Error('VERTEX_PROJECT_ID が設定されていません。');
        }
        return new GoogleGenAI({
            vertexai: true,
            project: config.VERTEX_PROJECT_ID,
            location: config.VERTEX_REGION,
            // サービスアカウント鍵が設定されていればそれを使う。
            // undefinedならSDKの既定であるADC（gcloud auth application-default login /
            // メタデータサーバ）にそのまま任せる。
            googleAuthOptions: config.vertexAuthOptions(),
        });
    }

    if (config.GEMINI_API_KEY === '') {
        throw new Error('GEMINI_API_KEY が設定されていません。');
    }
    return new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
}

// ------------------------------------------------------------
// Anthropic形式 → Gemini形式
// ------------------------------------------------------------

// functionResponse.response はオブジェクトでなければならない。
// ツールの結果はJSON文字列で保存しているので、戻してから渡す。
function toResponseObject (content) {
    let value = content;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch (e) {
            return { result: content };
        }
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return { result: value };
    }
    return value;
}

function toContents (messages) {
    // tool_resultにはツール名が入っていないので、直前のtool_useから引く。
    const nameByToolUseId = new Map();
    const contents = [];

    for (const message of messages) {
        const parts = [];

        for (const block of message.content) {
            if (block.type === 'text') {
                if (block.text !== '') {
                    parts.push({ text: block.text });
                }
            }
            else if (block.type === 'tool_use') {
                nameByToolUseId.set(block.id, block.name);
                // idは送らない。Geminiの並列function callingは
                // functionResponseを同じ順序で返すことで対応付ける仕様なので、
                // こちらで採番したidを渡すと余計な情報になる。
                parts.push({ functionCall: { name: block.name, args: block.input ?? {} } });
            }
            else if (block.type === 'tool_result') {
                parts.push({
                    functionResponse: {
                        name: nameByToolUseId.get(block.tool_use_id) ?? 'unknown_tool',
                        response: toResponseObject(block.content),
                    },
                });
            }
            // thinkingなど他プロバイダ固有のブロックは送らない
        }

        if (parts.length === 0) {
            continue;
        }
        contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }

    return contents;
}

function toTools (tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return undefined;
    }
    return [{
        functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            // JSON Schemaをそのまま渡せる。Type列挙への詰め替えは不要。
            parametersJsonSchema: t.input_schema,
        })),
    }];
}

// ------------------------------------------------------------
// Gemini形式 → Anthropic形式
// ------------------------------------------------------------

function toUsage (usageMetadata) {
    const cacheRead = usageMetadata?.cachedContentTokenCount ?? 0;
    const prompt = usageMetadata?.promptTokenCount ?? 0;

    return {
        // GeminiのpromptTokenCountはキャッシュ分を含むが、
        // Anthropicのinput_tokensは含まない。cost.jsはAnthropicの定義で計算するので、
        // ここで引いてから渡す（引かないとキャッシュ分を二重に計上する）。
        input_tokens: Math.max(0, prompt - cacheRead),
        // 思考トークンも課金対象なので出力に含める。
        output_tokens: (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0),
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: 0,
    };
}

async function runStream (raw, params, emitText, emitReasoning) {
    const stream = await raw.models.generateContentStream({
        model: params.model,
        contents: toContents(params.messages),
        config: {
            systemInstruction: params.system,
            maxOutputTokens: params.max_tokens,
            tools: toTools(params.tools),
        },
    });

    const content = [];
    let textBuffer = '';
    let finishReason = null;
    let usageMetadata = null;
    let callSeq = 0;

    const flushText = () => {
        if (textBuffer !== '') {
            content.push({ type: 'text', text: textBuffer });
            textBuffer = '';
        }
    };

    for await (const chunk of stream) {
        // usageMetadataは最終チャンクに載る。SDKは集約しないので都度上書きする。
        if (chunk.usageMetadata != null) {
            usageMetadata = chunk.usageMetadata;
        }

        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason != null) {
            finishReason = candidate.finishReason;
        }

        for (const part of candidate?.content?.parts ?? []) {
            // 思考の要約は保存も表示もしない（答えの断片が漏れる経路を増やさない）
            if (part.thought === true) {
                if (typeof part.text === 'string' && part.text !== '') {
                    emitReasoning({ deltaChars: part.text.length });
                }
                continue;
            }

            if (typeof part.text === 'string' && part.text !== '') {
                textBuffer += part.text;
                emitText(part.text);
            }
            else if (part.functionCall != null) {
                flushText();
                content.push({
                    type: 'tool_use',
                    // Geminiはidを返さないことがあるので必ずこちらで採番する。
                    // このidはツール結果の突き合わせとログ表示に使うだけで、送り返さない。
                    id: part.functionCall.id ?? `gemini_${Date.now().toString(36)}_${callSeq++}`,
                    name: part.functionCall.name,
                    input: part.functionCall.args ?? {},
                });
            }
        }
    }
    flushText();

    const hasToolUse = content.some((b) => b.type === 'tool_use');

    return {
        content,
        // Anthropicのstop_reasonに寄せる。llm.jsはtool_useかどうかだけを見る。
        stop_reason: hasToolUse ? 'tool_use' : (finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn'),
        model: params.model,
        usage: toUsage(usageMetadata),
    };
}

function create (provider) {
    const raw = createRawClient(provider);

    return {
        messages: {
            stream (params) {
                return makeStream((emitText, emitReasoning) => runStream(raw, params, emitText, emitReasoning));
            },
        },
    };
}

module.exports = { create };
