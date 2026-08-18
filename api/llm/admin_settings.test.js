const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeModelSettings } = require('./admin_settings.js');

test('env から削除されたローカルモデルを保存対象から除く', () => {
    const known = new Set(['claude-sonnet-5']);
    const result = normalizeModelSettings(
        ['claude-sonnet-5', 'local-model'],
        { 1: 'local-model', 2: 'claude-sonnet-5' },
        (model) => known.has(model)
    );

    assert.deepEqual(result, {
        allowedModels: ['claude-sonnet-5'],
        modelByDifficulty: { 2: 'claude-sonnet-5' },
    });
});

test('壊れた保存値は空の設定として扱う', () => {
    const result = normalizeModelSettings(null, ['local-model'], () => true);

    assert.deepEqual(result, { allowedModels: [], modelByDifficulty: {} });
});
