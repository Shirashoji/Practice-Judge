// 使用モデルの決定
//
// 優先順位は「ユーザーの選択 > 管理者の難易度別マッピング > envの既定」。
// ユーザーに選ばせているのは月次上限があるためで、安いモデルを選べばその分長く使える。
//
// 決めたモデルは会話単位で固定する（llm_conversations.model）。会話の途中で変えると
// プロンプトキャッシュのプレフィックスが壊れて、以降のターンが毎回フルコストになる。

const config = require('./config.js');
const store = require('./store.js');

// 管理画面で設定された、ユーザーが選べるモデルの一覧。
// 呼び出し経路が設定されていないモデル（例: GEMINI_API_KEYを外した後のGemini）は除く。
// 許可設定はDB、経路の設定はenvにあり別々に変わるので、ここで必ず突き合わせる。
function getAllowedModels () {
    const list = config.getSettingJSON('allowed_models');
    return Array.isArray(list) ? list.filter(config.isModelAvailable) : [];
}

function isAllowedModel (model) {
    return getAllowedModels().indexOf(model) !== -1;
}

// 難易度に対応するモデル。マッピングに無ければnullを返す（env既定に落とすのは呼び出し側の責務）。
function modelForDifficulty (difficulty) {
    const map = config.getSettingJSON('model_by_difficulty') || {};
    const model = map[String(difficulty)];
    if (typeof model === 'string' && model !== '') {
        return model;
    }
    return null;
}

// returns: { model, source } | null
// source は 'user' | 'difficulty' | 'env' | 'fallback'（設定画面の表示用）
// sourceは「どの層で決まったか」を正確に返す。マッピングの値がenv既定と偶然一致していても
// 'difficulty' と報告する（そうしないと設定画面で誤解を招く）。
//
// 各層で「呼べるモデルか」を確認して、駄目なら次の層に落とす。
// 設定が古くて呼べないモデルを指していても、使える経路が1つでもあれば機能を止めない。
// 1つも無ければnullを返す（503にするのは呼び出し側の責務）。
function resolveModel (userId, difficulty) {
    const settings = store.getUserSettings(userId);

    if (settings.preferred_model !== 'auto') {
        // 許可リストから外された後も古い設定が残りうるので、必ず現在の許可リストで検証する
        if (isAllowedModel(settings.preferred_model)) {
            return { model: settings.preferred_model, source: 'user' };
        }
    }

    const byDifficulty = modelForDifficulty(difficulty);
    if (byDifficulty != null && config.isModelAvailable(byDifficulty)) {
        return { model: byDifficulty, source: 'difficulty' };
    }

    if (config.isModelAvailable(config.MODEL_CHAT)) {
        return { model: config.MODEL_CHAT, source: 'env' };
    }

    const fallback = getAllowedModels()[0] ?? config.listKnownModels().find(config.isModelAvailable);
    if (fallback != null) {
        return { model: fallback, source: 'fallback' };
    }
    return null;
}

// 設定画面に出す、モデルごとの単価と相対的な安さ。
// 「どれを選ぶと枠が長持ちするか」を判断できるようにするのが目的。
function describeAllowedModels () {
    return getAllowedModels().map((model) => {
        const p = config.getPricing(model);
        return {
            model,
            family: config.getFamily(model),
            inputUsdPerMTok: p.input,
            outputUsdPerMTok: p.output,
        };
    });
}

module.exports = {
    getAllowedModels,
    isAllowedModel,
    modelForDifficulty,
    resolveModel,
    describeAllowedModels,
};
