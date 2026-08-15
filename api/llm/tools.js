// LLM向けツールの定義と実行
//
// 【最重要の原則】
// モデルが渡してくる引数を「身元」として使わない。
// ツールはセッション由来の { userId, problemId, submissionId } に束縛されたクロージャとして生成し、
// モデル由来の引数は照合にのみ使う。
// たとえば get_submission に submission_id: 999 と渡されても、
// WHERE id = 999 AND user_id = <セッションのuser_id> で引くので他人の提出は絶対に読めない。
//
// 認可失敗は例外を投げず tool_result の is_error として返す。
// メッセージは中立的にして、対象が「存在しない」のか「権限が無い」のかを漏らさない。
// 併せて llm_tool_calls.authz_ok = 0 で記録し、管理画面で越権試行が見えるようにする。

const { db } = require('../db.js');

// ------------------------------------------------------------
// ツール定義（Messages APIに渡すスキーマ）
// ------------------------------------------------------------

const DEFINITIONS = {
    check_ac_status: {
        name: 'check_ac_status',
        description: '対象ユーザーがこの問題をAC（正解）済みかどうかを確認する。ヒントをどこまで出してよいかを判断するために、解法に踏み込む前に必ず確認すること。',
        input_schema: {
            type: 'object',
            properties: {
                problem_id: { type: 'integer', description: '問題ID。会話の対象問題を指定する。' },
            },
            required: ['problem_id'],
        },
    },

    get_submission: {
        name: 'get_submission',
        description: '提出番号を指定して、ジャッジ結果の概要（AC/WA/TLE等）と提出コードを取得する。テストケースごとの結果とエラーメッセージも含む。',
        input_schema: {
            type: 'object',
            properties: {
                submission_id: { type: 'integer', description: '提出ID。' },
            },
            required: ['submission_id'],
        },
    },

    get_editorial: {
        name: 'get_editorial',
        description: 'この問題の公式解説を取得する。AC済みのユーザーに対して、公式解法と本人の解法を比較する目的でのみ使える。AC前は利用できない。',
        input_schema: { type: 'object', properties: {}, required: [] },
    },

    get_problem_constraints: {
        name: 'get_problem_constraints',
        description: 'この問題の問題文・制約（実行時間制限、メモリ制限、難易度）を取得する。計算量の見積もりや入力形式の確認に使う。',
        input_schema: { type: 'object', properties: {}, required: [] },
    },

    get_language_usage: {
        name: 'get_language_usage',
        description: '対象ユーザーが過去の提出でどのプログラミング言語をどの割合で使ってきたかを取得する。説明を本人の得意な言語に合わせるために使う。',
        input_schema: { type: 'object', properties: {}, required: [] },
    },

    report_violation: {
        name: 'report_violation',
        description: '警告済みのユーザーが、警告を無視して再び不正な要求をしてきた場合にシステムへ通知する。初回の要求では呼ばず、警告のみに留めること。',
        input_schema: {
            type: 'object',
            properties: {
                violation_type: {
                    type: 'string',
                    enum: ['DIRECT_ANSWER_REQUEST', 'IRRELEVANT_CONVERSATION'],
                    description: 'DIRECT_ANSWER_REQUEST: 直接の解答を要求された。IRRELEVANT_CONVERSATION: 競技プログラミングや当該問題と無関係な会話を続けられた。',
                },
                reason: { type: 'string', description: '何を要求されたかの短い説明。' },
            },
            required: ['violation_type'],
        },
    },
};

// 認可エラーを表す共通の戻り値。存在有無を漏らさない中立的な文言にする。
function denied (message) {
    return { __authzFailed: true, error: message };
}

// ------------------------------------------------------------
// ツール実行器の生成
//
// ctx = { userId, problemId, submissionId, skillId, conversationId, isAdmin }
// ------------------------------------------------------------

