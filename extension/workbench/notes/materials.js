/* 本次任务的实际素材读取；每次查询最新路径，不缓存 Obsidian 连接结果。 */
async function collectNoteMaterials({ catalog, core, delivery: currentDelivery, uploadedMaterials = [], uploadedReferences = [] }) {
  const ui = (typeof module !== "undefined" && module.exports ? require("../../shared/ui-text.js") : window.UiText).materials;
  const { meta, pages, folder } = catalog.getState();
  const selected = pages.filter(page => page.selected), materials = [];
  let index = "";
  if (currentDelivery.environment === "web") {
    const results = await Promise.all(selected.map(async page => {
      const item = { label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter), fileName: `素材/P${String(page.page).padStart(2, "0")}-${core.safeName(page.part)}.md` };
      try {
        const result = await catalog.request("preview", { page });
        if (!result.body?.length) return { ...item, missing: ui.missingSubtitle };
        return { ...item, content: core.buildRaw(meta, page, result.track || {}, result.body) };
      } catch (error) { return { ...item, missing: error.message }; }
    }));
    materials.push(...results, ...uploadedMaterials.map(item => ({ ...item, label: item.fileName, chapter: ui.uploadedGroup })));
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
    materials.push(...selected.map(page => ({ label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter), path: sources[page.cid], missing: lookupError || (page.status === "missing" ? ui.missingSubtitle : ui.missingFile) })),
      ...paths.map(path => ({ label: path.split(/[\\/]/).at(-1), chapter: ui.manualGroup, path })));
  }
  return { course: meta?.title || ui.manualCourse, index, materials,
    references: ["supplement", "continue", "review"].includes(currentDelivery.task) ? uploadedReferences : [] };
}
if (typeof module !== "undefined" && module.exports) module.exports = collectNoteMaterials;
else window.collectNoteMaterials = collectNoteMaterials;
