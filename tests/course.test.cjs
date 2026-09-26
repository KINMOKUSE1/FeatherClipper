const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');
const background = fs.readFileSync(require('node:path').join(__dirname, '../extension/course-background.js'), 'utf8');
const meta = { bvid: 'BV1ps4y1d73V', aid: '123', title: '计算机组成原理', author: '讲师', pages: [{ cid: '456' }] };
const page = { cid: '456', page: 10, part: '2.1.1_进位计数制', duration: 60, chapter: '2', status: 'saved' };
function harness({ existing = null, rawFiles = [], tracks = true, needLogin = false, biliCode = 0, body = [{ from: 0, to: 3, content: '示例' }], secondExists = false, localStatus, asrJob } = {}) {
  const calls = [], writes = [];
  let getCount = 0;
  const context = vm.createContext({ CourseCore: core, URL, AbortSignal, console,
    getMergedSettings: async () => ({ obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'test-key' }),
    normalizeConnection: settings => settings,
    asrStart: async () => ({ id: 'a'.repeat(32), status: 'queued' }),
    asrPoll: async () => asrJob || ({ bvid: meta.bvid, cid: page.cid, status: 'done', language: 'zh', body: [{ from: 2, to: 4, content: '本地识别文本' }] }),
    asrCancel: async () => ({ status: 'stopping' }),
    buildSubtitleInfoRequests: () => [{ url: 'https://api.bilibili.com/player' }],
    mapSubtitleTracks: list => list,
    normalizeSubtitleTracks: list => list,
    chrome: { runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}`, onMessage: { addListener() {} } } },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if (url.startsWith('http://127.0.0.1')) {
        if (localStatus) return { ok: false, status: localStatus };
        if (options.method === 'PUT') { writes.push({ url, body: options.body }); return { ok: true, status: 200 }; }
        if (decodeURIComponent(url).endsWith('/原始字幕/')) {
          getCount++;
          const files = [...rawFiles, ...writes.filter(write => decodeURIComponent(write.url).includes('/原始字幕/')).map(write => decodeURIComponent(write.url).split('/').pop())];
          if (existing !== null || (secondExists && getCount > 1)) files.push('CID-456.md');
          return files.length ? { ok: true, status: 200, json: async () => ({ files }) } : { ok: false, status: 404 };
        }
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
test('chapter grouping keeps two numeric levels and recognizes lecture and Chinese numbering', () => {
  for (const [title, expected] of [
    ['课程指南', '0'], ['2.2.4_4 无符号整数的除法运算原理', '2.2'], ['2.3.1_1 浮点数的表示', '2.3'],
    ['5.6_流水线', '5.6'], ['1.2.1+1.2.2_硬件', '1.2'], ['２．１０．１_例题', '2.10'], ['2. 绪论', '2'],
    ['p76 CS 285: Lecture 18, Variational Inference, Part 4', '18'],
    ['p77 CS 285: Lecture 19, Control as Inference, Part 1', '19'],
    ['p80 CS 285: Lecture 19, Control as Inference, Part 4', '19'], ['lec2 Frequent items', '2'],
    ['第二章第三节 浮点数', '2.3'], ['第2章 第10节 例题', '2.10'], ['第十八讲', '18'], ['第二十章', '20'],
    ['第一百零二课', '102'], ['第一节 绪论', '1'], ['CS 285 Introduction', '0'], ['p77 Intro', '0'], ['2024.09 课程介绍', '0']
  ]) assert.equal(core.chapterOf(title), expected, title);
});

test('section identifiers stay strings and sort as hierarchy rather than decimal fractions', () => {
  assert.equal(core.normalizeChapter('02.010'), '2.10');
  for (const input of ['2.3.4', '-2', '2e3', '1000', '2.', 'abc']) assert.equal(core.normalizeChapter(input), null);
  assert.deepEqual(['2.10', '3', '2.3', '2', '2.2'].sort(core.compareChapters), ['2', '2.2', '2.3', '2.10', '3']);
  assert.equal(core.chapterLabel('2.10'), '第2.10节');
  const parts = ['2.10', '2.3', '2.2'].map((chapter, index) => ({ ...page, chapter, page: index + 1 }));
  const index = core.buildIndex(meta, parts, 'Clippings/Bilibili');
  assert.ok(index.indexOf('## 第2.2节') < index.indexOf('## 第2.3节'));
  assert.ok(index.indexOf('## 第2.3节') < index.indexOf('## 第2.10节'));
  const prompt = core.buildStudyPrompt(meta, [{ ...page, chapter: '2.10', selected: true }], 'Clippings/Bilibili');
  assert.match(prompt, /章节分组：第2\.10节/);
});
test('readable filenames remain unique for matching part titles', () => {
  assert.notEqual(core.rawPath(meta, page, 'Clippings/Bilibili'), core.rawPath(meta, { ...page, page: 20, part: 'renamed', chapter: '3' }, 'Clippings/Bilibili'));
  assert.notEqual(core.rawPath(meta, page, 'Clippings/Bilibili'), core.rawPath(meta, { ...page, cid: '789' }, 'Clippings/Bilibili'));
  assert.match(core.rawPath(meta, page, 'Clippings/Bilibili'), /原始字幕\/2\.1\.1_进位计数制 \[CID-456\]\.md$/);
});
test('vault-relative directories reject traversal, absolute paths and empty components', () => {
  for (const folder of ['../Clippings', 'C:\\Vault', '/Clippings', 'Clippings//Bilibili', 'Clippings/..']) assert.throws(() => core.normalizeFolder(folder));
  assert.equal(core.normalizeFolder('Clippings\\Bilibili'), 'Clippings/Bilibili');
});
test('raw material keeps exact part and time references', () => {
  const text = core.buildRaw(meta, page, { lan: 'ai-zh' }, [{ from: 65, content: '公式 A' }]);
  assert.match(text, /cid: "456"/); assert.match(text, /p=10&t=65/); assert.match(text, /chapter: "2"/);
  assert.match(text, /^title: "2\.1\.1_进位计数制"$/m);
  assert.match(text, /^# 2\.1\.1_进位计数制$/m);
});
test('index identifies missing and failed parts, grouping remains editable', () => {
  const text = core.buildIndex(meta, [page, { ...page, cid: '7', page: 11, status: 'missing', chapter: '3' }, { ...page, page: 12, status: 'failed', error: 'HTTP | error' }], 'Clippings/Bilibili');
  assert.match(text, /第02章/); assert.match(text, /第03章/); assert.match(text, /无可用字幕/); assert.match(text, /HTTP \\\| error/);
  assert.match(text, /原始字幕\/2\.1\.1_进位计数制 \[CID-456\]\.md/);
});
test('existing note is skipped before any subtitle fetch and never overwritten', async () => {
  const h = harness({ existing: 'user annotations' }); assert.equal((await h.run('import')).status, 'exists');
  assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 1);
});
test('renamed part reuses the existing CID file without creating a duplicate', async () => {
  const h = harness({ rawFiles: ['以前的标题 [CID-456].md'] });
  const result = await h.run('import');
  assert.equal(result.status, 'exists');
  assert.match(result.path, /以前的标题 \[CID-456\]\.md$/);
  assert.equal(h.writes.length, 0);
});
test('index and study paths point to the existing filename after a part rename', async () => {
  const h = harness({ existing: core.marker + '\nold', rawFiles: ['以前的标题 [CID-456].md'] });
  const index = await h.run('index', { pages: [page] });
  assert.match(index.sources['456'], /以前的标题 \[CID-456\]\.md$/);
  assert.match(h.writes[0].body, /\[字幕\]\(<原始字幕\/以前的标题 \[CID-456\]\.md>\)/);
  const paths = await h.run('raw-paths', { pages: [page] });
  assert.equal(paths.sources['456'], index.sources['456']);
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
test('local ASR is offered only when Bilibili has no subtitle and saves provenance', async () => {
  const withSubtitle = harness();
  assert.equal((await withSubtitle.run('asr-start')).status, 'subtitle-available');
  const missing = harness({ tracks: false });
  assert.equal((await missing.run('asr-start')).status, 'queued');
  assert.equal((await missing.run('asr-finish', { jobId: 'a'.repeat(32) })).status, 'saved');
  assert.match(missing.writes[0].body, /subtitle_source: "local-asr"/);
  assert.match(missing.writes[0].body, /本地识别文本/);
});
test('empty local ASR result does not create a note', async () => {
  const h = harness({ tracks: false, asrJob: { bvid: meta.bvid, cid: page.cid, status: 'done', body: [] } });
  await assert.rejects(h.run('asr-finish', { jobId: 'a'.repeat(32) }));
  assert.equal(h.writes.length, 0);
});
test('login requirement and rate-limit stop the queue instead of marking no subtitle', async () => {
  for (const options of [{ needLogin: true }, { biliCode: -352 }]) { const h = harness(options); await assert.rejects(h.run('import'), e => e.fatal === true); assert.equal(h.writes.length, 0); }
});
test('empty subtitle tracks allow local ASR, while mismatched tracks remain errors', async () => {
  const empty = harness({ body: [] });
  assert.equal((await empty.run('preview')).missing, true);
  assert.equal((await empty.run('import')).status, 'missing');
  assert.equal((await empty.run('asr-start')).status, 'queued');
  assert.equal(empty.writes.length, 0);
  const mismatch = harness({ body: [{ from: 0, to: 1000, content: 'wrong part' }] });
  await assert.rejects(mismatch.run('import'));
  assert.equal(mismatch.writes.length, 0);
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