function createToolset (ctx, hooks) {
    // この会話でユーザーが対象問題をACしているか
    function hasAC () {
        const row = db.prepare(`
            SELECT 1 FROM submissions
            WHERE user_id = ? AND problem_id = ? AND status = 'AC'
            LIMIT 1
        `).get(ctx.userId, ctx.problemId);
        return row != null;
    }

    // 問題がこのユーザーから見えるか（未公開問題は管理者のみ）
    function visibleProblem (problemId) {
        let where = 'WHERE id = ?';
        if (!ctx.isAdmin) {
            where += ' AND is_published = 1';
        }
        return db.prepare(`SELECT * FROM problems ${where}`).get(problemId);
    }

    const impl = {
        check_ac_status (input) {
            // 引数のproblem_idは「照合」にしか使わない。user_idはセッション固定。
            const requested = Number(input?.problem_id);
            if (!Number.isInteger(requested) || requested !== ctx.problemId) {
                return denied('この会話の対象問題以外のAC状況は参照できません。');
            }
            if (visibleProblem(requested) == null) {
                return denied('指定された問題を参照できません。');
            }

            const solved = hasAC();
            const attempts = db.prepare(`
                SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND problem_id = ?
            `).get(ctx.userId, ctx.problemId).c;

            return { problem_id: ctx.problemId, accepted: solved, submission_count: attempts };
        },

        get_submission (input) {
            const requested = Number(input?.submission_id);
            if (!Number.isInteger(requested)) {
                return denied('提出IDが不正です。');
            }

            // user_idをセッションで固定して引く。他人の提出はそもそもヒットしない。
            const sub = db.prepare(`
                SELECT s.id, s.problem_id, s.code, s.code_language, s.status, s.message,
                       s.time_sec, s.memory_kb, s.created_at
                FROM submissions s
                WHERE s.id = ? AND s.user_id = ?
            `).get(requested, ctx.userId);

            if (sub == null) {
                return denied('指定された提出を参照できません。');
            }
            // さらに、この会話が扱っている問題の提出であることまで要求する。
            // 別問題の提出を持ち込んで文脈を汚すのを防ぐ。
            if (sub.problem_id !== ctx.problemId) {
                return denied('この会話の対象問題以外の提出は参照できません。');
            }

            const results = db.prepare(`
                SELECT testcase_name, status, time_sec, memory_kb
                FROM results WHERE submission_id = ? ORDER BY testcase_name ASC
            `).all(sub.id);

            return {
                submission_id: sub.id,
                status: sub.status,
                language: sub.code_language,
                code: sub.code,
                message: sub.message,
                time_sec: sub.time_sec,
                memory_kb: sub.memory_kb,
                created_at: sub.created_at,
                testcase_results: results,
            };
        },

        get_editorial () {
            // 解説は答えそのもの。AC前には絶対に渡さない。
            if (ctx.skillId !== 'post_ac_review') {
                return denied('解説はAC済みのコードレビュー時のみ参照できます。');
            }
            if (!hasAC()) {
                return denied('このユーザーはまだこの問題をACしていないため、解説は参照できません。');
            }

            const p = visibleProblem(ctx.problemId);
            if (p == null) {
                return denied('指定された問題を参照できません。');
            }
            if (!p.editorial) {
                return { problem_id: ctx.problemId, editorial: null, note: 'この問題には解説が登録されていません。' };
            }
            return { problem_id: ctx.problemId, editorial: p.editorial };
        },

        get_problem_constraints () {
            const p = visibleProblem(ctx.problemId);
            if (p == null) {
                return denied('指定された問題を参照できません。');
            }
            return {
                problem_id: p.id,
                title: p.title,
                difficulty: p.difficulty,
                statement: p.statement,
                time_limit_sec: p.time_limit_sec,
                memory_limit_kb: p.memory_limit_kb,
            };
        },

        get_language_usage () {
            // セッションのuser_idのみ。引数を一切取らない。
            const rows = db.prepare(`
                SELECT code_language, COUNT(*) AS c
                FROM submissions
                WHERE user_id = ?
                GROUP BY code_language
                ORDER BY c DESC
            `).all(ctx.userId);

            const total = rows.reduce((acc, r) => acc + r.c, 0);
            if (total === 0) {
                return { total_submissions: 0, languages: [], note: 'まだ提出がありません。' };
            }
            return {
                total_submissions: total,
                languages: rows.map((r) => ({
                    language: r.code_language,
                    count: r.c,
                    ratio: Number((r.c / total).toFixed(3)),
                })),
            };
        },

        report_violation (input) {
            const type = input?.violation_type;
            if (type !== 'DIRECT_ANSWER_REQUEST' && type !== 'IRRELEVANT_CONVERSATION') {
                return denied('違反の種類が不正です。');
            }
            // user_idは引数から取らない。なりすまして他人にフラグを立てられないようにする。
            return hooks.onReportViolation(type, String(input?.reason ?? ''));
        },
    };

    return { definitions: DEFINITIONS, impl };
}

// このSkillで使えるツールの一覧（動的ローディング）
function toolsForSkill (skillId) {
    const common = ['check_ac_status', 'get_problem_constraints', 'get_language_usage', 'report_violation'];

    if (skillId === 'post_ac_review') {
        // AC済みのレビューでのみ解説を解禁する
        return [...common, 'get_submission', 'get_editorial'].map((n) => DEFINITIONS[n]);
    }
    if (skillId === 'wa_diagnosis') {
        return [...common, 'get_submission'].map((n) => DEFINITIONS[n]);
    }
    // pre_ac_advice: 提出がまだ無いこともあるが、書いたコードを提出してもらう導線があるので許可する
    return [...common, 'get_submission'].map((n) => DEFINITIONS[n]);
}

module.exports = { DEFINITIONS, createToolset, toolsForSkill };
