// /api/llm

const express = require('express');
const { db } = require('./db.js');
const { checkUserStatus, isAdmin, loginOnly } = require('./logincheck.js');

const config = require('./llm/config.js');
const { createClient } = require('./llm/client.js');
const store = require('./llm/store.js');
const cost = require('./llm/cost.js');
const modelPolicy = require('./llm/models.js');
const skills = require('./llm/skills.js');
const guard = require('./llm/guard.js');
const toolkit = require('./llm/tools.js');

const llmRouter = express.Router({ mergeParams: true });
module.exports = { llmRouter };

// ツールを何周まで回すか。無限ループとコスト暴走の保険。
const MAX_ITERATIONS = 8;

// ------------------------------------------------------------
// SSE
//
// EventSourceはGET専用でメッセージ本文をPOSTできないため、フロントは
// fetch + ReadableStream で受ける。こちらは text/event-stream を手で書く。
// ------------------------------------------------------------

function openStream (res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // nginx等のリバースプロキシがバッファリングして
        // ストリームが届かなくなるのを防ぐ
        'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    return function emit (event, data) {
        // 接続が切れた後の書き込みは黙って捨てる（永続化は続行させたいので例外にしない）
        if (res.writableEnded) {
            return;
        }
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
        }
        catch (e) {
            console.error('SSE書き込みに失敗しました:', e);
        }
    };
}

// ------------------------------------------------------------
// 事前チェック
// ------------------------------------------------------------

// LLM機能を使える状態か。使えない理由があれば{code,message}を返す。
function preflight (userId) {
    if (!config.isConfigured()) {
        return { code: 'LLM_NOT_CONFIGURED', status: 503, message: 'この環境ではAI学習支援が有効になっていません。' };
    }

    // 共有設定が未設定のうちは使わせない。UIだけの制御にせず、ここで必ず弾く。
    const shareMode = store.effectiveShareMode(userId);
    if (shareMode == null) {
        return { code: 'SHARE_MODE_UNSET', status: 409, message: '会話の共有設定を選択してください。' };
    }

    return null;
}

// 会話に固定されたモデルが今も呼べるか。
// モデルは会話単位で固定される一方、envの経路設定は後から変わりうるので、
// 継続時にも毎回確かめる必要がある。
function modelGate (model) {
    if (!config.isModelAvailable(model)) {
        return {
            code: 'MODEL_UNAVAILABLE',
            status: 503,
            message: `AIモデル（${model}）が現在利用できません。設定画面で別のモデルを選ぶか、管理者にお問い合わせください。`,
        };
    }
    return null;
}

// 問題がそのユーザーから見えるか
function visibleProblem (problemId, session) {
    let where = 'WHERE id = ?';
    if (!isAdmin(session)) {
        where += ' AND is_published = 1';
    }
    return db.prepare(`SELECT * FROM problems ${where}`).get(problemId);
}

// システムプロンプトに差し込む「現在の状況」を組み立てる
function buildSituation (conv) {
    const hasAC = db.prepare(`
        SELECT 1 FROM submissions WHERE user_id = ? AND problem_id = ? AND status = 'AC' LIMIT 1
    `).get(conv.user_id, conv.problem_id) != null;

    const submissionCount = db.prepare(`
        SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND problem_id = ?
    `).get(conv.user_id, conv.problem_id).c;

    let submissionStatus = null;
    if (conv.submission_id != null) {
        const s = db.prepare('SELECT status FROM submissions WHERE id = ?').get(conv.submission_id);
        submissionStatus = s?.status ?? null;
    }

    return {
        problemId: conv.problem_id,
        submissionId: conv.submission_id,
        submissionStatus,
        hasAC,
        submissionCount,
        warningCount: conv.warning_count,
    };
}

// ------------------------------------------------------------
// ツールループ本体
//
// ・ターンごとに必ず永続化する（最後にまとめて書かない）。
//   そうしておけば接続が切れてもログを失わない。
// ・予算チェックは各APIコールの「前」に置く。実行中のターンは止められないので、
//   超過は最大1ターン分だけオーバーしうる。
// ------------------------------------------------------------

