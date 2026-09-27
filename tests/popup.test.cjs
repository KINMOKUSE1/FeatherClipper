const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');

test('popup displays preview and enables import before language options arrive; stale options are ignored', async () => {
  const elements = new Map(), pending = [], choices = [];
  const element = () => ({ textContent: '', value: '', children: [], classList: { toggle() {} },
    addEventListener() {}, append(...items) { this.children.push(...items); } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ URL, console, CourseCore: core, window: { close() {} },
    document: { getElementById: get, createElement: element, createTextNode: text => text },
    SubtitleLanguage: { create: async () => ({ current: () => 'auto', tracks: list => choices.push(list) }) },
    chrome: {
      tabs: { query: async () => [{ url: 'https://www.youtube.com/watch?v=GWwL_pLuX-U' }] },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async message => {
        if (message.type === 'settings-get') return { ok: true, settings: { hasApiKey: true } };
        if (message.type === 'quick-status') return { ok: true, key: 'job' };
        if (message.action === 'meta') return { ok: true, folder: 'Study', meta: {
          platform: 'youtube', videoId: message.youtubeId, bvid: `YT_${message.youtubeId}`, title: 'Current video',
          pages: [{ cid: message.youtubeId, page: 1, part: 'Lesson' }]
        } };
        if (message.action === 'preview') return { ok: true, track: { lan: 'en' }, body: [{ from: 7, content: 'Already visible' }] };
        if (message.action === 'tracks') return new Promise(resolve => pending.push(resolve));
        throw new Error('Unexpected request');
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(pending.length, 1);
  assert.equal(get('video').hidden, false);
  assert.equal(get('subtitles').children.length, 1);
  assert.equal(get('import').disabled, false);
  assert.equal(get('read').disabled, false);
  get('url').value = 'https://www.youtube.com/watch?v=abcdef12345';
  const next = context.loadVideo();
  await new Promise(setImmediate);
  pending[0]({ ok: true, tracks: [{ id: 'old' }] });
  await new Promise(setImmediate);
  assert.ok(!choices.some(list => list.some(track => track.id === 'old')));
  pending[1]({ ok: true, tracks: [{ id: 'new' }] });
  await next;
  assert.equal(choices.at(-1)[0].id, 'new');
});
