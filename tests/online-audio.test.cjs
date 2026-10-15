const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const audio = require('../extension/transcription/audio.js');

test('WAV slices preserve samples, offsets, channel mixing and the last partial chunk', async () => {
  const channels = [new Float32Array([-1, -.5, 0, .5, 1]), new Float32Array([-1, .5, 0, .5, 1])];
  const buffer = { sampleRate: 16000, numberOfChannels: 2, getChannelData: i => channels[i] };
  const bytes = new DataView(await audio.wavChunk(buffer, 1, 5).arrayBuffer());
  assert.equal(bytes.byteLength, 44 + 4 * 2);
  assert.equal(bytes.getUint32(24, true), 16000);
  assert.equal(bytes.getUint16(22, true), 1);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => bytes.getInt16(44 + i * 2, true)), [0, 0, 16384, 32767]);
});

test('Groq offsets timestamps; plain text never invents timestamps', () => {
  assert.deepEqual(audio.normalizeResult('groq', { segments: [{ start: 1.2, end: 3.4, text: ' original ' }] }, 120, 60),
    [{ from: 121.2, to: 123.4, content: 'original' }]);
  assert.deepEqual(audio.normalizeResult('siliconflow', { text: ' original ' }, 120, 60), [{ content: 'original' }]);
  assert.throws(() => audio.normalizeResult('groq', { segments: [{ start: -1, end: 2, text: 'bad' }] }, 0, 60));
});

test('media downloads use the backup URL and never include credentials', async t => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: false };
    const response = new Response(new Uint8Array([1, 2, 3]));
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  const bytes = await audio.download(['https://first.bilivideo.com/audio', 'https://backup.bilivideo.com/audio'], new AbortController().signal);
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  assert.ok(calls.every(call => call.options.credentials === 'omit'));
  await assert.rejects(audio.download(['https://bilivideo.com.evil.test/audio'], new AbortController().signal));
});

test('cloud request is a multipart WAV upload and auth failures do not disclose its key', async t => {
  let requests = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(options.body.get('response_format'), 'verbose_json');
    assert.equal(options.body.get('file').type, 'audio/wav');
    assert.equal(options.redirect, 'error');
    return new Response('{}', { status: 401 });
  });
  await assert.rejects(audio.request('groq', 'private-key', new Blob(['audio'], { type: 'audio/wav' }), new AbortController().signal, () => {}),
    error => /API Key/.test(error.message) && !error.message.includes('private-key'));
  assert.equal(requests, 1);
});

test('an uncertain network failure is not retried; a canceled request does not become a successful result', async t => {
  let requests = 0;
  t.mock.method(global, 'fetch', async () => { requests++; throw new Error('network'); });
  await assert.rejects(audio.request('siliconflow', 'key', new Blob(['audio']), new AbortController().signal, () => {}), /网络/);
  assert.equal(requests, 1);
  const controller = new AbortController();
  t.mock.method(global, 'fetch', async () => { controller.abort(); return Response.json({ text: 'late result' }); });
  await assert.rejects(audio.request('siliconflow', 'key', new Blob(['audio']), controller.signal, () => {}), { name: 'AbortError' });
});

test('429 retries are bounded and waiting can be canceled', async t => {
  let requests = 0;
  t.mock.method(global, 'fetch', async () => { requests++; return new Response('', { status: 429, headers: { 'Retry-After': '1' } }); });
  const controller = new AbortController();
  const task = audio.request('groq', 'key', new Blob(['audio']), controller.signal, () => controller.abort());
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(audio.request('groq', 'key', new Blob(['audio']), new AbortController().signal, () => {}), /上限/);
  assert.equal(requests, 3);
});

function worker(transcribe) {
  let listener;
  const runtime = { id: 'unit', getURL: file => `chrome-extension://unit/${file}`, onMessage: { addListener: fn => { listener = fn; } } };
  const context = vm.createContext({ OnlineAudio: { ...audio, transcribe }, chrome: { runtime }, AbortController });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/transcription/worker.js'), 'utf8'), context);
  const send = (message, sender = { id: 'unit' }) => {
    let response;
    listener({ target: 'online-asr', ...message }, sender, value => { response = value; });
    return response;
  };
  return { context, send };
}

test('offscreen jobs retain results across polling without exposing URLs or keys; duplicates share a job', async () => {
  let calls = 0;
  const h = worker(async input => { calls++; return { body: [{ content: 'original' }], timestamps: false }; });
  const input = { action: 'start', id: 'online-' + 'a'.repeat(32), bvid: 'BV123', cid: '456', provider: 'siliconflow',
    urls: ['https://test.bilivideo.com/audio'], apiKey: 'private-key' };
  const first = h.send(input), duplicate = h.send({ ...input, id: 'online-' + 'b'.repeat(32) });
  assert.equal(first.id, duplicate.id);
  await vm.runInContext('queue', h.context);
  const result = h.send({ action: 'poll', id: first.id });
  assert.equal(result.status, 'done');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.equal(JSON.stringify(result).includes('bilivideo'), false);
  assert.equal(h.send({ action: 'forget', id: first.id }).empty, true);
  assert.equal(h.send(input, { id: 'foreign' }), undefined);
  assert.equal(h.send(input, { id: 'unit', url: 'chrome-extension://unit/popup/index.html' }), undefined);
});

test('cancel stops the active upload and a restart creates a new task', async () => {
  const h = worker(async (input, signal) => { await audio.pause(10000, signal); return {}; });
  const input = { action: 'start', id: 'online-' + 'a'.repeat(32), bvid: 'BV123', cid: '456', provider: 'groq',
    urls: ['https://test.bilivideo.com/audio'], apiKey: 'key' };
  h.send(input); await Promise.resolve();
  assert.equal(h.send({ action: 'cancel', id: input.id }).status, 'canceled');
  await vm.runInContext('queue', h.context);
  const next = h.send({ ...input, id: 'online-' + 'b'.repeat(32) });
  assert.notEqual(next.id, input.id);
  h.send({ action: 'cancel', id: next.id });
  await vm.runInContext('queue', h.context);
});
