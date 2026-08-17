// チャット1件分の描画。
//
import { isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

type CodeElementProps = {
    className?: string;
    children?: unknown;
};

// CommonMarkでは、句読点から始まる **強調** が日本語の文字に挟まれていると
// delimiterとして認識されないことがある。通常のMarkdown処理後にtextのまま残った
// 記法だけをstrongへ変換する（code / inlineCodeの中はtextノードではないので対象外）。
function remarkCjkStrongFallback () {
    return (tree: any) => {
        function visit (node: any) {
            if (!Array.isArray(node.children)) {
                return;
            }

            const children = [];
            for (const child of node.children) {
                if (child.type !== 'text' || !child.value.includes('**')) {
                    visit(child);
                    children.push(child);
                    continue;
                }

                const re = /\*\*(?=\S)(.+?\S)\*\*/g;
                let last = 0;
                let match: RegExpExecArray | null;
                while ((match = re.exec(child.value)) !== null) {
                    if (match.index > last) {
                        children.push({ type: 'text', value: child.value.slice(last, match.index) });
                    }
                    children.push({
                        type: 'strong',
                        children: [{ type: 'text', value: match[1] }],
                    });
                    last = match.index + match[0].length;
                }

                if (last === 0) {
                    children.push(child);
                }
                else if (last < child.value.length) {
                    children.push({ type: 'text', value: child.value.slice(last) });
                }
            }
            node.children = children;
        }

        visit(tree);
    };
}

function MarkdownCodeBlock ({ children }: { children?: ReactNode }) {
    if (!isValidElement(children)) {
        return <pre>{children}</pre>;
    }

    const code = children as ReactElement<CodeElementProps>;
    const className = code.props.className ?? '';
    const match = /(?:^|\s)language-([\w+#-]+)/i.exec(className);
    const language = FENCE_LANGUAGE[(match?.[1] ?? '').toLowerCase()] ?? 'text';
    const value = String(code.props.children ?? '').replace(/\n$/, '');

    return (
        <div className="llm-markdown-code">
            <AceEditorReadOnly language={language} value={value} expand={true} />
        </div>
    );
}

export function MessageText ({ text }: { text: string }) {
    return (
        <div className="llm-markdown">
            <Markdown
                remarkPlugins={[remarkGfm, remarkCjkStrongFallback]}
                components={{
                    pre: MarkdownCodeBlock,
                    a: ({ children, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
                    ),
                }}
            >
                {text}
            </Markdown>
        </div>
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
