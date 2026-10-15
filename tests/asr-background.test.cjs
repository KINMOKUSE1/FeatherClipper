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
    fetch: async () => ({ ok: true, json: async () => ({ service: 'vid2notes-asr', version: 1, model_ready: true }) }),
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.connected, false);
  assert.equal(status.paired, true);
  assert.match(status.error, /旧版转写服务/);
});

test('saved connection code is reused after service restarts', async () => {
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.endsWith('/health')
      ? { service: 'vid2notes-asr', version: 1, model_ready: true, audio_backups: true }
      : { connected: true } }; },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.connected, true);
  assert.equal(status.paired, true);
  assert.deepEqual(Object.entries(requests.find(request => request.url.endsWith('/pair')).options.headers), [['X-Vid2Notes-Token', 'saved-token']]);
});

test('pairing is saved and reused by a new background worker', async () => {
  const saved = {};
  const token = 'a'.repeat(64);
  const chrome = { runtime: { onMessage: { addListener() {} } }, storage: { local: {
    get: async key => ({ [key]: saved[key] }),
    set: async values => Object.assign(saved, values),
  } } };
  const fetch = async url => ({ ok: true, json: async () => url.endsWith('/health')
    ? { service: 'vid2notes-asr', version: 1, model_ready: true, audio_backups: true }
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
      ? { ok: true, json: async () => ({ service: 'vid2notes-asr', version: 1, model_ready: true, audio_backups: true }) }
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
      ? { ok: true, json: async () => ({ service: 'vid2notes-asr', version: 1, model_ready: true, audio_backups: true }) }
      : { ok: false, status: 401, json: async () => ({ error: '连接码不正确。' }) },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({ asrToken: 'saved-token' }) } } },
  });
  vm.runInContext(source, context);
  const status = await context.asrStatus();
  assert.equal(status.needsPairing, true);
});

function onlineWorker(provider = 'groq', key = 'private-test-key', modelReady = false) {
  const saved = { asrToken: 'a'.repeat(64), asrSettings: { provider, keys: key ? { [provider]: key } : {} } };
  const requests = [];
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal,
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: {
      get: async key => ({ [key]: saved[key] }), set: async values => Object.assign(saved, values),
    } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/health')
        ? { service: 'vid2notes-asr', version: 1, model_ready: modelReady, audio_backups: true, providers: ['local', 'groq', 'siliconflow'] }
        : url.endsWith('/jobs') ? { id: 'b'.repeat(32), status: 'queued' } : { connected: true } };
    },
    courseBiliJson: async () => ({ data: { dash: { audio: [{ baseUrl: 'https://first.bilivideo.com/audio' }] } } }),
  });
  vm.runInContext(source, context);
  return { context, saved, requests };
}

test('online readiness does not require a Whisper model; public settings omit the key', async () => {
  const h = onlineWorker();
  const status = await h.context.asrStatus();
  assert.equal(status.connected, true);
  assert.equal(status.componentConnected, true);
  assert.equal(status.settings.hasApiKeys.groq, true);
  assert.equal(JSON.stringify(status).includes('private-test-key'), false);
  const local = onlineWorker('local', '', false);
  assert.equal((await local.context.asrStatus()).connected, false);
  assert.equal((await local.context.asrStatus()).componentConnected, true);
});

test('saving and switching engines keeps separate keys and never calls a cloud API', async () => {
  const h = onlineWorker();
  await h.context.asrSaveSettings({ provider: 'siliconflow', apiKey: 'silicon-key' });
  await h.context.asrSaveSettings({ provider: 'groq', apiKey: '' });
  assert.equal(h.saved.asrSettings.keys.groq, 'private-test-key');
  assert.equal(h.saved.asrSettings.keys.siliconflow, 'silicon-key');
  await h.context.asrSaveSettings({ provider: 'siliconflow', clearKey: true });
  assert.equal(h.saved.asrSettings.provider, 'groq');
  assert.equal(h.saved.asrSettings.keys.siliconflow, undefined);
  assert.equal(h.requests.length, 0);
});

test('a missing API key blocks online jobs before requesting audio', async () => {
  const h = onlineWorker('groq', '');
  assert.equal((await h.context.asrStatus()).connected, false);
  const count = h.requests.length;
  await assert.rejects(h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }), /API Key/);
  assert.equal(h.requests.length, count);
});

test('job submission sends only the selected key to the loopback service', async () => {
  const h = onlineWorker();
  h.saved.asrSettings.keys.siliconflow = 'other-service-key';
  await h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }, 'groq');
  const request = h.requests.find(request => request.url.endsWith('/jobs'));
  const data = JSON.parse(request.options.body);
  assert.equal(data.provider, 'groq');
  assert.equal(data.api_key, 'private-test-key');
  assert.equal(request.options.body.includes('other-service-key'), false);
  assert.equal(request.url, 'http://127.0.0.1:27347/jobs');
  await assert.rejects(h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }, 'siliconflow'), /引擎已修改/);
});
