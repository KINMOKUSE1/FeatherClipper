const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/shared/course.js');

test('popup displays automatic preview without requesting language options', async () => {
  const elements = new Map(), messages = [];
  const element = () => ({ textContent: '', value: '', children: [], classList: { toggle() {} },
    addEventListener() {}, setAttribute() {}, append(...items) { this.children.push(...items); } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'), URL, console, CourseCore: core, window: { close() {} },
    document: { getElementById: get, createElement: element, createTextNode: text => text, addEventListener() {} },
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
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup/page.js'), 'utf8'), context);
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
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'), URL, console, CourseCore: core, window: { close() {} },
    document: { getElementById: get, createElement: element, createTextNode: text => text, addEventListener() {} },
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
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup/page.js'), 'utf8'), context);
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

async function exportHarness({ languages = false, youtube = false } = {}) {
  const elements = new Map(), messages = [], copied = [], downloads = [], opened = [];
  const element = () => ({ set textContent(value) { this.text = value; this.children = []; }, get textContent() { return this.text || ''; }, value: '', children: [], attributes: {}, listeners: {}, style: {}, offsetWidth: 150, offsetHeight: 112, classList: { toggle() {} },
    focus() {}, contains() { return false; },
    getBoundingClientRect() { return { left: 120, top: 220, bottom: 240 }; },
    showPopover() { this.open = true; }, hidePopover() { this.open = false; },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(...items) { this.children.push(...items); } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'), URL, console, CourseCore: core, window: { close() {} },
    document: { documentElement: { clientWidth: 400, clientHeight: 600 }, getElementById: get, createElement: element, createTextNode: text => text, addEventListener() {} },
    navigator: { clipboard: { writeText: async text => {
      if (context.clipboardFail) throw new Error('Clipboard denied');
      copied.push(text);
    } } },
    chrome: {
      downloads: { download: async options => { downloads.push(options); return 1; } },
      tabs: { query: async () => [{ url: youtube ? 'https://www.youtube.com/watch?v=GWwL_pLuX-U' : 'https://www.bilibili.com/video/BV1ps4y1d73V/' }], create: async tab => opened.push(tab) },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: { getURL: name => `chrome-extension://test/${name}`, sendMessage: async message => {
        messages.push(message);
        if (message.type === 'settings-get') return { ok: true, settings: { hasApiKey: languages || youtube } };
        if (message.type === 'quick-status') return { ok: true, key: 'job' };
        if (message.type === 'quick-import') return { ok: true, status: 'saved' };
        if (message.action === 'meta') return { ok: true, folder: 'Study', meta: {
          ...(youtube ? { platform: 'youtube', videoId: message.youtubeId, bvid: `YT_${message.youtubeId}` } : { bvid: message.bvid }), title: 'Export course', author: 'Teacher',
          pages: youtube ? [{ cid: message.youtubeId, page: 1, part: 'Export lesson' }] : [{ cid: '1', page: 1, part: '1. Export: Lesson' }, { cid: '2', page: 2, part: '2. Other' }]
        } };
        if (message.action === 'preview' && context.trackFail) return { ok: false, error: 'Selected subtitle unavailable' };
        if (message.action === 'preview') return { ok: true, tracks: context.missing ? [] : languages ? [{ id: 'zh', lan: 'zh', lanDoc: '中文' }, { id: 'en', lan: 'en', lanDoc: 'English' }] : [], track: languages && message.trackId !== 'en' ? { id: 'zh', lan: 'zh', lanDoc: '中文' } : { id: 'en', lan: 'en', lanDoc: 'English' },
          missing: context.missing, body: context.missing ? [] : Array.from({ length: 20 }, (_, i) => ({ from: i * 40, to: i * 40 + 1, content: `Line ${i + 1}.` })) };
        throw new Error('Unexpected request');
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/popup/page.js'), 'utf8'), context);
  await new Promise(setImmediate);
  return { get, context, messages, copied, downloads, opened };
}

test('popup exports full Markdown without Obsidian, including subtitles beyond the preview', async () => {
  const h = await exportHarness();
  assert.equal(h.get('import').disabled, true);
  assert.equal(h.get('save-menu-toggle').disabled, false);
  assert.equal(h.get('subtitles').children.length, 12);
  h.get('save-menu-toggle').listeners.click();
  assert.equal(h.get('save-menu').hidden, false);
  assert.equal(h.get('save-menu-toggle').attributes['aria-expanded'], 'true');
  const requests = h.messages.length;
  await h.get('copy-subtitle').listeners.click();
  assert.equal(h.get('save-menu').hidden, true);
  assert.match(h.copied[0], /^---\ntitle:/);
  assert.match(h.copied[0], /subtitle_lang: "English"/);
  assert.match(h.copied[0], /chapter: "1"/);
  assert.match(h.copied[0], /Line 20\./);
  assert.match(h.copied[0], /bilibili\.com\/video\/BV1ps4y1d73V/);
  await h.get('download-subtitle').listeners.click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].saveAs, true);
  assert.match(h.downloads[0].filename, /\[CID-1\]\.md$/);
  assert.equal(/[\\/:]/.test(h.downloads[0].filename), false);
  assert.match(decodeURIComponent(h.downloads[0].url.split(',').slice(1).join(',')), /Line 20\./);
  assert.equal(h.messages.length, requests, 'exports never contact Obsidian or import');
  assert.ok(JSON.parse(fs.readFileSync(require.resolve('../extension/manifest.json'), 'utf8')).permissions.includes('downloads'));
});

test('popup reports copy failures and prevents stale or whole-course exports', async () => {
  const h = await exportHarness();
  h.context.clipboardFail = true;
  await h.get('copy-subtitle').listeners.click();
  assert.match(h.get('status').textContent, /复制失败：Clipboard denied/);
  assert.equal(h.get('copy-subtitle').disabled, false);
  h.get('scope-all').listeners.click();
  assert.equal(h.get('save-menu-toggle').hidden, true);
  await h.get('download-subtitle').listeners.click();
  assert.equal(h.downloads.length, 0);
  h.context.missing = true;
  await h.context.loadVideo();
  assert.equal(h.get('save-menu-toggle').disabled, true);
  await h.get('copy-subtitle').listeners.click();
  assert.equal(h.copied.length, 0);
});

test('Bilibili language selection drives preview, export and import and blocks stale exports on failure', async () => {
  const h = await exportHarness({ languages: true });
  const trigger = h.get('subtitle-language'), menu = h.get('subtitle-language-menu');
  assert.equal(h.get('subtitle-language-switch').hidden, false);
  assert.equal(h.get('subtitle-track').hidden, true);
  assert.equal(h.get('subtitle-language-label').textContent, '中文');
  assert.equal(menu.children.length, 3);
  assert.equal(h.messages.filter(message => message.action === 'preview').length, 1);
  assert.ok(h.messages.every(message => message.action !== 'tracks'));
  let stopped = false;
  trigger.listeners.click({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(menu.open, true);
  assert.equal(trigger.attributes['aria-expanded'], 'true');
  await menu.children.find(option => option.textContent === 'English').listeners.click();
  assert.equal(menu.open, false);
  assert.equal(h.messages.filter(m => m.action === 'preview').at(-1).trackId, 'en');
  assert.equal(h.get('subtitle-track').textContent, 'English');
  assert.equal(h.get('subtitle-language-label').textContent, 'English');
  assert.equal(menu.children.find(option => option.textContent === 'English').attributes['aria-checked'], 'true');
  await h.get('copy-subtitle').listeners.click();
  assert.match(h.copied[0], /subtitle_lang: "English"/);
  await h.get('download-subtitle').listeners.click();
  assert.match(decodeURIComponent(h.downloads[0].url), /subtitle_lang: "English"/);
  await h.get('import').listeners.click();
  assert.equal(h.messages.find(m => m.type === 'quick-import').trackId, 'en');
  h.context.trackFail = true;
  await menu.children.find(option => option.textContent === '中文').listeners.click();
  assert.equal(h.get('copy-subtitle').disabled, true);
  assert.equal(h.get('import').disabled, true);
  assert.match(h.get('subtitles').textContent, /Selected subtitle unavailable/);
});


test('Bilibili refresh replaces stale languages with the current empty preview in one request', async () => {
  const h = await exportHarness({ languages: true });
  assert.equal(h.get('subtitle-language-switch').hidden, false);
  const previous = h.messages.filter(message => message.action === 'preview').length;
  h.context.missing = true;
  await h.context.loadVideo();
  assert.equal(h.messages.filter(message => message.action === 'preview').length, previous + 1);
  assert.ok(h.messages.every(message => message.action !== 'tracks'));
  assert.equal(h.get('subtitle-language-switch').hidden, true);
  assert.equal(h.get('subtitle-language-menu').children.length, 1);
  assert.equal(h.get('subtitles').children.length, 0);
  assert.equal(h.get('copy-subtitle').disabled, true);
  assert.equal(h.get('asr-open').hidden, false);
});


test('Bilibili workspace handoff carries a language preference for current and whole-course views', async () => {
  const h = await exportHarness({ languages: true });
  const menu = h.get('subtitle-language-menu');
  await menu.children.find(option => option.textContent === 'English').listeners.click();
  for (const all of [false, true]) {
    await h.context.openWorkspace(all);
    const params = new URL(h.opened.at(-1).url).searchParams;
    assert.equal(params.get('subtitleLanguage'), 'en');
    assert.equal(params.get('bvid'), 'BV1ps4y1d73V');
    assert.equal(params.has('trackId'), false, 'track IDs belong to one video');
    assert.equal(params.get('scope'), all ? 'all' : null);
  }
  await menu.children.find(option => option.textContent === '自动选择').listeners.click();
  await h.context.openWorkspace();
  assert.equal(new URL(h.opened.at(-1).url).searchParams.has('subtitleLanguage'), false);
  await menu.children.find(option => option.textContent === 'English').listeners.click();
  await h.context.loadVideo();
  await h.context.openWorkspace();
  assert.equal(new URL(h.opened.at(-1).url).searchParams.has('subtitleLanguage'), false, 'a fresh video read resets the explicit preference');
});

test('YouTube caption errors expose an explicit audio fallback and block stale subtitle exports', async () => {
  const h = await exportHarness({ youtube: true });
  h.context.trackFail = true;
  await h.context.loadVideo();
  assert.equal(h.get('preview-label').textContent, '字幕读取失败');
  assert.match(h.get('subtitles').textContent, /Selected subtitle unavailable/);
  assert.equal(h.get('asr-open').hidden, false);
  assert.equal(h.get('asr-open').textContent, '尝试音频转写');
  assert.equal(h.get('copy-subtitle').disabled, true);
  assert.equal(h.messages.some(message => message.action === 'asr-start'), false);
  assert.equal(h.opened.length, 0);
  await h.get('asr-open').listeners.click();
  const params = new URL(h.opened.at(-1).url).searchParams;
  assert.equal(params.get('youtubeId'), 'GWwL_pLuX-U');
  assert.equal(params.get('asr'), '1');
  assert.equal(params.has('subtitleLanguage'), false);
  h.context.trackFail = false;
  await h.context.loadVideo();
  assert.equal(h.get('asr-open').hidden, true);
});

test('Bilibili caption errors do not expose the YouTube-only error fallback', async () => {
  const h = await exportHarness({ languages: true });
  h.context.trackFail = true;
  await h.context.loadVideo();
  assert.equal(h.get('asr-open').hidden, true);
});
