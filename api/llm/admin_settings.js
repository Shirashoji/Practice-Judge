// env からモデルが削除されても、DB に残った参照を管理画面へ返さない。
// 管理画面は取得した値をそのまま保存するため、未知のモデルをここで除かないと
// 以後の設定保存が API のバリデーションで拒否される。
function normalizeModelSettings (allowedModels, modelByDifficulty, isKnownModel) {
    const allowed = Array.isArray(allowedModels)
        ? allowedModels.filter((model) => typeof model === 'string' && isKnownModel(model))
        : [];

    const byDifficulty = {};
    if (modelByDifficulty != null && typeof modelByDifficulty === 'object' && !Array.isArray(modelByDifficulty)) {
        for (const [difficulty, model] of Object.entries(modelByDifficulty)) {
            if (typeof model === 'string' && isKnownModel(model)) {
                byDifficulty[difficulty] = model;
            }
        }
    }

    return { allowedModels: allowed, modelByDifficulty: byDifficulty };
}

module.exports = { normalizeModelSettings };
