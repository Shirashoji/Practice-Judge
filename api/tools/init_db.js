// DB初期化スクリプト（冪等）
// models.sqlはすべてCREATE TABLE IF NOT EXISTSなので何度実行してもよい。
// SEED=1のときのみdb_seed.sqlを投入する。
// 使い方:
//   node tools/init_db.js
//   SEED=1 node tools/init_db.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../data.db');
const modelsPath = path.resolve(__dirname, '../../models.sql');
const seedPath = path.resolve(__dirname, '../../db_seed.sql');

const db = new sqlite3(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(modelsPath, 'utf8'));
console.log(`スキーマを適用しました: ${dbPath}`);

if (process.env.SEED === '1') {
    db.exec(fs.readFileSync(seedPath, 'utf8'));
    console.log('シードデータを投入しました。');
}

db.close();
