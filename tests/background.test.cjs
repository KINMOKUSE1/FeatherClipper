const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const extension = path.join(__dirname, '../extension');
function boot({ authenticated = true, existing = null, beforeSubtitle, missing = false, subtitleLists, onStored, initial = {} } = {}) {
  const local = { noteFolder: 'Clippings/Bilibili', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'test-only-key' };
  Object.assign(local, initial);
  const listeners = [], opened = [], writes = [], fetched = [];
  const locks = new Set(), vault = new Map();
  let click, context;
  const chrome = {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener: fn => listeners.push(fn) } },
    storage: { local: { get: async () => ({ ...local }), set: async data => { Object.assign(local, data); onStored?.(data); } }, sync: { get: async () => ({}) } },
    action: { onClicked: { addListener: fn => click = fn } }, tabs: { create: data => opened.push(data) }
  };
  context = vm.createContext({ chrome, console, URL, URLSearchParams, AbortSignal, setInterval, clearInterval,
    navigator: { locks: { request: async (name, options, run) => {
      if (locks.has(name)) return run(null);
      locks.add(name); try { return await run({ name }); } finally { locks.delete(name); }
    } } },
    importScripts: (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context)),
    fetch: async (url, options = {}) => {
      fetched.push(url);
      if (url.startsWith('chrome-extension://test/workflow/')) return { ok: true, text: async () => '# workflow' };
      if (url === 'http://127.0.0.1:27123/') return { ok: true, json: async () => ({ authenticated }) };
      if (url.startsWith('http://127.0.0.1:27123/vault/')) {
        if (options.method === 'PUT') { writes.push({ url, content: options.body }); vault.set(url, options.body); return { ok: true }; }
        if (decodeURIComponent(url).endsWith('/原始字幕/')) {
          const files = [...vault.keys()].filter(key => key.startsWith(url)).map(key => decodeURIComponent(key.slice(url.length)));
          return files.length ? { ok: true, json: async () => ({ files }) } : { ok: false, status: 404 };
        }
        if (vault.has(url)) return { ok: true, text: async () => vault.get(url) };
        return existing === null ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => existing };
      }
      if (url.includes('/x/web-interface/view')) return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BVexample', aid: 1, title: 'Course', owner: { name: 'Author' }, pages: [{ cid: 2, page: 1, part: '1.1 Intro', duration: 100 }] } }) };
      if (url.includes('/x/player/') && missing) return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: [] } } }) };
      if (url.includes('/x/player/') && subtitleLists) {
        const list = url.includes('/wbi/') ? subtitleLists.wbi : subtitleLists.v2;
        return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: list || [] } } }) };
      }
      if (url.includes('/x/player/')) return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: [
        { id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en' },
        { id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }
      ] } } }) };
      const body = await beforeSubtitle?.(url);
      return { ok: true, json: async () => ({ body: body || [{ from: 1, to: 3, content: '实际解析链路' }] }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  function message(payload, sender = { id: 'test', url: chrome.runtime.getURL('course.html') }) {
    return new Promise((resolve, reject) => {
      let accepted = false;
      for (const listener of listeners) accepted = listener(payload, sender, resolve) || accepted;
      if (!accepted) setImmediate(() => resolve({ ok: false, error: 'not handled' }));
    });
  }
  return { context, local, writes, fetched, message, locks, listeners, click: (...args) => click(...args), opened };
}
test('settings read hides stored Key; blank save preserves it', async () => {
  const h = boot();
  const result = await h.message({ type: 'settings-get' });
  assert.equal(result.settings.hasApiKey, true); assert.equal(result.settings.obsidianApiKey, undefined);
  await h.message({ type: 'settings-save', settings: { noteFolder: 'Study/Sources', obsidianApiKey: '' } });
  assert.equal(h.local.obsidianApiKey, 'test-only-key'); assert.equal(h.local.noteFolder, 'Study/Sources');
});
test('connection rejects non-local endpoints without sending the Key', async () => {
  const h = boot();
  const result = await h.message({ type: 'settings-test', settings: { obsidianApiBaseUrl: 'https://example.com' } });
  assert.equal(result.ok, false); assert.equal(h.fetched.length, 0);
});
test('connection test requires authenticated response', async () => {
  for (const value of [true, false]) assert.equal((await boot({ authenticated: value }).message({ type: 'settings-test', settings: {} })).ok, value);
});

test('imports reject a legacy non-local saved endpoint before sending credentials', async () => {
  const h = boot(); h.local.obsidianApiBaseUrl = 'https://api.bilibili.com';
  const result = await h.message({ type: 'course-request', action: 'workflow', base: 'Study' });
  assert.equal(result.ok, false); assert.equal(result.fatal, true); assert.equal(h.fetched.length, 0);
});
test('full worker reads metadata and previews preferred Chinese AI subtitles without writing', async () => {
  const h = boot();
  const data = await h.message({ type: 'course-request', action: 'meta', bvid: 'BVexample' });
  assert.equal(data.meta.pages[0].cid, '2');
  const result = await h.message({ type: 'course-request', action: 'preview', meta: data.meta, page: data.meta.pages[0], base: 'Clippings/Bilibili' });
  assert.equal(result.ok, true); assert.equal(result.track.lan, 'ai-zh'); assert.equal(result.body[0].content, '实际解析链路'); assert.equal(h.writes.length, 0);
});
test('English preference previews and imports the English track', async () => {
  const h = boot();
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], language: 'en' });
  assert.equal(preview.track.lan, 'en');
  const imported = await h.message({ ...quickMessage, language: 'en' }, popupSender);
  assert.equal(imported.status, 'saved');
  assert.match(h.writes.find(write => decodeURIComponent(write.url).endsWith('1.1 Intro [CID-2].md')).content, /subtitle_lang: "English"/);
});
test('an empty first subtitle list falls through to the second endpoint', async () => {
  const h = boot({ subtitleLists: { wbi: [], v2: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en' }] } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], language: 'en' });
  assert.equal(result.track.lan, 'en');
  assert.ok(h.fetched.some(url => url.includes('/x/player/wbi/v2')));
  assert.ok(h.fetched.some(url => url.includes('/x/player/v2')));
});
test('automatic language selection still prefers Chinese across endpoints', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en' }],
    v2: [{ id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }]
  } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(result.track.lan, 'ai-zh');
});
test('a missing selected language is reported without suggesting transcription', async () => {
  const h = boot({ subtitleLists: { wbi: [{ id: 1, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }], v2: [] } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], language: 'en' });
  assert.equal(result.ok, false);
  assert.match(result.error, /没有可用的英文字幕/);
});
test('English choice skips a mislabeled Chinese transcript and tries the second endpoint', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/wrong' }],
    v2: [{ id: 2, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/correct' }]
  }, beforeSubtitle: url => [{ from: 1, to: 3, content: url.endsWith('/wrong') ? '欢迎来到今天的操作系统课程我们开始学习这些重要的概念' : 'Welcome to the operating systems course' }] });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], language: 'en' });
  assert.equal(result.track.lan, 'en');
  assert.equal(result.body[0].content, 'Welcome to the operating systems course');
});
test('English choice never silently previews Chinese-only subtitle content', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/wrong' }], v2: []
  }, beforeSubtitle: () => [{ from: 1, to: 3, content: '欢迎来到今天的操作系统课程我们开始学习这些重要的概念' }] });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], language: 'en' });
  assert.equal(result.ok, false);
  assert.match(result.error, /返回了中文内容/);
});
test('workflow install skips customized documents instead of replacing them', async () => {
  const h = boot({ existing: '# user rules' });
  const result = await h.message({ type: 'course-request', action: 'workflow', base: 'Clippings/Bilibili' });
  assert.equal(result.results.length, 3); assert.ok(result.results.every(r => r.status === 'exists')); assert.equal(h.writes.length, 0);
});
test('workflow install writes three bundled markdown documents', async () => {
  const h = boot(); await h.message({ type: 'course-request', action: 'workflow', base: 'Study' });
  assert.equal(h.writes.length, 3); assert.ok(h.writes.every(w => w.content === '# workflow'));
});
test('extension messages from an unrelated page are rejected', async () => {
  const h = boot(); const sender = { id: 'test', url: 'chrome-extension://test/course.html-other' };
  assert.equal((await h.message({ type: 'settings-get' }, sender)).ok, false);
  assert.equal((await h.message({ type: 'course-request', action: 'meta', bvid: 'BVexample' }, sender)).ok, false);
  assert.equal(h.fetched.length, 0);
});
test('manifest opens the popup and retains the workspace without extra permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.equal(manifest.action.default_popup, 'popup.html'); assert.equal(manifest.side_panel, undefined); assert.equal(manifest.content_scripts, undefined);
  assert.ok(!manifest.host_permissions.includes('https://*/*')); assert.equal(manifest.options_page, 'course.html');
});

