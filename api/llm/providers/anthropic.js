// Claude（Anthropic本家API / Vertex AI）
//
// 呼び出し側のパラメータがそのままMessages APIの形なので、変換は要らない。
// Anthropic固有の追加パラメータ（thinking / output_config.effort）をここで足す。
// 以前はllm.js側で足していたが、他プロバイダが増えた以上、
// 特定プロバイダにしか無いパラメータの面倒はそのプロバイダが見るべき。

const config = require('../config.js');

function createRawClient (provider) {
    if (provider === 'vertex-claude') {
        // vertex-sdkはgoogle-auth-library系を芋づるで引き込むため、
        // Vertexを使うときだけ読み込む。Anthropic直API運用なら未インストールでも起動できる。
        let AnthropicVertex;
        try {
            ({ AnthropicVertex } = require('@anthropic-ai/vertex-sdk'));
        }
        catch (e) {
            throw new Error('Vertexを使うには @anthropic-ai/vertex-sdk のインストールが必要です（npm i @anthropic-ai/vertex-sdk）。');
        }

        // 鍵の検証を先にする。プロジェクトIDは鍵から取ることもあるので、
        // 鍵が壊れている場合に「VERTEX_PROJECT_IDが未設定」とだけ言われても原因に辿り着けない。
        config.assertVertexCredentials();

        if (config.VERTEX_PROJECT_ID === '') {
            throw new Error('VERTEX_PROJECT_ID が設定されていません。');
        }

        const opts = {
            projectId: config.VERTEX_PROJECT_ID,
            region: config.VERTEX_REGION,
        };

        // サービスアカウント鍵が設定されていればそれを使う。
        // 渡さなければvertex-sdkが自前でGoogleAuthを組み立ててADC
        // （gcloud auth application-default login / メタデータサーバ）に落ちる。
        const authOptions = config.vertexAuthOptions();
        if (authOptions != null) {
            // vertex-sdkのgoogleAuthオプションはGoogleAuthのインスタンスを要求するので、
            // ここだけは自前で組み立てる（@google/genai側はキーファイルのパスを渡せる）。
            // 推移的依存に頼らないよう、package.jsonに直接の依存として書いてある。
            const { GoogleAuth } = require('google-auth-library');
            opts.googleAuth = new GoogleAuth(authOptions);
        }

        return new AnthropicVertex(opts);
    }

    const Anthropic = require('@anthropic-ai/sdk');
    if (config.ANTHROPIC_API_KEY === '') {
        throw new Error('ANTHROPIC_API_KEY が設定されていません。');
    }
    return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}

function create (provider) {
    const raw = createRawClient(provider);

    return {
        messages: {
            stream (params) {
                const caps = config.getCapabilities(params.model);
                const body = {
                    model: params.model,
                    max_tokens: params.max_tokens,
                    system: params.system,
                    tools: params.tools,
                    messages: params.messages,
                };
                // 対応しているモデルにだけ送る（非対応モデルに送ると400になる）
                if (caps.adaptiveThinking) {
                    body.thinking = { type: 'adaptive' };
                }
                if (caps.effort && params.effort != null) {
                    body.output_config = { effort: params.effort };
                }
                return raw.messages.stream(body);
            },
        },
    };
}

module.exports = { create };
