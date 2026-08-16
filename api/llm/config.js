// LLM機能の設定
//
// 方針: envには「環境ごとに変わるもの」（APIキー、プロバイダ、モデルの最終フォールバック）だけを置く。
// 金額や難易度マッピングのように管理画面から変更するものはDB（llm_settings）に置く。
// 両方に置くと二重管理になって必ずズレる。

const fs = require('node:fs');

const { db } = require('../db.js');

// ------------------------------------------------------------
// env
// ------------------------------------------------------------

// Claudeをどこ経由で呼ぶか。anthropic（本家API） | vertex（Vertex AI）。
// Geminiとローカルモデルの経路はこの値では決まらない（後述のproviderForを参照）。
const PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ------------------------------------------------------------
// Vertex AI（現 Gemini Enterprise Agent Platform）の認証
//
// サービスアカウントの鍵(JSON)へのパスを指定すると、その鍵で認証する。
// 未指定なら従来どおりADC（gcloud auth application-default login / メタデータサーバ）。
//
// 変数名をGCP標準の GOOGLE_APPLICATION_CREDENTIALS のままにしているのは、
// これがgoogle-auth-library自身が読む名前でもあるため。
// こちらの実装を通らない経路（コンテナ内のgcloudや別のGCPクライアント）でも
// 同じ鍵が効くので、資格情報が1か所で済む。
// ------------------------------------------------------------

const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';

// Vertex AIを呼ぶのに必要なOAuthスコープ。
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// 鍵ファイルを起動時に1度だけ読んで検証する。
//
// 例外を投げずに状態として持つのは、鍵の設定ミスでAPIサーバ全体を起動不能に
// しないため（ジャッジや問題閲覧は鍵と無関係）。不備は管理画面の稼働状況に出す。
//
// private_key は検証に使わないので読み捨てる。ログにも管理画面にも載せない。
//
// returns: { state: 'adc' | 'service-account' | 'error', projectId, clientEmail?, error? }
function inspectCredentials (keyFile) {
    if (keyFile === '') {
        return { state: 'adc', projectId: null };
    }

    let raw;
    try {
        raw = fs.readFileSync(keyFile, 'utf8');
    }
    catch (e) {
        return { state: 'error', projectId: null, error: `${keyFile} を読み取れません（${e.code ?? e.message}）` };
    }

    let json;
    try {
        json = JSON.parse(raw);
    }
    catch (e) {
        return { state: 'error', projectId: null, error: `${keyFile} がJSONとして壊れています` };
    }

    // APIキーやOAuthクライアントのJSONを間違って置いた場合をここで弾く。
    // そのまま渡すとgoogle-auth-libraryの英語エラーになって原因が分かりにくい。
    if (json.type !== 'service_account') {
        return { state: 'error', projectId: null, error: `${keyFile} はサービスアカウント鍵ではありません（type=${json.type ?? '不明'}）` };
    }
    if (typeof json.client_email !== 'string' || json.client_email === '') {
        return { state: 'error', projectId: null, error: `${keyFile} に client_email がありません` };
    }

    return {
        state: 'service-account',
        projectId: typeof json.project_id === 'string' && json.project_id !== '' ? json.project_id : null,
        clientEmail: json.client_email,
    };
}

const VERTEX_CREDENTIALS = inspectCredentials(GOOGLE_APPLICATION_CREDENTIALS);

// 鍵ファイルを明示しない場合に使うADCの検出結果。
// GoogleAuth は、well-known file、Workload Identity、メタデータサーバなど
// 対応する認証経路を解決し、アクセストークンを取得できるところまで確認する。API呼び出しや
// モデル推論は行わないため、この確認自体にVertex AIの利用料金は発生しない。
const VERTEX_ADC = {
    state: VERTEX_CREDENTIALS.state === 'adc' ? 'unchecked' : 'not-used',
    error: null,
};

