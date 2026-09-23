const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');
const background = fs.readFileSync(require('node:path').join(__dirname, '../extension/course-background.js'), 'utf8');
const meta = { bvid: 'BV1ps4y1d73V', aid: '123', title: '计算机组成原理', author: '讲师' };
const page = { cid: '456', page: 10, part: '2.1.1_进位计数制', duration: 60, chapter: '2', status: 'saved' };
function harness({ existing = null, tracks = true, needLogin = false, biliCode = 0, body = [{ from: 0, to: 3, content: '示例' }], secondExists = false, localStatus } = {}) {
  const calls = [], writes = [];
  let getCount = 0;
  const context = vm.createContext({ CourseCore: core, URL, AbortSignal, console,
    getMergedSettings: async () => ({ obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'test-key' }),
    normalizeConnection: settings => settings,
    buildSubtitleInfoRequests: () => [{ url: 'https://api.bilibili.com/player' }],
    mapSubtitleTracks: list => list,
    normalizeSubtitleTracks: list => list,
    chrome: { runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}`, onMessage: { addListener() {} } } },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if (url.startsWith('http://127.0.0.1')) {
        if (localStatus) return { ok: false, status: localStatus };
        if (options.method === 'PUT') { writes.push({ url, body: options.body }); return { ok: true, status: 200 }; }
        getCount++;
        const value = secondExists && getCount > 1 ? 'new user content' : existing;
        return value === null ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => value };
      }
      if (url.includes('api.bilibili.com')) return { ok: true, status: 200, json: async () => ({ code: biliCode, message: 'test', data: { need_login_subtitle: needLogin, subtitle: { subtitles: tracks ? [{ subtitleUrl: 'https://aisubtitle.hdslb.com/test', lan: 'ai-zh', lanDoc: '中文（自动生成）' }] : [] } } }) };
      return { ok: true, status: 200, json: async () => ({ body }) };
    }
  });
  vm.runInContext(background, context);
  return { calls, writes, run: (action, extra = {}) => context.handleCourseMessage({ action, meta, page, base: 'Clippings/Bilibili', ...extra }) };
}
test('chapter grouping uses chapter prefix, not gaps between lesson numbers', () => {
  for (const [title, expected] of [['课程指南','0'], ['2.2.1_3 ALU','2'], ['5.6_流水线','5'], ['1.2.1+1.2.2_硬件','1']]) assert.equal(core.chapterOf(title), expected);
});
test('source identity survives renamed/reordered parts and grouping changes', () => {
  assert.equal(core.rawPath(meta, page, 'Clippings/Bilibili'), core.rawPath(meta, { ...page, page: 20, part: 'renamed', chapter: '3' }, 'Clippings/Bilibili'));
  assert.notEqual(core.rawPath(meta, page, 'Clippings/Bilibili'), core.rawPath(meta, { ...page, cid: '789' }, 'Clippings/Bilibili'));
});
test('vault-relative directories reject traversal, absolute paths and empty components', () => {
  for (const folder of ['../Clippings', 'C:\\Vault', '/Clippings', 'Clippings//Bilibili', 'Clippings/..']) assert.throws(() => core.normalizeFolder(folder));
  assert.equal(core.normalizeFolder('Clippings\\Bilibili'), 'Clippings/Bilibili');
});
test('raw material keeps exact part and time references', () => {
  const text = core.buildRaw(meta, page, { lan: 'ai-zh' }, [{ from: 65, content: '公式 A' }]);
  assert.match(text, /cid: "456"/); assert.match(text, /p=10&t=65/); assert.match(text, /chapter: "2"/);
});
test('index identifies missing and failed parts, grouping remains editable', () => {
  const text = core.buildIndex(meta, [page, { ...page, cid: '7', page: 11, status: 'missing', chapter: '3' }, { ...page, page: 12, status: 'failed', error: 'HTTP | error' }], 'Clippings/Bilibili');
  assert.match(text, /第02章/); assert.match(text, /第03章/); assert.match(text, /无可用字幕/); assert.match(text, /HTTP \\\| error/);
  assert.match(text, /原始字幕\/CID-456.md/);
});
test('existing note is skipped before any subtitle fetch and never overwritten', async () => {
  const h = harness({ existing: 'user annotations' }); assert.equal((await h.run('import')).status, 'exists');
  assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 1);
});
test('available AI subtitle produces one raw note with proper source', async () => {
  const h = harness(); assert.equal((await h.run('import')).status, 'saved'); assert.equal(h.writes.length, 1); assert.match(h.writes[0].body, /中文（自动生成）/);
});
test('a note created during subtitle fetch is not overwritten', async () => {
  const h = harness({ secondExists: true }); assert.equal((await h.run('import')).status, 'exists'); assert.equal(h.writes.length, 0);
});
test('absent subtitle is reported without creating an empty note', async () => {
  const h = harness({ tracks: false }); assert.equal((await h.run('import')).status, 'missing'); assert.equal(h.writes.length, 0);
});
test('login requirement and rate-limit stop the queue instead of marking no subtitle', async () => {
  for (const options of [{ needLogin: true }, { biliCode: -352 }]) { const h = harness(options); await assert.rejects(h.run('import'), e => e.fatal === true); assert.equal(h.writes.length, 0); }
});
test('empty and mismatched subtitle tracks are errors, not successful imports', async () => {
  for (const body of [[], [{ from: 0, to: 1000, content: 'wrong part' }]]) { const h = harness({ body }); await assert.rejects(h.run('import')); assert.equal(h.writes.length, 0); }
});
test('local API failure stops imports and never fetches further subtitle content', async () => {
  const h = harness({ localStatus: 401 }); await assert.rejects(h.run('import'), e => e.fatal === true); assert.equal(h.calls.length, 1);
});
test('index refuses to overwrite a user-created note', async () => {
  const h = harness({ existing: '# 我的笔记' }); await assert.rejects(h.run('index', { pages: [page] }), e => e.fatal === true); assert.equal(h.writes.length, 0);
});
test('tool-owned index is updated and contains current statuses', async () => {
  const h = harness({ existing: core.marker + '\nold' }); await h.run('index', { pages: [page] }); assert.equal(h.writes.length, 1); assert.match(h.writes[0].body, /已导入/);
});

