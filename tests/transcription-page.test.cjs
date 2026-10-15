const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/shared/course.js');
const ui = require('../extension/shared/ui-text.js');
const source = fs.readFileSync(require.resolve('../extension/workbench/transcription/page.js'), 'utf8');

function boot(provider = 'local', ready = true, stopDuringUpload = false) {
  const elements = new Map(), calls = [], progress = [], previews = [];
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'folder' ? 'Clippings/Bilibili' : id === 'asr-provider' ? 'local' : '',
      hidden: false, handlers: {}, classList: { toggle() {} }, addEventListener(event, handler) { this.handlers[event] = handler; } });
    return elements.get(id);
  };
  const settings = { provider, hasApiKeys: { groq: provider === 'groq', siliconflow: provider === 'siliconflow' } };
  const page = { cid: '456', page: 1, part: 'Lesson', selected: true, status: 'missing' };
  const state = { meta: { bvid: 'BV123', pages: [page] }, pages: [page], activeAsrPage: page, stopping: false };
  let polls = 0;
  const context = vm.createContext({ UiText: ui, window: {}, document: { getElementById: get }, CourseCore: core,
    createNoteControls: () => ({ decorateSelect() {} }),
    navigator: { locks: { request: async (name, options, callback) => callback({}) } },
    setTimeout: callback => callback(),
  });
  vm.runInContext(source, context);
  const controller = context.window.createTranscriptionPage({
    getCatalog: () => ({ getState: () => state, setImporting: value => { state.running = value; },
      persist: async () => {}, updateIndex: async () => {}, render() {}, request: async (action, data) => {
        calls.push([action, data]);
        if (action === 'asr-start') return { id: 'job' };
        if (action === 'asr-poll') return { status: polls++ === 0 ? 'uploading' : 'done', timestamps: provider !== 'siliconflow' };
        if (action === 'asr-finish') return { status: 'saved', body: [{ content: 'Original' }], track: { timestamps: provider !== 'siliconflow' } };
        if (action === 'asr-cancel') return { status: 'stopping' };
        throw new Error('Unexpected action');
      } }),
    send: async message => {
      calls.push([message.type, message]);
      if (message.type === 'asr-status') return { connected: ready, componentConnected: true, paired: true,
        provider: settings.provider, settings: structuredClone(settings), youtubeAudio: true };
      if (message.type === 'asr-settings-save') {
        const draft = message.settings;
        if (draft.clearKey) settings.hasApiKeys[draft.provider] = false;
        else { settings.provider = draft.provider; if (draft.apiKey) settings.hasApiKeys[draft.provider] = true; }
        return { settings: structuredClone(settings) };
      }
      return {};
    },
    feedback: { status() {}, settings: (...args) => calls.push(['feedback', ...args]) },
    navigate: target => calls.push(['navigate', target]),
    importAction: { progress: (...args) => { progress.push(args); if (stopDuringUpload && args[2] === ui.transcription.stages.uploading) state.stopping = true; },
      result: (...args) => calls.push(['result', ...args]) },
    previewView: { message() {}, transcript: (...args) => previews.push(args) },
  });
  return { controller, get, state, calls, progress, previews };
}

test('engine selection shows only applicable fields; save never starts a transcription', async () => {
  const h = boot();
  await h.controller.open();
  assert.equal(h.get('asr-key-row').hidden, true);
  h.get('asr-provider').value = 'groq';
  h.get('asr-provider').handlers.change();
  assert.equal(h.get('asr-key-row').hidden, false);
  assert.match(h.get('asr-provider-help').textContent, /上传/);
  h.get('asr-api-key').value = 'example-key';
  await h.get('asr-connect').handlers.click();
  assert.equal(h.calls.some(([action]) => action === 'asr-start'), false);
  assert.equal(h.get('asr-api-key').value, '');
  assert.match(h.get('asr-api-key').placeholder, /已保存/);
});

test('missing configuration navigates to setup without requesting audio', async () => {
  const h = boot('groq', false);
  await h.controller.run(h.state.pages);
  assert.equal(h.calls.some(([action]) => action === 'asr-start'), false);
  assert.ok(h.calls.some(([action, target]) => action === 'navigate' && target === 'asr-page'));
});

test('online queue freezes the engine and renders plain text without timestamps', async () => {
  const h = boot('siliconflow');
  await h.controller.run(h.state.pages);
  assert.equal(h.calls.find(([action]) => action === 'asr-start')[1].provider, 'siliconflow');
  assert.equal(h.state.pages[0].status, 'saved');
  assert.equal(h.previews[0][3], false);
  assert.ok(h.progress.some(([, , stage]) => stage === ui.transcription.stages.uploading));
  assert.equal(h.state.running, false);
});

test('canceling an online request prevents import and reports possible cloud processing', async () => {
  const h = boot('groq', true, true);
  await h.controller.run(h.state.pages);
  assert.ok(h.calls.some(([action]) => action === 'asr-cancel'));
  assert.equal(h.calls.some(([action]) => action === 'asr-finish'), false);
  assert.equal(h.state.pages[0].status, 'missing');
  assert.ok(h.calls.find(([action]) => action === 'result').includes(ui.transcription.cancelCloud));
});
