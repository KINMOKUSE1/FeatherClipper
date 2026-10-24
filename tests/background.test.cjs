const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const extension = path.join(__dirname, '../extension');
function boot({ authenticated = true, existing = null, beforeSubtitle, missing = false, subtitleLists, onStored, initial = {}, youtubeVideo, youtubePlaylist = '' } = {}) {
  const local = { noteFolder: 'Clippings/Bilibili', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'test-only-key' };
  Object.assign(local, initial);
  const listeners = [], opened = [], writes = [], fetched = [], youtubeCalls = [], requests = [];
  const locks = new Set(), vault = new Map(), tabs = new Map(), session = {};
  let click, context;
  const chrome = {
    runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener: fn => listeners.push(fn) } },
    storage: { local: { get: async () => ({ ...local }), set: async data => { Object.assign(local, data); onStored?.(data); } }, sync: { get: async () => ({}) }, session: { get: async key => ({ [key]: session[key] }), set: async data => Object.assign(session, data) } },
    action: { onClicked: { addListener: fn => click = fn } },
    webRequest: { onBeforeRequest: { addListener() {} } },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    tabs: { create: async data => { opened.push(data); const tab = { id: 2, status: 'complete', url: data.url }; tabs.set(tab.id, tab); return tab; },
      get: async id => tabs.get(id), remove: async id => tabs.delete(id),
      update: async (id, data) => Object.assign(tabs.get(id), data),
      query: async () => [...(youtubeVideo ? [{ id: 1, status: 'complete', active: true, url: `https://www.youtube.com/watch?v=${youtubeVideo}${youtubePlaylist ? `&list=${youtubePlaylist}` : ''}` }] : []), ...tabs.values()] },
    scripting: { executeScript: async ({ args }) => {
      youtubeCalls.push(args);
      return [{ result: { meta: { platform: 'youtube', videoId: youtubeVideo, playlistId: youtubePlaylist || undefined,
        bvid: youtubePlaylist ? `YTPL_${youtubePlaylist}` : `YT_${youtubeVideo}`, title: 'Lecture', author: 'Teacher',
        pages: [{ cid: youtubeVideo, page: 1, part: youtubePlaylist ? 'Lecture 1' : 'Lecture', duration: 90 }, ...(youtubePlaylist ? [{ cid: 'abcdef12345', page: 2, part: 'Lecture 2', duration: 90 }] : [])] },
        ...(args[1] ? { track: { lan: 'en', lanDoc: 'English' }, body: [{ from: 3, to: 5, content: 'First lesson' }] } : {}) } }];
    } }
  };
  context = vm.createContext({ chrome, console, URL, URLSearchParams, AbortSignal, AbortController, TextEncoder, setInterval, clearInterval, setTimeout, clearTimeout,
    navigator: { locks: { request: async (name, options, run) => {
      if (locks.has(name)) return run(null);
      locks.add(name); try { return await run({ name }); } finally { locks.delete(name); }
    } } },
    importScripts: (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, 'background', file), 'utf8'), context)),
    fetch: async (url, options = {}) => {
      fetched.push(url); requests.push({ url, options });
      if (url.startsWith('https://www.youtube.com/watch?')) return { ok: true, text: async () => '{"INNERTUBE_API_KEY":"fixture"}' };
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player')) {
        const id = JSON.parse(options.body).videoId;
        youtubeCalls.push([id, true]);
        return { ok: true, json: async () => ({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id, title: 'Lecture', author: 'Teacher' },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: missing ? [] : [{ languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?v=' + id }] } } }) };
      }
      if (url.startsWith('https://www.youtube.com/api/timedtext')) return { ok: true, text: async () => '<transcript><text start="3" dur="2">First lesson</text></transcript>' };
      if (url === 'http://127.0.0.1:27123/') return { ok: true, json: async () => ({ authenticated }) };
      if (url.startsWith('http://127.0.0.1:27123/vault/')) {
        if (options.method === 'PUT') { writes.push({ url, content: options.body }); vault.set(url, options.body); return { ok: true }; }
        if (/\/(?:原始字幕|Raw Subtitles)\/$/.test(decodeURIComponent(url))) {
          const files = [...vault.keys()].filter(key => key.startsWith(url)).map(key => decodeURIComponent(key.slice(url.length)));
          return files.length ? { ok: true, json: async () => ({ files }) } : { ok: false, status: 404 };
        }
        if (vault.has(url)) return { ok: true, text: async () => vault.get(url) };
        return existing === null ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => existing };
      }
      if (url.includes('/x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { isLogin: true, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } }) };
      if (url.includes('/x/web-interface/view')) return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BVexample', aid: 1, title: 'Course', owner: { name: 'Author' }, pages: [{ cid: 2, page: 1, part: '1.1 Intro', duration: 100 }] } }) };
      if (url.includes('/x/player/') && missing) return { ok: true, json: async () => ({ code: 0, data: { cid: new URL(url).searchParams.get('cid'), aid: new URL(url).searchParams.get('aid'), subtitle: { subtitles: [] } } }) };
      if (url.includes('/x/player/') && subtitleLists) {
        const list = typeof subtitleLists === 'function' ? subtitleLists(new URL(url)) : url.includes('/wbi/') ? subtitleLists.wbi : subtitleLists.v2;
        return { ok: true, json: async () => ({ code: 0, data: { cid: new URL(url).searchParams.get('cid'), aid: new URL(url).searchParams.get('aid'), subtitle: { subtitles: list || [] } } }) };
      }
      if (url.includes('/x/player/')) return { ok: true, json: async () => ({ code: 0, data: { cid: new URL(url).searchParams.get('cid'), aid: new URL(url).searchParams.get('aid'), subtitle: { subtitles: [
        { id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en' },
        { id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }
      ] } } }) };
      const body = await beforeSubtitle?.(url);
      return { ok: true, json: async () => ({ body: body || [{ from: 1, to: 3, content: '实际解析链路' }] }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'background/index.js'), 'utf8'), context);
  function message(payload, sender = { id: 'test', url: chrome.runtime.getURL('workbench/index.html') }) {
    return new Promise((resolve, reject) => {
      let accepted = false;
      for (const listener of listeners) accepted = listener(payload, sender, resolve) || accepted;
      if (!accepted) setImmediate(() => resolve({ ok: false, error: 'not handled' }));
    });
  }
  return { context, local, writes, fetched, youtubeCalls, requests, message, locks, listeners, click: (...args) => click(...args), opened };
}
test('settings read hides stored Key; blank save preserves it', async () => {
  const h = boot();
  const result = await h.message({ type: 'settings-get' });
  assert.equal(result.settings.hasApiKey, true); assert.equal(result.settings.obsidianApiKey, undefined);
  await h.message({ type: 'settings-save', settings: { noteFolder: 'Study/Sources', obsidianApiKey: '' } });
  assert.equal(h.local.obsidianApiKey, 'test-only-key'); assert.equal(h.local.noteFolder, 'Study/Sources');
});
test('Obsidian accepts plain and Bearer-prefixed Keys for connection tests, saves and file writes', async () => {
  for (const input of ['AbC123-demo', ' Bearer AbC123-demo  ', 'bearer AbC123-demo', 'BEARER\tAbC123-demo']) {
    const h = boot();
    const tested = await h.message({ type: 'settings-test', settings: { obsidianApiKey: input } });
    assert.equal(tested.ok, true);
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer AbC123-demo');
    assert.equal(h.local.obsidianApiKey, 'test-only-key', 'testing does not save the draft');
    const saved = await h.message({ type: 'settings-save', settings: { obsidianApiKey: input } });
    assert.equal(saved.ok, true);
    assert.equal(saved.settings.obsidianApiKey, undefined);
    assert.equal(h.local.obsidianApiKey, 'AbC123-demo');
    await h.context.courseLocalRequest('example.md', 'PUT', 'Example');
    assert.equal(h.requests.at(-1).options.headers.Authorization, 'Bearer AbC123-demo');
  }
});

test('already-stored Bearer prefixes are normalized on use and blank saves preserve the Key', async () => {
  const h = boot({ initial: { obsidianApiKey: ' bearer  AbC123-demo  ' } });
  const result = await h.message({ type: 'settings-test', settings: { obsidianApiKey: '' } });
  assert.equal(result.ok, true);
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer AbC123-demo');
  await h.context.courseLocalRequest('example.md', 'PUT', 'Example');
  assert.equal(h.requests.at(-1).options.headers.Authorization, 'Bearer AbC123-demo');
  await h.message({ type: 'settings-save', settings: { obsidianApiKey: '' } });
  assert.equal(h.local.obsidianApiKey, 'AbC123-demo');
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
  const result = await h.message({ type: 'course-request', action: 'index', meta: quickMeta, pages: quickMeta.pages, base: 'Study' });
  assert.equal(result.ok, false); assert.equal(result.fatal, true); assert.equal(h.fetched.length, 0);
});
test('full worker reads metadata and previews preferred Chinese AI subtitles without writing', async () => {
  const h = boot();
  const data = await h.message({ type: 'course-request', action: 'meta', bvid: 'BVexample' });
  assert.equal(data.meta.pages[0].cid, '2');
  const result = await h.message({ type: 'course-request', action: 'preview', meta: data.meta, page: data.meta.pages[0], base: 'Clippings/Bilibili' });
  assert.equal(result.ok, true); assert.equal(result.track.lan, 'ai-zh'); assert.equal(result.body[0].content, '实际解析链路'); assert.equal(h.writes.length, 0);
});
test('automatic preview and import preserve the actual subtitle language', async () => {
  const h = boot();
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(preview.track.lan, 'ai-zh');
  const imported = await h.message(quickMessage, popupSender);
  assert.equal(imported.status, 'saved');
  assert.match(h.writes.find(write => decodeURIComponent(write.url).endsWith('1.1 Intro [CID-2].md')).content, /subtitle_lang: "中文（自动生成）"/);
  const records = Object.entries(h.local).filter(([key]) => key.startsWith('featherclipper:import-history:'));
  assert.equal(records.length, 1);
  assert.equal(records[0][1].language, '中文（自动生成）');
  assert.equal(records[0][1].cid, '2');
  assert.ok(Number.isFinite(records[0][1].importedAt));
});

test('automatic Bilibili retrieval imports the only available language', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 12, lan: 'ja', lan_doc: '日本語', subtitle_url: '//aisubtitle.hdslb.com/ja' }],
    v2: []
  } });
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] }, popupSender);
  assert.equal(preview.track.lan, 'ja');
  const imported = await h.message(quickMessage, popupSender);
  assert.equal(imported.status, 'saved');
  assert.match(h.writes.find(write => decodeURIComponent(write.url).endsWith('1.1 Intro [CID-2].md')).content, /subtitle_lang: "日本語"/);
});