// プロジェクトIDは明示指定を優先し、無ければ鍵ファイルのproject_idを使う。
// 鍵を置いただけでVertex経路に乗るようにしておかないと、VERTEX_PROJECT_IDの
// 書き忘れでGeminiが黙ってGemini Developer API側に落ちる（下のgeminiProviderを参照）。
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || VERTEX_CREDENTIALS.projectId || '';
const VERTEX_REGION = process.env.VERTEX_REGION || 'global';

// google-auth-libraryに渡す認証オプション。
// 鍵ファイルが無ければundefinedを返し、各SDKの既定（ADC）に委ねる。
function vertexAuthOptions () {
    if (VERTEX_CREDENTIALS.state !== 'service-account') {
        return undefined;
    }
    // scopesは明示する。@google/genaiは未指定でも補ってくれるが、
    // @anthropic-ai/vertex-sdkはgoogleAuthを渡した時点で既定のGoogleAuth
    // （scopes指定込み）ごと置き換わるので、こちらで付けないとscopeが足りなくなる。
    return { keyFile: GOOGLE_APPLICATION_CREDENTIALS, scopes: [VERTEX_SCOPE] };
}

// 鍵ファイルの指定はあるのに使えない場合はここで止める。
// 黙ってADCにフォールバックすると、鍵を置いたつもりの環境が別の資格情報で
// 動いてしまい、権限や課金先がずれていても気づけない。
function assertVertexCredentials () {
    if (VERTEX_CREDENTIALS.state === 'error') {
        throw new Error(`GOOGLE_APPLICATION_CREDENTIALS の鍵ファイルが使えません: ${VERTEX_CREDENTIALS.error}`);
    }
}

// 起動時に一度だけADCを解決する。
// VERTEX_PROJECT_IDが無い環境ではVertex経路自体を選ばないので問い合わせない。
async function initializeVertexAuth () {
    if (VERTEX_CREDENTIALS.state !== 'adc' || VERTEX_PROJECT_ID === '') {
        return;
    }

    try {
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (token == null || (typeof token === 'object' ? token.token : token) == null) {
            throw new Error('アクセストークンを取得できませんでした');
        }
        VERTEX_ADC.state = 'available';
        VERTEX_ADC.error = null;
    }
    catch (e) {
        VERTEX_ADC.state = 'unavailable';
        VERTEX_ADC.error = e?.message ?? String(e);
    }
}

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
    'claude-opus-5':          { family: 'claude', input: 5.00, output: 25.00, maxTokens: 8000, effort: true,  adaptiveThinking: true },
    'claude-opus-4-8':        { family: 'claude', input: 5.00, output: 25.00, maxTokens: 8000, effort: true,  adaptiveThinking: true },
    'claude-sonnet-5':        { family: 'claude', input: 3.00, output: 15.00, maxTokens: 8000, effort: true,  adaptiveThinking: true },
    'claude-sonnet-4-6':      { family: 'claude', input: 3.00, output: 15.00, maxTokens: 8000, effort: true,  adaptiveThinking: true },
    'claude-haiku-4-5':       { family: 'claude', input: 1.00, output: 5.00,  maxTokens: 4000, effort: false, adaptiveThinking: false },

    // 3.7/3.6 Flashは2026-12-31までの割引価格。2027-01-01に値上がりするので要更新。
    'gemini-3.7-flash':       { family: 'gemini', input: 0.75, output: 3.75,  maxTokens: 8000 },
    'gemini-3.6-flash':       { family: 'gemini', input: 0.75, output: 3.75,  maxTokens: 8000 },
    'gemini-3.5-flash':       { family: 'gemini', input: 1.50, output: 9.00,  maxTokens: 8000 },
    'gemini-3.5-flash-lite':  { family: 'gemini', input: 0.30, output: 2.50,  maxTokens: 4000 },
    'gemini-3.1-pro-preview': { family: 'gemini', input: 2.00, output: 12.00, maxTokens: 8000 },
    'gemini-3.1-flash-lite':  { family: 'gemini', input: 0.25, output: 1.50,  maxTokens: 4000 },
    'gemini-2.5-pro':         { family: 'gemini', input: 1.25, output: 10.00, maxTokens: 8000 },
    'gemini-2.5-flash':       { family: 'gemini', input: 0.30, output: 2.50,  maxTokens: 8000 },
    'gemini-2.5-flash-lite':  { family: 'gemini', input: 0.10, output: 0.40,  maxTokens: 4000 },

    // GPT-5世代はreasoning_effortを受け取るのでeffort: trueにする。
    // Chat Completionsでは max_tokens ではなく max_completion_tokens を要求する点が
    // 他と違う（openai_compatアダプタが吸収する）。
    'gpt-5.6-sol':            { family: 'openai', input: 5.00, output: 30.00, maxTokens: 8000, effort: true },
    'gpt-5.6-terra':          { family: 'openai', input: 2.50, output: 15.00, maxTokens: 8000, effort: true },
    'gpt-5.6-luna':           { family: 'openai', input: 1.00, output: 6.00,  maxTokens: 8000, effort: true },
};

