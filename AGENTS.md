# AGENTS.md

プログラミング初学者向けのオンラインジャッジ。「ジャッジ」「API」「フロント」の3パーツからなる。

起動方法・環境変数・言語の追加手順は [README.md](README.md) にある。
このファイルには、**コードを変更するときの規約と、踏みやすい落とし穴**だけを書く。

## このリポジトリの位置づけ

`upstream` が本家（InTheBloom/Practice-Judge）、`origin` はフォーク（Shirashoji/Practice-Judge）。

**既存ファイルの削除や仕様の置き換えは提案に留め、互換性を保つ変更を優先する。**
（例: 従来の `start.sh` は消さずに `start-native.sh` へ改名して残してある）

## よく使うコマンド

```sh
docker compose up                  # 開発モード（front:5173 / api:8181、ソースはバインドマウント）
docker compose -f compose.yaml up -d   # 本番相当（front:3000、overrideを読まない）
docker compose run --rm -e SEED=1 db-init   # 初回のシードデータ投入

docker compose build judge && docker compose up -d judge   # ジャッジの変更を反映
./scripts/clean-sandboxes.sh       # 孤児サンドボックスの掃除

cd api && npm test                 # node --test
cd front && npm run typecheck      # 0件で通る。通してから出す（下記参照）
```

CI は無いので、変更したパーツに対応する上記を手元で流す。

**`npm run typecheck` は0件で通る。** `tsconfig.json` は `strict: true` のままなので、
新しいコードにも型注釈が要る。増やしたエラーは自分のものなので、出したら直す。

ルートを足したら **`import type { Route } from "./+types/<ファイル名>"`** を書き、
`meta` / `clientLoader` / `ErrorBoundary` / デフォルトエクスポートの引数を
`Route.MetaArgs` / `Route.ClientLoaderArgs` / `Route.ErrorBoundaryProps` / `Route.ComponentProps`
で受ける。この型は `react-router typegen` が `.react-router/types/` に生成する（typecheckが先に走らせる）。
routes.ts に登録していないファイルには生成されない。

API応答の型は、対応する SELECT をコメントで示したうえで、それを使う画面に書く。
複数の画面が同じ行を描くものだけ [front/app/types.ts](front/app/types.ts) に置いてある。

## 構成

| ディレクトリ | 中身 |
|---|---|
| `api/` | express 5 + better-sqlite3。`app.js` が `/api` 以下のルータをまとめる。セッションは `sessions.db` |
| `api/llm/` | AI学習支援機能。`providers/` に経路ごとのアダプタ、`client.js` がモデルから経路を選ぶ |
| `front/` | React Router v7（framework mode）+ Tailwind v4 + Pico CSS |
| `judge-system/` | ジャッジデーモン（D言語）。Docker-outside-of-Docker でサンドボックスを兄弟コンテナとして作る |

DBはSQLite1本（`data.db`）。Composeではnamed volume `dbdata` に置かれる。

## コード規約

既存コードに合わせる。以下は実際の慣習であって、新しく決めたものではない。

**共通**: コメントは日本語で、**「なぜそうなっているか」**を書く。
「何をしているか」はコードを読めば分かるので書かない。

