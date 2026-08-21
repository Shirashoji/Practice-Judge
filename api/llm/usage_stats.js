// 管理画面向けのLLM利用統計。
// 課金上限と同じllm_usageを集計元にして、会話側の集計値とのずれを持ち込まない。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const BILLING_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function jstDate (date) {
    return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDate (date) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

function toTotals (row) {
    return {
        costUsd: Number(row.cost_usd),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        cacheReadTokens: Number(row.cache_read_tokens),
        cacheWriteTokens: Number(row.cache_write_tokens),
        modelCalls: Number(row.model_calls),
        activeUsers: Number(row.active_users),
        conversations: Number(row.conversations),
    };
}

function toAnalyticsTotals (row) {
    const totals = toTotals(row);
    return {
        ...totals,
        totalTokens: totals.inputTokens + totals.outputTokens
            + totals.cacheReadTokens + totals.cacheWriteTokens,
    };
}

function lastDateOfMonth (billingMonth) {
    const [year, month] = billingMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${billingMonth}-${String(lastDay).padStart(2, '0')}`;
}

function validateAnalyticsPeriod (billingMonth, selectedDate, now) {
    if (!BILLING_MONTH_PATTERN.test(billingMonth)) {
        throw new TypeError('billingMonthはYYYY-MM形式で指定してください。');
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError('nowには有効なDateを指定してください。');
    }

    const today = jstDate(now);
    const currentMonth = today.slice(0, 7);
    if (billingMonth > currentMonth) {
        throw new RangeError('未来の月は集計できません。');
    }

    const lastDate = billingMonth === currentMonth ? today : lastDateOfMonth(billingMonth);
    if (selectedDate != null) {
        if (!DATE_PATTERN.test(selectedDate) || selectedDate.slice(0, 7) !== billingMonth) {
            throw new TypeError('dateは選択月内のYYYY-MM-DD形式で指定してください。');
        }
        if (selectedDate < `${billingMonth}-01` || selectedDate > lastDate) {
            throw new RangeError('選択できる範囲外の日付です。');
        }
    }

    return { today, currentMonth, lastDate };
}

function summarizePeriod (database, billingMonth, selectedDate = null) {
    const dateClause = selectedDate == null ? '' : " AND date(usage.created_at, '+9 hours') = ?";
    const parameters = selectedDate == null ? [billingMonth] : [billingMonth, selectedDate];

    const totals = toAnalyticsTotals(database.prepare(`
        SELECT COALESCE(SUM(usage.cost_usd), 0) AS cost_usd,
               COALESCE(SUM(usage.input_tokens), 0) AS input_tokens,
               COALESCE(SUM(usage.output_tokens), 0) AS output_tokens,
               COALESCE(SUM(usage.cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(usage.cache_write_tokens), 0) AS cache_write_tokens,
               COUNT(*) AS model_calls,
               COUNT(DISTINCT usage.user_id) AS active_users,
               COUNT(DISTINCT usage.conversation_id) AS conversations
        FROM llm_usage usage
        WHERE usage.billing_month = ?${dateClause}
    `).get(...parameters));

    const byModel = database.prepare(`
        SELECT usage.provider, usage.model,
               SUM(usage.cost_usd) AS cost_usd,
               SUM(usage.input_tokens) AS input_tokens,
               SUM(usage.output_tokens) AS output_tokens,
               SUM(usage.cache_read_tokens) AS cache_read_tokens,
               SUM(usage.cache_write_tokens) AS cache_write_tokens,
               COUNT(*) AS model_calls,
               COUNT(DISTINCT usage.user_id) AS active_users,
               COUNT(DISTINCT usage.conversation_id) AS conversations
        FROM llm_usage usage
        WHERE usage.billing_month = ?${dateClause}
        GROUP BY usage.provider, usage.model
        ORDER BY (SUM(usage.input_tokens) + SUM(usage.output_tokens)
                  + SUM(usage.cache_read_tokens) + SUM(usage.cache_write_tokens)) DESC,
                 model_calls DESC, usage.provider, usage.model
    `).all(...parameters).map((row) => ({
        provider: row.provider,
        model: row.model,
        ...toAnalyticsTotals(row),
    }));

    // 利用額が0のローカルモデルでも利用実態を追えるよう、ユーザー順位はTOKEN数を主軸にする。
    const byUser = database.prepare(`
        SELECT usage.user_id, users.username,
               SUM(usage.cost_usd) AS cost_usd,
               SUM(usage.input_tokens) AS input_tokens,
               SUM(usage.output_tokens) AS output_tokens,
               SUM(usage.cache_read_tokens) AS cache_read_tokens,
               SUM(usage.cache_write_tokens) AS cache_write_tokens,
               COUNT(*) AS model_calls,
               1 AS active_users,
               COUNT(DISTINCT usage.conversation_id) AS conversations,
               COUNT(DISTINCT usage.provider || char(0) || usage.model) AS model_count,
               MAX(usage.created_at) AS last_used_at
        FROM llm_usage usage
        LEFT JOIN users ON users.id = usage.user_id
        WHERE usage.billing_month = ?${dateClause}
        GROUP BY usage.user_id, users.username
        ORDER BY (SUM(usage.input_tokens) + SUM(usage.output_tokens)
                  + SUM(usage.cache_read_tokens) + SUM(usage.cache_write_tokens)) DESC,
                 model_calls DESC, usage.user_id
    `).all(...parameters).map((row) => ({
        userId: Number(row.user_id),
        username: row.username ?? `ユーザーID ${row.user_id}`,
        ...toAnalyticsTotals(row),
        modelCount: Number(row.model_count),
        lastUsedAt: row.last_used_at,
    }));

    return { totals, byModel, byUser };
}

function listUsageMonths (database, currentMonth) {
    const months = database.prepare(`
        SELECT DISTINCT billing_month
        FROM llm_usage
        WHERE billing_month <= ?
        ORDER BY billing_month DESC
    `).all(currentMonth)
        .map((row) => row.billing_month)
        .filter((month) => BILLING_MONTH_PATTERN.test(month));

    if (!months.includes(currentMonth)) {
        months.unshift(currentMonth);
    }
    return months;
}

// 月の比較と特定日の深掘りを同じ課金明細から作り、画面間で数値が食い違わないようにする。
function summarizeUsageAnalytics (database, billingMonth, selectedDate = null, now = new Date()) {
    const { currentMonth, lastDate } = validateAnalyticsPeriod(billingMonth, selectedDate, now);
    const month = summarizePeriod(database, billingMonth);

    const dailyRows = database.prepare(`
        SELECT date(created_at, '+9 hours') AS date,
               SUM(cost_usd) AS cost_usd,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(cache_write_tokens) AS cache_write_tokens,
               COUNT(*) AS model_calls,
               COUNT(DISTINCT user_id) AS active_users,
               COUNT(DISTINCT conversation_id) AS conversations
        FROM llm_usage
        WHERE billing_month = ?
        GROUP BY date(created_at, '+9 hours')
        ORDER BY date
    `).all(billingMonth);
    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
    const daily = [];
    for (let date = `${billingMonth}-01`; date <= lastDate; date = nextDate(date)) {
        const row = dailyByDate.get(date);
        daily.push(row == null ? {
            date,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            modelCalls: 0,
            activeUsers: 0,
            conversations: 0,
        } : {
            date,
            ...toAnalyticsTotals(row),
        });
    }

    return {
        billingMonth,
        availableMonths: listUsageMonths(database, currentMonth),
        month: { ...month, daily },
        selectedDay: selectedDate == null ? null : {
            date: selectedDate,
            ...summarizePeriod(database, billingMonth, selectedDate),
        },
    };
}

// nowも受け取るのは、JSTの月初をまたぐ瞬間でも課金月とグラフの終端を同じ時刻から決めるため。
function summarizeCurrentMonthUsage (database, billingMonth, now = new Date()) {
    if (!BILLING_MONTH_PATTERN.test(billingMonth)) {
        throw new TypeError('billingMonthはYYYY-MM形式で指定してください。');
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError('nowには有効なDateを指定してください。');
    }

    const today = jstDate(now);
    if (today.slice(0, 7) !== billingMonth) {
        throw new RangeError('billingMonthとnowのJST年月が一致していません。');
    }

    const totals = toTotals(database.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(SUM(input_tokens), 0) AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
               COUNT(*) AS model_calls,
               COUNT(DISTINCT user_id) AS active_users,
               COUNT(DISTINCT conversation_id) AS conversations
        FROM llm_usage
        WHERE billing_month = ?
    `).get(billingMonth));

    // CURRENT_TIMESTAMPはUTCだが、課金月はJSTで区切るので日付も同じ基準へ揃える。
    const dailyRows = database.prepare(`
        SELECT date(created_at, '+9 hours') AS date,
               SUM(cost_usd) AS cost_usd,
               COUNT(*) AS model_calls
        FROM llm_usage
        WHERE billing_month = ?
        GROUP BY date(created_at, '+9 hours')
        ORDER BY date
    `).all(billingMonth);
    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));

    // 欠けた日を飛ばすと折れ線が利用ゼロの日をまたいでつながるため、当月1日から今日まで埋める。
    const dailyCosts = [];
    for (let date = `${billingMonth}-01`; date <= today; date = nextDate(date)) {
        const row = dailyByDate.get(date);
        dailyCosts.push({
            date,
            costUsd: row == null ? 0 : Number(row.cost_usd),
            modelCalls: row == null ? 0 : Number(row.model_calls),
        });
    }

    const byModel = database.prepare(`
        SELECT provider, model,
               SUM(cost_usd) AS cost_usd,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(cache_write_tokens) AS cache_write_tokens,
               COUNT(*) AS model_calls
        FROM llm_usage
        WHERE billing_month = ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC, model_calls DESC, provider, model
    `).all(billingMonth).map((row) => ({
        provider: row.provider,
        model: row.model,
        costUsd: Number(row.cost_usd),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        cacheReadTokens: Number(row.cache_read_tokens),
        cacheWriteTokens: Number(row.cache_write_tokens),
        modelCalls: Number(row.model_calls),
    }));

    return { billingMonth, totals, dailyCosts, byModel };
}

module.exports = { summarizeCurrentMonthUsage, summarizeUsageAnalytics };
