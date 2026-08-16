// AI学習支援の全体設定。
// 共有時／非共有時それぞれの無料枠、システム全体の上限、モデルの割り当てを設定する。

import { useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';

export function meta () {
    return [{ title: 'AI学習支援の設定 - Practice Judge' }];
}

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/settings', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('設定を取得できませんでした。');
    }
    return await res.json();
}

export function ErrorBoundary ({ error }) {
    let msg = '不明なエラー';
    if (error instanceof Error) {
        msg = error.message;
    }
    return (
        <main className="container">
            <h1>エラー</h1>
            <p>{msg}</p>
        </main>
    );
}

// モデル一覧の見出し。系列ごとに呼び出し経路が違うので、まとめて出すと選び間違える。
const FAMILIES: [string, string][] = [
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['openai', 'OpenAI'],
    ['local', 'ローカルLLM'],
];

function describePrice (m: any) {
    if (m.family === 'local') {
        return 'API課金なし（利用額は0として計上）';
    }
    return `入力 $${m.input} / 出力 $${m.output} per 1M tokens`;
}

// モード（custom / unlimited）と金額をひと組で編集する
function LimitEditor ({ label, hint = null, mode, usd, onChange }: any) {
    return (
        <fieldset>
            <legend><strong>{label}</strong></legend>
            {hint && <p className="llm-note">{hint}</p>}
            <label>
                <input
                    type="radio"
                    checked={mode === 'custom'}
                    onChange={() => onChange({ mode: 'custom', usd })}
                />
                金額を指定する
            </label>
            <label>
                <input
                    type="radio"
                    checked={mode === 'unlimited'}
                    onChange={() => onChange({ mode: 'unlimited', usd })}
                />
                無制限
            </label>
            {mode === 'custom' && (
                <label>
                    毎月の上限（USD）
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={usd}
                        onChange={(e) => onChange({ mode, usd: e.target.value })}
                    />
                </label>
            )}
        </fieldset>
    );
}