// ローカルモデルは実行コストが計上できない（電気代はAPI課金ではない）ので単価0で扱う。
// 結果として上限判定を素通りするが、これは意図通り。ローカルなら使い放題でよい。
//
// maxTokensを他より大幅に小さくしているのは、ローカルサーバのコンテキスト長が
// モデルの上限ではなくロード時の設定で決まるため。LM Studioの既定は8192で、
// systemプロンプト＋ツール定義だけで2000トークン以上使う。ここを8000にすると
// 入力と合わせてコンテキストを超える。足りなければ LLM_MAX_TOKENS で上書きする。
const LOCAL_MODEL_ENTRY = { family: 'local', input: 0, output: 0, maxTokens: 2000 };

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
        // 鍵ファイルが壊れている場合はADCに落ちて別の資格情報で動くのを避けるため未設定扱いにする
        case 'vertex-claude':
        case 'vertex-gemini':
            return VERTEX_PROJECT_ID !== '' &&
                VERTEX_CREDENTIALS.state !== 'error' &&
                (VERTEX_CREDENTIALS.state === 'service-account' || VERTEX_ADC.state === 'available');
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

// Vertex経路の設定内容。どの資格情報で動いているかが分からないと、
// 権限不足や課金先違いを管理画面から切り分けられない。
function vertexDetail () {
    const base = `project=${VERTEX_PROJECT_ID || '未設定'} / region=${VERTEX_REGION}`;
    switch (VERTEX_CREDENTIALS.state) {
        case 'service-account': return `${base} / SA: ${VERTEX_CREDENTIALS.clientEmail}`;
        case 'error':           return `${base} / 鍵ファイルエラー: ${VERTEX_CREDENTIALS.error}`;
        default: {
            if (VERTEX_ADC.state === 'available') {
                return `${base} / ADC: 利用可能`;
            }
            if (VERTEX_ADC.state === 'unavailable') {
                return `${base} / ADC: 利用不可（${VERTEX_ADC.error}）`;
            }
            return `${base} / ADC: 未確認`;
        }
    }
}

