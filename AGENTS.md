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
cd front && npm run typecheck      # react-router typegen && tsc
```

CI は無いので、変更したパーツに対応する上記を手元で流す。

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
