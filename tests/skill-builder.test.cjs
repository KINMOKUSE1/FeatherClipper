const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const builder = require('../extension/workbench/notes/generator.js');
const filesIO = require('../extension/workbench/notes/files.js');
const resources = {
  entry: fs.readFileSync(require.resolve('../extension/workbench/notes/rules/SKILL.md'), 'utf8'),
  agent: fs.readFileSync(require.resolve('../extension/workbench/notes/rules/openai.yaml'), 'utf8'),
  workflow: fs.readFileSync(require.resolve('../extension/workbench/notes/rules/workflow.md'), 'utf8'),
  tasks: fs.readFileSync(require.resolve('../extension/workbench/notes/rules/tasks.md'), 'utf8'),
  mermaid: fs.readFileSync(require.resolve('../extension/workbench/notes/rules/mermaid.md'), 'utf8')
};
const configFiles = config => Object.fromEntries(builder.buildFiles(config, resources).map(file => [file.path, file.content]));
const context = () => ({ course: '网络', index: '素材/清单.md', materials: [{ label: 'P1 TCP', chapter: '2.2', path: '素材/当前路径.md', fileName: '素材/P01-TCP.md', content: '00:00 教师用窗口大小 4 举例，接收方已经确认序号 3' }], references: [] });

test('bundle separates workflow, recipes and properties and resolves all entry references', () => {
  const config = builder.defaults();
  config.modules.find(item => item.id === 'terms').enabled = false;
  const questions = config.modules.find(item => item.id === 'questions');
  questions.writing = '只生成应用题，答案放在本节末尾';
  config.modules = [questions, ...config.modules.filter(item => item !== questions)];
  config.modules.push({ id: 'custom', enabled: true, title: '实验记录', writing: '记录实验步骤与实际结果' });
  const files = configFiles(config), entry = files['SKILL.md'], recipes = files['references/modules.md'];
  assert.equal(Object.keys(files).length, 8);
  assert.match(entry, /^---\r?\nname: course-notes\r?\n/);
  for (const match of entry.matchAll(/\]\(([^)]+)\)/g)) assert.ok(files[match[1]], match[1]);
  assert.ok(!entry.includes('只生成应用题'));
  assert.equal(files['references/workflow.md'], resources.workflow);
  assert.equal(files['references/tasks.md'], resources.tasks);
  assert.equal(files['references/mermaid.md'], resources.mermaid);
  for (const [path, content] of Object.entries(files)) {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = require('node:path').posix.join(require('node:path').posix.dirname(path), match[1]);
      assert.ok(files[target], `${path} → ${target}`);
    }
  }
  assert.ok(recipes.indexOf('## 思考题／自测题') < recipes.indexOf('## 详细笔记'));
  assert.ok(recipes.includes('只生成应用题，答案放在本节末尾'));
  assert.ok(recipes.includes('## 实验记录\n\n记录实验步骤与实际结果'));
  assert.ok(!recipes.includes('## 术语表'));
  assert.ok(!recipes.includes('每题提供答案和理由'));
});

test('property selection, edited rules and typed values belong to the property file', () => {
  const config = builder.defaults();
  config.properties.find(item => item.name === 'source_cids').enabled = false;
  config.properties.find(item => item.name === 'created').rule = '填写首次整理日期，后续补充时保留';
  config.properties.find(item => item.name === 'tags').value = '课程笔记, computer network';
  config.customProperties = [{ name: 'difficulty', type: 'number', value: '3' }, { name: 'reviewed', type: 'boolean', value: 'false' }];
  const properties = configFiles(config)['references/properties.md'];
  assert.ok(!properties.includes('- source_cids'));
  assert.ok(properties.includes('填写首次整理日期，后续补充时保留'));
  assert.ok(properties.includes('["课程笔记","computer-network"]'));
  assert.ok(properties.includes('difficulty（数字）：使用固定值 3'));
  assert.ok(properties.includes('reviewed（开关）：使用固定值 false'));
  config.properties.forEach(item => item.enabled = false); config.customProperties = [];
  assert.ok(configFiles(config)['references/properties.md'].includes('不生成 YAML frontmatter'));
});

