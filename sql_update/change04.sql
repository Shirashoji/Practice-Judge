-- LLM学習支援機能のテーブルを追加する。
-- models.sqlにも同じ内容が入っている（全てIF NOT EXISTSなので何度流してもよい）。

-- ============================================================
-- llm_conversations テーブル
-- LLMとの会話スレッド。user/problem/submissionに厳密に紐付ける。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    submission_id INTEGER,                      -- 問題単位の相談はNULL
    skill_id TEXT NOT NULL,                     -- pre_ac_advice | wa_diagnosis | post_ac_review
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model TEXT NOT NULL DEFAULT '',             -- 会話中は固定（途中で変えるとプロンプトキャッシュが壊れる）
    share_mode TEXT NOT NULL DEFAULT 'private', -- 作成時点のユーザー設定のスナップショット
    forced_shared INTEGER NOT NULL DEFAULT 0,   -- 違反による強制共有
    warning_count INTEGER NOT NULL DEFAULT 0,   -- 段階的警告の状態（サーバが持つ）
    total_cost_usd REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_conversations_user ON llm_conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_conversations_submission ON llm_conversations(submission_id);
CREATE INDEX IF NOT EXISTS idx_llm_conversations_share ON llm_conversations(share_mode, forced_shared);

-- ============================================================
-- llm_turns テーブル
-- 1行 = Messages APIの1メッセージ。content配列を逐語で持つので、
-- この表だけで会話をAPIに再送でき、フロントでも再描画できる。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,                         -- user | assistant
    content_json TEXT NOT NULL,                 -- content配列をJSONで逐語保存
    stop_reason TEXT,
    model TEXT,
    provider TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_turns_seq ON llm_turns(conversation_id, seq);

-- ============================================================
-- llm_tool_calls テーブル
-- 1行 = 1ツール実行。真実の源はllm_turns.content_jsonで、
-- こちらは管理画面での検索・監査のための派生インデックス。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    turn_id INTEGER NOT NULL,                   -- tool_useを含むassistantターン
    tool_use_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    is_error INTEGER NOT NULL DEFAULT 0,
    authz_ok INTEGER NOT NULL DEFAULT 1,        -- 0 = 越権試行（他人の提出を読もうとした等）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_tool_calls_conversation ON llm_tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_tool_calls_authz ON llm_tool_calls(authz_ok);

-- ============================================================
-- llm_violations テーブル
-- ガードレール違反のフラグ。誤認だった場合はdismissedで取り消す。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    conversation_id INTEGER,
    violation_type TEXT NOT NULL,               -- DIRECT_ANSWER_REQUEST | IRRELEVANT_CONVERSATION
    reason TEXT NOT NULL DEFAULT '',
    dismissed INTEGER NOT NULL DEFAULT 0,       -- 1 = 誤認として取り消し済み
    dismissed_by INTEGER,
    dismissed_at DATETIME,
    dismissed_reason TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_violations_user ON llm_violations(user_id, dismissed);

-- ============================================================
-- llm_usage テーブル
-- 課金明細。billing_month（JST基準のYYYY-MM）で月次集計する。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    conversation_id INTEGER,
    turn_id INTEGER,
    billing_month TEXT NOT NULL,                -- 'YYYY-MM'
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_month ON llm_usage(billing_month, user_id);

-- ============================================================
-- llm_user_limits テーブル
-- ユーザー別の月次上限。共有時と非共有時で独立して設定できる
-- （「共有するなら無制限、しないなら月$1」という運用ができるように）。
-- 行が無い場合は両方ともdefault（= llm_settingsの全体既定に従う）扱い。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_user_limits (
    user_id INTEGER PRIMARY KEY,
    shared_limit_mode TEXT NOT NULL DEFAULT 'default',   -- default | custom | unlimited
    shared_limit_usd REAL,                               -- shared_limit_mode = 'custom' のときのみ有効
    private_limit_mode TEXT NOT NULL DEFAULT 'default',
    private_limit_usd REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- llm_user_settings テーブル
-- share_modeはあえて既定値を持たない。NULL（未設定）のうちは
-- LLM機能を使えないようにして、初回に必ず本人に選択させる。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_user_settings (
    user_id INTEGER PRIMARY KEY,
    share_mode TEXT,                              -- NULL=未設定 | shared | private
    force_shared INTEGER NOT NULL DEFAULT 0,      -- 違反による強制共有（本人は変更できない）
    preferred_model TEXT NOT NULL DEFAULT 'auto', -- auto | 許可モデルID
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- llm_settings テーブル
-- 管理画面から変更する全体設定のKVストア。
-- 金額をenvではなくここに置くのは、二重管理を避けるため。
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