const popupSender = { id: 'test', url: 'chrome-extension://test/popup.html' };
const quickMeta = { bvid: 'BVexample', title: 'Course', author: 'Author', aid: '1', pages: [{ cid: '2', page: 1, part: '1.1 Intro', duration: 100 }] };
const quickMessage = { type: 'quick-import', meta: quickMeta, bvid: 'BVexample', cid: '2', base: 'Clippings/Bilibili' };
test('popup may configure and preview but cannot call raw course writes', async () => {
  const h = boot();
  assert.equal((await h.message({ type: 'settings-get' }, popupSender)).settings.obsidianApiKey, undefined);
  assert.equal((await h.message({ type: 'course-request', action: 'meta', bvid: 'BVexample' }, popupSender)).ok, true);
  assert.equal((await h.message({ type: 'course-request', action: 'import', meta: quickMeta, page: quickMeta.pages[0], base: 'Study' }, popupSender)).ok, false);
  assert.equal((await h.message(quickMessage)).ok, false);
});
test('quick import saves raw subtitles, index and durable status; repeat skips raw file', async () => {
  const h = boot();
  const result = await h.message(quickMessage, popupSender);
  assert.equal(result.status, 'saved');
  const state = await h.message({ ...quickMessage, type: 'quick-status' }, popupSender);
  assert.equal(state.state.status, 'saved');
  assert.equal(h.local['boc-course-v1:BVexample:Clippings/Bilibili'].pages[0].status, 'saved');
  assert.equal((await h.message(quickMessage, popupSender)).status, 'exists');
  assert.equal(h.writes.filter(w => decodeURIComponent(w.url).endsWith('1.1 Intro [CID-2].md')).length, 1);
  assert.ok(h.writes.at(-1).content.includes('已存在，跳过'));
});
test('closing popup does not own or cancel the background operation; duplicate requests share it', async () => {
  let release, entered, saved;
  const wait = new Promise(resolve => release = resolve);
  const started = new Promise(resolve => entered = resolve);
  const completed = new Promise(resolve => saved = resolve);
  const h = boot({ beforeSubtitle: async () => { entered(); await wait; }, onStored: data => {
    if (Object.entries(data).some(([key, state]) => key.startsWith('boc-quick:') && state.status === 'saved')) saved();
  } });
  // The original sender disappears and discards its response.
  for (const listener of h.listeners) listener(quickMessage, popupSender, () => {});
  await started;
  assert.equal((await h.message({ ...quickMessage, type: 'quick-status' }, popupSender)).state.status, 'running');
  const duplicate = h.message(quickMessage, popupSender);
  release(); await completed;
  assert.equal((await duplicate).status, 'saved');
  assert.equal(h.writes.filter(w => decodeURIComponent(w.url).endsWith('1.1 Intro [CID-2].md')).length, 1);
});
test('quick import respects workspace lock and reports missing subtitles and failures', async () => {
  const locked = boot(); locked.locks.add('boc-course:BVexample');
  assert.match((await locked.message(quickMessage, popupSender)).error, /正在导入/);
  assert.equal(locked.writes.length, 0);
  assert.equal((await boot({ missing: true }).message(quickMessage, popupSender)).status, 'missing');
  const failed = boot({ existing: '# user note' });
  assert.equal((await failed.message(quickMessage, popupSender)).status, 'failed');
  assert.equal(failed.writes.length, 0);
});
test('worker restart turns stale running status into a retryable result', async () => {
  const key = 'boc-quick:BVexample:2:Clippings/Bilibili';
  const h = boot({ initial: { [key]: { status: 'running' } } });
  const result = await h.message({ ...quickMessage, type: 'quick-status' }, popupSender);
  assert.equal(result.state.status, 'failed'); assert.match(result.state.error, /中断/);
});
