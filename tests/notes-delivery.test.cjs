const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const generator = require('../extension/workbench/notes/generator.js');
const files = require('../extension/workbench/notes/files.js');
const copy = require('../extension/shared/ui-text.js');

function boot(environment = 'web', directoryPicker = false) {
  const nodes = new Map(), downloads = [], clipboard = [], messages = [], blobs = new Map(), storage = new Map(), previews = [], written = new Map();
  const control = { clipboardError: null, beforeClipboard: null, beforeMaterial: null, directoryCalls: 0, writeError: null };
  function element() {
    return { hidden: true, disabled: false, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {}, remove() {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const resources = Object.fromEntries([['entry','SKILL.md'],['agent','openai.yaml'],['workflow','workflow.md'],['tasks','tasks.md'],['mermaid','mermaid.md']].map(([key,file]) => [key,fs.readFileSync(require.resolve(`../extension/workbench/notes/rules/${file}`),'utf8')]));
  const model = { config: generator.defaults(), delivery: { ...generator.deliveryDefaults(), environment }, resources,
    installedSnapshot: null, exportedSkillSnapshot: null, installationKey: 'test-install', installationMethodKey: 'test-method', exportedSkillKey: 'test-export',
    busy: false, readingFiles: 0, uploadedMaterials: [], uploadedReferences: [] };
  const material = { label: 'P1 TCP', chapter: '1', fileName: '素材/P01-TCP.md', path: '素材/P01-TCP.md', content: '第一份实际字幕' };
  let materialReads = 0;
  const snapshot = () => JSON.stringify({ config: model.config, delivery: model.delivery, references: model.uploadedReferences });
  const skillSnapshot = () => JSON.stringify(generator.buildFiles(model.config, resources));
  const ready = () => model.installedSnapshot === skillSnapshot();
  function directory(prefix = '') {
    return { name: prefix ? 'course-notes' : 'skills', getDirectoryHandle: async name => directory(prefix + name + '/'),
      getFileHandle: async name => ({createWritable: async () => ({write: async value => {if (control.writeError) throw control.writeError; written.set(prefix + name,value);},close:async () => {}}),
        getFile:async () => ({text:async () => written.get(prefix + name)})}) };
  }
  const window = { NoteGenerator: generator, NoteFiles: files,
    parent: directoryPicker ? {showDirectoryPicker: async () => {control.directoryCalls++;return directory();}} : {},
    collectNoteMaterials: async ({ delivery }) => { materialReads++; control.beforeMaterial?.(); return { course: '网络', materials: [{ ...material }], references: ['supplement','continue','review'].includes(delivery.task) ? model.uploadedReferences : [] }; } };
  const context = vm.createContext({ window, UiText: copy, CourseCore: { safeName: value => value },
    document: { getElementById: get, body: { append() {} } }, structuredClone, Blob,
    navigator: { clipboard: { writeText: async value => {if (control.clipboardError) throw control.clipboardError; control.beforeClipboard?.();clipboard.push(value);} } },
    localStorage: { setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) }, setTimeout: () => 1,
    URL: { createObjectURL(blob) { const key = `blob:${blobs.size}`; blobs.set(key,blob); return key; }, revokeObjectURL() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/workbench/notes/delivery.js'),'utf8'),context);
  window.createNotesDelivery({ model, catalog: {}, feedback: { settings: (_,message) => messages.push(message) }, element,
    read: () => model.config, save: async () => generator.validate(model.config),
    ready, pendingInstallation: () => !ready() && model.exportedSkillSnapshot === skillSnapshot(), skillSnapshot, webSnapshot: snapshot,
    updateDelivery() {get('copy-study-prompt').disabled = model.busy || !!model.readingFiles;}, refreshPreview() {}, previewTask: (task,generated) => previews.push({task,files:generated}) });
  return { model, material, get, downloads, clipboard, messages, storage, previews, control, written, ready, skillSnapshot, reads: () => materialReads };
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

test('local installation exports files and installation command, confirms, then copies the task', async () => {
  const h = boot('local', true);
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads[0].name,'course-notes.zip');
  assert.equal(h.clipboard[0],copy.notes.installPrompt); assert.equal(h.model.installedSnapshot,null);
  assert.equal(h.model.exportedSkillSnapshot,h.skillSnapshot());
  assert.equal(h.storage.get(h.model.exportedSkillKey),h.skillSnapshot());
  assert.equal(h.control.directoryCalls,0,'primary installation does not force a directory picker');
  const bundle = Buffer.from(await h.downloads[0].blob.arrayBuffer());
  assert.ok(bundle.includes(Buffer.from('course-notes/references/mermaid.md')));
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.ready(),true); assert.equal(h.model.installationMethod,'confirmed');
  assert.equal(h.storage.has(h.model.exportedSkillKey),false);
  assert.equal(h.clipboard.length,1); assert.equal(h.reads(),0);
  await h.get('copy-study-prompt').handlers.click();
  assert.match(h.clipboard[1],/请使用 course-notes/);
  assert.equal(h.downloads.length,1);
  assert.equal(h.reads(),1);
  assert.equal(h.previews.length,0,'copying does not open the file preview');
});

test('task selection keeps installation valid; changed writing rules require a new export and confirmation', async () => {
  const h = boot('local');
  await h.get('builder-confirm-installed').handlers.click();
  h.model.delivery.task='translate'; assert.equal(h.ready(),true);
  h.model.config.instructions='保留关键中间步骤'; assert.equal(h.ready(),false);
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads.length,1); assert.equal(h.reads(),0); assert.equal(h.ready(),false);
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.ready(),true);
});

test('standalone skill download does not confirm installation or change the primary workflow', async () => {
  const h = boot('local');
  await h.get('builder-download').handlers.click();
  assert.equal(h.downloads.length,1); assert.equal(h.clipboard.length,0);
  assert.equal(h.model.exportedSkillSnapshot,null); assert.equal(h.ready(),false);
});

test('installation preview is available before installation and reads no course or Obsidian files', async () => {
  const h = boot('local');
  await h.get('builder-preview-task').handlers.click();
  assert.equal(h.previews[0].task.path,'安装指令.txt');
  assert.equal(h.previews[0].task.text,copy.notes.installPrompt);
  assert.ok(h.previews[0].files.some(file=>file.path==='references/mermaid.md'));
  assert.equal(h.reads(),0); assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
});

test('directory synchronization records verified files separately from installation confirmation', async () => {
  const h = boot('local', true);
  await h.get('builder-sync').handlers.click();
  assert.equal(h.ready(),true); assert.equal(h.model.installationMethod,'synced');
  assert.equal(h.written.size,8); assert.equal(h.control.directoryCalls,1);
  assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
  h.model.config.goal='准备考试'; h.control.writeError=new Error('write denied');
  await h.get('builder-sync').handlers.click();
  assert.equal(h.ready(),false); assert.match(h.messages.at(-1),/同步失败.*write denied/);
  assert.equal(h.model.busy,false);
});

test('clipboard failure cannot mark a skill exported or installed', async () => {
  const h = boot('local'); h.control.clipboardError=new Error('clipboard denied');
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads.length,0); assert.equal(h.model.exportedSkillSnapshot,null); assert.equal(h.ready(),false);
  assert.match(h.messages.at(-1),/复制失败.*clipboard denied/); assert.equal(h.model.busy,false);
});

test('rules changed while export is pending are not falsely confirmed as the exported rules', async () => {
  const h = boot('local'); h.control.beforeClipboard=()=>{h.model.config.goal='已更改的目标';};
  await h.get('copy-study-prompt').handlers.click();
  assert.notEqual(h.model.exportedSkillSnapshot,h.skillSnapshot()); assert.equal(h.ready(),false);
});

test('web edits during material collection abort mismatched command and file delivery', async () => {
  const h = boot(); h.control.beforeMaterial=()=>{h.model.config.goal='新的目标';};
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
  assert.match(h.messages.at(-1),/重新导出/); assert.equal(h.model.busy,false);
});

test('reading an uploaded file blocks delivery until its actual text is available', async () => {
  const h = boot(); let finish;
  const text = new Promise(resolve => {finish=resolve;});
  const input = {files:[{name:'补充.md',text:()=>text}]};
  const reading = h.get('builder-web-materials').handlers.change({target:input});
  assert.equal(h.model.readingFiles,1);
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
  finish('真正读取的补充材料'); await reading;
  assert.equal(h.model.readingFiles,0);
  assert.equal(h.model.uploadedMaterials[0].content,'真正读取的补充材料');
});

test('a failed replacement upload cannot reuse the previous reference content', async () => {
  const h = boot(); h.model.delivery.task='continue';
  h.model.uploadedReferences=[{fileName:'旧笔记.md',content:'上次上传的旧内容'}];
  await h.get('builder-web-reference').handlers.change({target:{files:[{name:'新笔记.md',text:async()=>{throw new Error('read denied');}}]}});
  assert.equal(h.model.uploadedReferences.length,0); assert.equal(h.model.readingFiles,0);
  assert.match(h.messages.at(-1),/文件读取失败.*read denied/);
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(h.clipboard.length,0); assert.equal(h.downloads.length,0);
});