test('installed local agent gets scope and current paths without an inline skill', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), ready: true }, ctx = context();
  const task = builder.buildTask(config, delivery, ctx);
  assert.ok(task.includes('素材/当前路径.md'));
  assert.ok(task.includes('course-notes'));
  assert.ok(!task.includes('name: course-notes'));
  assert.ok(task.length < 500);
  ctx.materials[0].path = '素材/刚改名.md';
  assert.ok(builder.buildTask(config, delivery, ctx).includes('素材/刚改名.md'));
  delivery.ready = false;
  assert.throws(() => builder.buildTask(config, delivery, ctx), /安装或同步/);
});

test('web prompt and uploads carry actual content without local source paths', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), environment: 'web' }, ctx = context();
  const task = builder.buildTask(config, delivery, ctx), files = builder.buildWebFiles(config, delivery, ctx, resources);
  const merged = builder.combineWebFiles(files);
  assert.ok(task.includes('课程任务材料.md'));
  assert.ok(task.includes('不调用本地 skill'));
  assert.ok(task.includes('不声称已更新 Obsidian'));
  assert.ok(!task.includes('素材/当前路径.md'));
  assert.ok(!merged.includes('素材/当前路径.md'));
  assert.ok(merged.includes('窗口大小 4'));
  assert.ok(files.some(file => file.path === '规则/workflow.md'));
  assert.ok(files.some(file => file.path === '规则/tasks.md'));
  assert.equal(files.find(file => file.path === '规则/mermaid.md').content, resources.mermaid);
  delivery.format = 'zip';
  assert.ok(builder.buildTask(config, delivery, ctx).includes('course-web-task.zip'));
});

test('task types require real inputs and omit hidden inputs from previous tasks', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), ready: true }, ctx = context();
  delivery.task = 'supplement';
  assert.throws(() => builder.buildTask(config, delivery, ctx), /已有笔记或整理进度路径/);
  delivery.reference = '笔记/网络.md';
  assert.ok(builder.buildTask(config, delivery, ctx).includes('实际读取已有笔记'));
  delivery.task = 'continue';
  assert.ok(builder.buildTask(config, delivery, ctx).includes('只继续本次指定范围中尚未完成'));
  delivery.task = 'review';
  assert.throws(() => builder.buildTask(config, delivery, ctx), /填写.*问题/);
  delivery.question = '窗口大小为什么限制吞吐量？';
  assert.ok(builder.buildTask(config, delivery, ctx).includes(delivery.question));
  delivery.task = 'translate'; config.language = '英文';
  const translation = builder.buildTask(config, delivery, ctx);
  assert.ok(translation.includes('翻译为英文'));
  assert.ok(!translation.includes(delivery.question));
  assert.ok(!translation.includes(delivery.reference));
});

test('web supplements preserve uploaded notes and expose unavailable material', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), environment: 'web', task: 'supplement' }, ctx = context();
  assert.throws(() => builder.buildWebFiles(config, delivery, ctx, resources), /上传已有笔记/);
  ctx.references = [{ fileName: '已有笔记/1-网络.md', content: '# 网络\n我的批注：先检查接收窗口' }];
  const merged = builder.combineWebFiles(builder.buildWebFiles(config, delivery, ctx, resources));
  assert.ok(merged.includes('我的批注：先检查接收窗口'));
  ctx.materials = [{ label: 'P2 DNS', chapter: '2.3', missing: '无字幕' }];
  assert.throws(() => builder.buildWebFiles(config, delivery, ctx, resources), /没有可用字幕/);
  delivery.task = 'review'; delivery.question = '解释已有笔记的接收窗口';
  assert.doesNotThrow(() => builder.buildWebFiles(config, delivery, ctx, resources));
  assert.ok(builder.combineWebFiles(builder.buildWebFiles(config, delivery, ctx, resources)).includes('P2 DNS（分组：2.3）：素材缺失：无字幕'));
});

