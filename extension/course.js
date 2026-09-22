const $ = id => document.getElementById(id);
let meta = null, pages = [], running = false, stopping = false;
const statusLabels = { pending: "待导入", running: "正在处理", saved: "已导入", exists: "已存在，跳过", missing: "无可用字幕", failed: "失败" };
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
async function request(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type: "course-request", action, meta, base: $("folder").value, ...extra });
  if (!response?.ok) { const error = new Error(response?.error || "扩展连接中断，请重新打开导入页。"); error.fatal = response?.fatal; throw error; }
  return response;
}
function snapshotKey() { return `boc-course-v1:${meta.bvid}:${CourseCore.normalizeFolder($("folder").value)}`; }
async function persist() { await chrome.storage.local.set({ [snapshotKey()]: { title: meta.title, pages, updated: Date.now() }, [`boc-course-base:${meta.bvid}`]: CourseCore.normalizeFolder($("folder").value) }); }
function setBusy(value) {
  running = value;
  for (const id of ["load", "url", "folder", "start", "retry", "select", "clear", "filter"]) $(id).disabled = value;
  $("stop").disabled = !value;
  render();
}
function visiblePages() { return pages.filter(p => $("filter").value === "all" || p.chapter === $("filter").value); }
function render() {
  if (!meta) return;
  $("title").textContent = meta.title;
  $("count").textContent = `${pages.length} P · 已勾选 ${pages.filter(p => p.selected).length} P`;
  try { $("destination").textContent = `保存位置：${CourseCore.courseFolder(meta, $("folder").value)}`; } catch (error) { $("destination").textContent = error.message; }
  $("parts").replaceChildren();
  for (const page of visiblePages()) {
    const row = document.createElement("tr");
    const cells = Array.from({ length: 5 }, () => row.appendChild(document.createElement("td")));
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = page.selected; check.disabled = running; check.setAttribute("aria-label", `选择 P${page.page}`);
    check.addEventListener("change", () => { page.selected = check.checked; render(); }); cells[0].append(check);
    cells[1].textContent = page.page;
    const link = document.createElement("a"); link.textContent = page.part; link.href = CourseCore.videoUrl(meta, page); link.target = "_blank"; link.rel = "noopener"; cells[2].append(link);
    const chapter = document.createElement("input"); chapter.type = "number"; chapter.min = "0"; chapter.max = "999"; chapter.value = page.chapter; chapter.disabled = running; chapter.setAttribute("aria-label", `P${page.page} 章节号`);
    chapter.addEventListener("change", () => { page.chapter = String(Math.min(999, Math.max(0, Math.floor(Number(chapter.value) || 0)))); renderFilters(); render(); }); cells[3].append(chapter);
    cells[4].textContent = `${statusLabels[page.status] || "待导入"}${page.error ? `：${page.error}` : ""}`;
    $("parts").append(row);
  }
}
function renderFilters() {
  const current = $("filter").value;
  $("filter").replaceChildren(new Option("全部章节", "all"));
  for (const chapter of [...new Set(pages.map(p => p.chapter))].sort((a, b) => Number(a) - Number(b))) $("filter").add(new Option(CourseCore.chapterLabel(chapter), chapter));
  $("filter").value = [...$("filter").options].some(o => o.value === current) ? current : "all";
}
async function loadCourse() {
  const bvid = $("url").value.match(/BV[0-9A-Za-z]+/)?.[0];
  if (!bvid) { status("请输入课程的 BV 视频链接。", true); return; }
  $("load").disabled = true;
  status("正在读取课程目录…");
  try {
    const result = await request("meta", { bvid }); meta = result.meta;
    if (!meta.pages.length) throw new Error("该视频没有可读取的分 P 目录。");
    const baseKey = `boc-course-base:${meta.bvid}`;
    $("folder").value = (await chrome.storage.local.get(baseKey))[baseKey] || result.folder;
    const cached = (await chrome.storage.local.get(snapshotKey()))[snapshotKey()];
    pages = meta.pages.map(page => {
      const old = cached?.pages?.find(p => p.cid === page.cid);
      return { ...page, chapter: old?.chapter ?? CourseCore.chapterOf(page.part), selected: old?.selected ?? CourseCore.chapterOf(page.part) !== "0", status: old?.status === "running" ? "pending" : old?.status || "pending", error: old?.error || "" };
    });
    renderFilters(); render(); $("course").hidden = false;
    status(`已读取 ${pages.length} P。请核对章节归属后开始导入。已有状态仅供参考，导入时会核实文件是否存在。`);
  } catch (error) { meta = null; pages = []; $("course").hidden = true; status(error.message, true); }
  finally { $("load").disabled = false; }
}
async function runQueue(retryOnly) {
  if (running || !meta) return;
  try { CourseCore.normalizeFolder($("folder").value); } catch (error) { status(error.message, true); return; }
  const selected = pages.filter(p => p.selected && (!retryOnly || ["failed", "missing"].includes(p.status)));
  if (!selected.length) { status("没有符合条件的已勾选分 P。"); return; }
  await navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
    if (!lock) { status("这门课程正在另一个导入页处理，请回到该页面查看。", true); return; }
    stopping = false; setBusy(true); $("progress").max = selected.length; $("progress").value = 0;
    let done = 0, fatalError = null;
    const counts = {};
    try {
      await persist();
      await request("index", { pages }); // Also verifies connection and protects an existing user index.
      for (const page of selected) {
        if (stopping) break;
        page.status = "running"; page.error = ""; render();
        status(`正在处理 ${done + 1}/${selected.length}：P${page.page} ${page.part}`);
        try { const result = await request("import", { page }); page.status = result.status; }
        catch (error) { page.status = "failed"; page.error = error.message; if (error.fatal) fatalError = error; }
        counts[page.status] = (counts[page.status] || 0) + 1;
        done++; $("progress").value = done;
        await persist(); render();
        await request("index", { pages });
        if (fatalError) break;
        if (!stopping && done < selected.length) await new Promise(resolve => setTimeout(resolve, 1200));
      }
      status(`${fatalError ? "已暂停" : stopping ? "已停止" : "本次处理完成"}。新导入 ${counts.saved || 0}，已存在 ${counts.exists || 0}，无字幕 ${counts.missing || 0}，失败 ${counts.failed || 0}，本次未处理 ${selected.length - done}。\n课程目录中已生成“课程导入清单.md”，可交给 AI 按章整理。${fatalError ? `\n${fatalError.message}` : ""}`, Boolean(fatalError));
    } catch (error) { status(`已停止：${error.message}\n已写入的字幕会保留；连接恢复后重新导入即可跳过已有文件并更新清单。`, true); }
    finally { setBusy(false); }
  });
}
$("load").addEventListener("click", loadCourse);
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("filter").addEventListener("change", render);
$("folder").addEventListener("change", () => { pages.forEach(p => { p.status = "pending"; p.error = ""; }); render(); });
$("select").addEventListener("click", () => { const visible = new Set(visiblePages()); pages.forEach(p => p.selected = visible.has(p)); render(); });
$("clear").addEventListener("click", () => { visiblePages().forEach(p => p.selected = false); render(); });
$("start").addEventListener("click", () => runQueue(false).catch(error => status(error.message, true)));
$("retry").addEventListener("click", () => runQueue(true).catch(error => status(error.message, true)));
$("stop").addEventListener("click", () => { stopping = true; $("stop").disabled = true; status("正在停止，等待当前 P 保存完毕…"); });
window.addEventListener("beforeunload", event => { if (running) { event.preventDefault(); event.returnValue = ""; } });
$("url").value = new URLSearchParams(location.search).get("bvid") || "";
if ($("url").value) loadCourse();
