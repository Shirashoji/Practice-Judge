import { BASEURL } from '../backend_url';
import { useState, useEffect } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router';
import type { AppOutletContext } from '../types';
import { isValidUsername, isValidPassword } from '../utils';
import { fetchSettings, updateSettings } from '../llm/client';

export function meta() {
    return [
        { title: "設定 - Practice Judge" }
    ];
}

export async function clientLoader ({ params }) {
    return;
}

export function ErrorBoundary ({ error }) {
    let msg = "不明なエラー";
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

export default function Settings ({ loaderData }) {
    return (
        <main className="container">
            <h1>設定</h1>
            <ChangeUsername />
            <ChangePassword />
            <LlmSettings />
        </main>
    );
}

// ------------------------------------------------------------
// AI学習支援の設定
// ------------------------------------------------------------

function formatLimit (limit) {
    if (limit == null) {
        return "—";
    }
    if (limit.mode === "unlimited") {
        return "無制限";
    }
    return `$${Number(limit.limitUsd).toFixed(2)} / 月`;
}

function LlmSettings () {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");

    async function reload () {
        try {
            setData(await fetchSettings());
        }
        catch (e) {
            setMsg(e instanceof Error ? e.message : "設定の取得に失敗しました。");
        }
        setLoading(false);
    }

    useEffect(() => { reload(); }, []);

    async function save (patch) {
        setSaving(true);
        setMsg("");
        try {
            await updateSettings(patch);
            await reload();
            setMsg("保存しました。");
        }
        catch (e) {
            setMsg(e instanceof Error ? e.message : "保存に失敗しました。");
        }
        setSaving(false);
    }

    if (loading) {
        return <article aria-busy="true">読み込み中...</article>;
    }
    if (data == null) {
        return (
            <article>
                <h2>AI学習支援</h2>
                <p className="pico-color-red-500">{msg}</p>
            </article>
        );
    }
    if (!data.available) {
        return (
            <article>
                <h2>AI学習支援</h2>
                <p>この環境ではAI学習支援が有効になっていません。</p>
            </article>
        );
    }

    const b = data.budget;
    const remaining = b.current == null || b.current.mode === "unlimited"
        ? null
        : Math.max(0, b.current.limitUsd - b.monthCostUsd);

    return (
        <article>
            <h2>AI学習支援</h2>

            {/* --- 今月の利用状況 --- */}
            <h3>今月の利用状況（{b.billingMonth}）</h3>
            <table>
                <tbody>
                    <tr>
                        <th scope="row">利用額</th>
                        <td>${b.monthCostUsd.toFixed(4)}</td>
                    </tr>
                    <tr>
                        <th scope="row">上限</th>
                        <td>{b.current == null ? "共有設定を選ぶと決まります" : formatLimit(b.current)}</td>
                    </tr>
                    {remaining != null && (
                        <tr>
                            <th scope="row">残り</th>
                            <td>${remaining.toFixed(4)}</td>
                        </tr>
                    )}
                </tbody>
            </table>

            {/* --- 共有設定 --- */}
            <h3>会話の共有設定</h3>
            {data.shareMode == null && (
                <p className="pico-color-pumpkin-500">
                    まだ選択されていません。AI学習支援を使うには、どちらかを選んでください。
                </p>
            )}
            <p className="llm-note">
                どちらを選んでも会話は記録されます（不正利用の調査のため）。違うのは、管理者が日常的に閲覧できるかどうかと、
                毎月使える金額です。詳しくは<Link to="/privacy-policy">プライバシーポリシー</Link>をご覧ください。
            </p>

            {data.forceShared ? (
                <p className="pico-color-red-500">
                    ガイドライン違反の記録があるため、現在は強制的に「共有する」状態になっており、変更できません。
                    誤りだと思われる場合は管理者にご連絡ください。
                </p>
            ) : (
                <div className="llm-plan-grid">
                    <article className={data.shareMode === "shared" ? "llm-plan llm-plan-selected" : "llm-plan"}>
                        <label>
                            <input
                                type="radio"
                                name="sharemode"
                                checked={data.shareMode === "shared"}
                                disabled={saving}
                                onChange={() => save({ shareMode: "shared" })}
                            />
                            <strong>共有する</strong>
                        </label>
                        <p className="llm-plan-limit">{formatLimit(b.limits.shared)}</p>
                        <p className="llm-note">管理者があなたの会話を閲覧できます。</p>
                    </article>

                    <article className={data.shareMode === "private" ? "llm-plan llm-plan-selected" : "llm-plan"}>
                        <label>
                            <input
                                type="radio"
                                name="sharemode"
                                checked={data.shareMode === "private"}
                                disabled={saving}
                                onChange={() => save({ shareMode: "private" })}
                            />
                            <strong>共有しない</strong>
                        </label>
                        <p className="llm-plan-limit">{formatLimit(b.limits.private)}</p>
                        <p className="llm-note">管理者は通常閲覧しません（違反時を除く）。</p>
                    </article>
                </div>
            )}
            <p className="llm-note">
                設定の変更は、これ以降に作成される会話に適用されます。今月の利用額は再計算されません。
            </p>

            {/* --- モデル選択 --- */}
            <h3>使用するAIモデル</h3>
            <p className="llm-note">
                安いモデルを選ぶと、同じ上限額でより多く相談できます。
                難しい問題では高性能なモデルのほうが的確なヒントを出せます。
            </p>
            <select
                value={data.preferredModel}
                disabled={saving}
                onChange={(e) => save({ preferredModel: e.target.value })}
            >
                <option value="auto">おまかせ（問題の難易度に応じて自動で選ぶ）</option>
                {data.allowedModels.map((m) => (
                    <option key={m.model} value={m.model}>
                        {m.model}（{m.family === 'local'
                            ? 'ローカル実行・利用額を消費しません'
                            : `入力 $${m.inputUsdPerMTok} / 出力 $${m.outputUsdPerMTok} per 1M tokens`}）
                    </option>
                ))}
            </select>
            <p className="llm-note">
                変更は次に始める会話から反映されます（会話の途中でモデルは変わりません）。
            </p>

            {msg !== "" && <p className="pico-color-red-500">{msg}</p>}
        </article>
    );
}

function ChangeUsername () {
    const { loginInfo } = useOutletContext<AppOutletContext>();

    const [newUsername, setNewUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    const handler = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (!isValidUsername(newUsername)) {
            setMsg("新しいユーザ名が条件を満たしていません。");
            setLoading(false);
            return;
        }

        const fChange = await fetch(new URL("/api/auth/change-username", BASEURL).href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newUsername, password }),
            credentials: "include",
        });

        if (!fChange.ok) {
            const data = await fChange.json();
            setMsg(data.error ?? "変更に失敗しました。");
        }
        else {
            // 強制リロード
            setMsg("変更に成功しました。1秒後にリロードします。");
            setNewUsername("");
            setPassword("");

            new Promise((resolve) => {
                setTimeout(resolve, 1000);
            }).then(() => {
                window.location.href = "/settings";
            });
        }

        setLoading(false);
    };

    return (
        <article>
            <h2>ユーザー名を変更する</h2>
            <form onSubmit={handler}>
                <strong>現在のユーザー名</strong>
                <p>{loginInfo.username}</p>
                <label>
                    <strong>新しいユーザー名</strong>
                    <input
                        type="text"
                        value={newUsername}
                        required
                        onChange={(e) => setNewUsername(e.target.value)}
                    />
                </label>
                <ul>
                    <li>UTF-16において100コード以内かつ1文字以上20文字以内である必要があります。</li>
                    <li><code>!#$&'()*+,/:;=?@[]</code>以外の文字を使用可能です。</li>
                </ul>
                <label>
                    <strong>現在のパスワード（確認）</strong>
                    <input
                        type="password"
                        value={password}
                        required
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading ? "true" : "false"}
                    style={{ maxWidth: "5em" }}
                >
                    変更
                </button>
            </form>
            {msg && <p className="pico-color-red-500">{msg}</p>}
        </article>
    );
}

