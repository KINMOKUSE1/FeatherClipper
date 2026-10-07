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
