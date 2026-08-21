// 警告・違反の監視画面。
// 誤検知だった場合に取り消せることと、取り消したうえで強制共有を解除できることが要。
//
// 警告はユーザー単位で数える（会話をまたいで持ち越す）ので、誤って警告された利用者は
// 管理者に問い合わせて取り消してもらう。取り消せば次はまた警告のみから始まる。

import type { Route } from "./+types/control_panel_llm_violations";
import { useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';

export function meta () {
    return [{ title: 'AI利用の警告・違反記録 - Practice Judge' }];
}

// GET /api/admin/llm/violations の応答（api/admin_llm.js のSELECTと対応）。
// dismissed / force_shared は 0 / 1。
type ViolationUser = {
    user_id: number;
    username: string;
    total_count: number;
    active_count: number;
    direct_answer_count: number;
    irrelevant_count: number;
    active_warning_count: number;
    total_warning_count: number;
    force_shared: number;
    last_violation_at: string | null;
    last_warning_at: string | null;
};

// 警告と違反は同じ形で記録している（違うのは取り消しの意味だけ）。
type ViolationRecord = {
    id: number;
    user_id: number;
    username: string;
    conversation_id: number | null;
    violation_type: string;
    reason: string | null;
    dismissed: number;
    dismissed_reason: string | null;
    dismissed_at: string | null;
    created_at: string;
};

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/violations', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('違反記録を取得できませんでした。');
    }
    const data: { users: ViolationUser[]; violations: ViolationRecord[]; warnings: ViolationRecord[] } = await res.json();
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
            <h1 className="!mb-0 !mt-2 !text-xl !font-bold !text-rose-950 dark:!text-rose-100">警告・違反記録を表示できません</h1>
            <p className="!mb-0 !mt-3 !text-sm !text-rose-800 dark:!text-rose-200">{msg}</p>
        </main>
    );
}

const TYPE_LABEL: Record<string, string | undefined> = {
    DIRECT_ANSWER_REQUEST: '直接の解答要求',
    IRRELEVANT_CONVERSATION: '無関係な会話',
};

const LINK_CLASS = '!font-semibold !text-indigo-600 !no-underline hover:!text-indigo-500 dark:!text-indigo-300 dark:hover:!text-indigo-200';
const TABLE_HEADER_CLASS = '!border-b !border-slate-200 !bg-slate-50 !px-4 !py-3 !text-left !text-[11px] !font-bold !uppercase !tracking-[0.08em] !text-slate-500 dark:!border-white/10 dark:!bg-white/[0.03] dark:!text-slate-400';
const TABLE_CELL_CLASS = '!border-b !border-slate-100 !px-4 !py-3 !align-top !text-sm !text-slate-700 dark:!border-white/5 dark:!text-slate-300';
const ACTION_BUTTON_CLASS = '!m-0 !w-auto !rounded-lg !border !border-slate-200 !bg-white !px-3 !py-2 !text-xs !font-semibold !text-slate-700 !shadow-none transition hover:!border-indigo-300 hover:!bg-indigo-50 hover:!text-indigo-700 disabled:!cursor-not-allowed disabled:!opacity-50 dark:!border-white/10 dark:!bg-white/5 dark:!text-slate-200 dark:hover:!border-indigo-400/30 dark:hover:!bg-indigo-400/10 dark:hover:!text-indigo-200';

