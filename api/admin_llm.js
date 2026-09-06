// /api/admin/llm

const express = require('express');
const { db } = require('./db.js');
const { checkUserStatus, adminOnly } = require('./logincheck.js');

const config = require('./llm/config.js');
const store = require('./llm/store.js');
const { normalizeModelSettings } = require('./llm/admin_settings.js');
const { summarizeCurrentMonthUsage, summarizeUsageAnalytics } = require('./llm/usage_stats.js');

const adminLlmRouter = express.Router({ mergeParams: true });
module.exports = { adminLlmRouter };

// 管理者が閲覧してよい会話の条件。
// 本人が共有に同意しているか、違反により強制共有になっているもののみ。
// 非共有かつ違反の無い会話は、ログとしては残るが管理者にも見せない。
const VISIBLE_CONDITION = "(c.share_mode = 'shared' OR c.forced_shared = 1)";

// ------------------------------------------------------------
// 全体設定
// ------------------------------------------------------------

const NUMERIC_KEYS = ['default_shared_limit_usd', 'default_private_limit_usd', 'system_monthly_limit_usd'];
const MODE_KEYS = ['default_shared_limit_mode', 'default_private_limit_mode', 'system_limit_mode'];

// ------------------------------------------------------------
// 利用分析
// ------------------------------------------------------------

adminLlmRouter.get('/usage', adminOnly, (req, res) => {
    const now = new Date();
    const currentMonth = config.billingMonth(now);
    const month = req.query.month === undefined ? currentMonth : req.query.month;
    const selectedDate = req.query.date === undefined || req.query.date === '' ? null : req.query.date;

    if (typeof month !== 'string' || (selectedDate != null && typeof selectedDate !== 'string')) {
        return res.status(400).json({ error: 'monthとdateは文字列で指定してください。' });
    }

    try {
        return res.json({
            ...summarizeUsageAnalytics(db, month, selectedDate, now),
            systemLimit: {
                mode: config.getSetting('system_limit_mode'),
                usd: config.getSettingNumber('system_monthly_limit_usd'),
            },
        });
    }
    catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
            return res.status(400).json({ error: error.message });
        }
        throw error;
    }
});

adminLlmRouter.get('/settings', adminOnly, (req, res) => {
    // 月初をまたぐ瞬間でも課金月と日次グラフの終端を同じ基準にする。
    const now = new Date();
    const billingMonth = config.billingMonth(now);
    const currentMonthUsage = summarizeCurrentMonthUsage(db, billingMonth, now);
    const modelSettings = normalizeModelSettings(
        config.getSettingJSON('allowed_models'),
        config.getSettingJSON('model_by_difficulty'),
        config.isKnownModel
    );
    return res.json({
        provider: config.PROVIDER,
        // 経路はモデルの系列ごとに別（Claude / Gemini / ローカル）なので、まとめて状態を返す
        providers: config.describeProviders(),
        configured: config.isConfigured(),
        envDefaultModel: config.MODEL_CHAT,
        envDefaultModelAvailable: config.isModelAvailable(config.MODEL_CHAT),
        limits: {
            shared: {
                mode: config.getSetting('default_shared_limit_mode'),
                usd: config.getSettingNumber('default_shared_limit_usd'),
            },
            private: {
                mode: config.getSetting('default_private_limit_mode'),
                usd: config.getSettingNumber('default_private_limit_usd'),
            },
            system: {
                mode: config.getSetting('system_limit_mode'),
                usd: config.getSettingNumber('system_monthly_limit_usd'),
            },
        },
        modelByDifficulty: modelSettings.modelByDifficulty,
        allowedModels: modelSettings.allowedModels,
        knownModels: config.listKnownModels().map((m) => ({
            model: m,
            family: config.getFamily(m),
            provider: config.providerFor(m),
            // 経路が未設定のモデルは選ばせない（許可しても実際には呼べない）
            available: config.isModelAvailable(m),
            ...config.getPricing(m),
        })),
        currentMonth: {
            ...currentMonthUsage,
            // 既存クライアントが参照している名前は残し、集計結果を真実の源にする。
            systemCostUsd: currentMonthUsage.totals.costUsd,
        },
    });
});

