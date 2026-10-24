const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const generator = require('../extension/workbench/notes/generator.js');
const files = require('../extension/workbench/notes/files.js');
const copy = require('../extension/shared/ui-text.js');
const course = require('../extension/shared/course.js');
const collectMaterials = require('../extension/workbench/notes/materials.js');

function boot(environment = 'web', directoryPicker = false) {
  const nodes = new Map(), downloads = [], clipboard = [], messages = [], blobs = new Map(), storage = new Map(), previews = [], written = new Map();
  const control = { clipboardError: null, beforeClipboard: null, beforeMaterial: null, directoryCalls: 0, writeError: null, extraMaterials: [] };
  function element() {
    return { hidden: true, disabled: false, handlers: {}, dataset: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {}, remove() {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const resources = Object.fromEntries([['entry','SKILL.md'],['agent','openai.yaml'],['workflow','workflow.md'],['tasks','tasks.md'],['mermaid','mermaid.md'],['markdown','markdown.md']].map(([key,file]) => [key,fs.readFileSync(require.resolve(`../extension/workbench/notes/rules/${file}`),'utf8')]));
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
    collectNoteMaterials: async args => { materialReads++; control.beforeMaterial?.(); if (control.catalog) return collectMaterials({ ...args, core: course, catalog: control.catalog });
      return { course: '网络', materials: [{ ...material }, ...control.extraMaterials], references: ['supplement','continue','review'].includes(args.delivery.task) ? model.uploadedReferences : [] }; } };
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
  assert.ok((await h.downloads[0].blob.text()).includes(fs.readFileSync(require.resolve('../extension/workbench/notes/rules/markdown.md'),'utf8')));
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
  assert.ok(bundle.includes(Buffer.from('course-notes/references/markdown.md')));
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
  assert.equal(h.previews[0].files.find(file=>file.path==='references/markdown.md').content,fs.readFileSync(require.resolve('../extension/workbench/notes/rules/markdown.md'),'utf8'));
  assert.equal(h.reads(),0); assert.equal(h.downloads.length,0); assert.equal(h.clipboard.length,0);
});

test('directory synchronization records verified files separately from installation confirmation', async () => {
  const h = boot('local', true);
  await h.get('builder-sync').handlers.click();
  assert.equal(h.ready(),true); assert.equal(h.model.installationMethod,'synced');
  assert.equal(h.written.size,9); assert.equal(h.control.directoryCalls,1);
  assert.equal(h.written.get('course-notes/references/markdown.md'),fs.readFileSync(require.resolve('../extension/workbench/notes/rules/markdown.md'),'utf8'));
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

test('multiple sources cannot be copied, exported or previewed', async () => {
  const h = boot();
  h.control.extraMaterials = [{ label: 'P2 UDP', chapter: '2', content: '第二个视频字幕', fileName: '素材/P02.md' }];
  for (const id of ['copy-study-prompt', 'builder-export-web', 'builder-preview-task']) {
    await h.get(id).handlers.click();
    assert.match(h.messages.at(-1), /每次只能处理一个视频或一个素材文件/);
  }
  assert.equal(h.clipboard.length, 0); assert.equal(h.downloads.length, 0); assert.equal(h.previews.length, 0);
});

test('multiple uploaded source files are rejected before their contents are read', async () => {
  const h = boot(); let reads = 0;
  const input = { files: ['第一讲.md', '第二讲.md'].map(name => ({ name, text: async () => { reads++; return '字幕'; } })) };
  await h.get('builder-web-materials').handlers.change({ target: input });
  assert.equal(reads, 0); assert.equal(h.model.uploadedMaterials.length, 0);
  assert.match(h.messages.at(-1), /每次只能使用一个素材文件/);
});

test('web material collection rejects multiple selected videos before requesting subtitles', async () => {
  let requests = 0;
  const pages = [1, 2].map(page => ({ page, cid: page, part: `视频${page}`, chapter: String(page), selected: true }));
  const catalog = { getState: () => ({ meta: { title: '课程' }, pages }), request: async () => { requests++; } };
  await assert.rejects(collectMaterials({ catalog, core: course, delivery: { environment: 'web', task: 'notes' } }), /每次只能处理一个视频/);
  assert.equal(requests, 0); assert.equal(pages.filter(page => page.selected).length, 2);
});

test('uploaded source replaces selected videos while all reference notes remain available', async () => {
  let requests = 0;
  const catalog = { getState: () => ({ meta: { title: '不应使用的课程' }, pages: [1, 2].map(page => ({ page, selected: true })) }),
    request: async () => { requests++; throw new Error('不应读取视频字幕'); } };
  const uploadedMaterials = [{ fileName: '素材/一讲.md', content: '用户自己的字幕' }];
  const uploadedReferences = [{ fileName: '已有笔记/笔记.md', content: '保留批注' }, { fileName: '已有笔记/进度.md', content: '前半段已完成' }];
  const delivery = { ...generator.deliveryDefaults(), environment: 'web', task: 'continue' };
  const context = await collectMaterials({ catalog, core: course, delivery, uploadedMaterials, uploadedReferences });
  assert.equal(requests, 0); assert.equal(context.materials.length, 1);
  assert.equal(context.course, copy.materials.manualCourse);
  const resources = Object.fromEntries([['entry','SKILL.md'],['agent','openai.yaml'],['workflow','workflow.md'],['tasks','tasks.md'],['mermaid','mermaid.md'],['markdown','markdown.md']].map(([key,file]) => [key,fs.readFileSync(require.resolve(`../extension/workbench/notes/rules/${file}`),'utf8')]));
  const exported = generator.buildWebFiles(generator.defaults(), delivery, context, resources);
  assert.equal(exported.filter(file => file.path.startsWith('素材/')).length, 1);
  assert.equal(exported.filter(file => file.path.startsWith('已有笔记/')).length, 2);
  assert.match(generator.combineWebFiles(exported), /用户自己的字幕/);
  const empty = await collectMaterials({ catalog, core: course, delivery, uploadedMaterials: [{ ...uploadedMaterials[0], content: '' }] });
  assert.throws(() => generator.buildTask(generator.defaults(), delivery, { ...empty, references: uploadedReferences }), /没有可用字幕/);
  assert.equal(requests, 0, 'an empty upload never falls back to selected videos');
  await assert.rejects(collectMaterials({ catalog, core: course, delivery, uploadedMaterials: [...uploadedMaterials, ...uploadedMaterials] }), /每次只能使用一个素材文件/);
});

test('web copy and export deliver only the selected video subtitle', async () => {
  const h = boot(); let requests = 0;
  const page = { page: 1, cid: '456', part: '当前视频', chapter: '1', selected: true };
  const catalog = { getState: () => ({ meta: { bvid: 'BV1ps4y1d73V', title: '课程' }, pages: [page, { ...page, page: 2, selected: false }] }),
    request: async () => { requests++; return { body: [{ from: 0, to: 5, content: '当前视频的真实字幕' }], track: {} }; } };
  h.control.catalog = catalog;
  await h.get('copy-study-prompt').handlers.click();
  assert.equal(requests, 1);
  assert.match(await h.downloads[0].blob.text(), /当前视频的真实字幕/);
  assert.match(h.clipboard[0], /课程任务材料\.md/);
});

test('notes UI blocks multiple videos and restores local granularity after switching environments', () => {
  const h = boot(), model = h.model;
  model.delivery.environment = 'local'; model.config.granularity = 'group';
  const pages = [{ selected: true }, { selected: true }];
  const fields = ['goal', 'language', 'granularity', 'folder', 'naming', 'links', 'instructions'];
  const deliveryFields = ['environment', 'task', 'reference', 'question', 'paths', 'format'];
  const toggles = ['external', 'progress'];
  for (const name of fields) h.get(`builder-${name}`).value = model.config[name];
  for (const name of deliveryFields) h.get(`builder-${name}`).value = model.delivery[name];
  for (const name of toggles) h.get(`builder-${name}`).checked = model.config[name];
  const source = fs.readFileSync(require.resolve('../extension/workbench/notes/page.js'), 'utf8');
  const context = vm.createContext({ model, core: generator, ui: copy.notes, UiText: copy, format: copy.format, get: h.get,
    catalog: { getState: () => ({ pages }) }, fields, deliveryFields, toggles, form: { querySelectorAll: () => [] }, window: { parent: {} } });
  const view = vm.runInContext(source.slice(source.indexOf('  function read()'), source.indexOf('  function renderFileList')) + '\n({ read, updateDelivery })', context);
  view.updateDelivery();
  h.get('builder-environment').value = 'web'; view.read(); view.updateDelivery();
  assert.match(h.get('builder-delivery-next').textContent, /每次只能处理一个视频/);
  for (const id of ['copy-study-prompt', 'builder-export-web', 'builder-preview-task']) assert.equal(h.get(id).disabled, true);
  assert.equal(h.get('builder-granularity').value, 'video'); assert.equal(h.get('builder-granularity').disabled, true);
  model.uploadedMaterials = [{ fileName: '素材/一讲.md', content: '字幕' }]; view.updateDelivery();
  for (const id of ['copy-study-prompt', 'builder-export-web', 'builder-preview-task']) assert.equal(h.get(id).disabled, false);
  assert.equal(h.get('builder-material-count').textContent, copy.notes.uploadedMaterial);
  view.read(); assert.equal(model.config.granularity, 'group');
  h.get('builder-environment').value = 'local'; view.read(); view.updateDelivery();
  assert.equal(h.get('builder-granularity').value, 'group'); assert.equal(h.get('builder-granularity').disabled, false);
  assert.equal(model.config.granularity, 'group');
});
