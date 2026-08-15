// チャット1件分の描画。
//
// Markdownライブラリは入れていない。LLMの出力で表示上重要なのは実質コードブロックだけで、
// そこは既存の AceEditorReadOnly に流したほうが初学者にとって読みやすい。
// 本文は white-space: pre-wrap の素のテキストとして出す。

import { useState } from 'react';
import { AceEditorReadOnly } from '../ace_editor';

// コードフェンスの言語表記を、このジャッジが扱う言語名に寄せる
const FENCE_LANGUAGE: Record<string, string> = {
    c: 'C',
    cpp: 'C++',
    'c++': 'C++',
    d: 'D',
    python: 'Python3',
    python3: 'Python3',
    py: 'Python3',
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    html: 'html',
};

// ```lang ... ``` で分割する
function splitFences (text: string) {
    const parts: Array<{ type: 'text' | 'code'; body: string; language?: string }> = [];
    const re = /```([\w+#-]*)\n?([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
        if (m.index > last) {
            parts.push({ type: 'text', body: text.slice(last, m.index) });
        }
        parts.push({
            type: 'code',
            language: FENCE_LANGUAGE[(m[1] || '').toLowerCase()] ?? 'text',
            body: m[2].replace(/\n$/, ''),
        });
        last = m.index + m[0].length;
    }
    if (last < text.length) {
        parts.push({ type: 'text', body: text.slice(last) });
    }
    return parts;
}

export function MessageText ({ text }: { text: string }) {
    return (
        <>
            {splitFences(text).map((part, i) => {
                if (part.type === 'code') {
                    return (
                        <div key={i} style={{ margin: '0.5em 0' }}>
                            <AceEditorReadOnly language={part.language} value={part.body} expand={true} />
                        </div>
                    );
                }
                if (part.body.trim() === '') {
                    return null;
                }
                return (
                    <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0.4em 0' }}>
                        {part.body.trim()}
                    </p>
                );
            })}
        </>
    );
}

// ツールの実行を折りたたんで見せる。既定は閉じておき、押すと引数と結果が見える。
function ToolCall ({ name, input, result, isError }: any) {
    const [open, setOpen] = useState(false);

    return (
        <div className="llm-tool">
            <button
                type="button"
                className="llm-tool-toggle"
                onClick={() => setOpen(!open)}
            >
                {isError ? '⚠️' : '🔧'} {name}
                <span className="llm-tool-hint">{open ? '（閉じる）' : '（詳細）'}</span>
            </button>
            {open && (
                <div className="llm-tool-detail">
                    <div><strong>引数</strong></div>
                    <pre><code>{JSON.stringify(input ?? {}, null, 2)}</code></pre>
                    {result !== undefined && (
                        <>
                            <div><strong>結果</strong></div>
                            <pre><code>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</code></pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// turn.content（Messages APIのcontent配列）をそのまま描画する。
// ログから復元したものもストリーミング中のものも同じ形なので、同じ処理で描ける。
export function Turn ({ role, content, toolResults }: any) {
    const blocks = Array.isArray(content) ? content : [];

    const texts = blocks.filter((b) => b.type === 'text');
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const onlyToolResults = blocks.length > 0 && blocks.every((b) => b.type === 'tool_result');

    // ツール結果だけのuserターンは、直前のassistantターンのツール呼び出しに畳んで見せるので
    // 単体では描画しない
    if (onlyToolResults) {
        return null;
    }
    if (texts.length === 0 && toolUses.length === 0) {
        return null;
    }

    const isUser = role === 'user';

    return (
        <div className={isUser ? 'llm-turn llm-turn-user' : 'llm-turn llm-turn-assistant'}>
            <div className="llm-turn-role">{isUser ? 'あなた' : 'AI'}</div>
            <div>
                {texts.map((b, i) => <MessageText key={i} text={b.text} />)}
                {toolUses.map((b) => (
                    <ToolCall
                        key={b.id}
                        name={b.name}
                        input={b.input}
                        result={toolResults?.[b.id]}
                        isError={toolResults?.[`${b.id}__isError`]}
                    />
                ))}
            </div>
        </div>
    );
}

// 会話全体（turnsの配列）を描画する。
// tool_result は tool_use_id をキーに引けるようにしてから渡す。
export function Conversation ({ turns }: { turns: any[] }) {
    const resultMap: any = {};
    for (const t of turns) {
        for (const b of (t.content ?? [])) {
            if (b.type === 'tool_result') {
                let parsed = b.content;
                try {
                    parsed = JSON.parse(b.content);
                }
                catch (e) { /* 文字列のまま表示する */ }
                resultMap[b.tool_use_id] = parsed;
                resultMap[`${b.tool_use_id}__isError`] = b.is_error === true;
            }
        }
    }

    return (
        <>
            {turns.map((t, i) => (
                <Turn key={t.id ?? i} role={t.role} content={t.content} toolResults={resultMap} />
            ))}
        </>
    );
}

export default Conversation;