function ChangePassword () {
    const [newPassword, setNewPassword] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    const handler = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (!isValidPassword(newPassword)) {
            setMsg("新しいパスワードが条件を満たしていません。");
            setLoading(false);
            return;
        }

        const fChange = await fetch(new URL("/api/auth/change-password", BASEURL).href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newPassword, password }),
            credentials: "include",
        });

        if (!fChange.ok) {
            const data = await fChange.json();
            setMsg(data.error ?? "変更に失敗しました。");
        }
        else {
            // 強制リロード
            setMsg("変更に成功しました。1秒後にリロードします。");
            setNewPassword("");
            setPassword("");

            new Promise((resolve) => {
                setTimeout(resolve, 1000);
            }).then(() => {
                window.location.href = "/settings";
            });
        }

        setLoading(false);
    };

    return (
        <article>
            <h2>パスワードを変更する</h2>
            <form onSubmit={handler}>
                <label>
                    <strong>新しいパスワード</strong>
                    <input
                        type="password"
                        value={newPassword}
                        required
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </label>
                    <ul>
                        <li>10文字以上50文字以下である必要があります。</li>
                        <li>半角英数字と記号<code style={{ whiteSpace: "pre" }}>{' '}!"#$%&'()-^\@[;:],./\=~|`{'{'}+*{'}'}{'<>'}?_</code>を使用可能です。</li>
                    </ul>
                <label>
                    <strong>現在のパスワード（確認）</strong>
                    <input
                        type="password"
                        value={password}
                        required
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading ? "true" : "false"}
                    style={{ maxWidth: "5em" }}
                >
                    変更
                </button>
            </form>
            {msg && <p className="pico-color-red-500">{msg}</p>}
        </article>
    );
}
