// LLM機能の設定
//
// 方針: envには「環境ごとに変わるもの」（APIキー、プロバイダ、モデルの最終フォールバック）だけを置く。
// 金額や難易度マッピングのように管理画面から変更するものはDB（llm_settings）に置く。
// 両方に置くと二重管理になって必ずズレる。

const { db } = require('../db.js');

// ------------------------------------------------------------
// env
// ------------------------------------------------------------

const PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || '';
const VERTEX_REGION = process.env.VERTEX_REGION || 'global';
const MODEL_CHAT = process.env.LLM_MODEL_CHAT || 'claude-opus-5';
const MODEL_CLASSIFY = process.env.LLM_MODEL_CLASSIFY || 'claude-haiku-4-5';

// LLM機能が使える状態かどうか。使えない場合もAPIサーバ自体は起動させ、
// LLMのエンドポイントだけが503を返すようにする（既存機能を巻き込まないため）。
function isConfigured () {
    if (PROVIDER === 'vertex') {
        return VERTEX_PROJECT_ID !== '';
    }
    return ANTHROPIC_API_KEY !== '';
}

// ------------------------------------------------------------
// モデル単価表（USD per 1M tokens）
//
// cacheReadは入力単価の約0.1倍、cacheWriteは約1.25倍。
// ここに無いモデルはunknownとして入力=出力=0で計上されるのを避けるため、
// フォールバック単価（最も高いOpus相当）を使う。過小請求より過大見積のほうが安全。
// ------------------------------------------------------------

const PRICING = {
    'claude-opus-5':     { input: 5.00, output: 25.00 },
    'claude-opus-4-8':   { input: 5.00, output: 25.00 },
    'claude-sonnet-5':   { input: 3.00, output: 15.00 },
    'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
    'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
};

const FALLBACK_PRICING = { input: 5.00, output: 25.00 };

function getPricing (model) {
    return PRICING[model] || FALLBACK_PRICING;
}

// モデルごとの対応パラメータ。
// output_config.effort と thinking:{type:'adaptive'} は新しい世代のモデルにしか無く、
// 対応していないモデル（Haiku 4.5など）に送ると400になる。
// ユーザーがモデルを選べる以上、送る前にここで振り分ける必要がある。
const CAPABILITIES = {
    'claude-opus-5':     { effort: true, adaptiveThinking: true },
    'claude-opus-4-8':   { effort: true, adaptiveThinking: true },
    'claude-sonnet-5':   { effort: true, adaptiveThinking: true },
    'claude-sonnet-4-6': { effort: true, adaptiveThinking: true },
    'claude-haiku-4-5':  { effort: false, adaptiveThinking: false },
};

function getCapabilities (model) {
    // 未知のモデルは安全側に倒して、追加パラメータを一切送らない
    return CAPABILITIES[model] || { effort: false, adaptiveThinking: false };
}

// 単価表に載っているモデルかどうか。
// 単価の分からないモデルを許可すると利用額が推定できず上限が機能しなくなるので、
// 管理画面ではここを通ったものだけを許可モデルとして受け付ける。
function isKnownModel (model) {
    return Object.prototype.hasOwnProperty.call(PRICING, model);
}

function listKnownModels () {
    return Object.keys(PRICING);
}

// 対話の思考の深さ。低めでも十分な品質が出るうえ、月次上限のあるユーザーには
// トークン消費が直接効くので既定はmediumにしておく。
const EFFORT = process.env.LLM_EFFORT || 'medium';

// 1ターンの出力上限。thinkingが有効なモデルでは思考トークンもここに含まれるため、
// 途中で切れないよう余裕を持たせる。
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 8000);

// ------------------------------------------------------------
// llm_settings（KVストア）
// ------------------------------------------------------------

// 初回起動時に投入する既定値。
// 「共有すれば広い枠、共有しなければ狭い枠」を初期状態とする。
const DEFAULT_SETTINGS = {
    default_shared_limit_mode: 'custom',      // custom | unlimited
    default_shared_limit_usd: '5.0',
    default_private_limit_mode: 'custom',
    default_private_limit_usd: '1.0',
    system_limit_mode: 'custom',              // custom | unlimited
    system_monthly_limit_usd: '50.0',
    // 問題のdifficulty(1〜5)ごとに使うモデル。易しい問題まで最上位モデルを使う必要はない。
    model_by_difficulty: JSON.stringify({
        1: 'claude-sonnet-5',
        2: 'claude-sonnet-5',
        3: 'claude-opus-5',
        4: 'claude-opus-5',
        5: 'claude-opus-5',
    }),
    // ユーザーが自分で選べるモデル。ここに無いものは設定画面で弾く。
    allowed_models: JSON.stringify(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']),
};

// 既定値のうち、まだDBに無いキーだけを入れる（既存の設定は上書きしない）。
function ensureDefaults () {
    const insert = db.prepare(`
        INSERT INTO llm_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO NOTHING
    `);
    const trans = db.transaction(() => {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            insert.run(key, value);
        }
    });
    trans();
}

function getSetting (key) {
    const row = db.prepare('SELECT value FROM llm_settings WHERE key = ?').get(key);
    if (row == null) {
        return DEFAULT_SETTINGS[key] ?? null;
    }
    return row.value;
}

function getSettingNumber (key) {
    const v = Number(getSetting(key));
    return Number.isFinite(v) ? v : 0;
}

function getSettingJSON (key) {
    const raw = getSetting(key);
    if (raw == null) {
        return null;
    }
    try {
        return JSON.parse(raw);
    }
    catch (e) {
        console.error(`llm_settings.${key} のJSONパースに失敗しました:`, e);
        // 壊れた設定でLLM機能全体を止めないよう、既定値に落とす
        try {
            return JSON.parse(DEFAULT_SETTINGS[key]);
        }
        catch (e2) {
            return null;
        }
    }
}

function setSetting (key, value) {
    db.prepare(`
        INSERT INTO llm_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value));
}

// ------------------------------------------------------------
// 課金月
//
// 学習者の生活時間に合わせてJSTで月を区切る。
// コンテナのTZはUTCなので、UTCから+9時間してから年月を取る。
// ------------------------------------------------------------

function billingMonth (date) {
    const d = date == null ? new Date() : date;
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

module.exports = {
    PROVIDER,
    ANTHROPIC_API_KEY,
    VERTEX_PROJECT_ID,
    VERTEX_REGION,
    MODEL_CHAT,
    MODEL_CLASSIFY,
    EFFORT,
    MAX_TOKENS,
    isConfigured,
    getPricing,
    getCapabilities,
    isKnownModel,
    listKnownModels,
    ensureDefaults,
    getSetting,
    getSettingNumber,
    getSettingJSON,
    setSetting,
    billingMonth,
};
