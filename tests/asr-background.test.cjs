const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../extension/background/transcription.js'), 'utf8');

test('local transcription receives Bilibili backup audio addresses', async () => {
  const context = vm.createContext({
    URL, URLSearchParams,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    courseBiliJson: async () => ({ data: { dash: { audio: [
      { bandwidth: 100, baseUrl: 'https://first.bilivideo.com/audio', backupUrl: ['https://backup.bilivideo.com/audio'] },
      { bandwidth: 200, baseUrl: 'https://large.bilivideo.com/audio' },
    ] } } }),
  });
  vm.runInContext(source, context);
  const urls = await context.asrAudioUrls({ bvid: 'BV123' }, { cid: '456' });
  assert.deepEqual([...urls], ['https://first.bilivideo.com/audio', 'https://backup.bilivideo.com/audio']);
});

test('local transcription uses YouTube audio found on the video page', async () => {
  const context = vm.createContext({ URL, URLSearchParams,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    youtubeRead: async () => ({ audioUrls: ['https://rr1.googlevideo.com/audio'] }),
  });
  vm.runInContext(source, context);
  const urls = await context.asrAudioUrls({ platform: 'youtube', videoId: 'GWwL_pLuX-U' }, { cid: 'GWwL_pLuX-U' });
  assert.deepEqual([...urls], ['https://rr1.googlevideo.com/audio']);
});

test('running old local service asks for restart before transcription', async () => {
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ service: 'course-cove-asr', version: 1, model_ready: true }) }),
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.connected, false);
  assert.equal(status.paired, true);
  assert.match(status.error, /旧版转写服务/);
});

test('saved connection code is reused after service restarts', async () => {
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/health')
      ? { service: 'course-cove-asr', version: 1, model_ready: true, audio_backups: true }
      : { connected: true } }),
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.connected, true);
  assert.equal(status.paired, true);
});

test('pairing is saved and reused by a new background worker', async () => {
  const saved = {};
  const token = 'a'.repeat(64);
  const chrome = { runtime: { onMessage: { addListener() {} } }, storage: { local: {
    get: async key => ({ [key]: saved[key] }),
    set: async values => Object.assign(saved, values),
  } } };
  const fetch = async url => ({ ok: true, json: async () => url.endsWith('/health')
    ? { service: 'course-cove-asr', version: 1, model_ready: true, audio_backups: true }
    : { connected: true } });
  const createWorker = () => {
    const context = vm.createContext({ URL, URLSearchParams, AbortSignal, fetch, chrome });
    vm.runInContext(source, context);
    return context;
  };
  await createWorker().asrPair(token);
  assert.equal(saved.asrToken, token);
  const status = await createWorker().asrStatus();
  assert.equal(status.connected, true);
  assert.equal(status.needsPairing, undefined);
});

test('temporary connection failure does not ask for the saved code again', async () => {
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    fetch: async url => url.endsWith('/health')
      ? { ok: true, json: async () => ({ service: 'course-cove-asr', version: 1, model_ready: true, audio_backups: true }) }
      : { ok: false, status: 503, json: async () => ({ error: '暂时不可用' }) },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.paired, true);
  assert.equal(status.needsPairing, false);
});

test('only a rejected saved code asks for pairing again', async () => {
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    fetch: async url => url.endsWith('/health')
      ? { ok: true, json: async () => ({ service: 'course-cove-asr', version: 1, model_ready: true, audio_backups: true }) }
      : { ok: false, status: 401, json: async () => ({ error: '连接码不正确。' }) },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.needsPairing, true);
});
