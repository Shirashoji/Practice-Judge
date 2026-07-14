const sqlite3 = require('better-sqlite3');
const path = require('path');
// cwd依存を避けるため、未指定時はこのファイルの位置を基準に解決する
const db = new sqlite3(process.env.DB_PATH || path.resolve(__dirname, '../data.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

module.exports = { db };
