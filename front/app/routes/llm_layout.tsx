import { Link, Navigate, Outlet } from 'react-router';
import { BASEURL } from '../backend_url';
import { useColorMode } from '../contexts';
import { useEffect } from 'react';

export async function clientLoader () {
    const res = await fetch(new URL('/api/auth/me', BASEURL).href, {
        credentials: 'include',
    });
    return await res.json();
}

export default function LlmLayout ({ loaderData }: any) {
    const colorMode = useColorMode();

    useEffect(() => {
        const previousHtmlOverflow = document.documentElement.style.overflow;
        const previousBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        return () => {
            document.documentElement.style.overflow = previousHtmlOverflow;
            document.body.style.overflow = previousBodyOverflow;
        };
    }, []);

    if (!loaderData.login) {
        return <Navigate to="/login" />;
    }

    return (
        <div className="llm-workspace flex h-dvh max-h-dvh flex-col overflow-hidden bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/95 md:px-7">
                <div className="flex min-w-0 items-center gap-3">
                    <Link to="/" className="flex shrink-0 items-center gap-3 !text-slate-900 !no-underline dark:!text-slate-100">
                        <span className="grid size-10 place-items-center rounded-xl border border-indigo-300 bg-indigo-50 shadow-lg shadow-indigo-200/50 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:shadow-indigo-950/40">
                            <img src="/favicon.ico" alt="" className="size-7 [image-rendering:pixelated]" />
                        </span>
                        <span className="hidden sm:block">
                            <span className="block text-sm font-bold leading-tight tracking-tight">Practice Judge</span>
                            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">AI Tutor</span>
                        </span>
                    </Link>
                    <span className="hidden h-7 w-px bg-slate-200 dark:bg-white/10 md:block" />
                    <span className="hidden text-xs font-medium text-slate-500 dark:text-slate-400 md:block">学習ワークスペース</span>
                </div>

                <nav className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => colorMode?.setColorMode(colorMode.colorMode === 'light' ? 'dark' : 'light')}
                        className="!m-0 grid !size-9 place-items-center !rounded-lg !border-0 !bg-slate-100 !p-0 !text-base !text-slate-600 !shadow-none hover:!bg-slate-200 dark:!bg-white/5 dark:!text-slate-300 dark:hover:!bg-white/10"
                        aria-label={colorMode?.colorMode === 'light' ? 'ダークモードに切り替える' : 'ライトモードに切り替える'}
                    >
                        <span aria-hidden="true">{colorMode?.colorMode === 'light' ? '☾' : '☀'}</span>
                    </button>
                    <Link to="/problems" className="rounded-lg px-3 py-2 text-sm font-medium !text-slate-600 !no-underline transition hover:bg-slate-100 hover:!text-slate-950 dark:!text-slate-300 dark:hover:bg-white/5 dark:hover:!text-white">
                        問題一覧
                    </Link>
                    <Link to="/settings" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium !text-slate-700 !no-underline transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:!text-slate-200 dark:hover:bg-white/10">
                        設定
                    </Link>
                </nav>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">
                <Outlet context={{ loginInfo: loaderData }} />
            </div>

            <footer className="flex h-9 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[11px] text-slate-500 dark:border-white/10 dark:bg-slate-950 md:px-7">
                <span>Practice Judge AI Tutor</span>
                <Link to="/privacy-policy" className="!text-slate-500 !no-underline hover:!text-slate-300">プライバシー</Link>
            </footer>
        </div>
    );
}
