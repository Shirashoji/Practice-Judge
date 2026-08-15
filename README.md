# Practice Judge

## はじめに
Practice Judgeはプログラミング初学者が基礎的な文法、言語機能、アルゴリズムを習得するために、プログラミングの練習を行うためのオンラインジャッジです。

本プロジェクトは「ジャッジ」「API」「フロント」の3パーツに分かれています。
現状それぞれに仕様書やドキュメントがなく、記憶を頼りに開発されています。


## 起動方法（Docker Compose・推奨）
Docker（Docker Desktop等）さえあれば、macOSでもLinuxでも同じ手順で動きます。

### 開発モード（ホットリロード付き）
```sh
docker compose up
```
- フロント: http://localhost:5173
- API: http://localhost:8181
- 5173が他プロジェクトと衝突する場合は、`.env`で`FRONT_DEV_PORT`を変更してください。
- api/とfront/のソースはバインドマウントされており、編集すると即反映されます。
- ジャッジ(judge-system/)はコンパイル言語のため、変更時は`docker compose build judge && docker compose up -d judge`で反映します。

初回にシードデータ（サンプルユーザー・サンプル問題）を入れる場合:
```sh
docker compose run --rm -e SEED=1 db-init
```

### 本番相当モード
```sh
docker compose -f compose.yaml up -d
```
- フロント: http://localhost:3000
- 環境変数は`.env.example`をコピーした`.env`で設定します（`SESSION_SECRET`は本番では必ず変更）。
- `NODE_ENV=production`はsecure cookieを強制するため、HTTPS付きの実デプロイ時のみ`.env`で設定してください。http+localhostで設定するとログインできなくなります。

### コンテナ構成
| サービス | 役割 |
|---|---|
| front | フロント（開発時: vite devサーバ / 本番相当: serve.jsで静的配信） |
| api | APIサーバ（express、ポート8181） |
| judge | ジャッジデーモン（D言語） |
| judge-env-image | サンドボックスイメージ（judge-env）のビルド専用。即終了する |
| db-init | DBスキーマの適用（冪等）。即終了する |

data.dbとsessions.dbはnamed volume（`dbdata`）に置かれ、`docker compose down`しても消えません。
`static/`と`DB_BACKUP/`はリポジトリ直下がそのままapiコンテナにマウントされます。

### ジャッジの仕組みとセキュリティ
judgeコンテナは`/var/run/docker.sock`をマウントしており、提出ごとに使い捨てのサンドボックスコンテナ（judge-envイメージ）を兄弟コンテナとして生成します（Docker-outside-of-Docker）。**提出コードが実行されるのはサンドボックス内だけ**で、サンドボックスは`--net none`（ネットワーク遮断）、pids/メモリ制限、非rootユーザーで動きます。サンドボックスにはDockerソケットもcgroupも渡されません。

リソース計測（メモリ・実行時間）は`/sys/fs/cgroup`（judgeコンテナに読み取り専用でマウント）から行います。judgeコンテナ自体がLinux（macOSではDocker DesktopのVM）内で動くため、ホストOSに関係なくcgroupが読めます。ただしmacOSでの実行時間はVM経由のため、Linuxベアメタルと絶対値は多少異なります（練習用途では問題ない精度です）。

ジャッジが異常終了してサンドボックスが残った場合は以下で掃除できます:
```sh
./scripts/clean-sandboxes.sh
```


## 起動方法（Linuxネイティブ・従来方式）
従来の`start.sh`は`start-native.sh`に改名して残しています。tmuxセッション上でジャッジ・API・フロントをホスト上で直接動かします。

### ネイティブ起動が依存するソフトウェア

#### sqlite3
全データを保持するdb（data.db）はsqlite3によって動いています。
また、APIサーバーはcookieによるセッション管理を行っており、cookieとユーザーの紐付けをsessions.dbで管理していますが、これもsqlite3によって動いています。

#### Dockerデーモン、Dockerクライアント
ジャッジシステムはDockerコンテナをサンドボックスとして利用しているため、起動ユーザーがsudoなしでDockerを起動できることが必要です。具体的に起動するコマンドはジャッジのソースコードを参照してください。（数ファイルしか無いのでgrepしたらすぐおわります。）

#### D言語
ジャッジシステムはD言語によって動作しています。現在の私の環境はdmd 2.108.1です。

#### node.js
APIはexpress、フロントはvite + react-router v7で作成されています。node.js及びnpmが必要です。

