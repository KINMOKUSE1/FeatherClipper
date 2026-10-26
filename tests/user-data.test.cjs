const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const prefs = 'featherclipper:skill-builder:v1';

function boot(initial = {}, legacyValues = {}) {
  const data = structuredClone(initial), legacy = new Map(Object.entries(legacyValues));
  let failWrite = false;
  const local = { get: async keys => Object.fromEntries(Object.entries(data).filter(([key]) => keys == null || (Array.isArray(keys) ? keys : [keys]).includes(key))),
    set: async changes => { if (failWrite) throw new Error('storage full'); Object.assign(data, structuredClone(changes)); } };
  const context = vm.createContext({ chrome: { storage: { local } },
    localStorage: { getItem: key => legacy.get(key) ?? null, removeItem: key => legacy.delete(key) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/shared/preferences.js'), 'utf8'), context);
  return { data, legacy, preferences: context.Preferences, fail: value => { failWrite = value; } };
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