test('Bilibili preview returns languages and body from one signed discovery without exposing URLs', async () => {
  const h = boot();
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] }, popupSender);
  assert.equal(result.ok, true);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].id, '2');
  assert.ok(result.tracks.every(track => !('subtitleUrl' in track)));
  assert.equal(result.track.id, result.tracks[0].id);
  assert.equal(h.fetched.filter(url => url.includes('/x/player/')).length, 1);
  const query = new URL(h.fetched.find(url => url.includes('/x/player/'))).searchParams;
  assert.match(query.get('w_rid'), /^[a-f0-9]{32}$/);
  assert.match(query.get('wts'), /^\d+$/);
  assert.equal(h.writes.length, 0);
});

test('explicit Bilibili selection overrides Chinese priority for preview and quick import', async () => {
  const h = boot({ beforeSubtitle: url => [{ from: 1, to: 3, content: url.endsWith('/en') ? 'Selected English' : '默认中文' }] });
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], trackId: '1' }, popupSender);
  assert.equal(preview.track.lan, 'en');
  assert.equal(preview.body[0].content, 'Selected English');
  assert.equal(h.fetched.some(url => url.endsWith('/zh')), false);
  const imported = await h.message({ ...quickMessage, trackId: '1' }, popupSender);
  assert.equal(imported.status, 'saved');
  const raw = h.writes.find(write => decodeURIComponent(write.url).endsWith('1.1 Intro [CID-2].md')).content;
  assert.match(raw, /subtitle_lang: "English"/);
  assert.match(raw, /Selected English/);
});