#### Linux
ジャッジシステムで用いるサンドボックスのリソース管理にcgroup v1またはv2が必要です。ubuntuならとりあえず動くと思います。
（Composeで動かす場合はこの制約はありません。macOSでも動きます。）

#### tmux
プロセスを常駐させておくのにtmuxセッションを利用しています。

### 手順
上記依存ソフトウェアを正しくインストールした後、
- `/api/.env`の設定（`.env_example`を参考に）

を行う。
セットアップの後は`start-native.sh [dev|release]`単体で設定なく起動できるようにしているつもりです。
ただし、デプロイ環境がInTheBloomの想定するものでない場合、プロセスのポートなどは変更したほうが良いかもしれません。


## ファイル配信周り
static/以下が静的ファイルの配信。よってここは本番環境と開発環境で中身が変わる。
開発時と本番時どちらもapiサーバからexpressで配信しているものを`http://fronturl/static`からproxyを通すことで取りに行っている。開発時の設定は`/front/vite.config.ts`、本番時の設定は`/front/serve.js`で行う。

## 言語追加方法
1. サンドボックスのDockerfile（`docker_judge`）にその言語のインストール設定を追記する。
2. ジャッジデーモンで色々設定する。
    基本的に影響範囲は`constants.d`だけのはず。
3. フロントで色々設定する。
    * 説明画面（front/app/routes/for\_beginners.tsx）
    * 提出画面（front/app/routes/problem\_page.tsx）
    * 提出一覧画面（front/app/routes/problem\_submissions.tsx）
    * 個別問題管理画面（front/app/routes/control\_panel\_problem.tsx）
    * ace-editor（front/app/ace-editor.tsx）
4. 既存言語との兼ね合いで文字列変更した場合はdbの値を変える。
5. イメージを再ビルドする。Compose利用時は`docker compose build judge-env-image`、ネイティブ利用時は`start-native.sh`実行時にイメージのビルドを選択する。（イメージが存在しない場合は自動ビルドが走る）


## AI学習支援機能

問題の解き方や不正解の原因について、アプリ内でClaudeに相談できる機能。
**答えそのものは教えない**ようにガードレールをかけ、会話は全てサーバ側に記録する。

### 導線

| 状況 | 場所 | Skill |
|---|---|---|
| まだ解けていない | 問題ページ「解き方のヒントをもらう」 | `pre_ac_advice` |
| WA/TLE等になった | 提出詳細「どこが間違っているかヒントをもらう」 | `wa_diagnosis` |
| ACした | 提出詳細「コードの改善点を提案してもらう」 | `post_ac_review` |

いずれもまず一方向の説明が出て、その下の「チャットでさらに質問する」から
問題文・提出・チャットを並べた専用画面に移る。1ターン目はそのまま履歴として引き継がれる。

### セットアップ

`.env` に以下を設定する（詳細は`.env.example`）。未設定でもAPIは起動し、LLMのエンドポイントだけが503を返す。

```sh
LLM_PROVIDER=anthropic          # anthropic | vertex
ANTHROPIC_API_KEY=sk-ant-...
```

Vertex AI経由でClaudeを使う場合は `LLM_PROVIDER=vertex` と `VERTEX_PROJECT_ID` を設定する
（認証はGCPのADC）。`@anthropic-ai/vertex-sdk` は `google-auth-library` 系を芋づるで引き込むため
遅延`require`にしてあり、Anthropic直API運用なら未インストールでも起動できる。

金額の上限やモデルの割り当ては**envではなくDBに置いてあり、管理画面から変更する**。
`/control-panel/llm` 以下に、全体設定・ユーザー別上限・違反記録・会話の監査がある。

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

段階的警告の状態はサーバが持つ（`llm_conversations.warning_count`）。
モデルに回数を数えさせると取りこぼすので、毎ターンのシステムプロンプトに現在の警告回数を注入し、
モデルは「0なら警告のみ / 1以上なら`report_violation`を呼ぶ」と判断するだけでよいようにしている。
さらに`report_violation`ハンドラ側でも、警告0回の状態で通報が来たら記録せず警告に落とす。

違反が記録されると、その会話と以降の会話が強制的に閲覧対象になる。
**誤認だった場合は管理画面から違反を取り消せ**、取り消すと強制共有も解除できる。

### ツールの認可

LLMには6つのツール（AC状況の確認、提出の取得、解説の取得、問題の制約の取得、
使用言語の割合の取得、違反の報告）を渡している。

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
