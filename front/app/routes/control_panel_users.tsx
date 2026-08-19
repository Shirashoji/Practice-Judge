import type { Route } from "./+types/control_panel_users";
import { useState } from "react";
import { useNavigate, Link, useOutletContext } from "react-router";
import type { AppOutletContext } from '../types';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';

// GET /api/users の1行（api/users.js のSELECTと対応）。is_active は 0 / 1。
type AdminUser = {
    id: number;
    username: string;
    role: string;
    is_active: number;
    created_at: string;
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ユーザー一覧 - Practice Judge" },
  ];
}

export async function clientLoader ({ request }: Route.ClientLoaderArgs) {
    const fp = await fetch(new URL("/api/users", BASEURL).href, {
        credentials: "include",
    });
    return await fp.json() as AdminUser[];
}

export default function AllUsers ({ loaderData }: Route.ComponentProps) {
    const users = loaderData;

    return (
    <>
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li>ユーザー一覧</li>
                </ul>
            </nav>

            <hr />

            <h1>ユーザー一覧</h1>

            <article>
                <table>
                    <thead>
                        <tr>
                            <th>ユーザーID</th>
                            <th>ユーザー名</th>
                            <th>ロール</th>
                            <th>登録日時</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user: AdminUser) => {
                            return (
                                <tr key={user.id}>
                                    <td>{user.id}</td>
                                    <td>
                                        <Link to={`/users/${user.username}`}>{user.username}</Link>
                                        {user.is_active == 0 && <>（アカウント停止中）</>}
                                    </td>
                                    <td>{user.role}</td>
                                    <td>{toJST(user.created_at)}</td>
                                    <td><ResetButton userId={user.id} role={user.role} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </article>
        </main>
    </>
    );
}

function ResetButton ({ userId, role }: { userId: number; role: string }) {
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const { loginInfo } = useOutletContext<AppOutletContext>();

    const reset = async (userId: number) => {
        if (!window.confirm(`ユーザーID ${userId}のパスワードをリセットします。よろしいですか？`)) {
            return;
        }
        if (!window.confirm("アカウント所有者の許諾を得ていますか？")) {
            return;
        }

        setResetting(true);
        setError("");
        setMessage("");

        const res = await fetch(new URL("/api/auth/reset-password", BASEURL).href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
            credentials: "include",
        });

        {
            let v;
            try {
                v = await res.json();
            }
            catch (e) {
                v = {};
            }

            if (res.ok) {
                setMessage(v.success ?? "レスポンスが未設定です");
            }
            else {
                setError(v.error ?? "不明なエラー");
            }
        }

        setResetting(false);
    };

    let show = false;
    if (loginInfo.role == "admin" && role == "user") {
        show = true;
    }
    if (loginInfo.role == "inthebloom" && role != "inthebloom") {
        show = true;
    }

    if (show) {
        return (
            <div>
                <button
                    onClick={() => reset(userId)}
                    disabled={resetting}
                    aria-busy={resetting}
                >
                    パスワードをリセットする
                </button>
                {error != "" ? <span className="pico-color-red-500">{error}</span> : <></>}
                {message != "" ? <span className="pico-color-green-500">{message}</span> : <></>}
            </div>
        );
    }
    return <></>;
}