test('web task and file generation reject multiple sources, including unavailable videos', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), environment: 'web' }, ctx = context();
  ctx.materials.push({ label: 'P2 DNS', chapter: '2', missing: '无字幕' });
  assert.throws(() => builder.buildTask(config, delivery, ctx), /每次只能处理一个视频或一个素材文件/);
  assert.throws(() => builder.buildWebFiles(config, delivery, ctx, resources), /每次只能处理一个视频或一个素材文件/);
  assert.doesNotThrow(() => builder.buildTask(config, { ...delivery, environment: 'local', ready: true }, ctx));
});

test('web video granularity applies to the exported task without changing installed preferences', () => {
  const config = builder.defaults(), delivery = { ...builder.deliveryDefaults(), environment: 'web' };
  config.granularity = 'group';
  const snapshot = JSON.stringify(builder.buildFiles(config, resources));
  const files = builder.buildWebFiles(config, delivery, context(), resources);
  assert.match(files.find(file => file.path === '规则/preferences.md').content, /每个选中视频单独一篇/);
  assert.equal(config.granularity, 'group');
  assert.equal(JSON.stringify(builder.buildFiles(config, resources)), snapshot);
});

test('configuration edits change install snapshot but delivery choice does not', () => {
  const config = builder.defaults(), original = JSON.stringify(builder.buildFiles(config, resources));
  const delivery = builder.deliveryDefaults(); delivery.task = 'translate';
  assert.equal(JSON.stringify(builder.buildFiles(config, resources)), original);
  config.progress = false; config.external = false;
  const files = configFiles(config);
  assert.ok(files['references/preferences.md'].includes('不额外创建整理进度文件'));
  assert.ok(files['references/preferences.md'].includes('不联网补充外部资料'));
  assert.notEqual(JSON.stringify(builder.buildFiles(config, resources)), original);
});

test('ZIP encodes Unicode names, known CRC and matching local/central entries', () => {
  const files = [{ path: 'course-notes/SKILL.md', content: 'hello' }, { path: '素材/课程.md', content: '中文字幕' }], bytes = Buffer.from(filesIO.zip(files));
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(6), 0x0800);
  assert.equal(bytes.readUInt32LE(14), 0x3610a686);
  assert.equal(bytes.readUInt16LE(8), 0);
  const end = bytes.length - 22, central = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 2);
  assert.equal(bytes.readUInt32LE(central), 0x02014b50);
  let offset = central;
  for (const file of files) {
    const nameLength = bytes.readUInt16LE(offset + 28), local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), file.path);
    const start = local + 30 + bytes.readUInt16LE(local + 26);
    assert.equal(bytes.subarray(start, start + bytes.readUInt32LE(local + 18)).toString('utf8'), file.content);
    offset += 46 + nameLength;
  }
});

test('directory sync writes and verifies every file and propagates a write failure', async () => {
  const files = builder.buildFiles(builder.defaults(), resources), saved = new Map();
  function directory(prefix = '', fail = false) {
    return {
      getDirectoryHandle: async name => directory(prefix + name + '/', fail),
      getFileHandle: async name => ({
        createWritable: async () => ({ write: async text => { if (fail) throw new Error('write denied'); saved.set(prefix + name, text); }, close: async () => {} }),
        getFile: async () => ({ text: async () => saved.get(prefix + name) })
      })
    };
  }
  await filesIO.writeFiles(directory(), files);
  assert.deepEqual([...saved.entries()], files.map(file => [file.path, file.content]));
  await assert.rejects(filesIO.writeFiles(directory('', true), files), /write denied/);
});

test('invalid recipes, duplicate attributes and dates stop generation', () => {
  const config = builder.defaults(); config.modules.forEach(item => item.enabled = false);
  assert.throws(() => builder.buildFiles(config, resources), /至少选择一个/);
  config.modules[0].enabled = true; config.customProperties = [{ name: 'course', type: 'text', value: '网络' }];
  assert.throws(() => builder.buildFiles(config, resources), /重复/);
  config.customProperties = [{ name: 'review', type: 'date', value: '2026-02-30' }];
  assert.throws(() => builder.buildFiles(config, resources), /有效日期/);
  config.customProperties = []; config.links = 'sources';
  assert.throws(() => builder.buildFiles(config, resources), /来源与待核实项/);
});
