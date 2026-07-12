# APIサーバのイメージ
# ビルドコンテキストはリポジトリルート（models.sql/db_seed.sqlを取り込むため）
# docker build -f api/Dockerfile -t practice-judge-api .

FROM node:20-bookworm-slim

# better-sqlite3等のネイティブモジュールをビルドできるようにしておく
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# /app/api に置くことで app.js の ../static, ../DB_BACKUP の相対参照を
# /app/static, /app/DB_BACKUP（マウントポイント）に合わせる
WORKDIR /app/api

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/ ./
COPY models.sql db_seed.sql /app/

CMD ["node", "app.js"]
