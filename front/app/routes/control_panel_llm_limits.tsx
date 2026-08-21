// ユーザー別の上限設定。
// 共有時と非共有時をそれぞれ default / custom / unlimited で設定できる。

import type { Route } from "./+types/control_panel_llm_limits";
import { useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';

export function meta () {
    return [{ title: 'AI利用のユーザー別上限 - Practice Judge' }];
}

type LimitMode = 'default' | 'custom' | 'unlimited';

// GET /api/admin/llm/limits の1行（api/admin_llm.js のSELECTと対応）。
// 上限の金額はユーザー個別の設定が無ければnull。force_shared は 0 / 1。
type UserLimitRow = {
    user_id: number;
    username: string;
    shared_limit_mode: LimitMode;
    shared_limit_usd: number | null;
    private_limit_mode: LimitMode;
    private_limit_usd: number | null;
    share_mode: 'shared' | 'private' | null;
    force_shared: number;
    month_cost_usd: number;
};

type LimitsResponse = {
    billingMonth: string;
    users: UserLimitRow[];
};

type SaveFeedback = {
    kind: 'success' | 'error';
    message: string;
};

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/limits', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('上限設定を取得できませんでした。');
    }
    const data: LimitsResponse = await res.json();
    return data;
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    let msg = '不明なエラー';
    if (error instanceof Error) {
        msg = error.message;
    }
    return (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-400/20 dark:bg-rose-400/10">
            <p className="!m-0 text-xs font-bold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-300">
                読み込みエラー
            </p>
            <h1 className="!mb-0 !mt-2 !text-xl !font-bold !text-rose-950 dark:!text-rose-100">ユーザー別上限</h1>
            <p className="!mb-0 !mt-3 text-sm text-rose-800 dark:text-rose-200">{msg}</p>
        </section>
    );
}

function formatUsd (value: number) {
    return `$${Number(value).toFixed(4)}`;
}

function shareModeLabel (mode: UserLimitRow['share_mode']) {
    if (mode === 'shared') {
        return '共有する';
    }
    if (mode === 'private') {
        return '共有しない';
    }
    return '未選択';
}

function ShareModeBadge ({ mode }: { mode: UserLimitRow['share_mode'] }) {
    const color = mode === 'shared'
        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-200'
        : mode === 'private'
            ? 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200';

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>
            現在: {shareModeLabel(mode)}
        </span>
    );
}

