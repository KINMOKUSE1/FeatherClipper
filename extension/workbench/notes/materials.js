/* 本次任务的实际素材读取；每次查询最新路径，不缓存 Obsidian 连接结果。 */
async function collectNoteMaterials({ catalog, core, delivery: currentDelivery, uploadedMaterials = [], uploadedReferences = [] }) {
  const copy = typeof module !== "undefined" && module.exports ? require("../../shared/ui-text.js") : window.UiText;
  const outputLocale = currentDelivery.outputLocale || copy.i18n.outputLocale();
  const outputText = (text, values) => copy.i18n.t(text, values, outputLocale);
  const ui = copy.forLocale(outputLocale).materials;
  function uploadPath(item, reference = false) {
    const prefix = outputText(reference ? "已有笔记" : "素材");
    return { ...item, fileName: `${prefix}/${item.fileName.includes("/") ? item.fileName.split("/").slice(1).join("/") : item.fileName}` };
  }
  const { meta, pages, folder } = catalog.getState();
  const selected = pages.filter(page => page.selected), materials = [];
  let index = "";
  if (currentDelivery.environment === "web") {
    if (uploadedMaterials.length > 1) throw new Error(copy.validation.webSingleFile);
    if (!uploadedMaterials.length && selected.length > 1) throw new Error(copy.validation.webSingleVideo);
    const results = await Promise.all((uploadedMaterials.length ? [] : selected).map(async page => {
      const item = { label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter, outputLocale), fileName: outputText("素材/P{0}-{1}.md", { "0": (String(page.page).padStart(2, "0")), "1": (core.safeName(page.part)) }) };
      try {
        const result = await catalog.request("preview", { page });
        if (!result.body?.length) return { ...item, missing: ui.missingSubtitle };
        return { ...item, content: core.buildRaw(meta, page, result.track || {}, result.body, outputLocale) };
      } catch (error) { return { ...item, missing: error.message }; }
    }));
    materials.push(...results, ...uploadedMaterials.map(item => ({ ...uploadPath(item), label: item.fileName, chapter: ui.uploadedGroup })));
  } else {
    let sources = {}, lookupError = "";
    const paths = currentDelivery.paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
    if (meta && selected.length) {
      try { const result = await catalog.request("raw-paths", { pages: selected }); sources = result.sources; index = result.index || ""; }
      catch (error) {
        if (!paths.length && !(currentDelivery.task === "review" && currentDelivery.reference.trim())) throw error;
        lookupError = error.message;
      }
    }
    materials.push(...selected.map(page => ({ label: `P${page.page} ${page.part}`, chapter: core.chapterLabel(page.chapter, outputLocale), path: sources[page.cid], missing: lookupError || (page.status === "missing" ? ui.missingSubtitle : ui.missingFile) })),
      ...paths.map(path => ({ label: path.split(/[\\/]/).at(-1), chapter: ui.manualGroup, path })));
  }
  return { course: currentDelivery.environment === "web" && uploadedMaterials.length ? ui.manualCourse : meta?.title || ui.manualCourse, index, materials,
    references: ["supplement", "continue", "review"].includes(currentDelivery.task) ? uploadedReferences.map(item => uploadPath(item, true)) : [] };
}
if (typeof module !== "undefined" && module.exports) module.exports = collectNoteMaterials;
else window.collectNoteMaterials = collectNoteMaterials;
