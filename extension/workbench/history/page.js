/* 导入记录：读取本地历史、筛选、回到课程和移除记录。 */
window.createHistoryPage = function ({ catalog, feedback, navigate }) {
  const ui = UiText.history, format = UiText.format;
  const get = id => document.getElementById(id);
  const storage = chrome.storage.local;
  const menu = get("history-menu");
  let records = [], activeRecord = null, activeButton = null;
  function button(text, className, activate) {
    const node = document.createElement("button");
    node.type = "button"; node.className = className; node.textContent = text;
    node.addEventListener("click", activate); return node;
  }
  function report(text) { feedback.settings("history-status", text); }
  async function open(record, course = false) {
    closeMenu();
    const url = new URL(record.sourceUrl);
    if (record.playlistId) url.searchParams.set("list", record.playlistId);
    if (course && record.platform === "bilibili") url.searchParams.set("p", "1");
    navigate("catalog-page");
    await catalog.loadCourse({ source: url.href, base: record.base, preview: !course });
  }
  function closeMenu(restoreFocus = false) {
    if (menu.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus) activeButton?.focus();
  }
  function openMenu(record, trigger) {
    activeButton?.setAttribute("aria-expanded", "false");
    activeRecord = record; activeButton = trigger;
    get("history-original").href = record.sourceUrl;
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
      && `${record.title} ${record.courseTitle}`.toLocaleLowerCase().includes(query));
    filtered.sort((a, b) => order === "oldest" ? a.importedAt - b.importedAt : b.importedAt - a.importedAt);
    get("history-count").textContent = format(ui.count, { count: filtered.length });
    get("history-empty").hidden = filtered.length > 0;
    get("history-empty").textContent = records.length ? ui.noMatches : ui.empty;
    get("history-list").replaceChildren(...filtered.map(record => {
      const row = document.createElement("article"); row.className = "history-row"; row.setAttribute("role", "listitem");
      const cover = button("", "history-cover", () => open(record));
      cover.setAttribute("aria-label", format(ui.openVideo, { title: record.title }));
      const placeholder = document.createElement("span"); placeholder.className = "icon icon-captions"; placeholder.setAttribute("aria-hidden", "true"); cover.append(placeholder);
      if (record.thumbnail) {
        const image = document.createElement("img"); image.src = record.thumbnail; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove(), { once: true }); cover.append(image);
      }
      const content = document.createElement("div"); content.className = "history-content";
      const title = button(record.title, "history-video-title", () => open(record)); title.title = record.title;
      const meta = document.createElement("p"); meta.className = "history-meta";
      const course = button(record.courseTitle, "history-course", () => open(record, true));
      const source = document.createElement("span");
      source.textContent = [record.platform === "youtube" ? "YouTube" : "B站", record.language].filter(Boolean).join(" · ");
      meta.append(course, source); content.append(title, meta);
      const date = new Date(record.importedAt), time = document.createElement("time"); time.className = "history-date"; time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat("zh-CN", { ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
      time.title = date.toLocaleString("zh-CN");
      const more = button("⋯", "history-more", () => menu.matches(":popover-open") && activeButton === more ? closeMenu() : openMenu(record, more));
      more.setAttribute("aria-label", format(ui.more, { title: record.title })); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.setAttribute("aria-controls", "history-menu");
      row.append(cover, content, time, more); return row;
    }));
  }
  async function load() { records = await ImportHistory.list(storage); render(); }
  get("history-nav").addEventListener("click", async () => {
    navigate("history-page"); report("");
    try { await load(); } catch (error) { report(error.message); }
  });
  get("history-search").addEventListener("input", render);
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
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.disabled);
    const index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    } else if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    else if (event.key === "Tab") closeMenu();
  });
  get("history-page").querySelector(".history-scroll").addEventListener("scroll", () => closeMenu());
  window.addEventListener("resize", () => closeMenu());
  return { load };
};
