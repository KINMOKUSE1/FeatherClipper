const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const service = fs.readFileSync(require.resolve('../extension/background/youtube-subtitles.js'), 'utf8');
const dispatch = fs.readFileSync(require.resolve('../extension/background/youtube.js'), 'utf8');
const videoId = 'AMdG7IjgSPM';
const caption = languageCode => ({ languageCode, name: { simpleText: languageCode }, baseUrl: 'https://www.youtube.com/api/timedtext?v=' + videoId + '&lang=' + languageCode + '&fmt=srv3' });
function boot({ tracks = [caption('en')], status = 'OK', id = videoId, xml = '<transcript><text start="1.5" dur="2.25">A &amp; B</text></transcript>', watch = '{"INNERTUBE_API_KEY":"fixture"}', failStage, malformedPlayer = false, stalled = '', fakeClock = false } = {}) {
  const calls = [], rules = [], timers = []; let now = 0;
  const controllerSignals = [];
  const player = { playabilityStatus: { status }, videoDetails: { videoId: id, title: 'HTTP lesson', author: 'Teacher' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } };
  const chrome = { runtime: { id: 'fixture-extension' }, declarativeNetRequest: { updateSessionRules: async rule => { rules.push(rule); } },
    tabs: { query: () => { throw new Error('Caption read must not query tabs'); } }, scripting: { executeScript: () => { throw new Error('Caption read must not inject'); } } };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ URL, AbortController, chrome, Date: fakeClock ? Clock : Date,
    setTimeout: fakeClock ? (fn, ms) => { timers.push({ fn, ms }); return timers.length; } : setTimeout,
    clearTimeout: fakeClock ? () => {} : clearTimeout,
    fetch: async (url, options) => {
      const stage = url.includes('/watch?') ? 'watch' : url.includes('/player?') ? 'player' : 'caption';
      calls.push({ stage, url, options }); controllerSignals.push(options.signal);
      if (stage === stalled) await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      return { ok: stage !== failStage, status: stage === failStage ? 403 : 200,
        text: async () => stage === 'watch' ? watch : xml,
        json: async () => { if (malformedPlayer) throw new SyntaxError('sensitive response fragment'); return player; } };
    }
  });
  vm.runInContext(service + '\n' + dispatch, context);
  return { context, calls, rules, player, timers, signals: controllerSignals, advance: value => { now = value; }, read: purpose => context.youtubeRead(videoId, true, false, '', purpose) };
}

test('background captions use three credential-free HTTP requests, preserve times and never touch tabs', async () => {
  const h = boot(), result = await h.read('preview');
  assert.deepEqual(h.calls.map(call => call.stage), ['watch', 'player', 'caption']);
  assert.ok(h.calls.every(call => call.options.credentials === 'omit' && call.options.cache === 'no-store' && call.options.signal === h.signals[0]));
  assert.equal(result.body[0].from, 1.5); assert.equal(result.body[0].to, 3.75); assert.equal(result.body[0].content, 'A & B');
  assert.equal(result.track.source, 'youtube-caption');
  assert.equal(new URL(h.calls[2].url).searchParams.has('fmt'), false);
  const payload = JSON.parse(h.calls[1].options.body);
  assert.equal(payload.videoId, videoId); assert.equal(payload.context.client.clientName, 'ANDROID');
  const rule = h.rules[0].addRules[0];
  assert.deepEqual([...rule.condition.initiatorDomains], ['fixture-extension']);
  assert.equal(rule.id, 7002); assert.equal(rule.action.requestHeaders[0].operation, 'remove');
  const filter = new RegExp(rule.condition.regexFilter);
  assert.ok(filter.test('https://www.youtube.com/youtubei/v1/player?key=fixture'));
  assert.equal(filter.test('https://www.youtube.com/watch?v=' + videoId), false);
  assert.equal(filter.test('https://www.youtube.com/youtubei/v1/player_else'), false);
});

test('language selection retains Chinese manual preference, default audio and original language fallback', async () => {
  for (const [tracks, configure, expected] of [
    [[caption('en'), { ...caption('zh-Hans'), kind: 'asr' }, caption('zh-Hant')], () => {}, 'zh-Hant'],
    [[caption('en'), caption('de')], r => { r.audioTracks = [{ defaultCaptionTrackIndex: 1 }]; }, 'de'],
    [[caption('en'), { ...caption('ja'), kind: 'asr' }, caption('ja')], () => {}, 'ja'],
    [[caption('de'), caption('en')], () => {}, 'en']
  ]) {
    const h = boot({ tracks }); configure(h.player.captions.playerCaptionsTracklistRenderer);
    assert.equal((await h.read()).track.lan, expected);
  }
  assert.equal((await boot({ tracks: [{ ...caption('en'), kind: 'asr' }] }).read()).track.source, 'youtube-auto-caption');
});

