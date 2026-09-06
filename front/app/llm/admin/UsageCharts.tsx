import { useId, useState } from 'react';

export type UsageTotals = {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    modelCalls: number;
    activeUsers: number;
    conversations: number;
};

export type DailyUsage = UsageTotals & { date: string };

export type ModelUsage = UsageTotals & {
    provider: string;
    model: string;
};

export type UserUsage = UsageTotals & {
    userId: number;
    username: string;
    modelCount: number;
    lastUsedAt: string | null;
};

export type UsagePeriod = {
    totals: UsageTotals;
    byModel: ModelUsage[];
    byUser: UserUsage[];
};

export type UsageAnalytics = {
    billingMonth: string;
    availableMonths: string[];
    systemLimit: { mode: 'custom' | 'unlimited'; usd: number };
    month: UsagePeriod & { daily: DailyUsage[] };
    selectedDay: (UsagePeriod & { date: string }) | null;
};

type Metric = 'costUsd' | 'totalTokens' | 'modelCalls' | 'activeUsers';
type RankingMetric = 'totalTokens' | 'costUsd' | 'modelCalls';

const integerFormat = new Intl.NumberFormat('ja-JP');
const compactFormat = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 });

export function formatUsd (value: number) {
    if (value === 0) {
        return '$0.0000';
    }
    if (Math.abs(value) < 0.0001) {
        return '< $0.0001';
    }
    return `$${value.toFixed(value >= 100 ? 2 : 4)}`;
}

function formatDate (date: string) {
    const [, month, day] = date.split('-').map(Number);
    return `${month}/${day}`;
}

function formatMonth (month: string) {
    const [year, value] = month.split('-').map(Number);
    return `${year}年${value}月`;
}

function formatMetric (metric: Metric | RankingMetric, value: number, compact = false) {
    if (metric === 'costUsd') {
        return formatUsd(value);
    }
    const formatted = compact ? compactFormat.format(value) : integerFormat.format(value);
    if (metric === 'totalTokens') {
        return `${formatted} tokens`;
    }
    if (metric === 'modelCalls') {
        return `${formatted} 回`;
    }
    return `${formatted} 人`;
}

function niceMaximum (value: number) {
    if (value <= 0) {
        return 1;
    }
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return ceiling * magnitude;
}

function EmptyChart ({ children }: { children: React.ReactNode }) {
    return (
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center dark:border-white/15 dark:bg-white/[0.025]">
            <p className="!m-0 !text-sm !text-slate-500 dark:!text-slate-400">{children}</p>
        </div>
    );
}

