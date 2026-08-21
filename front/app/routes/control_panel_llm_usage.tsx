import type { Route } from "./+types/control_panel_llm_usage";
import { Link, useLocation, useNavigate, useNavigation } from 'react-router';
import { BASEURL } from '../backend_url';
import {
    DailyTrendChart,
    ModelTokenChart,
    SelectedDaySummary,
    UsageSummary,
    UserUsageChart,
} from '../llm/admin/UsageCharts';
import type { UsageAnalytics } from '../llm/admin/UsageCharts';

export function meta ({}: Route.MetaArgs) {
    return [{ title: 'AI学習支援の利用分析 - Practice Judge' }];
}

// GET /api/admin/llm/usage の応答（api/admin_llm.js と対応）。
// 金額・TOKEN・呼び出し回数はすべてllm_usageの成功したモデル呼び出しを集計する。
export async function clientLoader ({ request }: Route.ClientLoaderArgs) {
    const pageUrl = new URL(request.url);
    const apiUrl = new URL('/api/admin/llm/usage', BASEURL);
    const month = pageUrl.searchParams.get('month');
    const date = pageUrl.searchParams.get('date');
    if (month != null) {
        apiUrl.searchParams.set('month', month);
    }
    if (date != null) {
        apiUrl.searchParams.set('date', date);
    }

    const response = await fetch(apiUrl.href, { credentials: 'include' });
    if (!response.ok) {
        let payload: { error?: string } = {};
        try {
            payload = await response.json();
        }
        catch (error) {
            // JSONでない障害時も、分析画面の取得失敗として扱えるようにする。
        }
        throw new Error(payload.error ?? '利用状況を取得できませんでした。');
    }
    return await response.json() as UsageAnalytics;
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    return (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-400/20 dark:bg-rose-400/10">
            <h1 className="!m-0 !text-xl !font-bold !text-rose-900 dark:!text-rose-100">利用分析を表示できません</h1>
            <p className="!m-0 mt-2 !text-sm !text-rose-700 dark:!text-rose-200">{message}</p>
        </section>
    );
}

const selectClass = "!m-0 !rounded-xl !border-slate-300 !bg-white !px-3 !py-2 !text-sm !text-slate-800 !shadow-none focus:!border-indigo-500 focus:!ring-2 focus:!ring-indigo-500/20 dark:!border-white/15 dark:!bg-slate-950/70 dark:!text-slate-100";

export default function ControlPanelLlmUsage ({ loaderData }: Route.ComponentProps) {
    const data = loaderData;
    const navigate = useNavigate();
    const location = useLocation();
    const navigation = useNavigation();
    const selectedDate = data.selectedDay?.date ?? null;
    const lastDate = data.month.daily.at(-1)?.date ?? `${data.billingMonth}-01`;

    function updateFilter (name: 'month' | 'date', value: string) {
        const params = new URLSearchParams(location.search);
        if (value === '') {
            params.delete(name);
        }
        else {
            params.set(name, value);
        }
        if (name === 'month') {
            params.delete('date');
        }
        void navigate({ pathname: location.pathname, search: params.toString() });
    }

    return (
        <main className="space-y-8" aria-busy={navigation.state !== 'idle'}>
            <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.16em] !text-indigo-600 dark:!text-indigo-300">Usage analytics</p>
                    <h1 className="!m-0 mt-1 !text-3xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">利用分析</h1>
                    <p className="!m-0 mt-2 max-w-3xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                        ユーザー・モデル・日付ごとに、概算利用額、TOKEN数、呼び出し回数を確認します。設定変更は
                        <Link className="font-semibold !text-indigo-600 dark:!text-indigo-300" to="/control-panel/llm">全体設定</Link>
                        から行います。
                    </p>
                </div>
                {navigation.state !== 'idle' && <p role="status" className="!m-0 !text-sm !font-semibold !text-indigo-600 dark:!text-indigo-300">集計を更新中…</p>}
            </header>

            <section aria-label="集計期間" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                <div className="grid gap-4 md:grid-cols-[minmax(180px,240px)_minmax(190px,260px)_1fr] md:items-end">
                    <label className="!m-0 !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">
                        集計月
                        <select className={`${selectClass} mt-2 !w-full !pr-8`} value={data.billingMonth} onChange={(event) => updateFilter('month', event.target.value)}>
                            {data.availableMonths.map((month) => <option key={month} value={month}>{month.replace('-', '年')}月</option>)}
                        </select>
                    </label>
                    <label className="!m-0 !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">
                        深掘りする日（JST）
                        <input className={`${selectClass} mt-2 !w-full`} type="date" min={`${data.billingMonth}-01`} max={lastDate} value={selectedDate ?? ''} onChange={(event) => updateFilter('date', event.target.value)} />
                    </label>
                    <div className="flex flex-wrap items-center gap-3 md:justify-end">
                        {selectedDate == null ? (
                            <p className="!m-0 !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">日付を選ぶと、その日のモデル別・ユーザー別内訳を表示します。</p>
                        ) : (
                            <button type="button" className="!m-0 !w-auto !rounded-xl !border !border-slate-300 !bg-white !px-4 !py-2 !text-sm !font-bold !text-slate-700 !shadow-none hover:!bg-slate-50 dark:!border-white/15 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700" onClick={() => updateFilter('date', '')}>日別選択を解除</button>
                        )}
                    </div>
                </div>
            </section>

            <UsageSummary data={data} />
            <DailyTrendChart data={data.month.daily} billingMonth={data.billingMonth} selectedDate={selectedDate} />
            <SelectedDaySummary day={data.selectedDay} />
            <div className="grid gap-6 xl:grid-cols-2">
                <ModelTokenChart data={data.month.byModel} />
                <UserUsageChart data={data.month.byUser} />
            </div>
        </main>
    );
}
