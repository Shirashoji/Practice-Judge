// 閲覧可能な会話の一覧。
// 出てくるのは「本人が共有に同意したもの」と「違反により強制共有になったもの」だけ。

import type { Route } from "./+types/control_panel_llm_conversations";
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';

export function meta () {
    return [{ title: 'AI会話の監査 - Practice Judge' }];
}

// GET /api/admin/llm/conversations の1行（api/admin_llm.js のSELECTと対応）。
// forced_shared は 0 / 1。authz_violations は越権を試みたツール呼び出しの件数。
type ConversationSummary = {
    id: number;
    user_id: number;
    username: string;
    problem_id: number;
    problem_title: string;
    submission_id: number | null;
    skill_id: string;
    model: string;
    share_mode: string;
    forced_shared: number;
    warning_count: number;
    total_cost_usd: number;
    created_at: string;
    updated_at: string;
    turn_count: number;
    authz_violations: number;
};

export async function clientLoader ({ request }: Route.ClientLoaderArgs) {
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const username = url.searchParams.get('username');
    const flagged = url.searchParams.get('flagged');
    const page = url.searchParams.get('page');
    if (username) {
        params.set('username', username);
    }
    if (flagged) {
        params.set('flagged', flagged);
    }
    if (page) {
        params.set('page', page);
    }

    const res = await fetch(new URL(`/api/admin/llm/conversations?${params.toString()}`, BASEURL).href, {
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error('会話一覧を取得できませんでした。');
    }
    const data: { total: number; conversations: ConversationSummary[] } = await res.json();
    return { ...data, username, flagged, page: Number(page ?? 0) };
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    let msg = '不明なエラー';
    if (error instanceof Error) {
        msg = error.message;
    }
    return (
        <main className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-400/20 dark:bg-rose-400/10">
            <p className="!m-0 text-xs font-bold uppercase tracking-[0.16em] !text-rose-600 dark:!text-rose-300">Error</p>
            <h1 className="!mb-0 !mt-2 !text-xl !font-bold !text-rose-950 dark:!text-rose-100">会話一覧を表示できません</h1>
            <p className="!mb-0 !mt-3 !text-sm !text-rose-800 dark:!text-rose-200">{msg}</p>
        </main>
    );
}

const SKILL_LABEL: Record<string, string | undefined> = {
    pre_ac_advice: '解き方のヒント',
    wa_diagnosis: '不正解の原因究明',
    post_ac_review: 'コードの改善提案',
};

const LINK_CLASS = '!font-semibold !text-indigo-600 !no-underline hover:!text-indigo-500 dark:!text-indigo-300 dark:hover:!text-indigo-200';
const TABLE_HEADER_CLASS = '!border-b !border-slate-200 !bg-slate-50 !px-4 !py-3 !text-left !text-[11px] !font-bold !uppercase !tracking-[0.08em] !text-slate-500 dark:!border-white/10 dark:!bg-white/[0.03] dark:!text-slate-400';
const TABLE_CELL_CLASS = '!border-b !border-slate-100 !px-4 !py-3 !align-middle !text-sm !text-slate-700 dark:!border-white/5 dark:!text-slate-300';

export default function ControlPanelLlmConversations ({ loaderData }: Route.ComponentProps) {
    const d = loaderData;
    const pageSize = 20;
    const lastPage = Math.max(0, Math.ceil(d.total / pageSize) - 1);

    const linkWith = (patch: Record<string, string | number | null>) => {
        const p = new URLSearchParams();
        if (d.username) p.set('username', d.username);
        if (d.flagged) p.set('flagged', d.flagged);
        for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') p.delete(k);
            else p.set(k, String(v));
        }
        return `/control-panel/llm/conversations?${p.toString()}`;
    };

    return (
        <main className="space-y-6">
            <header>
                <p className="!m-0 text-[11px] font-bold uppercase tracking-[0.16em] !text-indigo-600 dark:!text-indigo-300">Conversation audit</p>
                <h1 className="!mb-0 !mt-1 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">AI会話の監査</h1>
                <p className="!mb-0 !mt-3 max-w-4xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                    表示されるのは、本人が共有に同意した会話と、違反により強制共有になった会話だけです。
                    共有しない設定の会話はログとしては保存されていますが、ここには表示されません。
                </p>
            </header>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/20">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            {d.total.toLocaleString()} 件
                        </span>
                        {d.flagged === '1' && (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                                違反フラグのみ
                            </span>
                        )}
                        {d.username && (
                            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-200">
                                ユーザー: {d.username}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            to={linkWith({ flagged: d.flagged === '1' ? '' : '1' })}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold !text-slate-700 !no-underline transition hover:bg-slate-50 hover:!text-slate-950 dark:border-white/10 dark:bg-white/5 dark:!text-slate-200 dark:hover:bg-white/10 dark:hover:!text-white"
                        >
                            {d.flagged === '1' ? 'すべて表示' : '違反フラグのみ表示'}
                        </Link>
                        {d.username && (
                            <Link
                                to="/control-panel/llm/conversations"
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold !text-slate-700 !no-underline transition hover:bg-slate-50 hover:!text-slate-950 dark:border-white/10 dark:bg-white/5 dark:!text-slate-200 dark:hover:bg-white/10 dark:hover:!text-white"
                            >
                                絞り込みを解除
                            </Link>
                        )}
                    </div>
                </div>

                <div className="overflow-x-auto">
                <table className="!m-0 min-w-[72rem] whitespace-nowrap !border-collapse">
                    <thead>
                        <tr>
                            <th className={TABLE_HEADER_CLASS}>会話</th>
                            <th className={TABLE_HEADER_CLASS}>ユーザー</th>
                            <th className={TABLE_HEADER_CLASS}>問題</th>
                            <th className={TABLE_HEADER_CLASS}>種類</th>
                            <th className={TABLE_HEADER_CLASS}>モデル</th>
                            <th className={TABLE_HEADER_CLASS}>やりとり</th>
                            <th className={TABLE_HEADER_CLASS}>越権試行</th>
                            <th className={TABLE_HEADER_CLASS}>金額</th>
                            <th className={TABLE_HEADER_CLASS}>最終更新</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.conversations.map((c) => (
                            <tr key={c.id} className="transition hover:bg-slate-50/80 dark:hover:bg-white/[0.03]">
                                <td className={TABLE_CELL_CLASS}>
                                    <div className="flex items-center gap-2">
                                        <Link className={LINK_CLASS} to={`/control-panel/llm/conversations/${c.id}`}>#{c.id}</Link>
                                        {c.forced_shared === 1 && (
                                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">
                                                強制共有
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className={TABLE_CELL_CLASS}><Link className={LINK_CLASS} to={`/users/${c.username}`}>{c.username}</Link></td>
                                <td className={`${TABLE_CELL_CLASS} max-w-64 truncate`} title={c.problem_title}>
                                    <Link className={LINK_CLASS} to={`/problems/no/${c.problem_id}`}>{c.problem_title}</Link>
                                </td>
                                <td className={TABLE_CELL_CLASS}>{SKILL_LABEL[c.skill_id] ?? c.skill_id}</td>
                                <td className={`${TABLE_CELL_CLASS} font-mono text-xs`}>{c.model}</td>
                                <td className={`${TABLE_CELL_CLASS} tabular-nums`}>{c.turn_count}</td>
                                <td className={TABLE_CELL_CLASS}>
                                    {c.authz_violations > 0
                                        ? <span className="inline-flex min-w-6 justify-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">{c.authz_violations}</span>
                                        : '—'}
                                </td>
                                <td className={`${TABLE_CELL_CLASS} font-mono text-xs tabular-nums`}>${Number(c.total_cost_usd).toFixed(4)}</td>
                                <td className={TABLE_CELL_CLASS}>{toJST(c.updated_at)}</td>
                            </tr>
                        ))}
                        {d.conversations.length === 0 && (
                            <tr>
                                <td colSpan={9} className="!px-6 !py-12 !text-center !text-sm !text-slate-500 dark:!text-slate-400">
                                    条件に一致する会話はありません。
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
            </section>

            {lastPage > 0 && (
                <nav aria-label="会話一覧のページ" className="flex items-center justify-center gap-3">
                    {d.page > 0 ? (
                        <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold !text-slate-700 !no-underline transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:!text-slate-200 dark:hover:bg-white/10" to={linkWith({ page: d.page - 1 })}>前へ</Link>
                    ) : <span className="w-[4.5rem]" />}
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{d.page + 1} / {lastPage + 1}</span>
                    {d.page < lastPage ? (
                        <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold !text-slate-700 !no-underline transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:!text-slate-200 dark:hover:bg-white/10" to={linkWith({ page: d.page + 1 })}>次へ</Link>
                    ) : <span className="w-[4.5rem]" />}
                </nav>
            )}
        </main>
    );
}