export default function ControlPanelLlmViolations ({ loaderData }: Route.ComponentProps) {
    const [data, setData] = useState(loaderData);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    async function reload () {
        const res = await fetch(new URL('/api/admin/llm/violations', BASEURL).href, { credentials: 'include' });
        if (res.ok) {
            setData(await res.json());
        }
    }

    async function dismiss (id: number) {
        const reason = window.prompt('取り消しの理由を入力してください（誤検知の内容など）');
        if (reason == null) {
            return;
        }
        setBusy(true);
        setMsg('');
        const res = await fetch(new URL(`/api/admin/llm/violations/${id}/dismiss`, BASEURL).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
            let v: any = {};
            try { v = await res.json(); } catch (e) { /* noop */ }
            setMsg(v.error ?? '取り消しに失敗しました。');
        }
        await reload();
        setBusy(false);
    }

    async function post (path: string, body: unknown) {
        setBusy(true);
        setMsg('');
        const res = await fetch(new URL(path, BASEURL).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body ?? {}),
        });
        let payload: any = {};
        try { payload = await res.json(); } catch (e) { /* 本文が無い応答もある */ }
        if (!res.ok) {
            setMsg(payload.error ?? '処理に失敗しました。');
        }
        await reload();
        setBusy(false);
        return res.ok ? payload : null;
    }

    async function dismissWarning (id: number) {
        const reason = window.prompt('取り消しの理由を入力してください（誤警告の内容など）');
        if (reason == null) {
            return;
        }
        await post(`/api/admin/llm/warnings/${id}/dismiss`, { reason });
    }

    // 「誤って警告された」という問い合わせに対する一括リセット。
    async function resetWarnings (userId: number, username: string, count: number) {
        if (!window.confirm(`${username} の有効な警告 ${count} 件をすべて取り消しますか？\n次に同種の要求があった場合は、また警告のみから始まります。`)) {
            return;
        }
        const reason = window.prompt('取り消しの理由を入力してください（本人からの問い合わせ内容など）');
        if (reason == null) {
            return;
        }
        const result = await post(`/api/admin/llm/users/${userId}/warnings/dismiss-all`, { reason });
        if (result != null) {
            setMsg(`${username} の警告を ${result.dismissed} 件取り消しました。`);
        }
    }

    async function release (userId: number, username: string) {
        if (!window.confirm(`${username} の強制共有を解除しますか？\n以降、この人の会話は本人の設定に従って表示されます。`)) {
            return;
        }
        setBusy(true);
        setMsg('');
        const res = await fetch(new URL(`/api/admin/llm/users/${userId}/release-force-share`, BASEURL).href, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) {
            let v: any = {};
            try { v = await res.json(); } catch (e) { /* noop */ }
            setMsg(v.error ?? '解除に失敗しました。');
        }
        await reload();
        setBusy(false);
    }

    const activeWarnings = data.users.reduce((sum, user) => sum + user.active_warning_count, 0);
    const activeViolations = data.users.reduce((sum, user) => sum + user.active_count, 0);
    const forcedSharedUsers = data.users.filter((user) => user.force_shared === 1).length;

    return (
        <main className="space-y-6">
            <header>
                <p className="!m-0 text-[11px] font-bold uppercase tracking-[0.16em] !text-indigo-600 dark:!text-indigo-300">Guardrail review</p>
                <h1 className="!mb-0 !mt-1 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">AI利用の警告・違反記録</h1>
                <p className="!mb-0 !mt-3 max-w-4xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                    初回のガイドライン違反は警告として利用者単位で記録され、同種の要求を繰り返した場合に違反へ進みます。
                </p>
            </header>

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                    <p className="!m-0 !text-xs !font-semibold !text-slate-500 dark:!text-slate-400">対象ユーザー</p>
                    <p className="!mb-0 !mt-2 !text-2xl !font-bold tabular-nums !text-slate-950 dark:!text-white">{data.users.length}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10">
                    <p className="!m-0 !text-xs !font-semibold !text-amber-700 dark:!text-amber-200">有効な警告</p>
                    <p className="!mb-0 !mt-2 !text-2xl !font-bold tabular-nums !text-amber-950 dark:!text-amber-100">{activeWarnings}</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-400/10">
                    <p className="!m-0 !text-xs !font-semibold !text-rose-700 dark:!text-rose-200">有効な違反</p>
                    <p className="!mb-0 !mt-2 !text-2xl !font-bold tabular-nums !text-rose-950 dark:!text-rose-100">{activeViolations}</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm dark:border-indigo-400/20 dark:bg-indigo-400/10">
                    <p className="!m-0 !text-xs !font-semibold !text-indigo-700 dark:!text-indigo-200">強制共有中</p>
                    <p className="!mb-0 !mt-2 !text-2xl !font-bold tabular-nums !text-indigo-950 dark:!text-indigo-100">{forcedSharedUsers}</p>
                </div>
            </section>

            <aside className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-400/20 dark:bg-amber-400/10">
                <p className="!m-0 !text-sm !leading-6 !text-amber-900 dark:!text-amber-100">
                    誤警告は「警告をリセット」で取り消せます。違反の取り消しは、強制共有を解除するより先に行ってください。
                </p>
            </aside>

            {msg !== '' && (
                <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 !text-sm !text-indigo-800 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:!text-indigo-100">
                    {msg}
                </p>
            )}

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">対象ユーザー一覧</h2>
                </div>
                {data.users.length === 0 ? (
                    <p className="!m-0 px-6 py-10 !text-center !text-sm !text-slate-500 dark:!text-slate-400">警告・違反の記録はありません。</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="!m-0 min-w-[76rem] whitespace-nowrap !border-collapse">
                            <thead>
                                <tr>
                                    <th className={TABLE_HEADER_CLASS}>ユーザー</th>
                                    <th className={TABLE_HEADER_CLASS}>有効な警告</th>
                                    <th className={TABLE_HEADER_CLASS}>有効な違反</th>
                                    <th className={TABLE_HEADER_CLASS}>直接の解答要求</th>
                                    <th className={TABLE_HEADER_CLASS}>無関係な会話</th>
                                    <th className={TABLE_HEADER_CLASS}>最終違反</th>
                                    <th className={TABLE_HEADER_CLASS}>強制共有</th>
                                    <th className={TABLE_HEADER_CLASS}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.users.map((u) => (
                                    <tr key={u.user_id} className="transition hover:bg-slate-50/80 dark:hover:bg-white/[0.03]">
                                        <td className={TABLE_CELL_CLASS}><Link className={LINK_CLASS} to={`/users/${u.username}`}>{u.username}</Link></td>
                                        <td className={`${TABLE_CELL_CLASS} tabular-nums`}>
                                            <strong className="text-amber-700 dark:text-amber-200">{u.active_warning_count}</strong>
                                            <span className="text-xs text-slate-400"> / 全{u.total_warning_count}</span>
                                        </td>
                                        <td className={`${TABLE_CELL_CLASS} tabular-nums`}>
                                            <strong className="text-rose-700 dark:text-rose-200">{u.active_count}</strong>
                                            <span className="text-xs text-slate-400"> / 全{u.total_count}</span>
                                        </td>
                                        <td className={`${TABLE_CELL_CLASS} tabular-nums`}>{u.direct_answer_count}</td>
                                        <td className={`${TABLE_CELL_CLASS} tabular-nums`}>{u.irrelevant_count}</td>
                                        <td className={TABLE_CELL_CLASS}>{u.last_violation_at == null ? '—' : toJST(u.last_violation_at)}</td>
                                        <td className={TABLE_CELL_CLASS}>
                                            {u.force_shared === 1
                                                ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">有効</span>
                                                : '—'}
                                        </td>
                                        <td className={TABLE_CELL_CLASS}>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link className={LINK_CLASS} to={`/control-panel/llm/conversations?username=${encodeURIComponent(u.username)}`}>会話を見る</Link>
                                                {u.active_warning_count > 0 && (
                                                    <button type="button" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={() => resetWarnings(u.user_id, u.username, u.active_warning_count)}>
                                                        警告をリセット
                                                    </button>
                                                )}
                                                {u.force_shared === 1 && (
                                                    <button type="button" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={() => release(u.user_id, u.username)}>
                                                        強制共有を解除
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm shadow-amber-100/40 dark:border-amber-400/20 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-amber-100 px-5 py-4 dark:border-amber-400/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">警告の明細</h2>
                    <p className="!mb-0 !mt-2 !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">警告は違反ではなく、強制共有にもなりません。誤警告だった場合は個別に取り消せます。</p>
                </div>
                {data.warnings.length === 0 ? (
                    <p className="!m-0 px-6 py-10 !text-center !text-sm !text-slate-500 dark:!text-slate-400">警告はありません。</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="!m-0 min-w-[68rem] whitespace-nowrap !border-collapse">
                            <thead><tr>
                                <th className={TABLE_HEADER_CLASS}>日時</th><th className={TABLE_HEADER_CLASS}>ユーザー</th>
                                <th className={TABLE_HEADER_CLASS}>種別</th><th className={TABLE_HEADER_CLASS}>内容</th>
                                <th className={TABLE_HEADER_CLASS}>会話</th><th className={TABLE_HEADER_CLASS}>状態</th><th className={TABLE_HEADER_CLASS}>操作</th>
                            </tr></thead>
                            <tbody>
                                {data.warnings.map((w) => (
                                    <tr key={w.id} className={w.dismissed === 1 ? 'opacity-50' : 'transition hover:bg-slate-50/80 dark:hover:bg-white/[0.03]'}>
                                        <td className={TABLE_CELL_CLASS}>{toJST(w.created_at)}</td>
                                        <td className={TABLE_CELL_CLASS}>{w.username}</td>
                                        <td className={TABLE_CELL_CLASS}>{TYPE_LABEL[w.violation_type] ?? w.violation_type}</td>
                                        <td className={`${TABLE_CELL_CLASS} max-w-80 whitespace-normal`}>{w.reason}</td>
                                        <td className={TABLE_CELL_CLASS}>{w.conversation_id == null ? '—' : <Link className={LINK_CLASS} to={`/control-panel/llm/conversations/${w.conversation_id}`}>#{w.conversation_id}</Link>}</td>
                                        <td className={TABLE_CELL_CLASS}>
                                            {w.dismissed === 1
                                                ? <span className="text-xs leading-5 text-slate-500 dark:text-slate-400">取り消し済み<br />{w.dismissed_reason}</span>
                                                : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">有効</span>}
                                        </td>
                                        <td className={TABLE_CELL_CLASS}>
                                            {w.dismissed === 0 && <button type="button" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={() => dismissWarning(w.id)}>誤警告として取り消す</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm shadow-rose-100/40 dark:border-rose-400/20 dark:bg-slate-900 dark:shadow-black/20">
                <div className="border-b border-rose-100 px-5 py-4 dark:border-rose-400/10 sm:px-6">
                    <h2 className="!m-0 !text-base !font-bold !text-slate-950 dark:!text-white">違反の明細</h2>
                </div>
                {data.violations.length === 0 ? (
                    <p className="!m-0 px-6 py-10 !text-center !text-sm !text-slate-500 dark:!text-slate-400">違反はありません。</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="!m-0 min-w-[68rem] whitespace-nowrap !border-collapse">
                            <thead><tr>
                                <th className={TABLE_HEADER_CLASS}>日時</th><th className={TABLE_HEADER_CLASS}>ユーザー</th>
                                <th className={TABLE_HEADER_CLASS}>種別</th><th className={TABLE_HEADER_CLASS}>内容</th>
                                <th className={TABLE_HEADER_CLASS}>会話</th><th className={TABLE_HEADER_CLASS}>状態</th><th className={TABLE_HEADER_CLASS}>操作</th>
                            </tr></thead>
                            <tbody>
                                {data.violations.map((v) => (
                                    <tr key={v.id} className={v.dismissed === 1 ? 'opacity-50' : 'transition hover:bg-slate-50/80 dark:hover:bg-white/[0.03]'}>
                                        <td className={TABLE_CELL_CLASS}>{toJST(v.created_at)}</td>
                                        <td className={TABLE_CELL_CLASS}>{v.username}</td>
                                        <td className={TABLE_CELL_CLASS}>{TYPE_LABEL[v.violation_type] ?? v.violation_type}</td>
                                        <td className={`${TABLE_CELL_CLASS} max-w-80 whitespace-normal`}>{v.reason}</td>
                                        <td className={TABLE_CELL_CLASS}>{v.conversation_id == null ? '—' : <Link className={LINK_CLASS} to={`/control-panel/llm/conversations/${v.conversation_id}`}>#{v.conversation_id}</Link>}</td>
                                        <td className={TABLE_CELL_CLASS}>
                                            {v.dismissed === 1
                                                ? <span className="text-xs leading-5 text-slate-500 dark:text-slate-400">取り消し済み<br />{v.dismissed_reason}</span>
                                                : <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-200">有効</span>}
                                        </td>
                                        <td className={TABLE_CELL_CLASS}>
                                            {v.dismissed === 0 && <button type="button" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={() => dismiss(v.id)}>誤認として取り消す</button>}
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
