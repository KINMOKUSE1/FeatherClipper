const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/shared/course.js');
const collectMaterials = require('../extension/workbench/notes/materials.js');
const source = fs.readFileSync(require.resolve('../extension/workbench/catalog/page.js'), 'utf8');

function boot(search, unavailable = false, missingSubtitle = false, snapshots = {}, previewError = false) {
  const calls = [], elements = new Map();
  function element() {
    return { value: '', hidden: false, open: false, children: [], classList: { toggle() {} },
      setAttribute() {}, addEventListener() {}, focus() {}, close() { this.open = false; },
      replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); return item; } };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let panelOpen = false;
  const window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'), window, URLSearchParams, location: { search }, history: { state: null, replaceState(state, title, url) { context.location.search = url; } }, CourseCore: core,
    document: { getElementById: get, createElement: element, createTextNode: text => text,
      addEventListener() {}, querySelector: () => element(), querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async () => snapshots, set: async () => {} } } }
  });
  vm.runInContext(source, context);
  const catalog = window.createCatalogPage({
    send: async message => {
      calls.push([message.action, message]);
      if (unavailable) throw new Error('No course');
      if (message.action === 'meta') return { folder: 'Clippings/Bilibili', meta: {
        bvid: message.youtubeId ? `YT_${message.youtubeId}` : message.bvid, title: 'Course',
        ...(message.youtubeId ? { platform: 'youtube', videoId: message.youtubeId } : {}),
        pages: message.youtubeId ? [{ cid: message.youtubeId, page: 1, part: 'YouTube lesson' }] : Array.from({ length: 4 }, (_, i) => ({ cid: String(i + 1), page: i + 1, part: `1. Lesson ${i + 1}` }))
      } };
      if (message.action === 'preview') {
        if (previewError) throw new Error('Caption retrieval failed');
        return { body: missingSubtitle ? [] : [{ from: 0, content: 'Actual subtitle' }], missing: missingSubtitle };
      }
      if (message.action === 'import') return { status: 'saved' };
      throw new Error('Unexpected request');
    },
    feedback: { status: (...args) => calls.push(['status', ...args]) },
    previewView: { isOpen: () => panelOpen, open: value => { panelOpen = value; }, close() { panelOpen = false; }, message: (...args) => calls.push(['preview-message', ...args]), transcript() {} },
    importAction: { render() {}, reset() {} },
    connection: { refresh: async () => calls.push(['settings']) },
    transcription: { refresh: async () => ({}), run: async pages => calls.push(['asr', pages[0].cid]) }
  });
  assert.deepEqual(calls, [], 'controller construction does not read settings or a course');
  return { catalog, calls, get, url: get('url') };
}

test('workbench without a source loads settings once and stays empty', async () => {
  const h = boot('');
  await h.catalog.init();
  assert.deepEqual(h.calls, [['settings']]);
  assert.equal(h.catalog.getState().meta, null);
});

test('popup course handoff preserves current P and whole-course selection', async () => {
  const h = boot('?bvid=BV1234567890&p=4&scope=all');
  await h.catalog.init();
  assert.equal(h.url.value, 'https://www.bilibili.com/video/BV1234567890/?p=4');
  assert.equal(h.catalog.getState().pages.filter(page => page.selected).length, 4);
  assert.equal(h.calls.filter(call => call[0] === 'meta').length, 1);
});

test('YouTube handoff preserves video and playlist identifiers', async () => {
  const h = boot('?youtubeId=demoVideo01&playlistId=PLdemo123');
  await h.catalog.init();
  assert.equal(h.url.value, 'https://www.youtube.com/watch?v=demoVideo01&list=PLdemo123');
  const request = h.calls.find(call => call[0] === 'meta')[1];
  assert.equal(request.youtubeId, 'demoVideo01');
  assert.equal(request.playlistId, 'PLdemo123');
});

test('history handoff restores all lessons and their saved states in the recorded destination', async () => {
  const statuses = ['saved', 'exists', 'missing', 'pending'];
  const snapshots = {
    'boc-course-base:BV1234567890': 'Other/Folder',
    'boc-course-v1:BV1234567890:History/Bilibili': { pages: statuses.map((status, index) => ({ cid: String(index + 1), status })) }
  };
  const h = boot('', false, false, snapshots);
  await h.catalog.loadCourse({ source: 'https://www.bilibili.com/video/BV1234567890/?p=1', base: 'History/Bilibili', preview: false });
  const state = h.catalog.getState();
  assert.equal(state.folder, 'History/Bilibili');
  assert.equal(state.pages.length, 4);
  assert.deepEqual(Array.from(state.pages, page => page.status), statuses);
  assert.equal(h.calls.some(call => call[0] === 'preview'), false);
});

