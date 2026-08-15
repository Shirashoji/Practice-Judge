// 問題文のレンダリングを共通化したもの。
//
// problem_page.tsx と problem_editorial.tsx が個別に持っていた
// DOMParser → KaTeX → html-react-parser の経路をここにまとめた。
//
// 元の problem_page.tsx はサンプルのコピー対象を「ライブのdocument全体」から
// 探していたため、1画面に問題文を2箇所描画する（チャット画面のような）状況では
// コピー対象がずれる。ここではコンテナのrefにスコープして探すようにしている。

import { useState, useEffect, useRef } from 'react';
import parse from 'html-react-parser';
import renderMathInElement from '../auto-render';

function SampleCopyButton ({ children, onClick, className }) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return;
        }
        const id = setTimeout(() => setCopied(false), 1000);
        return () => clearTimeout(id);
    }, [copied]);

    const props: any = {
        onClick: (e) => {
            onClick(e);
            setCopied(true);
        },
        className,
        type: 'button',
    };
    if (copied) {
        props['data-tooltip'] = 'コピーしました！';
    }

    return <button {...props}>{children}</button>;
}

export function Statement ({ html }: { html: string }) {
    const containerRef = useRef<HTMLDivElement>(null);

    // サンプルのコピー。コンテナ内だけを探すので、同じ画面に問題文が複数あっても混ざらない。
    async function handleSampleCopy (e) {
        const root = containerRef.current;
        if (root == null) {
            return;
        }
        const pres = root.querySelectorAll('pre.sample');
        for (const pre of pres) {
            if (e.target.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING) {
                await navigator.clipboard.writeText((pre as HTMLElement).innerText);
                break;
            }
        }
    }

    const jsx = (() => {
        if (typeof window === 'undefined' || !html) {
            return null;
        }

        const parser = new DOMParser();
        const dom = parser.parseFromString(html, 'text/html');

        // pre.sample の直前のh3にコピーボタンを差し込む
        for (const pre of dom.querySelectorAll('pre.sample')) {
            const h3 = pre.previousElementSibling;
            if (h3 && h3.tagName === 'H3') {
                h3.innerHTML += '<button class="sample-copy outline secondary">コピー</button>';
            }
        }

        renderMathInElement(dom.body);

        return parse(dom.body.innerHTML, {
            replace (domNode: any) {
                if (domNode.attribs?.class?.includes('sample-copy')) {
                    return (
                        <SampleCopyButton
                            className={domNode.attribs.class}
                            onClick={(e) => handleSampleCopy(e)}
                        >
                            コピー
                        </SampleCopyButton>
                    );
                }
                return undefined;
            },
        });
    })();

    return <div ref={containerRef}>{jsx}</div>;
}

export default Statement;
