// 会話1件の監査ビュー。
// ユーザーの発言とAIの応答だけでなく、実行されたツール・引数・結果まで全部見せる。
// 「AIが何を根拠にそう答えたか」まで追えないと、不適切な応答の原因が特定できないため。

import type { Route } from "./+types/control_panel_llm_conversation";
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';
import { Conversation } from '../llm/Message';

export function meta ({ data }: Route.MetaArgs) {
    return [{ title: `AI会話 #${data?.conversation?.id ?? ''} - Practice Judge` }];
}

// GET /api/admin/llm/conversations/:id の応答（api/admin_llm.js と対応）。
// dismissed / is_error / authz_ok は 0 / 1。
// conversation と turns は会話ログそのもの（Messages APIのcontent配列）なので、
// 表示側で形を仮定せずそのまま流す。
type ConversationDetail = {
    conversation: any;
    turns: any[];
    toolCalls: {
        id: number;
        turn_id: number;
        tool_use_id: string;
        tool_name: string;
        input_json: string;
        result_json: string | null;
        is_error: number;
        authz_ok: number;
        created_at: string;
    }[];
    warnings: ConversationViolation[];
    violations: ConversationViolation[];
};

// 警告と違反は同じ形で記録している。
type ConversationViolation = {
    id: number;
    violation_type: string;
    reason: string | null;
    dismissed: number;
    dismissed_reason: string | null;
    created_at: string;
};

export async function clientLoader ({ params }: Route.ClientLoaderArgs) {
    const res = await fetch(
        new URL(`/api/admin/llm/conversations/${params.conversationId}`, BASEURL).href,
        { credentials: 'include' },
    );
    if (!res.ok) {
        throw new Error('会話が見つからないか、閲覧が許可されていません。');
    }
    const data: ConversationDetail = await res.json();
    return data;
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    let msg = '不明なエラー';
    if (error instanceof Error) {
        msg = error.message;
    }
    return (
        <main className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-400/20 dark:bg-rose-400/10">
            <p className="!m-0 text-xs font-bold uppercase tracking-[0.16em] !text-rose-600 dark:!text-rose-300">Error</p>
            <h1 className="!mb-0 !mt-2 !text-xl !font-bold !text-rose-950 dark:!text-rose-100">会話を表示できません</h1>
            <p className="!mb-0 !mt-3 !text-sm !text-rose-800 dark:!text-rose-200">{msg}</p>
        </main>
    );
}

const SKILL_LABEL: Record<string, string | undefined> = {
    pre_ac_advice: '解き方のヒント（AC前）',
    wa_diagnosis: '不正解の原因究明',
    post_ac_review: 'コードの改善提案（AC後）',
};

const TYPE_LABEL: Record<string, string | undefined> = {
    DIRECT_ANSWER_REQUEST: '直接の解答要求',
    IRRELEVANT_CONVERSATION: '無関係な会話',
};

const LINK_CLASS = '!font-semibold !text-indigo-600 !no-underline hover:!text-indigo-500 dark:!text-indigo-300 dark:hover:!text-indigo-200';
const TABLE_HEADER_CLASS = '!border-b !border-slate-200 !bg-slate-50 !px-4 !py-3 !text-left !text-[11px] !font-bold !uppercase !tracking-[0.08em] !text-slate-500 dark:!border-white/10 dark:!bg-white/[0.03] dark:!text-slate-400';
const TABLE_CELL_CLASS = '!border-b !border-slate-100 !px-4 !py-3 !align-top !text-sm !text-slate-700 dark:!border-white/5 dark:!text-slate-300';

