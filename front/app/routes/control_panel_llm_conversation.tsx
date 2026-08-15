// 会話1件の監査ビュー。
// ユーザーの発言とAIの応答だけでなく、実行されたツール・引数・結果まで全部見せる。
// 「AIが何を根拠にそう答えたか」まで追えないと、不適切な応答の原因が特定できないため。

import { Link } from 'react-router';
import { BASEURL } from '../backend_url';
import { toJST } from '../utils';
import { Conversation } from '../llm/Message';

export function meta ({ data }: any) {
    return [{ title: `AI会話 #${data?.conversation?.id ?? ''} - Practice Judge` }];
}

export async function clientLoader ({ params }) {
    const res = await fetch(
        new URL(`/api/admin/llm/conversations/${params.conversationId}`, BASEURL).href,
        { credentials: 'include' },
    );
    if (!res.ok) {
        throw new Error('会話が見つからないか、閲覧が許可されていません。');
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

const SKILL_LABEL = {
    pre_ac_advice: '解き方のヒント（AC前）',
    wa_diagnosis: '不正解の原因究明',
    post_ac_review: 'コードの改善提案（AC後）',
};

const TYPE_LABEL = {
    DIRECT_ANSWER_REQUEST: '直接の解答要求',
    IRRELEVANT_CONVERSATION: '無関係な会話',
};

export default function ControlPanelLlmConversation ({ loaderData }) {
    const { conversation: c, turns, toolCalls, violations } = loaderData;

    return (
        <main className="container">
            <nav aria-label="breadcrumb">
                <ul>
                    <li><Link to="/control-panel">コントロールパネル</Link></li>
                    <li><Link to="/control-panel/llm/conversations">AI会話の監査</Link></li>
                    <li>#{c.id}</li>
                </ul>
            </nav>
            <hr />
            <h1>AI会話 #{c.id}</h1>

            <article>
                <h2>概要</h2>
                <table>
                    <tbody>
                        <tr><th scope="row">ユーザー</th><td><Link to={`/users/${c.username}`}>{c.username}</Link></td></tr>
                        <tr><th scope="row">問題</th><td><Link to={`/problems/no/${c.problem_id}`}>{c.problem_title}</Link></td></tr>
                        <tr>
                            <th scope="row">対象の提出</th>
                            <td>
                                {c.submission_id == null ? '—' : (
                                    <Link to={`/problems/no/${c.problem_id}/submissions/${c.submission_id}`}>
                                        #{c.submission_id}
                                    </Link>
                                )}
                            </td>
                        </tr>
                        <tr><th scope="row">種類</th><td>{SKILL_LABEL[c.skill_id] ?? c.skill_id}</td></tr>
                        <tr><th scope="row">モデル</th><td>{c.model}（{c.provider}）</td></tr>
                        <tr>
                            <th scope="row">共有状態</th>
                            <td>
                                {c.share_mode === 'shared' ? '本人が共有に同意' : '本人は非共有'}
                                {c.forced_shared === 1 && <span className="llm-badge">違反により強制共有</span>}
                            </td>
                        </tr>
                        <tr><th scope="row">警告回数</th><td>{c.warning_count}</td></tr>
                        <tr><th scope="row">概算利用額</th><td>${Number(c.total_cost_usd).toFixed(4)}</td></tr>
                        <tr><th scope="row">開始</th><td>{toJST(c.created_at)}</td></tr>
                        <tr><th scope="row">最終更新</th><td>{toJST(c.updated_at)}</td></tr>
                    </tbody>
                </table>
            </article>

            {violations.length > 0 && (
                <article>
                    <h2>この会話で記録された違反</h2>
                    <table>
                        <thead>
                            <tr><th>日時</th><th>種別</th><th>内容</th><th>状態</th></tr>
                        </thead>
                        <tbody>
                            {violations.map((v) => (
                                <tr key={v.id}>
                                    <td>{toJST(v.created_at)}</td>
                                    <td>{TYPE_LABEL[v.violation_type] ?? v.violation_type}</td>
                                    <td>{v.reason}</td>
                                    <td>{v.dismissed === 1 ? `取り消し済み（${v.dismissed_reason}）` : '有効'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </article>
            )}

            <article>
                <h2>会話</h2>
                <p className="llm-note">
                    ログから完全に復元したものです。🔧 の行を押すとツールの引数と結果が開きます。
                </p>
                <Conversation turns={turns} />
            </article>

            <article className="overflow-auto">
                <h2>ツール実行ログ</h2>
                <p className="llm-note">
                    「認可」が NG のものは、AIが本人以外のデータを読もうとしてサーバ側で拒否された記録です。
                </p>
                {toolCalls.length === 0 ? <p>ツールは実行されていません。</p> : (
                    <table style={{ whiteSpace: 'nowrap' }}>
                        <thead>
                            <tr>
                                <th>日時</th><th>ツール</th><th>引数</th><th>結果</th><th>エラー</th><th>認可</th>
                            </tr>
                        </thead>
                        <tbody>
                            {toolCalls.map((t) => (
                                <tr key={t.id}>
                                    <td>{toJST(t.created_at)}</td>
                                    <td>{t.tool_name}</td>
                                    <td style={{ whiteSpace: 'normal', maxWidth: '14em' }}>
                                        <code>{t.input_json}</code>
                                    </td>
                                    <td style={{ whiteSpace: 'normal', maxWidth: '24em' }}>
                                        <code>{(t.result_json ?? '').slice(0, 400)}</code>
                                    </td>
                                    <td>{t.is_error === 1 ? 'はい' : '—'}</td>
                                    <td>
                                        {t.authz_ok === 1
                                            ? 'OK'
                                            : <span className="pico-color-red-500">NG</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </article>
        </main>
    );
}