adminLlmRouter.put('/settings', adminOnly, (req, res) => {
    const body = req.body ?? {};

    for (const key of MODE_KEYS) {
        if (body[key] === undefined) {
            continue;
        }
        if (body[key] !== 'custom' && body[key] !== 'unlimited') {
            return res.status(400).json({ error: `${key} は custom か unlimited を指定してください。` });
        }
    }
    for (const key of NUMERIC_KEYS) {
        if (body[key] === undefined) {
            continue;
        }
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) {
            return res.status(400).json({ error: `${key} には0以上の数値を指定してください。` });
        }
    }

    // 許可モデルは既知のモデルに限る（単価表に無いモデルを許すと課金額が推定できなくなる）
    let allowedModels = null;
    if (body.allowed_models !== undefined) {
        if (!Array.isArray(body.allowed_models)) {
            return res.status(400).json({ error: '許可モデルは配列で指定してください。' });
        }
        for (const m of body.allowed_models) {
            if (typeof m !== 'string' || !config.isKnownModel(m)) {
                return res.status(400).json({ error: `未知のモデルです: ${m}` });
            }
        }
        allowedModels = body.allowed_models;
    }

    let modelByDifficulty = null;
    if (body.model_by_difficulty !== undefined) {
        const map = body.model_by_difficulty;
        if (map == null || typeof map !== 'object' || Array.isArray(map)) {
            return res.status(400).json({ error: '難易度マッピングの形式が不正です。' });
        }
        for (const [k, v] of Object.entries(map)) {
            const d = Number(k);
            if (!Number.isInteger(d) || d < 1 || d > 5) {
                return res.status(400).json({ error: `難易度は1〜5で指定してください: ${k}` });
            }
            if (typeof v !== 'string' || !config.isKnownModel(v)) {
                return res.status(400).json({ error: `難易度${k}のモデル指定が不正です: ${v}` });
            }
        }
        modelByDifficulty = map;
    }

    const trans = db.transaction(() => {
        for (const key of [...MODE_KEYS, ...NUMERIC_KEYS]) {
            if (body[key] !== undefined) {
                config.setSetting(key, body[key]);
            }
        }
        if (allowedModels != null) {
            config.setSetting('allowed_models', JSON.stringify(allowedModels));
        }
        if (modelByDifficulty != null) {
            config.setSetting('model_by_difficulty', JSON.stringify(modelByDifficulty));
        }
    });
    trans();

    return res.status(200).end();
});

// ------------------------------------------------------------
// ユーザー別上限
// ------------------------------------------------------------

// returns: [{ user_id, username, shared_*, private_*, month_cost_usd, share_mode, force_shared }]
adminLlmRouter.get('/limits', adminOnly, (req, res) => {
    const month = config.billingMonth();
    const rows = db.prepare(`
        SELECT u.id AS user_id, u.username,
               COALESCE(l.shared_limit_mode, 'default')  AS shared_limit_mode,
               l.shared_limit_usd,
               COALESCE(l.private_limit_mode, 'default') AS private_limit_mode,
               l.private_limit_usd,
               s.share_mode, COALESCE(s.force_shared, 0) AS force_shared,
               COALESCE((SELECT SUM(cost_usd) FROM llm_usage
                         WHERE user_id = u.id AND billing_month = ?), 0) AS month_cost_usd
        FROM users u
        LEFT JOIN llm_user_limits l ON l.user_id = u.id
        LEFT JOIN llm_user_settings s ON s.user_id = u.id
        WHERE u.is_active = 1
        ORDER BY month_cost_usd DESC, u.id
    `).all(month);

    return res.json({ billingMonth: month, users: rows });
});

