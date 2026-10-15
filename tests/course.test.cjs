const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/shared/course.js');
const background = ['wbi.js', 'bilibili.js', 'obsidian.js', 'history.js', 'courses.js'].map(file => fs.readFileSync(require('node:path').join(__dirname, '../extension/background', file), 'utf8')).join('\n');
const meta = { bvid: 'BV1ps4y1d73V', aid: '123', title: '计算机组成原理', author: '讲师', pages: [{ cid: '456' }] };
const page = { cid: '456', page: 10, part: '2.1.1_进位计数制', duration: 60, chapter: '2', status: 'saved' };
function harness({ existing = null, rawFiles = [], tracks = true, needLogin = false, biliCode = 0, body = [{ from: 0, to: 3, content: '示例' }], secondExists = false, localStatus, asrJob } = {}) {
  const calls = [], writes = [], stored = {};
  let getCount = 0;
  const context = vm.createContext({ CourseCore: core, URL, URLSearchParams, AbortSignal, TextEncoder, console,
    getMergedSettings: async () => ({ obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'test-key' }),
    normalizeConnection: settings => settings,
    asrStart: async () => ({ id: 'a'.repeat(32), status: 'queued' }),
    asrPoll: async () => asrJob || ({ bvid: meta.bvid, cid: page.cid, status: 'done', language: 'zh', body: [{ from: 2, to: 4, content: '本地识别文本' }] }),
    asrCancel: async () => ({ status: 'stopping' }),
    chrome: { runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}`, onMessage: { addListener() {} } },
      storage: { local: { get: async key => ({ [key]: stored[key] }), set: async data => Object.assign(stored, data) } } },
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
      if (url.includes('/x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { isLogin: true, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } }) };
      if (url.includes('api.bilibili.com')) return { ok: true, status: 200, json: async () => ({ code: biliCode, message: 'test', data: { cid: 456, aid: 123, need_login_subtitle: needLogin, subtitle: { subtitles: tracks ? [{ id: 1, subtitle_url: 'https://aisubtitle.hdslb.com/test', lan: 'ai-zh', lan_doc: '中文（自动生成）' }] : [] } } }) };
      return { ok: true, status: 200, json: async () => ({ body }) };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/shared/import-history.js'), 'utf8'), context);
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

test('CS61C recordings group by lecture instead of each dotted segment', () => {
  const lecturePages = [
    '[CS61C FA20] Lecture 02.1 - Number Representation: Intro, Bits can be anything',
    '[CS61C FA20] Lecture 02.2 - Number Representation: Conversions',
    "[CS61C FA20] Lecture 02.3 - Number Representation: Overflow, Sign and Magnitude, One's Complement",
    "[CS61C FA20] Lecture 02.4 - Number Representation: Two's Complement",
  ].map((part, index) => ({ ...page, part, page: index + 2, cid: String(index + 2), chapter: core.chapterOf(part), selected: true }));
  assert.deepEqual(lecturePages.map(p => p.chapter), ['2', '2', '2', '2']);
  for (const title of ['lec02.2 Conversions', 'p77 CS 285: Lecture 02, Part 4', '[CS61C FA20] Weekly Lecture 02.LIVE']) {
    assert.equal(core.chapterOf(title), '2', title);
  }
  assert.equal(core.chapterOf('[CS61C FA20] Lecture 03.1 - C Intro'), '3');
  assert.equal(core.chapterOf('1.2 Lecture 02.4'), '2');
  assert.equal(core.chapterOf('Lecture 2024 Introduction'), '0');
  const index = core.buildIndex(meta, lecturePages, 'Clippings/YouTube');
  assert.equal((index.match(/^## /gm) || []).length, 1);
  assert.match(index, /^## 第02章$/m);
  for (const part of lecturePages) assert.ok(index.includes(part.part));
});

test('short L lecture markers recognize course titles and group lecture segments', () => {
  for (const [title, expected] of [
    ['Data Mining Lecture - L4', '4'], ['Data Mining Lecture - L3', '3'],
    ['Data Mining Lecture 2', '2'], ['Data Mining Lecture 1', '1'],
    ['L1 Introduction', '1'], ['[L04] Part 2', '4'], ['l02.3 Conversions', '2'],
    ['Ｌ０４ 课程', '4'], ['HTML1 Introduction', '0'], ['L1Cache', '0'], ['L1000 Introduction', '0']
  ]) assert.equal(core.chapterOf(title), expected, title);
  const parts = ['Data Mining Lecture - L4', 'L4 Part 2', 'Data Mining Lecture - L3']
    .map((part, i) => ({ ...page, part, page: i + 1, cid: String(i + 1), chapter: core.chapterOf(part) }));
  assert.deepEqual(parts.map(part => part.chapter), ['4', '4', '3']);
  const index = core.buildIndex(meta, parts, 'Clippings/Bilibili');
  assert.equal((index.match(/^## /gm) || []).length, 2);
  assert.ok(index.indexOf('## 第03章') < index.indexOf('## 第04章'));
});

test('explicit chapters take precedence over video positions and lecture numbers', () => {
  for (const [title, expected] of [
    ['5.第一章 第一节 函数（幂函数）', '1.1'],
    ['13.第一章 第二节 数列的极限', '1.2'],
    ['02-第一章第一节-函数（一）', '1.1'],
    ['第24讲 第三章 微分的应用 微分中值定理j', '3'],
    ['江苏省专转本高等数学第一章-函数的定义-03(基础课)', '1'],
    ['高等数学01（第一章 函数）', '1'],
    ['第一章 2.1认识数列极限', '1'],
    ['5.第十八讲 导数', '18']
  ]) assert.equal(core.chapterOf(title), expected, title);
});

test('numeric section prefixes accept brackets and adjacent Chinese titles', () => {
  for (const [title, expected] of [
    ['[1.1.1]--1.1计算机系统简介课程简介', '1.1'],
    ['【２．１０．１】例题', '2.10'], ['（1.2.3）函数', '1.2'],
    ['1.1函数的定义', '1.1'], ['1.1（上）', '1.1'], ['[1.2] 函数', '1.2'],
    ['0101 映射与函数', '0'], ['2024.09 课程介绍', '0'],
    ['[CS61C FA20] Introduction', '0'], ['1.1000 课程介绍', '0']
  ]) assert.equal(core.chapterOf(title), expected, title);
});

test('English chapters are explicit groups rather than lecture segments', () => {
  for (const [title, expected] of [
    ['Vectors, what even are they? | Chapter 1, Essence of linear algebra', '1'],
    ['Lecture 24: Chapter 3 - Derivatives', '3'], ['5. Chapter 02: Functions', '2'],
    ['CHAPTER: 04 - Limits', '4'], ['Chapter 2024 Introduction', '0'],
    ['Subchapter 3 Introduction', '0']
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

test('SiliconFlow saves a plain transcript with provenance and no fabricated timestamp links', async () => {
  const h = harness({ tracks: false, asrJob: { bvid: meta.bvid, cid: page.cid, status: 'done', provider: 'siliconflow',
    timestamps: false, language: 'en', body: [{ content: 'Original wording.' }, { content: 'Second original paragraph.' }] } });
  const result = await h.run('asr-finish', { jobId: 'a'.repeat(32) });
  assert.equal(result.status, 'saved');
  assert.equal(result.track.timestamps, false);
  const text = h.writes[0].body;
  assert.match(text, /subtitle_source: "siliconflow-asr"/);
  assert.match(text, /transcription_model: "FunAudioLLM\/SenseVoiceSmall"/);
  assert.match(text, /transcription_timestamps: false/);
  assert.match(text, /## 转录稿\n\nOriginal wording\.\n\nSecond original paragraph\./);
  assert.doesNotMatch(text, /\?p=10&t=|\[00:/);
});

test('Groq transcription preserves precise video time links and model identity', async () => {
  const h = harness({ tracks: false, asrJob: { bvid: meta.bvid, cid: page.cid, status: 'done', provider: 'groq',
    timestamps: true, language: 'en', body: [{ from: 121.5, to: 125, content: 'Lecture content.' }] } });
  await h.run('asr-finish', { jobId: 'a'.repeat(32) });
  assert.match(h.writes[0].body, /subtitle_source: "groq-asr"/);
  assert.match(h.writes[0].body, /transcription_model: "whisper-large-v3-turbo"/);
  assert.match(h.writes[0].body, /\[00:02:01\]\(https:\/\/www.bilibili.com\/video\/BV1ps4y1d73V\/\?p=10&t=121\)/);
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

