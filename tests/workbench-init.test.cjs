const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../extension/course.js'), 'utf8');
const initialization = source.slice(source.indexOf('async function init()'));

function boot(search, missing = false) {
  const url = { value: '' };
  const calls = [];
  const context = vm.createContext({
    URLSearchParams, location: { search },
    currentPage: Number(new URLSearchParams(search).get('p')) || 1,
    meta: null, pages: [], previewId: '', activeAsrPage: null,
    $: id => { assert.equal(id, 'url'); return url; },
    syncControls: () => calls.push('controls'),
    refreshSettings: async () => calls.push('settings'),
    render: () => calls.push('render'),
    preview: async page => calls.push(['preview', page.cid]),
    runAsrQueue: async pages => calls.push(['asr', pages[0].cid]),
    loadCourse: async () => {
      calls.push(['load', url.value]);
      if (missing) return;
      context.meta = { title: 'Course' };
      context.pages = Array.from({ length: 4 }, (_, index) => ({
        cid: String(index + 1), page: index + 1,
        selected: index + 1 === context.currentPage
      }));
      // The workbench read flow has already previewed the current lesson.
      context.previewId = String(context.currentPage);
      context.activeAsrPage = context.pages[context.currentPage - 1];
    }
  });
  vm.runInContext(initialization, context);
  assert.deepEqual(calls, [], 'initialization waits for workbench controllers');
  return { context, calls, url };
}

test('workbench without a source loads settings once and stays empty', async () => {
  const h = boot('');
  await h.context.init();
  assert.deepEqual(h.calls, ['controls', 'settings']);
  assert.equal(h.context.meta, null);
});

test('popup course handoff preserves current P and whole-course selection', async () => {
  const h = boot('?bvid=BV1234567890&p=4&scope=all');
  await h.context.init();
  assert.equal(h.url.value, 'https://www.bilibili.com/video/BV1234567890/?p=4');
  assert.equal(h.context.pages.filter(page => page.selected).length, 4);
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'load').length, 1);
});

test('YouTube handoff preserves video and playlist identifiers', async () => {
  const h = boot('?youtubeId=demoVideo01&playlistId=PLdemo');
  await h.context.init();
  assert.equal(h.url.value, 'https://www.youtube.com/watch?v=demoVideo01&list=PLdemo');
});

test('ASR handoff uses the loaded preview without toggling it closed', async () => {
  const h = boot('?bvid=BV1234567890&p=4&asr=1');
  await h.context.init();
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'preview').length, 0);
  assert.deepEqual(h.calls.at(-1), ['asr', '4']);
  const unavailable = boot('?bvid=BV1234567890&asr=1', true);
  await unavailable.context.init();
  assert.equal(unavailable.calls.some(call => Array.isArray(call) && call[0] === 'asr'), false);
});

test('notes opens offline without reading Obsidian', async () => {
  const handlers = {}, calls = [];
  const context = vm.createContext({
    $: () => ({ addEventListener: (event, handler) => { handlers.notes = handler; } }),
    window: { NotePreferences: { load: async () => calls.push('load-preferences') } },
    showSettingsFeedback() {}, showWorkbenchPage: id => calls.push(id),
    status: message => { throw new Error(message); }
  });
  vm.runInContext(source.slice(source.indexOf('$("notes-nav").addEventListener'), source.indexOf('for (const button of document.querySelectorAll')), context);
  await handlers.notes();
  assert.deepEqual(calls, ['load-preferences', 'note-preferences-page']);
});

function materialHarness() {
  const calls = [], context = vm.createContext({
    meta: { bvid: 'BV1ps4y1d73V', title: '课程' },
    pages: [{ cid: '456', page: 1, part: '课时', selected: true, chapter: '1' }],
    CourseCore: require('../extension/course-core.js'),
    uploadedReferences: [], uploadedMaterials: [],
    get: () => ({ value: 'Clippings/Bilibili' }),
    request: async action => {
      calls.push(action);
      if (context.offline) throw new Error('无法连接 Obsidian');
      return { sources: { 456: context.path } };
    },
    offline: true, path: '原始字幕/最新文件.md'
  });
  const builder = fs.readFileSync(require.resolve('../extension/skill-builder.js'), 'utf8');
  vm.runInContext(builder.slice(builder.indexOf('  async function collectContext('), builder.indexOf('  async function prepareTask(')), context);
  return { context, calls, delivery: { environment: 'local', task: 'notes', paths: '', reference: '' } };
}

test('local task material lookup fails offline and rereads current paths every time', async () => {
  const h = materialHarness();
  await assert.rejects(h.context.collectContext(h.delivery), /无法连接 Obsidian/);
  h.context.offline = false;
  assert.equal((await h.context.collectContext(h.delivery)).materials[0].path, h.context.path);
  h.context.path = '原始字幕/改名后的文件.md';
  assert.equal((await h.context.collectContext(h.delivery)).materials[0].path, h.context.path);
  assert.equal(h.calls.filter(action => action === 'raw-paths').length, 3);
  assert.equal('sourcePath' in h.context.pages[0], false);
});

test('manual local files work without a course or Obsidian lookup', async () => {
  const h = materialHarness(); h.context.meta = null; h.context.pages = [];
  const context = await h.context.collectContext({ ...h.delivery, paths: 'E:/素材/课程.md' });
  assert.equal(context.materials[0].path, 'E:/素材/课程.md');
  assert.deepEqual(h.calls, []);
});