async function runToolLoop (req, res, emit, conv, session) {
    // モデルごとに経路が違う（Claude / Gemini / ローカル）。会話に固定されたモデルで選ぶ。
    let client;
    try {
        client = createClient(conv.model);
    }
    catch (e) {
        console.error('LLMクライアントの生成に失敗しました:', e);
        emit('error', { code: 'LLM_NOT_CONFIGURED', message: 'この環境ではAI学習支援が有効になっていません。' });
        emit('done', { stopReason: 'error' });
        res.end();
        return;
    }

    const situation = buildSituation(conv);
    const skill = skills.getSkill(conv.skill_id, situation);

    const toolCtx = {
        userId: conv.user_id,
        problemId: conv.problem_id,
        submissionId: conv.submission_id,
        skillId: conv.skill_id,
        conversationId: conv.id,
        isAdmin: isAdmin(session),
    };
    const hooks = {
        onReportViolation: (type, reason) =>
            guard.handleReportViolation(conv.id, conv.user_id, type, reason, emit),
    };
    const { impl } = toolkit.createToolset(toolCtx, hooks);

    // クライアントが切断したら、進行中のターンを保存し終えてからループを抜ける。
    //
    // 監視するのは res であって req ではない。POSTのリクエストストリームは
    // ボディを読み終えた時点で 'close' を出すため、req を見ると
    // 1周目の直後に必ず中断扱いになってしまう。
    // res の 'close' が自前の res.end() より先に来たときだけが本当の切断。
    let aborted = false;
    res.on('close', () => {
        if (!res.writableEnded) {
            aborted = true;
        }
    });

    const messages = store.loadMessages(conv.id);
    const shareMode = store.effectiveShareMode(conv.user_id);
    let stopReason = 'end_turn';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const budget = cost.checkBudget(conv.user_id, shareMode);
        if (!budget.ok) {
            emit('error', {
                code: budget.code,
                message: budget.code === 'SYSTEM_LIMIT_EXCEEDED'
                    ? 'システム全体のAI利用上限に達しました。管理者にお問い合わせください。'
                    : '今月のAI利用上限に達しました。来月まで待つか、設定画面で会話の共有設定を見直してください。',
                detail: budget,
            });
            stopReason = 'budget_exceeded';
            break;
        }

        // プロバイダ非依存の共通パラメータ。
        // 特定プロバイダにしか無いもの（Anthropicのthinking / output_config.effortなど）は
        // 各アダプタが自分で足す。ここで振り分けるとプロバイダが増えるたびに条件が増える。
        const params = {
            model: conv.model,
            max_tokens: config.MAX_TOKENS,
            system: skill.system,
            tools: skill.tools,
            messages,
            effort: config.EFFORT,
        };

        let message;
        try {
            const stream = client.messages.stream(params);
            stream.on('text', (delta) => emit('text', { delta }));
            message = await stream.finalMessage();
        }
        catch (e) {
            console.error('LLM呼び出しに失敗しました:', e);
            emit('error', { code: 'UPSTREAM_ERROR', message: 'AIの応答取得に失敗しました。しばらくしてからもう一度お試しください。' });
            stopReason = 'error';
            break;
        }

        // 永続化はここで必ず行う
        const usage = cost.calcCost(conv.model, message.usage);
        const turnId = store.appendTurn({
            conversationId: conv.id,
            role: 'assistant',
            content: message.content,
            stopReason: message.stop_reason,
            model: conv.model,
            provider: conv.provider,
            ...usage,
        });
        cost.recordUsage({
            userId: conv.user_id,
            conversationId: conv.id,
            turnId,
            provider: conv.provider,
            model: conv.model,
            ...usage,
        });

        const after = cost.checkBudget(conv.user_id, shareMode);
        emit('usage', {
            costUsd: usage.costUsd,
            monthCostUsd: after.monthCostUsd ?? cost.monthlyCostByUser(conv.user_id),
            limitUsd: after.limitUsd ?? null,
        });

        messages.push({ role: 'assistant', content: message.content });
        stopReason = message.stop_reason;

        if (message.stop_reason !== 'tool_use') {
            break;
        }

        // ツールを実行して結果を1つのuserメッセージにまとめる
        const toolResults = [];
        for (const block of message.content) {
            if (block.type !== 'tool_use') {
                continue;
            }
            emit('tool_use', { toolUseId: block.id, name: block.name, input: block.input });

            let result;
            let isError = false;
            let authzOk = true;

            const fn = impl[block.name];
            if (typeof fn !== 'function') {
                result = { error: `未知のツールです: ${block.name}` };
                isError = true;
            }
            else {
                try {
                    result = fn(block.input);
                }
                catch (e) {
                    console.error(`ツール ${block.name} の実行に失敗しました:`, e);
                    result = { error: 'ツールの実行に失敗しました。' };
                    isError = true;
                }
                if (result && result.__authzFailed) {
                    // 認可失敗。越権試行として記録し、モデルには中立的な文言だけ返す。
                    isError = true;
                    authzOk = false;
                    result = { error: result.error };
                }
            }

            store.recordToolCall({
                conversationId: conv.id,
                turnId,
                toolUseId: block.id,
                toolName: block.name,
                input: block.input,
                result,
                isError,
                authzOk,
            });
            emit('tool_result', {
                toolUseId: block.id,
                name: block.name,
                isError,
                summary: isError ? (result.error ?? 'エラー') : '取得しました',
            });

            toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
                is_error: isError,
            });
        }

        if (toolResults.length === 0) {
            break;
        }

        store.appendTurn({ conversationId: conv.id, role: 'user', content: toolResults });
        messages.push({ role: 'user', content: toolResults });

        if (aborted) {
            // 保存は済んでいるので、ここで安全に降りられる
            break;
        }
    }

    emit('done', { stopReason });
    res.end();
}

