const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const language = require('../extension/shared/i18n.js');
const copy = require('../extension/shared/ui-text.js');
const core = require('../extension/shared/course.js');
const defaults = require('../extension/workbench/notes/rules/defaults.js');
const generator = require('../extension/workbench/notes/generator.js');
const en = require('../extension/shared/locales/en.js');
const tw = require('../extension/shared/locales/zh-TW.js');
const meta = { bvid: 'BV1234567890', title: '原始课程', author: '讲师', pages: [{ cid: '10' }] };
const lesson = { cid: '10', page: 1, part: '原视频标题', chapter: '2', status: 'saved' };

test('English and traditional dictionaries have matching keys and placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tw).sort());
  const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(params(en[key]), params(key), `English: ${key}`);
    assert.deepEqual(params(tw[key]), params(key), `Traditional: ${key}`);
  }
});

test('UI language updates retained copy groups and keeps subtitle / note content separate', async () => {
  const popup = copy.popup;
  await language.setLocale('en', false);
  assert.equal(popup.save, 'Save subtitles');
  assert.equal(copy.format(copy.notes.materialCount, { count: 1 }), 'Selected lesson: 1');
  await language.setLocale('zh-TW', false);
  assert.equal(language.outputLocale(), 'en');
  assert.equal(popup.save, '儲存字幕');
  const raw = core.buildRaw(meta, lesson, { lan: 'zh', lanDoc: '中文' }, [{ from: 2, content: '原始字幕，不翻译' }]);
  assert.match(raw, /## Subtitles/);
  assert.match(raw, /原始字幕，不翻译/);
  assert.match(raw, /原视频标题/);
  await language.setLocale('zh-CN', false);
  assert.equal(popup.save, '保存字幕');
});

test('import artifacts use explicit output locale and link to actual legacy or English paths', async () => {
  const base = 'Clippings/Bilibili';
  await language.setLocale('zh-CN', false);
  const raw = core.rawPath(meta, lesson, base, 'en');
  assert.match(raw, /\/Raw Subtitles\/原视频标题 \[CID-10\]\.md$/);
  assert.match(core.indexPath(meta, base, 'zh-TW'), /Course Import Index\.md$/);
  const legacy = core.rawPath(meta, lesson, base, 'zh-CN');
  const index = core.buildIndex(meta, [{ ...lesson, sourcePath: legacy }], base, 'en');
  assert.match(index, /Course Import Index/);
  assert.match(index, /\[Subtitles\]\(<原始字幕\/原视频标题 \[CID-10\]\.md>\)/);
  assert.match(core.buildIndex(meta, [{ ...lesson, sourcePath: raw }], base, 'zh-CN'), /\[字幕\]\(<Raw Subtitles\//);
});

test('unchanged defaults migrate, custom rules and note language survive', () => {
  const config = defaults.forLocale('zh-CN').defaults();
  config.language = '日本語';
  config.modules[0].writing = '保留这段用户写法';
  config.properties[0].rule = '自定义属性规则';
  config.folder = '我的目录';
  const migrated = defaults.migrate(config, 'zh-CN', 'en');
  assert.equal(migrated.language, '日本語');
  assert.equal(migrated.folder, '我的目录');
  assert.equal(migrated.modules[0].writing, '保留这段用户写法');
  assert.equal(migrated.properties[0].rule, '自定义属性规则');
  assert.equal(migrated.modules[1].title, 'Glossary');
  assert.equal(migrated.outputLocale, 'en');
  assert.deepEqual(defaults.migrate(migrated, 'en', 'zh-TW'), migrated);
});

function resources() {
  const root = path.join(__dirname, '../extension/workbench/notes/rules/en');
  return Object.fromEntries(Object.entries({ entry: 'SKILL.md', agent: 'openai.yaml', workflow: 'workflow.md', tasks: 'tasks.md', mermaid: 'mermaid.md', markdown: 'markdown.md' }).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
}

test('English and traditional modes generate the same complete skill and every task variant', async () => {
  await language.setLocale('en', false);
  const config = generator.defaults(), rules = resources();
  const snapshot = generator.buildFiles(config, rules);
  assert.equal(snapshot.length, 9);
  const preferences = snapshot.find(file => file.path === 'references/preferences.md').content;
  assert.match(preferences, /Notes Progress\.md/);
  assert.match(preferences, /Note\/Course Notes/);
  assert.doesNotMatch(preferences, /整理进度|个人偏好/);
  assert.match(rules.workflow, /Confirm materials and scope/);
  assert.match(rules.workflow, /2\.10/);
  assert.match(rules.markdown, /\$P\(A \\mid B\)\$/);
  const context = { course: '原始课程', index: '原目录/课程导入清单.md', materials: [{ label: '原始标题', chapter: 'Chapter 02', path: '原目录/原始字幕/a.md', fileName: 'materials/a.md', content: '真实原始字幕' }], references: [{ fileName: 'existing-notes/user.md', content: '用户手写笔记' }] };
  for (const task of ['notes', 'supplement', 'continue', 'translate', 'review']) {
    const delivery = { ...generator.deliveryDefaults(), task, ready: true, reference: '用户原笔记.md', question: '用户的问题' };
    const prompt = generator.buildTask(config, delivery, context);
    assert.match(prompt, /Use course-notes/);
    assert.match(prompt, /原目录\/原始字幕\/a\.md/);
    const web = { ...delivery, environment: 'web' };
    assert.match(generator.buildTask(config, web, context), /Course Task Materials\.md/);
    const files = generator.buildWebFiles(config, web, context, rules);
    assert.equal(files[0].path, 'Task.md');
    assert.ok(files.some(file => file.path === 'rules/workflow.md'));
    assert.equal(files.find(file => file.path === 'materials/a.md').content, '真实原始字幕');
    assert.match(generator.combineWebFiles(files), /Course Task Materials/);
  }
  await language.setLocale('zh-TW', false);
  assert.deepEqual(generator.buildFiles(config, rules), snapshot, 'UI-only script switch must not invalidate installation');
  await language.setLocale('zh-CN', false);
});

test('legacy and English source directories deduplicate the same video', async () => {
  const files = new Map([
    ['Clippings/Bilibili/原始课程 [BV1234567890]/原始字幕/', { files: ['旧名称 [CID-10].md'] }],
    ['Clippings/Bilibili/原始课程 [BV1234567890]/Raw Subtitles/', { files: ['Another [CID-20].md'] }]
  ]);
  const context = vm.createContext({ CourseCore: core });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background/obsidian.js'), 'utf8'), context);
  context.courseLocalRequest = async directory => files.get(directory) || null;
  const result = await context.courseRawSources(meta, [lesson, { ...lesson, cid: '20' }], 'Clippings/Bilibili');
  assert.match(result['10'], /原始字幕\/旧名称 \[CID-10\]/);
  assert.match(result['20'], /Raw Subtitles\/Another \[CID-20\]/);
});

test('known product errors translate while unknown provider messages remain intact', async () => {
  await language.setLocale('en', false);
  assert.equal(language.error('Obsidian 请求失败 HTTP 401'), 'Obsidian request failed: HTTP 401');
  assert.equal(language.error('Provider said: insufficient_quota'), 'Provider said: insufficient_quota');
  await language.setLocale('zh-CN', false);
});
