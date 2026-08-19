import type { Route } from "./+types/control_panel_llm_conversations";
// 閲覧可能な会話の一覧。
// 出てくるのは「本人が共有に同意したもの」と「違反により強制共有になったもの」だけ。

import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';

export function meta () {
    return [{ title: 'AI会話の監査 - Practice Judge' }];
}

export async function clientLoader ({ request }: Route.ClientLoaderArgs) {
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const username = url.searchParams.get('username');
    const flagged = url.searchParams.get('flagged');
    const page = url.searchParams.get('page');
    if (username) {
        params.set('username', username);
    }
    if (flagged) {
        params.set('flagged', flagged);
    }
    if (page) {
        params.set('page', page);
    }

    const res = await fetch(new URL(`/api/admin/llm/conversations?${params.toString()}`, BASEURL).href, {
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error('会話一覧を取得できませんでした。');
    }
    return { ...(await res.json()), username, flagged, page: Number(page ?? 0) };
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

const SKILL_LABEL: Record<string, string | undefined> = {
    pre_ac_advice: '解き方のヒント',
    wa_diagnosis: '不正解の原因究明',
    post_ac_review: 'コードの改善提案',
};

export default function ControlPanelLlmConversations ({ loaderData }: Route.ComponentProps) {
    const d = loaderData;
    const pageSize = 20;
    const lastPage = Math.max(0, Math.ceil(d.total / pageSize) - 1);

    const linkWith = (patch) => {
        const p = new URLSearchParams();
        if (d.username) p.set('username', d.username);
        if (d.flagged) p.set('flagged', d.flagged);
        for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') p.delete(k);
            else p.set(k, String(v));
        }
        return `/control-panel/llm/conversations?${p.toString()}`;
    };

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li>AI会話の監査</li>
                </ul>
            </nav>
            <hr />
            <h1>AI会話の監査</h1>
            <p className="llm-note">
                表示されるのは、本人が共有に同意した会話と、違反により強制共有になった会話だけです。
                共有しない設定の会話はログとしては保存されていますが、ここには表示されません。
            </p>

            <p>
                {d.flagged === '1'
                    ? <Link to={linkWith({ flagged: '' })}>すべての会話を表示</Link>
                    : <Link to={linkWith({ flagged: '1' })}>違反フラグのある会話だけ表示</Link>}
                {d.username && (
                    <>
                        {' ｜ '}
                        <Link to="/control-panel/llm/conversations">絞り込み（{d.username}）を解除</Link>
                    </>
                )}
            </p>

            <article className="overflow-auto">
                <p>{d.total} 件</p>
                <table style={{ whiteSpace: 'nowrap' }}>
                    <thead>
                        <tr>
                            <th>会話</th>
                            <th>ユーザー</th>
                            <th>問題</th>
                            <th>種類</th>
                            <th>モデル</th>
                            <th>やりとり</th>
                            <th>越権試行</th>
                            <th>金額</th>
                            <th>最終更新</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.conversations.map((c) => (
                            <tr key={c.id}>
                                <td>
                                    <Link to={`/control-panel/llm/conversations/${c.id}`}>#{c.id}</Link>
                                    {c.forced_shared === 1 && <span className="llm-badge">強制共有</span>}
                                </td>
                                <td><Link to={`/users/${c.username}`}>{c.username}</Link></td>
                                <td><Link to={`/problems/no/${c.problem_id}`}>{c.problem_title}</Link></td>
                                <td>{SKILL_LABEL[c.skill_id] ?? c.skill_id}</td>
                                <td>{c.model}</td>
                                <td>{c.turn_count}</td>
                                <td>
                                    {c.authz_violations > 0
                                        ? <span className="pico-color-red-500">{c.authz_violations}</span>
                                        : '—'}
                                </td>
                                <td>${Number(c.total_cost_usd).toFixed(4)}</td>
                                <td>{toJST(c.updated_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </article>

            {lastPage > 0 && (
                <nav>
                    <ul>
                        {d.page > 0 && <li><Link to={linkWith({ page: d.page - 1 })}>前へ</Link></li>}
                        <li>{d.page + 1} / {lastPage + 1}</li>
                        {d.page < lastPage && <li><Link to={linkWith({ page: d.page + 1 })}>次へ</Link></li>}
                    </ul>
                </nav>
            )}
        </main>
    );
}