export default function ControlPanelLlm ({ loaderData }) {
    const d = loaderData;

    const [shared, setShared] = useState({ mode: d.limits.shared.mode, usd: d.limits.shared.usd });
    const [priv, setPriv] = useState({ mode: d.limits.private.mode, usd: d.limits.private.usd });
    const [system, setSystem] = useState({ mode: d.limits.system.mode, usd: d.limits.system.usd });
    const [byDiff, setByDiff] = useState(d.modelByDifficulty);
    const [allowed, setAllowed] = useState(d.allowedModels);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    async function save () {
        setSaving(true);
        setMsg('');
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
                model_by_difficulty: byDiff,
                allowed_models: allowed,
            }),
        });
        if (res.ok) {
            setMsg('保存しました。');
        }
        else {
            let v: any = {};
            try { v = await res.json(); } catch (e) { /* noop */ }
            setMsg(v.error ?? '保存に失敗しました。');
        }
        setSaving(false);
    }

    function toggleAllowed (model) {
        setAllowed((prev) => (
            prev.indexOf(model) === -1 ? [...prev, model] : prev.filter((m) => m !== model)
        ));
    }

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li>AI学習支援の設定</li>
                </ul>
            </nav>
            <hr />
            <h1>AI学習支援の設定</h1>

            <article>
                <h2>稼働状況</h2>
                <table>
                    <tbody>
                        {d.providers.map((p: any) => (
                            <tr key={p.id}>
                                <th scope="row">{p.label}</th>
                                <td>
                                    {p.configured
                                        ? <span className="pico-color-green-500">設定済み</span>
                                        : <span className="pico-color-red-500">未設定</span>}
                                    {/* 排他の経路（Claude・Gemini）だけ、今どちらを使うかを出す */}
                                    {p.active === true && <span className="llm-note">{' '}・使用中</span>}
                                    {p.active === false && (
                                        <span className="llm-note">
                                            {' '}・未使用{p.switchHint ? `（${p.switchHint}）` : ''}
                                        </span>
                                    )}
                                    <span className="llm-note">{' '}{p.detail}</span>
                                </td>
                            </tr>
                        ))}
                        <tr>
                            <th scope="row">機能の状態</th>
                            <td>{d.configured
                                ? <span className="pico-color-green-500">有効</span>
                                : <span className="pico-color-red-500">無効（呼び出せる経路がありません）</span>}</td>
                        </tr>
                        <tr>
                            <th scope="row">envの既定モデル</th>
                            <td>
                                {d.envDefaultModel}
                                {!d.envDefaultModelAvailable && (
                                    <span className="pico-color-red-500">（経路が未設定のため使われません）</span>
                                )}
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">今月のシステム全体の利用額</th>
                            <td>${d.currentMonth.systemCostUsd.toFixed(4)}（{d.currentMonth.billingMonth}）</td>
                        </tr>
                    </tbody>
                </table>
            </article>

            <article>
                <h2>無料枠（全体の既定）</h2>
                <p className="llm-note">
                    ユーザーが「会話を共有する」を選んだ場合と「共有しない」を選んだ場合で、別々の枠を割り当てられます。
                    共有側を無制限にしておくと、会話を見せてもよいユーザーには制限なく使ってもらう、という運用ができます。
                    個別に上書きしたい場合は<Link to="/control-panel/llm/limits">ユーザー別上限</Link>から設定します。
                </p>

                <div className="llm-plan-grid">
                    <LimitEditor
                        label="共有する場合"
                        hint="会話が管理者の閲覧対象になる代わりに広い枠を与える。"
                        mode={shared.mode}
                        usd={shared.usd}
                        onChange={setShared}
                    />
                    <LimitEditor
                        label="共有しない場合"
                        hint="会話は保存されるが管理者は閲覧しない。枠は狭くする。"
                        mode={priv.mode}
                        usd={priv.usd}
                        onChange={setPriv}
                    />
                </div>

                <h3>システム全体の上限</h3>
                <p className="llm-note">
                    個々のユーザーが無制限であっても、この上限に達すると全員の利用が停止します。最後の砦です。
                </p>
                <LimitEditor label="全ユーザー合計" mode={system.mode} usd={system.usd} onChange={setSystem} />
            </article>

            <article>
                <h2>モデルの割り当て</h2>

                <h3>問題の難易度ごとの既定モデル</h3>
                <p className="llm-note">
                    ユーザーが「おまかせ」を選んでいる場合に使われます。易しい問題まで最上位モデルを使う必要はありません。
                </p>
                <table>
                    <thead>
                        <tr><th>難易度</th><th>モデル</th></tr>
                    </thead>
                    <tbody>
                        {[1, 2, 3, 4, 5].map((lv) => (
                            <tr key={lv}>
                                <td>{'⭐'.repeat(lv)}</td>
                                <td>
                                    <select
                                        value={byDiff[lv] ?? ''}
                                        onChange={(e) => setByDiff({ ...byDiff, [lv]: e.target.value })}
                                    >
                                        <option value="">（envの既定を使う）</option>
                                        {d.knownModels.map((m) => (
                                            <option key={m.model} value={m.model}>
                                                {m.model}{m.available ? '' : '（経路が未設定）'}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <h3>ユーザーが選べるモデル</h3>
                <p className="llm-note">
                    ここで許可したモデルだけが、ユーザーの設定画面の選択肢に出ます。
                    単価が分からないモデルは上限管理ができないため選べません。
                    経路が未設定のモデルは、許可してもユーザーの選択肢には出ません。
                </p>
                {FAMILIES.map(([family, label]) => {
                    const models = d.knownModels.filter((m: any) => m.family === family);
                    if (models.length === 0) {
                        return null;
                    }
                    return (
                        <fieldset key={family}>
                            <legend><strong>{label}</strong></legend>
                            {models.map((m: any) => (
                                <label key={m.model}>
                                    <input
                                        type="checkbox"
                                        checked={allowed.indexOf(m.model) !== -1}
                                        onChange={() => toggleAllowed(m.model)}
                                    />
                                    {m.model}
                                    <span className="llm-note">{' '}{describePrice(m)}</span>
                                    {!m.available && (
                                        <span className="pico-color-red-500">（経路が未設定）</span>
                                    )}
                                </label>
                            ))}
                        </fieldset>
                    );
                })}
            </article>

            <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
                <button type="button" onClick={save} disabled={saving} aria-busy={saving ? 'true' : 'false'}>
                    保存
                </button>
                {msg !== '' && <span className="pico-color-red-500">{msg}</span>}
            </div>
        </main>
    );
}
