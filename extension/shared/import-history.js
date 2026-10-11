/* 成功导入的本地记录；按视频和保存位置去重，不保存字幕正文。 */
(function (root) {
  const prefix = "vid2notes:import-history:";
  function create(meta, page, base, result, importedAt = Date.now()) {
    if (!["saved", "exists"].includes(result.status) || !result.path) return null;
    const platform = meta.platform || "bilibili";
    const folder = root.CourseCore.normalizeFolder(base);
    const id = `${prefix}${meta.bvid}:${page.cid}:${root.CourseCore.courseFolder(meta, folder)}`;
    return { id, platform, courseId: meta.bvid, cid: page.cid, page: page.page,
      title: meta.pages.length === 1 ? meta.title : page.part, courseTitle: meta.title,
      author: meta.author || "", playlistId: meta.playlistId || "", base: folder,
      sourceUrl: root.CourseCore.videoUrl(meta, page), sourcePath: result.path,
      thumbnail: page.thumbnail || (platform === "youtube" ? `https://i.ytimg.com/vi/${page.cid}/hqdefault.jpg` : meta.thumbnail || ""),
      language: result.track?.lanDoc || result.track?.lan || "", importedAt };
  }
  async function save(storage, meta, page, base, result, importedAt) {
    const record = create(meta, page, base, result, importedAt);
    if (!record) return;
    const previous = (await storage.get(record.id))[record.id];
    record.language ||= previous?.language || "";
    record.thumbnail ||= previous?.thumbnail || "";
    await storage.set({ [record.id]: record });
  }
  async function list(storage) {
    const values = await storage.get(null);
    return Object.entries(values).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  }
  async function remove(storage, id) { await storage.remove(id); }
  root.ImportHistory = { create, save, list, remove };
  if (typeof module !== "undefined") module.exports = root.ImportHistory;
})(globalThis);
