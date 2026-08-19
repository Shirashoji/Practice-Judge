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

問題の解き方や不正解の原因について、アプリ内でLLMに相談できる機能。
**答えそのものは教えない**ようにガードレールをかけ、会話は全てサーバ側に記録する。
モデルはClaude（Anthropic API / Vertex AI）、Gemini（Vertex AI / Gemini API）、
LM Studio等のローカルLLMから選べる。

### 導線

| 状況 | 場所 | Skill |
|---|---|---|
| まだ解けていない | 問題ページ「解き方のヒントをもらう」 | `pre_ac_advice` |
| WA/TLE等になった | 提出詳細「どこが間違っているかヒントをもらう」 | `wa_diagnosis` |
| ACした | 提出詳細「コードの改善点を提案してもらう」 | `post_ac_review` |

いずれもまず一方向の説明が出て、その下の「チャットでさらに質問する」から
問題文・提出・チャットを並べた専用画面に移る。1ターン目はそのまま履歴として引き継がれる。

### セットアップ

`.env` に使いたい経路の分だけ設定する（詳細は`.env.example`）。
何も設定しなくてもAPIは起動し、LLMのエンドポイントだけが503を返す。

```sh
# Claude（Anthropic本家）
LLM_PROVIDER=anthropic          # anthropic | vertex
ANTHROPIC_API_KEY=sk-ant-...

# Claude と Gemini を Vertex AI 経由で
LLM_PROVIDER=vertex
VERTEX_PROJECT_ID=my-gcp-project
VERTEX_REGION=global
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-sa.json  # 省略時はADC

# Gemini だけを Gemini Developer API で（Vertexを使わない場合）
GEMINI_API_KEY=...

# OpenAI（OPENAI_BASE_URLを差し替えればAzure OpenAIやOpenRouterも指せる）
OPENAI_API_KEY=sk-...

# ローカルLLM（LM Studio等のOpenAI互換サーバ）
LOCAL_LLM_BASE_URL=http://host.docker.internal:1234/v1
LOCAL_LLM_MODELS=qwen/qwen3-coder-30b
```

`LLM_PROVIDER` が決めるのは**Claudeの経路だけ**で、他の経路には影響しない。
Geminiは `VERTEX_PROJECT_ID` があればVertex経由、無ければ `GEMINI_API_KEY` で
Gemini Developer API経由になる。4系統を同時に有効にして、ユーザーに選ばせることもできる。

OpenAIとローカルLLMは同じOpenAI互換アダプタで喋る。差分はエンドポイント・認証と、
GPT-5世代が `max_tokens` ではなく `max_completion_tokens` を要求する点だけ
（ローカルサーバ側は逆に `max_completion_tokens` を知らない実装があるので使い分ける）。
`reasoning_effort` は対応モデルにだけ送る。

ローカルLLMのモデルは自動検出せず `LOCAL_LLM_MODELS` に列挙する。
起動時にLM Studioが落ちていると選択肢が空のままAPIが立ち上がってしまうため。
APIはコンテナの中で動くので、ホストのLM Studioを指すURLは `localhost` ではなく
`host.docker.internal` になる（Linux向けに`compose.yaml`で`extra_hosts`を張ってある）。

### Vertex AI（Gemini Enterprise Agent Platform）をサービスアカウントで使う

Vertex AI経由のClaude・Geminiは、既定ではADC
（`gcloud auth application-default login` やGCE/Cloud Runのメタデータサーバ）で認証する。
開発者個人のログインに紐づかない資格情報で動かしたい場合は、
サービスアカウントの鍵を置いて `GOOGLE_APPLICATION_CREDENTIALS` で指す。

鍵の作成に必要なロールは **Vertex AI ユーザー**（`roles/aiplatform.user`）だけでよい。

```sh
PROJECT_ID=my-gcp-project
SA=practice-judge-llm

gcloud iam service-accounts create "$SA" --project "$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --role=roles/aiplatform.user
gcloud iam service-accounts keys create secrets/gcp-sa.json \
    --iam-account="$SA@$PROJECT_ID.iam.gserviceaccount.com"
```

```sh
# .env
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-sa.json
```

