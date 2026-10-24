const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const source = ['wbi.js', 'bilibili.js'].map(name => fs.readFileSync(require('node:path').join(__dirname, '../extension/background', name), 'utf8')).join('\n');
const imgKey = '7cd084941338484aae1ad9425b84077c', subKey = '4932caff0ff746eab6f01bf08b70ac45';
const meta = { bvid: 'BVexample', aid: '123', pages: [{ cid: '456', duration: 60 }] };
const page = meta.pages[0];
const chinese = { id: 1, id_str: '9007199254740993', lan: 'ai-zh', lan_doc: '中文', subtitle_url: '//aisubtitle.hdslb.com/chinese' };
const english = { id: 2, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/english' };
function boot(options = {}) {
  const calls = [];
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, TextEncoder, fetch: async (url, request) => {
    calls.push({ url, request });
    if (url.includes('/nav')) return { ok: true, json: async () => options.nav || { code: options.loggedOut ? -101 : 0, data: { isLogin: !options.loggedOut,
      wbi_img: { img_url: `https://i0.hdslb.com/bfs/wbi/${imgKey}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${subKey}.png` } } } };
    if (url.includes('/x/player/wbi/v2')) {
      if (options.http) return { ok: false, status: options.http };
      if (options.error) return { ok: true, json: async () => ({ code: options.error, message: 'rejected' }) };
      return { ok: true, json: async () => ({ code: 0, data: { cid: 456, aid: 123, bvid: meta.bvid, subtitle: { subtitles: options.tracks ?? [chinese, english] }, ...options.identity } }) };
    }
    if (url.includes('/x/player/v2')) throw new Error('Legacy endpoint must not be requested');
    if (options.bodyError) throw new Error('Subtitle network failure');
    return { ok: true, json: async () => options.bodyResponse || { body: options.body ?? [{ from: 0, to: 2, content: url.endsWith('/english') ? 'English text' : '中文内容' }] } };
  } });
  vm.runInContext(source, context);
  return { context, calls, read: (trackId = '') => context.courseSubtitle(meta, page, 'read', trackId) };
}

test('MD5 matches RFC vectors and Node crypto across UTF-8 and padding boundaries', () => {
  const { context } = boot();
  for (const text of ['', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    '1234567890'.repeat(8), '字幕签名🙂', ...[55, 56, 63, 64, 65, 119, 120].map(size => 'x'.repeat(size))]) {
    assert.equal(context.courseWbiMd5(text), crypto.createHash('md5').update(text).digest('hex'), text);
  }
});

test('WBI uses the published mixin key vector, sorted encoding and an integer timestamp', () => {
  const { context } = boot();
  const query = 'bar=514&baz=1919810&foo=114&wts=1702204169';
  const digest = crypto.createHash('md5').update(query + 'ea1db124af3c7062474693fa704f4ff8').digest('hex');
  assert.equal(context.courseWbiQuery({ foo: '114', bar: '514', baz: 1919810 }, imgKey, subKey, 1702204169), `${query}&w_rid=${digest}`);
  const filtered = context.courseWbiQuery({ name: "A B!'()*中文" }, imgKey, subKey, 1);
  assert.ok(filtered.startsWith('name=A%20B%E4%B8%AD%E6%96%87&wts=1&w_rid='));
  assert.throws(() => context.courseWbiQuery({}, '', subKey, 1), /签名信息无效/);
});

test('retrieval signs the target identities, includes credentials and preserves precise track IDs', async () => {
  const h = boot(), result = await h.read();
  assert.equal(result.track.id, chinese.id_str);
  assert.equal(result.body[0].content, '中文内容');
  const request = h.calls.find(call => call.url.includes('/x/player/'));
  const params = new URL(request.url).searchParams;
  assert.equal(params.get('cid'), '456'); assert.equal(params.get('aid'), '123'); assert.equal(params.get('bvid'), meta.bvid);
  assert.match(params.get('w_rid'), /^[0-9a-f]{32}$/); assert.match(params.get('wts'), /^\d+$/);
  const expected = h.context.courseWbiQuery({ bvid: meta.bvid, aid: meta.aid, cid: page.cid }, imgKey, subKey, Number(params.get('wts')));
  assert.equal(new URL(request.url).search.slice(1), expected);
  assert.equal(request.request.credentials, 'include'); assert.equal(request.request.cache, 'no-store');
  assert.equal(h.calls.length, 3);
});

test('mismatched or missing identity is rejected before subtitle content is downloaded', async () => {
  for (const identity of [{ cid: 999 }, { aid: 999 }, { bvid: 'BVother' }, { bv_id: 'BVother' }, { cid: undefined }]) {
    const h = boot({ identity });
    await assert.rejects(h.read(), /与当前视频不一致/);
    assert.equal(h.calls.length, 2);
  }
});

