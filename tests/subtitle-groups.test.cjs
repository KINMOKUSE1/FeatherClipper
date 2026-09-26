const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../extension/course-core.js');

test('Bilibili combines adjacent cues up to 30 seconds, preserving Chinese and English text', () => {
  const body = [
    { from: 0, to: 2, content: '今天' }, { from: 3, to: 7, content: '学习浮点数。' },
    { from: 8, to: 15, content: 'IEEE' }, { from: 16, to: 30, content: '754 standard' },
    { from: 31, to: 32, content: '下一段' }, { from: 54, to: 56, content: '长停顿后' }
  ];
  const original = JSON.stringify(body);
  const groups = core.groupSubtitles(body, 'bilibili');
  assert.deepEqual(groups.map(item => item.from), [0, 31, 54]);
  assert.equal(groups[0].content, '今天学习浮点数。 IEEE 754 standard');
  assert.equal(groups.map(item => item.content).join('').replace(/\s/g, ''), body.map(item => item.content).join('').replace(/\s/g, ''));
  assert.equal(JSON.stringify(body), original);
});

test('YouTube combines sentence fragments and respects sentences, pauses and speaker markers', () => {
  const body = [
    { from: 7, content: 'All right,' }, { from: 9, content: "looks like that's working." },
    { from: 12, content: 'Now we' }, { from: 15, content: 'start the lesson.' },
    { from: 18, content: 'A question' }, { from: 20, content: '>> An answer' },
    { from: 50, content: 'After a pause' }
  ];
  const groups = core.groupSubtitles(body, 'youtube');
  assert.deepEqual(groups.map(item => item.from), [7, 12, 18, 20, 50]);
  assert.equal(groups[0].content, "All right, looks like that's working.");
  assert.equal(groups[1].content, 'Now we start the lesson.');
  assert.match(groups[3].content, /^>>/);
});

test('unpunctuated cues are bounded and long source cues are retained whole', () => {
  const body = Array.from({ length: 10 }, (_, i) => ({ from: i * 8, content: `word${i}` }));
  const groups = core.groupSubtitles(body, 'youtube');
  assert.ok(groups.every(group => group.to - group.from <= 30));
  assert.equal(groups.map(group => group.content).join(' '), body.map(cue => cue.content).join(' '));
  const long = [{ from: 0, to: 80, content: 'A single long cue stays intact.' }];
  assert.equal(core.groupSubtitles(long, 'youtube')[0].content, long[0].content);
});

test('Markdown uses the same complete groups as preview, with one playable link per group', () => {
  const body = [{ from: 7, to: 8, content: 'First' }, { from: 9, to: 11, content: 'sentence.' }, { from: 12, to: 14, content: 'Second sentence.' }];
  const part = { cid: '12345678901', page: 1, part: 'Lesson', chapter: '2.3' };
  for (const platform of ['youtube', 'bilibili']) {
    const meta = { platform, bvid: 'BVexample', videoId: part.cid, title: 'Course', author: 'Teacher' };
    const preview = core.groupSubtitles(body, platform);
    const note = core.buildRaw(meta, part, { lan: 'en' }, body);
    const paragraphs = note.split('\n').filter(line => /^\[\d\d:\d\d:\d\d\]/.test(line));
    assert.equal(paragraphs.length, preview.length);
    for (const [index, group] of preview.entries()) {
      assert.ok(paragraphs[index].endsWith(group.content));
      assert.ok(paragraphs[index].includes(core.timestampUrl(meta, part, group.from)));
    }
    assert.match(note, /chapter: "2\.3"/);
  }
});