function ToggleGroup<T extends string> ({ label, value, options, onChange }: {
    label: string;
    value: T;
    options: readonly { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={`!m-0 !w-auto whitespace-nowrap !rounded-lg !border-0 !px-3 !py-1.5 !text-xs !font-bold !shadow-none ${value === option.value
                        ? '!bg-white !text-indigo-700 !shadow-sm dark:!bg-slate-700 dark:!text-indigo-200'
                        : '!bg-transparent !text-slate-500 hover:!text-slate-900 dark:!text-slate-400 dark:hover:!text-white'}`}
                    aria-pressed={value === option.value}
                    onClick={() => onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function KpiCard ({ label, value, note, tone = 'indigo' }: {
    label: string;
    value: string;
    note: string;
    tone?: 'indigo' | 'sky' | 'emerald' | 'amber';
}) {
    const border = {
        indigo: 'border-l-indigo-500',
        sky: 'border-l-sky-500',
        emerald: 'border-l-emerald-500',
        amber: 'border-l-amber-500',
    }[tone];
    return (
        <div className={`rounded-2xl border border-l-4 border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70 ${border}`}>
            <p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.1em] !text-slate-500 dark:!text-slate-400">{label}</p>
            <p className="!m-0 mt-2 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">{value}</p>
            <p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">{note}</p>
        </div>
    );
}

export function UsageSummary ({ data }: { data: UsageAnalytics }) {
    const { totals } = data.month;
    const limited = data.systemLimit.mode === 'custom';
    const percent = limited
        ? (data.systemLimit.usd === 0 ? (totals.costUsd > 0 ? 100 : 0) : totals.costUsd / data.systemLimit.usd * 100)
        : null;
    const remaining = limited ? Math.max(0, data.systemLimit.usd - totals.costUsd) : null;
    const overLimit = limited && totals.costUsd >= data.systemLimit.usd;

    return (
        <section aria-labelledby="monthly-summary-heading" className="space-y-4">
            <div>
                <h2 id="monthly-summary-heading" className="!m-0 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">
                    {formatMonth(data.billingMonth)}のサマリー
                </h2>
                <p className="!m-0 mt-2 !text-sm !text-slate-500 dark:!text-slate-400">成功したモデル呼び出しを、課金明細からJST基準で集計しています。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="概算利用額" value={formatUsd(totals.costUsd)} note="全ユーザー・全モデル" tone="indigo" />
                <KpiCard label="処理TOKEN" value={`${integerFormat.format(totals.totalTokens)} tokens`} note={`入力 ${integerFormat.format(totals.inputTokens)} / 出力 ${integerFormat.format(totals.outputTokens)}`} tone="sky" />
                <KpiCard label="モデル呼び出し" value={`${integerFormat.format(totals.modelCalls)} 回`} note={`${integerFormat.format(totals.conversations)} 会話`} tone="emerald" />
                <KpiCard label="利用ユーザー" value={`${integerFormat.format(totals.activeUsers)} 人`} note={`${integerFormat.format(data.month.byModel.length)} モデルを使用`} tone="amber" />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="!m-0 !font-semibold !text-slate-800 dark:!text-slate-100">システム月間予算</p>
                        <p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">{limited ? `${formatUsd(totals.costUsd)} / ${formatUsd(data.systemLimit.usd)}` : '上限なし'}</p>
                    </div>
                    <p className={`!m-0 !text-sm !font-bold tabular-nums ${overLimit ? '!text-rose-600 dark:!text-rose-300' : '!text-slate-700 dark:!text-slate-200'}`}>
                        {limited ? `${Math.min(percent ?? 0, 999).toFixed(1)}%${overLimit ? '・上限到達' : ''}` : '無制限'}
                    </p>
                </div>
                {limited && (
                    <>
                        <div role="meter" aria-label="システム予算の消化率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, percent ?? 0))} className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className={`h-full rounded-full ${overLimit ? 'bg-rose-500' : 'bg-indigo-500 dark:bg-indigo-400'}`} style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
                        </div>
                        <p className="!m-0 mt-2 !text-xs !text-slate-500 dark:!text-slate-400">残額 {formatUsd(remaining ?? 0)}</p>
                    </>
                )}
            </div>
        </section>
    );
}

const TREND_OPTIONS: readonly { value: Metric; label: string }[] = [
    { value: 'costUsd', label: '利用額' },
    { value: 'totalTokens', label: 'TOKEN' },
    { value: 'modelCalls', label: '呼び出し' },
    { value: 'activeUsers', label: '利用者数' },
];

export function DailyTrendChart ({ data, billingMonth, selectedDate }: { data: DailyUsage[]; billingMonth: string; selectedDate: string | null }) {
    // 無料のローカルモデルだけでも利用量を空表示にしない。利用額への切り替えは常に残す。
    const [metric, setMetric] = useState<Metric>(() => (
        data.some((item) => item.costUsd > 0) || !data.some((item) => item.totalTokens > 0)
            ? 'costUsd'
            : 'totalTokens'
    ));
    const uniqueId = useId().replaceAll(':', '');
    const titleId = `daily-trend-title-${uniqueId}`;
    const descriptionId = `daily-trend-description-${uniqueId}`;
    const gradientId = `daily-trend-fill-${uniqueId}`;
    const width = 900;
    const height = 300;
    const margin = { top: 20, right: 24, bottom: 44, left: 72 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maximum = niceMaximum(Math.max(...data.map((item) => item[metric]), 0));
    const points = data.map((item, index) => ({
        item,
        x: margin.left + (data.length <= 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth),
        y: margin.top + plotHeight - item[metric] / maximum * plotHeight,
    }));
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const area = points.length === 0 ? '' : `${line} L ${points.at(-1)?.x} ${margin.top + plotHeight} L ${points[0].x} ${margin.top + plotHeight} Z`;
    const labelIndexes = new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((data.length - 1) * ratio)));
    const total = data.reduce((sum, item) => sum + item[metric], 0);
    const metricLabel = TREND_OPTIONS.find((option) => option.value === metric)?.label ?? '';

    return (
        <section aria-labelledby="daily-trend-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><h2 id="daily-trend-heading" className="!m-0 !text-xl !font-bold !text-slate-950 dark:!text-white">日別の利用推移</h2><p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">{formatMonth(billingMonth)}・JST。指標を切り替えて同じ期間を比較できます。</p></div>
                <ToggleGroup label="日別グラフの指標" value={metric} options={TREND_OPTIONS} onChange={setMetric} />
            </div>
            {total === 0 ? <EmptyChart>この月の{metricLabel}はまだありません。別の指標や月を選択してください。</EmptyChart> : (
                <div className="overflow-x-auto">
                    <svg className="h-auto w-full min-w-[680px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
                        <title id={titleId}>{formatMonth(billingMonth)}の日別{metricLabel}</title>
                        <desc id={descriptionId}>1日から月末または本日までの{metricLabel}を折れ線で示しています。</desc>
                        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" /></linearGradient></defs>
                        {[0, 0.5, 1].map((ratio) => {
                            const y = margin.top + plotHeight * (1 - ratio);
                            return <g key={ratio}><line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-700" /><text x={margin.left - 12} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">{formatMetric(metric, maximum * ratio, true)}</text></g>;
                        })}
                        <path d={area} fill={`url(#${gradientId})`} />
                        <path d={line} fill="none" className="stroke-indigo-500 dark:stroke-indigo-400" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                        {points.map(({ item, x, y }, index) => (
                            <g key={item.date}>
                                <circle cx={x} cy={y} r={item.date === selectedDate ? 6 : 3.5} className={item.date === selectedDate ? 'fill-amber-400 stroke-white dark:stroke-slate-900' : 'fill-indigo-500 stroke-white dark:fill-indigo-400 dark:stroke-slate-900'} strokeWidth="2"><title>{formatDate(item.date)}: {formatMetric(metric, item[metric])}</title></circle>
                                {labelIndexes.has(index) && <text x={x} y={height - 16} textAnchor="middle" className="fill-slate-500 text-[11px] dark:fill-slate-400">{formatDate(item.date)}</text>}
                            </g>
                        ))}
                    </svg>
                </div>
            )}
            <details className="!m-0 mt-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
                <summary className="cursor-pointer !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">日別の正確な値</summary>
                <div className="mt-3 max-h-72 overflow-auto"><table className="!m-0 !text-sm"><thead><tr><th>日付</th><th className="text-right">利用額</th><th className="text-right">TOKEN</th><th className="text-right">呼び出し</th><th className="text-right">利用者</th></tr></thead><tbody>{data.map((item) => <tr key={item.date} className={item.date === selectedDate ? 'bg-amber-50 dark:bg-amber-400/10' : ''}><td>{item.date}</td><td className="text-right tabular-nums">{formatUsd(item.costUsd)}</td><td className="text-right tabular-nums">{integerFormat.format(item.totalTokens)}</td><td className="text-right tabular-nums">{integerFormat.format(item.modelCalls)}</td><td className="text-right tabular-nums">{integerFormat.format(item.activeUsers)}</td></tr>)}</tbody></table></div>
            </details>
        </section>
    );
}

const TOKEN_SEGMENTS = [
    { key: 'inputTokens', label: '入力', color: 'bg-indigo-500 dark:bg-indigo-400' },
    { key: 'outputTokens', label: '出力', color: 'bg-sky-500 dark:bg-sky-400' },
    { key: 'cacheReadTokens', label: 'キャッシュ読込', color: 'bg-emerald-500 dark:bg-emerald-400' },
    { key: 'cacheWriteTokens', label: 'キャッシュ書込', color: 'bg-amber-500 dark:bg-amber-400' },
] as const;

export function ModelTokenChart ({ data }: { data: ModelUsage[] }) {
    const sorted = [...data].sort((a, b) => b.totalTokens - a.totalTokens || b.modelCalls - a.modelCalls);
    const visible = sorted.slice(0, 8);
    const maximum = Math.max(...visible.map((item) => item.totalTokens), 0);
    return (
        <section aria-labelledby="model-token-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
            <div className="mb-5"><h2 id="model-token-heading" className="!m-0 !text-xl !font-bold !text-slate-950 dark:!text-white">モデル別のTOKEN構成</h2><p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">棒の長さが処理TOKEN総数、色の内訳が入出力・キャッシュを表します。</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="TOKEN種別の凡例">{TOKEN_SEGMENTS.map((segment) => <span key={segment.key} className="inline-flex items-center gap-1.5 !text-xs !text-slate-600 dark:!text-slate-300"><span className={`size-2.5 rounded-sm ${segment.color}`} aria-hidden="true" />{segment.label}</span>)}</div></div>
            {visible.length === 0 ? <EmptyChart>この月のモデル利用はありません。</EmptyChart> : (
                <div role="img" aria-label={visible.map((item) => `${item.model}、${item.totalTokens} tokens`).join('。')} className="space-y-5">
                    {visible.map((item) => <div key={`${item.provider}:${item.model}`}><div className="mb-1.5 flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="!m-0 break-words !font-semibold !text-slate-800 dark:!text-slate-100">{item.model}</p><p className="!m-0 !text-xs !text-slate-500 dark:!text-slate-400">{item.provider}</p></div><p className="!m-0 shrink-0 text-right tabular-nums !font-bold !text-slate-800 dark:!text-slate-100">{integerFormat.format(item.totalTokens)}<span className="block !text-xs !font-normal !text-slate-500 dark:!text-slate-400">tokens · {item.modelCalls}回 · {formatUsd(item.costUsd)}</span></p></div><div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">{TOKEN_SEGMENTS.map((segment) => <span key={segment.key} className={segment.color} style={{ width: maximum === 0 ? '0%' : `${item[segment.key] / maximum * 100}%` }} title={`${segment.label}: ${integerFormat.format(item[segment.key])}`} />)}</div></div>)}
                    {sorted.length > visible.length && <p className="!m-0 !text-xs !text-slate-500 dark:!text-slate-400">TOKEN数の多い上位8モデルを表示しています（全{sorted.length}モデル）。</p>}
                </div>
            )}
            {data.length > 0 && (
                <details className="!m-0 mt-5 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
                    <summary className="cursor-pointer !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">
                        全モデルのTOKEN内訳（{data.length}モデル）
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                        <table className="!m-0 min-w-[860px] !text-sm">
                            <thead>
                                <tr>
                                    <th>モデル</th>
                                    <th className="text-right">合計</th>
                                    <th className="text-right">入力</th>
                                    <th className="text-right">出力</th>
                                    <th className="text-right">キャッシュ読込</th>
                                    <th className="text-right">キャッシュ書込</th>
                                    <th className="text-right">呼び出し</th>
                                    <th className="text-right">利用額</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((item) => (
                                    <tr key={`${item.provider}:${item.model}`}>
                                        <td><span className="block font-semibold">{item.model}</span><span className="text-xs text-slate-500">{item.provider}</span></td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.totalTokens)}</td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.inputTokens)}</td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.outputTokens)}</td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.cacheReadTokens)}</td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.cacheWriteTokens)}</td>
                                        <td className="text-right tabular-nums">{integerFormat.format(item.modelCalls)}</td>
                                        <td className="text-right tabular-nums">{formatUsd(item.costUsd)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}
        </section>
    );
}