test('page must belong to the course before requesting any metadata', async () => {
  const h = boot();
  await assert.rejects(h.context.courseSubtitle(meta, { cid: '999' }), /视频信息不完整/);
  assert.equal(h.calls.length, 0);
});

test('logged-in empty lists and empty bodies are missing and never use the legacy endpoint', async () => {
  for (const options of [{ tracks: [] }, { body: [] }]) {
    const h = boot(options);
    assert.equal(await h.read(), null);
    assert.ok(h.calls.every(call => !call.url.includes('/x/player/v2')));
  }
});

test('logged-out empty results and explicit login gates are errors rather than missing subtitles', async () => {
  for (const options of [{ loggedOut: true, tracks: [] }, { identity: { need_login_subtitle: true } }]) {
    await assert.rejects(boot(options).read(), error => error.fatal === true && /登录 B站/.test(error.message));
  }
  const publicTrack = boot({ loggedOut: true });
  assert.equal((await publicTrack.read()).body[0].content, '中文内容');
});

test('malformed lists, unavailable URLs and malformed bodies are errors rather than missing subtitles', async () => {
  for (const options of [{ identity: { subtitle: {} } }, { tracks: [{ id: 1, lan: 'zh' }] }, { bodyResponse: {} },
    { body: [{ from: -1, to: 2, content: 'Invalid' }] }, { body: [{ from: 0, to: -1, content: 'Invalid' }] },
    { body: [{ from: 0, to: '2', content: 'Invalid' }] }]) {
    await assert.rejects(boot(options).read());
  }
});

test('HTTP, signing, rate-limit and body errors never turn into missing or unsigned fallback', async () => {
  for (const options of [{ http: 403 }, { error: -352 }, { error: -403 }, { bodyError: true }, { nav: { code: 0, data: {} } }]) {
    const h = boot(options);
    await assert.rejects(h.read());
    assert.ok(h.calls.every(call => !call.url.includes('/x/player/v2')));
  }
});

test('explicit language selection fetches only its body and cannot change languages on failure', async () => {
  const h = boot();
  const result = await h.read('2');
  assert.equal(result.body[0].content, 'English text');
  assert.ok(!h.calls.some(call => call.url.endsWith('/chinese')));
  await assert.rejects(boot().read('no-such-track'), /所选字幕暂不可用/);
  await assert.rejects(boot({ bodyError: true }).read('2'), /Subtitle network failure/);
});

test('duration validation rejects foreign content even from matching metadata', async () => {
  await assert.rejects(boot({ body: [{ from: 0, to: 1000, content: 'Wrong content' }] }).read(), /超出该 P 的时长/);
});


test('language preferences select each video track independently, including AI and regional variants', async () => {
  const first = boot(), second = boot({ tracks: [chinese, { ...english, id: 77, lan: 'ai-en' }] });
  assert.equal((await first.context.courseSubtitle(meta, page, 'preview', '', 'en')).track.id, '2');
  assert.equal((await second.context.courseSubtitle(meta, page, 'import', '', 'en')).track.id, '77');
  const regional = boot({ tracks: [chinese, { ...english, lan: 'en-US' }] });
  assert.equal((await regional.context.courseSubtitle(meta, page, 'preview', '', 'en')).track.lan, 'en-US');
  const unavailable = boot({ tracks: [chinese] });
  await assert.rejects(unavailable.context.courseSubtitle(meta, page, 'preview', '', 'en'), /没有所选语言/);
  assert.ok(!unavailable.calls.some(call => call.url.endsWith('/chinese')));
  assert.equal(await boot({ tracks: [] }).context.courseSubtitle(meta, page, 'preview', '', 'en'), null);
});


test('Bilibili nav, signed track list and caption body share one eight-second budget', async () => {
  const h = boot(), timeouts = [];
  h.context.AbortSignal = { timeout: ms => { timeouts.push(ms); return AbortSignal.timeout(ms); } };
  await h.read();
  assert.deepEqual(timeouts, [8000]);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(call => call.request.signal === h.calls[0].request.signal));
});

test('an expired Bilibili subtitle budget stops before the next API and remains a retrieval failure', async () => {
  const h = boot(), controller = new AbortController(), original = h.context.fetch;
  h.context.AbortSignal = { timeout: () => controller.signal };
  h.context.fetch = async (...args) => { const result = await original(...args); controller.abort(new DOMException('timeout', 'TimeoutError')); return result; };
  await assert.rejects(h.read(), /字幕获取超时（8 秒）/);
  assert.equal(h.calls.length, 1);
});
