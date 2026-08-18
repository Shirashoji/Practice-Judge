// LLM機能の永続化層
//
// llm_* テーブルへのアクセスはここに集約する（金額の計算だけはcost.jsが持つ）。
// 会話の復元は llm_turns.content_json をそのまま返すのが要で、
// これによって「APIへの再送」と「フロントでの再描画」が同じデータで済む。

const { db } = require('../db.js');

// ------------------------------------------------------------
// ユーザー設定
// ------------------------------------------------------------

// returns: { share_mode: 'shared'|'private'|null, force_shared: 0|1, preferred_model: string }
// 行が無い場合は share_mode = null（未設定）を返す。既定値を勝手に決めない。
function getUserSettings (userId) {
    const row = db.prepare(`
        SELECT share_mode, force_shared, preferred_model
        FROM llm_user_settings
        WHERE user_id = ?
    `).get(userId);

    if (row == null) {
        return { share_mode: null, force_shared: 0, preferred_model: 'auto' };
    }
    return row;
}

// 実際に適用される共有状態。強制共有中は本人の設定を無視してsharedになる。
// 未設定（null）のままならLLM機能を使わせない。
function effectiveShareMode (userId) {
    const s = getUserSettings(userId);
    if (s.force_shared === 1) {
        return 'shared';
    }
    return s.share_mode;
}

