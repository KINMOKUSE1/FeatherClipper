const test = require('node:test');
const assert = require('node:assert/strict');
require('../extension/shared/course.js');
const history = require('../extension/shared/import-history.js');

function store() {
  const values = {};
  return { values, get: async key => key === null ? { ...values } : { [key]: values[key] },
    set: async data => Object.assign(values, data), remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; } };
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
  assert.equal(record.title, meta.title);
  assert.equal(record.importedCount, 1);
  assert.equal(record.totalVideos, 2);
  assert.equal(record.videos[0].sourcePath, '原始字幕/已保存.md');
  assert.equal(record.videos[0].sourceUrl, 'https://www.bilibili.com/video/BV1ps4y1d73V/?p=4');
});

test('repeat imports across destinations update the same series and count each video once', async () => {
  const storage = store();
  await history.save(storage, meta, page, 'Clippings/Bilibili', { status: 'saved', path: '字幕.md', track: { lanDoc: '中文' } }, 1);
  await history.save(storage, meta, page, 'Clippings/Bilibili', { status: 'exists', path: '重命名字幕.md' }, 2);
  await history.save(storage, meta, page, 'Study/Bilibili', { status: 'saved', path: '另一份字幕.md' }, 3);
  const records = await history.list(storage);
  assert.equal(records.length, 1);
  assert.equal(records[0].importedAt, 3);
  assert.equal(records[0].importedCount, 1);
  assert.equal(records[0].videos[0].sourcePath, '另一份字幕.md');
  assert.equal(records[0].videos[0].language, '中文');
  await history.remove(storage, records[0].id);
  assert.deepEqual(await history.list(storage), []);
  assert.equal(Object.keys(storage.values).length, 0);
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
  assert.equal(record.isSeries, true);
  assert.equal(record.totalVideos, 2);
  assert.equal(record.courseThumbnail, 'https://i.ytimg.com/vi/456/hqdefault.jpg');
});

test('later and concurrent imports increase the series count and details follow the original video order', async () => {
  const storage = store();
  const pages = Array.from({ length: 30 }, (_, index) => ({ cid: String(index + 1), page: index + 1, part: `课时 ${index + 1}` }));
  const course = { ...meta, pages };
  await Promise.all([12, 4, 1].map(number => history.save(storage, course, pages[number - 1], 'Clippings/Bilibili', { status: 'saved', path: `${number}.md` }, number)));
  let [record] = await history.list(storage);
  assert.equal(record.importedCount, 3);
  assert.equal(record.totalVideos, 30);
  assert.deepEqual(record.videos.map(video => video.page), [1, 4, 12]);
  await history.save(storage, course, pages[3], 'Clippings/Bilibili', { status: 'exists', path: '4.md' }, 100);
  [record] = await history.list(storage);
  assert.equal(record.importedCount, 3);
  assert.equal(record.importedAt, 100);
  await history.save(storage, course, pages[6], 'Clippings/Bilibili', { status: 'saved', path: '7.md' }, 200);
  [record] = await history.list(storage);
  assert.equal(record.importedCount, 4);
  assert.equal(record.importedAt, 200);
  assert.deepEqual(record.videos.map(video => video.page), [1, 4, 7, 12]);
});

test('course identity keeps series with the same title and independent single videos separate', async () => {
  const storage = store();
  const another = { ...meta, bvid: 'BVdifferent' };
  const single = { ...meta, bvid: 'BVsingle', pages: [page] };
  for (const course of [meta, another, single]) await history.save(storage, course, page, 'Clippings/Bilibili', { status: 'saved', path: '字幕.md' }, 10);
  const records = await history.list(storage);
  assert.equal(records.length, 3);
  const independent = records.find(record => record.courseId === single.bvid);
  assert.equal(independent.isSeries, false);
  assert.equal(independent.title, single.title);
  await history.remove(storage, records.find(record => record.courseId === meta.bvid).id);
  assert.equal((await history.list(storage)).length, 2);
});

test('existing video records group immediately and use the saved course directory for the total', async () => {
  const storage = store();
  for (const item of meta.pages) {
    const legacy = history.create(meta, item, 'Clippings/Bilibili', { status: 'saved', path: `原始字幕/${item.cid}.md` }, 1);
    delete legacy.totalVideos; delete legacy.isSeries; delete legacy.courseThumbnail; delete legacy.coursePath;
    storage.values[legacy.id] = legacy;
  }
  storage.values[`boc-course-v1:${meta.bvid}:Clippings/Bilibili`] = { pages: [...meta.pages, { cid: '458', page: 6 }] };
  const [record] = await history.list(storage);
  assert.equal(record.isSeries, true);
  assert.equal(record.importedCount, 2);
  assert.equal(record.totalVideos, 3);
  delete storage.values[`boc-course-v1:${meta.bvid}:Clippings/Bilibili`];
  assert.equal((await history.list(storage))[0].totalVideos, null);
});

test('a one-video YouTube playlist remains a series and does not merge with the standalone video', async () => {
  const storage = store();
  const video = { cid: 'abcdef12345', page: 1, part: 'Lecture' };
  const playlist = { platform: 'youtube', bvid: 'YTPL_PLdemo123', playlistId: 'PLdemo123', title: '系列', pages: [video] };
  const single = { ...playlist, bvid: 'YT_abcdef12345', playlistId: '', videoId: video.cid, title: video.part };
  for (const course of [playlist, single]) await history.save(storage, course, video, 'Clippings/YouTube', { status: 'saved', path: '字幕.md' }, 1);
  const records = await history.list(storage);
  assert.equal(records.length, 2);
  const series = records.find(record => record.isSeries);
  assert.equal(series.title, playlist.title);
  assert.equal(series.importedCount, 1);
  assert.equal(series.totalVideos, 1);
  assert.equal(series.sourceUrl, 'https://www.youtube.com/watch?v=abcdef12345&list=PLdemo123');
  assert.equal(series.videos[0].sourceUrl, 'https://www.youtube.com/watch?v=abcdef12345');
});
