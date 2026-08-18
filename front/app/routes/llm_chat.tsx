// チャット専用画面。
//
// 問題文・該当の提出（コードと実行結果）・チャットを同時に見られるようにする。
// 一方向説明から遷移してきたときは、その1ターン目が履歴としてそのまま引き継がれる。

import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import 'katex/dist/katex.min.css';
import { BASEURL } from '../backend_url';
import { AceEditorReadOnly } from '../ace_editor';
import { toJST } from '../utils';
import { Statement } from '../llm/Statement';
import { Conversation, MessageText } from '../llm/Message';
import { sendMessage } from '../llm/client';
import { GenerationProgress, INITIAL_PROGRESS, type ProgressState } from '../llm/GenerationProgress';

export function meta ({ data }: any) {
    const title = data?.conversation?.problem_title ?? '会話';
    return [{ title: `AIチャット: ${title} - Practice Judge` }];
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

export async function clientLoader ({ params }) {
    const convRes = await fetch(new URL(`/api/llm/conversations/${params.conversationId}`, BASEURL).href, {
        credentials: 'include',
    });
    if (!convRes.ok) {
        throw new Error('会話が見つかりません。');
    }
    const data = await convRes.json();

    // 問題文（未公開問題は管理者のみ見られる）
    const probRes = await fetch(new URL(`/api/problems/no/${data.conversation.problem_id}`, BASEURL).href, {
        credentials: 'include',
    });
    const problem = probRes.ok ? await probRes.json() : null;

    // 対象の提出（あれば）
    let submission = null;
    if (data.conversation.submission_id != null) {
        const subRes = await fetch(
            new URL(`/api/problems/no/${data.conversation.problem_id}/submissions/${data.conversation.submission_id}`, BASEURL).href,
            { credentials: 'include' },
        );
        if (subRes.ok) {
            submission = await subRes.json();
        }
    }

    return { ...data, problem, submission };
}

const STATUS_COLOR = {
    AC: 'pico-color-green-200',
    WA: 'pico-color-pumpkin-200',
    TLE: 'pico-color-pumpkin-200',
    RE: 'pico-color-pumpkin-200',
    CE: 'pico-color-pumpkin-200',
    MLE: 'pico-color-pumpkin-200',
    OLE: 'pico-color-pumpkin-200',
    IE: 'pico-color-red-400',
};

export default function LlmChat ({ loaderData }) {
    const { conversation, problem, submission } = loaderData;

    const [turns, setTurns] = useState<any[]>(loaderData.turns ?? []);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [liveText, setLiveText] = useState('');
    const [liveTools, setLiveTools] = useState<any[]>([]);
    const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
    const [contextTab, setContextTab] = useState(submission == null ? 'problem' : 'submission');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const location = useLocation();
    const openingStartedRef = useRef(false);

    // 新しい発言が増えたら一番下へ
    useEffect(() => {
        const el = scrollRef.current;
        if (el != null) {
            el.scrollTop = el.scrollHeight;
        }
    }, [turns, liveText]);

    useEffect(() => () => abortRef.current?.abort(), []);

    async function send (rawMessage: string, onAccepted?: () => void) {
        const message = rawMessage.trim();
        if (message === '' || streaming) {
            return;
        }

        // 送信した発言をすぐ画面に出す（サーバ側でも同じ内容が保存される）
        setTurns((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: [{ type: 'text', text: message }] }]);
        setInput('');
        setStreaming(true);
        setLiveText('');
        setLiveTools([]);
        setProgress(INITIAL_PROGRESS);
        setError('');
        setNotice('');

        const ac = new AbortController();
        abortRef.current = ac;

        const collected: any[] = [];
        let accepted = false;

        try {
            await sendMessage(conversation.id, message, (ev: any) => {
                if (ev.type === 'meta') {
                    // SSEが開き、サーバが発言を受理したことを確認してから呼び出す。
                    // 初回発言のhistory stateを先に消すと、通信開始前の失敗時に再試行できなくなる。
                    if (!accepted) {
                        accepted = true;
                        onAccepted?.();
                    }
                }
                else if (ev.type === 'text') {
                    setLiveText((prev) => prev + ev.delta);
                }
                else if (ev.type === 'progress') {
                    setProgress((prev) => ({ ...prev, phase: ev.phase, message: ev.message }));
                }
                else if (ev.type === 'reasoning_activity') {
                    setProgress((prev) => ({
                        ...prev,
                        phase: 'reasoning',
                        message: 'AIが回答を考えています',
                        reasoningChars: prev.reasoningChars + (ev.deltaChars ?? 0),
                        summary: prev.summary + (ev.summaryDelta ?? ''),
                    }));
                }
                else if (ev.type === 'tool_use') {
                    setLiveTools((prev) => [...prev, { id: ev.toolUseId, name: ev.name, state: 'running' }]);
                }
                else if (ev.type === 'tool_result') {
                    setLiveTools((prev) => prev.map((t) => (
                        t.id === ev.toolUseId ? { ...t, state: ev.isError ? 'error' : 'done' } : t
                    )));
                }
                else if (ev.type === 'warning') {
                    setNotice('ガイドラインに関する警告が出されました。次に同じ要求をすると管理者に報告されます。');
                }
                else if (ev.type === 'violation') {
                    setNotice('ガイドライン違反として管理者に報告されました。以降の会話は監査対象になります。');
                }
                else if (ev.type === 'error') {
                    setError(ev.message);
                }
                else if (ev.type === 'done') {
                    collected.push(ev);
                }
            }, ac.signal);
        }
        catch (e: any) {
            if (e.name !== 'AbortError') {
                setError(e.message ?? '通信に失敗しました。');
            }
        }

        setStreaming(false);
        setLiveText('');
        setLiveTools([]);

        // サーバのログを正として読み直す（ツール実行まで含めて正確に描くため）
        try {
            const res = await fetch(new URL(`/api/llm/conversations/${conversation.id}`, BASEURL).href, {
                credentials: 'include',
            });
            if (res.ok) {
                const fresh = await res.json();
                setTurns(fresh.turns);
            }
        }
        catch (e) { /* 取得できなくても画面は保つ */ }
    }

    function submit (e) {
        e.preventDefault();
        void send(input);
    }

    useEffect(() => {
        const opening = location.state?.opening;
        if (!openingStartedRef.current && turns.length === 0 && typeof opening === 'string') {
            openingStartedRef.current = true;
            void send(opening, () => {
                // navigate(..., replace) はルートを再評価し、進行中のfetchをcleanupで
                // abortすることがある。履歴のstateだけを直接消せば画面遷移は起きない。
                const state = window.history.state;
                window.history.replaceState(
                    state == null ? state : { ...state, usr: null },
                    '',
                    window.location.href,
                );
            });
        }
    }, []);

    const problemId = conversation.problem_id;

    return (
        <main className="llm-chat-page">
            <nav aria-label="breadcrumb" className="llm-chat-crumb">
                <ul>
                    <li><Link to={`/problems/no/${problemId}`}>{conversation.problem_title}</Link></li>
                    <li>AIチャット</li>
                </ul>
            </nav>

            <div className="llm-chat-grid">
                {/* 左: 問題文または、この会話に固定された提出 */}
                <section className="llm-pane">
                    <header className="llm-pane-header llm-context-tabs">
                        <button
                            type="button"
                            className={contextTab === 'problem' ? '' : 'secondary outline'}
                            aria-pressed={contextTab === 'problem'}
                            onClick={() => setContextTab('problem')}
                        >
                            📝 問題文
                        </button>
                        {submission != null && (
                            <button
                                type="button"
                                className={contextTab === 'submission' ? '' : 'secondary outline'}
                                aria-pressed={contextTab === 'submission'}
                                onClick={() => setContextTab('submission')}
                            >
                                💻 提出 #{submission.whole.id}
                            </button>
                        )}
                    </header>
                    <div className="llm-pane-body">
                        {contextTab === 'problem' && (problem == null
                            ? <p>問題文を取得できませんでした。</p>
                            : <>
                                <h4>{problem.title}</h4>
                                <p className="llm-note">
                                    実行時間制限: {problem.time_limit_sec} sec ／ メモリ制限: {problem.memory_limit_kb / 1000} MB
                                </p>
                                <Statement html={problem.statement} />
                            </>)}
                        {contextTab === 'submission' && submission != null && (
                            <>
                                    <p>
                                        <span className={STATUS_COLOR[submission.whole.status]}>
                                            <strong>{submission.whole.status}</strong>
                                        </span>
                                        {' '}／ {submission.whole.code_language}
                                        {' '}／ {toJST(submission.whole.created_at)}
                                    </p>
                                    <AceEditorReadOnly
                                        language={submission.whole.code_language}
                                        value={submission.whole.code}
                                        expand={true}
                                    />
                                    {submission.whole.message && (
                                        <>
                                            <h5>エラーメッセージ</h5>
                                            <pre><code>{submission.whole.message}</code></pre>
                                        </>
                                    )}
                                    {submission.each?.length > 0 && (
                                        <>
                                            <h5>テストケース結果</h5>
                                            <table style={{ whiteSpace: 'nowrap' }}>
                                                <thead>
                                                    <tr><th>名前</th><th>状態</th><th>時間</th></tr>
                                                </thead>
                                                <tbody>
                                                    {submission.each.map((tc, i) => (
                                                        <tr key={i}>
                                                            <td>{tc.testcase_name}</td>
                                                            <td><span className={STATUS_COLOR[tc.status]}>{tc.status}</span></td>
                                                            <td>{tc.time_sec ?? '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </>
                                    )}
                            </>
                        )}
                    </div>
                </section>

                {/* 右: チャット */}
                <section className="llm-pane llm-chat-pane">
                    <header className="llm-pane-header">
                        💬 チャット
                        <span className="llm-note" style={{ marginLeft: '0.5em' }}>{conversation.model}</span>
                    </header>

                    <div className="llm-pane-body llm-chat-log" ref={scrollRef}>
                        <Conversation turns={turns} />

                        {streaming && (
                            <div className="llm-turn llm-turn-assistant">
                                <div className="llm-turn-role">AI</div>
                                <div>
                                    <GenerationProgress progress={progress} tools={liveTools} />
                                    <MessageText text={liveText} />
                                </div>
                            </div>
                        )}

                        {notice !== '' && <p className="pico-color-pumpkin-500">{notice}</p>}
                        {error !== '' && <p className="pico-color-red-500">{error}</p>}
                    </div>

                    <form onSubmit={submit} className="llm-chat-form">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="質問を入力（Ctrl+Enterで送信）"
                            rows={3}
                            disabled={streaming}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    submit(e);
                                }
                            }}
                        />
                        <button
                            type="submit"
                            className="llm-chat-submit"
                            disabled={streaming || input.trim() === ''}
                            aria-busy={streaming ? 'true' : 'false'}
                            aria-label="メッセージを送信"
                        >
                            <span aria-hidden="true">➤</span>
                            <span>送信</span>
                        </button>
                    </form>
                </section>
            </div>
        </main>
    );
}
