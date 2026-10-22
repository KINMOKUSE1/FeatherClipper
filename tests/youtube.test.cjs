const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../extension/shared/course.js');
const source = fs.readFileSync(path.join(__dirname, '../extension/background/youtube.js'), 'utf8');

const videoId = 'GWwL_pLuX-U';
function page({ audio = [], playlist = null, mobilePlayer = null, inlineOnly = false, noPlayer = false, fetchOverride = null, metadataNodes = {}, playlistPanels = [], onWait = null }) {
  const player = { videoDetails: { videoId, title: 'Course video', author: 'Teacher', lengthSeconds: '240' }, streamingData: { adaptiveFormats: audio } };
  const requested = []; let now = 0;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ URL, URLSearchParams, Date: Clock, AbortSignal, console: { debug() {} },
    location: { href: 'https://www.youtube.com/watch?v=' + videoId + (playlist || playlistPanels.length ? '&list=PLKq1TCpsv3Y4' : '') },
    window: { ytInitialPlayerResponse: inlineOnly || noPlayer ? undefined : player,
      ytInitialData: playlist ? { contents: { twoColumnWatchNextResults: { playlist: { playlist } } } } : {} },
    document: { title: 'Course video - YouTube', scripts: inlineOnly ? [{ textContent: 'var ytInitialPlayerResponse = ' + JSON.stringify(player) + ';' }] : [],
      querySelectorAll: selector => selector === 'ytd-playlist-panel-renderer' ? playlistPanels : [],
      querySelector: selector => metadataNodes[selector] || null },
    setTimeout: (callback, delay) => { now += delay; onWait?.(now, context); queueMicrotask(callback); },
    fetch: async (url, options) => { requested.push(String(url)); return fetchOverride ? fetchOverride(String(url), options) : { ok: true, json: async () => mobilePlayer }; }
  });
  vm.runInContext(source, context);
  return { read: (_includeBody, includeAudio = false, playlistId = '') => context.youtubePageRead(videoId, includeAudio, playlistId), requested, state: () => ({ now }) };
}

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

test('YouTube audio lookup keeps only direct Google video audio streams', async () => {
  const h = page({ tracks: [], entries: {}, audio: [
    { mimeType: 'video/mp4', url: 'https://x.googlevideo.com/video', bitrate: 100 },
    { mimeType: 'audio/webm', url: 'https://evil.test/audio', bitrate: 50 },
    { mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/audio', bitrate: 80 }
  ] });
  const result = await h.read(false, true);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/audio']);
});

test('audio lookup uses the current live player when SPA startup data is absent', async () => {
  const response = { videoDetails: { videoId, title: 'Live lesson', lengthSeconds: '180' },
    streamingData: { adaptiveFormats: [{ mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/live-audio' }] } };
  const h = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    '#movie_player': { getPlayerResponse: () => response,
      getVideoData: () => ({ video_id: videoId, title: 'Live lesson', author: 'Live teacher' }) }
  } });
  const result = await h.read(false, true);
  assert.equal(result.meta.title, 'Live lesson');
  assert.equal(result.meta.pages[0].duration, 180);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/live-audio']);
  assert.equal(h.requested.length, 0);
});

test('SABR adaptive audio can fall back to the live format 18 MP4 with AAC audio', async () => {
  const response = { videoDetails: { videoId, title: 'Current video' }, streamingData: {
    serverAbrStreamingUrl: 'https://x.googlevideo.com/sabr',
    adaptiveFormats: Array.from({ length: 8 }, (_, itag) => ({ mimeType: 'audio/webm; codecs="opus"', itag })),
    formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      url: 'https://x.googlevideo.com/muxed-18', bitrate: 300000 }]
  } };
  const h = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    '#movie_player': { getPlayerResponse: () => response }
  } });
  const result = await h.read(false, true);
  assert.equal(result.error, undefined);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/muxed-18']);
  assert.equal(h.requested.length, 0);
});

