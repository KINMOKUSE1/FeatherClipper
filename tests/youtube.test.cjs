const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');
const source = fs.readFileSync(path.join(__dirname, '../extension/youtube-background.js'), 'utf8');

const videoId = 'GWwL_pLuX-U';
function page({ tracks, entries, audio = [], playlist = null, mobilePlayer = null, domTranscript = null, inlineOnly = false, noPlayer = false, fetchOverride = null }) {
  const player = { videoDetails: { videoId, title: 'Course video', author: 'Teacher', lengthSeconds: '240' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
    streamingData: { adaptiveFormats: audio } };
  const requested = [];
  let transcriptOpened = Boolean(domTranscript?.visible);
  let menuOpen = false, transcriptLanguage = domTranscript?.language;
  const makeSegments = lines => lines.map(([time, text]) => ({
    querySelector: selector => selector.includes('.segment-timestamp') ? { textContent: time }
      : selector.includes('.segment-text') ? { textContent: text } : null
  }));
  let segments = makeSegments(domTranscript?.lines || []);
  const transcriptContainer = {
    querySelector: selector => selector.includes('ytd-transcript-segment-renderer') ? segments[0] || null : null,
    querySelectorAll: selector => selector.includes('ytd-transcript-segment-renderer') ? segments : []
  };
  const context = vm.createContext({ URL, AbortSignal, AbortController, location: { href: `https://www.youtube.com/watch?v=${videoId}${playlist ? '&list=PLKq1TCpsv3Y4' : ''}` },
    window: { ytInitialPlayerResponse: inlineOnly || noPlayer ? undefined : player,
      ytInitialData: playlist ? { contents: { twoColumnWatchNextResults: { playlist: { playlist } } } } : {} },
    document: { title: 'Course video - YouTube', scripts: inlineOnly ? [{ textContent: `var ytInitialPlayerResponse = ${JSON.stringify(player)};` }] : [], querySelectorAll: selector => {
      if (!selector.includes('tp-yt-paper-listbox') || !menuOpen) return [];
      return (domTranscript?.alternatives || []).map(item => ({ textContent: item.language, getClientRects: () => [1], click: () => {
        transcriptLanguage = item.language; segments = makeSegments(item.lines); menuOpen = false;
      } }));
    }, querySelector: selector => {
      if (!domTranscript) return null;
      if (selector.includes('#segments-container')) return transcriptOpened ? transcriptContainer : null;
      if (selector === 'ytd-video-description-transcript-section-renderer button') return { click: () => { transcriptOpened = true; } };
      if (selector.includes('#footer yt-sort-filter-sub-menu-renderer')) return { textContent: transcriptLanguage, click: () => { menuOpen = !menuOpen; } };
      return null;
    } },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
    setTimeout,
    fetch: async (url, options) => {
      requested.push(String(url));
      if (fetchOverride) return fetchOverride(String(url), options);
      if (String(url).includes('/youtubei/v1/player')) return { ok: true, json: async () => mobilePlayer };
      if (String(url).includes('exp=xpe')) return { ok: true, text: async () => '' };
      return { ok: true, text: async () => JSON.stringify(entries[String(url).includes('lang=en') ? 'en' : 'zh'] || { events: [] }) };
    },
    chrome: {} });
  vm.runInContext(source, context);
  return { read: (...args) => context.youtubePageRead(videoId, ...args), requested };
}

test('YouTube video data is read from inline script when the window global is absent', async () => {
  const h = page({ inlineOnly: true, tracks: [
    { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: { en: { events: [{ tStartMs: 1000, segs: [{ utf8: 'From script' }] }] } } });
  const result = await h.read('en', true, false);
  assert.equal(result.meta.title, 'Course video');
  assert.equal(result.body[0].content, 'From script');
});

test('YouTube caption selection returns the requested language with timestamps', async () => {
  const h = page({ tracks: [
    { languageCode: 'zh-CN', name: { simpleText: '中文' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh' },
    { languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: { en: { events: [{ tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'First lesson' }] }] } } });
  const result = await h.read('en', true, false);
  assert.equal(result.track.lan, 'en');
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].from, 1.5);
  assert.equal(result.body[0].content, 'First lesson');
  assert.ok(h.requested.filter(url => url.includes('/api/timedtext')).every(url => url.includes('lang=en')));
});

test('protected WEB tracks are read from the mobile player without losing the chosen language', async () => {
  const h = page({
    tracks: [
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' },
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }
    ],
    mobilePlayer: { videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh' },
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
    ] } } },
    entries: { en: { events: [{ tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: 'All right.' }] }] } }
  });
  const result = await h.read('en', true, false);
  assert.equal(result.track.lan, 'en');
  assert.equal(result.body[0].content, 'All right.');
  assert.equal(result.body[0].from, 7);
  assert.ok(h.requested.some(url => url.includes('/youtubei/v1/player')));
  assert.ok(h.requested.some(url => url.includes('exp=xpe')));
});

