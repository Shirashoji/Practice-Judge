import type { Route } from "./+types/control_panel_llm_violations";
// 警告・違反の監視画面。
// 誤検知だった場合に取り消せることと、取り消したうえで強制共有を解除できることが要。
//
// 警告はユーザー単位で数える（会話をまたいで持ち越す）ので、誤って警告された利用者は
// 管理者に問い合わせて取り消してもらう。取り消せば次はまた警告のみから始まる。

import { useState } from 'react';
import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';

export function meta () {
    return [{ title: 'AI利用の警告・違反記録 - Practice Judge' }];
}

export async function clientLoader () {
    const res = await fetch(new URL('/api/admin/llm/violations', BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        throw new Error('違反記録を取得できませんでした。');
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

const TYPE_LABEL: Record<string, string | undefined> = {
    DIRECT_ANSWER_REQUEST: '直接の解答要求',
    IRRELEVANT_CONVERSATION: '無関係な会話',
};

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

    async function dismiss (id) {
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

    async function post (path, body) {
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

    async function dismissWarning (id) {
        const reason = window.prompt('取り消しの理由を入力してください（誤警告の内容など）');
        if (reason == null) {
            return;
        }
        await post(`/api/admin/llm/warnings/${id}/dismiss`, { reason });
    }

    // 「誤って警告された」という問い合わせに対する一括リセット。
    async function resetWarnings (userId, username, count) {
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

    async function release (userId, username) {
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

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li>AI利用の警告・違反記録</li>
                </ul>
            </nav>
            <hr />
            <h1>AI利用の警告・違反記録</h1>
            <p className="llm-note">
                初回のガイドライン違反は<strong>警告</strong>として記録され、会話をまたいで持ち越されます
                （新しいチャットを開いてもリセットされません）。有効な警告がある状態で同種の要求を繰り返すと
                <strong>違反</strong>として記録され、そのユーザーの会話は強制的に閲覧対象になります。
            </p>
            <p className="llm-note">
                誤って警告されたという問い合わせを受けた場合は、下の「警告をリセット」で取り消してください。
                取り消すと、その利用者は次に同種の要求をしてもまた警告のみから始まります。
                違反の取り消しは強制共有の解除より先に行ってください。
            </p>
            {msg !== '' && <p className="pico-color-red-500">{msg}</p>}

            <article>
                <h2>違反者一覧</h2>
                {data.users.length === 0 ? <p>警告・違反の記録はありません。</p> : (
                    <div className="overflow-auto">
                        <table style={{ whiteSpace: 'nowrap' }}>
                            <thead>
                                <tr>
                                    <th>ユーザー</th>
                                    <th>有効な警告</th>
                                    <th>有効な違反</th>
                                    <th>直接の解答要求</th>
                                    <th>無関係な会話</th>
                                    <th>最終違反</th>
                                    <th>強制共有</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.users.map((u) => (
                                    <tr key={u.user_id}>
                                        <td><Link to={`/users/${u.username}`}>{u.username}</Link></td>
                                        <td>
                                            <strong>{u.active_warning_count}</strong>
                                            <span className="llm-note"> / 全{u.total_warning_count}</span>
                                        </td>
                                        <td>
                                            <strong>{u.active_count}</strong>
                                            <span className="llm-note"> / 全{u.total_count}</span>
                                        </td>
                                        <td>{u.direct_answer_count}</td>
                                        <td>{u.irrelevant_count}</td>
                                        <td>{u.last_violation_at == null ? '—' : toJST(u.last_violation_at)}</td>
                                        <td>{u.force_shared === 1 ? '有効' : '—'}</td>
                                        <td>
                                            <Link to={`/control-panel/llm/conversations?username=${encodeURIComponent(u.username)}`}>
                                                会話を見る
                                            </Link>
                                            {u.active_warning_count > 0 && (
                                                <button
                                                    type="button"
                                                    className="button-small-padding secondary outline"
                                                    style={{ marginLeft: '0.5em' }}
                                                    disabled={busy}
                                                    onClick={() => resetWarnings(u.user_id, u.username, u.active_warning_count)}
                                                >
                                                    警告をリセット
                                                </button>
                                            )}
                                            {u.force_shared === 1 && (
                                                <button
                                                    type="button"
                                                    className="button-small-padding secondary outline"
                                                    style={{ marginLeft: '0.5em' }}
                                                    disabled={busy}
                                                    onClick={() => release(u.user_id, u.username)}
                                                >
                                                    強制共有を解除
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </article>

            <article>
                <h2>警告の明細</h2>
                <p className="llm-note">
                    警告は違反として記録されておらず、強制共有にもなりません。
                    誤警告だった場合はここで個別に取り消せます。
                </p>
                {data.warnings.length === 0 ? <p>ありません。</p> : (
                    <div className="overflow-auto">
                        <table style={{ whiteSpace: 'nowrap' }}>
                            <thead>
                                <tr>
                                    <th>日時</th>
                                    <th>ユーザー</th>
                                    <th>種別</th>
                                    <th>内容</th>
                                    <th>会話</th>
                                    <th>状態</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.warnings.map((w) => (
                                    <tr key={w.id} style={w.dismissed === 1 ? { opacity: 0.55 } : undefined}>
                                        <td>{toJST(w.created_at)}</td>
                                        <td>{w.username}</td>
                                        <td>{TYPE_LABEL[w.violation_type] ?? w.violation_type}</td>
                                        <td style={{ whiteSpace: 'normal', maxWidth: '20em' }}>{w.reason}</td>
                                        <td>
                                            {w.conversation_id == null ? '—' : (
                                                <Link to={`/control-panel/llm/conversations/${w.conversation_id}`}>
                                                    #{w.conversation_id}
                                                </Link>
                                            )}
                                        </td>
                                        <td>
                                            {w.dismissed === 1
                                                ? <span className="llm-note">取り消し済み<br />{w.dismissed_reason}</span>
                                                : <span className="pico-color-pumpkin-500">有効</span>}
                                        </td>
                                        <td>
                                            {w.dismissed === 0 && (
                                                <button
                                                    type="button"
                                                    className="button-small-padding secondary outline"
                                                    disabled={busy}
                                                    onClick={() => dismissWarning(w.id)}
                                                >
                                                    誤警告として取り消す
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </article>

            <article>
                <h2>違反の明細</h2>
                {data.violations.length === 0 ? <p>ありません。</p> : (
                    <div className="overflow-auto">
                        <table style={{ whiteSpace: 'nowrap' }}>
                            <thead>
                                <tr>
                                    <th>日時</th>
                                    <th>ユーザー</th>
                                    <th>種別</th>
                                    <th>内容</th>
                                    <th>会話</th>
                                    <th>状態</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.violations.map((v) => (
                                    <tr key={v.id} style={v.dismissed === 1 ? { opacity: 0.55 } : undefined}>
                                        <td>{toJST(v.created_at)}</td>
                                        <td>{v.username}</td>
                                        <td>{TYPE_LABEL[v.violation_type] ?? v.violation_type}</td>
                                        <td style={{ whiteSpace: 'normal', maxWidth: '20em' }}>{v.reason}</td>
                                        <td>
                                            {v.conversation_id == null ? '—' : (
                                                <Link to={`/control-panel/llm/conversations/${v.conversation_id}`}>
                                                    #{v.conversation_id}
                                                </Link>
                                            )}
                                        </td>
                                        <td>
                                            {v.dismissed === 1
                                                ? <span className="llm-note">取り消し済み<br />{v.dismissed_reason}</span>
                                                : <span className="pico-color-pumpkin-500">有効</span>}
                                        </td>
                                        <td>
                                            {v.dismissed === 0 && (
                                                <button
                                                    type="button"
                                                    className="button-small-padding secondary outline"
                                                    disabled={busy}
                                                    onClick={() => dismiss(v.id)}
                                                >
                                                    誤認として取り消す
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </article>
        </main>
    );
}
