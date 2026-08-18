-- 段階的警告をユーザー単位で持つためのテーブルを追加する。
-- models.sqlにも同じ内容が入っている（全てIF NOT EXISTSなので何度流してもよい）。
--
-- これまで警告の状態は llm_conversations.warning_count にしか無く、会話を新しく開くと
-- 0に戻っていた。警告されたチャットを閉じて開き直せば永久に報告されない抜け道になるので、
-- 警告そのものを1行ずつ記録し、ユーザー単位で数えるようにする。
--
-- 誤って警告された場合は管理者が dismissed を立てて取り消せる（違反と同じ運用）。
-- 取り消された警告は件数に数えないので、次の違反はまた初回（警告のみ）から始まる。

CREATE TABLE IF NOT EXISTS llm_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    conversation_id INTEGER,
    violation_type TEXT NOT NULL,               -- DIRECT_ANSWER_REQUEST | IRRELEVANT_CONVERSATION
    reason TEXT NOT NULL DEFAULT '',
    dismissed INTEGER NOT NULL DEFAULT 0,       -- 1 = 誤警告として取り消し済み
    dismissed_by INTEGER,
    dismissed_at DATETIME,
    dismissed_reason TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_warnings_user ON llm_warnings(user_id, dismissed);
