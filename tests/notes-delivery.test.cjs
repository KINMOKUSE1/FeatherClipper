const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const generator = require('../extension/workbench/notes/generator.js');
const files = require('../extension/workbench/notes/files.js');
const copy = require('../extension/shared/ui-text.js');

function boot(environment = 'web') {
  const nodes = new Map(), downloads = [], clipboard = [], messages = [], blobs = new Map();
  function element() {
    return { hidden: true, disabled: false, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {}, remove() {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const resources = Object.fromEntries([['entry','SKILL.md'],['agent','openai.yaml'],['workflow','workflow.md'],['tasks','tasks.md']].map(([key,file]) => [key,fs.readFileSync(require.resolve(`../extension/workbench/notes/rules/${file}`),'utf8')]));
  const model = { config: generator.defaults(), delivery: { ...generator.deliveryDefaults(), environment }, resources,
    installedSnapshot: null, installationKey: 'test-install', uploadedMaterials: [], uploadedReferences: [] };
  const material = { label: 'P1 TCP', chapter: '1', fileName: '素材/P01-TCP.md', path: '素材/P01-TCP.md', content: '第一份实际字幕' };
  let materialReads = 0;
  const snapshot = () => JSON.stringify({ config: model.config, delivery: model.delivery, references: model.uploadedReferences });
  const skillSnapshot = () => JSON.stringify(generator.buildFiles(model.config, resources));
  const window = { NoteGenerator: generator, NoteFiles: files, parent: {},
    collectNoteMaterials: async ({ delivery }) => { materialReads++; return { course: '网络', materials: [{ ...material }], references: ['supplement','continue','review'].includes(delivery.task) ? model.uploadedReferences : [] }; } };
  const context = vm.createContext({ window, UiText: copy, CourseCore: { safeName: value => value },
    document: { getElementById: get, body: { append() {} } }, structuredClone, Blob,
    navigator: { clipboard: { writeText: async value => clipboard.push(value) } },
    localStorage: { setItem() {}, removeItem() {} }, setTimeout: () => 1,
    URL: { createObjectURL(blob) { const key = `blob:${blobs.size}`; blobs.set(key,blob); return key; }, revokeObjectURL() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/workbench/notes/delivery.js'),'utf8'),context);
  window.createNotesDelivery({ model, catalog: {}, feedback: { settings: (_,message) => messages.push(message) }, element,
    read: () => model.config, save: async () => generator.validate(model.config),
    ready: () => model.installedSnapshot === skillSnapshot(), skillSnapshot, webSnapshot: snapshot,
    updateDelivery() {}, refreshPreview() {}, previewTask() { throw new Error('Copy must not open the preview'); } });
  return { model, material, get, downloads, clipboard, messages, reads: () => materialReads };
}

test('web copy exports current material and pairs it with the current task without a prior export', async () => {
  const h = boot();
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads.length,1);
  assert.equal(h.downloads[0].name,'课程任务材料.md');
  assert.match(await h.downloads[0].blob.text(),/第一份实际字幕/);
  assert.match(h.clipboard[0],/整理笔记/);
  assert.equal(h.messages.at(-1),copy.notes.copiedWeb);

  h.model.delivery.task = 'translate'; h.material.content = '切换后的实际字幕';
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.reads(),2);
  const exported = await h.downloads[1].blob.text();
  assert.match(exported,/切换后的实际字幕/); assert.doesNotMatch(exported,/第一份实际字幕/);
  assert.match(exported,/本次任务：翻译字幕/); assert.match(h.clipboard[1],/翻译字幕/);
  assert.equal(h.get('copy-study-prompt').disabled,false);
});

test('supplement and continue require actual reference content before copying or downloading', async () => {
  const h = boot();
  for (const task of ['supplement','continue']) {
    h.model.delivery.task = task;
    await h.get('copy-study-prompt').handlers.click();
    assert.match(h.messages.at(-1),/请上传已有笔记或整理进度/);
  }
  assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
  h.model.uploadedReferences = [{ fileName: '已有笔记/原笔记.md', content: '已完成 TCP，保留我的批注' }];
  await h.get('copy-study-prompt').handlers.click();
  assert.match(await h.downloads[0].blob.text(),/已完成 TCP，保留我的批注/);
  assert.match(h.clipboard[0],/继续整理/);
});

test('web ZIP export remains available separately and does not copy a command', async () => {
  const h = boot(); h.model.delivery.format = 'zip';
  await h.get('builder-export-web').handlers.click();
  assert.equal(h.downloads[0].name,'course-web-task.zip');
  assert.equal(h.downloads[0].blob.type,'application/zip');
  assert.equal(h.clipboard.length,0);
});

test('local installation downloads first and only copies after explicit installation confirmation', async () => {
  const h = boot('local');
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads[0].name,'course-notes.zip');
  assert.equal(h.clipboard.length,0); assert.equal(h.model.installedSnapshot,null);
  h.get('builder-confirm-installed').handlers.click();
  await h.get('copy-study-prompt').handlers.click();
  assert.match(h.clipboard[0],/请使用 course-notes/);
  assert.equal(h.downloads.length,1);
  assert.equal(h.reads(),1);
});