**api/**（CommonJS）:
- インデント4スペース
- `}` と `else` は**改行して分ける**（[api/logincheck.js](api/logincheck.js) 参照）
  ```js
  if (user.login) {
      next();
  }
  else {
      return res.status(401).json({ error: "Unauthorized" });
  }
  ```
- 関数名と `(` の間に空白を入れる: `function checkUserStatus (session) {`
- DBアクセスは `require('./db.js')` の `db` を使う。接続を新しく作らない

**front/**（TypeScript）:
- 画面を足したら [front/app/routes.ts](front/app/routes.ts) に登録する。登録するまでルートは存在しない
- 認可は `login_layout.tsx` / `admin_layout.tsx` のレイアウトで囲んで表現する

**judge-system/**（D言語）:
- 言語を追加するときの影響範囲はほぼ [judge-system/source/constants.d](judge-system/source/constants.d) だけ。
  全体の手順は README の「言語追加方法」にある

## ブランチとPR

**GitHub Flow に従う。幹は `main` 1本だけで、常にデプロイ可能な状態に保つ。**

### 作業を始める前に

**`main` で直接作業しない。** 最初のコミットの前に、必ず現在地を確認してブランチを切る。

```sh
git branch --show-current        # いまどこにいるか確認する
git switch main && git pull      # 幹を最新にしてから
git switch -c feature/add-rust-language
```

### 流れ

1. `main` からトピックブランチを切る
2. こまめにコミットする（粒度は下の「コミット」を参照）
3. `main` へ Pull Request を出す
4. マージされたらトピックブランチは消す

### ブランチ名

`<種別>/<内容>` の形。内容は英語の kebab-case（例: `feature/add-rust-language`、`fix/session-cookie-domain`）。

| prefix | 用途 |
|---|---|
| `feature/` | 機能追加 |
| `fix/` | バグ修正 |
| `chore/` | 依存更新・設定・雑務 |
| `docs/` | ドキュメントのみ |

コミットの prefix とは対応するが綴りが違うものがある。機能追加はブランチが `feature/` で
コミットは `feat:`。ブランチ名に `feat/` は使わない。

### 守ること

- **`main` に直接コミットしない。** 必ずトピックブランチ経由でPRにする
- **1つのブランチに無関係な変更を混ぜない。** 言語追加とバグ修正は別のブランチにする
- **長生きさせない。** 数日で `main` に還るサイズに切る。育ちすぎたら分割する
- **`develop` は使わない。** かつて `main` と `develop` が併存してPRのマージ先が
  揃わなくなった（PR #1 は `main` へ、PR #2 は `develop` へ入っている）。
  この混乱を避けるため幹は `main` に一本化する

### upstream への還元

`main` が本家（`upstream`）と繋がる面なので、還元するときは `main` から upstream へPRを出す。

```sh
git fetch upstream
git switch main
git merge upstream/main   # 本家の変更を取り込んでから作業を始める
```

## コミット

- subject は英語の conventional commits（`fix:` / `feat:` / `docs:`）
- **本文は日本語で「なぜそうなっていたか」「なぜこう変えるか」**を書く。
  変更点の羅列だけにしない
- 関心事ごとに分割する。複数の修正を1コミットにまとめない

## 変更時の注意

- **`NODE_ENV=production` をローカルで設定しない。** secure cookie が強制され、
  http + localhost ではログインできなくなる。HTTPS付きの実デプロイ時だけ設定する
- **スキーマ変更は [models.sql](models.sql) と `sql_update/changeNN.sql` の両方に書く。**
  models.sql は全て `CREATE TABLE IF NOT EXISTS` で冪等（[api/tools/init_db.js](api/tools/init_db.js) が適用）、
  sql_update は既存DBへの差分。片方だけ直すと新規構築と既存環境で食い違う
- **ジャッジはバインドマウントされていない。** コンパイル言語なので、
  ソースを直しても `docker compose build judge && docker compose up -d judge` するまで反映されない
- **ジャッジのビルドは ldc-1.41.0 固定。** apt 版の ldc 1.36（DMD 2.106）は
  `constants.d` の連想配列の静的初期化を壊す。[judge-system/Dockerfile](judge-system/Dockerfile) の
  バージョンを安易に上げ下げしない。dmd は arm64 非対応なので Apple Silicon では LDC 必須
- **`.env` の `GOOGLE_APPLICATION_CREDENTIALS` はコンテナ内のパス**（`/app/secrets/gcp-sa.json`）。
  ホストのパスではない。`start-native.sh` で Docker を使わずに動かす場合だけホストの絶対パス
- フロントの 5173 が他プロジェクトと衝突する場合は `.env` の `FRONT_DEV_PORT` を変える
- `secrets/` と `.env` は追跡対象外。鍵をコミットしない

## AI学習支援機能の設計

問題の解き方や不正解の原因をアプリ内でLLMに相談できる機能。
**答えそのものは教えない**ようにガードレールをかけ、会話は全てサーバ側に記録する。

導線・対応モデル・`.env` の設定方法は [README.md](README.md) の「AI学習支援機能」にある。
ここには**なぜその作りになっているか**だけを書く。実装は `api/llm/` 以下。

### 会話の共有と無料枠

会話を管理者に見せてよいと同意したユーザーには広い枠を、見せたくないユーザーには狭い枠を割り当てる。
**ログ自体はどちらの場合も完全に保存される**が、管理者が日常的に閲覧できるのは共有設定の会話だけ。

既定値は設けず、初回利用時に必ず本人に選ばせる。UIだけの制御ではなく、
共有設定が未設定のまま `/api/llm/advice` を叩くとサーバが409を返す。

上限のモードは共有時と非共有時で独立しているので、
「共有すれば無制限、共有しなければ月$1まで」という設定ができる。
個人が無制限でも、システム全体の上限に達すれば全員止まる（最後の砦）。

### ガードレール

禁止するのは「AC前に直接的な解答を渡すこと」と「無関係な会話に応じること」の2点。
**初回は警告のみ**で、警告を無視して繰り返した場合にだけ違反として記録される。

段階の判定はサーバが持つ。モデルに何回目かを数えさせると取りこぼすので、
**モデルは違反かどうかだけを判断して毎回`report_violation`を呼び**、
警告で済ませるか違反として記録するかは`handleReportViolation`が決めて`action`で返す。
モデル側に「初回は呼ばなくてよい」と判断させてはいけない。警告が記録される経路はこのツールだけなので、
初回に呼ばせないと件数が永遠に0のままになり、何度違反しても「次は報告します」と言い続けるだけになる。

警告は`llm_warnings`に1件ずつ記録し、**会話単位ではなくユーザー単位で数える**。
会話単位にすると、警告されたチャットを閉じて開き直すだけで初回に戻せてしまう。
毎ターンのシステムプロンプトには、その利用者の有効な警告・違反の件数を注入している。

違反が記録されると、その会話と以降の会話が強制的に閲覧対象になる
（当の会話は作成済みなので、`llm_conversations.forced_shared`も併せて立てる）。
**誤認だった場合は管理画面から取り消せる。** 警告を取り消せばまた警告のみから始まり、
違反を取り消せば強制共有も解除できる。記録済みの違反が残っている間は、
警告だけを取り消しても報告段階のままにする。

### プロンプトキャッシュ

システムプロンプトは「共通ガードレール + Skill固有の指示 + 対象問題（ここまで会話中は不変）
+ 現在の状況（毎ターン変わりうる）」の順に組み立てる。
Anthropic経路では不変部分の末尾に`cache_control`を1つ置くので、
キャッシュ対象になる前置き（`tools` → `system`の順に並ぶ）にツール定義・ガードレール・問題文までが入る。

可変部分を必ず後ろに置くのはこのため。前に置くと、警告件数や提出回数が動いた時点で
それ以降のキャッシュが丸ごと無効になる。会話中はモデルも固定する（`llm_conversations.model`）。

前置きが短くてキャッシュの下限トークン数に届かない場合、`cache_control`は無視されるだけで
エラーにはならないので、長さによる分岐はしていない。
GeminiとOpenAI互換経路のキャッシュは自動なので、こちらからは何も指定しない。

### ツールの認可

LLMには7つのツール（AC状況の確認、提出の取得、提出履歴の一覧、解説の取得、
問題の制約の取得、使用言語の割合の取得、違反の報告）を定義し、Skillごとに必要なものだけ渡している。

**モデルが渡してくる引数は「身元」として使わない。**
ツールはセッション由来の`{userId, problemId, submissionId}`に束縛したクロージャとして生成し、
モデル由来の引数は照合にのみ使う。`get_submission`に他人の提出IDを渡されても
`WHERE id = ? AND user_id = <セッションのuser_id>`で引くのでヒットしない。
`report_violation`はそもそもuser_id引数を受け取らない（なりすまし防止）。

認可失敗は`tool_result`の`is_error`として返し、`llm_tool_calls.authz_ok = 0`で記録するので、
越権試行が管理画面で見える。

### 会話ログ

`llm_turns.content_json`にMessages APIの`content`配列を逐語で保存している。
1ターンに text と複数の tool_use が混在しても、そのまま復元してAPIに再送でき、
フロントの再描画にも同じデータを使える。

```js
const rows = db.prepare('SELECT role, content_json FROM llm_turns WHERE conversation_id = ? ORDER BY seq').all(id);
const messages = rows.map(r => ({ role: r.role, content: JSON.parse(r.content_json) }));
```

`llm_tool_calls`はこれの派生インデックス（管理画面での検索・監査用）で、真実の源はあくまで`content_json`。
永続化はターン単位で行っているので、途中でブラウザを閉じてもログは失われない。

ユーザーの発言はループに入る前に保存するが、**応答を1つも保存できずに終わった場合は取り消す**。
残すとリトライのたびにuserターンが積み上がり、userロールが連続した履歴になる
（OpenAI形式では不正になりうるし、送信のたびにプロンプトが無駄に膨らむ）。
1ターン目で失敗して会話が空になった場合は会話ごと消す。
取り消したことは`rolled_back`イベントでフロントにも伝える。伝えないと、
消えた会話のIDを握ったまま「チャットでさらに質問する」が押せてしまう。

### プロバイダの抽象化

`api/llm/providers/` に経路ごとのアダプタを置き、`api/llm/client.js` がモデルから選ぶ。
プロバイダを全体で1つに固定していないのは、「Vertex経由のClaude ＋ Vertex経由のGemini ＋
手元のLM Studio」のような混在構成を成立させるため。会話ごとに`llm_conversations.provider`へ記録する。

アダプタは3つで4経路をまかなう。OpenAIとローカルLLMは同じ`openai_compat.js`が担当する
（プロトコルが同一で、違うのはエンドポイントとパラメータ名だけなので分ける理由が無い）。

**共通の面はAnthropicのMessages API形式に固定した**（`{content配列, stop_reason, usage}`）。
中立的な独自の中間表現を作らなかったのは、会話ログがMessages APIの`content`配列そのもので、
「保存したものをそのまま再送する」という一番効く性質を失いたくなかったから。
Gemini・OpenAI互換の各アダプタが、自分の形との相互変換を内側に持つ。

```
system                 ⇄ systemInstruction        / {role:'system'}
{role:'assistant'}     ⇄ {role:'model'}           / {role:'assistant'}
{type:'tool_use'}      ⇄ functionCall             / tool_calls[]
{type:'tool_result'}   ⇄ functionResponse         / {role:'tool'}
tools[].input_schema   ⇄ parametersJsonSchema     / function.parameters
```

変換で気をつけた点:

- Geminiの`promptTokenCount`とOpenAI互換の`prompt_tokens`は**キャッシュ分を含む**が、
  Anthropicの`input_tokens`は含まない。`cost.js`はAnthropicの定義で計算するので、
  アダプタ側で引いてから渡す（引かないとキャッシュ分を二重に計上する）
- Geminiの並列function callingは`functionResponse`を**同じ順序で返す**ことで対応付ける仕様なので、
  こちらで採番した`tool_use.id`は送り返さない（ログとUIの突き合わせにだけ使う）
- OpenAI形式は1メッセージ1ツール結果なので、複数の`tool_result`を持つターンは分解する。
  `tool`ロールは対応する`assistant`の直後に並ぶ必要がある
- Anthropic固有の`thinking` / `output_config.effort`はAnthropicアダプタの中で足す。
  呼び出し側で振り分けると、プロバイダが増えるたびに条件が増える

### Chrome Built-in AI（Prompt API）を実装していない理由

ブラウザ内蔵のPrompt APIは実装していない。`api/llm/client.js`に拡張点だけ残してある。

理由は、この機能の設計が**ガードレール・ログ・ツール認可のすべてがサーバ経由である**ことに
依存しているため。ブラウザ内で完結する経路を作ると、DevToolsからシステムプロンプトを差し替えるだけで
「直接答えを教えて」が通り、警告も違反記録も残らない。
しかもクライアント側のコードには整合性保証が無いので、**改竄したこと自体を検知できない**
（改竄できる人は報告処理も一緒に消せる）。不正対策のための仕組みの隣に、その抜け穴を作ることになる。

加えて、Prompt APIの実体はGemini Nanoであって「基本的にClaudeを使う」という方針とも合わず、
Chrome 148以降のデスクトップ限定・空きストレージ22GB・GPU 4GB以上という要件のため
初学者の環境では多くの場合そもそも利用できない。

なお、Prompt APIにMCPクライアントは無い（`tools`オプションで呼べるのはページ内のJS関数だけ）。
