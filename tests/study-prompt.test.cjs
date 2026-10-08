const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStudyPrompt } = require('../extension/course-core.js');
const meta = { title: '示例课程', bvid: 'BV1234567890' };
const pages = [
  { page: 1, cid: '11', part: '第一节', chapter: '1', selected: false },
  { page: 2, cid: '22', part: '第二节', chapter: '1', selected: true },
  { page: 3, cid: '33', part: '第三节', chapter: '2', selected: true },
];

test('study prompt keeps the selected scope and readable source paths', () => {
  const prompt = buildStudyPrompt(meta, pages, '素材');
  assert.match(prompt, /本次范围：P2、P3/);
  assert.match(prompt, /素材\/示例课程 \[BV1234567890\]\/原始字幕\/第二节 \[CID-22\]\.md/);
  assert.doesNotMatch(prompt, /CID-11/);
  assert.match(prompt, /我的笔记偏好/);
  assert.doesNotMatch(prompt, /WORKFLOW\.md|NOTE_TEMPLATE\.md|PROMPTS\.md/);
  assert.doesNotMatch(prompt, /自测题和答案/);
});

test('no selection requires an explicit scope instead of reusing the current P', () => {
  assert.throws(() => buildStudyPrompt(meta, pages.map(p => ({ ...p, selected: false })), '素材'), /先在课程列表勾选/);
});

test('unloaded course gives fill-in fields and invalid paths give a useful error', () => {
  assert.match(buildStudyPrompt(null, [], '素材'), /本次范围：\[填写/);
  assert.throws(() => buildStudyPrompt(meta, pages, '../素材'), /相对目录/);
});