const RANKING_OPTIONS: readonly { value: RankingMetric; label: string }[] = [
    { value: 'totalTokens', label: 'TOKEN' },
    { value: 'costUsd', label: '利用額' },
    { value: 'modelCalls', label: '呼び出し' },
];

export function UserUsageChart ({ data }: { data: UserUsage[] }) {
    const [metric, setMetric] = useState<RankingMetric>('totalTokens');
    const sorted = [...data].sort((a, b) => b[metric] - a[metric] || b.modelCalls - a.modelCalls);
    const visible = sorted.slice(0, 10);
    const maximum = Math.max(...visible.map((item) => item[metric]), 0);
    return (
        <section aria-labelledby="user-usage-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="user-usage-heading" className="!m-0 !text-xl !font-bold !text-slate-950 dark:!text-white">ユーザー別の利用量</h2><p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">誰がどれくらい利用しているかを、指標ごとに順位付けします。</p></div><ToggleGroup label="ユーザーランキングの指標" value={metric} options={RANKING_OPTIONS} onChange={setMetric} /></div>
            {visible.length === 0 ? <EmptyChart>この月に生成AI機能を利用したユーザーはいません。</EmptyChart> : (
                <div role="img" aria-label={visible.map((item) => `${item.username}、${formatMetric(metric, item[metric])}`).join('。')} className="space-y-4">{visible.map((item, index) => <div key={item.userId} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2"><span className="pt-0.5 text-center !text-sm !font-bold !text-slate-400">{index + 1}</span><div><div className="mb-1 flex items-center justify-between gap-3"><p className="!m-0 min-w-0 truncate !text-sm !font-semibold !text-slate-800 dark:!text-slate-100" title={item.username}>{item.username}</p><p className="!m-0 shrink-0 tabular-nums !text-sm !font-bold !text-slate-800 dark:!text-slate-100">{formatMetric(metric, item[metric])}</p></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500 dark:bg-violet-400" style={{ width: maximum === 0 ? '0%' : `${Math.max(2, item[metric] / maximum * 100)}%` }} /></div><p className="!m-0 mt-1 !text-[11px] !text-slate-500 dark:!text-slate-400">{integerFormat.format(item.totalTokens)} tokens · {item.modelCalls}回 · {item.conversations}会話 · {formatUsd(item.costUsd)}</p></div></div>)}</div>
            )}
            {data.length > 0 && <details className="!m-0 mt-5 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10"><summary className="cursor-pointer !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">全ユーザーの正確な値（{data.length}人）</summary><div className="mt-3 overflow-x-auto"><table className="!m-0 min-w-[720px] !text-sm"><thead><tr><th>ユーザー</th><th className="text-right">TOKEN</th><th className="text-right">利用額</th><th className="text-right">呼び出し</th><th className="text-right">会話</th><th className="text-right">モデル数</th></tr></thead><tbody>{sorted.map((item) => <tr key={item.userId}><td>{item.username}</td><td className="text-right tabular-nums">{integerFormat.format(item.totalTokens)}</td><td className="text-right tabular-nums">{formatUsd(item.costUsd)}</td><td className="text-right tabular-nums">{integerFormat.format(item.modelCalls)}</td><td className="text-right tabular-nums">{integerFormat.format(item.conversations)}</td><td className="text-right tabular-nums">{integerFormat.format(item.modelCount)}</td></tr>)}</tbody></table></div></details>}
        </section>
    );
}

