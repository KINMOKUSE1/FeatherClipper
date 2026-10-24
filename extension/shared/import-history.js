/* 按视频保存导入结果，读取时按课程归并；不保存字幕正文。 */
(function (root) {
  const prefix = "featherclipper:import-history:";
  function create(meta, page, base, result, importedAt = Date.now()) {
    if (!["saved", "exists"].includes(result.status) || !result.path) return null;
    const platform = meta.platform || "bilibili";
    const folder = root.CourseCore.normalizeFolder(base);
    const coursePath = root.CourseCore.courseFolder(meta, folder);
    const id = `${prefix}${meta.bvid}:${page.cid}:${coursePath}`;
    return { id, platform, courseId: meta.bvid, cid: page.cid, page: page.page,
      title: meta.playlistId || meta.pages.length > 1 ? page.part : meta.title, courseTitle: meta.title,
      isSeries: Boolean(meta.playlistId || meta.pages.length > 1), totalVideos: meta.pages.length,
      coursePath,
      courseThumbnail: meta.thumbnail || (platform === "youtube" ? `https://i.ytimg.com/vi/${meta.pages[0].cid}/hqdefault.jpg` : page.thumbnail || ""),
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
    record.courseThumbnail ||= previous?.courseThumbnail || "";
    await storage.set({ [record.id]: record });
  }
  async function list(storage) {
    const values = await storage.get(null);
    const groups = new Map();
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(prefix)) continue;
      const id = `${prefix}${value.platform}:${value.courseId}`;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({ ...value, id: key });
    }
    return [...groups].map(([id, entries]) => {
      entries.sort((a, b) => b.importedAt - a.importedAt);
      const latest = entries[0];
      const cached = values[`boc-course-v1:${latest.courseId}:${latest.base}`];
      const videos = new Map();
      for (const entry of entries) {
        const cid = String(entry.cid);
        if (!videos.has(cid)) videos.set(cid, { ...entry });
        else videos.get(cid).language ||= entry.language;
      }
      const isSeries = entries.some(entry => entry.isSeries || entry.playlistId)
        || (cached?.pages.length || 0) > 1 || videos.size > 1
        || entries.some(entry => entry.isSeries === undefined && entry.title !== entry.courseTitle);
      const totalVideos = latest.totalVideos ?? cached?.pages.length ?? (isSeries ? null : 1);
      const ordered = [...videos.values()].sort((a, b) => a.page - b.page);
      const source = new URL(latest.sourceUrl);
      if (isSeries && latest.platform === "bilibili") source.searchParams.set("p", "1");
      if (latest.playlistId) source.searchParams.set("list", latest.playlistId);
      return { ...latest, id, isSeries, totalVideos, importedCount: videos.size,
        title: isSeries ? latest.courseTitle : latest.title,
        thumbnail: isSeries ? latest.courseThumbnail || cached?.pages[0]?.thumbnail
          || (latest.platform === "youtube" && cached?.pages[0]?.cid ? `https://i.ytimg.com/vi/${cached.pages[0].cid}/hqdefault.jpg` : latest.thumbnail) : latest.thumbnail,
        sourceUrl: source.href,
        sourcePath: isSeries ? latest.coursePath || latest.sourcePath.split(/\/(?:原始字幕|Raw Subtitles)\//)[0] : latest.sourcePath,
        videos: ordered, storageIds: entries.map(entry => entry.id) };
    });
  }
  async function remove(storage, id) {
    const record = (await list(storage)).find(record => record.id === id);
    if (record) await storage.remove(record.storageIds);
  }
  root.ImportHistory = { create, save, list, remove };
  if (typeof module !== "undefined") module.exports = root.ImportHistory;
})(globalThis);
