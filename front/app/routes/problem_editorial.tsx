import type { Route } from "./+types/problem_editorial";
import { useState, useEffect } from "react";
import { Link } from "react-router";
import { BASEURL } from '../backend_url';
import "katex/dist/katex.min.css";
import parse, { Element as HtmlElement, Text as HtmlText } from 'html-react-parser';
import renderMathInElement from '../auto-render';
import { AceEditorReadOnly } from '../ace_editor';

export function meta({ data }: Route.MetaArgs) {
    let title = "問題が見つかりません";
    if (data?.title != null) {
        title = `解説 ${data.title}`;
    }

    return [
        { title: `${title} - Practice Judge` },
    ];
}

export function ErrorBoundary ({ error }: Route.ErrorBoundaryProps) {
    let msg = "不明なエラー";
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

export async function clientLoader ({ params }: Route.ClientLoaderArgs) {
    const res = await fetch(new URL(`/api/problems/no/${params.problemId}/editorial`, BASEURL).href, {
        credentials: "include",
    });

    // 問題が見つからなければErrorBoundaryに投げる
    if (!res.ok) {
        throw new Error("問題が見つかりません。");
    }

    return await res.json();
}

export default function Editorial ({ params, loaderData }: Route.ComponentProps) {
    const problem = loaderData;

    // DOMパース -> <code editor language="text"></code>部分をaceeditorに置換
    const parser = new DOMParser();
    const problemDOM = parser.parseFromString(problem.editorial, "text/html");
    renderMathInElement(problemDOM.body);

    const editorialJSX = parse(problemDOM.body.innerHTML, {
        replace (domNode) {
            if (domNode instanceof HtmlElement && domNode.name == "code") {
                // 属性editorの確認
                const hasEditor = domNode?.attribs?.hasOwnProperty("editor");
                if (hasEditor == null || !hasEditor) {
                    return;
                }

                // languageの取得
                const language = domNode?.attribs?.language ?? "text";

                // <code editor>の中身はテキストのはず。そうでなければ置換しない。
                const body = domNode.children[0];
                if (!(body instanceof HtmlText)) {
                    return;
                }

                return (
                    <AceEditorReadOnly
                        language={language}
                        value={body.data}
                        expand={true}
                    />
                );
            }
            return;
        }
    });

    // parseは、空なら[]、要素1つならその要素、テキストだけなら文字列を返す。
    // 長さを見られるのは配列と文字列のときだけ。
    const isEmptyEditorial = (Array.isArray(editorialJSX) || typeof editorialJSX === "string")
        && editorialJSX.length == 0;

    return (
        <main className="container">
            <article>
                <h2><Link to={`/problems/no/${params.problemId}`}>{problem.title}{!problem.is_published && <span className="pico-color-red-450">（非公開）</span>}</Link> 解説</h2>

                <hr />

                {isEmptyEditorial ? "この問題には解説がありません。" : editorialJSX}
            </article>
        </main>
    );
}
