// ガードレール
//
// 禁止するのは2つ。
//   1. AC前に直接的な解答（動くコード全体）を渡すこと
//   2. 競技プログラミングと無関係な会話に付き合うこと
//
// 段階的警告の状態はサーバが持つ（llm_conversations.warning_count）。
// モデルに「今が何回目か」を数えさせると取りこぼすので、毎ターンのシステムプロンプトに
// 現在の警告回数を注入し、モデルは「0なら警告のみ / 1以上なら report_violation を呼ぶ」
// と判断するだけでよいようにする。
// さらに report_violation ハンドラ側でも防御的に検査し、警告0回の状態で通報が来たら
// 違反として記録せず警告扱いに落とす（モデルの誤判断で初犯がいきなり記録されるのを防ぐ）。

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

利用者が上記に反する要求をしてきた場合の対応は、**警告回数によって変わります。**

- **警告回数が 0 のとき**: 警告のみを行ってください。
  「直接の解答は教えられません／無関係な会話はできません。次に同じ要求をした場合は管理者に報告します」
  という趣旨を、丁寧かつはっきりと伝えてください。**report_violation ツールは呼ばないでください。**
- **警告回数が 1 以上のとき**: すでに警告済みです。同種の要求が繰り返された場合は
  \`report_violation\` ツールを呼んで報告してください。呼んだうえで、報告した旨を利用者に伝えてください。

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
        `- これまでにこの会話で行った警告の回数: ${ctx.warningCount}`,
    ];

    if (ctx.submissionId != null) {
        lines.push(`- 対象の提出ID: ${ctx.submissionId}（ステータス: ${ctx.submissionStatus ?? '不明'}）`);
    }

    if (ctx.warningCount === 0) {
        lines.push('', '→ まだ警告していません。不正な要求があった場合は**警告のみ**を行い、report_violation は呼ばないでください。');
    }
    else {
        lines.push('', `→ すでに ${ctx.warningCount} 回警告済みです。同種の要求が再度あった場合は report_violation を呼んでください。`);
    }

    return lines.join('\n');
}

// report_violation ツールが呼ばれたときの処理。
// 警告0回のうちは記録せず警告に落とす、という防御をここで効かせる。
// returns: ツールに返す結果オブジェクト
function handleReportViolation (conversationId, userId, violationType, reason, emit) {
    const conv = store.getConversation(conversationId);
    const warningCount = conv?.warning_count ?? 0;

    if (warningCount === 0) {
        // 初犯。記録せずカウンタだけ上げる。
        store.incrementWarning(conversationId);
        if (emit) {
            emit('warning', { violationType, message: '初回のため警告として扱いました。' });
        }
        return {
            recorded: false,
            action: 'warning_only',
            note: 'この利用者への警告はまだ0回だったため、違反としては記録していません。利用者には警告のみを伝え、次に同じ要求があれば報告する旨を明示してください。',
        };
    }

    store.recordViolation({ conversationId, userId, violationType, reason });
    // 違反が記録されたユーザーは、この会話と以降の会話が強制的に共有（管理者が閲覧可能）になる
    store.setForceShared(userId, true);
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
