const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/course-core.js');
const source = fs.readFileSync(path.join(__dirname, '../extension/youtube-background.js'), 'utf8');

const videoId = 'GWwL_pLuX-U';
function page({ tracks, entries, audio = [], playlist = null, mobilePlayer = null, domTranscript = null, inlineOnly = false, noPlayer = false, fetchOverride = null, metadataNodes = {}, otherPanels = [], playlistPanels = [], onWait = null }) {
  const player = { videoDetails: { videoId, title: 'Course video', author: 'Teacher', lengthSeconds: '240' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
    streamingData: { adaptiveFormats: audio } };
  const requested = [];
  let now = 0, clicks = 0, expanded = false;
  class Clock extends Date { static now() { return now; } }
  let transcriptOpened = Boolean(domTranscript?.visible);
  let menuOpen = false, transcriptLanguage = domTranscript?.language;
  const makeSegments = lines => lines.map(([time, text]) => ({
    querySelector: selector => {
      const selectors = selector.split(',').map(value => value.trim());
      if (selectors.includes(domTranscript?.modern ? '.ytwTranscriptSegmentViewModelTimestamp' : '.segment-timestamp')) return { textContent: time };
      if (selectors.includes(domTranscript?.modern ? 'span.ytAttributedStringHost[role="text"]' : '.segment-text')) return { textContent: text };
      return null;
    }
  }));
  let segments = makeSegments(domTranscript?.lines || []);
  const currentSegments = () => now < (domTranscript?.bodyAt || 0) ? []
    : now < (domTranscript?.completeAt || 0) ? segments.slice(0, 1) : segments;
  const transcriptContainer = {
    closest: () => transcriptPanel,
    querySelector: selector => selector.includes('ytd-transcript-segment-renderer') ? currentSegments()[0] || null : null,
    querySelectorAll: selector => selector.includes('ytd-transcript-segment-renderer') ? currentSegments() : []
  };
  const transcriptPanel = {
    closest: () => transcriptPanel,
    getAttribute: name => name === 'visibility' ? transcriptOpened ? 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' : 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'
      : domTranscript?.modern ? null : 'engagement-panel-searchable-transcript',
    querySelector: selector => selector.includes('yt-dropdown-menu button')
      ? { textContent: transcriptLanguage, click: () => { menuOpen = !menuOpen; } }
      : transcriptOpened ? transcriptContainer.querySelector(selector) : null,
    querySelectorAll: selector => transcriptOpened ? transcriptContainer.querySelectorAll(selector) : []
  };
  const emptyLegacyPanel = {
    closest: () => emptyLegacyPanel,
    getAttribute: () => 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
    querySelector: () => null, querySelectorAll: () => []
  };
  const context = vm.createContext({ URL, URLSearchParams, Date: Clock, AbortSignal, AbortController, location: { href: `https://www.youtube.com/watch?v=${videoId}${playlist || playlistPanels.length ? '&list=PLKq1TCpsv3Y4' : ''}` },
    window: { ytInitialPlayerResponse: inlineOnly || noPlayer ? undefined : player,
      ytInitialData: playlist ? { contents: { twoColumnWatchNextResults: { playlist: { playlist } } } } : {} },
    document: { title: 'Course video - YouTube', scripts: inlineOnly ? [{ textContent: `var ytInitialPlayerResponse = ${JSON.stringify(player)};` }] : [], querySelectorAll: selector => {
      if (selector === 'ytd-playlist-panel-renderer') return playlistPanels;
      if (selector === 'ytd-engagement-panel-section-list-renderer') return domTranscript ? [...otherPanels, ...(domTranscript.modern ? [emptyLegacyPanel] : []), transcriptPanel] : otherPanels;
      if (!selector.includes('tp-yt-paper-listbox') || !menuOpen) return [];
      return (domTranscript?.alternatives || []).map(item => ({ textContent: item.language, getClientRects: () => [1], click: () => {
        transcriptLanguage = item.language; segments = makeSegments(item.lines); menuOpen = false;
      } }));
    }, querySelector: selector => {
      if (metadataNodes[selector]) return metadataNodes[selector];
      if (!domTranscript) return null;
      if (selector.includes('#segments-container')) return transcriptOpened && !domTranscript.modern ? transcriptContainer : null;
      if (selector === 'ytd-video-description-transcript-section-renderer button') return now < (domTranscript.buttonAt || 0) || (domTranscript.needsExpand && !expanded) ? null : {
        getAttribute: () => null, getClientRects: () => [1],
        click: () => { clicks++; if (clicks > (domTranscript.ignoredClicks || 0)) transcriptOpened = true; }
      };
      if (selector === 'ytd-watch-metadata #description-inline-expander #expand') return domTranscript.needsExpand ? {
        getAttribute: () => null, getClientRects: () => [1], click: () => { expanded = true; }
      } : null;
      if (selector === 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]') return domTranscript.modern ? emptyLegacyPanel : transcriptPanel;
      return null;
    } },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
    setTimeout: (callback, delay) => { now += delay; onWait?.(now, context); queueMicrotask(callback); },
    fetch: async (url, options) => {
      requested.push(String(url));
      if (fetchOverride) return fetchOverride(String(url), options);
      if (String(url).includes('/youtubei/v1/player')) return { ok: true, json: async () => mobilePlayer };
      if (String(url).includes('exp=xpe')) return { ok: true, text: async () => '' };
      return { ok: true, text: async () => JSON.stringify(entries[String(url).includes('lang=en') ? 'en' : 'zh'] || { events: [] }) };
    },
    chrome: {} });
  vm.runInContext(source, context);
  return { read: (...args) => context.youtubePageRead(videoId, ...args), requested, panel: transcriptPanel, state: () => ({ now, clicks, expanded }) };
}

test('YouTube video data is read from inline script when the window global is absent', async () => {
  const h = page({ inlineOnly: true, tracks: [
    { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: { en: { events: [{ tStartMs: 1000, segs: [{ utf8: 'From script' }] }] } } });
  const result = await h.read(true, false);
  assert.equal(result.meta.title, 'Course video');
  assert.equal(result.body[0].content, 'From script');
});

test('YouTube automatic caption fallback prefers Chinese and preserves timestamps', async () => {
  const h = page({ tracks: [
    { languageCode: 'zh-CN', name: { simpleText: '中文' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh' },
    { languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: { zh: { events: [{ tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'First lesson' }] }] } } });
  const result = await h.read(true, false);
  assert.equal(result.track.lan, 'zh-CN');
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].from, 1.5);
  assert.equal(result.body[0].content, 'First lesson');
  assert.ok(h.requested.filter(url => url.includes('/api/timedtext')).every(url => url.includes('lang=zh')));
});

test('protected WEB tracks fall back to automatic captions from the mobile player', async () => {
  const h = page({
    tracks: [
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' },
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }
    ],
    mobilePlayer: { videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh' },
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
    ] } } },
    entries: { zh: { events: [{ tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: 'All right.' }] }] } }
  });
  const result = await h.read(true, false);
  assert.equal(result.track.lan, 'zh-CN');
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
  const result = await h.read(false, true);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/audio']);
});

