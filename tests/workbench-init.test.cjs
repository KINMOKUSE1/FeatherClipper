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

function notesHarness() {
  const handlers = {}, calls = [], copied = [], feedback = [];
  const elements = Object.fromEntries(['notes-nav', 'copy-study-prompt', 'folder'].map(id => [id, {
    value: 'Clippings/Bilibili', disabled: false,
    addEventListener: (event, handler) => { handlers[id] = handler; }
  }]));
  const context = vm.createContext({
    meta: { bvid: 'BV1ps4y1d73V', title: '课程' },
    pages: [{ cid: '456', page: 1, part: '课时', selected: true, chapter: '1' }],
    $: id => elements[id],
    window: { NotePreferences: {
      load: async () => calls.push('load-preferences'),
      save: async () => { calls.push('save-preferences'); return {}; }
    } },
    CourseCore: require('../extension/course-core.js'),
    navigator: { clipboard: { writeText: async text => copied.push(text) } },
    showSettingsFeedback: (id, text) => feedback.push(text),
    showWorkbenchPage: id => calls.push(id),
    status: text => feedback.push(text),
    request: async action => {
      calls.push(action);
      if (context.offline) throw new Error('无法连接 Obsidian');
      return { sources: { 456: context.path } };
    },
    send: async message => {
      calls.push(message.type);
      if (context.offline) throw new Error('无法连接 Obsidian');
      return { connected: true };
    },
    offline: true, path: '原始字幕/最新文件.md'
  });
  vm.runInContext(source.slice(source.indexOf('$("notes-nav").addEventListener'), source.indexOf('for (const button of document.querySelectorAll')), context);
  return { context, handlers, calls, copied, feedback, elements };
}

test('notes opens offline but copying fails without changing the clipboard', async () => {
  const h = notesHarness();
  await h.handlers['notes-nav']();
  assert.deepEqual(h.calls, ['load-preferences', 'note-preferences-page']);
  await h.handlers['copy-study-prompt']();
  assert.deepEqual(h.copied, []);
  assert.match(h.feedback.at(-1), /复制失败：无法连接 Obsidian/);
  assert.equal(h.elements['copy-study-prompt'].disabled, false);
});

test('each task copy reads current paths without caching them on course pages', async () => {
  const h = notesHarness();
  h.context.offline = false;
  await h.handlers['copy-study-prompt']();
  assert.ok(h.copied[0].includes('原始字幕/最新文件.md'));
  h.context.path = '原始字幕/改名后的文件.md';
  await h.handlers['copy-study-prompt']();
  assert.ok(h.copied[1].includes('原始字幕/改名后的文件.md'));
  assert.equal(h.calls.filter(call => call === 'raw-paths').length, 2);
  assert.equal('sourcePath' in h.context.pages[0], false);
  h.context.offline = true;
  await h.handlers['copy-study-prompt']();
  assert.equal(h.copied.length, 2);
});

test('task copy without a loaded course also checks the saved connection', async () => {
  const h = notesHarness();
  h.context.meta = null;
  h.context.pages = [];
  await h.handlers['copy-study-prompt']();
  assert.deepEqual(h.calls, ['settings-test']);
  assert.equal(h.copied.length, 0);
  h.context.offline = false;
  await h.handlers['copy-study-prompt']();
  assert.equal(h.copied.length, 1);
});
