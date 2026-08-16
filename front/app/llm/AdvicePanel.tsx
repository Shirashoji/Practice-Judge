// 一方向説明のパネル。
//
// 導線（問題ページの「解き方のヒント」、提出ページの「ヒント」「改善提案」）を押すと
// まずこれがその場で開き、AIが一方的に説明する。
// 説明が終わったら下部に「チャットでさらに質問する」が出て、専用画面へ引き継げる。

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { requestAdvice, fetchSettings, LlmRequestError } from './client';
import { MessageText } from './Message';
import { ShareModeGate } from './ShareModeGate';

// props: { problemId, submissionId?, skillId?, onClose }
export function AdvicePanel ({ problemId, submissionId, skillId, onClose }: any) {
    const [phase, setPhase] = useState('loading'); // loading | gate | streaming | done | error
    const [budget, setBudget] = useState<any>(null);
    const [text, setText] = useState('');
    const [tools, setTools] = useState<any[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const abortRef = useRef<AbortController | null>(null);
    const startedRef = useRef(false);

    async function start () {
        setPhase('streaming');
        setText('');
        setTools([]);
        setError('');

        const ac = new AbortController();
        abortRef.current = ac;

        try {
            await requestAdvice({ problemId, submissionId, skillId }, (e: any) => {
                if (e.type === 'meta') {
                    setConversationId(e.conversationId);
                }
                else if (e.type === 'text') {
                    setText((prev) => prev + e.delta);
                }
                else if (e.type === 'tool_use') {
                    setTools((prev) => [...prev, { id: e.toolUseId, name: e.name, state: 'running' }]);
                }
                else if (e.type === 'tool_result') {
                    setTools((prev) => prev.map((t) => (
                        t.id === e.toolUseId ? { ...t, state: e.isError ? 'error' : 'done', summary: e.summary } : t
                    )));
                }
                else if (e.type === 'warning' || e.type === 'violation') {
                    // 警告・違反は本文にAIの説明が出るので、ここでは印だけ残す
                    setTools((prev) => [...prev, { id: `w${prev.length}`, name: '⚠️ ガイドライン', state: 'error', summary: e.type === 'violation' ? '管理者に報告されました' : '警告' }]);
                }
                else if (e.type === 'rolled_back') {
                    // 応答が無かったのでサーバ側が会話を巻き戻した。
                    // 消えた会話へ「チャットでさらに質問する」を出すと404になるので、IDを捨てる。
                    if (e.conversationRemoved) {
                        setConversationId(null);
                    }
                }
                else if (e.type === 'error') {
                    setError(e.message);
                }
            }, ac.signal);
            setPhase('done');
        }
        catch (e: any) {
            if (e.name === 'AbortError') {
                return;
            }
            if (e instanceof LlmRequestError && e.code === 'SHARE_MODE_UNSET') {
                setPhase('gate');
                return;
            }
            setError(e.message ?? '通信に失敗しました。');
            setPhase('error');
        }
    }

    useEffect(() => {
        // Reactの開発時2回マウントで2重にリクエストしないようにする
        if (startedRef.current) {
            return;
        }
        startedRef.current = true;

        (async () => {
            try {
                const s = await fetchSettings();
                setBudget(s.budget);
                if (!s.available) {
                    setError('この環境ではAI学習支援が有効になっていません。');
                    setPhase('error');
                    return;
                }
                if (s.shareMode == null) {
                    setPhase('gate');
                    return;
                }
                await start();
            }
            catch (e: any) {
                setError(e.message ?? '設定の取得に失敗しました。');
                setPhase('error');
            }
        })();

        return () => abortRef.current?.abort();
    }, []);

    if (phase === 'loading') {
        return <article aria-busy="true">読み込み中...</article>;
    }

    if (phase === 'gate') {
        return (
            <ShareModeGate
                budget={budget}
                onDone={() => { start(); }}
                onCancel={onClose}
            />
        );
    }

    return (
        <article className="llm-advice">
            <header className="llm-advice-header">
                <strong>AIからのアドバイス</strong>
                {onClose && (
                    <button type="button" className="secondary outline button-small-padding" onClick={onClose}>
                        閉じる
                    </button>
                )}
            </header>

            {tools.length > 0 && (
                <div className="llm-tool-strip">
                    {tools.map((t) => (
                        <span key={t.id} className={t.state === 'error' ? 'llm-chip llm-chip-error' : 'llm-chip'}>
                            {t.state === 'running' ? '⏳' : (t.state === 'error' ? '⚠️' : '✅')} {t.name}
                        </span>
                    ))}
                </div>
            )}

            {text === '' && phase === 'streaming' && <p aria-busy="true">考えています...</p>}
            <MessageText text={text} />

            {error !== '' && <p className="pico-color-red-500">{error}</p>}

            {phase === 'done' && conversationId != null && (
                <footer>
                    <button type="button" onClick={() => navigate(`/llm/chat/${conversationId}`)}>
                        チャットでさらに質問する
                    </button>
                    <p className="llm-note">
                        問題文と提出内容を並べて見ながら、続けて質問できます。
                    </p>
                </footer>
            )}
        </article>
    );
}

export default AdvicePanel;
