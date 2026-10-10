const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/shared/course.js');
const collectMaterials = require('../extension/workbench/notes/materials.js');
const source = fs.readFileSync(require.resolve('../extension/workbench/catalog/page.js'), 'utf8');

function boot(search, unavailable = false, missingSubtitle = false) {
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
  const context = vm.createContext({ UiText: require('../extension/shared/ui-text.js'), window, URLSearchParams, location: { search }, CourseCore: core,
    document: { getElementById: get, createElement: element, createTextNode: text => text,
      addEventListener() {}, querySelector: () => element(), querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } }
  });
  vm.runInContext(source, context);
  const catalog = window.createCatalogPage({
    send: async message => {
      calls.push([message.action, message]);
      if (unavailable) throw new Error('No course');
      if (message.action === 'meta') return { folder: 'Clippings/Bilibili', meta: {
        bvid: 'BV1234567890', title: 'Course',
        pages: Array.from({ length: 4 }, (_, i) => ({ cid: String(i + 1), page: i + 1, part: `1. Lesson ${i + 1}` }))
      } };
      if (message.action === 'preview') return { body: missingSubtitle ? [] : [{ from: 0, content: 'Actual subtitle' }], missing: missingSubtitle };
      throw new Error('Unexpected request');
    },
    feedback: { status: (...args) => calls.push(['status', ...args]) },
    previewView: { isOpen: () => panelOpen, open: value => { panelOpen = value; }, close() { panelOpen = false; }, message() {} },
    importAction: { render() {}, reset() {} },
    connection: { refresh: async () => calls.push(['settings']) },
    transcription: { refresh: async () => ({}), run: async pages => calls.push(['asr', pages[0].cid]) }
  });
  assert.deepEqual(calls, [], 'controller construction does not read settings or a course');
  return { catalog, calls, url: get('url') };
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
    load: async () => calls.push('load-preferences'), showSettingsFeedback() {},
    navigate: id => calls.push(id), feedback: { status: message => { throw new Error(message); } }
  });
  const notes = fs.readFileSync(require.resolve('../extension/workbench/notes/page.js'), 'utf8');
  vm.runInContext(notes.slice(notes.indexOf('  document.getElementById("notes-nav")'), notes.indexOf('  return { load, save }')), context);
  await handlers.notes();
  assert.deepEqual(calls, ['load-preferences', 'note-preferences-page']);
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