// 管理画面の稼働状況表示用。
//
// ClaudeとGeminiは経路が排他だが、両方の行を出す。
// 使われない側を隠すと、設定してあるのに使われていないのか、そもそも設定が
// 効いていないのかを画面から区別できない（特にVertexの鍵は、経路を
// 切り替えて実際に呼ぶまで正しさが分からない状態になっていた）。
//
// 実際に使う側は active で示し、使わない側には切り替え方を添える。
// activeがnullの経路は排他の組に属さない（常に自分の系列で使われる）。
function describeProviders () {
    const claude = claudeProvider();
    const gemini = geminiProvider();
    return [
        {
            id: 'anthropic',
            label: 'Claude（Anthropic API）',
            configured: isProviderConfigured('anthropic'),
            active: claude === 'anthropic',
            switchHint: claude === 'anthropic' ? null : 'LLM_PROVIDER=anthropic で切り替え',
            detail: 'ANTHROPIC_API_KEY',
        },
        {
            id: 'vertex-claude',
            label: 'Claude（Vertex AI）',
            configured: isProviderConfigured('vertex-claude'),
            active: claude === 'vertex-claude',
            switchHint: claude === 'vertex-claude' ? null : 'LLM_PROVIDER=vertex で切り替え',
            detail: vertexDetail(),
        },
        {
            id: 'vertex-gemini',
            label: 'Gemini（Vertex AI）',
            configured: isProviderConfigured('vertex-gemini'),
            active: gemini === 'vertex-gemini',
            switchHint: gemini === 'vertex-gemini' ? null : 'VERTEX_PROJECT_ID を設定すると切り替わる',
            detail: vertexDetail(),
        },
        {
            id: 'gemini-api',
            label: 'Gemini（Gemini API）',
            configured: isProviderConfigured('gemini-api'),
            active: gemini === 'gemini-api',
            switchHint: gemini === 'gemini-api' ? null : 'VERTEX_PROJECT_ID を空にすると切り替わる',
            detail: 'GEMINI_API_KEY',
        },
        {
            id: 'openai',
            label: 'OpenAI',
            configured: isProviderConfigured('openai'),
            active: null,
            switchHint: null,
            detail: OPENAI_BASE_URL === 'https://api.openai.com/v1'
                ? 'OPENAI_API_KEY'
                : `OPENAI_API_KEY / ${OPENAI_BASE_URL}`,
        },
        {
            id: 'local',
            label: 'ローカルLLM（OpenAI互換 / LM Studio）',
            configured: isProviderConfigured('local'),
            active: null,
            switchHint: null,
            detail: LOCAL_BASE_URL === ''
                ? '未設定'
                : `${LOCAL_BASE_URL}（モデル: ${LOCAL_MODELS.join(', ') || 'なし'}）`,
        },
    ];
}

// 対話の思考の深さ。低めでも十分な品質が出るうえ、月次上限のあるユーザーには
// トークン消費が直接効くので既定はmediumにしておく。
const EFFORT = process.env.LLM_EFFORT || 'medium';

// 1ターンの出力上限。
//
// 適正値はモデルごとに違うので、既定は登録簿（BUILTIN_MODELS.maxTokens）に持たせる。
// 思考する世代は思考トークンもこの枠に含まれるため余裕がいる一方、
// ローカルモデルはロード時のコンテキスト長に縛られて逆に小さくする必要がある。
//
// LLM_MAX_TOKENS を設定した場合は全モデルでそちらを優先する
// （運用側が意図的に絞りたい・広げたいケースを塞がないため）。
const MAX_TOKENS_OVERRIDE = process.env.LLM_MAX_TOKENS
    ? Number(process.env.LLM_MAX_TOKENS)
    : null;

const DEFAULT_MAX_TOKENS = 4000;

function getMaxTokens (model) {
    if (MAX_TOKENS_OVERRIDE != null && Number.isFinite(MAX_TOKENS_OVERRIDE) && MAX_TOKENS_OVERRIDE > 0) {
        return MAX_TOKENS_OVERRIDE;
    }
    return getModelEntry(model)?.maxTokens ?? DEFAULT_MAX_TOKENS;
}

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
    vertexAuthOptions,
    assertVertexCredentials,
    initializeVertexAuth,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    LOCAL_BASE_URL,
    LOCAL_API_KEY,
    LOCAL_MODELS,
    MODEL_CHAT,
    MODEL_CLASSIFY,
    EFFORT,
    getMaxTokens,
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
