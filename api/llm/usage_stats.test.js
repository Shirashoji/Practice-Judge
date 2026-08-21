const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('better-sqlite3');

const { summarizeCurrentMonthUsage, summarizeUsageAnalytics } = require('./usage_stats.js');

function createDatabase (t) {
    const database = new sqlite3(':memory:');
    database.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL
        );
        INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob');

        CREATE TABLE llm_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            conversation_id INTEGER,
            turn_id INTEGER,
            billing_month TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0,
            cache_write_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    t.after(() => database.close());
    return database;
}

function insertUsage (database, patch = {}) {
    database.prepare(`
        INSERT INTO llm_usage
            (user_id, conversation_id, turn_id, billing_month, provider, model,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at)
        VALUES
            (@userId, @conversationId, @turnId, @billingMonth, @provider, @model,
             @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd, @createdAt)
    `).run({
        userId: 1,
        conversationId: 1,
        turnId: 1,
        billingMonth: '2026-09',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        createdAt: '2026-08-31 15:00:00',
        ...patch,
    });
}

test('UTCの月末をJSTの翌月初日として集計し、今日まで利用ゼロの日を埋める', (t) => {
    const database = createDatabase(t);
    insertUsage(database, { costUsd: 0.25 });

    const summary = summarizeCurrentMonthUsage(
        database,
        '2026-09',
        new Date('2026-09-02T03:00:00Z')
    );

    assert.deepEqual(summary.dailyCosts, [
        { date: '2026-09-01', costUsd: 0.25, modelCalls: 1 },
        { date: '2026-09-02', costUsd: 0, modelCalls: 0 },
    ]);
});

test('providerとmodelの組で集計し、0円のローカルモデルも残す', (t) => {
    const database = createDatabase(t);
    insertUsage(database, { costUsd: 0.1, inputTokens: 100 });
    insertUsage(database, { turnId: 2, costUsd: 0.2, outputTokens: 20 });
    insertUsage(database, {
        userId: 2,
        conversationId: 2,
        turnId: 3,
        provider: 'vertex-claude',
        costUsd: 0.3,
        cacheReadTokens: 30,
    });
    insertUsage(database, {
        userId: 2,
        conversationId: 3,
        turnId: 4,
        provider: 'local',
        model: 'local-model',
        costUsd: 0,
        cacheWriteTokens: 40,
    });

    const summary = summarizeCurrentMonthUsage(
        database,
        '2026-09',
        new Date('2026-09-01T12:00:00Z')
    );

    assert.equal(summary.byModel.length, 3);
    const vertex = summary.byModel.find((row) => row.provider === 'vertex-claude');
    assert.deepEqual(vertex, {
        provider: 'vertex-claude',
        model: 'claude-sonnet-5',
        costUsd: 0.3,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
        modelCalls: 1,
    });
    const anthropic = summary.byModel.find((row) => row.provider === 'anthropic');
    assert.deepEqual(anthropic, {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        costUsd: 0.30000000000000004,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelCalls: 2,
    });
    const local = summary.byModel.find((row) => row.provider === 'local');
    assert.deepEqual(local, {
        provider: 'local',
        model: 'local-model',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 40,
        modelCalls: 1,
    });
});

test('合計値が日次・モデル別の合算と一致する', (t) => {
    const database = createDatabase(t);
    insertUsage(database, {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 30,
        costUsd: 0.1,
    });
    insertUsage(database, {
        userId: 2,
        conversationId: 2,
        turnId: 2,
        provider: 'gemini-api',
        model: 'gemini-3.5-flash',
        inputTokens: 200,
        outputTokens: 40,
        cacheReadTokens: 50,
        cacheWriteTokens: 60,
        costUsd: 0.4,
        createdAt: '2026-09-01 15:00:00',
    });

    const summary = summarizeCurrentMonthUsage(
        database,
        '2026-09',
        new Date('2026-09-02T12:00:00Z')
    );

    assert.deepEqual(summary.totals, {
        costUsd: 0.5,
        inputTokens: 300,
        outputTokens: 50,
        cacheReadTokens: 70,
        cacheWriteTokens: 90,
        modelCalls: 2,
        activeUsers: 2,
        conversations: 2,
    });
    assert.equal(
        summary.dailyCosts.reduce((sum, row) => sum + row.costUsd, 0),
        summary.totals.costUsd
    );
    assert.equal(
        summary.byModel.reduce((sum, row) => sum + row.costUsd, 0),
        summary.totals.costUsd
    );
});

test('月次分析で日別TOKEN数とユーザー別利用量を同じ明細から集計する', (t) => {
    const database = createDatabase(t);
    insertUsage(database, {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        costUsd: 0.1,
    });
    insertUsage(database, {
        turnId: 2,
        inputTokens: 50,
        outputTokens: 10,
        cacheWriteTokens: 40,
        costUsd: 0.2,
    });
    insertUsage(database, {
        userId: 2,
        conversationId: 2,
        turnId: 3,
        provider: 'local',
        model: 'local-model',
        inputTokens: 500,
        outputTokens: 100,
        costUsd: 0,
    });

    const summary = summarizeUsageAnalytics(
        database,
        '2026-09',
        '2026-09-01',
        new Date('2026-09-02T03:00:00Z')
    );

    assert.equal(summary.month.daily.length, 2);
    assert.deepEqual(summary.month.daily[0], {
        date: '2026-09-01',
        costUsd: 0.30000000000000004,
        inputTokens: 650,
        outputTokens: 130,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        totalTokens: 850,
        modelCalls: 3,
        activeUsers: 2,
        conversations: 2,
    });
    assert.equal(summary.month.daily[1].totalTokens, 0);
    assert.equal(summary.month.byUser[0].username, 'bob');
    assert.equal(summary.month.byUser[0].totalTokens, 600);
    assert.equal(summary.month.byUser[1].username, 'alice');
    assert.equal(summary.month.byUser[1].modelCalls, 2);
    assert.equal(summary.selectedDay.totals.totalTokens, 850);
    assert.equal(summary.selectedDay.byModel.length, 2);
});

test('過去月は月末までゼロ日を埋め、選択可能な月を新しい順で返す', (t) => {
    const database = createDatabase(t);
    insertUsage(database, {
        billingMonth: '2026-08',
        createdAt: '2026-07-31 15:00:00',
        inputTokens: 10,
    });

    const summary = summarizeUsageAnalytics(
        database,
        '2026-08',
        null,
        new Date('2026-09-02T03:00:00Z')
    );

    assert.equal(summary.month.daily.length, 31);
    assert.equal(summary.month.daily[0].date, '2026-08-01');
    assert.equal(summary.month.daily[30].date, '2026-08-31');
    assert.deepEqual(summary.availableMonths, ['2026-09', '2026-08']);
});
