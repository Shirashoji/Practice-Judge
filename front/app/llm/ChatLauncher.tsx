import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { createConversation, fetchSettings } from './client';
import { ShareModeGate } from './ShareModeGate';

export function ChatLauncher ({ problemId, submissionId, skillId, onClose }: any) {
    const [settings, setSettings] = useState<any>(null);
    const [model, setModel] = useState('auto');
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        fetchSettings().then((s) => {
            setSettings(s);
            setModel(s.preferredModel ?? 'auto');
        }).catch((e) => setError(e.message ?? '設定の取得に失敗しました。'));
    }, []);

    async function start () {
        setStarting(true);
        setError('');
        try {
            const result = await createConversation({ problemId, submissionId, skillId, model });
            navigate(`/llm/chat/${result.conversationId}`, {
                state: { opening: result.opening },
            });
        }
        catch (e: any) {
            setError(e.message ?? '会話を開始できませんでした。');
            setStarting(false);
        }
    }

    if (settings == null) {
        return <article aria-busy="true">読み込み中...</article>;
    }
    if (settings.shareMode == null) {
        return <ShareModeGate budget={settings.budget} onDone={() => fetchSettings().then(setSettings)} onCancel={onClose} />;
    }

    return (
        <article className="llm-advice">
            <header className="llm-advice-header">
                <strong>AIチャットを開始</strong>
                {onClose && <button type="button" className="secondary outline button-small-padding" onClick={onClose}>閉じる</button>}
            </header>
            <label>
                使用するAIモデル
                <select value={model} disabled={starting} onChange={(e) => setModel(e.target.value)}>
                    <option value="auto">おまかせ（問題の難易度に応じて選択）</option>
                    {settings.allowedModels.map((m: any) => (
                        <option key={m.model} value={m.model}>{m.model}</option>
                    ))}
                </select>
            </label>
            <p className="llm-note">モデルは会話の途中では変更できません。</p>
            <button type="button" disabled={starting} aria-busy={starting ? 'true' : 'false'} onClick={start}>
                チャットで相談を始める
            </button>
            {error && <p className="pico-color-red-500">{error}</p>}
        </article>
    );
}