// ------------------------------------------------------------
// POST /api/llm/advice
// 一方向説明を生成する。会話を新規作成して1ターン目を回す。
// body: { problemId, submissionId?, skillId? }
// ------------------------------------------------------------
llmRouter.post('/advice', loginOnly, async (req, res) => {
    const { user_id } = checkUserStatus(req.session);

    const gate = preflight(user_id);
    if (gate != null) {
        return res.status(gate.status).json({ error: gate.message, code: gate.code });
    }

    const problemId = Number(req.body?.problemId);
    if (!Number.isInteger(problemId)) {
        return res.status(400).json({ error: '問題IDを指定してください。' });
    }

    const problem = visibleProblem(problemId, req.session);
    if (problem == null) {
        return res.status(404).json({ error: '問題が見つかりません。' });
    }

    // 提出が指定されていれば、それが本人のものであることを確認する
    let submission = null;
    if (req.body?.submissionId != null) {
        const sid = Number(req.body.submissionId);
        if (!Number.isInteger(sid)) {
            return res.status(400).json({ error: '提出IDが不正です。' });
        }
        submission = db.prepare(
            'SELECT id, problem_id, user_id, status FROM submissions WHERE id = ? AND user_id = ?'
        ).get(sid, user_id);
        if (submission == null || submission.problem_id !== problemId) {
            return res.status(403).json({ error: '指定された提出を参照できません。' });
        }
    }

    // Skillの決定。明示指定が無ければ提出の状態から選ぶ。
    let skillId = req.body?.skillId;
    if (skillId == null) {
        skillId = submission == null ? 'pre_ac_advice' : skills.skillForSubmission(submission.status);
    }
    if (!skills.isValidSkill(skillId)) {
        return res.status(400).json({ error: 'skillIdが不正です。' });
    }
    // AC前に改善提案Skillへ入られると解説ツールが開いてしまうので、ここでも確認する
    if (skillId === 'post_ac_review' && submission?.status !== 'AC') {
        return res.status(400).json({ error: 'コードの改善提案はAC済みの提出に対してのみ利用できます。' });
    }

    const resolved = modelPolicy.resolveModel(user_id, problem.difficulty);
    if (resolved == null) {
        return res.status(503).json({
            error: 'この環境ではAI学習支援が有効になっていません。',
            code: 'LLM_NOT_CONFIGURED',
        });
    }

    const settings = store.getUserSettings(user_id);
    const shareMode = store.effectiveShareMode(user_id);

    const conversationId = store.createConversation({
        userId: user_id,
        problemId,
        submissionId: submission?.id ?? null,
        skillId,
        // 会話ごとに経路が違いうるので、全体設定ではなくモデルから引いたものを記録する
        provider: config.providerFor(resolved.model),
        model: resolved.model,
        shareMode,
        forcedShared: settings.force_shared === 1,
    });

    // 1ターン目のユーザー発言。UIのボタンを押した行為をそのまま言葉にする。
    const opening = submission == null
        ? 'この問題の解き方について相談させてください。'
        : (skillId === 'post_ac_review'
            ? `提出 #${submission.id} がACしました。このコードの改善点を教えてください。`
            : `提出 #${submission.id} が ${submission.status} になりました。どこが間違っていそうかヒントをください。`);

    store.appendTurn({
        conversationId,
        role: 'user',
        content: [{ type: 'text', text: opening }],
    });

    const conv = store.getConversation(conversationId);
    const emit = openStream(res);
    emit('meta', { conversationId, skillId, model: conv.model, modelSource: resolved.source });

    await runToolLoop(req, res, emit, conv, req.session);
});