test('direct audio is preferred to muxed MP4 and video-only or foreign streams are excluded', async () => {
  const response = { videoDetails: { videoId, title: 'Current video' }, streamingData: {
    adaptiveFormats: [
      { mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/audio-high', bitrate: 128000 },
      { mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/audio-low', bitrate: 64000 }
    ],
    formats: [
      { mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', url: 'https://x.googlevideo.com/muxed', bitrate: 100 },
      { mimeType: 'video/mp4; codecs="avc1.42001E"', url: 'https://x.googlevideo.com/video-only' },
      { mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', url: 'https://googlevideo.com.evil.test/muxed' },
      { mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', signatureCipher: 'not-a-direct-url' }
    ]
  } };
  const h = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    '#movie_player': { getPlayerResponse: () => response }
  } });
  const result = await h.read(false, true);
  assert.deepEqual([...result.audioUrls], ['https://x.googlevideo.com/audio-low', 'https://x.googlevideo.com/audio-high', 'https://x.googlevideo.com/muxed']);
});

test('audio lookup rejects a live player response belonging to another video', async () => {
  const h = page({ noPlayer: true, tracks: [], entries: {}, metadataNodes: {
    '#movie_player': {
      getPlayerResponse: () => ({ videoDetails: { videoId: 'abcdef12345', title: 'Previous video' },
        streamingData: { adaptiveFormats: [{ mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/previous-audio' }] } }),
      getVideoData: () => ({ video_id: 'abcdef12345', title: 'Previous video' })
    }
  } });
  const result = await h.read(false, true);
  assert.match(result.error, /无法读取 YouTube 视频信息/);
  assert.equal(result.audioUrls, undefined);
});

test('SABR audio lookup avoids an unrelated mobile-client fallback even if it offers direct URLs', async () => {
  const h = page({ noPlayer: true, tracks: [], entries: {},
    mobilePlayer: { videoDetails: { videoId, title: 'API title' }, streamingData: {
      adaptiveFormats: [{ mimeType: 'audio/mp4', url: 'https://x.googlevideo.com/api-audio' }] } },
    metadataNodes: { '#movie_player': {
      getPlayerResponse: () => ({ videoDetails: { videoId, title: 'Live lesson' },
        streamingData: { serverAbrStreamingUrl: 'https://x.googlevideo.com/sabr', adaptiveFormats: [] } })
    } }
  });
  const result = await h.read(false, true);
  assert.equal(result.meta.title, 'Live lesson');
  assert.equal(result.sabr, true);
  assert.deepEqual([...result.audioUrls], []);
  assert.equal(h.requested.length, 0);
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

test('reading video metadata does not probe captions when the player has no tracks', async () => {
  const h = page({ tracks: [], entries: {} });
  const result = await h.read(false, false);
  assert.equal(result.meta.title, 'Course video');
  assert.equal(h.requested.length, 0);
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


test('metadata reads startup inline JSON without requiring a window global', async () => {
  const h = page({ inlineOnly: true });
  assert.equal((await h.read(false)).meta.title, 'Course video');
  assert.equal(h.requested.length, 0);
});

test('SABR-only live playback selects session download without mistaking it for missing metadata', async () => {
  const h = page({ noPlayer: true, tracks: [], entries: {},
    mobilePlayer: { videoDetails: { videoId, title: 'API title' }, streamingData: { adaptiveFormats: [] } },
    metadataNodes: { '#movie_player': {
      getPlayerResponse: () => ({ videoDetails: { videoId, title: 'Live lesson' },
        streamingData: { serverAbrStreamingUrl: 'https://x.googlevideo.com/sabr',
          adaptiveFormats: [{ mimeType: 'audio/webm', itag: 251 }] } }),
      getVideoData: () => ({ video_id: videoId, title: 'Live lesson' })
    } }
  });
  const result = await h.read(false, true);
  assert.equal(result.error, undefined);
  assert.equal(result.sabr, true);
  assert.deepEqual([...result.audioUrls], []);
});
