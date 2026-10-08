const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');

test('popup displays automatic preview without requesting language options', async () => {
  const elements = new Map(), messages = [];
  const element = () => ({ textContent: '', value: '', children: [], classList: { toggle() {} },
    addEventListener() {}, setAttribute() {}, append(...items) { this.children.push(...items); } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ URL, console, CourseCore: core, window: { close() {} },
    document: { getElementById: get, createElement: element, createTextNode: text => text },
    chrome: {
      tabs: { query: async () => [{ url: 'https://www.youtube.com/watch?v=GWwL_pLuX-U' }] },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async message => {
        messages.push(message);
        if (message.type === 'settings-get') return { ok: true, settings: { hasApiKey: true } };
        if (message.type === 'quick-status') return { ok: true, key: 'job' };
        if (message.action === 'meta') return { ok: true, folder: 'Study', meta: {
          platform: 'youtube', videoId: message.youtubeId, bvid: `YT_${message.youtubeId}`, title: 'Current video',
          pages: [{ cid: message.youtubeId, page: 1, part: 'Lesson' }]
        } };
        if (message.action === 'preview') return { ok: true, track: { lan: 'en' }, body: [{ from: 7, content: 'Already visible' }] };
        throw new Error('Unexpected request');
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(get('video').hidden, false);
  assert.equal(get('subtitles').children.length, 1);
  assert.equal(get('import').disabled, false);
  assert.equal(get('read').disabled, false);
  get('url').value = 'https://www.youtube.com/watch?v=abcdef12345';
  await context.loadVideo();
  assert.ok(messages.every(message => message.action !== 'tracks' && !('language' in message)));
});

test('popup keeps single-video saves separate from explicit whole-course handoff and exposes preview errors', async () => {
  const elements = new Map(), messages = [], opened = [];
  const element = () => ({ textContent: '', value: '', children: [], attributes: {}, listeners: {}, classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(...items) { this.children.push(...items); } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let count = 1, previewError = false, missing = false;
  const context = vm.createContext({ URL, console, CourseCore: core, window: { close() {} },
    document: { getElementById: get, createElement: element, createTextNode: text => text },
    chrome: {
      tabs: { query: async () => [{ url: 'https://www.bilibili.com/video/BV1ps4y1d73V/' }], create: async tab => opened.push(tab) },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: { getURL: name => `chrome-extension://test/${name}`, sendMessage: async message => {
        messages.push(message);
        if (message.type === 'settings-get') return { ok: true, settings: { hasApiKey: true } };
        if (message.type === 'quick-status') return { ok: true, key: 'job' };
        if (message.type === 'quick-import') return { ok: true, status: 'saved' };
        if (message.action === 'meta') return { ok: true, folder: 'Study', meta: {
          bvid: message.bvid, title: 'A long course title',
          pages: Array.from({ length: count }, (_, i) => ({ cid: String(i + 1), page: i + 1, part: `Lesson ${i + 1}` }))
        } };
        if (message.action === 'preview') {
          if (previewError) return { ok: false, error: 'Please log in' };
          return { ok: true, missing, body: missing ? [] : [{ from: 0, content: 'Transcript' }] };
        }
        throw new Error('Unexpected request');
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(get('current-part').hidden, true);
  assert.equal(get('save-scope').hidden, true);
  assert.equal(get('source-panel').hidden, true);
  assert.equal(get('preview-panel').open, false);
  await get('import').listeners.click();
  assert.equal(messages.filter(m => m.type === 'quick-import').length, 1);
  assert.equal(opened.length, 0);

  count = 92;
  await context.loadVideo();
  assert.equal(get('scope-current').attributes['aria-pressed'], 'true');
  assert.equal(get('save-scope').hidden, false);
  get('scope-all').listeners.click();
  assert.match(get('import-label').textContent, /92 P/);
  await get('import').listeners.click();
  const target = new URL(opened[0].url);
  assert.equal(target.searchParams.get('scope'), 'all');
  assert.equal(target.searchParams.get('bvid'), 'BV1ps4y1d73V');
  assert.equal(messages.filter(m => m.type === 'quick-import').length, 1);

  missing = true;
  await context.loadVideo();
  assert.equal(get('import').disabled, true);
  assert.equal(get('asr-open').hidden, false);
  get('scope-all').listeners.click();
  assert.equal(get('import').disabled, false);

  previewError = true;
  await context.loadVideo();
  assert.equal(get('preview-panel').open, true);
  assert.match(get('subtitles').textContent, /Please log in/);
  assert.equal(get('import').disabled, true);
});
