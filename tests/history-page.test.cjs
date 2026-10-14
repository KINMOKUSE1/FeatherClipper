const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../extension/shared/course.js');
const history = require('../extension/shared/import-history.js');

function boot(meta, selected = meta.pages[0], failure = null) {
  const record = history.create(meta, selected, 'History/素材', { status: 'saved', path: 'History/素材/字幕.md' }, 1);
  const elements = new Map(), calls = [], messages = [], document = {};
  function element() {
    return { value: '', hidden: false, disabled: false, children: [], handlers: {}, attributes: {}, style: {},
      offsetWidth: 176, offsetHeight: 180, classList: { add() {} },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      matches() { return !!this.open; }, showPopover() { this.open = true; }, hidePopover() { this.open = false; },
      focus() { document.activeElement = this; }, getBoundingClientRect: () => ({ right: 300, bottom: 200 }),
      querySelector: () => get('history-original'),
      querySelectorAll: () => ['history-original', 'history-open', 'history-copy', 'history-remove'].map(get) };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get('history-source').value = 'all'; get('history-sort').value = 'newest';
  Object.assign(document, { getElementById: get, createElement: element });
  const context = vm.createContext({ document, window: { innerWidth: 1280, innerHeight: 720, addEventListener() {} },
    UiText: require('../extension/shared/ui-text.js'), ImportHistory: history,
    chrome: { storage: { local: { get: async () => ({ [record.id]: record }) } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/workbench/history/page.js'), 'utf8'), context);
  const page = context.window.createHistoryPage({ navigate: id => calls.push(['navigate', id]),
    feedback: { settings() {}, status: (...args) => messages.push(args) },
    catalog: { loadCourse: async options => { calls.push(['load', JSON.parse(JSON.stringify(options))]); if (failure) throw failure; } } });
  return { page, get, calls, messages, document, row: () => get('history-list').children[0] };
}

const pages = [1, 2, 3, 4].map(page => ({ cid: String(page), page, part: `课时 ${page}` }));
const bilibili = { bvid: 'BV1234567890', title: '系列课程', pages };

test('series detail enters the full course using its recorded folder, without opening subtitles automatically', async () => {
  const h = boot(bilibili, pages[2]); await h.page.load();
  h.row().children[1].children[0].handlers.click();
  await h.get('history-detail-open').handlers.click();
  assert.deepEqual(h.calls, [['navigate', 'catalog-page'], ['load', {
    source: 'https://www.bilibili.com/video/BV1234567890/?p=1', base: 'History/素材', preview: false
  }]]);
});

test('YouTube series navigation retains the playlist identifier so the full directory can load', async () => {
  const meta = { platform: 'youtube', bvid: 'YTPL_PLdemo123', playlistId: 'PLdemo123', title: '系列',
    pages: [{ cid: 'videoId0001', page: 1, part: 'Lecture 1' }, { cid: 'videoId0002', page: 2, part: 'Lecture 2' }] };
  const h = boot(meta, meta.pages[1]); await h.page.load();
  h.row().children[1].children[0].handlers.click();
  await h.get('history-detail-open').handlers.click();
  assert.equal(h.calls[1][1].source, 'https://www.youtube.com/watch?v=videoId0002&list=PLdemo123');
  assert.equal(h.calls[1][1].base, 'History/素材');
  assert.equal(h.calls[1][1].preview, false);
});

test('single video menu enters its material page and closes the menu', async () => {
  const h = boot({ ...bilibili, title: '单个视频', pages: [pages[0]] }); await h.page.load();
  h.row().children.at(-1).handlers.click();
  assert.equal(h.get('history-open').hidden, false);
  await h.get('history-open').handlers.click();
  assert.equal(h.get('history-menu').open, false);
  assert.deepEqual(h.calls, [['navigate', 'catalog-page'], ['load', {
    source: 'https://www.bilibili.com/video/BV1234567890/?p=1', base: 'History/素材', preview: true
  }]]);
});

test('series menu keyboard navigation skips the single-video-only material entry', async () => {
  const h = boot(bilibili); await h.page.load(); h.row().children.at(-1).handlers.click();
  assert.equal(h.get('history-open').hidden, true);
  h.get('history-menu').handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(h.document.activeElement, h.get('history-copy'));
});

test('a failed course handoff reports the error on the destination page', async () => {
  const h = boot(bilibili, pages[0], new Error('课程读取失败')); await h.page.load();
  h.row().children[1].children[0].handlers.click();
  await h.get('history-detail-open').handlers.click();
  assert.deepEqual(h.messages, [['课程读取失败', true]]);
});