test('ASR handoff keeps the loaded preview open and transfers the current missing lesson', async () => {
  const h = boot('?bvid=BV1234567890&p=4&asr=1', false, true);
  await h.catalog.init();
  assert.equal(h.calls.filter(call => call[0] === 'preview').length, 1);
  assert.deepEqual(h.calls.at(-1), ['asr', '4']);
  const unavailable = boot('?bvid=BV1234567890&asr=1', true);
  await unavailable.catalog.init();
  assert.equal(unavailable.calls.some(call => call[0] === 'asr'), false);
});

test('notes opens offline without reading Obsidian', async () => {
  const handlers = {}, calls = [];
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'),
    document: { getElementById: () => ({ addEventListener: (event, handler) => { handlers.notes = handler; } }) },
    load: async () => calls.push('load-preferences'), refreshPreview: () => calls.push('refresh-preferences'), showSettingsFeedback() {},
    navigate: id => calls.push(id), feedback: { status: message => { throw new Error(message); } }
  });
  const notes = fs.readFileSync(require.resolve('../extension/workbench/notes/page.js'), 'utf8');
  vm.runInContext(notes.slice(notes.indexOf('  document.getElementById("notes-nav")'), notes.indexOf('  return { load, save }')), context);
  await handlers.notes();
  assert.deepEqual(calls, ['load-preferences', 'refresh-preferences', 'note-preferences-page']);
});

function materialHarness() {
  const state = { meta: { bvid: 'BV1ps4y1d73V', title: '课程' },
    pages: [{ cid: '456', page: 1, part: '课时', selected: true, chapter: '1' }], folder: 'Clippings/Bilibili' };
  const calls = [], control = { offline: true, path: '原始字幕/最新文件.md' };
  const catalog = { getState: () => state, request: async action => {
    calls.push(action);
    if (control.offline) throw new Error('无法连接 Obsidian');
    return { sources: { 456: control.path } };
  } };
  const delivery = { environment: 'local', task: 'notes', paths: '', reference: '' };
  return { state, calls, control, delivery, collect: current => collectMaterials({ catalog, core, delivery: current || delivery }) };
}

test('local task material lookup fails offline and rereads current paths every time', async () => {
  const h = materialHarness();
  await assert.rejects(h.collect(), /无法连接 Obsidian/);
  h.control.offline = false;
  assert.equal((await h.collect()).materials[0].path, h.control.path);
  h.control.path = '原始字幕/改名后的文件.md';
  assert.equal((await h.collect()).materials[0].path, h.control.path);
  assert.equal(h.calls.filter(action => action === 'raw-paths').length, 3);
  assert.equal('sourcePath' in h.state.pages[0], false);
});

test('manual local files work without a course or Obsidian lookup', async () => {
  const h = materialHarness(); h.state.meta = null; h.state.pages = [];
  const context = await h.collect({ ...h.delivery, paths: 'E:/素材/课程.md' });
  assert.equal(context.materials[0].path, 'E:/素材/课程.md');
  assert.deepEqual(h.calls, []);
});


test('workbench applies inherited language to preview and each import, and clears it for another course', async () => {
  const h = boot('?bvid=BV1234567890&p=2&scope=all&subtitleLanguage=en');
  await h.catalog.init();
  assert.equal(h.calls.find(([action]) => action === 'preview')[1].subtitleLanguage, 'en');
  for (const page of h.catalog.getState().pages) await h.catalog.request('import', { page });
  const imports = h.calls.filter(([action]) => action === 'import');
  assert.equal(imports.length, 4);
  assert.ok(imports.every(([, message]) => message.subtitleLanguage === 'en' && !('trackId' in message)));
  await h.catalog.loadCourse({ source: 'https://www.bilibili.com/video/BVother123/' });
  assert.equal('subtitleLanguage' in h.calls.filter(([action]) => action === 'preview').at(-1)[1], false);
});

test('YouTube preview failure offers audio transcription without claiming subtitles are missing or starting a job', async () => {
  const h = boot('?youtubeId=GWwL_pLuX-U', false, false, {}, true);
  await h.catalog.init();
  assert.equal(h.get('asr-panel').hidden, false);
  assert.equal(h.get('asr-current').textContent, '尝试音频转写');
  assert.equal(h.catalog.getState().activeAsrPage.cid, 'GWwL_pLuX-U');
  assert.equal(h.catalog.getState().pages[0].status, 'failed');
  assert.ok(h.calls.some(([action, text, error]) => action === 'preview-message' && text === 'Caption retrieval failed' && error));
  assert.equal(h.calls.some(([action]) => action === 'asr'), false);
});

