const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const sabr = require('../extension/transcription/sabr/audio.js');
const audio = require('../extension/transcription/audio.js');
const wire = vm.runInNewContext(fs.readFileSync(require.resolve('../extension/transcription/sabr/vendor.js'), 'utf8') + '\nVid2NotesSabr', { TextEncoder, TextDecoder });
function fixture() {
  const request = wire.VideoPlaybackAbrRequest.decode(new Uint8Array());
  request.videoPlaybackUstreamerConfig = new Uint8Array([1]);
  request.streamerContext = { poToken: new Uint8Array(17), clientInfo: { clientName: 1, clientVersion: 'synthetic-test' },
    sabrContexts: [], unsentSabrContexts: [] };
  return { videoId: 'PaEcQmgEz78', url: 'https://test.googlevideo.com/videoplayback?test=synthetic',
    request: Array.from(wire.VideoPlaybackAbrRequest.encode(request).finish()), durationMs: 876000, formats: [{ itag: 140, mimeType: 'audio/mp4' }] };
}

test('SABR sessions validate their video, media host, request bytes and duration', () => {
  const input = fixture(); assert.equal(sabr.validSession(input), true);
  for (const change of [{ url: 'https://test.googlevideo.com.evil.test/videoplayback' }, { url: 'http://test.googlevideo.com/videoplayback' },
    { request: [-1] }, { request: [256] }, { videoId: 'another-id' }, { durationMs: 0 }]) assert.equal(sabr.validSession({ ...input, ...change }), false);
});

test('duration check accepts codec padding and rejects a partial SABR prebuffer', () => {
  sabr.assertDuration(876.1120625, 876000);
  assert.throws(() => sabr.assertDuration(70, 876000), /下载不完整/);
  assert.throws(() => sabr.assertDuration(NaN, 876000), /下载不完整/);
});

function downloadHarness(mode) {
  let aborts = 0;
  class Stream {
    constructor(config) { this.config = config; this.listeners = {}; }
    on(name, callback) { this.listeners[name] = callback; }
    start() {
      return { audioStream: new ReadableStream({ start: controller => {
        this.controller = controller;
        queueMicrotask(() => {
          if (mode === 'rejected') this.listeners.streamProtectionStatusUpdate({ status: 3 });
          else if (mode === 'pending') for (let i = 0; i < 3; i++) this.listeners.streamProtectionStatusUpdate({ status: 2 });
          else if (mode === 'data') { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); }
        });
      } }) };
    }
    abort() { aborts++; try { this.controller?.error(new Error('stopped')); } catch {} }
  }
  const context = vm.createContext({ module: { exports: {} }, Vid2NotesSabr: { ...wire, SabrStream: Stream },
    Uint8Array, URL, crypto: webcrypto, btoa, AbortController, AbortSignal, Blob, setTimeout, clearTimeout, ReadableStream });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/transcription/sabr/audio.js'), 'utf8'), context);
  return { download: context.module.exports.download, aborts: () => aborts };
}

test('SABR protection rejection and repeated pending status stop instead of accepting partial audio', async () => {
  for (const mode of ['rejected', 'pending']) {
    const h = downloadHarness(mode);
    await assert.rejects(h.download(fixture(), new AbortController().signal), /播放校验已失效/);
    assert.ok(h.aborts() > 0);
  }
});

test('SABR download cancellation interrupts its reader and releases the protocol stream', async () => {
  const h = downloadHarness('wait'), controller = new AbortController();
  const pending = h.download(fixture(), controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(h.aborts() > 0);
  assert.deepEqual([...new Uint8Array(await downloadHarness('data').download(fixture(), new AbortController().signal))], [1, 2, 3]);
});

test('partial decoded SABR audio is rejected before any cloud upload', async () => {
  let uploads = 0;
  const context = vm.createContext({ module: { exports: {} }, SabrAudio: { download: async () => new ArrayBuffer(3), assertDuration: sabr.assertDuration },
    OfflineAudioContext: class { async decodeAudioData() { return { duration: 70 }; } }, fetch: () => { uploads++; }, AbortSignal });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/transcription/audio.js'), 'utf8'), context);
  await assert.rejects(context.module.exports.transcribe({ provider: 'siliconflow', apiKey: 'synthetic', sabr: fixture() }, new AbortController().signal, () => {}), /下载不完整/);
  assert.equal(uploads, 0);
});

test('request observer collects only the owned helper tab and excludes canceled tasks', () => {
  let observe;
  const context = vm.createContext({ chrome: { webRequest: { onBeforeRequest: { addListener: fn => { observe = fn; } } }, runtime: { onMessage: { addListener() {} } } }, Uint8Array });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background/youtube-audio.js'), 'utf8'), context);
  vm.runInContext('youtubeAudioSessions.set("job", {tabId: 7, canceled: false})', context);
  const request = tabId => ({ tabId, url: 'https://test.googlevideo.com/videoplayback', requestBody: { raw: [{ bytes: new Uint8Array([1, 2]).buffer }] } });
  observe(request(8)); assert.equal(vm.runInContext('youtubeAudioSessions.get("job").candidate', context), undefined);
  observe(request(7)); assert.equal(vm.runInContext('youtubeAudioSessions.get("job").candidate.body.length', context), 2);
  vm.runInContext('youtubeAudioSessions.get("job").candidate = undefined; youtubeAudioSessions.get("job").canceled = true', context);
  observe(request(7)); assert.equal(vm.runInContext('youtubeAudioSessions.get("job").candidate', context), undefined);
});

test('YouTube source acquisition is part of the offscreen job and cancellation cannot upload a late session', async () => {
  let listener, resolveSource, transcribed = 0;
  const messages = [];
  const runtime = { id: 'unit', getURL: file => `chrome-extension://unit/${file}`, onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: message => { messages.push(message); return message.action === 'read' ? new Promise(resolve => { resolveSource = resolve; }) : Promise.resolve({ ok: true }); } };
  const context = vm.createContext({ chrome: { runtime }, AbortController, OnlineAudio: { ...audio, transcribe: async () => { transcribed++; return {}; } } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/transcription/worker.js'), 'utf8'), context);
  const send = message => { let result; listener({ target: 'online-asr', ...message }, { id: 'unit' }, value => { result = value; }); return result; };
  const id = 'online-' + 'a'.repeat(32);
  assert.equal(send({ action: 'start', id, bvid: 'YT_PaEcQmgEz78', cid: 'PaEcQmgEz78', youtubeVideoId: 'PaEcQmgEz78', provider: 'siliconflow', urls: [], apiKey: 'synthetic' }).ok, true);
  await Promise.resolve();
  send({ action: 'cancel', id });
  resolveSource({ ok: true, source: { sabr: fixture() } });
  await vm.runInContext('queue', context);
  assert.equal(send({ action: 'poll', id }).status, 'canceled');
  assert.equal(messages.at(-1).action, 'cancel');
  assert.equal(transcribed, 0);
  assert.equal(JSON.stringify(send({ action: 'poll', id })).includes('synthetic'), false);
});