// ------------------------------------------------------------
// POST /api/llm/conversations/:id/messages
// チャットの継続。
// body: { message }
// ------------------------------------------------------------
llmRouter.post('/conversations/:id/messages', loginOnly, async (req, res) => {
    const { user_id } = checkUserStatus(req.session);

    const gate = preflight(user_id);
    if (gate != null) {
        return res.status(gate.status).json({ error: gate.message, code: gate.code });
    }

    const conv = store.getConversation(Number(req.params.id));
    if (conv == null || conv.user_id !== user_id) {
        // 他人の会話の存在を漏らさないよう404で統一する
        return res.status(404).json({ error: '会話が見つかりません。' });
    }

    // 会話に固定されたモデルの経路が、その後のenv変更で消えている可能性がある
    const modelUnavailable = modelGate(conv.model);
    if (modelUnavailable != null) {
        return res.status(modelUnavailable.status).json({
            error: modelUnavailable.message,
            code: modelUnavailable.code,
        });
    }

    const text = req.body?.message;
    if (typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ error: 'メッセージを入力してください。' });
    }
    if (text.length > 10000) {
        return res.status(400).json({ error: 'メッセージが長すぎます。' });
    }

    store.appendTurn({
        conversationId: conv.id,
        role: 'user',
        content: [{ type: 'text', text }],
    });

    const emit = openStream(res);
    emit('meta', { conversationId: conv.id, skillId: conv.skill_id, model: conv.model });

    // warning_countが増えている可能性があるので読み直す
    await runToolLoop(req, res, emit, store.getConversation(conv.id), req.session);
});

// ------------------------------------------------------------
// GET /api/llm/conversations/:id
// 会話の復元。ログからそのまま再構築できる形で返す。
// ------------------------------------------------------------
llmRouter.get('/conversations/:id', loginOnly, (req, res) => {
    const { user_id } = checkUserStatus(req.session);

    const conv = store.getConversation(Number(req.params.id));
    if (conv == null || conv.user_id !== user_id) {
        return res.status(404).json({ error: '会話が見つかりません。' });
    }

    const problem = db.prepare('SELECT id, title, difficulty FROM problems WHERE id = ?').get(conv.problem_id);

    return res.json({
        conversation: {
            id: conv.id,
            problem_id: conv.problem_id,
            problem_title: problem?.title ?? '',
            submission_id: conv.submission_id,
            skill_id: conv.skill_id,
            model: conv.model,
            share_mode: conv.share_mode,
            forced_shared: conv.forced_shared,
            warning_count: conv.warning_count,
            total_cost_usd: conv.total_cost_usd,
            created_at: conv.created_at,
        },
        turns: store.loadTurns(conv.id),
    });
});

// ------------------------------------------------------------
// GET /api/llm/conversations
// returns: { total, conversations: [...] }
// ------------------------------------------------------------
llmRouter.get('/conversations', loginOnly, (req, res) => {
    const { user_id } = checkUserStatus(req.session);

    const pageSize = 20;
    const page = (() => {
        const n = parseInt(req.query.page, 10);
        return Number.isInteger(n) && n >= 0 ? n : 0;
    })();

    return res.json(store.listConversationsByUser(user_id, page, pageSize));
});

// ------------------------------------------------------------
// GET /api/llm/settings
// 共有設定・モデル選択・今月の利用状況をまとめて返す。
// share_modeがnullなら未設定（初回選択がまだ）。
// ------------------------------------------------------------
llmRouter.get('/settings', loginOnly, (req, res) => {
    const { user_id } = checkUserStatus(req.session);
    const settings = store.getUserSettings(user_id);

    return res.json({
        available: config.isConfigured(),
        shareMode: settings.share_mode,
        forceShared: settings.force_shared === 1,
        preferredModel: settings.preferred_model,
        allowedModels: modelPolicy.describeAllowedModels(),
        budget: cost.budgetSummary(user_id),
    });
});

// ------------------------------------------------------------
// PUT /api/llm/settings
// 初回の共有設定選択もここを使う。
// body: { shareMode?, preferredModel? }
// ------------------------------------------------------------
llmRouter.put('/settings', loginOnly, (req, res) => {
    const { user_id } = checkUserStatus(req.session);
    const current = store.getUserSettings(user_id);
    const patch = {};

    if (req.body?.shareMode !== undefined) {
        const mode = req.body.shareMode;
        if (mode !== 'shared' && mode !== 'private') {
            return res.status(400).json({ error: '共有設定の値が不正です。' });
        }
        // 強制共有中は本人に変更させない
        if (current.force_shared === 1) {
            return res.status(403).json({
                error: 'ガイドライン違反の記録があるため、会話の共有設定は変更できません。管理者にお問い合わせください。',
                code: 'FORCE_SHARED',
            });
        }
        patch.share_mode = mode;
    }

    if (req.body?.preferredModel !== undefined) {
        const model = req.body.preferredModel;
        if (model !== 'auto' && !modelPolicy.isAllowedModel(model)) {
            return res.status(400).json({ error: '選択できないモデルです。' });
        }
        patch.preferred_model = model;
    }

    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: '変更内容がありません。' });
    }

    store.upsertUserSettings(user_id, patch);
    return res.status(200).end();
});
