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
  const requests = [], messages = [], rules = [];
  let documentOpen = false, documentCreates = 0;
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, crypto: require('node:crypto').webcrypto,
    chrome: { runtime: { id: 'unit', getURL: file => `chrome-extension://unit/${file}`, onMessage: { addListener() {} },
      getContexts: async () => documentOpen ? [{}] : [],
      sendMessage: async message => { messages.push(message); return { ok: true, id: message.id, status: message.action === 'cancel' ? 'canceled' : 'queued', empty: message.action === 'forget' }; },
    }, offscreen: { createDocument: async () => { documentOpen = true; documentCreates++; }, closeDocument: async () => { documentOpen = false; } },
    declarativeNetRequest: { updateSessionRules: async value => rules.push(value) }, storage: { local: {
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background/online-transcription.js'), 'utf8'), context);
  vm.runInContext(source, context);
  return { context, saved, requests, messages, rules, get documentCreates() { return documentCreates; } };
}

test('online readiness does not require a Whisper model; public settings omit the key', async () => {
  const h = onlineWorker();
  const status = await h.context.asrStatus();
  assert.equal(status.connected, true);
  assert.equal(status.componentConnected, undefined);
  assert.equal(status.settings.hasApiKeys.groq, true);
  assert.equal(JSON.stringify(status).includes('private-test-key'), false);
  assert.equal(h.requests.length, 0, 'online status never checks localhost');
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

test('online jobs need no pairing code and send only the selected key to the extension worker', async () => {
  const h = onlineWorker();
  delete h.saved.asrToken;
  h.saved.asrSettings.keys.siliconflow = 'other-service-key';
  await h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }, 'groq');
  const data = h.messages.find(message => message.action === 'start');
  assert.equal(data.provider, 'groq');
  assert.equal(data.apiKey, 'private-test-key');
  assert.equal(JSON.stringify(data).includes('other-service-key'), false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.rules[0].addRules[0].condition.initiatorDomains[0], 'unit');
  await assert.rejects(h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }, 'siliconflow'), /引擎已修改/);
});

test('online polling and cancellation stay inside the extension; offscreen creation is serialized', async () => {
  const h = onlineWorker();
  const jobs = await Promise.all([h.context.asrStart({ bvid: 'BV123' }, { cid: '456' }), h.context.asrStart({ bvid: 'BV123' }, { cid: '789' })]);
  assert.equal(h.documentCreates, 1);
  await h.context.asrPoll(jobs[0].id);
  assert.equal((await h.context.asrCancel(jobs[0].id)).status, 'canceled');
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.messages.slice(-2).map(message => message.action), ['poll', 'cancel']);
});