test('an unavailable selected Bilibili track cannot silently fall back to another language', async () => {
  const h = boot();
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0], trackId: 'not-present' }, popupSender);
  assert.equal(result.ok, false);
  assert.match(result.error, /所选字幕暂不可用/);
  assert.ok(h.fetched.every(url => url.includes('/x/player/') || url.includes('/x/web-interface/nav')));
});
test('an empty signed list never falls through to unrelated legacy subtitles', async () => {
  const h = boot({ subtitleLists: { wbi: [], v2: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/foreign' }] } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(result.ok, true);
  assert.equal(result.missing, true);
  assert.equal(result.tracks.length, 0);
  assert.ok(h.fetched.some(url => url.includes('/x/player/wbi/v2')));
  assert.ok(!h.fetched.some(url => url.includes('/x/player/v2') || url.endsWith('/foreign')));
});

test('automatic language selection uses only the signed response', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en' }],
    v2: [{ id: 2, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }]
  } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(result.track.lan, 'en');
  assert.ok(!h.fetched.some(url => url.endsWith('/zh')));
});

test('an available Chinese subtitle does not require a language selection', async () => {
  const h = boot({ subtitleLists: { wbi: [{ id: 1, lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/zh' }], v2: [] } });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(result.ok, true);
  assert.equal(result.track.lan, 'ai-zh');
});
test('an empty signed body does not use a body from the legacy endpoint', async () => {
  const h = boot({ subtitleLists: {
    wbi: [{ id: 1, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/empty' }],
    v2: [{ id: 2, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/foreign' }]
  }, beforeSubtitle: () => [] });
  const result = await h.message({ type: 'course-request', action: 'preview', meta: quickMeta, page: quickMeta.pages[0] });
  assert.equal(result.ok, true);
  assert.equal(result.missing, true);
  assert.ok(!h.fetched.some(url => url.includes('/x/player/v2') || url.endsWith('/foreign')));
});

test('removed workflow install action cannot fetch or write documents', async () => {
  const h = boot();
  const result = await h.message({ type: 'course-request', action: 'workflow', meta: quickMeta, base: 'Study' });
  assert.equal(result.ok, false);
  assert.equal(h.fetched.length, 0);
  assert.equal(h.writes.length, 0);
});
test('extension messages from an unrelated page are rejected', async () => {
  const h = boot(); const sender = { id: 'test', url: 'chrome-extension://test/workbench/index.html-other' };
  assert.equal((await h.message({ type: 'settings-get' }, sender)).ok, false);
  assert.equal((await h.message({ type: 'course-request', action: 'meta', bvid: 'BVexample' }, sender)).ok, false);
  assert.equal(h.fetched.length, 0);
});
test('manifest opens the popup and grants YouTube page reading', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting', 'webRequest', 'downloads', 'offscreen', 'declarativeNetRequestWithHostAccess']);
  assert.equal(manifest.action.default_popup, 'popup/index.html'); assert.equal(manifest.side_panel, undefined); assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.host_permissions.includes('https://www.youtube.com/*')); assert.ok(!manifest.host_permissions.includes('https://*/*')); assert.equal(manifest.options_page, 'workbench/index.html');
});

const popupSender = { id: 'test', url: 'chrome-extension://test/popup/index.html' };
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
  const records = Object.entries(h.local).filter(([key]) => key.startsWith('featherclipper:import-history:'));
  assert.equal(records.length, 1);
  assert.equal(records[0][1].language, '中文（自动生成）');
});

test('English quick imports survive a UI change and remain deduplicated after returning to Chinese', async () => {
  const h = boot({ initial: { 'featherclipper:ui-locale': 'en' }, beforeSubtitle: async () => {
    h.local['featherclipper:ui-locale'] = 'zh-CN';
  } });
  const result = await h.message({ ...quickMessage, locale: 'en' }, popupSender);
  assert.equal(result.status, 'saved');
  const raw = h.writes.find(write => decodeURIComponent(write.url).includes('/Raw Subtitles/'));
  assert.ok(raw);
  assert.match(raw.content, /## Subtitles/);
  assert.match(raw.content, /实际解析链路/);
  assert.ok(h.writes.some(write => decodeURIComponent(write.url).endsWith('/Course Import Index.md')));
  const repeated = await h.message({ ...quickMessage, locale: 'zh-CN' }, popupSender);
  assert.equal(repeated.status, 'exists');
  assert.equal(h.writes.filter(write => decodeURIComponent(write.url).endsWith('[CID-2].md')).length, 1);
  assert.match(h.writes.at(-1).content, /\[字幕\]\(<Raw Subtitles\//);
});

test('workbench imports and completed local transcription both persist history', async () => {
  const h = boot();
  const saved = await h.message({ type: 'course-request', action: 'import', meta: quickMeta, page: quickMeta.pages[0], base: 'Clippings/Bilibili' });
  assert.equal(saved.status, 'saved');
  assert.equal(Object.entries(h.local).filter(([key]) => key.startsWith('featherclipper:import-history:')).length, 1);
  const asr = boot();
  asr.context.asrPoll = async () => ({ status: 'done', bvid: quickMeta.bvid, cid: quickMeta.pages[0].cid, language: 'zh', body: [{ from: 0, content: '转写结果' }] });
  const completed = await asr.message({ type: 'course-request', action: 'asr-finish', meta: quickMeta, page: quickMeta.pages[0], base: 'Clippings/Bilibili', jobId: 'test-job' });
  assert.equal(completed.status, 'saved');
  const record = Object.entries(asr.local).find(([key]) => key.startsWith('featherclipper:import-history:'))[1];
  assert.match(record.language, /本地转写/);
  assert.equal(record.sourcePath, completed.path);
});

test('missing subtitles and rejected imports do not write history', async () => {
  for (const options of [{ missing: true }, { initial: { obsidianApiKey: '' } }]) {
    const h = boot(options);
    const result = await h.message(quickMessage, popupSender);
    assert.ok(['missing', 'failed'].includes(result.status));
    assert.equal(Object.keys(h.local).some(key => key.startsWith('featherclipper:import-history:')), false);
  }
});

test('YouTube video previews and imports through the same Obsidian workflow', async () => {
  const id = 'GWwL_pLuX-U';
  const h = boot({ youtubeVideo: id });
  const data = await h.message({ type: 'course-request', action: 'meta', youtubeId: id }, popupSender);
  assert.equal(data.meta.platform, 'youtube');
  assert.equal(data.folder, 'Clippings/YouTube');
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: data.meta, page: data.meta.pages[0] }, popupSender);
  assert.equal(preview.body[0].content, 'First lesson');
  const message = { type: 'quick-import', meta: data.meta, bvid: data.meta.bvid, cid: id, base: data.folder };
  const result = await h.message(message, popupSender);
  assert.equal(result.status, 'saved');
  assert.equal(h.youtubeCalls.length, 2, 'import reuses the immediately preceding preview');
  assert.ok(h.writes.some(write => decodeURIComponent(write.url).endsWith(`Lecture [YT-${id}].md`) && write.content.includes('platform: youtube')));
  const record = Object.entries(h.local).find(([key]) => key.startsWith('featherclipper:import-history:'))[1];
  assert.equal(record.thumbnail, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(record.language, 'English');
});
test('YouTube playlist imports the selected lecture using its own video ID', async () => {
  const id = 'GWwL_pLuX-U', playlistId = 'PLKq1TCpsv3Y4';
  const h = boot({ youtubeVideo: id, youtubePlaylist: playlistId });
  const data = await h.message({ type: 'course-request', action: 'meta', youtubeId: id, playlistId }, popupSender);
  assert.equal(data.meta.pages.length, 2);
  assert.equal(data.meta.bvid, `YTPL_${playlistId}`);
  const selected = data.meta.pages[1];
  const preview = await h.message({ type: 'course-request', action: 'preview', meta: data.meta, page: selected }, popupSender);
  assert.equal(preview.body[0].content, 'First lesson');
  const result = await h.message({ type: 'quick-import', meta: data.meta, bvid: data.meta.bvid, cid: selected.cid, base: data.folder }, popupSender);
  assert.equal(result.status, 'saved');
  assert.ok(h.youtubeCalls.some(args => args[0] === selected.cid && args[1] === true));
  assert.ok(h.writes.some(write => decodeURIComponent(write.url).endsWith(`Lecture 2 [YT-${selected.cid}].md`)));
});
test('metadata accepts a pasted YouTube watch-and-list URL from an older page', async () => {
  const id = 'GWwL_pLuX-U', playlistId = 'PLKq1TCpsv3Y4';
  const h = boot({ youtubeVideo: id, youtubePlaylist: playlistId });
  const result = await h.message({ type: 'course-request', action: 'meta', bvid: `https://www.youtube.com/watch?v=${id}&list=${playlistId}` });
  assert.equal(result.ok, true);
  assert.equal(result.meta.pages.length, 2);
});

test('workbench imports the selected YouTube video in the background without opening a tab', async () => {
  const h = boot({ youtubeVideo: 'GWwL_pLuX-U', youtubePlaylist: 'PLKq1TCpsv3Y4' });
  const data = await h.message({ type: 'course-request', action: 'meta', youtubeId: 'GWwL_pLuX-U', playlistId: 'PLKq1TCpsv3Y4' });
  const selected = data.meta.pages[1];
  const result = await h.message({ type: 'course-request', action: 'import', meta: data.meta, page: selected, base: data.folder });
  assert.equal(result.status, 'saved');
  assert.equal(h.opened.length, 0);
  assert.ok(h.youtubeCalls.some(args => args[0] === selected.cid && args[1] === true));
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


test('workbench inherited language selects separate English tracks for preview and saved materials', async () => {
  const h = boot({ subtitleLists: url => {
    const cid = url.searchParams.get('cid');
    return [{ id: `zh-${cid}`, lan: 'ai-zh', lan_doc: '中文', subtitle_url: `//aisubtitle.hdslb.com/zh-${cid}` },
      { id: `en-${cid}`, lan: 'ai-en', lan_doc: 'English', subtitle_url: `//aisubtitle.hdslb.com/en-${cid}` }];
  }, beforeSubtitle: url => [{ from: 1, to: 3, content: `Text ${url.split('/').pop()}` }] });
  const meta = { ...quickMeta, pages: [quickMeta.pages[0], { cid: '3', page: 2, part: 'Second lesson', duration: 100 }] };
  for (const page of meta.pages) {
    const request = { type: 'course-request', meta, page, base: 'Study', subtitleLanguage: 'en' };
    const preview = await h.message({ ...request, action: 'preview' });
    assert.equal(preview.track.id, `en-${page.cid}`);
    assert.equal(preview.body[0].content, `Text en-${page.cid}`);
    const imported = await h.message({ ...request, action: 'import' });
    assert.equal(imported.status, 'saved');
    const raw = h.writes.find(item => decodeURIComponent(item.url).endsWith(`[CID-${page.cid}].md`)).content;
    assert.match(raw, /subtitle_lang: "English"/);
    assert.ok(raw.includes(`Text en-${page.cid}`));
  }
  assert.ok(!h.fetched.some(url => /\/zh-\d+$/.test(url)));
});

test('explicit YouTube transcription reads audio directly and imports the resulting material despite caption failure', async () => {
  const id = 'GWwL_pLuX-U', h = boot({ youtubeVideo: id });
  const meta = { platform: 'youtube', videoId: id, bvid: `YT_${id}`, title: 'Audio lesson', pages: [{ cid: id, page: 1, part: 'Audio lesson' }] };
  h.local.asrToken = 'fixture-token';
  const reads = [], requests = [];
  h.context.youtubeRead = async (...args) => {
    reads.push(args);
    if (args[1]) throw new Error('Caption retrieval failed');
    return { audioUrls: ['https://rr1.googlevideo.com/fixture-audio'] };
  };
  h.context.asrRequest = async (...args) => { requests.push(args); return { id: 'a'.repeat(32), status: 'queued' }; };
  const request = { type: 'course-request', meta, page: meta.pages[0], base: 'Study', provider: 'local' };
  assert.equal((await h.message({ ...request, action: 'preview' })).ok, false);
  const started = await h.message({ ...request, action: 'asr-start' });
  assert.equal(started.status, 'queued');
  assert.equal(reads.length, 2);
  assert.deepEqual(reads[1], [id, false, true]);
  assert.equal(requests[0][0], '/jobs');
  assert.equal(requests[0][2].audio_urls[0], 'https://rr1.googlevideo.com/fixture-audio');
  h.context.asrPoll = async () => ({ status: 'done', bvid: meta.bvid, cid: id, language: 'en', body: [{ from: 0, to: 2, content: 'Audio transcript fixture' }] });
  const completed = await h.message({ ...request, action: 'asr-finish', jobId: started.id });
  assert.equal(completed.status, 'saved');
  assert.match(h.writes.at(-1).content, /Audio transcript fixture/);
  assert.match(h.writes.at(-1).content, /subtitle_source: "local-asr"/);
});


test('YouTube preview lists real tracks and quick import saves the requested track instead of the preview language', async () => {
  const id = 'GWwL_pLuX-U', h = boot({ youtubeVideo: id });
  const originalFetch = h.context.fetch;
  h.context.fetch = async (url, options = {}) => {
    if (url.includes('/youtubei/v1/player')) return { ok: true, json: async () => ({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id, title: 'Lecture', author: 'Teacher' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { vssId: '.zh', languageCode: 'zh', name: { simpleText: '中文' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh' },
        { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
      ] } } }) };
    if (url.includes('/api/timedtext')) return { ok: true, text: async () => `<transcript><text start="0" dur="2">${new URL(url).searchParams.get('lang') === 'en' ? 'English material' : '中文素材'}</text></transcript>` };
    return originalFetch(url, options);
  };
  const meta = { platform: 'youtube', videoId: id, bvid: `YT_${id}`, title: 'Lecture', pages: [{ cid: id, page: 1, part: 'Lecture' }] };
  const preview = await h.message({ type: 'course-request', action: 'preview', meta, page: meta.pages[0], trackId: '.zh' }, popupSender);
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.tracks.map(t => t.id), ['.zh', '.en']);
  assert.ok(preview.tracks.every(t => !('baseUrl' in t)));
  const result = await h.message({ type: 'quick-import', meta, bvid: meta.bvid, cid: id, base: 'Study', trackId: '.en' }, popupSender);
  assert.equal(result.status, 'saved');
  const material = h.writes.find(w => decodeURIComponent(w.url).includes('/原始字幕/'));
  assert.match(material.content, /English material/);
  assert.doesNotMatch(material.content, /中文素材/);
});