function RecordTable ({ records, activeTone }: { records: ConversationViolation[]; activeTone: 'warning' | 'violation' }) {
    return (
        <div className="overflow-x-auto">
            <table className="!m-0 min-w-[44rem] !border-collapse">
                <thead>
                    <tr>
                        <th className={TABLE_HEADER_CLASS}>日時</th>
                        <th className={TABLE_HEADER_CLASS}>種別</th>
                        <th className={TABLE_HEADER_CLASS}>内容</th>
                        <th className={TABLE_HEADER_CLASS}>状態</th>
                    </tr>
                </thead>
                <tbody>
                    {records.map((record) => (
                        <tr key={record.id} className={record.dismissed === 1 ? 'opacity-50' : undefined}>
                            <td className={`${TABLE_CELL_CLASS} whitespace-nowrap`}>{toJST(record.created_at)}</td>
                            <td className={`${TABLE_CELL_CLASS} whitespace-nowrap`}>{TYPE_LABEL[record.violation_type] ?? record.violation_type}</td>
                            <td className={`${TABLE_CELL_CLASS} min-w-64 max-w-xl whitespace-normal`}>{record.reason}</td>
                            <td className={`${TABLE_CELL_CLASS} whitespace-nowrap`}>
                                {record.dismissed === 1 ? (
                                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                        取り消し済み（{record.dismissed_reason}）
                                    </span>
                                ) : (
                                    <span className={activeTone === 'warning'
                                        ? 'inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
                                        : 'inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200'}
                                    >
                                        有効
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ControlPanelLlmConversation ({ loaderData }: Route.ComponentProps) {
    const { conversation: c, turns, toolCalls, warnings, violations } = loaderData;

    return (
        <main className="space-y-6">
            <header>
                <Link to="/control-panel/llm/conversations" className="inline-flex items-center gap-1 text-xs font-semibold !text-slate-500 !no-underline transition hover:!text-indigo-600 dark:!text-slate-400 dark:hover:!text-indigo-300">
                    <span aria-hidden="true">←</span>
                    会話一覧へ戻る
                </Link>
                <p className="!mb-0 !mt-4 text-[11px] font-bold uppercase tracking-[0.16em] !text-indigo-600 dark:!text-indigo-300">Conversation detail</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h1 className="!m-0 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">AI会話 #{c.id}</h1>
                    {c.forced_shared === 1 && (
                        <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">
                            違反により強制共有
                        </span>
                    )}
                </div>
            </header>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">概要</h2>
                </div>
                <dl className="!m-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">ユーザー</dt>
                        <dd className="!mb-0 !mt-1 text-sm"><Link className={LINK_CLASS} to={`/users/${c.username}`}>{c.username}</Link></dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">問題</dt>
                        <dd className="!mb-0 !mt-1 text-sm"><Link className={LINK_CLASS} to={`/problems/no/${c.problem_id}`}>{c.problem_title}</Link></dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">対象の提出</dt>
                        <dd className="!mb-0 !mt-1 text-sm">
                            {c.submission_id == null ? '—' : (
                                <Link className={LINK_CLASS} to={`/problems/no/${c.problem_id}/submissions/${c.submission_id}`}>#{c.submission_id}</Link>
                            )}
                        </dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">種類</dt>
                        <dd className="!mb-0 !mt-1 text-sm text-slate-700 dark:text-slate-200">{SKILL_LABEL[c.skill_id] ?? c.skill_id}</dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">モデル</dt>
                        <dd className="!mb-0 !mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{c.model}（{c.provider}）</dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">共有状態</dt>
                        <dd className="!mb-0 !mt-1 text-sm text-slate-700 dark:text-slate-200">{c.share_mode === 'shared' ? '本人が共有に同意' : '本人は非共有'}</dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">ガードレール作動回数</dt>
                        <dd className="!mb-0 !mt-1 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {c.warning_count}
                            <span className="mt-1 block text-xs font-normal leading-5 text-slate-500 dark:text-slate-400">この会話での回数。段階判定は利用者単位です。</span>
                        </dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">概算利用額</dt>
                        <dd className="!mb-0 !mt-1 font-mono text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">${Number(c.total_cost_usd).toFixed(4)}</dd>
                    </div>
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-white/5 sm:px-6">
                        <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">開始 / 最終更新</dt>
                        <dd className="!mb-0 !mt-1 text-xs leading-5 text-slate-700 dark:text-slate-200">{toJST(c.created_at)}<br />{toJST(c.updated_at)}</dd>
                    </div>
                </dl>
            </section>

            {warnings.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm shadow-amber-100/40 dark:border-amber-400/20 dark:bg-slate-900 dark:shadow-black/20">
                    <div className="border-b border-amber-100 px-5 py-4 dark:border-amber-400/10 sm:px-6">
                        <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">この会話で出した警告</h2>
                        <p className="!mb-0 !mt-2 !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">
                            警告は違反として記録されず、強制共有にもなりません。取り消しは「警告・違反」画面から行えます。
                        </p>
                    </div>
                    <RecordTable records={warnings} activeTone="warning" />
                </section>
            )}

            {violations.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm shadow-rose-100/40 dark:border-rose-400/20 dark:bg-slate-900 dark:shadow-black/20">
                    <div className="border-b border-rose-100 px-5 py-4 dark:border-rose-400/10 sm:px-6">
                        <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">この会話で記録された違反</h2>
                    </div>
                    <RecordTable records={violations} activeTone="violation" />
                </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm shadow-indigo-100/40 dark:border-indigo-400/20 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-indigo-100 px-5 py-4 dark:border-indigo-400/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">会話</h2>
                    <p className="!mb-0 !mt-2 !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">
                        ログから完全に復元したものです。🔧 の行を押すとツールの引数と結果が開きます。
                    </p>
                </div>
                <div className="bg-slate-50/70 p-4 dark:bg-slate-950/40 sm:p-6">
                    <Conversation turns={turns} />
                </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">ツール実行ログ</h2>
                    <p className="!mb-0 !mt-2 !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">
                        「認可」がNGのものは、AIが本人以外のデータを読もうとしてサーバ側で拒否された記録です。
                    </p>
                </div>
                {toolCalls.length === 0 ? (
                    <p className="!m-0 px-6 py-10 !text-center !text-sm !text-slate-500 dark:!text-slate-400">ツールは実行されていません。</p>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="!m-0 min-w-[64rem] whitespace-nowrap !border-collapse">
                        <thead>
                            <tr>
                                <th className={TABLE_HEADER_CLASS}>日時</th>
                                <th className={TABLE_HEADER_CLASS}>ツール</th>
                                <th className={TABLE_HEADER_CLASS}>引数</th>
                                <th className={TABLE_HEADER_CLASS}>結果</th>
                                <th className={TABLE_HEADER_CLASS}>エラー</th>
                                <th className={TABLE_HEADER_CLASS}>認可</th>
                            </tr>
                        </thead>
                        <tbody>
                            {toolCalls.map((t) => (
                                <tr key={t.id} className="transition hover:bg-slate-50/80 dark:hover:bg-white/[0.03]">
                                    <td className={TABLE_CELL_CLASS}>{toJST(t.created_at)}</td>
                                    <td className={`${TABLE_CELL_CLASS} font-mono text-xs font-semibold`}>{t.tool_name}</td>
                                    <td className={`${TABLE_CELL_CLASS} max-w-56 whitespace-normal`}>
                                        <code className="break-words !bg-slate-100 !text-xs !text-slate-700 dark:!bg-white/10 dark:!text-slate-200">{t.input_json}</code>
                                    </td>
                                    <td className={`${TABLE_CELL_CLASS} max-w-96 whitespace-normal`}>
                                        <code className="break-words !bg-slate-100 !text-xs !text-slate-700 dark:!bg-white/10 dark:!text-slate-200">{(t.result_json ?? '').slice(0, 400)}</code>
                                    </td>
                                    <td className={TABLE_CELL_CLASS}>
                                        {t.is_error === 1
                                            ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">あり</span>
                                            : '—'}
                                    </td>
                                    <td className={TABLE_CELL_CLASS}>
                                        {t.authz_ok === 1
                                            ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">OK</span>
                                            : <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">NG</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </section>
        </main>
    );
}