鍵は `secrets/` に置く。中身は`.gitignore`してあり、`compose.yaml`が `./secrets` を
コンテナの `/app/secrets` へ読み取り専用でマウントする。`.env`に書くのは
**コンテナから見たパス**であってホストのパスではない
（`start-native.sh`でDockerを使わずに動かす場合はホストの絶対パスを書く）。
`.dockerignore`にも入れてあるので、鍵がイメージに焼き込まれることはない。

変数名をGCP標準の `GOOGLE_APPLICATION_CREDENTIALS` のままにしてあるのは、
これが`google-auth-library`自身が読む名前でもあるため。こちらの実装を通らない経路でも
同じ鍵が効くので、資格情報の置き場所が1か所で済む。

鍵を指定した場合は `VERTEX_PROJECT_ID` を省略できる（鍵の`project_id`が使われる）。
省略可能にしてあるのは、`VERTEX_PROJECT_ID`の書き忘れでGeminiが黙って
Gemini Developer API側の経路に落ちるのを防ぐため。

鍵は**起動時に1度だけ読んで検証する**（存在・JSONとして妥当・`type`が`service_account`・
`client_email`がある）。不備があってもAPIサーバは起動し、
管理画面の稼働状況にその経路が「未設定」と理由付きで出る。
`gcloud auth application-default login` が出力するユーザー資格情報のJSONを
間違って置くのがありがちな失敗で、そのままSDKに渡すと原因の分かりにくい英語エラーになる。
検証を通った場合は管理画面にサービスアカウントのアドレスが出るので、
どの資格情報で動いているかを画面から確認できる（秘密鍵は読み捨てていて、ログにも画面にも出ない）。

不備があるときにADCへ黙って落とさないのは、鍵を置いたつもりの環境が別の資格情報で
動いてしまうと、権限や課金先がずれていても気づけないため。

SDKはいずれも遅延`require`にしてあり、使わない経路の依存は未インストールでも起動できる
（`@anthropic-ai/vertex-sdk` と `@google/genai` は `google-auth-library` 系を芋づるで引き込むため）。
`google-auth-library`だけは`package.json`に直接の依存として書いてある。
サービスアカウント鍵を`@anthropic-ai/vertex-sdk`に渡すには`GoogleAuth`を自前で組み立てる必要があり、
他パッケージの推移的依存をそのまま`require`するのは壊れやすいため。
ローカルLLMはSDKを使わずfetchで直接叩いているので依存が増えない。

金額の上限やモデルの割り当ては**envではなくDBに置いてあり、管理画面から変更する**。
`/control-panel/llm` 以下に、全体設定・ユーザー別上限・警告と違反の記録・会話の監査がある。
経路が設定されていないモデルは、管理画面で許可してもユーザーの選択肢には出ない
（許可設定はDB・経路の設定はenvにあり別々に変わるので、参照のたびに突き合わせている）。

稼働状況の一覧には、ClaudeとGeminiについて**排他な経路の両方**を出し、
実際に使う側を「使用中」、使わない側を「未使用（切り替え方）」と示す。
使われない側を隠すと、設定してあるのに使われていないのか設定自体が効いていないのかを
区別できず、特にVertexは経路を切り替えて実際に呼ぶまで鍵の正しさが分からなくなるため。

ローカルLLMは**単価0**として扱う。電気代はAPI課金ではないので計上しようがなく、
結果として月次上限を素通りするが、これは意図通り（ローカルなら使い放題でよい）。

1ターンの出力上限もモデルごとに登録簿へ持たせている。思考する世代は思考トークンも
この枠に入るので広く取る必要がある一方、**ローカルLLMは逆に狭くする必要がある**。
コンテキスト長がモデルの上限ではなくロード時の設定で決まるためで、
LM Studioの既定は8192、systemプロンプトとツール定義だけで2000トークン以上使う。
`LLM_MAX_TOKENS` を設定すると全モデルでそちらが優先される。

### 設計上の判断について

ガードレールの段階判定、プロンプトキャッシュの並べ方、ツールの認可、会話ログの持ち方、
プロバイダの抽象化、Chrome Built-in AIを実装していない理由といった
**「なぜその作りなのか」は [AGENTS.md](AGENTS.md) に書いてある。**
このセクションは動かすための手順に絞ってある。
