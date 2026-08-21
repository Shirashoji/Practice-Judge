// AI学習支援の全体設定。
// 共有時／非共有時それぞれの無料枠、システム全体の上限、モデルの割り当てを設定する。

import type { Route } from "./+types/control_panel_llm";
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';

export function meta () {
    return [{ title: 'AI学習支援の設定 - Practice Judge' }];
}

type LimitMode = 'custom' | 'unlimited';
type LimitSetting = { mode: LimitMode; usd: number };
type EditableLimit = { mode: LimitMode; usd: number | string };

// GET /api/admin/llm/settings の応答（api/admin_llm.js と対応）。
type AdminLlmSettings = {
    provider: string;
    providers: {
        id: string;
        label: string;
        configured: boolean;
        // 排他の経路（Claude・Gemini）だけ true / false が入る
        active?: boolean;
        switchHint?: string;
        detail?: string;
    }[];
    configured: boolean;
    envDefaultModel: string;
    envDefaultModelAvailable: boolean;
    limits: Record<'shared' | 'private' | 'system', LimitSetting>;
    modelByDifficulty: Record<string, string>;
    allowedModels: string[];
    knownModels: {
        model: string;
        family: string;
        provider: string;
        input: number;
        output: number;
        // 経路が未設定のモデルは選ばせない
        available: boolean;
    }[];
};

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/settings', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('設定を取得できませんでした。');
    }
    return await res.json() as AdminLlmSettings;
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    return (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-400/20 dark:bg-rose-400/10">
            <h1 className="!m-0 !text-xl !font-bold !text-rose-900 dark:!text-rose-100">設定を表示できません</h1>
            <p className="!m-0 mt-2 !text-sm !text-rose-700 dark:!text-rose-200">{message}</p>
        </section>
    );
}

// モデル一覧の見出し。系列ごとに呼び出し経路が違うので、まとめて出すと選び間違える。
const FAMILIES: readonly (readonly [string, string])[] = [
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['openai', 'OpenAI'],
    ['local', 'ローカルLLM'],
];

const inputClass = "!m-0 !rounded-xl !border-slate-300 !bg-white !px-3 !py-2 !text-sm !text-slate-800 !shadow-none focus:!border-indigo-500 focus:!ring-2 focus:!ring-indigo-500/20 dark:!border-white/15 dark:!bg-slate-950/70 dark:!text-slate-100";

function describePrice (model: AdminLlmSettings['knownModels'][number]) {
    if (model.family === 'local') {
        return 'API課金なし（利用額は0として計上）';
    }
    return `入力 $${model.input} / 出力 $${model.output} per 1M tokens`;
}