test('YouTube audio lookup keeps only direct Google video audio streams', async () => {
  const h = page({ tracks: [], entries: {}, audio: [
    { mimeType: 'video/mp4', url: 'https://x.googlevideo.com/video', bitrate: 100 },
    { mimeType: 'audio/webm', url: 'https://evil.test/audio', bitrate: 50 },
    { mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/audio', bitrate: 80 }
  ] });
  const result = await h.read('auto', false, true);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/audio']);
});

test('empty caption responses are retrieval failures rather than proof of missing captions', async () => {
  const h = page({ tracks: [
    { languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: {} });
  const result = await h.read('en', true, false);
  assert.match(result.error, /尚不能判定视频无字幕/);
  assert.equal(result.missing, undefined);
});

test('YouTube rendered transcript is used after caption endpoints fail', async () => {
  const h = page({
    tracks: [{ languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' },
      baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }],
    entries: {},
    domTranscript: { language: 'English (auto-generated)', lines: [['0:07', 'All right.'], ['1:02', 'The second idea.']] }
  });
  const result = await h.read('en', true, false);
  assert.equal(result.track.lan, 'en');
  assert.equal(result.track.source, 'youtube-transcript-panel');
  assert.deepEqual([...result.body.map(item => item.from)], [7, 62]);
  assert.deepEqual([...result.body.map(item => item.content)], ['All right.', 'The second idea.']);
});

test('an already visible transcript is read without a network request', async () => {
  const h = page({
    tracks: [{ languageCode: 'en', name: { simpleText: 'English' },
      baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }],
    entries: {},
    domTranscript: { visible: true, language: 'English', lines: [['0:07', 'All right.']] }
  });
  const result = await h.read('en', true, false);
  assert.equal(result.body[0].content, 'All right.');
  assert.equal(h.requested.length, 0);
});

test('rendered transcript never substitutes Chinese for an explicit English choice', async () => {
  const h = page({
    tracks: [
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' },
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' }
    ],
    entries: {},
    domTranscript: { language: '中文', lines: [['0:07', '你好']] }
  });
  const result = await h.read('en', true, false);
  assert.ok(result.error);
  assert.equal(result.body, undefined);
});

test('a ready video tab is preferred over another loading tab for the same video', async () => {
  const context = vm.createContext({ URL, chrome: { tabs: { query: async () => [
    { id: 1, url: `https://www.youtube.com/watch?v=${videoId}`, status: 'loading', active: true },
    { id: 2, url: `https://www.youtube.com/watch?v=${videoId}`, status: 'complete', active: false }
  ] } } });
  vm.runInContext(source, context);
  const result = await context.youtubeTab(videoId);
  assert.equal(result.id, 2);
});

function workerHarness() {
  let reads = 0, fail = false;
  const chrome = {
    tabs: { query: async () => [{ id: 2, url: `https://www.youtube.com/watch?v=${videoId}`, status: 'complete' }] },
    scripting: { executeScript: async () => {
      reads++;
      return [{ result: fail ? { error: 'temporary failure' } : { meta: { videoId }, track: { lan: 'en' }, body: [{ from: 7, content: `Read ${reads}` }] } }];
    } }
  };
  const context = vm.createContext({ URL, chrome });
  vm.runInContext(source, context);
  return { context, chrome, reads: () => reads, fail: value => { fail = value; },
    read: (purpose, language = 'en') => context.youtubeRead(videoId, language, true, false, '', purpose) };
}

test('each new preview reads again; only the following import reuses its result once', async () => {
  const h = workerHarness();
  await h.read('preview');
  const fresh = await h.read('preview');
  assert.equal(fresh.body[0].content, 'Read 2');
  const imported = await h.read('import');
  assert.equal(imported.body[0].content, 'Read 2');
  assert.equal(h.reads(), 2);
  await h.read('import');
  assert.equal(h.reads(), 3);
});

test('failed previews invalidate earlier successes and allow a fresh retry', async () => {
  const h = workerHarness();
  await h.read('preview');
  h.fail(true);
  await assert.rejects(h.read('preview'), /temporary failure/);
  await assert.rejects(h.read('import'), /temporary failure/);
  h.fail(false);
  const result = await h.read('preview');
  assert.equal(result.body[0].content, 'Read 4');
});

test('language changes and worker restarts cannot reuse a previous preview', async () => {
  const h = workerHarness();
  await h.read('preview');
  await h.read('import', 'zh');
  assert.equal(h.reads(), 2);
  await h.read('preview');
  const restarted = vm.createContext({ URL, chrome: h.chrome });
  vm.runInContext(source, restarted);
  await restarted.youtubeRead(videoId, 'en', true, false, '', 'import');
  assert.equal(h.reads(), 4);
});

test('simultaneous identical previews share only their in-flight request', async () => {
  const h = workerHarness();
  await Promise.all([h.read('preview'), h.read('preview')]);
  assert.equal(h.reads(), 1);
  await h.read('preview');
  assert.equal(h.reads(), 2);
});

test('a YouTube playlist becomes a numbered course with each video ID', async () => {
  const playlistId = 'PLKq1TCpsv3Y4';
  const h = page({ tracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }], entries: {},
    playlist: { title: 'Deep Reinforcement Learning', contents: [
      { playlistPanelVideoRenderer: { videoId, title: { simpleText: 'Lecture 1' }, lengthSeconds: '2658' } },
      { playlistPanelVideoRenderer: { videoId: 'abcdef12345', title: { simpleText: 'Lecture 2' }, lengthSeconds: '6960' } }
    ] } });
  const result = await h.read('auto', false, false, playlistId);
  assert.equal(result.meta.bvid, `YTPL_${playlistId}`);
  assert.equal(result.meta.title, 'Deep Reinforcement Learning');
  assert.deepEqual([...result.meta.pages.map(item => item.cid)], [videoId, 'abcdef12345']);
  assert.equal(result.meta.pages[1].page, 2);
  const parsed = core.parseSource(`https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`);
  assert.equal(parsed.playlistId, playlistId);
});

test('YouTube notes use video IDs and playable time links', () => {
  const parsed = core.parseSource(`https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(parsed.platform, 'youtube');
  const meta = { platform: 'youtube', videoId, bvid: `YT_${videoId}`, title: 'Course video', author: 'Teacher' };
  const part = { cid: videoId, page: 1, part: 'Course video', chapter: '0' };
  const raw = core.buildRaw(meta, part, { lan: 'en', lanDoc: 'English' }, [{ from: 65, content: 'First lesson' }]);
  assert.match(core.rawPath(meta, part, 'Clippings/YouTube'), /\[YT-GWwL_pLuX-U\]\.md$/);
  assert.match(raw, /platform: youtube/);
  assert.match(raw, /watch\?v=GWwL_pLuX-U&t=65/);
});

test('visible transcripts do not depend on player metadata', async () => {
  const h = page({ noPlayer: true, tracks: [], entries: {},
    domTranscript: { visible: true, language: 'English', lines: [['0:07', 'All right.']] } });
  const result = await h.read('en', true, false);
  assert.equal(result.body[0].content, 'All right.');
  assert.equal(h.requested.length, 0);
});

test('metadata and preview reuse the same helper tab and later videos navigate only that helper', async () => {
  const session = {}, tabs = [];
  let creates = 0, updates = 0;
  const context = vm.createContext({ URL, chrome: {
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values) } },
    tabs: {
      query: async () => tabs,
      get: async id => tabs.find(tab => tab.id === id),
      create: async options => { creates++; const tab = { id: creates, status: 'complete', ...options }; tabs.push(tab); return tab; },
      update: async (id, options) => { updates++; Object.assign(tabs.find(tab => tab.id === id), options); return tabs.find(tab => tab.id === id); }
    },
    scripting: { executeScript: async ({ args }) => [{ result: { meta: { videoId: args[0] }, ...(args[2] ? { track: { lan: 'en' }, body: [{ from: 7, content: 'All right.' }] } : {}) } }] }
  } });
  vm.runInContext(source, context);
  await context.youtubeRead(videoId, 'auto', false);
  await context.youtubeRead(videoId, 'en', true);
  await context.youtubeRead('abcdef12345', 'en', true);
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});

test('the inline caption completes without waiting for a slow player request', async () => {
  let playerStarted = false, playerAborted = false;
  const h = page({ tracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }],
    fetchOverride: async (url, options) => {
      if (url.includes('/youtubei/v1/player')) {
        playerStarted = true;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
          playerAborted = true; reject(options.signal.reason);
        }, { once: true }));
      }
      assert.equal(options.cache, 'no-store');
      return { ok: true, text: async () => JSON.stringify({ events: [{ tStartMs: 7000, segs: [{ utf8: 'Fast caption' }] }] }) };
    }
  });
  const result = await h.read('en', true, false);
  assert.equal(result.body[0].content, 'Fast caption');
  assert.equal(playerStarted, true);
  assert.equal(playerAborted, true);
});

test('identical inline and player caption URLs are requested only once', async () => {
  const tracks = [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }];
  const h = page({ tracks, entries: {}, mobilePlayer: { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } },
    domTranscript: { language: 'English', lines: [['0:07', 'From the panel']] } });
  const result = await h.read('en', true, false);
  assert.equal(result.body[0].content, 'From the panel');
  assert.equal(h.requested.filter(url => url.includes('/api/timedtext')).length, 1);
  assert.ok(h.requested.every(url => !url.includes('fmt=') && !url.includes('/get_transcript')));
});

test('reading video metadata does not probe captions when the player has no tracks', async () => {
  const h = page({ tracks: [], entries: {} });
  const result = await h.read('auto', false, false);
  assert.equal(result.meta.title, 'Course video');
  assert.equal(h.requested.length, 0);
});

test('YouTube lists real tracks without downloading captions or inventing translation languages', async () => {
  const h = page({ tracks: [
    { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' },
    { vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr' },
    { vssId: '.ja', languageCode: 'ja', name: { simpleText: '日本語' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=ja' }
  ], entries: {} });
  const result = await h.read('auto', true, false, '', true);
  assert.deepEqual([...result.tracks.map(t => t.id)], ['.en', 'a.en', '.ja']);
  assert.match(result.tracks[1].lanDoc, /自动生成/);
  assert.ok(result.tracks.every(t => t.videoId === videoId && !t.baseUrl));
  assert.equal(h.requested.length, 0);
});

test('exact YouTube track choice distinguishes manual and automatic captions of one language', async () => {
  const h = page({ tracks: [
    { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' },
    { vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr' }
  ], fetchOverride: async url => url.includes('/player') ? { ok: true, json: async () => null }
    : { ok: true, text: async () => JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: url.includes('kind=asr') ? 'Automatic' : 'Manual' }] }] }) } });
  const result = await h.read({ platform: 'youtube', videoId, id: 'a.en' }, true, false);
  assert.equal(result.body[0].content, 'Automatic');
  assert.ok(h.requested.filter(url => url.includes('timedtext')).every(url => url.includes('kind=asr')));
  const invalid = await h.read({ platform: 'youtube', videoId: 'abcdef12345', id: '.en' }, true, false);
  assert.match(invalid.error, /不属于当前视频/);
});

test('a refreshed player track list is available to the transcript fallback', async () => {
  const tracks = [{ vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }];
  const h = page({ tracks: [], entries: {}, mobilePlayer: { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } },
    domTranscript: { language: 'English', lines: [['0:07', 'All right.']] } });
  const result = await h.read({ platform: 'youtube', videoId, id: 'a.en' }, true, false);
  assert.equal(result.body[0].content, 'All right.');
});

test('different exact track choices cannot share the preview import cache', async () => {
  const h = workerHarness();
  await h.read('preview', { platform: 'youtube', videoId, id: '.en' });
  await h.read('import', { platform: 'youtube', videoId, id: 'a.en' });
  assert.equal(h.reads(), 2);
});

test('exact track fallback switches the platform transcript and waits for the new segments', async () => {
  const h = page({ tracks: [
    { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' },
    { vssId: '.zh', languageCode: 'zh', name: { simpleText: '中文' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' }
  ], entries: {}, domTranscript: { visible: true, language: '中文', lines: [['0:07', '你好']],
    alternatives: [{ language: 'English', lines: [['0:07', 'All right.']] }] } });
  const result = await h.read({ platform: 'youtube', videoId, id: '.en' }, true, false);
  assert.equal(result.track.lan, 'en');
  assert.equal(result.body[0].content, 'All right.');
});
