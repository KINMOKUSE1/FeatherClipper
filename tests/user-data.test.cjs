const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const prefs = 'featherclipper:skill-builder:v1';
const historyKey = 'featherclipper:import-history:BVdemo:1:Study';
const history = { courseId: 'BVdemo', cid: '1', title: 'Lecture 1', base: 'Study', importedAt: 100 };

function boot(initial = {}, legacyValues = {}, sync = {}) {
  const data = structuredClone(initial), legacy = new Map(Object.entries(legacyValues));
  let failWrite = false;
  const local = { get: async keys => Object.fromEntries(Object.entries(data).filter(([key]) => keys == null || (Array.isArray(keys) ? keys : [keys]).includes(key))),
    set: async changes => { if (failWrite) throw new Error('storage full'); Object.assign(data, structuredClone(changes)); } };
  const context = vm.createContext({ URL, console, chrome: { runtime: { getManifest: () => ({ version: '1.3.5' }) },
    storage: { local, sync: { get: async () => sync } } },
    localStorage: { getItem: key => legacy.get(key) ?? null, removeItem: key => legacy.delete(key) } });
  for (const name of ['preferences', 'backup']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../extension/shared/${name}.js`), 'utf8'), context);
  return { data, legacy, preferences: context.Preferences, backup: context.UserBackup, fail: value => { failWrite = value; } };
}

test('old note preferences migrate once, prefer existing extension values and survive reopening', async () => {
  const h = boot({}, { [prefs]: '{"goal":"My goal"}' });
  await h.preferences.init();
  assert.equal(h.preferences.get(prefs), '{"goal":"My goal"}');
  assert.equal(h.legacy.has(prefs), false);
  await h.preferences.set(prefs, '{"goal":"New goal"}');
  await h.preferences.init({ getItem: () => '{"goal":"Old goal"}', removeItem() {} });
  assert.equal(h.preferences.get(prefs), '{"goal":"New goal"}');
  const reopened = boot(h.data); await reopened.preferences.init();
  assert.equal(reopened.preferences.get(prefs), '{"goal":"New goal"}');
});

test('failed migration keeps the original data and permits retry', async () => {
  const h = boot({}, { [prefs]: '{}' }); h.fail(true);
  await assert.rejects(h.preferences.init(), /storage full/);
  assert.equal(h.legacy.get(prefs), '{}');
  h.fail(false); await h.preferences.init();
  assert.equal(h.data[prefs], '{}');
});

test('cleared installation markers cannot be resurrected by an older localStorage value', async () => {
  const key = 'featherclipper:notes-installed:v1';
  const h = boot({ [key]: null }, { [key]: '[]' });
  await h.preferences.init(); assert.equal(h.preferences.get(key), null);
  assert.equal(h.legacy.has(key), false);
});

test('complete backup restores connection, notes, import history and course snapshots in a fresh installation', async () => {
  const original = { noteFolder: 'Study', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'Bearer test-only-secret',
    asrSettings: { provider: 'groq', keys: { groq: 'test-only-groq' } }, asrToken: 'test-only-token',
    [prefs]: '{"goal":"Review"}', 'featherclipper:ui-locale': 'en',
    [historyKey]: history, 'boc-course-v1:BVdemo:Study': { title: 'Course', pages: [{ cid: '1', status: 'saved' }] },
    'boc-course-base:BVdemo': 'Study', 'quick-import-running': { status: 'running' } };
  const old = boot(original); await old.preferences.init();
  await old.preferences.set(prefs, '{"goal":"Latest"}');
  const exported = await old.backup.exportData({ includeSecrets: true });
  assert.equal(exported.data['quick-import-running'], undefined);
  const fresh = boot(); await fresh.preferences.init();
  await fresh.backup.restore(fresh.backup.parse(JSON.stringify(exported)));
  await fresh.preferences.init();
  assert.equal(fresh.data.obsidianApiKey, 'test-only-secret');
  assert.equal(fresh.data.asrSettings.keys.groq, 'test-only-groq');
  assert.equal(fresh.data.asrToken, 'test-only-token');
  assert.equal(fresh.preferences.get(prefs), '{"goal":"Latest"}');
  assert.deepEqual(fresh.data[historyKey], history);
  assert.equal(fresh.data['boc-course-v1:BVdemo:Study'].pages[0].status, 'saved');
  assert.equal(fresh.data['boc-course-base:BVdemo'], 'Study');
});

test('default export excludes secrets without changing the saved settings', async () => {
  const h = boot({ obsidianApiKey: 'test-only-obsidian', asrToken: 'test-only-token', asrSettings: { provider: 'groq', keys: { groq: 'test-only-groq' } } });
  await h.preferences.init();
  const exported = await h.backup.exportData();
  assert.equal(exported.data.obsidianApiKey, undefined); assert.equal(exported.data.asrToken, undefined);
  assert.equal(Object.keys(exported.data.asrSettings.keys).length, 0);
  assert.equal(h.data.asrSettings.keys.groq, 'test-only-groq');
  const target = boot({ obsidianApiKey: 'existing-obsidian', asrSettings: { provider: 'siliconflow', keys: { siliconflow: 'existing-silicon' } },
    'featherclipper:import-history:another': { ...history, cid: '2' } });
  await target.preferences.init(); await target.backup.restore(exported);
  assert.equal(target.data.obsidianApiKey, 'existing-obsidian');
  assert.equal(target.data.asrSettings.keys.siliconflow, 'existing-silicon');
  assert.ok(target.data['featherclipper:import-history:another']);
});

test('backup uses old connection values from sync only when no local value exists', async () => {
  const h = boot({ noteFolder: 'Local' }, {}, { noteFolder: 'Sync', obsidianApiKey: 'test-only-key' });
  await h.preferences.init();
  const exported = await h.backup.exportData({ includeSecrets: true });
  assert.equal(exported.data.noteFolder, 'Local'); assert.equal(exported.data.obsidianApiKey, 'test-only-key');
});

test('restoring an older backup preserves newer imports and course snapshots', async () => {
  const snapshot = 'boc-course-v1:BVdemo:Study';
  const h = boot({ [historyKey]: { ...history, importedAt: 200 }, [snapshot]: { pages: [{ status: 'saved' }], updated: 200 } });
  await h.preferences.init();
  await h.backup.restore({ format: 'featherclipper-backup', version: 1, data: {
    [historyKey]: history, [snapshot]: { pages: [{ status: 'pending' }], updated: 100 } } });
  assert.equal(h.data[historyKey].importedAt, 200);
  assert.equal(h.data[snapshot].pages[0].status, 'saved');
});

test('invalid backup versions, foreign keys, broken preferences and remote endpoints cannot alter saved data', async () => {
  for (const changes of [{ format: 'other' }, { version: 2 }, { data: { unknownKey: true } },
    { data: { [prefs]: 'broken JSON' } }, { data: { obsidianApiBaseUrl: 'https://example.com' } },
    { data: { [historyKey]: {} } }, { data: { asrSettings: { provider: 'other' } } }]) {
    const h = boot({ noteFolder: 'Keep' }); await h.preferences.init();
    await assert.rejects(h.backup.restore({ format: 'featherclipper-backup', version: 1, data: {}, ...changes }));
    assert.deepEqual(h.data, { noteFolder: 'Keep' });
  }
});