function StatusBadge ({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${ok
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20'
            : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/20'}`}
        >
            <span className={`size-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden="true" />
            {children}
        </span>
    );
}

// モードと金額は一体で保存されるため、別々の入力に見えないカードとしてまとめる。
function LimitEditor ({ label, hint, value, onChange, tone = 'indigo' }: {
    label: string;
    hint?: string;
    value: EditableLimit;
    onChange: (value: EditableLimit) => void;
    tone?: 'indigo' | 'sky' | 'amber';
}) {
    const radioName = useId();
    const selectedTone = {
        indigo: 'border-indigo-500 bg-indigo-50/70 ring-indigo-500/10 dark:border-indigo-400 dark:bg-indigo-400/10',
        sky: 'border-sky-500 bg-sky-50/70 ring-sky-500/10 dark:border-sky-400 dark:bg-sky-400/10',
        amber: 'border-amber-500 bg-amber-50/70 ring-amber-500/10 dark:border-amber-400 dark:bg-amber-400/10',
    }[tone];

    return (
        <fieldset className="!m-0 !min-w-0 !rounded-2xl !border !border-slate-200 !bg-white !p-5 !shadow-sm dark:!border-white/10 dark:!bg-slate-900/70">
            <legend className="!mb-0 !px-1 !text-base !font-bold !text-slate-900 dark:!text-white">{label}</legend>
            {hint && <p className="!m-0 mb-4 !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">{hint}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
                <label className={`!m-0 flex cursor-pointer items-center gap-3 rounded-xl border p-3 ring-2 ring-transparent transition ${value.mode === 'custom' ? selectedTone : 'border-slate-200 bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.025]'}`}>
                    <input
                        className="!m-0 !size-4 !shrink-0"
                        type="radio"
                        name={radioName}
                        checked={value.mode === 'custom'}
                        onChange={() => onChange({ ...value, mode: 'custom' })}
                    />
                    <span className="!text-sm !font-semibold !text-slate-700 dark:!text-slate-200">金額を指定</span>
                </label>
                <label className={`!m-0 flex cursor-pointer items-center gap-3 rounded-xl border p-3 ring-2 ring-transparent transition ${value.mode === 'unlimited' ? selectedTone : 'border-slate-200 bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.025]'}`}>
                    <input
                        className="!m-0 !size-4 !shrink-0"
                        type="radio"
                        name={radioName}
                        checked={value.mode === 'unlimited'}
                        onChange={() => onChange({ ...value, mode: 'unlimited' })}
                    />
                    <span className="!text-sm !font-semibold !text-slate-700 dark:!text-slate-200">無制限</span>
                </label>
            </div>
            {value.mode === 'custom' && (
                <label className="!m-0 mt-4 block !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">
                    毎月の上限（USD）
                    <span className="relative mt-2 block">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">$</span>
                        <input
                            className={`${inputClass} !pl-7`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={value.usd}
                            onChange={(event) => onChange({ ...value, usd: event.target.value })}
                        />
                    </span>
                </label>
            )}
        </fieldset>
    );
}

export default function ControlPanelLlm ({ loaderData }: Route.ComponentProps) {
    const data = loaderData;
    const [shared, setShared] = useState<EditableLimit>(data.limits.shared);
    const [priv, setPriv] = useState<EditableLimit>(data.limits.private);
    const [system, setSystem] = useState<EditableLimit>(data.limits.system);
    const [byDifficulty, setByDifficulty] = useState(data.modelByDifficulty);
    const [allowed, setAllowed] = useState(data.allowedModels);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

    async function save () {
        setSaving(true);
        setResult(null);
        try {
            const res = await fetch(new URL('/api/admin/llm/settings', BASEURL).href, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    default_shared_limit_mode: shared.mode,
                    default_shared_limit_usd: shared.usd,
                    default_private_limit_mode: priv.mode,
                    default_private_limit_usd: priv.usd,
                    system_limit_mode: system.mode,
                    system_monthly_limit_usd: system.usd,
                    model_by_difficulty: byDifficulty,
                    allowed_models: allowed,
                }),
            });
            if (res.ok) {
                setResult({ kind: 'success', message: '設定を保存しました。' });
            }
            else {
                let payload: { error?: string } = {};
                try {
                    payload = await res.json();
                }
                catch (error) {
                    // 本文が無いエラーでも、管理者には保存失敗を伝える必要がある。
                }
                setResult({ kind: 'error', message: payload.error ?? '保存に失敗しました。' });
            }
        }
        catch (error) {
            setResult({ kind: 'error', message: '通信に失敗しました。時間をおいて再度お試しください。' });
        }
        finally {
            setSaving(false);
        }
    }

    function toggleAllowed (model: string) {
        setAllowed((previous) => (
            previous.includes(model) ? previous.filter((item) => item !== model) : [...previous, model]
        ));
    }

    return (
        <main className="space-y-10">
            <header>
                <p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.16em] !text-indigo-600 dark:!text-indigo-300">Configuration</p>
                <h1 className="!m-0 mt-1 !text-3xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">全体設定</h1>
                <p className="!m-0 mt-2 max-w-3xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                    AI学習支援の呼び出し経路、予算、問題難易度ごとのモデルを管理します。
                </p>
            </header>

            <section aria-labelledby="provider-heading" className="space-y-4">
                <div>
                    <h2 id="provider-heading" className="!m-0 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">稼働状況</h2>
                    <p className="!m-0 mt-2 !text-sm !text-slate-500 dark:!text-slate-400">環境変数で構成した各プロバイダの接続可否です。</p>
                </div>
                <div className="space-y-3">
                    {data.providers.map((provider) => (
                        <div key={provider.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70 md:grid-cols-[minmax(190px,260px)_minmax(0,1fr)] md:items-start md:gap-6">
                            <div className="flex flex-wrap items-center justify-between gap-3 md:block">
                                <h3 className="!m-0 !text-base !font-bold !text-slate-900 dark:!text-white">{provider.label}</h3>
                                <span className="md:mt-2 md:inline-flex"><StatusBadge ok={provider.configured}>{provider.configured ? '設定済み' : '未設定'}</StatusBadge></span>
                            </div>
                            <div className="min-w-0">
                                {provider.active != null && (
                                    <p className="!m-0 !text-sm !font-semibold !text-slate-700 dark:!text-slate-200">
                                        {provider.active ? '現在使用する経路' : `現在は未使用${provider.switchHint ? `（${provider.switchHint}）` : ''}`}
                                    </p>
                                )}
                                {provider.detail && <p className={`!m-0 !text-sm !leading-6 !text-slate-500 dark:!text-slate-400 ${provider.active != null ? 'mt-1.5' : ''}`}>{provider.detail}</p>}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                        <div>
                            <p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.12em] !text-slate-500 dark:!text-slate-400">Feature status</p>
                            <p className="!m-0 mt-1 !font-bold !text-slate-900 dark:!text-white">AI学習支援</p>
                        </div>
                        <StatusBadge ok={data.configured}>{data.configured ? '有効' : '呼び出せる経路なし'}</StatusBadge>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                        <p className="!m-0 !text-xs !font-bold uppercase !tracking-[0.12em] !text-slate-500 dark:!text-slate-400">Environment default</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <code className="rounded-md bg-slate-100 px-2 py-1 !text-sm !font-semibold !text-slate-800 dark:bg-slate-800 dark:!text-slate-100">{data.envDefaultModel}</code>
                            {!data.envDefaultModelAvailable && <StatusBadge ok={false}>経路未設定</StatusBadge>}
                        </div>
                    </div>
                </div>
            </section>

            <section aria-labelledby="limits-heading" className="space-y-4">
                <div>
                    <h2 id="limits-heading" className="!m-0 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">無料枠と上限</h2>
                    <p className="!m-0 mt-2 max-w-4xl !text-sm !leading-6 !text-slate-500 dark:!text-slate-400">
                        会話共有への同意状況に応じて既定枠を分けられます。個別の例外は
                        <Link className="font-semibold !text-indigo-600 dark:!text-indigo-300" to="/control-panel/llm/limits">ユーザー別上限</Link>
                        から設定します。
                    </p>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                    <LimitEditor
                        label="会話を共有する場合"
                        hint="管理者の閲覧対象になる代わりに、広い枠を割り当てる運用向けです。"
                        value={shared}
                        onChange={setShared}
                        tone="indigo"
                    />
                    <LimitEditor
                        label="会話を共有しない場合"
                        hint="ログは保存しますが、違反がない限り管理者の日常的な閲覧対象にはしません。"
                        value={priv}
                        onChange={setPriv}
                        tone="sky"
                    />
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-400/[0.06]">
                    <p className="!m-0 !text-sm !font-semibold !text-amber-900 dark:!text-amber-100">システム全体の上限は、個別設定より優先されます。</p>
                    <p className="!m-0 mt-1 !text-xs !leading-5 !text-amber-800 dark:!text-amber-200">個人が無制限でも、ここに達すると全ユーザーの利用を停止します。</p>
                </div>
                <LimitEditor label="全ユーザー合計" value={system} onChange={setSystem} tone="amber" />
            </section>

            <section aria-labelledby="models-heading" className="space-y-5">
                <div>
                    <h2 id="models-heading" className="!m-0 !text-2xl !font-bold !tracking-tight !text-slate-950 dark:!text-white">モデルの割り当て</h2>
                    <p className="!m-0 mt-2 !text-sm !text-slate-500 dark:!text-slate-400">「おまかせ」で使用する既定モデルと、ユーザーが明示的に選べるモデルを管理します。</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                    <div className="mb-4">
                        <h3 className="!m-0 !text-lg !font-bold !text-slate-900 dark:!text-white">難易度ごとの既定モデル</h3>
                        <p className="!m-0 mt-1 !text-xs !text-slate-500 dark:!text-slate-400">易しい問題に必要以上に高価なモデルを割り当てないための設定です。</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        {[1, 2, 3, 4, 5].map((level) => (
                            <label key={level} className="!m-0 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/[0.025]">
                                <span className="mb-2 flex items-center justify-between gap-2">
                                    <span className="!text-sm !font-bold !text-slate-800 dark:!text-slate-100">難易度 {level}</span>
                                    <span className="text-xs tracking-tighter text-amber-500" aria-label={`星${level}個`}>{'★'.repeat(level)}</span>
                                </span>
                                <select
                                    className={`${inputClass} !w-full !pr-8`}
                                    value={byDifficulty[level] ?? ''}
                                    onChange={(event) => setByDifficulty({ ...byDifficulty, [level]: event.target.value })}
                                >
                                    <option value="">envの既定</option>
                                    {data.knownModels.map((model) => (
                                        <option key={model.model} value={model.model}>
                                            {model.model}{model.available ? '' : '（経路未設定）'}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <h3 className="!m-0 !text-lg !font-bold !text-slate-900 dark:!text-white">ユーザーが選べるモデル</h3>
                        <p className="!m-0 mt-1 max-w-4xl !text-xs !leading-5 !text-slate-500 dark:!text-slate-400">
                            単価表にあるモデルだけを許可できます。経路が未設定のモデルは、許可してもユーザーの選択肢には表示されません。
                        </p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {FAMILIES.map(([family, label]) => {
                            const models = data.knownModels.filter((model) => model.family === family);
                            if (models.length === 0) {
                                return null;
                            }
                            return (
                                <fieldset key={family} className="!m-0 !rounded-2xl !border !border-slate-200 !bg-white !p-5 !shadow-sm dark:!border-white/10 dark:!bg-slate-900/70">
                                    <legend className="!mb-0 !px-1 !text-base !font-bold !text-slate-900 dark:!text-white">{label}</legend>
                                    <div className="space-y-2">
                                        {models.map((model) => {
                                            const selected = allowed.includes(model.model);
                                            return (
                                                <label key={model.model} className={`!m-0 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${selected
                                                    ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-400/30 dark:bg-indigo-400/10'
                                                    : 'border-slate-200 bg-slate-50/50 dark:border-white/10 dark:bg-white/[0.025]'}`}
                                                >
                                                    <input
                                                        className="!m-0 mt-0.5 !size-4 !shrink-0"
                                                        type="checkbox"
                                                        checked={selected}
                                                        onChange={() => toggleAllowed(model.model)}
                                                    />
                                                    <span className="min-w-0">
                                                        <span className="flex flex-wrap items-center gap-2">
                                                            <code className="break-all !text-sm !font-semibold !text-slate-800 dark:!text-slate-100">{model.model}</code>
                                                            {!model.available && <StatusBadge ok={false}>経路未設定</StatusBadge>}
                                                        </span>
                                                        <span className="mt-1 block !text-xs !text-slate-500 dark:!text-slate-400">{describePrice(model)}</span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </fieldset>
                            );
                        })}
                    </div>
                </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
                <div aria-live="polite">
                    {result == null ? (
                        <p className="!m-0 !text-sm !text-slate-500 dark:!text-slate-400">変更内容は保存するまで反映されません。</p>
                    ) : (
                        <p className={`!m-0 !text-sm !font-semibold ${result.kind === 'success'
                            ? '!text-emerald-700 dark:!text-emerald-300'
                            : '!text-rose-700 dark:!text-rose-300'}`}
                        >
                            {result.message}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    className="!m-0 !w-auto !rounded-xl !border-0 !bg-indigo-600 !px-5 !py-2.5 !text-sm !font-bold !text-white !shadow-lg !shadow-indigo-600/20 transition hover:!bg-indigo-500 disabled:!cursor-not-allowed disabled:!bg-slate-300 disabled:!shadow-none dark:!bg-indigo-500 dark:hover:!bg-indigo-400 dark:disabled:!bg-slate-700"
                    onClick={save}
                    disabled={saving}
                    aria-busy={saving}
                >
                    {saving ? '保存中…' : '変更を保存'}
                </button>
            </div>
        </main>
    );
}
