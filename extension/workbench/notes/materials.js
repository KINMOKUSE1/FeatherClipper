/* 本次任务的实际素材读取；每次查询最新路径，不缓存 Obsidian 连接结果。 */
async function collectNoteMaterials({ catalog, core, delivery: currentDelivery, uploadedMaterials = [], uploadedReferences = [] }) {
  const { meta, pages, folder } = catalog.getState();
  const selected = pages.filter(page => page.selected), materials = [];
  let index = "";
  if (currentDelivery.environment === "web") {
    const results = await Promise.all(selected.map(async page => {
      const item = { label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter), fileName: `素材/P${String(page.page).padStart(2, "0")}-${core.safeName(page.part)}.md` };
      try {
        const result = await catalog.request("preview", { page });
        if (!result.body?.length) return { ...item, missing: "没有可用字幕" };
        return { ...item, content: core.buildRaw(meta, page, result.track || {}, result.body) };
      } catch (error) { return { ...item, missing: error.message }; }
    }));
    materials.push(...results, ...uploadedMaterials.map(item => ({ ...item, label: item.fileName, chapter: "用户提供文件" })));
  } else {
    let sources = {}, lookupError = "";
    const paths = currentDelivery.paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
    if (meta && selected.length) {
      try { ({ sources } = await catalog.request("raw-paths", { pages: selected })); }
      catch (error) {
        if (!paths.length && !(currentDelivery.task === "review" && currentDelivery.reference.trim())) throw error;
        lookupError = error.message;
      }
      if (Object.keys(sources).length) index = `${core.courseFolder(meta, folder)}/课程导入清单.md`;
    }
    materials.push(...selected.map(page => ({ label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter), path: sources[page.cid], missing: lookupError || (page.status === "missing" ? "没有可用字幕" : "尚未找到已导入文件") })),
      ...paths.map(path => ({ label: path.split(/[\\/]/).at(-1), chapter: "用户指定文件", path })));
  }
  return { course: meta?.title || "用户提供的课程素材", index, materials,
    references: ["supplement", "continue", "review"].includes(currentDelivery.task) ? uploadedReferences : [] };
}
if (typeof module !== "undefined" && module.exports) module.exports = collectNoteMaterials;
else window.collectNoteMaterials = collectNoteMaterials;
