// 利用金額の計算と上限判定
//
// 上限は「共有時」と「非共有時」で独立している。会話を管理者に見せてよいと同意した
// ユーザーには広い枠を、そうでないユーザーには狭い枠を割り当てる、という設計のため。
// 「共有するなら無制限、しないなら月$1」といった設定ができる必要がある。

const { db } = require('../db.js');
const config = require('./config.js');
const store = require('./store.js');

// ------------------------------------------------------------
// トークン → USD
// ------------------------------------------------------------

// usage は Messages API のレスポンスの usage オブジェクト。
// returns: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }
function calcCost (model, usage) {
    const p = config.getPricing(model);

    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;

    // キャッシュ読み出しは入力単価の約0.1倍、書き込みは約1.25倍
    const costUsd =
        (inputTokens * p.input +
         cacheReadTokens * p.input * 0.1 +
         cacheWriteTokens * p.input * 1.25 +
         outputTokens * p.output) / 1_000_000;

    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };
}

// ------------------------------------------------------------
// 使用量の記録
// ------------------------------------------------------------

function recordUsage (data) {
    db.prepare(`
        INSERT INTO llm_usage
            (user_id, conversation_id, turn_id, billing_month, provider, model,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
        VALUES (@userId, @conversationId, @turnId, @billingMonth, @provider, @model,
                @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd)
    `).run({
        userId: data.userId,
        conversationId: data.conversationId ?? null,
        turnId: data.turnId ?? null,
        billingMonth: config.billingMonth(),
        provider: data.provider,
        model: data.model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadTokens,
        cacheWriteTokens: data.cacheWriteTokens,
        costUsd: data.costUsd,
    });

    if (data.conversationId != null) {
        store.addConversationCost(data.conversationId, data.costUsd);
    }
}

function monthlyCostByUser (userId, month) {
    const row = db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) AS c
        FROM llm_usage
        WHERE user_id = ? AND billing_month = ?
    `).get(userId, month ?? config.billingMonth());
    return row.c;
}

function monthlyCostSystem (month) {
    const row = db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) AS c
        FROM llm_usage
        WHERE billing_month = ?
    `).get(month ?? config.billingMonth());
    return row.c;
}

// ------------------------------------------------------------
// 上限の解決
// ------------------------------------------------------------

// returns: { mode: 'unlimited'|'custom', limitUsd: number|null, source: 'user'|'default' }
// shareMode に応じて参照する列・キーが変わるのがポイント。
function resolveUserLimit (userId, shareMode) {
    const prefix = shareMode === 'shared' ? 'shared' : 'private';

    const row = db.prepare(`
        SELECT shared_limit_mode, shared_limit_usd, private_limit_mode, private_limit_usd
        FROM llm_user_limits
        WHERE user_id = ?
    `).get(userId);

    let mode = row == null ? 'default' : row[`${prefix}_limit_mode`];
    let limitUsd = row == null ? null : row[`${prefix}_limit_usd`];
    let source = 'user';

    if (mode === 'default') {
        mode = config.getSetting(`default_${prefix}_limit_mode`) || 'custom';
        limitUsd = null;
        source = 'default';
    }

    if (mode === 'unlimited') {
        return { mode: 'unlimited', limitUsd: null, source };
    }

    if (limitUsd == null) {
        limitUsd = config.getSettingNumber(`default_${prefix}_limit_usd`);
        source = 'default';
    }

    return { mode: 'custom', limitUsd, source };
}

// returns: { mode, limitUsd }
function resolveSystemLimit () {
    const mode = config.getSetting('system_limit_mode') || 'custom';
    if (mode === 'unlimited') {
        return { mode: 'unlimited', limitUsd: null };
    }
    return { mode: 'custom', limitUsd: config.getSettingNumber('system_monthly_limit_usd') };
}

// ------------------------------------------------------------
// 予算チェック
//
// APIコールの「前」に呼ぶゲート。実行中のターンは止められないので、
// 超過は最大1ターン分だけオーバーしうる（Anthropic自身のsession budgetと同じ割り切り）。
// ------------------------------------------------------------

// returns: { ok: bool, code?: 'USER_LIMIT_EXCEEDED'|'SYSTEM_LIMIT_EXCEEDED', ...詳細 }
function checkBudget (userId, shareMode) {
    const month = config.billingMonth();

    const systemLimit = resolveSystemLimit();
    const systemCost = monthlyCostSystem(month);
    if (systemLimit.mode === 'custom' && systemCost >= systemLimit.limitUsd) {
        return {
            ok: false,
            code: 'SYSTEM_LIMIT_EXCEEDED',
            systemCostUsd: systemCost,
            systemLimitUsd: systemLimit.limitUsd,
        };
    }

    const userLimit = resolveUserLimit(userId, shareMode);
    const userCost = monthlyCostByUser(userId, month);
    if (userLimit.mode === 'custom' && userCost >= userLimit.limitUsd) {
        return {
            ok: false,
            code: 'USER_LIMIT_EXCEEDED',
            monthCostUsd: userCost,
            limitUsd: userLimit.limitUsd,
        };
    }

    return {
        ok: true,
        monthCostUsd: userCost,
        limitUsd: userLimit.mode === 'unlimited' ? null : userLimit.limitUsd,
    };
}

// 設定画面に出す、今月の利用状況のまとめ
function budgetSummary (userId) {
    const shareMode = store.effectiveShareMode(userId);
    const month = config.billingMonth();

    const summary = {
        billingMonth: month,
        monthCostUsd: monthlyCostByUser(userId, month),
        shareMode,
        // 両方の枠を見せて、切り替えるとどうなるかを判断できるようにする
        limits: {
            shared: resolveUserLimit(userId, 'shared'),
            private: resolveUserLimit(userId, 'private'),
        },
    };
    summary.current = shareMode == null ? null : summary.limits[shareMode];
    return summary;
}

module.exports = {
    calcCost,
    recordUsage,
    monthlyCostByUser,
    monthlyCostSystem,
    resolveUserLimit,
    resolveSystemLimit,
    checkBudget,
    budgetSummary,
};
