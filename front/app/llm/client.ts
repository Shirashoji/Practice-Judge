// LLM APIのクライアント
//
// ストリーミングは fetch + ReadableStream で受ける。
// EventSource はGET専用でメッセージ本文をPOSTできないため使えない。

import { BASEURL } from '../backend_url';

export type LlmEvent =
    | { type: 'meta'; conversationId: number; skillId: string; model: string; modelSource?: string }
    | { type: 'text'; delta: string }
    | { type: 'tool_use'; toolUseId: string; name: string; input: any }
    | { type: 'tool_result'; toolUseId: string; name: string; isError: boolean; summary: string }
    | { type: 'warning'; violationType: string; message: string }
    | { type: 'violation'; violationType: string }
    | { type: 'usage'; costUsd: number; monthCostUsd: number; limitUsd: number | null }
    | { type: 'error'; code: string; message: string; detail?: any }
    | { type: 'done'; stopReason: string };

// ストリーム開始前に返るエラー（未ログイン、共有設定未選択、上限超過など）
export class LlmRequestError extends Error {
    status: number;
    code: string;

    constructor (status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

async function openSSE (path: string, body: any, onEvent: (e: LlmEvent) => void, signal?: AbortSignal) {
    const res = await fetch(new URL(path, BASEURL).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
        signal,
    });

    if (!res.ok) {
        let payload: any = {};
        try {
            payload = await res.json();
        }
        catch (e) {
            // JSONでないエラー応答（プロキシのエラーページなど）
        }
        throw new LlmRequestError(res.status, payload.code ?? 'UNKNOWN', payload.error ?? '通信に失敗しました。');
    }
    if (res.body == null) {
        throw new LlmRequestError(500, 'NO_BODY', '応答が空でした。');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // SSEは空行（\n\n）でイベントが区切られる。
    // チャンクの途中で切れるのでバッファに貯めてから区切りを探す。
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });

        for (;;) {
            const idx = buffer.indexOf('\n\n');
            if (idx === -1) {
                break;
            }
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            let eventName = 'message';
            let data = '';
            for (const line of raw.split('\n')) {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                }
                else if (line.startsWith('data:')) {
                    data += line.slice(5).trim();
                }
            }
            if (data === '') {
                continue;
            }
            try {
                onEvent({ type: eventName, ...JSON.parse(data) } as LlmEvent);
            }
            catch (e) {
                console.error('SSEイベントの解析に失敗しました:', raw, e);
            }
        }
    }
}

// 一方向説明の生成を開始する
export function requestAdvice (
    body: { problemId: number; submissionId?: number; skillId?: string },
    onEvent: (e: LlmEvent) => void,
    signal?: AbortSignal,
) {
    return openSSE('/api/llm/advice', body, onEvent, signal);
}

// 既存の会話にメッセージを送る
export function sendMessage (
    conversationId: number,
    message: string,
    onEvent: (e: LlmEvent) => void,
    signal?: AbortSignal,
) {
    return openSSE(`/api/llm/conversations/${conversationId}/messages`, { message }, onEvent, signal);
}

// ------------------------------------------------------------
// 非ストリーミングのAPI
// ------------------------------------------------------------

async function getJSON (path: string) {
    const res = await fetch(new URL(path, BASEURL).href, { credentials: 'include' });
    if (!res.ok) {
        let payload: any = {};
        try {
            payload = await res.json();
        }
        catch (e) { /* noop */ }
        throw new LlmRequestError(res.status, payload.code ?? 'UNKNOWN', payload.error ?? '取得に失敗しました。');
    }
    return await res.json();
}

async function sendJSON (path: string, method: string, body: any) {
    const res = await fetch(new URL(path, BASEURL).href, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
    });
    if (!res.ok) {
        let payload: any = {};
        try {
            payload = await res.json();
        }
        catch (e) { /* noop */ }
        throw new LlmRequestError(res.status, payload.code ?? 'UNKNOWN', payload.error ?? '更新に失敗しました。');
    }
    return res;
}

export function fetchSettings () {
    return getJSON('/api/llm/settings');
}

export function updateSettings (patch: { shareMode?: string; preferredModel?: string }) {
    return sendJSON('/api/llm/settings', 'PUT', patch);
}

export function fetchConversation (id: number) {
    return getJSON(`/api/llm/conversations/${id}`);
}

export { getJSON as llmGetJSON, sendJSON as llmSendJSON };
