/* 导入记录：课程汇总、已导入视频详情、筛选和移除记录。 */
window.createHistoryPage = function ({ catalog, feedback, navigate }) {
  const ui = UiText.history, format = UiText.format;
  const get = id => document.getElementById(id);
  const storage = chrome.storage.local;
  const menu = get("history-menu");
  let records = [], activeRecord = null, activeButton = null, detailRecord = null, detailTrigger = null;
  function button(text, className, activate) {
    const node = document.createElement("button");
    node.type = "button"; node.className = className; node.textContent = text;
    node.addEventListener("click", activate); return node;
  }
  function report(text) { feedback.settings("history-status", text); }
  async function openMaterials(record) {
    closeMenu();
    navigate("catalog-page");
    try { await catalog.loadCourse({ source: record.sourceUrl, base: record.base, preview: !record.isSeries }); }
    catch (error) { feedback.status(error.message, true); }
  }
  function link(text, className, href) {
    const node = document.createElement("a");
    node.className = className; node.textContent = text;
    node.href = href; node.target = "_blank"; node.rel = "noopener";
    return node;
  }
  function fillCover(cover, thumbnail) {
    const placeholder = document.createElement("span"); placeholder.className = "icon icon-captions"; placeholder.setAttribute("aria-hidden", "true"); cover.append(placeholder);
    if (!thumbnail) return;
    const image = document.createElement("img"); image.src = thumbnail; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true }); cover.append(image);
  }
  function progress(record) {
    return format(ui.progress, { imported: record.importedCount, total: record.totalVideos ?? "—" });
  }
  function dateTime(importedAt) {
    const date = new Date(importedAt), time = document.createElement("time"); time.className = "history-date"; time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat("zh-CN", { ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    time.title = format(ui.recent, { date: date.toLocaleString("zh-CN") });
    time.setAttribute("aria-label", time.title);
    return time;
  }
  function showOverview(restoreFocus = false) {
    closeMenu();
    detailRecord = null;
    get("history-detail").hidden = true;
    get("history-overview").hidden = false;
    if (restoreFocus) detailTrigger?.focus({ preventScroll: true });
  }
  function openDetail(record, trigger) {
    closeMenu(); detailRecord = record; detailTrigger = trigger;
    get("history-overview").hidden = true;
    get("history-detail").hidden = false;
    get("history-detail-title").textContent = record.title;
    const cover = get("history-detail-cover"); cover.replaceChildren(); fillCover(cover, record.thumbnail);
    const source = document.createElement("span"); source.textContent = record.platform === "youtube" ? "YouTube" : "B站";
    const count = document.createElement("strong"); count.className = "history-progress"; count.textContent = progress(record);
    count.title = record.totalVideos === null ? ui.unknownTotal : format(ui.progressLabel, { imported: record.importedCount, total: record.totalVideos });
    get("history-detail-meta").replaceChildren(source, count, dateTime(record.importedAt));
    get("history-detail-list").replaceChildren(...record.videos.map(video => {
      const row = document.createElement("article"); row.className = "history-detail-row"; row.setAttribute("role", "listitem");
      const number = document.createElement("span"); number.className = "history-video-number"; number.textContent = String(video.page).padStart(2, "0");
      const content = document.createElement("div"); content.className = "history-content";
      const title = link(video.title, "history-video-title", video.sourceUrl);
      const original = link(video.sourceUrl, "history-original-link", video.sourceUrl);
      content.append(title, original); row.append(number, content); return row;
    }));
    get("history-detail").querySelector(".history-scroll").scrollTop = 0;
    get("history-detail-title").focus({ preventScroll: true });
  }
  function closeMenu(restoreFocus = false) {
    if (menu.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus) activeButton?.focus();
  }
  function openMenu(record, trigger) {
    activeButton?.setAttribute("aria-expanded", "false");
    activeRecord = record; activeButton = trigger;
    get("history-original").href = record.sourceUrl;
    get("history-original").textContent = record.isSeries ? ui.originalCourse : ui.originalVideo;
    get("history-open").hidden = record.isSeries;
    get("history-copy").textContent = record.isSeries ? ui.copyCourse : ui.copyVideo;
    get("history-copy").disabled = !record.sourcePath;
    menu.showPopover();
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('[role="menuitem"]').focus({ preventScroll: true });
  }
  function render() {
    const query = get("history-search").value.trim().toLocaleLowerCase();
    const source = get("history-source").value, order = get("history-sort").value;
    const filtered = records.filter(record => (source === "all" || record.platform === source)
      && [record.title, ...record.videos.map(video => video.title)].join(" ").toLocaleLowerCase().includes(query));
    filtered.sort((a, b) => order === "oldest" ? a.importedAt - b.importedAt : b.importedAt - a.importedAt);
    get("history-count").textContent = format(ui.count, { count: filtered.length });
    get("history-empty").hidden = filtered.length > 0;
    get("history-empty").textContent = records.length ? ui.noMatches : ui.empty;
    get("history-list").replaceChildren(...filtered.map(record => {
      const row = document.createElement("article"); row.className = "history-row"; row.setAttribute("role", "listitem");
      const cover = record.isSeries ? button("", "history-cover", () => openDetail(record, title)) : link("", "history-cover", record.sourceUrl);
      cover.setAttribute("aria-label", format(record.isSeries ? ui.openCourse : ui.openVideo, { title: record.title }));
      fillCover(cover, record.thumbnail);
      const content = document.createElement("div"); content.className = "history-content";
      const title = record.isSeries ? button(record.title, "history-video-title", () => openDetail(record, title)) : link(record.title, "history-video-title", record.sourceUrl); title.title = record.title;
      const meta = document.createElement("p"); meta.className = "history-meta";
      const source = document.createElement("span");
      source.textContent = [record.platform === "youtube" ? "YouTube" : "B站", record.isSeries ? ui.series : ui.single, record.isSeries ? "" : record.language].filter(Boolean).join(" · ");
      meta.append(source);
      if (record.isSeries) {
        const count = document.createElement("strong"); count.className = "history-progress"; count.textContent = progress(record);
        count.title = record.totalVideos === null ? ui.unknownTotal : format(ui.progressLabel, { imported: record.importedCount, total: record.totalVideos });
        meta.append(count);
        row.classList.add("history-series");
        row.addEventListener("click", event => { if (!event.target.closest("button, a")) openDetail(record, title); });
      }
      content.append(title, meta);
      const more = button("⋯", "history-more", () => menu.matches(":popover-open") && activeButton === more ? closeMenu() : openMenu(record, more));
      more.setAttribute("aria-label", format(ui.more, { title: record.title })); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.setAttribute("aria-controls", "history-menu");
      row.append(cover, content, dateTime(record.importedAt), more); return row;
    }));
  }
  async function load() { records = await ImportHistory.list(storage); showOverview(); render(); }
  get("history-nav").addEventListener("click", async () => {
    navigate("history-page"); report("");
    try { await load(); } catch (error) { report(error.message); }
  });
  get("history-search").addEventListener("input", render);
  get("history-back").addEventListener("click", () => showOverview(true));
  for (const id of ["history-detail-open", "history-open"]) get(id).textContent = ui.enterCatalog;
  get("history-detail-open").addEventListener("click", () => openMaterials(detailRecord));
  get("history-open").addEventListener("click", () => openMaterials(activeRecord));
  get("history-source").addEventListener("change", render);
  get("history-sort").addEventListener("change", render);
  get("history-copy").addEventListener("click", async () => {
    const record = activeRecord; closeMenu(true);
    try { await navigator.clipboard.writeText(record.sourcePath); report(ui.copied); }
    catch (error) { report(error.message); }
  });
  get("history-remove").addEventListener("click", async () => {
    const record = activeRecord; closeMenu();
    try { await ImportHistory.remove(storage, record.id); await load(); get("history-search").focus({ preventScroll: true }); report(ui.removed); }
    catch (error) { report(error.message); }
  });
  get("history-original").addEventListener("click", () => closeMenu(true));
  menu.addEventListener("toggle", event => activeButton?.setAttribute("aria-expanded", String(event.newState === "open")));
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.disabled && !item.hidden);
    const index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    } else if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    else if (event.key === "Tab") closeMenu();
  });
  get("history-page").querySelectorAll(".history-scroll").forEach(scroll => scroll.addEventListener("scroll", () => closeMenu()));
  window.addEventListener("resize", () => closeMenu());
  return { load };
};
