/* popup、批量导入和本地转写共用同一个成功记录入口。 */
async function rememberCourseImport(meta, page, base, result, track) {
  await ImportHistory.save(chrome.storage.local, meta, page, base, { ...result, track });
  return result;
}
