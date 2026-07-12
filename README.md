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