export function SelectedDaySummary ({ day }: { day: UsageAnalytics['selectedDay'] }) {
    if (day == null) {
        return null;
    }
    return (
        <section aria-labelledby="selected-day-heading" className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 dark:border-indigo-400/20 dark:bg-indigo-400/[0.05]">
            <div><p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.14em] !text-indigo-600 dark:!text-indigo-300">Selected day</p><h2 id="selected-day-heading" className="!m-0 mt-1 !text-2xl !font-bold !text-slate-950 dark:!text-white">{day.date} の内訳</h2></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="利用額" value={formatUsd(day.totals.costUsd)} note="選択日合計" /><KpiCard label="TOKEN" value={integerFormat.format(day.totals.totalTokens)} note={`入力 ${integerFormat.format(day.totals.inputTokens)} / 出力 ${integerFormat.format(day.totals.outputTokens)}`} tone="sky" /><KpiCard label="呼び出し" value={`${integerFormat.format(day.totals.modelCalls)} 回`} note={`${day.totals.conversations} 会話`} tone="emerald" /><KpiCard label="利用ユーザー" value={`${integerFormat.format(day.totals.activeUsers)} 人`} note={`${day.byModel.length} モデル`} tone="amber" /></div>
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900/70"><h3 className="!m-0 !text-base !font-bold !text-slate-900 dark:!text-white">モデル別</h3><div className="mt-3 overflow-x-auto"><table className="!m-0 !text-sm"><thead><tr><th>モデル</th><th className="text-right">TOKEN</th><th className="text-right">回数</th></tr></thead><tbody>{day.byModel.length === 0 ? <tr><td colSpan={3} className="text-center text-slate-500">利用なし</td></tr> : day.byModel.map((item) => <tr key={`${item.provider}:${item.model}`}><td><span className="block font-semibold">{item.model}</span><span className="text-xs text-slate-500">{item.provider}</span></td><td className="text-right tabular-nums">{integerFormat.format(item.totalTokens)}</td><td className="text-right tabular-nums">{item.modelCalls}</td></tr>)}</tbody></table></div></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900/70"><h3 className="!m-0 !text-base !font-bold !text-slate-900 dark:!text-white">ユーザー別</h3><div className="mt-3 overflow-x-auto"><table className="!m-0 !text-sm"><thead><tr><th>ユーザー</th><th className="text-right">TOKEN</th><th className="text-right">回数</th></tr></thead><tbody>{day.byUser.length === 0 ? <tr><td colSpan={3} className="text-center text-slate-500">利用なし</td></tr> : day.byUser.map((item) => <tr key={item.userId}><td className="font-semibold">{item.username}</td><td className="text-right tabular-nums">{integerFormat.format(item.totalTokens)}</td><td className="text-right tabular-nums">{item.modelCalls}</td></tr>)}</tbody></table></div></div>
            </div>
        </section>
    );
}
