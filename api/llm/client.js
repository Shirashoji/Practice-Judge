// LLMプロバイダの抽象化
//
// 呼び出し側から見た面は Anthropic の Messages API に固定する。
//   client.messages.stream(params) → on('text') と finalMessage() を持つオブジェクト
// パラメータも戻り値もAnthropic形式（content配列 / stop_reason / usage）で、
// 各プロバイダのアダプタが自分の形との変換を持つ。
//
// この向きに揃えているのは、会話ログ（llm_turns.content_json）が
// Messages APIのcontent配列そのままだから。ログ形式を共通の中間表現にすると
// 「保存したものをそのまま再送する」という一番効く性質が失われる。
//
// プロバイダはモデルごとに決まる（config.providerFor）。全体で1つではないのは、
// 「Vertex経由のClaude ＋ Vertex経由のGemini ＋ 手元のLM Studio」のような
// 混在構成を成立させるため。
//
// 将来ブラウザ内蔵AI（Chrome Prompt API）を足すならここに生やすことになるが、
// 現時点では実装しない。理由はREADMEに記載（ガードレール・ログ・ツール認可が全てサーバ経由である
// という前提が崩れ、クライアント側に整合性保証が無いため改竄を検知できない）。

const config = require('./config.js');

// プロバイダ単位でクライアントを使い回す（接続と認証トークンの再取得を避ける）
const cache = new Map();

function build (provider) {
    switch (provider) {
        case 'anthropic':
        case 'vertex-claude':
            return require('./providers/anthropic.js').create(provider);
        case 'vertex-gemini':
        case 'gemini-api':
            return require('./providers/gemini.js').create(provider);
        case 'local':
            return require('./providers/openai_compat.js').create();
        default:
            throw new Error(`未知のプロバイダです: ${provider}`);
    }
}

// model は llm_conversations.model（会話単位で固定されている）。
function createClient (model) {
    const provider = config.providerFor(model);
    if (provider == null) {
        throw new Error(`未知のモデルです: ${model}`);
    }
    if (!config.isProviderConfigured(provider)) {
        throw new Error(`モデル ${model} の呼び出し経路（${provider}）が設定されていません。`);
    }

    if (!cache.has(provider)) {
        cache.set(provider, build(provider));
    }
    return cache.get(provider);
}

module.exports = { createClient };
