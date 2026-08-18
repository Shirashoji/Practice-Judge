// チャット専用画面。
//
// 問題文・該当の提出（コードと実行結果）・チャットを同時に見られるようにする。
// 一方向説明から遷移してきたときは、その1ターン目が履歴としてそのまま引き継がれる。

import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import "katex/dist/katex.min.css";
import { BASEURL } from "../backend_url";
import { AceEditorReadOnly } from "../ace_editor";
import { toJST } from "../utils";
import { Statement } from "../llm/Statement";
import { Conversation, MessageText } from "../llm/Message";
import { sendMessage } from "../llm/client";
import {
  GenerationProgress,
  INITIAL_PROGRESS,
  type ProgressState,
} from "../llm/GenerationProgress";

export function meta({ data }: any) {
  const title = data?.conversation?.problem_title ?? "会話";
  return [{ title: `AIチャット: ${title} - Practice Judge` }];
}

export function ErrorBoundary({ error }) {
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

export async function clientLoader({ params }) {
  const convRes = await fetch(
    new URL(`/api/llm/conversations/${params.conversationId}`, BASEURL).href,
    {
      credentials: "include",
    },
  );
  if (!convRes.ok) {
    throw new Error("会話が見つかりません。");
  }
  const data = await convRes.json();

  // 問題文（未公開問題は管理者のみ見られる）
  const probRes = await fetch(
    new URL(`/api/problems/no/${data.conversation.problem_id}`, BASEURL).href,
    {
      credentials: "include",
    },
  );
  const problem = probRes.ok ? await probRes.json() : null;

  // 対象の提出（あれば）
  let submission = null;
  if (data.conversation.submission_id != null) {
    const subRes = await fetch(
      new URL(
        `/api/problems/no/${data.conversation.problem_id}/submissions/${data.conversation.submission_id}`,
        BASEURL,
      ).href,
      { credentials: "include" },
    );
    if (subRes.ok) {
      submission = await subRes.json();
    }
  }

  return { ...data, problem, submission };
}

const STATUS_COLOR = {
  AC: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  WA: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  TLE: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  RE: "text-rose-300 bg-rose-400/10 border-rose-400/20",
  CE: "text-rose-300 bg-rose-400/10 border-rose-400/20",
  MLE: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  OLE: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  IE: "text-red-300 bg-red-400/10 border-red-400/20",
};

export default function LlmChat({ loaderData }) {
  const { conversation, problem, submission } = loaderData;

  const [turns, setTurns] = useState<any[]>(loaderData.turns ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<any[]>([]);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [contextTab, setContextTab] = useState(
    submission == null ? "problem" : "submission",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  async function send(rawMessage: string, onAccepted?: () => void) {
    const message = rawMessage.trim();
    if (message === "" || streaming) {
      return;
    }

    // 送信した発言をすぐ画面に出す（サーバ側でも同じ内容が保存される）
    setTurns((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: message }],
      },
    ]);
    setInput("");
    setStreaming(true);
    setLiveText("");
    setLiveTools([]);
    setProgress(INITIAL_PROGRESS);
    setError("");
    setNotice("");

    const ac = new AbortController();
    abortRef.current = ac;

    const collected: any[] = [];
    let accepted = false;

    try {
      await sendMessage(
        conversation.id,
        message,
        (ev: any) => {
          if (ev.type === "meta") {
            // SSEが開き、サーバが発言を受理したことを確認してから呼び出す。
            // 初回発言のhistory stateを先に消すと、通信開始前の失敗時に再試行できなくなる。
            if (!accepted) {
              accepted = true;
              onAccepted?.();
            }
          } else if (ev.type === "text") {
            setLiveText((prev) => prev + ev.delta);
          } else if (ev.type === "progress") {
            setProgress((prev) => ({
              ...prev,
              phase: ev.phase,
              message: ev.message,
            }));
          } else if (ev.type === "reasoning_activity") {
            setProgress((prev) => ({
              ...prev,
              phase: "reasoning",
              message: "AIが回答を考えています",
              reasoningChars: prev.reasoningChars + (ev.deltaChars ?? 0),
              summary: prev.summary + (ev.summaryDelta ?? ""),
            }));
          } else if (ev.type === "tool_use") {
            setLiveTools((prev) => [
              ...prev,
              { id: ev.toolUseId, name: ev.name, state: "running" },
            ]);
          } else if (ev.type === "tool_result") {
            setLiveTools((prev) =>
              prev.map((t) =>
                t.id === ev.toolUseId
                  ? { ...t, state: ev.isError ? "error" : "done" }
                  : t,
              ),
            );
          } else if (ev.type === "warning") {
            setNotice(
              "ガイドラインに関する警告が出されました。次に同じ要求をすると管理者に報告されます。",
            );
          } else if (ev.type === "violation") {
            setNotice(
              "ガイドライン違反として管理者に報告されました。以降の会話は監査対象になります。",
            );
          } else if (ev.type === "error") {
            setError(ev.message);
          } else if (ev.type === "done") {
            collected.push(ev);
          }
        },
        ac.signal,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setError(e.message ?? "通信に失敗しました。");
      }
    }

    setStreaming(false);
    setLiveText("");
    setLiveTools([]);

    // サーバのログを正として読み直す（ツール実行まで含めて正確に描くため）
    try {
      const res = await fetch(
        new URL(`/api/llm/conversations/${conversation.id}`, BASEURL).href,
        {
          credentials: "include",
        },
      );
      if (res.ok) {
        const fresh = await res.json();
        setTurns(fresh.turns);
      }
    } catch (e) {
      /* 取得できなくても画面は保つ */
    }
  }

  function submit(e) {
    e.preventDefault();
    void send(input);
  }

  useEffect(() => {
    const opening = location.state?.opening;
    if (
      !openingStartedRef.current &&
      turns.length === 0 &&
      typeof opening === "string"
    ) {
      openingStartedRef.current = true;
      void send(opening, () => {
        // navigate(..., replace) はルートを再評価し、進行中のfetchをcleanupで
        // abortすることがある。履歴のstateだけを直接消せば画面遷移は起きない。
        const state = window.history.state;
        window.history.replaceState(
          state == null ? state : { ...state, usr: null },
          "",
          window.location.href,
        );
      });
    }
  }, []);

  const problemId = conversation.problem_id;
  const memoryLimitMb =
    problem?.memory_kb != null && Number.isFinite(Number(problem.memory_kb))
      ? Number(problem.memory_kb) / 1000
      : null;

  return (
    <main className="h-full overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.08),transparent_35%)] p-2 dark:bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.13),transparent_35%)] md:p-4">
      <div className="grid h-full min-h-0 grid-rows-[minmax(12rem,38%)_minmax(0,1fr)] gap-2 md:gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(26rem,1.08fr)] lg:grid-rows-1">
        {/* 左: 問題文または、この会話に固定された提出 */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/85 shadow-xl shadow-slate-200/60 dark:border-white/10 dark:bg-slate-900/70 dark:shadow-2xl dark:shadow-black/20">
          <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 dark:border-white/10 md:px-5">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-950/60">
              <button
                type="button"
                className={`!m-0 !w-auto !rounded-lg !border-0 !px-3 !py-2 !text-xs !font-semibold !shadow-none transition ${contextTab === "problem" ? "!bg-indigo-600 !text-white dark:!bg-indigo-500" : "!bg-transparent !text-slate-500 hover:!bg-white hover:!text-slate-900 dark:!text-slate-400 dark:hover:!bg-white/5 dark:hover:!text-white"}`}
                aria-pressed={contextTab === "problem"}
                onClick={() => setContextTab("problem")}
              >
                問題文
              </button>
              {submission != null && (
                <button
                  type="button"
                  className={`!m-0 !w-auto !rounded-lg !border-0 !px-3 !py-2 !text-xs !font-semibold !shadow-none transition ${contextTab === "submission" ? "!bg-indigo-600 !text-white dark:!bg-indigo-500" : "!bg-transparent !text-slate-500 hover:!bg-white hover:!text-slate-900 dark:!text-slate-400 dark:hover:!bg-white/5 dark:hover:!text-white"}`}
                  aria-pressed={contextTab === "submission"}
                  onClick={() => setContextTab("submission")}
                >
                  提出 #{submission.whole.id}
                </button>
              )}
            </div>
            <Link
              to={`/problems/no/${problemId}`}
              className="min-w-0 truncate text-xs font-medium !text-slate-500 !no-underline hover:!text-indigo-600 dark:!text-slate-400 dark:hover:!text-indigo-300"
            >
              問題ページへ ↗
            </Link>
          </header>
          <div className="llm-context-content min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 text-sm text-slate-700 dark:text-slate-300 md:p-6">
            {contextTab === "problem" &&
              (problem == null ? (
                <p className="text-slate-400">問題文を取得できませんでした。</p>
              ) : (
                <>
                  <h1 className="!mb-3 !text-xl !font-bold !tracking-tight !text-slate-950 dark:!text-white md:!text-2xl">
                    {problem.title}
                  </h1>
                  <div className="mb-6 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-white/10 dark:bg-white/5">
                      時間 {problem.time_limit_sec} sec
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-white/10 dark:bg-white/5">
                      メモリ{" "}
                      {memoryLimitMb == null ? "—" : `${memoryLimitMb} MB`}
                    </span>
                  </div>
                  <Statement html={problem.statement} />
                </>
              ))}
            {contextTab === "submission" && submission != null && (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span
                    className={`rounded-full border px-3 py-1 font-bold ${STATUS_COLOR[submission.whole.status]}`}
                  >
                    {submission.whole.status}
                  </span>
                  <span>{submission.whole.code_language}</span>
                  <span className="text-slate-600">•</span>
                  <span>{toJST(submission.whole.created_at)}</span>
                </div>
                <AceEditorReadOnly
                  language={submission.whole.code_language}
                  value={submission.whole.code}
                  expand={true}
                />
                {submission.whole.message && (
                  <>
                    <h2 className="!mt-5 !text-sm !font-bold !text-rose-300">
                      エラーメッセージ
                    </h2>
                    <pre>
                      <code>{submission.whole.message}</code>
                    </pre>
                  </>
                )}
                {submission.each?.length > 0 && (
                  <>
                    <h2 className="!mt-5 !text-sm !font-bold !text-slate-950 dark:!text-white">
                      テストケース結果
                    </h2>
                    <table style={{ whiteSpace: "nowrap" }}>
                      <thead>
                        <tr>
                          <th>名前</th>
                          <th>状態</th>
                          <th>時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submission.each.map((tc, i) => (
                          <tr key={i}>
                            <td>{tc.testcase_name}</td>
                            <td>
                              <span className={STATUS_COLOR[tc.status]}>
                                {tc.status}
                              </span>
                            </td>
                            <td>{tc.time_sec ?? "-"}</td>
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
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white/90 shadow-xl shadow-indigo-100/60 dark:border-indigo-400/15 dark:bg-slate-900/80 dark:shadow-2xl dark:shadow-indigo-950/20">
          <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-white/10 md:px-6">
            <div className="min-w-0">
              <h2 className="!m-0 truncate !text-sm !font-bold !text-slate-950 dark:!text-white md:!text-base">
                {conversation.problem_title}
              </h2>
              <p className="!m-0 mt-0.5 !text-[10px] !font-semibold uppercase !tracking-[0.16em] !text-slate-500">
                AI learning session
              </p>
            </div>
            <span className="ml-3 shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-200">
              {conversation.model}
            </span>
          </header>

          <div
            className="llm-chat-log min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 md:px-6"
            ref={scrollRef}
          >
            <Conversation turns={turns} />

            {streaming && (
              <div className="llm-turn llm-turn-assistant">
                <div className="llm-turn-role">AI Tutor</div>
                <div>
                  <GenerationProgress progress={progress} tools={liveTools} />
                  <MessageText text={liveText} />
                </div>
              </div>
            )}

            {notice !== "" && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
                {notice}
              </p>
            )}
            {error !== "" && (
              <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={submit}
            className="!m-0 shrink-0 border-t border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-slate-950/50 md:p-4"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-inner transition focus-within:border-indigo-400/60 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:border-white/10 dark:bg-slate-950/80">
              <textarea
                className="!m-0 !min-h-16 !flex-1 !resize-none !border-0 !bg-transparent !px-3 !py-2 !text-sm !text-slate-800 !shadow-none !outline-none placeholder:!text-slate-400 focus:!ring-0 dark:!text-slate-100 dark:placeholder:!text-slate-600"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="わからないことを質問してみましょう"
                rows={2}
                disabled={streaming}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    submit(e);
                  }
                }}
              />
              <button
                type="submit"
                className="!m-0 grid !size-12 shrink-0 place-items-center !rounded-xl !border-0 !bg-indigo-500 !p-0 !text-white !shadow-lg !shadow-indigo-950/50 transition hover:!bg-indigo-400 disabled:!bg-slate-800 disabled:!text-slate-600"
                disabled={streaming || input.trim() === ""}
                aria-busy={streaming ? "true" : "false"}
                aria-label="メッセージを送信"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-5 fill-none stroke-current"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
            <p className="!m-0 mt-2 text-center !text-[10px] !text-slate-600">
              Ctrl / ⌘ + Enter で送信
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