function UsageRanking ({ users, billingMonth }: { users: UserLimitRow[]; billingMonth: string }) {
    const ranked = [...users]
        .sort((a, b) => Number(b.month_cost_usd) - Number(a.month_cost_usd))
        .slice(0, 6);
    const maxCost = ranked.reduce((max, user) => Math.max(max, Number(user.month_cost_usd)), 0);

    return (
        <section
            aria-labelledby="llm-user-cost-ranking-title"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70 md:p-6"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="llm-user-cost-ranking-title" className="!m-0 !text-lg !font-bold !text-slate-950 dark:!text-white">
                        利用額の上位ユーザー
                    </h2>
                    <p className="!mb-0 !mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {billingMonth} の概算利用額・最大6名
                    </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    USD
                </span>
            </div>

            {maxCost === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center dark:border-white/15 dark:bg-white/[0.03]">
                    <p className="!m-0 text-sm font-semibold text-slate-700 dark:text-slate-200">今月のAPI課金額は $0 です</p>
                    <p className="!mb-0 !mt-1 text-xs text-slate-500 dark:text-slate-400">
                        課金0のローカルモデル利用は、この金額ランキングには差が出ません。
                    </p>
                </div>
            ) : (
                <ol
                    className="!mb-0 !mt-5 !list-none !p-0 space-y-4"
                    aria-label={`${billingMonth}のユーザー別概算利用額ランキング`}
                >
                    {ranked.map((user, index) => {
                        const cost = Number(user.month_cost_usd);
                        const width = (cost / maxCost) * 100;
                        return (
                            <li key={user.user_id} aria-label={`${index + 1}位 ${user.username} ${formatUsd(cost)}`}>
                                <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                                    <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">
                                        <span className="mr-2 inline-block w-5 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                                        <Link
                                            to={`/users/${user.username}`}
                                            className="!text-slate-700 !underline-offset-4 hover:!text-indigo-600 dark:!text-slate-200 dark:hover:!text-indigo-300"
                                        >
                                            {user.username}
                                        </Link>
                                    </span>
                                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                                        {formatUsd(cost)}
                                    </span>
                                </div>
                                <div className="ml-7 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" aria-hidden="true">
                                    <div
                                        className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                                        style={{ width: `${width}%` }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

function UserRow ({ user, onSaved }: { user: UserLimitRow; onSaved: () => void }) {
    const [sharedMode, setSharedMode] = useState<LimitMode>(user.shared_limit_mode);
    const [sharedUsd, setSharedUsd] = useState(user.shared_limit_usd == null ? '' : String(user.shared_limit_usd));
    const [privateMode, setPrivateMode] = useState<LimitMode>(user.private_limit_mode);
    const [privateUsd, setPrivateUsd] = useState(user.private_limit_usd == null ? '' : String(user.private_limit_usd));
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<SaveFeedback | null>(null);

    async function save () {
        setSaving(true);
        setFeedback(null);
        const res = await fetch(new URL('/api/admin/llm/limits', BASEURL).href, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                userId: user.user_id,
                sharedMode,
                sharedUsd: sharedUsd === '' ? 0 : sharedUsd,
                privateMode,
                privateUsd: privateUsd === '' ? 0 : privateUsd,
            }),
        });
        if (res.ok) {
            setFeedback({ kind: 'success', message: '保存しました' });
            onSaved();
        }
        else {
            let message = '保存に失敗しました';
            try {
                const payload: unknown = await res.json();
                if (typeof payload === 'object' && payload != null && 'error' in payload && typeof payload.error === 'string') {
                    message = payload.error;
                }
            }
            catch (e) {
                // 本文を返さないエラーでも、既定のメッセージは表示できる。
            }
            setFeedback({ kind: 'error', message });
        }
        setSaving(false);
    }

    const modeSelect = (
        value: LimitMode,
        setter: (value: LimitMode) => void,
        label: string,
    ) => (
        <select
            aria-label={label}
            value={value}
            onChange={(e) => setter(e.target.value as LimitMode)}
            className="!m-0 !h-10 !min-w-48 !rounded-lg !border-slate-300 !bg-white !py-2 !pl-3 !pr-9 !text-sm !text-slate-700 !shadow-none focus:!border-indigo-500 focus:!ring-2 focus:!ring-indigo-500/20 dark:!border-white/15 dark:!bg-slate-950 dark:!text-slate-200"
        >
            <option value="default">全体既定に従う</option>
            <option value="custom">金額を指定</option>
            <option value="unlimited">無制限</option>
        </select>
    );

    const amountInput = (
        value: string,
        setter: (value: string) => void,
        label: string,
    ) => (
        <div className="relative mt-2 w-48">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-slate-400">$</span>
            <input
                aria-label={label}
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="!m-0 !h-10 !w-full !rounded-lg !border-slate-300 !bg-white !py-2 !pl-7 !pr-3 !text-sm !text-slate-700 !shadow-none focus:!border-indigo-500 focus:!ring-2 focus:!ring-indigo-500/20 dark:!border-white/15 dark:!bg-slate-950 dark:!text-slate-200"
            />
        </div>
    );

    return (
        <tr className="border-b border-slate-100 last:border-b-0 dark:border-white/[0.07]">
            <td className="!px-5 !py-4 align-top">
                <div className="flex min-w-44 flex-col items-start gap-2">
                    <Link
                        to={`/users/${user.username}`}
                        className="font-bold !text-slate-900 !underline-offset-4 hover:!text-indigo-600 dark:!text-white dark:hover:!text-indigo-300"
                    >
                        {user.username}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                        <ShareModeBadge mode={user.share_mode} />
                        {user.force_shared === 1 && (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                                強制共有
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="!px-5 !py-4 align-top">
                <span className="font-mono text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatUsd(Number(user.month_cost_usd))}
                </span>
            </td>
            <td className="!px-5 !py-4 align-top">
                {modeSelect(sharedMode, setSharedMode, `${user.username}の共有時上限`)}
                {sharedMode === 'custom' && amountInput(
                    sharedUsd,
                    setSharedUsd,
                    `${user.username}の共有時の月額上限（USD）`,
                )}
            </td>
            <td className="!px-5 !py-4 align-top">
                {modeSelect(privateMode, setPrivateMode, `${user.username}の非共有時上限`)}
                {privateMode === 'custom' && amountInput(
                    privateUsd,
                    setPrivateUsd,
                    `${user.username}の非共有時の月額上限（USD）`,
                )}
            </td>
            <td className="!px-5 !py-4 align-top">
                <div className="flex min-w-32 flex-col items-start gap-2">
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        aria-busy={saving ? 'true' : 'false'}
                        className="!m-0 !w-auto !rounded-lg !border-0 !bg-indigo-600 !px-4 !py-2 !text-sm !font-bold !text-white !shadow-sm transition hover:!bg-indigo-500 disabled:!cursor-not-allowed disabled:!bg-slate-300 disabled:!text-slate-500 dark:disabled:!bg-white/10 dark:disabled:!text-slate-500"
                    >
                        {saving ? '保存中' : '保存'}
                    </button>
                    {feedback != null && (
                        <p
                            role={feedback.kind === 'error' ? 'alert' : 'status'}
                            className={`!m-0 text-xs font-semibold ${feedback.kind === 'success'
                                ? 'text-emerald-600 dark:text-emerald-300'
                                : 'text-rose-600 dark:text-rose-300'}`}
                        >
                            {feedback.message}
                        </p>
                    )}
                </div>
            </td>
        </tr>
    );
}

export default function ControlPanelLlmLimits ({ loaderData }: Route.ComponentProps) {
    const [data, setData] = useState(loaderData);

    async function reload () {
        const res = await fetch(new URL('/api/admin/llm/limits', BASEURL).href, { credentials: 'include' });
        if (res.ok) {
            const nextData: LimitsResponse = await res.json();
            setData(nextData);
        }
    }

    return (
        <main className="space-y-6">
            <header>
                <p className="!m-0 text-xs font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
                    User budgets
                </p>
                <h1 className="!mb-0 !mt-2 !text-3xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">
                    ユーザー別上限
                </h1>
                <p className="!mb-0 !mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                    利用状況を確認しながら、会話の共有設定ごとに月額上限を調整できます。
                </p>
            </header>

            <aside className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-400/20 dark:bg-indigo-400/10">
                <h2 className="!m-0 !text-sm !font-bold !text-indigo-950 dark:!text-indigo-100">上限設定について</h2>
                <p className="!mb-0 !mt-2 text-sm leading-6 text-indigo-900/80 dark:text-indigo-100/80">
                    「全体既定に従う」のままなら
                    <Link
                        to="/control-panel/llm"
                        className="mx-1 font-bold !text-indigo-700 !underline !underline-offset-4 dark:!text-indigo-200"
                    >
                        全体設定
                    </Link>
                    の値が使われます。共有時と非共有時は独立して設定できます
                    （例: 共有すれば無制限、しなければ月$1）。利用額は {data.billingMonth} の集計です。
                </p>
            </aside>

            <UsageRanking users={data.users} billingMonth={data.billingMonth} />

            <section
                aria-labelledby="llm-user-limits-table-title"
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/70"
            >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10">
                    <div>
                        <h2 id="llm-user-limits-table-title" className="!m-0 !text-lg !font-bold !text-slate-950 dark:!text-white">
                            個別設定
                        </h2>
                        <p className="!mb-0 !mt-1 text-xs text-slate-500 dark:text-slate-400">
                            金額はUSD建ての月額上限です。
                        </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">
                        {data.users.length} ユーザー
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="!m-0 !w-full min-w-[70rem] !border-collapse">
                        <thead className="bg-slate-50 dark:bg-white/[0.03]">
                            <tr>
                                <th className="!px-5 !py-3 !text-left !text-xs !font-bold !uppercase !tracking-wider !text-slate-500 dark:!text-slate-400">ユーザー</th>
                                <th className="!px-5 !py-3 !text-left !text-xs !font-bold !uppercase !tracking-wider !text-slate-500 dark:!text-slate-400">今月の利用額</th>
                                <th className="!px-5 !py-3 !text-left !text-xs !font-bold !uppercase !tracking-wider !text-slate-500 dark:!text-slate-400">共有する場合</th>
                                <th className="!px-5 !py-3 !text-left !text-xs !font-bold !uppercase !tracking-wider !text-slate-500 dark:!text-slate-400">共有しない場合</th>
                                <th className="!px-5 !py-3 !text-left !text-xs !font-bold !uppercase !tracking-wider !text-slate-500 dark:!text-slate-400">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="!px-5 !py-12 !text-center !text-sm !text-slate-500 dark:!text-slate-400">
                                        設定対象のユーザーはいません。
                                    </td>
                                </tr>
                            ) : data.users.map((user) => (
                                <UserRow key={user.user_id} user={user} onSaved={reload} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </main>
    );
}