function upsertUserSettings (userId, patch) {
    const cur = getUserSettings(userId);
    const shareMode = patch.share_mode !== undefined ? patch.share_mode : cur.share_mode;
    const preferredModel = patch.preferred_model !== undefined ? patch.preferred_model : cur.preferred_model;

    db.prepare(`
        INSERT INTO llm_user_settings (user_id, share_mode, force_shared, preferred_model, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            share_mode = excluded.share_mode,
            preferred_model = excluded.preferred_model,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, shareMode, cur.force_shared, preferredModel);
}

// 違反が記録されたときに立てる。以降の会話が強制共有になる。
function setForceShared (userId, value) {
    db.prepare(`
        INSERT INTO llm_user_settings (user_id, share_mode, force_shared, preferred_model, updated_at)
        VALUES (?, NULL, ?, 'auto', CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            force_shared = excluded.force_shared,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, value ? 1 : 0);
}

// ------------------------------------------------------------
// 会話
// ------------------------------------------------------------

function createConversation (data) {
    const info = db.prepare(`
        INSERT INTO llm_conversations
            (user_id, problem_id, submission_id, skill_id, provider, model, share_mode, forced_shared)
        VALUES (@userId, @problemId, @submissionId, @skillId, @provider, @model, @shareMode, @forcedShared)
    `).run({
        userId: data.userId,
        problemId: data.problemId,
        submissionId: data.submissionId ?? null,
        skillId: data.skillId,
        provider: data.provider,
        model: data.model,
        shareMode: data.shareMode,
        forcedShared: data.forcedShared ? 1 : 0,
    });
    return info.lastInsertRowid;
}

function getConversation (id) {
    return db.prepare('SELECT * FROM llm_conversations WHERE id = ?').get(id);
}

// returns: { total, conversations: [...] }
function listConversationsByUser (userId, page, pageSize) {
    const conversations = db.prepare(`
        SELECT c.id, c.problem_id, p.title as problem_title, c.submission_id, c.skill_id,
               c.model, c.share_mode, c.forced_shared, c.total_cost_usd, c.created_at, c.updated_at
        FROM llm_conversations c
        JOIN problems p ON c.problem_id = p.id
        WHERE c.user_id = ?
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
    `).all(userId, pageSize, pageSize * page);

    const total = db.prepare('SELECT COUNT(*) as total FROM llm_conversations WHERE user_id = ?').get(userId).total;
    return { total, conversations };
}

function touchConversation (id) {
    db.prepare('UPDATE llm_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

function addConversationCost (id, costUsd) {
    db.prepare(`
        UPDATE llm_conversations
        SET total_cost_usd = total_cost_usd + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(costUsd, id);
}

// 違反が記録された会話を強制共有にする。
// 管理画面の閲覧条件は llm_conversations の share_mode / forced_shared で判定するので、
// llm_user_settings.force_shared を立てるだけでは「以降の会話」しか見えるようにならない。
// 違反が起きた当の会話が読めないと監査にならないため、その行も併せて立てる。
function setConversationForcedShared (id) {
    db.prepare('UPDATE llm_conversations SET forced_shared = 1 WHERE id = ?').run(id);
}

function incrementWarning (id) {
    db.prepare('UPDATE llm_conversations SET warning_count = warning_count + 1 WHERE id = ?').run(id);
}

// ------------------------------------------------------------
// ターン
// ------------------------------------------------------------

function nextSeq (conversationId) {
    const row = db.prepare(
        'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM llm_turns WHERE conversation_id = ?'
    ).get(conversationId);
    return row.next;
}

// content は Messages API の content 配列（文字列ではなく配列で渡すこと）。
// returns: turn_id
function appendTurn (data) {
    const seq = nextSeq(data.conversationId);
    const info = db.prepare(`
        INSERT INTO llm_turns
            (conversation_id, seq, role, content_json, stop_reason, model, provider,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
        VALUES (@conversationId, @seq, @role, @contentJson, @stopReason, @model, @provider,
                @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd)
    `).run({
        conversationId: data.conversationId,
        seq,
        role: data.role,
        contentJson: JSON.stringify(data.content),
        stopReason: data.stopReason ?? null,
        model: data.model ?? null,
        provider: data.provider ?? null,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        cacheReadTokens: data.cacheReadTokens ?? 0,
        cacheWriteTokens: data.cacheWriteTokens ?? 0,
        costUsd: data.costUsd ?? 0,
    });
    touchConversation(data.conversationId);
    return info.lastInsertRowid;
}

// 応答を1つも保存できずに終わったとき、直前に積んだユーザー発言を取り消す。
//
// 残すと、リトライのたびにuserターンが積み上がる。userロールが連続した履歴は
// OpenAI形式では不正になりうるし、送信のたびにプロンプトが無駄に膨らむ。
// 「発言はしたが応答が無い」状態を残すより、無かったことにして再送させるほうがよい。
//
// 会話ごと空になった場合（=1ターン目で失敗した場合）は会話自体も消す。
// 中身の無い会話は履歴一覧のノイズにしかならない。
// FKもON DELETE CASCADEも張っていないスキーマなので、派生行が無いことを確かめてから消す。
//
// returns: 会話ごと削除したかどうか
function rollbackUserTurn (conversationId, turnId) {
    const trans = db.transaction(() => {
        db.prepare('DELETE FROM llm_turns WHERE id = ? AND conversation_id = ? AND role = ?')
            .run(turnId, conversationId, 'user');

        const turns = db.prepare('SELECT COUNT(*) AS c FROM llm_turns WHERE conversation_id = ?').get(conversationId).c;
        if (turns > 0) {
            return false;
        }
        // 応答が無い以上ここは0のはずだが、消してよいかの判断を件数に委ねる
        const toolCalls = db.prepare('SELECT COUNT(*) AS c FROM llm_tool_calls WHERE conversation_id = ?').get(conversationId).c;
        const usage = db.prepare('SELECT COUNT(*) AS c FROM llm_usage WHERE conversation_id = ?').get(conversationId).c;
        if (toolCalls > 0 || usage > 0) {
            return false;
        }

        db.prepare('DELETE FROM llm_conversations WHERE id = ?').run(conversationId);
        return true;
    });
    return trans();
}

// Messages APIにそのまま渡せる形。会話の完全復元はこの一本で足りる。
function loadMessages (conversationId) {
    const rows = db.prepare(
        'SELECT role, content_json FROM llm_turns WHERE conversation_id = ? ORDER BY seq'
    ).all(conversationId);

    return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content_json) }));
}

// フロント描画・管理画面の監査用。メタ情報つきで返す。
function loadTurns (conversationId) {
    const rows = db.prepare(`
        SELECT id, seq, role, content_json, stop_reason, model, provider,
               input_tokens, output_tokens, cost_usd, created_at
        FROM llm_turns
        WHERE conversation_id = ?
        ORDER BY seq
    `).all(conversationId);

    return rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        role: r.role,
        content: JSON.parse(r.content_json),
        stop_reason: r.stop_reason,
        model: r.model,
        provider: r.provider,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_usd: r.cost_usd,
        created_at: r.created_at,
    }));
}

// ------------------------------------------------------------
// ツール実行ログ
// ------------------------------------------------------------

function recordToolCall (data) {
    db.prepare(`
        INSERT INTO llm_tool_calls
            (conversation_id, turn_id, tool_use_id, tool_name, input_json, result_json, is_error, authz_ok)
        VALUES (@conversationId, @turnId, @toolUseId, @toolName, @inputJson, @resultJson, @isError, @authzOk)
    `).run({
        conversationId: data.conversationId,
        turnId: data.turnId,
        toolUseId: data.toolUseId,
        toolName: data.toolName,
        inputJson: JSON.stringify(data.input ?? {}),
        resultJson: data.result === undefined ? null : JSON.stringify(data.result),
        isError: data.isError ? 1 : 0,
        authzOk: data.authzOk === false ? 0 : 1,
    });
}

function listToolCalls (conversationId) {
    return db.prepare(`
        SELECT id, turn_id, tool_use_id, tool_name, input_json, result_json, is_error, authz_ok, created_at
        FROM llm_tool_calls
        WHERE conversation_id = ?
        ORDER BY id
    `).all(conversationId);
}

// ------------------------------------------------------------
// 警告
//
// 警告はユーザー単位で数える。会話単位にすると、警告されたチャットを閉じて
// 開き直すだけで初回に戻せてしまい、段階的警告が意味を持たなくなる。
// ------------------------------------------------------------

function recordWarning (data) {
    const info = db.prepare(`
        INSERT INTO llm_warnings (user_id, conversation_id, violation_type, reason)
        VALUES (?, ?, ?, ?)
    `).run(data.userId, data.conversationId ?? null, data.violationType, data.reason ?? '');
    return info.lastInsertRowid;
}

// 取り消されていない警告の件数。これが0なら次の違反は「警告のみ」から始まる。
function activeWarningCount (userId) {
    return db.prepare(
        'SELECT COUNT(*) as c FROM llm_warnings WHERE user_id = ? AND dismissed = 0'
    ).get(userId).c;
}

function dismissWarning (warningId, adminUserId, reason) {
    const info = db.prepare(`
        UPDATE llm_warnings
        SET dismissed = 1, dismissed_by = ?, dismissed_at = CURRENT_TIMESTAMP, dismissed_reason = ?
        WHERE id = ? AND dismissed = 0
    `).run(adminUserId, reason ?? '', warningId);
    return info.changes > 0;
}

// 問い合わせを受けて、そのユーザーの警告をまとめて取り消す。
// returns: 取り消した件数
function dismissAllWarnings (userId, adminUserId, reason) {
    const info = db.prepare(`
        UPDATE llm_warnings
        SET dismissed = 1, dismissed_by = ?, dismissed_at = CURRENT_TIMESTAMP, dismissed_reason = ?
        WHERE user_id = ? AND dismissed = 0
    `).run(adminUserId, reason ?? '', userId);
    return info.changes;
}

function listWarningsByConversation (conversationId) {
    return db.prepare(
        'SELECT * FROM llm_warnings WHERE conversation_id = ? ORDER BY created_at'
    ).all(conversationId);
}

// ------------------------------------------------------------
// 違反
// ------------------------------------------------------------

function recordViolation (data) {
    const info = db.prepare(`
        INSERT INTO llm_violations (user_id, conversation_id, violation_type, reason)
        VALUES (?, ?, ?, ?)
    `).run(data.userId, data.conversationId ?? null, data.violationType, data.reason ?? '');
    return info.lastInsertRowid;
}

// 取り消されていない違反の件数。強制共有を解除してよいかの判定に使う。
function activeViolationCount (userId) {
    return db.prepare(
        'SELECT COUNT(*) as c FROM llm_violations WHERE user_id = ? AND dismissed = 0'
    ).get(userId).c;
}

function dismissViolation (violationId, adminUserId, reason) {
    const info = db.prepare(`
        UPDATE llm_violations
        SET dismissed = 1, dismissed_by = ?, dismissed_at = CURRENT_TIMESTAMP, dismissed_reason = ?
        WHERE id = ? AND dismissed = 0
    `).run(adminUserId, reason ?? '', violationId);
    return info.changes > 0;
}

module.exports = {
    getUserSettings,
    effectiveShareMode,
    upsertUserSettings,
    setForceShared,
    createConversation,
    getConversation,
    listConversationsByUser,
    touchConversation,
    addConversationCost,
    setConversationForcedShared,
    incrementWarning,
    appendTurn,
    rollbackUserTurn,
    loadMessages,
    loadTurns,
    recordToolCall,
    listToolCalls,
    recordWarning,
    activeWarningCount,
    dismissWarning,
    dismissAllWarnings,
    listWarningsByConversation,
    recordViolation,
    activeViolationCount,
    dismissViolation,
};
