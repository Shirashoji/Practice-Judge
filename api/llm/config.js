// LLM機能の設定
//
// 方針: envには「環境ごとに変わるもの」（APIキー、プロバイダ、モデルの最終フォールバック）だけを置く。
// 金額や難易度マッピングのように管理画面から変更するものはDB（llm_settings）に置く。
// 両方に置くと二重管理になって必ずズレる。

const { db } = require('../db.js');

// ------------------------------------------------------------
// env
// ------------------------------------------------------------

// Claudeをどこ経由で呼ぶか。anthropic（本家API） | vertex（Vertex AI）。
// Geminiとローカルモデルの経路はこの値では決まらない（後述のproviderForを参照）。
const PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || '';
const VERTEX_REGION = process.env.VERTEX_REGION || 'global';
// Vertexを使わずGemini Developer APIを直接叩く場合のキー。
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// OpenAI。ローカルLLMと同じOpenAI互換アダプタで喋る（差分はエンドポイントと
// パラメータ名だけなので、SDKを足す必要が無い）。
// BASE_URLを変えられるようにしてあるのは、Azure OpenAIやOpenRouterのような
// 互換ゲートウェイをそのまま指せるようにするため。
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

// LM Studio等のOpenAI互換ローカルサーバ。
// LM Studioの既定は http://localhost:1234/v1 だが、APIはコンテナの中で動くので
// ホスト側のLM Studioを指すなら http://host.docker.internal:1234/v1 になる。
const LOCAL_BASE_URL = (process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, '');
// ローカルサーバは認証しないのが普通だが、OpenAI互換クライアントはヘッダを要求するので既定値を置く。
const LOCAL_API_KEY = process.env.LOCAL_LLM_API_KEY || 'local';
// 使わせるローカルモデルのID（LM Studioの /v1/models に出るもの）をカンマ区切りで列挙する。
// 自動検出にしないのは、起動時にローカルサーバが落ちていると
// 「モデルが1つも無い」状態でAPIが立ち上がってしまうため。
const LOCAL_MODELS = (process.env.LOCAL_LLM_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

const MODEL_CHAT = process.env.LLM_MODEL_CHAT || 'claude-opus-5';
const MODEL_CLASSIFY = process.env.LLM_MODEL_CLASSIFY || 'claude-haiku-4-5';

// ------------------------------------------------------------
// モデル登録簿
//
// 1モデル = 1エントリで「どの系列か」「単価（USD per 1M tokens）」「対応パラメータ」を持つ。
// 系列(family)から呼び出し経路(provider)が決まる。
//
// cacheReadは入力単価の約0.1倍、cacheWriteは約1.25倍として計算する（cost.js）。
// ここに無いモデルはunknownとして入力=出力=0で計上されるのを避けるため、
// フォールバック単価（最も高いOpus相当）を使う。過小請求より過大見積のほうが安全。
//
// effort / adaptiveThinking はAnthropicのMessages API固有のパラメータ。
// 新しい世代のClaudeにしか無く、非対応モデル（Haiku 4.5など）に送ると400になるので、
// ユーザーがモデルを選べる以上、送る前にここで振り分ける必要がある。
// Gemini・ローカルモデルではそもそも使わない（各プロバイダ実装が無視する）。
//
// Geminiの単価は入力200kトークン以下の区分。それを超えると実際にはもう一段高いが、
// 学習支援の会話がその長さに達することはまずないので区分は分けていない。
// ------------------------------------------------------------

const BUILTIN_MODELS = {
    'claude-opus-5':          { family: 'claude', input: 5.00, output: 25.00, effort: true,  adaptiveThinking: true },
    'claude-opus-4-8':        { family: 'claude', input: 5.00, output: 25.00, effort: true,  adaptiveThinking: true },
    'claude-sonnet-5':        { family: 'claude', input: 3.00, output: 15.00, effort: true,  adaptiveThinking: true },
    'claude-sonnet-4-6':      { family: 'claude', input: 3.00, output: 15.00, effort: true,  adaptiveThinking: true },
    'claude-haiku-4-5':       { family: 'claude', input: 1.00, output: 5.00,  effort: false, adaptiveThinking: false },

    'gemini-3-pro-preview':   { family: 'gemini', input: 2.00, output: 12.00 },
    'gemini-3-flash-preview': { family: 'gemini', input: 0.50, output: 3.00 },
    'gemini-2.5-pro':         { family: 'gemini', input: 1.25, output: 10.00 },
    'gemini-2.5-flash':       { family: 'gemini', input: 0.30, output: 2.50 },
    'gemini-2.5-flash-lite':  { family: 'gemini', input: 0.10, output: 0.40 },

    // GPT-5世代はreasoning_effortを受け取るのでeffort: trueにする。
    // Chat Completionsでは max_tokens ではなく max_completion_tokens を要求する点が
    // 他と違う（openai_compatアダプタが吸収する）。
    'gpt-5.6-sol':            { family: 'openai', input: 5.00, output: 30.00, effort: true },
    'gpt-5.6-terra':          { family: 'openai', input: 2.50, output: 15.00, effort: true },
    'gpt-5.6-luna':           { family: 'openai', input: 1.00, output: 6.00,  effort: true },
};

// ローカルモデルは実行コストが計上できない（電気代はAPI課金ではない）ので単価0で扱う。
// 結果として上限判定を素通りするが、これは意図通り。ローカルなら使い放題でよい。
const LOCAL_MODEL_ENTRY = { family: 'local', input: 0, output: 0 };

const FALLBACK_PRICING = { input: 5.00, output: 25.00 };

function getModelEntry (model) {
    if (Object.prototype.hasOwnProperty.call(BUILTIN_MODELS, model)) {
        return BUILTIN_MODELS[model];
    }
    if (LOCAL_MODELS.indexOf(model) !== -1) {
        return LOCAL_MODEL_ENTRY;
    }
    return null;
}

function getPricing (model) {
    const e = getModelEntry(model);
    return e == null ? FALLBACK_PRICING : { input: e.input, output: e.output };
}

function getCapabilities (model) {
    const e = getModelEntry(model);
    // 未知のモデルは安全側に倒して、追加パラメータを一切送らない
    return {
        effort: e?.effort === true,
        adaptiveThinking: e?.adaptiveThinking === true,
    };
}

function getFamily (model) {
    return getModelEntry(model)?.family ?? null;
}

// 単価表に載っているモデルかどうか。
// 単価の分からないモデルを許可すると利用額が推定できず上限が機能しなくなるので、
// 管理画面ではここを通ったものだけを許可モデルとして受け付ける。
function isKnownModel (model) {
    return getModelEntry(model) != null;
}

function listKnownModels () {
    return [...Object.keys(BUILTIN_MODELS), ...LOCAL_MODELS];
}

// ------------------------------------------------------------
// 呼び出し経路の解決
//
// providerは「どのSDK・どのエンドポイントで喋るか」であって、モデルの系列とは別物。
// 同じClaudeでもAnthropic本家とVertexで経路が違い、同じGeminiでもVertexと
// Gemini Developer APIで違う。モデルごとに解決するのは、
// 「Vertex経由のClaudeとローカルLLM」のような混在構成を成立させるため。
// ------------------------------------------------------------

// Geminiをどちらの経路で呼ぶか。
// VERTEX_PROJECT_IDがあればVertexを優先する（両方設定されている場合もVertex）。
function geminiProvider () {
    return VERTEX_PROJECT_ID !== '' ? 'vertex-gemini' : 'gemini-api';
}

// Claudeをどちらの経路で呼ぶか。
function claudeProvider () {
    return PROVIDER === 'vertex' ? 'vertex-claude' : 'anthropic';
}

// returns: 'anthropic' | 'vertex-claude' | 'vertex-gemini' | 'gemini-api' | 'local' | null
function providerFor (model) {
    switch (getFamily(model)) {
        case 'claude': return claudeProvider();
        case 'gemini': return geminiProvider();
        case 'openai': return 'openai';
        case 'local':  return 'local';
        default:       return null;
    }
}

function isProviderConfigured (provider) {
    switch (provider) {
        case 'anthropic':    return ANTHROPIC_API_KEY !== '';
        case 'vertex-claude':
        case 'vertex-gemini': return VERTEX_PROJECT_ID !== '';
        case 'gemini-api':   return GEMINI_API_KEY !== '';
        case 'openai':       return OPENAI_API_KEY !== '';
        // モデルの列挙まで揃って初めて使える。URLだけでは何も呼べない。
        case 'local':        return LOCAL_BASE_URL !== '' && LOCAL_MODELS.length > 0;
        default:             return false;
    }
}

// そのモデルが今この環境で実際に呼べるか。
// 「登録簿に載っている」だけでは足りず、経路の認証情報まで揃っている必要がある。
function isModelAvailable (model) {
    const p = providerFor(model);
    return p != null && isProviderConfigured(p);
}

// LLM機能が使える状態かどうか。使えない場合もAPIサーバ自体は起動させ、
// LLMのエンドポイントだけが503を返すようにする（既存機能を巻き込まないため）。
// 経路が1つでも通っていれば有効とする。
function isConfigured () {
    return listKnownModels().some(isModelAvailable);
}

// 管理画面の稼働状況表示用。
// Claudeとgeminiは経路が排他なので、実際に使われる側だけを出す。
function describeProviders () {
    const claude = claudeProvider();
    const gemini = geminiProvider();
    return [
        {
            id: claude,
            label: claude === 'vertex-claude' ? 'Claude（Vertex AI）' : 'Claude（Anthropic API）',
            configured: isProviderConfigured(claude),
            detail: claude === 'vertex-claude'
                ? `project=${VERTEX_PROJECT_ID || '未設定'} / region=${VERTEX_REGION}`
                : 'ANTHROPIC_API_KEY',
        },
        {
            id: gemini,
            label: gemini === 'vertex-gemini' ? 'Gemini（Vertex AI）' : 'Gemini（Gemini API）',
            configured: isProviderConfigured(gemini),
            detail: gemini === 'vertex-gemini'
                ? `project=${VERTEX_PROJECT_ID || '未設定'} / region=${VERTEX_REGION}`
                : 'GEMINI_API_KEY',
        },
        {
            id: 'openai',
            label: 'OpenAI',
            configured: isProviderConfigured('openai'),
            detail: OPENAI_BASE_URL === 'https://api.openai.com/v1'
                ? 'OPENAI_API_KEY'
                : `OPENAI_API_KEY / ${OPENAI_BASE_URL}`,
        },
        {
            id: 'local',
            label: 'ローカルLLM（OpenAI互換 / LM Studio）',
            configured: isProviderConfigured('local'),
            detail: LOCAL_BASE_URL === ''
                ? '未設定'
                : `${LOCAL_BASE_URL}（モデル: ${LOCAL_MODELS.join(', ') || 'なし'}）`,
        },
    ];
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
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    LOCAL_BASE_URL,
    LOCAL_API_KEY,
    LOCAL_MODELS,
    MODEL_CHAT,
    MODEL_CLASSIFY,
    EFFORT,
    MAX_TOKENS,
    isConfigured,
    getPricing,
    getCapabilities,
    getFamily,
    providerFor,
    isProviderConfigured,
    isModelAvailable,
    describeProviders,
    isKnownModel,
    listKnownModels,
    ensureDefaults,
    getSetting,
    getSettingNumber,
    getSettingJSON,
    setSetting,
    billingMonth,
};
