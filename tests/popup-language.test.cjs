const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/popup/language-gate.js'), 'utf8');

function gate(locale, { preview = false, storageError = false } = {}) {
  const redirects = [], classes = [], reads = [];
  const context = vm.createContext({ URL, window: { frameElement: preview ? { id: 'popup-preview' } : null },
    location: { replace: url => redirects.push(url) },
    document: { baseURI: 'chrome-extension://unit/popup/index.html', documentElement: { classList: { remove: name => classes.push(name) } } },
    chrome: { storage: { local: { get: async key => {
      reads.push(key);
      if (storageError) throw new Error('Storage unavailable');
      return locale == null ? {} : { [key]: locale };
    } } } }
  });
  vm.runInContext(source, context);
  return { ready: context.window.PopupLanguageReady, redirects, classes, reads };
}

test('first popup visit routes to a standalone language page before normal startup', async () => {
  const state = gate();
  assert.equal(await state.ready, false);
  assert.deepEqual(state.redirects, ['chrome-extension://unit/popup/first-run.html']);
  assert.deepEqual(state.reads, ['featherclipper:ui-locale']);
});

test('all saved language choices enter the original popup directly', async () => {
  for (const locale of ['zh-CN', 'en', 'zh-TW']) {
    const state = gate(locale);
    assert.equal(await state.ready, true);
    assert.deepEqual(state.redirects, []);
    assert.deepEqual(state.classes, ['popup-routing']);
  }
});

test('missing or unsupported preferences and unreadable storage route to usable setup', async () => {
  for (const state of [gate(null), gate('unsupported'), gate(null, { storageError: true })]) {
    assert.equal(await state.ready, false);
    assert.deepEqual(state.redirects, ['chrome-extension://unit/popup/first-run.html']);
  }
});

test('regular development previews keep their original scenarios without installation state', async () => {
  const state = gate(null, { preview: true });
  assert.equal(await state.ready, true);
  assert.deepEqual(state.reads, []);
  assert.deepEqual(state.redirects, []);
});
