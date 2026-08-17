// OpenAI と OpenAI互換サーバ（LM Studio / Ollama / llama.cpp のserver など）
//
// 本家OpenAIとローカルサーバを同じアダプタで扱う。差分はエンドポイント・認証・
// パラメータ名だけで、メッセージとツールの形は同一だから。
//
// SDKを足さずfetchで直接叩く。OpenAI互換の /chat/completions は形が安定していて、
// 使うのはstreamとtoolsだけなので、依存を1つ増やすほどの複雑さが無い。
//
// 会話ログはAnthropic形式で保存しているので、ここで相互変換する。
//   system              → {role:'system'}
//   {type:'text'}       → content
//   {type:'tool_use'}   → assistant.tool_calls[]
//   {type:'tool_result'}→ {role:'tool', tool_call_id}
//   tools[].input_schema→ tools[].function.parameters

const config = require('../config.js');
const { makeStream } = require('./stream.js');

// ------------------------------------------------------------
// Anthropic形式 → OpenAI形式
// ------------------------------------------------------------

function toMessages (system, messages) {
    const out = [];
    if (typeof system === 'string' && system !== '') {
        out.push({ role: 'system', content: system });
    }

    for (const message of messages) {
        if (message.role === 'assistant') {
            const texts = [];
            const toolCalls = [];

            for (const block of message.content) {
                if (block.type === 'text') {
                    texts.push(block.text);
                }
                else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        type: 'function',
                        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
                    });
                }
                // thinkingなど他プロバイダ固有のブロックは送らない
            }

            const msg = { role: 'assistant', content: texts.join('\n') };
            if (toolCalls.length > 0) {
                msg.tool_calls = toolCalls;
            }
            out.push(msg);
            continue;
        }

        // user側。1つのターンに複数のtool_resultが入りうるが、
        // OpenAI形式では1メッセージ1結果なので分解する。
        // tool系メッセージは対応するassistantの直後に並ぶ必要があり、
        // このループの順序はそれを満たす（tool_resultだけのターンにtextは混ざらない）。
        const texts = [];
        for (const block of message.content) {
            if (block.type === 'text') {
                texts.push(block.text);
            }
            else if (block.type === 'tool_result') {
                out.push({
                    role: 'tool',
                    tool_call_id: block.tool_use_id,
                    content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                });
            }
        }
        if (texts.length > 0) {
            out.push({ role: 'user', content: texts.join('\n') });
        }
    }

    return out;
}

function toTools (tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return undefined;
    }
    return tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
}

// ------------------------------------------------------------
// ストリームの受信
// ------------------------------------------------------------

// SSEの行を1つずつ吐く。1チャンクが行の途中で切れるのでバッファに貯めて区切る。
async function* iterateSSE (body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });

        for (;;) {
            const idx = buffer.indexOf('\n');
            if (idx === -1) {
                break;
            }
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);

            if (line === '' || !line.startsWith('data:')) {
                continue;
            }
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
                return;
            }
            try {
                yield JSON.parse(data);
            }
            catch (e) {
                console.error('ローカルLLMのSSEチャンクの解析に失敗しました:', line, e);
            }
        }
    }
}