test('an explicit YouTube popup transcription handoff survives caption failure', async () => {
  const h = boot('?youtubeId=GWwL_pLuX-U&asr=1', false, false, {}, true);
  await h.catalog.init();
  assert.deepEqual(h.calls.at(-1), ['asr', 'GWwL_pLuX-U']);
  assert.equal(h.calls.filter(([action]) => action === 'preview').length, 1);
  const available = boot('?youtubeId=GWwL_pLuX-U&asr=1');
  await available.catalog.init();
  assert.equal(available.calls.some(([action]) => action === 'asr'), false);
  const bili = boot('?bvid=BV1234567890&asr=1', false, false, {}, true);
  await bili.catalog.init();
  assert.equal(bili.calls.some(([action]) => action === 'asr'), false);
  assert.equal(bili.get('asr-panel').hidden, true);
});


function handoffSearch(source, result) { return source + '&subtitlePreview=' + encodeURIComponent(JSON.stringify(result)); }
test('workbench inherits the popup failure for the exact lesson without requesting captions again', async () => {
  const state = { bvid: 'BV1234567890', cid: '4', status: 'failed', error: '字幕获取超时（8 秒），请重试' };
  const h = boot(handoffSearch('?bvid=BV1234567890&p=4&scope=all', state)); await h.catalog.init();
  assert.equal(h.calls.some(([action]) => action === 'preview'), false);
  assert.equal(h.catalog.getState().pages[3].status, 'failed');
  assert.equal(h.catalog.getState().pages[0].status, 'pending');
  assert.ok(h.calls.some(([action, text]) => action === 'preview-message' && text === state.error));
  await h.catalog.loadCourse();
  assert.equal(h.calls.filter(([action]) => action === 'preview').length, 1, 'manual reread does not reuse the inherited failure');
  assert.equal(h.catalog.getState().pages[3].status, 'pending');
});

test('missing popup subtitles keep the transcription entry, and imported status is preserved', async () => {
  const state = { bvid: 'BV1234567890', cid: '1', status: 'missing' };
  const snapshots = { 'boc-course-v1:BV1234567890:Clippings/Bilibili': { pages: [{ cid: '1', status: 'saved' }] } };
  const h = boot(handoffSearch('?bvid=BV1234567890', state), false, false, snapshots); await h.catalog.init();
  assert.equal(h.calls.some(([action]) => action === 'preview'), false);
  assert.equal(h.catalog.getState().pages[0].status, 'saved');
  assert.equal(h.get('asr-panel').hidden, false);
});

test('YouTube popup ASR handoff reuses the failed preview and proceeds without another subtitle lookup', async () => {
  const state = { bvid: 'YT_GWwL_pLuX-U', cid: 'GWwL_pLuX-U', status: 'failed', error: 'Caption timeout' };
  const h = boot(handoffSearch('?youtubeId=GWwL_pLuX-U&asr=1', state)); await h.catalog.init();
  assert.equal(h.calls.some(([action]) => action === 'preview'), false);
  assert.deepEqual(h.calls.at(-1), ['asr', 'GWwL_pLuX-U']);
});

test('foreign course, foreign lesson and malformed popup handoffs use a fresh preview', async () => {
  for (const state of [{ bvid: 'BVother', cid: '1', status: 'failed' }, { bvid: 'BV1234567890', cid: '4', status: 'missing' }, { status: 'failed' }]) {
    const h = boot(handoffSearch('?bvid=BV1234567890', state)); await h.catalog.init();
    assert.equal(h.calls.filter(([action]) => action === 'preview').length, 1);
  }
  const h = boot('?bvid=BV1234567890&subtitlePreview=invalid'); await h.catalog.init();
  assert.equal(h.calls.filter(([action]) => action === 'preview').length, 1);
});


test('YouTube workbench inherits the selected language for previews and imports and clears it for another video', async () => {
  const h = boot('?youtubeId=GWwL_pLuX-U&subtitleLanguage=en');
  await h.catalog.init();
  assert.equal(h.calls.find(([action]) => action === 'preview')[1].subtitleLanguage, 'en');
  await h.catalog.request('import', { page: h.catalog.getState().pages[0] });
  assert.equal(h.calls.find(([action]) => action === 'import')[1].subtitleLanguage, 'en');
  await h.catalog.loadCourse();
  assert.equal(h.calls.filter(([action]) => action === 'preview').at(-1)[1].subtitleLanguage, 'en');
  await h.catalog.loadCourse({ source: 'https://www.youtube.com/watch?v=abcdef12345' });
  assert.equal('subtitleLanguage' in h.calls.filter(([action]) => action === 'preview').at(-1)[1], false);
});
