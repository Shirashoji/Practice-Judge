// LLMプロバイダの抽象化
//
// Anthropic本家APIとVertex AI上のClaudeを、呼び出し側から見て同じ面で扱えるようにする。
// どちらのSDKも messages.stream() / messages.create() を同じ形で持っているので、
// 差分はクライアントの生成方法だけに閉じ込められる。
//
// 将来ブラウザ内蔵AI（Chrome Prompt API）を足すならここに3つ目のプロバイダを生やすことになるが、
// 現時点では実装しない。理由はREADMEに記載（ガードレール・ログ・ツール認可が全てサーバ経由である
// という前提が崩れ、クライアント側に整合性保証が無いため改竄を検知できない）。

const config = require('./config.js');

let cached = null;

function createClient () {
    if (cached != null) {
        return cached;
    }

    if (config.PROVIDER === 'vertex') {
        // vertex-sdkはgoogle-auth-library系を芋づるで引き込むため、
        // Vertexを使うときだけ読み込む。Anthropic直API運用なら未インストールでも起動できる。
        let AnthropicVertex;
        try {
            ({ AnthropicVertex } = require('@anthropic-ai/vertex-sdk'));
        }
        catch (e) {
            throw new Error('Vertexを使うには @anthropic-ai/vertex-sdk のインストールが必要です（npm i @anthropic-ai/vertex-sdk）。');
        }

        if (config.VERTEX_PROJECT_ID === '') {
            throw new Error('VERTEX_PROJECT_ID が設定されていません。');
        }

        // 認証はGCPのADC（gcloud auth application-default login / メタデータサーバ）に任せる。
        cached = new AnthropicVertex({
            projectId: config.VERTEX_PROJECT_ID,
            region: config.VERTEX_REGION,
        });
        return cached;
    }

    const Anthropic = require('@anthropic-ai/sdk');
    if (config.ANTHROPIC_API_KEY === '') {
        throw new Error('ANTHROPIC_API_KEY が設定されていません。');
    }
    cached = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    return cached;
}

module.exports = { createClient };