async function runStream (opts, params, emitText, emitReasoning) {
    const body = {
        model: params.model,
        messages: toMessages(params.system, params.messages),
        stream: true,
        // これを付けないと最終チャンクにusageが載らない実装が多い。
        // ローカルは単価0なので金額には効かないが、使用量の記録は残したい。
        stream_options: { include_usage: true },
    };

    // GPT-5世代のChat Completionsは max_tokens を受け付けず
    // max_completion_tokens を要求する。ローカルサーバ側は逆に
    // max_completion_tokens を知らない実装があるので、経路ごとに使い分ける。
    body[opts.maxTokensField] = params.max_tokens;

    // reasoning_effortに対応しているモデルにだけ送る。
    // ローカルモデルは登録簿でeffort: falseなので送られない。
    if (config.getCapabilities(params.model).effort && params.effort != null) {
        body.reasoning_effort = params.effort;
    }

    const tools = toTools(params.tools);
    if (tools != null) {
        body.tools = tools;
    }

    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok || res.body == null) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${opts.label}(${opts.baseUrl})が${res.status}を返しました: ${detail.slice(0, 500)}`);
    }

    let text = '';
    let finishReason = null;
    let usage = null;
    let pendingContent = '';
    let insideThink = false;
    // tool_callsはindexごとに分割して届くので、indexをキーに組み立てる。
    const toolCalls = new Map();

    // 一部のローカルモデルは思考をcontent内の<think>タグで返す。
    // タグがチャンク途中で分断されても、生の内容を本文へ漏らさないよう少量を保留する。
    const processContent = (deltaText, flush = false) => {
        pendingContent += deltaText;
        const marker = insideThink ? '</think>' : '<think>';
        for (;;) {
            const index = pendingContent.indexOf(marker);
            if (index !== -1) {
                const before = pendingContent.slice(0, index);
                if (before !== '') {
                    if (insideThink) {
                        emitReasoning({ deltaChars: before.length });
                    }
                    else {
                        text += before;
                        emitText(before);
                    }
                }
                pendingContent = pendingContent.slice(index + marker.length);
                insideThink = !insideThink;
                return processContent('', flush);
            }

            const keep = flush ? 0 : marker.length - 1;
            if (pendingContent.length <= keep) {
                return;
            }
            const ready = pendingContent.slice(0, pendingContent.length - keep);
            pendingContent = pendingContent.slice(pendingContent.length - keep);
            if (insideThink) {
                emitReasoning({ deltaChars: ready.length });
            }
            else {
                text += ready;
                emitText(ready);
            }
            return;
        }
    };

    for await (const chunk of iterateSSE(res.body)) {
        if (chunk.usage != null) {
            usage = chunk.usage;
        }

        const choice = chunk.choices?.[0];
        if (choice == null) {
            continue;
        }
        if (choice.finish_reason != null) {
            finishReason = choice.finish_reason;
        }

        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content !== '') {
            processContent(delta.content);
        }
        // 生の思考は保存も表示もしない。実際に届いた量だけを通知する。
        const rawReasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof rawReasoning === 'string' && rawReasoning !== '') {
            emitReasoning({ deltaChars: rawReasoning.length });
        }
        // 明示的な要約フィールドだけは、一時的な要約表示に利用できる。
        if (typeof delta.reasoning_summary === 'string' && delta.reasoning_summary !== '') {
            emitReasoning({ deltaChars: 0, summaryDelta: delta.reasoning_summary });
        }

        for (const tc of delta.tool_calls ?? []) {
            const index = tc.index ?? 0;
            if (!toolCalls.has(index)) {
                toolCalls.set(index, { id: null, name: '', args: '' });
            }
            const acc = toolCalls.get(index);
            if (tc.id != null) {
                acc.id = tc.id;
            }
            if (tc.function?.name != null) {
                acc.name += tc.function.name;
            }
            if (tc.function?.arguments != null) {
                acc.args += tc.function.arguments;
            }
        }
    }
    processContent('', true);

    const content = [];
    if (text !== '') {
        content.push({ type: 'text', text });
    }
    for (const [index, acc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        let input = {};
        try {
            input = acc.args === '' ? {} : JSON.parse(acc.args);
        }
        catch (e) {
            // 引数が壊れていてもターンを落とさない。空引数で実行させれば
            // ツール側が検証エラーを返し、モデルが次のターンで直せる。
            console.error(`${opts.label}のツール引数を解析できませんでした（${acc.name}）:`, acc.args);
        }
        content.push({
            type: 'tool_use',
            id: acc.id ?? `local_${Date.now().toString(36)}_${index}`,
            name: acc.name,
            input,
        });
    }

    const hasToolUse = content.some((b) => b.type === 'tool_use');

    return {
        content,
        // Anthropicのstop_reasonに寄せる。llm.jsはtool_useかどうかだけを見る。
        stop_reason: hasToolUse ? 'tool_use' : (finishReason === 'length' ? 'max_tokens' : 'end_turn'),
        model: params.model,
        usage: {
            // prompt_tokensはキャッシュ分を含むので、Anthropicの定義に合わせて引く。
            input_tokens: Math.max(0, (usage?.prompt_tokens ?? 0) - (usage?.prompt_tokens_details?.cached_tokens ?? 0)),
            output_tokens: usage?.completion_tokens ?? 0,
            cache_read_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
            cache_creation_input_tokens: 0,
        },
    };
}

function createOptions (provider) {
    if (provider === 'openai') {
        if (config.OPENAI_API_KEY === '') {
            throw new Error('OPENAI_API_KEY が設定されていません。');
        }
        return {
            label: 'OpenAI',
            baseUrl: config.OPENAI_BASE_URL,
            apiKey: config.OPENAI_API_KEY,
            maxTokensField: 'max_completion_tokens',
        };
    }

    if (config.LOCAL_BASE_URL === '') {
        throw new Error('LOCAL_LLM_BASE_URL が設定されていません。');
    }
    return {
        label: 'ローカルLLM',
        baseUrl: config.LOCAL_BASE_URL,
        apiKey: config.LOCAL_API_KEY,
        maxTokensField: 'max_tokens',
    };
}

function create (provider) {
    const opts = createOptions(provider);

    return {
        messages: {
            stream (params) {
                return makeStream((emitText, emitReasoning) => runStream(opts, params, emitText, emitReasoning));
            },
        },
    };
}

module.exports = { create };