test('empty caption responses are retrieval failures rather than proof of missing captions', async () => {
  const h = page({ tracks: [
    { languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }
  ], entries: {} });
  const result = await h.read(true, false);
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
  const result = await h.read(true, false);
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
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'All right.');
  assert.equal(h.requested.length, 0);
});

test('an unnamed modern panel supplies all rendered segments despite an empty legacy panel', async () => {
  const lines = Array.from({ length: 561 }, (_, index) => [`${Math.floor((index + 1) / 60)}:${String((index + 1) % 60).padStart(2, '0')}`, `Line ${index + 1}`]);
  lines[0] = ['0:01', "yep can anybody people hear what i'm saying or you're good"];
  const h = page({ tracks: [], entries: {}, domTranscript: { modern: true, visible: true, language: 'English', lines } });
  const result = await h.read(true, false);
  assert.equal(h.panel.getAttribute('target-id'), null);
  assert.equal(result.body.length, 561);
  assert.equal(result.body[0].from, 1);
  assert.equal(result.body[0].content, lines[0][1]);
  assert.equal(result.body[560].from, 561);
  assert.equal(result.body[560].content, 'Line 561');
  assert.equal(h.requested.length, 0);
  assert.equal(h.state().clicks, 0);
});

test('expanded valid content wins over hidden content and other expanded panels with invalid segments', async () => {
  const hidden = page({ tracks: [], entries: {}, domTranscript: { visible: true, language: '中文', lines: [['0:01', '隐藏旧正文']] } }).panel;
  hidden.getAttribute = () => 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';
  const invalid = page({ tracks: [], entries: {}, domTranscript: { visible: true, language: '中文', lines: [['invalid', 'Invalid time'], ['0:01', ' ']] } }).panel;
  const h = page({ tracks: [], entries: {}, otherPanels: [hidden, invalid],
    domTranscript: { modern: true, visible: true, language: 'English', lines: [['0:07', 'Current panel']] } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Current panel');
  assert.equal(result.track.lan, 'en');
  assert.equal(h.requested.length, 0);
});

test('valid collapsed content is still usable when no expanded panel has a valid transcript', async () => {
  const h = page({ tracks: [], entries: {}, domTranscript: { modern: true, visible: true, language: 'English', lines: [['0:07', 'Retained transcript']] } });
  h.panel.getAttribute = () => 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Retained transcript');
  assert.equal(h.requested.length, 0);
});

test('opening the transcript can populate a modern panel without the old container', async () => {
  const h = page({ tracks: [], entries: {}, domTranscript: { modern: true, bodyAt: 900, language: 'English', lines: [['0:07', 'Newly opened panel']] } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Newly opened panel');
  assert.equal(h.state().clicks, 1);
  assert.equal(h.state().now, 900);
});

test('automatic retrieval accepts the available Chinese transcript panel', async () => {
  const h = page({
    tracks: [
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' },
      { languageCode: 'zh-CN', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' }
    ],
    entries: {},
    domTranscript: { language: '中文', lines: [['0:07', '你好']] }
  });
  const result = await h.read(true, false);
  assert.equal(result.track.lan, 'zh');
  assert.equal(result.body[0].content, '你好');
});

test('a ready video tab is preferred over another loading tab for the same video', async () => {
  const context = vm.createContext({ URL, setTimeout, clearTimeout, chrome: { tabs: { query: async () => [
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
  const context = vm.createContext({ URL, setTimeout, clearTimeout, chrome });
  vm.runInContext(source, context);
  return { context, chrome, reads: () => reads, fail: value => { fail = value; },
    read: purpose => context.youtubeRead(videoId, true, false, '', purpose) };
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

test('different videos and worker restarts cannot reuse a previous preview', async () => {
  const h = workerHarness();
  await h.read('preview');
  h.chrome.tabs.query = async () => [{ id: 2, url: 'https://www.youtube.com/watch?v=abcdef12345', status: 'complete' }];
  await h.context.youtubeRead('abcdef12345', true, false, '', 'import');
  assert.equal(h.reads(), 2);
  h.chrome.tabs.query = async () => [{ id: 2, url: `https://www.youtube.com/watch?v=${videoId}`, status: 'complete' }];
  await h.read('preview');
  const restarted = vm.createContext({ URL, setTimeout, clearTimeout, chrome: h.chrome });
  vm.runInContext(source, restarted);
  await restarted.youtubeRead(videoId, true, false, '', 'import');
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
    playlist: { playlistId, title: 'Deep Reinforcement Learning', ownerName: { simpleText: 'Course owner' }, contents: [
      { playlistPanelVideoRenderer: { videoId, title: { simpleText: 'Lecture 1' }, lengthSeconds: '2658' } },
      { playlistPanelVideoRenderer: { videoId: 'abcdef12345', title: { simpleText: 'Lecture 2' }, lengthSeconds: '6960' } }
    ] } });
  const result = await h.read(false, false, playlistId);
  assert.equal(result.meta.bvid, `YTPL_${playlistId}`);
  assert.equal(result.meta.title, 'Deep Reinforcement Learning');
  assert.equal(result.meta.author, 'Course owner');
  assert.equal(result.meta.currentVideo.title, 'Course video');
  assert.equal(result.meta.currentVideo.author, 'Teacher');
  assert.deepEqual([...result.meta.pages.map(item => item.cid)], [videoId, 'abcdef12345']);
  assert.equal(result.meta.pages[1].page, 2);
  const parsed = core.parseSource(`https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`);
  assert.equal(parsed.playlistId, playlistId);
});

function playlistData(id = 'PLKq1TCpsv3Y4', title = 'Current course', author = '') {
  return { playlistId: id, title, ownerName: author, contents: [
    { playlistPanelVideoRenderer: { videoId, title: { simpleText: 'Current lesson' }, navigationEndpoint: { watchEndpoint: { playlistId: id } } } }
  ] };
}

function playlistPanel({ id = 'PLKq1TCpsv3Y4', itemId = id, title = 'DOM course', author = '', videos = [videoId] } = {}) {
  const headerLink = { getAttribute: () => id ? `/playlist?list=${id}` : null };
  const heading = { textContent: title, querySelector: () => headerLink };
  return {
    querySelector: selector => selector === '#header-description .title, #header-description #title, #title' ? heading
      : selector === '#publisher-container' ? { textContent: author } : null,
    querySelectorAll: selector => selector === 'ytd-playlist-panel-video-renderer' ? videos.map((cid, i) => ({
      querySelector: selector => selector === 'a#wc-endpoint' ? { getAttribute: () => `/watch?v=${cid}&list=${itemId}` }
        : selector === '#video-title' ? { textContent: `DOM lesson ${i + 1}` } : null
    })) : []
  };
}

test('stale initial course is rejected as a whole even when it has more videos', async () => {
  const stale = playlistData('PLprevious123', 'Previous course', 'Previous owner');
  stale.contents.push({ playlistPanelVideoRenderer: { videoId: 'abcdef12345', title: { simpleText: 'Old lesson' } } });
  const h = page({ playlist: stale, playlistPanels: [playlistPanel({ author: 'DOM owner' })] });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.equal(result.meta.title, 'DOM course');
  assert.equal(result.meta.author, 'DOM owner');
  assert.equal(result.meta.pages.length, 1);
  assert.equal(result.meta.pages[0].part, 'DOM lesson 1');
  assert.equal(h.state().now, 0);
});

test('a longer foreign DOM list cannot contribute fields to a valid initial candidate', async () => {
  const h = page({ playlist: playlistData(), playlistPanels: [playlistPanel({ id: 'PLprevious123', author: 'Wrong owner', videos: [videoId, 'abcdef12345'] })] });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.equal(result.meta.title, 'Current course');
  assert.equal(result.meta.author, ''); // Never borrow the current video's uploader.
  assert.equal(result.meta.pages.length, 1);
  assert.equal(result.meta.pages[0].part, 'Current lesson');
});

test('matching but incomplete initial data cannot borrow a title from the DOM candidate', async () => {
  const h = page({ playlist: playlistData('PLKq1TCpsv3Y4', '', 'Initial owner'), playlistPanels: [playlistPanel()] });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.equal(result.meta.title, 'DOM course');
  assert.equal(result.meta.author, '');
  assert.equal(result.meta.pages[0].part, 'DOM lesson 1');
});

test('playlist identity is never manufactured from the URL and single-video title is not a fallback', async () => {
  for (const data of [playlistData(undefined, ''), { title: 'Looks like a course', contents: playlistData().contents }]) {
    const h = page({ playlist: data });
    const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
    assert.match(result.error, /暂时无法确认当前播放列表信息/);
    assert.equal(result.meta, undefined);
    assert.equal(h.state().now, 3000);
  }
});

test('DOM header and item identities must agree, even when both have plausible content', async () => {
  const h = page({ playlistPanels: [playlistPanel({ itemId: 'PLprevious123' })] });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.match(result.error, /暂时无法确认当前播放列表信息/);
  assert.equal(result.meta, undefined);
});

test('a missing DOM header link cannot inherit playlist identity from the current URL', async () => {
  const h = page({ playlistPanels: [playlistPanel({ id: null, itemId: 'PLKq1TCpsv3Y4' })] });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.match(result.error, /暂时无法确认当前播放列表信息/);
  assert.equal(result.meta, undefined);
});

test('initial playlist and entry identities must agree', async () => {
  const data = playlistData();
  data.contents[0].playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint.playlistId = 'PLprevious123';
  const result = await page({ playlist: data }).read(false, false, 'PLKq1TCpsv3Y4');
  assert.match(result.error, /暂时无法确认当前播放列表信息/);
});

test('waiting re-reads stale then incomplete data and returns as soon as the target course is ready', async () => {
  const h = page({ playlist: playlistData('PLprevious123', 'Old course'), onWait: (now, context) => {
    context.window.ytInitialData.contents.twoColumnWatchNextResults.playlist.playlist = playlistData('PLKq1TCpsv3Y4', now < 450 ? '' : 'Loaded course');
  } });
  const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
  assert.equal(result.meta.title, 'Loaded course');
  assert.equal(h.state().now, 450);
});

test('navigation during a pending playlist read discards the old request, including same-list video changes', async () => {
  for (const nextUrl of [`https://www.youtube.com/watch?v=${videoId}&list=PLdifferent123`, 'https://www.youtube.com/watch?v=abcdef12345&list=PLKq1TCpsv3Y4']) {
    const h = page({ playlist: playlistData('PLKq1TCpsv3Y4', ''), onWait: (now, context) => {
      context.location.href = nextUrl;
      context.window.ytInitialData.contents.twoColumnWatchNextResults.playlist.playlist = playlistData();
    } });
    const result = await h.read(false, false, 'PLKq1TCpsv3Y4');
    assert.match(result.error, /已切换视频或播放列表/);
    assert.equal(result.meta, undefined);
    assert.equal(h.state().now, 150);
  }
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
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'All right.');
  assert.equal(h.requested.length, 0);
});

test('metadata and preview reuse the same helper tab and later videos navigate only that helper', async () => {
  const session = {}, tabs = [];
  let creates = 0, updates = 0;
  const context = vm.createContext({ URL, setTimeout, clearTimeout, chrome: {
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values) } },
    tabs: {
      query: async () => tabs,
      get: async id => tabs.find(tab => tab.id === id),
      create: async options => { creates++; const tab = { id: creates, status: 'complete', ...options }; tabs.push(tab); return tab; },
      update: async (id, options) => { updates++; Object.assign(tabs.find(tab => tab.id === id), options); return tabs.find(tab => tab.id === id); }
    },
    scripting: { executeScript: async ({ args }) => [{ result: { meta: { videoId: args[0] }, ...(args[1] ? { track: { lan: 'en' }, body: [{ from: 7, content: 'All right.' }] } : {}) } }] }
  } });
  vm.runInContext(source, context);
  await context.youtubeRead(videoId, false);
  await context.youtubeRead(videoId, true);
  await context.youtubeRead('abcdef12345', true);
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
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Fast caption');
  assert.equal(playerStarted, true);
  assert.equal(playerAborted, true);
});

test('identical inline and player caption URLs are requested only once', async () => {
  const tracks = [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }];
  const h = page({ tracks, entries: {}, mobilePlayer: { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } },
    domTranscript: { language: 'English', lines: [['0:07', 'From the panel']] } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'From the panel');
  assert.equal(h.requested.filter(url => url.includes('/api/timedtext')).length, 1);
  assert.ok(h.requested.every(url => !url.includes('fmt=') && !url.includes('/get_transcript')));
});

test('reading video metadata does not probe captions when the player has no tracks', async () => {
  const h = page({ tracks: [], entries: {} });
  const result = await h.read(false, false);
  assert.equal(result.meta.title, 'Course video');
  assert.equal(h.requested.length, 0);
});

test('automatic YouTube retrieval prefers manual captions over ASR in the same language', async () => {
  const h = page({ tracks: [
    { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' },
    { vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr' }
  ], fetchOverride: async url => url.includes('/player') ? { ok: true, json: async () => null }
    : { ok: true, text: async () => JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: url.includes('kind=asr') ? 'Automatic' : 'Manual' }] }] }) } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Manual');
  assert.ok(h.requested.filter(url => url.includes('timedtext')).every(url => !url.includes('kind=asr')));
});

test('a refreshed player track list is available to the transcript fallback', async () => {
  const tracks = [{ vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' }];
  const h = page({ tracks: [], entries: {}, mobilePlayer: { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } },
    domTranscript: { language: 'English', lines: [['0:07', 'All right.']] } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'All right.');
});

test('automatic retrieval preserves the platform transcript language without switching it', async () => {
  for (const modern of [false, true]) {
    const h = page({ tracks: [
      { vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&exp=xpe' },
      { vssId: '.zh', languageCode: 'zh', name: { simpleText: '中文' }, baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh&exp=xpe' }
    ], entries: {}, domTranscript: { modern, visible: true, language: '中文', lines: [['0:07', '你好']],
      alternatives: [{ language: 'English', lines: [['0:07', 'All right.']] }] } });
    const result = await h.read(true, false);
    assert.equal(result.track.lan, 'zh');
    assert.equal(result.body[0].content, '你好');
    assert.equal(h.requested.length, 0);
  }
});

test('transcript fallback expands the description and returns as soon as valid text appears', async () => {
  const h = page({ tracks: [], entries: {}, domTranscript: {
    needsExpand: true, buttonAt: 600, bodyAt: 1200, loadingUntil: 16000,
    language: 'English', lines: [['0:07', 'Ready while the panel still changes.']]
  } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Ready while the panel still changes.');
  assert.deepEqual(h.state(), { now: 1200, clicks: 1, expanded: true });
});

test('an already visible valid transcript returns immediately despite a loading indicator', async () => {
  const h = page({ tracks: [], entries: {}, domTranscript: {
    visible: true, loadingUntil: 16000, completeAt: 15000,
    language: 'English', lines: [['0:07', 'Available now.'], ['0:20', 'A later addition.']]
  } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Available now.');
  assert.equal(h.state().now, 0);
  assert.equal(h.state().clicks, 0);
  assert.equal(h.requested.length, 0);
});

test('an open panel waits only until the first valid segments appear and is not clicked again', async () => {
  const h = page({ tracks: [], entries: {}, domTranscript: {
    visible: true, bodyAt: 1050, loadingUntil: 16000,
    language: 'English', lines: [['0:07', 'First line.'], ['0:20', 'Second line.']]
  } });
  const result = await h.read(true, false);
  assert.equal(result.body.length, 2);
  assert.equal(h.state().clicks, 0);
  assert.equal(h.state().now, 1050);
});

test('missing entry, ignored click and invalid body all exit within the same eight-second budget', async () => {
  for (const fixture of [
    { buttonAt: 12000, lines: [['0:07', 'Too late.']] },
    { ignoredClicks: 1, lines: [['0:07', 'Not opened.']] },
    { visible: true, lines: [['invalid', 'No valid timestamp.'], ['0:07', '  ']] }
  ]) {
    const h = page({ tracks: [], entries: {}, domTranscript: fixture });
    const result = await h.read(true, false);
    assert.match(result.error, /尚不能判定视频无字幕/);
    assert.equal(result.body, undefined);
    assert.equal(h.state().now, 8000);
    assert.ok(h.state().clicks <= 1);
  }
});

test('invalid existing transcript falls through to caption files without a DOM wait', async () => {
  const h = page({ tracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }],
    entries: { en: { events: [{ tStartMs: 1000, segs: [{ utf8: 'Caption fallback' }] }] } },
    domTranscript: { visible: true, language: 'English', lines: [['invalid', 'Not usable']] }
  });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Caption fallback');
  assert.equal(h.state().now, 0);
});

test('a reused page waits for its target video before reading transcript nodes', async () => {
  let h;
  h = page({ tracks: [], entries: {}, metadataNodes: {
    'ytd-watch-flexy': { getAttribute: () => h.state().now < 600 ? 'abcdef12345' : videoId }
  }, domTranscript: { visible: true, language: 'English', lines: [['0:07', 'Target page transcript']] } });
  const result = await h.read(true, false);
  assert.equal(result.body[0].content, 'Target page transcript');
  assert.equal(h.state().now, 600);
  assert.equal(h.state().clicks, 0);
});

test('batch imports activate before reading and reuse only the owned tab across videos', async () => {
  const originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const session = {}, tabs = [{ id: 1, active: false, status: 'complete', url: originalUrl }], reads = [];
  const update = (id, options) => {
    if (options.active) tabs.forEach(tab => { tab.active = false; });
    return Object.assign(tabs.find(tab => tab.id === id), options);
  };
  const context = vm.createContext({ URL, setTimeout, clearTimeout, chrome: {
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async data => Object.assign(session, data) } },
    tabs: {
      query: async () => tabs, get: async id => tabs.find(tab => tab.id === id), update: async (id, data) => update(id, data),
      create: async data => { const id = tabs.length + 1; tabs.push({ id, status: 'complete' }); return update(id, data); }
    },
    scripting: { executeScript: async ({ target, args }) => {
      const tab = tabs.find(tab => tab.id === target.tabId);
      assert.equal(tab.active, true);
      assert.equal(new URL(tab.url).searchParams.get('v'), args[0]);
      reads.push(target.tabId);
      return [{ result: { body: [{ from: 0, content: 'Read in active tab' }] } }];
    } }
  } });
  vm.runInContext(source, context);
  const read = id => context.youtubeRead(id, true, false, '', 'import', true);
  await read(videoId);
  await read('abcdef12345');
  await read('12345abcdef');
  assert.deepEqual(reads, [1, 2, 2]);
  assert.equal(tabs[0].url, originalUrl);
  tabs[1].url = 'https://example.com/user-navigation';
  await read('zyxwv987654');
  assert.equal(reads[3], 3);
  assert.equal(tabs[1].url, 'https://example.com/user-navigation');
});

test('metadata uses the current live player or validated page title without requesting player data', async () => {
  const live = page({ tracks: [], entries: {}, metadataNodes: {
    '#movie_player': { getVideoData: () => ({ video_id: videoId, title: 'Current live title', author: 'Teacher' }) }
  } });
  assert.equal((await live.read(false, false)).meta.title, 'Current live title');
  assert.equal(live.requested.length, 0);
  const og = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    'meta[property="og:url"]': { getAttribute: () => `https://www.youtube.com/watch?v=${videoId}` },
    'meta[property="og:title"]': { getAttribute: () => 'Page title' }
  } });
  assert.equal((await og.read(false, false)).meta.title, 'Page title');
  assert.equal(og.requested.length, 0);
  const stale = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    '#movie_player': { getVideoData: () => ({ video_id: 'abcdef12345', title: 'Wrong video' }) },
    'meta[property="og:url"]': { getAttribute: () => 'https://www.youtube.com/watch?v=abcdef12345' },
    'meta[property="og:title"]': { getAttribute: () => 'Wrong video' }
  } });
  assert.ok((await stale.read(false, false)).error);
});

test('metadata bypasses an unfinished subtitle read and uses the active tab without waiting for complete', async () => {
  const h = workerHarness();
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  h.chrome.scripting.executeScript = async ({ args, target, injectImmediately }) => {
    if (args[1]) { started(); await new Promise(resolve => { release = resolve; }); return [{ result: { body: [] } }]; }
    assert.equal(target.tabId, 3);
    assert.equal(injectImmediately, true);
    return [{ result: { meta: { title: 'Immediate metadata' } } }];
  };
  const body = h.read('preview');
  await waiting;
  h.chrome.tabs.query = async () => [
    { id: 2, active: false, status: 'complete', url: `https://www.youtube.com/watch?v=${videoId}` },
    { id: 3, active: true, status: 'loading', url: `https://www.youtube.com/watch?v=${videoId}` }
  ];
  try {
    const meta = await Promise.race([h.context.youtubeRead(videoId), new Promise(resolve => setImmediate(() => resolve(null)))]);
    assert.equal(meta?.meta.title, 'Immediate metadata');
  } finally { release(); await body; }
});

test('expired queued metadata does not navigate later and a subsequent read can succeed', async () => {
  let now = 0, release, calls = 0;
  const timers = [];
  class Clock extends Date { static now() { return now; } }
  const chrome = {
    tabs: { query: async () => [{ id: 2, status: 'complete', url: `https://www.youtube.com/watch?v=${videoId}` }] },
    scripting: { executeScript: async () => { calls++; await new Promise(resolve => { release = resolve; }); return [{ result: { body: [] } }]; } }
  };
  const context = vm.createContext({ URL, Date: Clock, chrome,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  vm.runInContext(source, context);
  const body = context.youtubeRead(videoId, true);
  await new Promise(setImmediate);
  const meta = context.youtubeRead('abcdef12345');
  const rejected = assert.rejects(meta, /视频信息读取超时/);
  await new Promise(setImmediate);
  now = 12000; timers[0](); await rejected;
  release(); await body; await new Promise(setImmediate);
  assert.equal(calls, 1);
  chrome.scripting.executeScript = async () => [{ result: { meta: { title: 'Retry works' } } }];
  assert.equal((await context.youtubeRead(videoId)).meta.title, 'Retry works');
});
