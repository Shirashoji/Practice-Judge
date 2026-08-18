import { useEffect, useState } from 'react';

const TOOL_LABELS: Record<string, string> = {
    list_problem_submissions: '提出履歴',
    get_submission: '提出内容・実行結果',
    get_problem_constraints: '問題文・制約',
    check_ac_status: 'AC状況',
    get_editorial: '公式解説',
    get_language_usage: '使用言語',
    report_violation: 'ガイドライン',
};

export type ProgressState = {
    phase: string;
    message: string;
    reasoningChars: number;
    summary: string;
};

export const INITIAL_PROGRESS: ProgressState = {
    phase: 'requesting_model',
    message: 'AIモデルへ送信しています',
    reasoningChars: 0,
    summary: '',
};

export function GenerationProgress ({ progress, tools = [] }: {
    progress: ProgressState;
    tools?: Array<{ id: string; name: string; state: string }>;
}) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, []);

    return (
        <div className="llm-generation-progress" aria-live="polite">
            <p aria-busy="true" className="llm-progress-status">
                {progress.message} <span className="llm-note">（{elapsed}秒）</span>
            </p>
            {progress.reasoningChars > 0 && (
                <p className="llm-note">推論出力を受信中: {progress.reasoningChars.toLocaleString()}文字</p>
            )}
            {progress.summary !== '' && (
                <details>
                    <summary>考え方の要約</summary>
                    <p>{progress.summary}</p>
                </details>
            )}
            {tools.length > 0 && (
                <div className="llm-tool-strip">
                    {tools.map((tool) => (
                        <span key={tool.id} className={tool.state === 'error' ? 'llm-chip llm-chip-error' : 'llm-chip'}>
                            {tool.state === 'running' ? '⏳' : (tool.state === 'error' ? '⚠️' : '✅')}
                            {' '}{TOOL_LABELS[tool.name] ?? tool.name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
