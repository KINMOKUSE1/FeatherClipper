const ui = UiText.popup, format = UiText.format;
const $ = id => document.getElementById(id);
let meta = null, page = null, base = "", settings = null, jobKey = "";
let busy = false, reading = false, previewing = false, hasSubtitle = false;
let videoRun = 0;
let saveScope = "current";
let subtitleMissing = false, subtitleReadFailed = false, subtitleError = "";
let subtitle = null, exporting = false;
let subtitleTracks = [], selectedTrackId = "", subtitleLanguage = "", languageMenuOpen = false;
function status(text, error = false) {
  $("status").textContent = UiText.i18n.error(text); $("status").classList.toggle("error", error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(UiText.i18n.error(result?.error) || ui.connectionLost);
  return result;
}
$("subtitles").addEventListener("click", async event => {
  const link = event.target.closest("a");
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  try { await send({ type: "video-seek", url: link.href }); }
  catch (error) { status(error.message, true); }
});
function setSourceOpen(open) {
  $("source-panel").hidden = !open;
  $("source-label").setAttribute("aria-expanded", String(open));
}

$("source-label").addEventListener("click", () => {
  const open = $("source-panel").hidden;
  setSourceOpen(open);

  if (open) $("url").focus();
});
function controls() {
  const locked = busy || reading || previewing || exporting;
  $("read").disabled = $("url").disabled = locked;
  const all = saveScope === "all" && meta?.pages.length > 1;
  const showAsr =
    (subtitleMissing || (meta?.platform === "youtube" && subtitleReadFailed)) &&
    !all &&
    !busy &&
    !reading &&
    !previewing &&
    !exporting;

  $("asr-open").hidden = !showAsr;
  $("asr-open").textContent = subtitleReadFailed ? ui.tryTranscription : ui.transcribe;
  $("save-actions").hidden = showAsr;
  $("import").disabled = locked || !page || (!all && !hasSubtitle) || !settings?.hasApiKey;
  $("save-menu-toggle").hidden = all;
  $("save-menu-toggle").disabled = $("copy-subtitle").disabled = $("download-subtitle").disabled = locked || !page || !hasSubtitle || all;
  if ($("save-menu-toggle").disabled) closeSaveMenu();
  $("import-label").textContent = busy ? ui.saving : all ? format(ui.saveCourse, { count: meta.pages.length, unit: meta.platform === "youtube" ? ui.videoUnit : ui.partUnit }) : meta?.pages.length > 1 ? ui.saveCurrent : ui.save;
  $("scope-current").disabled = $("scope-all").disabled = locked;
  $("subtitle-language").disabled = locked;
  if (locked) closeLanguageMenu();
  $("scope-current").setAttribute("aria-pressed", String(!all));
  $("scope-all").setAttribute("aria-pressed", String(all));
  $("settings").disabled = locked || !settings;
  $("workspace").disabled = busy || reading || exporting;
  $("asr-open").disabled = locked || !settings?.hasApiKey;
}
function closeSaveMenu(restoreFocus = false) {
  $("save-menu").hidden = true;
  $("save-menu-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("save-menu-toggle").focus();
}
function openSaveMenu(last = false) {
  if ($("save-menu-toggle").disabled) return;
  $("save-menu").hidden = false;
  $("save-menu-toggle").setAttribute("aria-expanded", "true");
  $(last ? "download-subtitle" : "copy-subtitle").focus();
}
$("save-menu-toggle").addEventListener("click", () => {
  if ($("save-menu").hidden) openSaveMenu(); else closeSaveMenu();
});
$("save-menu-toggle").addEventListener("keydown", event => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault(); openSaveMenu(event.key === "ArrowUp");
});
$("save-actions").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closeSaveMenu(true); }
  else if (!$("save-menu").hidden && ["ArrowDown", "ArrowUp"].includes(event.key) && event.target !== $("save-menu-toggle")) {
    event.preventDefault();
    $(event.target === $("copy-subtitle") ? "download-subtitle" : "copy-subtitle").focus();
  }
});
$("save-actions").addEventListener("focusout", event => {
  if (!event.currentTarget.contains(event.relatedTarget)) closeSaveMenu();
});
document.addEventListener("click", event => {
  if (!$("save-actions").contains(event.target)) closeSaveMenu();
});
async function exportSubtitle(download = false) {
  if ($(download ? "download-subtitle" : "copy-subtitle").disabled) return;
  closeSaveMenu(true);
  exporting = true; controls();
  try {
    const markdown = CourseCore.buildRaw(meta, { ...page, chapter: CourseCore.chapterOf(page.part) }, subtitle.track || {}, subtitle.body);
    if (download) {
      await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`, filename: CourseCore.rawPath(meta, page, base).split("/").pop(), saveAs: true });
      status(ui.saveRequested);
    } else {
      await navigator.clipboard.writeText(markdown);
      status(ui.copied);
    }
  } catch (error) { status(format(ui.exportFailed, { action: download ? ui.saveAction : ui.copyAction, error: error.message }), true); }
  finally { exporting = false; controls(); }
}
$("copy-subtitle").addEventListener("click", () => exportSubtitle());
$("download-subtitle").addEventListener("click", () => exportSubtitle(true));
function showJob(state) {
  busy = state?.status === "running";
  const text = { running: ui.jobRunning, saved: ui.jobSaved, exists: ui.jobExists, missing: ui.jobMissing }[state?.status];
  if (text || state?.error) status(text || state.error, state?.status === "failed");
  controls();
}
async function refreshSettings() {
  settings = (await send({ type: "settings-get" })).settings;
  $("settings-label").hidden = settings.hasApiKey;
  controls();
}
function closeLanguageMenu(restoreFocus = false) {
  if (!languageMenuOpen) return;
  $("subtitle-language-menu").hidePopover();
  languageMenuOpen = false;
  $("subtitle-language").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("subtitle-language").focus();
}
function openLanguageMenu(last = false) {
  if ($("subtitle-language").disabled) return;
  const menu = $("subtitle-language-menu"), rect = $("subtitle-language").getBoundingClientRect();
  menu.showPopover(); languageMenuOpen = true;
  menu.style.left = `${Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, rect.bottom + 6 + menu.offsetHeight > document.documentElement.clientHeight ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6)}px`;
  $("subtitle-language").setAttribute("aria-expanded", "true");
  const options = [...menu.children];
  (last ? options.at(-1) : options.find(option => option.getAttribute("aria-checked") === "true") || options[0])?.focus({ preventScroll: true });
}
function renderLanguageMenu() {
  const menu = $("subtitle-language-menu"); menu.textContent = "";
  for (const track of [{ id: "", lanDoc: ui.automatic }, ...subtitleTracks]) {
    const option = document.createElement("button");
    option.type = "button"; option.textContent = track.lanDoc || track.lan;
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-label", option.textContent);
    option.setAttribute("aria-checked", String(track.id === selectedTrackId));
    option.addEventListener("click", async () => {
      selectedTrackId = track.id; subtitleLanguage = track.id ? track.lan : "";
      $("subtitle-language-label").textContent = track.lanDoc || track.lan;
      closeLanguageMenu(true); status("");
      await preview();
    });
    menu.append(option);
  }
}
$("subtitle-language").addEventListener("click", event => {
  event.stopPropagation();
  if (languageMenuOpen) closeLanguageMenu(); else openLanguageMenu();
});
$("subtitle-language").addEventListener("keydown", event => {
  event.stopPropagation();
  if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openLanguageMenu(event.key === "ArrowUp"); }
});
$("subtitle-language-menu").addEventListener("toggle", event => {
  languageMenuOpen = event.newState === "open";
  $("subtitle-language").setAttribute("aria-expanded", String(languageMenuOpen));
});
$("subtitle-language-menu").addEventListener("keydown", event => {
  const options = [...event.currentTarget.children], index = options.indexOf(event.target);
  if (event.key === "Escape") { event.preventDefault(); closeLanguageMenu(true); }
  else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }
});
document.addEventListener("scroll", event => { if (event.target !== $("subtitle-language-menu")) closeLanguageMenu(); }, true);
async function preview() {
  previewing = true;
  hasSubtitle = false;
  subtitle = null;
  subtitleMissing = false; subtitleReadFailed = false; subtitleError = "";
  controls();
  $("asr-open").hidden = true;
  $("subtitles").textContent = ui.readingSubtitles;
  $("subtitle-track").textContent = "";
  $("preview-label").textContent = ui.readingSubtitles;
  try {
    const result = await send({ type: "course-request", action: "preview", meta, page, trackId: selectedTrackId });
    subtitleTracks = result.tracks || [];
    $("subtitle-language-switch").hidden = subtitleTracks.length < 2;
    if (result.track?.id) selectedTrackId = result.track.id;
    $("subtitle-language-label").textContent = result.track?.lanDoc || result.track?.lan || ui.automatic;
    renderLanguageMenu();
    $("subtitle-track").hidden = !$("subtitle-language-switch").hidden;
    $("subtitle-track").textContent = result.track?.lanDoc || result.track?.lan || "";
    hasSubtitle = Boolean(result.body?.length);
    if (hasSubtitle) subtitle = result;
    $("preview-label").textContent = hasSubtitle ? ui.subtitlePreview : ui.noSubtitles;
    subtitleMissing = result.missing === true && !hasSubtitle;
    $("subtitles").textContent = hasSubtitle ? "" : ui.transcriptionHint;
    for (const item of CourseCore.groupSubtitles(result.body, meta.platform).slice(0, 12)) {
      const line = document.createElement("p"), time = document.createElement("a");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      time.href = CourseCore.timestampUrl(meta, page, item.from); time.target = "_blank"; time.rel = "noopener";
      line.append(time, document.createTextNode(item.content)); $("subtitles").append(line);
    }
  } catch (error) {
    subtitleReadFailed = true; subtitleError = error.message;
    renderLanguageMenu();
    $("subtitles").textContent = format(ui.subtitleError, { error: error.message });
    $("preview-label").textContent = ui.subtitleFailed;
    $("preview-panel").open = true;
  }
  finally { previewing = false; controls(); }
}
async function loadVideo() {
  if (busy || reading || previewing || exporting) return;
  const source = $("url").value.trim();
  const parsed = CourseCore.parseSource(source);
  if (!parsed) { status(ui.invalidSource, true); return; }
  const number = parsed.page;
  const run = ++videoRun;
  reading = true; page = null; meta = null; jobKey = ""; hasSubtitle = false; saveScope = "current"; controls();
  $("video").hidden = true; $("empty").hidden = true; $("workspace").hidden = true;
  $("preview-panel").open = false; status(ui.recognizing);
  closeLanguageMenu(); subtitleTracks = []; selectedTrackId = ""; subtitleLanguage = "";
  $("subtitle-language-switch").hidden = true; $("subtitle-track").hidden = false; $("subtitle-language-label").textContent = ui.automatic;
  try {
    const data = await send({ type: "course-request", action: "meta", ...(parsed.platform === "youtube" ? { youtubeId: parsed.id, playlistId: parsed.playlistId } : { bvid: parsed.id }) });
    if (run !== videoRun) return;
    meta = data.meta; page = meta.pages.find(item => parsed.platform === "youtube" ? item.cid === parsed.id : item.page === number);
    if (!page) throw new Error(format(ui.missingPage, { number }));
    const baseKey = `boc-course-base:${meta.bvid}`;
    const storedBase = await chrome.storage.local.get(baseKey);
    if (run !== videoRun) return;
    base = storedBase[baseKey] || data.folder;
    const series = meta.pages.length > 1;
    const unit = meta.platform === "youtube" ? ui.videoUnit : ui.partUnit;
    $("video-meta").textContent = format(ui.videoMeta, { platform: meta.platform === "youtube" ? "YouTube" : "Bilibili", description: series ? format(ui.series, { count: meta.pages.length, unit }) : ui.singleVideo });
    $("course-name").textContent = meta.title;
    $("part-name").textContent = page.part;
    $("part-number").textContent = `${meta.platform === "youtube" ? "" : "P"}${page.page} / ${meta.pages.length}`;
    $("current-part").hidden = !series;
    $("save-scope").hidden = !series;
    $("scope-all").textContent = format(ui.wholeCourse, { count: meta.pages.length, unit });
    $("workspace").hidden = false;
    $("workspace-label").textContent = series ? ui.chooseLessons : ui.openWorkbench;
    $("video").hidden = false;
    setSourceOpen(false);
    status(settings.hasApiKey ? "" : ui.connectionRequired);
    const job = await send({ type: "quick-status", bvid: meta.bvid, cid: page.cid, base });
    if (run !== videoRun) return;
    jobKey = job.key; showJob(job.state);
    reading = false;
    await preview();
    if (run !== videoRun) return;
  } catch (error) {
    if (run === videoRun) {
      page = null; meta = null; $("video").hidden = true; $("empty").hidden = false; $("workspace").hidden = true;
      setSourceOpen(true); status(error.message, true);
    }
  }
  finally { if (run === videoRun) { reading = false; controls(); } }
}
$("source-form").addEventListener("submit", event => { event.preventDefault(); loadVideo(); });
for (const scope of ["current", "all"]) {
  $(`scope-${scope}`).addEventListener("click", () => { saveScope = scope; controls(); });
}
function addSubtitleHandoff(target) {
  if (!meta || !page || previewing || (!subtitleMissing && !subtitleReadFailed)) return;
  target.searchParams.set("subtitlePreview", JSON.stringify({ bvid: meta.bvid, cid: page.cid, status: subtitleMissing ? "missing" : "failed", error: subtitleError }));
}
$("asr-open").addEventListener("click", async () => {
  if ($( "asr-open").disabled || !meta || !page) return;
  const target = new URL(chrome.runtime.getURL("workbench/index.html"));
  target.searchParams.set(meta.platform === "youtube" ? "youtubeId" : "bvid", meta.platform === "youtube" ? meta.videoId : meta.bvid);
  if (meta.playlistId) target.searchParams.set("playlistId", meta.playlistId);
  target.searchParams.set("p", page.page);
  target.searchParams.set("asr", "1");
  if (subtitleLanguage) target.searchParams.set("subtitleLanguage", subtitleLanguage);
  addSubtitleHandoff(target);
  await chrome.tabs.create({ url: target.href }); window.close();
});
$("import").addEventListener("click", async () => {
  if ($("import").disabled) return;
  if (saveScope === "all" && meta.pages.length > 1) {
    try { await openWorkspace(true); } catch (error) { status(error.message, true); }
    return;
  }
  showJob({ status: "running" });
  try { showJob(await send({ type: "quick-import", locale: UiText.i18n.outputLocale(), bvid: meta.bvid, cid: page.cid, meta, base, trackId: subtitle?.track?.id || selectedTrackId })); }
  catch (error) { showJob({ status: "failed", error: error.message }); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && jobKey && changes[jobKey]) showJob(changes[jobKey].newValue);
});
async function openWorkspace(selectAll = false) {
  const target = new URL(chrome.runtime.getURL("workbench/index.html"));
  if (meta && page) { target.searchParams.set(meta.platform === "youtube" ? "youtubeId" : "bvid", meta.platform === "youtube" ? meta.videoId : meta.bvid); if (meta.playlistId) target.searchParams.set("playlistId", meta.playlistId); target.searchParams.set("p", page.page); }
  if (meta && subtitleLanguage) target.searchParams.set("subtitleLanguage", subtitleLanguage);
  if (selectAll) target.searchParams.set("scope", "all");
  addSubtitleHandoff(target);
  await chrome.tabs.create({ url: target.href }); window.close();
}
$("workspace").addEventListener("click", () => openWorkspace().catch(error => status(error.message, true)));
$("settings").addEventListener("click", () => {
  $("api-url").value = settings.obsidianApiBaseUrl; $("api-key").value = "";
  $("api-key").placeholder = settings.hasApiKey ? ui.savedKey : ui.keyPlaceholder;
  $("note-folder").value = settings.noteFolder; $("settings-status").textContent = "";
  $("clipper").hidden = true; $("connection").hidden = false;
});
$("back").addEventListener("click", () => { $("connection").hidden = true; $("clipper").hidden = false; });
async function saveSettings(testOnly) {
  const ids = ["test", "save", "api-url", "api-key", "note-folder", "back"];
  ids.forEach(id => $(id).disabled = true);
  $("settings-status").textContent = testOnly ? ui.testing : ui.saving;
  try {
    await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("note-folder").value } });
    if (testOnly) $("settings-status").textContent = ui.tested;
    else {
      $("api-key").value = ""; await refreshSettings();
      $("connection").hidden = true; $("clipper").hidden = false;
      if (page) await loadVideo(); else status(ui.settingsSaved);
    }
  } catch (error) { $("settings-status").textContent = error.message; }
  finally { ids.forEach(id => $(id).disabled = false); }
}
$("test").addEventListener("click", () => saveSettings(true));
$("save").addEventListener("click", () => saveSettings(false));
async function init() {
  if (await window.PopupLanguageReady === false) return;
  await UiText.i18n.ready;
  UiText.i18n.apply(document);
  await refreshSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url);
    if (CourseCore.parseSource(url.href)) {
      $("url").value = url.href; await loadVideo();
    }
  } catch { /* Non-video tabs use the manual input. */ }
}
UiText.i18n.subscribe(() => {
  controls(); renderLanguageMenu();
  $("status").textContent = UiText.i18n.error($("status").textContent);
  $("settings-status").textContent = UiText.i18n.error($("settings-status").textContent);
  if (page) {
    $("preview-label").textContent = previewing ? ui.readingSubtitles : subtitleReadFailed ? ui.subtitleFailed : hasSubtitle ? ui.subtitlePreview : ui.noSubtitles;
    if (!hasSubtitle) $("subtitles").textContent = subtitleReadFailed ? UiText.i18n.error(subtitleError) : previewing ? ui.readingSubtitles : ui.transcriptionHint;
  }
  if (meta) {
    const count = meta.pages.length;
    $("video-meta").textContent = format(ui.videoMeta, { platform: meta.platform === "youtube" ? "YouTube" : UiText.i18n.t("B站"), description: count > 1 ? format(ui.series, { count, unit: meta.platform === "youtube" ? ui.videoUnit : ui.partUnit }) : ui.singleVideo });
    $("scope-all").textContent = format(ui.wholeCourse, { count, unit: meta.platform === "youtube" ? ui.videoUnit : ui.partUnit });
    $("workspace-label").textContent = count > 1 ? ui.chooseLessons : ui.openWorkbench;
  }
});
init().catch(error => status(error.message, true));