test('only a matching playable player with no tracks becomes missing; malformed and restricted responses remain errors', async () => {
  const h = boot({ tracks: [] }); assert.equal((await h.read()).missing, true); assert.equal(h.calls.length, 2);
  for (const config of [{ status: 'LOGIN_REQUIRED' }, { status: 'UNPLAYABLE' }, { status: undefined }, { id: 'dQw4w9WgXcQ' }, { tracks: {} }, { malformedPlayer: true }]) {
    const broken = boot({ tracks: [], ...config });
    if (config.status === undefined && 'status' in config) delete broken.player.playabilityStatus.status;
    await assert.rejects(broken.read(), /YouTube/);
  }
});

test('HTTP errors and empty captions remain failures and do not expose addresses or response payloads', async () => {
  for (const stage of ['watch', 'player', 'caption']) {
    await assert.rejects(boot({ failStage: stage }).read(), error => /HTTP 403/.test(error.message) && !/https|fixture/.test(error.message));
  }
  for (const xml of ['', '<html>error</html>', '<transcript></transcript>', '<transcript><text start="oops">wrong</text></transcript>']) {
    await assert.rejects(boot({ xml }).read(), /字幕文件/);
  }
  await assert.rejects(boot({ watch: '<html>Consent</html>' }).read(), /播放器配置/);
});

test('caption files are fetched only from the YouTube timedtext endpoint', async () => {
  for (const baseUrl of ['http://www.youtube.com/api/timedtext', 'https://youtube.com.evil.test/api/timedtext', 'https://www.youtube.com/watch?v=other', 'bad-url']) {
    const h = boot({ tracks: [{ ...caption('en'), baseUrl }] });
    await assert.rejects(h.read(), /字幕地址无效/); assert.equal(h.calls.length, 2);
  }
});

test('XML parsing handles double-encoded entities, Unicode, markup and the entire valid document', () => {
  const h = boot();
  const body = h.context.youtubeParseSubtitle('<?xml version="1.0"?><transcript><text start="0" dur="2">&amp;#39;quoted&amp;#39; &#x1F3B5;<br/>next <i>word</i></text><text start=\'3\'>end</text></transcript>');
  assert.equal(body[0].content, "'quoted' 🎵 next word"); assert.equal(body[1].to, 3);
  for (const xml of ['<transcript><text>no time</text></transcript>', '<transcript><text start="-1">bad</text></transcript>', '<transcript><text start="0" dur="-2">bad</text></transcript>', '<transcript><text start="0">valid</text><text start="2">unfinished</transcript>']) {
    assert.throws(() => h.context.youtubeParseSubtitle(xml), /内容无效/);
  }
});

test('five-second total timeout aborts the active fetch at every network stage', async () => {
  for (const stalled of ['watch', 'player', 'caption']) {
    const h = boot({ stalled, fakeClock: true });
    const request = h.read('preview'), rejected = assert.rejects(request, /字幕获取超时（5 秒）/);
    await new Promise(setImmediate);
    assert.deepEqual(h.timers.map(timer => timer.ms), [5000]);
    h.advance(5000); h.timers[0].fn(); await rejected;
    assert.ok(h.signals.every(signal => signal.aborted));
  }
});

test('subtitle requests bypass a blocked metadata/audio helper queue and metadata can read in parallel', async () => {
  const h = boot(); let release;
  h.context.chrome.tabs.query = async () => [{ id: 9, status: 'complete', url: 'https://www.youtube.com/watch?v=' + videoId }];
  h.context.chrome.scripting.executeScript = async ({ args, injectImmediately }) => {
    if (args[1]) await new Promise(resolve => { release = resolve; });
    else assert.equal(injectImmediately, true);
    return [{ result: { meta: { title: 'metadata' } } }];
  };
  const audio = h.context.youtubeRead(videoId, false, true); await new Promise(setImmediate);
  const captionResult = await h.read('preview'); assert.equal(captionResult.body.length, 1);
  assert.equal((await h.context.youtubeRead(videoId)).meta.title, 'metadata');
  release(); await audio;
});

test('preview is fresh every time and reused by only the immediately following matching import', async () => {
  const h = boot(); await h.read('preview'); await h.read('preview');
  assert.equal(h.calls.length, 6); await h.read('import'); assert.equal(h.calls.length, 6);
  await h.read('import'); assert.equal(h.calls.length, 9); assert.equal(h.rules.length, 1);
  await h.read('preview');
  h.player.videoDetails.videoId = 'dQw4w9WgXcQ';
  await h.context.youtubeRead('dQw4w9WgXcQ', true, false, '', 'import');
  assert.equal(h.calls.length, 15);
});

test('failed preview invalidates previous successful preview and retry obtains current data', async () => {
  const h = boot(); await h.read('preview'); h.player.playabilityStatus.status = 'UNPLAYABLE';
  await assert.rejects(h.read('preview')); await assert.rejects(h.read('import'));
  h.player.playabilityStatus.status = 'OK'; await h.read('preview'); assert.equal(h.calls.length, 10);
});

test('identical concurrent previews share only their in-flight request', async () => {
  const h = boot(); await Promise.all([h.read('preview'), h.read('preview')]); assert.equal(h.calls.length, 3);
  await h.read('preview'); assert.equal(h.calls.length, 6);
});
