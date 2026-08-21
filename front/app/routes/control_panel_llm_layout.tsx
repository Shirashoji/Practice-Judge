import type { Route } from "./+types/control_panel_llm_layout";
import { Link, NavLink, Outlet, useOutletContext } from 'react-router';
import type { AppOutletContext } from '../types';

const NAV_ITEMS = [
    { to: '/control-panel/llm', label: '全体設定', end: true },
    { to: '/control-panel/llm/usage', label: '利用分析', end: true },
    { to: '/control-panel/llm/limits', label: 'ユーザー別上限', end: true },
    { to: '/control-panel/llm/violations', label: '警告・違反', end: true },
    { to: '/control-panel/llm/conversations', label: '会話監査', end: false },
];

export default function ControlPanelLlmLayout ({}: Route.ComponentProps) {
    const outletContext = useOutletContext<AppOutletContext>();

    return (
        <div className="llm-admin min-h-[70vh] bg-slate-50/80 py-6 text-slate-800 dark:bg-slate-950/60 dark:text-slate-100 md:py-9">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
                <header className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/20">
                    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7 sm:py-6">
                        <div className="min-w-0">
                            <Link
                                to="/control-panel"
                                className="inline-flex items-center gap-1 text-xs font-semibold !text-slate-500 !no-underline transition hover:!text-indigo-600 dark:!text-slate-400 dark:hover:!text-indigo-300"
                            >
                                <span aria-hidden="true">←</span>
                                コントロールパネル
                            </Link>
                            <p className="!mb-0 !mt-4 text-[11px] font-bold uppercase tracking-[0.18em] !text-indigo-600 dark:!text-indigo-300">
                                AI administration
                            </p>
                            <p className="!mb-0 !mt-1 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white sm:!text-3xl">
                                AI学習支援の管理
                            </p>
                        </div>
                        <p className="!m-0 max-w-xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                            利用状況を分析し、上限とモデルの設定、ガードレール、共有された会話を管理します。
                        </p>
                    </div>

                    <nav aria-label="AI学習支援の管理メニュー" className="overflow-x-auto border-t border-slate-200 px-3 dark:border-white/10 sm:px-5">
                        <div className="flex min-w-max gap-1 py-2">
                            {NAV_ITEMS.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    end={item.end}
                                    className={({ isActive }) => (
                                        `rounded-lg px-3.5 py-2 text-sm font-semibold !no-underline transition ${isActive
                                            ? '!bg-indigo-600 !text-white shadow-sm shadow-indigo-500/20 dark:!bg-indigo-500'
                                            : '!text-slate-600 hover:bg-slate-100 hover:!text-slate-950 dark:!text-slate-300 dark:hover:bg-white/5 dark:hover:!text-white'}`
                                    )}
                                >
                                    {item.label}
                                </NavLink>
                            ))}
                        </div>
                    </nav>
                </header>

                <Outlet context={outletContext} />
            </div>
        </div>
    );
}
