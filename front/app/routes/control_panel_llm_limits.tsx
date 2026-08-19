import type { Route } from "./+types/control_panel_llm_limits";
// ユーザー別の上限設定。
// 共有時と非共有時をそれぞれ default / custom / unlimited で設定できる。

import { useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';

export function meta () {
    return [{ title: 'AI利用のユーザー別上限 - Practice Judge' }];
}

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/limits', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('上限設定を取得できませんでした。');
    }
    return await res.json();
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
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

function UserRow ({ user, onSaved }) {
    const [sharedMode, setSharedMode] = useState(user.shared_limit_mode);
    const [sharedUsd, setSharedUsd] = useState(user.shared_limit_usd ?? '');
    const [privateMode, setPrivateMode] = useState(user.private_limit_mode);
    const [privateUsd, setPrivateUsd] = useState(user.private_limit_usd ?? '');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    async function save () {
        setSaving(true);
        setMsg('');
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
            setMsg('保存しました');
            onSaved();
        }
        else {
            let v: any = {};
            try { v = await res.json(); } catch (e) { /* noop */ }
            setMsg(v.error ?? '保存に失敗しました');
        }
        setSaving(false);
    }

    const modeSelect = (value, setter) => (
        <select value={value} onChange={(e) => setter(e.target.value)}>
            <option value="default">全体既定に従う</option>
            <option value="custom">金額を指定</option>
            <option value="unlimited">無制限</option>
        </select>
    );

    return (
        <tr>
            <td>
                <Link to={`/users/${user.username}`}>{user.username}</Link>
                {user.force_shared === 1 && <span className="llm-badge">強制共有</span>}
                <br />
                <span className="llm-note">
                    現在: {user.share_mode == null ? '未選択' : (user.share_mode === 'shared' ? '共有する' : '共有しない')}
                </span>
            </td>
            <td>${Number(user.month_cost_usd).toFixed(4)}</td>
            <td>
                {modeSelect(sharedMode, setSharedMode)}
                {sharedMode === 'custom' && (
                    <input type="number" step="0.01" min="0" value={sharedUsd}
                        onChange={(e) => setSharedUsd(e.target.value)} />
                )}
            </td>
            <td>
                {modeSelect(privateMode, setPrivateMode)}
                {privateMode === 'custom' && (
                    <input type="number" step="0.01" min="0" value={privateUsd}
                        onChange={(e) => setPrivateUsd(e.target.value)} />
                )}
            </td>
            <td>
                <button type="button" className="button-small-padding" onClick={save}
                    disabled={saving} aria-busy={saving ? 'true' : 'false'}>
                    保存
                </button>
                {msg !== '' && <div className="llm-note">{msg}</div>}
            </td>
        </tr>
    );
}

export default function ControlPanelLlmLimits ({ loaderData }: Route.ComponentProps) {
    const [data, setData] = useState(loaderData);

    async function reload () {
        const res = await fetch(new URL('/api/admin/llm/limits', BASEURL).href, { credentials: 'include' });
        if (res.ok) {
            setData(await res.json());
        }
    }

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li><Link to="/control-panel/llm">AI学習支援の設定</Link></li>
                    <li>ユーザー別上限</li>
                </ul>
            </nav>
            <hr />
            <h1>ユーザー別上限</h1>
            <p className="llm-note">
                「全体既定に従う」のままなら<Link to="/control-panel/llm">全体設定</Link>の値が使われます。
                共有時と非共有時は独立して設定できます（例: 共有すれば無制限、しなければ月$1）。
                利用額は {data.billingMonth} の集計です。
            </p>

            <article className="overflow-auto">
                <table style={{ whiteSpace: 'nowrap' }}>
                    <thead>
                        <tr>
                            <th>ユーザー</th>
                            <th>今月の利用額</th>
                            <th>共有する場合</th>
                            <th>共有しない場合</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.users.map((u) => (
                            <UserRow key={u.user_id} user={u} onSaved={reload} />
                        ))}
                    </tbody>
                </table>
            </article>
        </main>
    );
}
