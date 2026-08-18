// ガードレール
//
// 禁止するのは2つ。
//   1. AC前に直接的な解答（動くコード全体）を渡すこと
//   2. 競技プログラミングと無関係な会話に付き合うこと
//
// 段階的警告の状態はサーバが持つ（llm_warnings）。
// モデルが判断するのは「違反かどうか」だけで、違反なら初回でも必ず report_violation を呼ぶ。
// 何回目かの判定と、警告で済ませるか記録するかの決定は handleReportViolation が行う。
//
// モデル側に「初回は呼ばない」と判断させてはいけない。
// 警告が記録される経路は report_violation だけなので、初回に呼ばせないと件数が
// 永遠に0のままになり、何度違反しても「次は報告します」と言い続けるだけで報告されない。
//
// 警告は会話単位ではなくユーザー単位で数える。会話単位だと、警告されたチャットを閉じて
// 開き直すだけで初回に戻せてしまう。誤警告は管理者が取り消せる（llm_warnings.dismissed）。

const store = require('./store.js');

const COMMON_RULES = `
## 絶対に守るルール

あなたはオンラインジャッジ「Practice Judge」に組み込まれた学習支援AIです。
利用者はプログラミングの初学者です。以下の2点を厳格に守ってください。

### 1. 直接的な解答を与えない（AC前）

利用者がまだこの問題をAC（正解）していない場合、**そのまま提出すれば通るコードを絶対に書かないでください。**
渡してよいのは「鍵」だけです。つまり、考え方の道筋、着目すべき箇所、つまずいている一点を
解くための部分的な部品（入力の受け取り方、特定の構文の使い方など）に限ります。

- 解法そのものを説明してしまう「ヒント」も禁止です
- コードの断片を出す場合も、問題の核心部分は本人に書かせてください
- 「あと少しだから」「本人が理解しているようだから」といった理由で例外を作らないでください

### 2. 無関係な会話に応じない

競技プログラミング、および現在取り組んでいる問題に関係のない話題（雑談、他分野の相談、
一般的な知識の質問など）には応じないでください。

## 違反への対応（段階的）

利用者が上記に反する要求をしてきたら、**初回であっても毎回 \`report_violation\` ツールを呼んでください。**
今が何回目かを自分で数える必要はありません。段階的な警告はサーバが管理しています。

ツールの戻り値の \`action\` を見て、それに沿った文面を書いてください。

- \`action: "warning_only"\`（初回）: まだ記録されていません。
  「直接の解答は教えられません／無関係な会話はできません。次に同じ要求をした場合は管理者に報告します」
  という趣旨を、丁寧かつはっきりと伝えてください。
- \`action: "reported"\`（2回目以降）: 管理者に報告済みです。報告したことと、
  以降の会話が監査対象になることを利用者に伝えてください。

**ツールを呼ばずに「次は報告します」と書くだけにしないでください。**
呼ばなければ警告が記録されず、次に同じ要求が来ても再び初回扱いになります。

要求が上記に反していない限り、警告も報告もしないでください。学習の妨げになります。

## 応答の仕方

- 初学者が読む前提で、1回の返答は簡潔にしてください。箇条書きを活用し、冗長な例え話は避けてください
- 正確な技術用語を使ってください
- 相手の理解度を確認しながら進めてください
`.trim();

// 状況依存の情報。会話ごとに変わるのでシステムプロンプトの末尾に置く
// （プロンプトキャッシュのプレフィックスを壊さないため、可変部分は必ず後ろに置く）。
function situationBlock (ctx) {
    const lines = [
        '## 現在の状況',
        '',
        `- 対象問題ID: ${ctx.problemId}`,
        `- この利用者のこの問題のAC状況: ${ctx.hasAC ? 'AC済み' : '未AC'}`,
        `- この問題への提出回数: ${ctx.submissionCount}`,
        `- この利用者への有効な警告の回数: ${ctx.warningCount}（会話をまたいで数えます）`,
    ];

    if (ctx.violationCount > 0) {
        lines.push(`- この利用者に記録済みの違反の件数: ${ctx.violationCount}`);
    }
    if (ctx.submissionId != null) {
        lines.push(`- 対象の提出ID: ${ctx.submissionId}（ステータス: ${ctx.submissionStatus ?? '不明'}）`);
    }

    if (ctx.warningCount === 0 && ctx.violationCount === 0) {
        lines.push('', '→ まだ警告していません。不正な要求があった場合も report_violation は必ず呼んでください。'
            + 'サーバが初回と判定し、記録せず警告扱い（action: "warning_only"）で返します。');
    }
    else {
        lines.push('', `→ すでに警告済み（${ctx.warningCount}件）または違反が記録済み（${ctx.violationCount}件）です。`
            + '別の会話で行った分も含みます。'
            + '同種の要求が再度あった場合は report_violation を呼んでください。'
            + '今度は違反として記録され、管理者に報告されます（action: "reported"）。');
    }

    return lines.join('\n');
}

// report_violation ツールが呼ばれたときの処理。
// 有効な警告が0件なら違反として記録せず、警告を1件積むだけにする。
// 「何回目か」の判定をここに閉じ込めているので、モデルは違反の有無だけ判断すればよい。
// returns: ツールに返す結果オブジェクト
function handleReportViolation (conversationId, userId, violationType, reason, emit) {
    // 取り消されていない警告と違反の件数で判断する。管理者が誤検知を取り消していれば0に戻る。
    // 違反も見るのは、警告だけを取り消した場合に、報告済みの利用者が
    // 「まだ一度も警告されていない人」と同じ扱いに戻ってしまうのを防ぐため。
    const warningCount = store.activeWarningCount(userId);
    const violationCount = store.activeViolationCount(userId);

    if (warningCount === 0 && violationCount === 0) {
        // 初回。違反としては記録せず、警告だけを残す。
        store.recordWarning({ conversationId, userId, violationType, reason });
        store.incrementWarning(conversationId);
        if (emit) {
            emit('warning', { violationType, message: '初回のため警告として扱いました。' });
        }
        return {
            recorded: false,
            action: 'warning_only',
            note: 'この利用者への有効な警告・違反はまだ0件だったため、違反としては記録していません。利用者には警告のみを伝え、次に同じ要求があれば報告する旨を明示してください。',
        };
    }

    store.recordViolation({ conversationId, userId, violationType, reason });
    // 違反が記録されたユーザーは、この会話と以降の会話が強制的に共有（管理者が閲覧可能）になる。
    // 以降の会話は作成時に設定を読むので setForceShared で足りるが、
    // 当の会話は作成済みなので、その行の forced_shared も直接立てる必要がある。
    store.setForceShared(userId, true);
    store.setConversationForcedShared(conversationId);
    store.incrementWarning(conversationId);

    if (emit) {
        emit('violation', { violationType });
    }
    return {
        recorded: true,
        action: 'reported',
        violation_type: violationType,
        note: '管理者に報告しました。この会話は監査対象になります。利用者にもその旨を伝えてください。',
    };
}

module.exports = { COMMON_RULES, situationBlock, handleReportViolation };
