const test = require('node:test');
const assert = require('node:assert/strict');
require('../extension/shared/course.js');
const history = require('../extension/shared/import-history.js');

function store() {
  const values = {};
  return { values, get: async key => key === null ? { ...values } : { [key]: values[key] },
    set: async data => Object.assign(values, data), remove: async key => { delete values[key]; } };
}
const page = { cid: '456', page: 4, part: 'HTTP 请求与响应' };
const meta = { bvid: 'BV1ps4y1d73V', title: '计算机网络', thumbnail: 'https://i0.hdslb.com/cover.jpg', pages: [page, { cid: '457', page: 5 }] };

test('successful import persists date, cover, language and exact saved path across reads', async () => {
  const storage = store();
  await history.save(storage, meta, page, 'Clippings/Bilibili', { status: 'saved', path: '原始字幕/已保存.md', track: { lanDoc: '中文' } }, 1234);
  const [record] = await history.list(storage);
  assert.equal(record.importedAt, 1234);
  assert.equal(record.thumbnail, meta.thumbnail);
  assert.equal(record.language, '中文');
  assert.equal(record.sourcePath, '原始字幕/已保存.md');
  assert.equal(record.sourceUrl, 'https://www.bilibili.com/video/BV1ps4y1d73V/?p=4');
});

test('repeat imports update one record while another destination remains separate', async () => {
  const storage = store();
  await history.save(storage, meta, page, 'Clippings/Bilibili', { status: 'saved', path: '字幕.md', track: { lanDoc: '中文' } }, 1);
  await history.save(storage, meta, page, 'Clippings/Bilibili', { status: 'exists', path: '重命名字幕.md' }, 2);
  await history.save(storage, meta, page, 'Study/Bilibili', { status: 'saved', path: '另一份字幕.md' }, 3);
  const records = await history.list(storage);
  assert.equal(records.length, 2);
  assert.equal(records[0].importedAt, 2);
  assert.equal(records[0].sourcePath, '重命名字幕.md');
  assert.equal(records[0].language, '中文');
  await history.remove(storage, records[0].id);
  assert.equal((await history.list(storage))[0].base, 'Study/Bilibili');
});

test('failed, missing and unfinished jobs never become import records', async () => {
  const storage = store();
  for (const status of ['failed', 'missing', 'running', 'done', 'subtitle-available']) {
    await history.save(storage, meta, page, 'Clippings/Bilibili', { status, path: '字幕.md' });
  }
  assert.deepEqual(await history.list(storage), []);
});

test('each YouTube playlist video retains its own cover and identifier', () => {
  const selected = { cid: 'abcdef12345', page: 2, part: 'Lecture 02' };
  const record = history.create({ platform: 'youtube', bvid: 'YTPL_PLdemo123', playlistId: 'PLdemo123', title: '课程', pages: [page, selected] }, selected, 'Clippings/YouTube', { status: 'saved', path: 'Lecture 02.md' }, 1);
  assert.equal(record.thumbnail, 'https://i.ytimg.com/vi/abcdef12345/hqdefault.jpg');
  assert.equal(record.sourceUrl, 'https://www.youtube.com/watch?v=abcdef12345');
  assert.equal(record.playlistId, 'PLdemo123');
});
