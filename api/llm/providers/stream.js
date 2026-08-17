// Anthropic SDKのMessageStreamに寄せた最小のストリームオブジェクト
//
// 呼び出し側（llm.js）が使うのは on('text') と finalMessage() の2つだけなので、
// 他プロバイダのアダプタもこの2つだけ提供すれば同じループに載せられる。
//
// 実際の送信は finalMessage() が呼ばれるまで開始しない。
// llm.js は「stream生成 → on('text')登録 → await finalMessage()」の順に使うので、
// 生成時点で走らせるとハンドラ登録前のデルタを取りこぼしうる。

// run(emitText, emitReasoning) は Anthropic形式のメッセージ
// { content, stop_reason, model, usage } を解決するPromiseを返す非同期関数。
function makeStream (run) {
    const handlers = new Map();
    let started = null;

    return {
        on (event, handler) {
            if (!handlers.has(event)) {
                handlers.set(event, []);
            }
            handlers.get(event).push(handler);
            return this;
        },

        finalMessage () {
            if (started == null) {
                started = run((delta) => {
                    for (const h of handlers.get('text') ?? []) {
                        h(delta);
                    }
                }, (activity) => {
                    for (const h of handlers.get('reasoning') ?? []) {
                        h(activity);
                    }
                });
            }
            return started;
        },
    };
}

module.exports = { makeStream };