adminLlmRouter.put('/limits', adminOnly, (req, res) => {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'userIdを指定してください。' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId) == null) {
        return res.status(404).json({ error: '指定ユーザーが存在しません。' });
    }

    const parse = (mode, usd, label) => {
        if (mode !== 'default' && mode !== 'custom' && mode !== 'unlimited') {
            return { error: `${label}のモードは default / custom / unlimited のいずれかです。` };
        }
        if (mode !== 'custom') {
            return { mode, usd: null };
        }
        const n = Number(usd);
        if (!Number.isFinite(n) || n < 0) {
            return { error: `${label}の金額には0以上の数値を指定してください。` };
        }
        return { mode, usd: n };
    };

    const shared = parse(req.body?.sharedMode ?? 'default', req.body?.sharedUsd, '共有時');
    if (shared.error) {
        return res.status(400).json({ error: shared.error });
    }
    const priv = parse(req.body?.privateMode ?? 'default', req.body?.privateUsd, '非共有時');
    if (priv.error) {
        return res.status(400).json({ error: priv.error });
    }

    db.prepare(`
        INSERT INTO llm_user_limits
            (user_id, shared_limit_mode, shared_limit_usd, private_limit_mode, private_limit_usd, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            shared_limit_mode = excluded.shared_limit_mode,
            shared_limit_usd = excluded.shared_limit_usd,
            private_limit_mode = excluded.private_limit_mode,
            private_limit_usd = excluded.private_limit_usd,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, shared.mode, shared.usd, priv.mode, priv.usd);

    return res.status(200).end();
});

// ------------------------------------------------------------
// 警告と違反
//
// 警告（llm_warnings）は「初回の要求」で積まれるもので、記録は残るが強制共有にはしない。
// 違反（llm_violations）は「警告後に繰り返した場合」に積まれ、強制共有になる。
// どちらも誤検知なら取り消せる。警告を取り消すと、その利用者は次回また警告のみから始まる。
// ------------------------------------------------------------

// 警告・違反のある利用者の一覧。取り消し済みは件数に数えない。
// 警告だけで違反が無い利用者も出す必要があるので、両方を外部結合してから絞る。
adminLlmRouter.get('/violations', adminOnly, (req, res) => {
    const users = db.prepare(`
        SELECT u.id AS user_id, u.username,
               COALESCE(v.total_count, 0) AS total_count,
               COALESCE(v.active_count, 0) AS active_count,
               COALESCE(v.direct_answer_count, 0) AS direct_answer_count,
               COALESCE(v.irrelevant_count, 0) AS irrelevant_count,
               COALESCE(w.active_warning_count, 0) AS active_warning_count,
               COALESCE(w.total_warning_count, 0) AS total_warning_count,
               COALESCE(s.force_shared, 0) AS force_shared,
               v.last_violation_at,
               w.last_warning_at
        FROM users u
        LEFT JOIN (
            SELECT user_id,
                   COUNT(*) AS total_count,
                   SUM(CASE WHEN dismissed = 0 THEN 1 ELSE 0 END) AS active_count,
                   SUM(CASE WHEN dismissed = 0 AND violation_type = 'DIRECT_ANSWER_REQUEST' THEN 1 ELSE 0 END) AS direct_answer_count,
                   SUM(CASE WHEN dismissed = 0 AND violation_type = 'IRRELEVANT_CONVERSATION' THEN 1 ELSE 0 END) AS irrelevant_count,
                   MAX(created_at) AS last_violation_at
            FROM llm_violations GROUP BY user_id
        ) v ON v.user_id = u.id
        LEFT JOIN (
            SELECT user_id,
                   COUNT(*) AS total_warning_count,
                   SUM(CASE WHEN dismissed = 0 THEN 1 ELSE 0 END) AS active_warning_count,
                   MAX(created_at) AS last_warning_at
            FROM llm_warnings GROUP BY user_id
        ) w ON w.user_id = u.id
        LEFT JOIN llm_user_settings s ON s.user_id = u.id
        WHERE v.user_id IS NOT NULL OR w.user_id IS NOT NULL
        ORDER BY active_count DESC, active_warning_count DESC,
                 COALESCE(v.last_violation_at, w.last_warning_at) DESC
    `).all();

    const details = db.prepare(`
        SELECT v.id, v.user_id, u.username, v.conversation_id, v.violation_type, v.reason,
               v.dismissed, v.dismissed_reason, v.dismissed_at, v.created_at
        FROM llm_violations v
        JOIN users u ON u.id = v.user_id
        ORDER BY v.created_at DESC
        LIMIT 200
    `).all();

    const warnings = db.prepare(`
        SELECT w.id, w.user_id, u.username, w.conversation_id, w.violation_type, w.reason,
               w.dismissed, w.dismissed_reason, w.dismissed_at, w.created_at
        FROM llm_warnings w
        JOIN users u ON u.id = w.user_id
        ORDER BY w.created_at DESC
        LIMIT 200
    `).all();

    return res.json({ users, violations: details, warnings });
});

// 誤って出された警告を取り消す。
// 有効な警告が0件に戻れば、その利用者は次に違反しても「警告のみ」から始まる。
adminLlmRouter.post('/warnings/:id/dismiss', adminOnly, (req, res) => {
    const admin = checkUserStatus(req.session);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '警告IDが不正です。' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const ok = store.dismissWarning(id, admin.user_id, reason);
    if (!ok) {
        return res.status(404).json({ error: '対象の警告が見つからないか、すでに取り消し済みです。' });
    }
    return res.status(200).end();
});

// 問い合わせを受けたときの一括リセット。
// 「誤って警告された」という申し出に対して、その利用者の警告をまとめて取り消す。
// 違反の記録には触らない（そちらは個別に判断して取り消す運用）。
adminLlmRouter.post('/users/:id/warnings/dismiss-all', adminOnly, (req, res) => {
    const admin = checkUserStatus(req.session);
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'ユーザーIDが不正です。' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const dismissed = store.dismissAllWarnings(userId, admin.user_id, reason);
    return res.json({ dismissed });
});

// 誤認だった違反を取り消す
adminLlmRouter.post('/violations/:id/dismiss', adminOnly, (req, res) => {
    const admin = checkUserStatus(req.session);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '違反IDが不正です。' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const ok = store.dismissViolation(id, admin.user_id, reason);
    if (!ok) {
        return res.status(404).json({ error: '対象の違反が見つからないか、すでに取り消し済みです。' });
    }
    return res.status(200).end();
});

// 強制共有の解除。
// 有効な違反が残っている間は解除させない（先に違反を取り消す運用にする）。
adminLlmRouter.post('/users/:id/release-force-share', adminOnly, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'ユーザーIDが不正です。' });
    }

    const remaining = store.activeViolationCount(userId);
    if (remaining > 0) {
        return res.status(409).json({
            error: `取り消されていない違反が${remaining}件あります。先に違反を取り消してください。`,
            code: 'VIOLATIONS_REMAIN',
        });
    }

    const trans = db.transaction(() => {
        store.setForceShared(userId, false);
        // 強制共有で公開状態になっていた会話を本人の設定に戻す
        db.prepare('UPDATE llm_conversations SET forced_shared = 0 WHERE user_id = ?').run(userId);
    });
    trans();

    return res.status(200).end();
});

// ------------------------------------------------------------
// 会話の監査
// ------------------------------------------------------------

// returns: { total, conversations: [...] }
adminLlmRouter.get('/conversations', adminOnly, (req, res) => {
    const pageSize = 20;
    const page = (() => {
        const n = parseInt(req.query.page, 10);
        return Number.isInteger(n) && n >= 0 ? n : 0;
    })();

    let where = `WHERE ${VISIBLE_CONDITION}`;
    const params = [];

    if (req.query.username != null) {
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(req.query.username);
        if (u == null) {
            return res.json({ total: 0, conversations: [] });
        }
        where += ' AND c.user_id = ?';
        params.push(u.id);
    }
    // 違反フラグの立っているユーザーだけに絞り込む
    if (req.query.flagged === '1') {
        where += ' AND c.forced_shared = 1';
    }

    const conversations = db.prepare(`
        SELECT c.id, c.user_id, u.username, c.problem_id, p.title AS problem_title,
               c.submission_id, c.skill_id, c.model, c.share_mode, c.forced_shared,
               c.warning_count, c.total_cost_usd, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM llm_turns t WHERE t.conversation_id = c.id) AS turn_count,
               (SELECT COUNT(*) FROM llm_tool_calls tc WHERE tc.conversation_id = c.id AND tc.authz_ok = 0) AS authz_violations
        FROM llm_conversations c
        JOIN users u ON u.id = c.user_id
        JOIN problems p ON p.id = c.problem_id
        ${where}
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, pageSize, pageSize * page);

    const total = db.prepare(`
        SELECT COUNT(*) AS total
        FROM llm_conversations c
        JOIN users u ON u.id = c.user_id
        ${where}
    `).get(...params).total;

    return res.json({ total, conversations });
});

// 会話全文。ツールの実行内容まで含めて返す。
adminLlmRouter.get('/conversations/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '会話IDが不正です。' });
    }

    // 一覧に出さないものは個別取得でも見せない（URL直打ちで抜けないように再判定する）
    const conv = db.prepare(`
        SELECT c.*, u.username, p.title AS problem_title
        FROM llm_conversations c
        JOIN users u ON u.id = c.user_id
        JOIN problems p ON p.id = c.problem_id
        WHERE c.id = ? AND ${VISIBLE_CONDITION}
    `).get(id);

    if (conv == null) {
        return res.status(404).json({ error: '会話が見つからないか、閲覧が許可されていません。' });
    }

    return res.json({
        conversation: conv,
        turns: store.loadTurns(id),
        toolCalls: store.listToolCalls(id),
        warnings: store.listWarningsByConversation(id),
        violations: db.prepare(
            'SELECT * FROM llm_violations WHERE conversation_id = ? ORDER BY created_at'
        ).all(id),
    });
});
