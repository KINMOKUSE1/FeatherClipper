/* Obsidian 文件读写及已导入素材查找。 */
async function courseLocalRequest(filepath, method = "GET", content, expectJson = false) {
  let settings;
  try { settings = normalizeConnection(await getMergedSettings()); }
  catch (error) { error.fatal = true; throw error; }
  if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) {
    const error = new Error("请先在设置中填写 Obsidian Local REST API 地址和 Key。");
    error.fatal = true;
    throw error;
  }
  const endpoint = `${settings.obsidianApiBaseUrl.replace(/\/+$/, "")}/vault/${filepath.split("/").map(encodeURIComponent).join("/")}`;
  let response;
  try {
    response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${settings.obsidianApiKey}`, Accept: expectJson ? "application/json" : "text/markdown", "Content-Type": "text/markdown; charset=utf-8" }, body: content, signal: AbortSignal.timeout(15000) });
  } catch {
    const error = new Error("无法连接 Obsidian，请确认它已打开且 Local REST API 正在运行。");
    error.fatal = true;
    throw error;
  }
  if (method === "GET" && response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Obsidian 请求失败 HTTP ${response.status}`);
    error.fatal = true;
    throw error;
  }
  return method === "GET" ? expectJson ? response.json() : response.text() : true;
}
async function courseRawFiles(meta, base) {
  const folder = CourseCore.courseFolder(meta, base), files = [];
  for (const name of CourseCore.rawDirectories()) {
    const directory = `${folder}/${name}/`;
    const listing = await courseLocalRequest(directory, "GET", undefined, true);
    if (listing === null) continue;
    if (!Array.isArray(listing.files) || !listing.files.every(file => typeof file === "string")) {
      const error = new Error("无法读取原始字幕目录，已停止以避免重复导入。");
      error.fatal = true;
      throw error;
    }
    files.push(...listing.files.map(file => directory + file));
  }
  return files;
}
function existingRawPath(meta, page, base, files) {
  const currentName = CourseCore.rawPath(meta, page, base).split("/").pop();
  const suffix = meta.platform === "youtube" ? ` [YT-${page.cid}].md` : ` [CID-${page.cid}].md`;
  const path = files.find(path => path.split("/").pop() === currentName)
    || files.find(path => (meta.platform !== "youtube" && path.split("/").pop() === `CID-${page.cid}.md`) || path.endsWith(suffix));
  return path || null;
}
async function courseRawSources(meta, pages, base) {
  const files = await courseRawFiles(meta, base);
  return Object.fromEntries(pages.map(page => [page.cid, existingRawPath(meta, page, base, files)]).filter(([, path]) => path));
}
async function existingCourseIndex(meta, base, locale) {
  const preferred = CourseCore.indexPath(meta, base, locale);
  for (const path of [preferred, CourseCore.indexPath(meta, base, locale === "en" ? "zh-CN" : "en")]) {
    const content = await courseLocalRequest(path);
    if (content !== null) return { path, content };
  }
  return { path: preferred, content: null };
}
