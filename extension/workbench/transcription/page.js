/* 音频转写的引擎设置、组件配对和共用转写队列。 */
window.createTranscriptionPage = function ({ getCatalog, send, feedback, navigate, importAction, previewView }) {
  const ui = UiText.transcription;
  const $ = id => document.getElementById(id);
  const { status, settings: showSettingsFeedback } = feedback;
  let activeAsrJob = "", settings = { provider: "local", hasApiKeys: {} }, localConnection = null;
  const controls = createNoteControls($("asr-page"));
  function renderSettings() {
    const provider = $("asr-provider").value, online = provider !== "local";
    $("asr-key-row").hidden = !online;
    $("asr-local-fields").hidden = online;
    $("asr-refresh").hidden = online;
    $("asr-install-guide").hidden = online || Boolean(localConnection?.connected);
    $("asr-clear-key").hidden = !online || !settings.hasApiKeys?.[provider];
    $("asr-api-key").placeholder = settings.hasApiKeys?.[provider] ? ui.savedKey : ui.keyPlaceholder;
    if (online) $("asr-key-link").href = ui.keyUrls[provider];
    $("asr-provider-help").textContent = online ? ui.onlineHelp : ui.localHelp;
    $("asr-model").textContent = ui.models[provider];
    $("asr-policy").textContent = ui.policies[provider];
    $("asr-policy").title = ui.policyDetails[provider] || ui.policies[provider];
    controls.decorateSelect($("asr-provider"));
  }
  function showConnection(result) {
    if (result.provider && result.provider !== "local") { renderSettings(); return; }
    localConnection = result;
    $("asr-pair-fields").hidden = Boolean(result.paired && !result.needsPairing);
    const connected = result.componentConnected ?? result.connected;
    $("asr-state").textContent = connected ? ui.connected : ui.disconnected;
    $("asr-state").classList.toggle("is-ready", connected);
    renderSettings();
  }
  function reportImportResult(label, counts, remaining, error = null, detail = "") {
    return importAction.result(label, counts, remaining, error, detail, getCatalog().getState().stopping);
  }
  async function refresh() {
    const result = await send({ type: "asr-status" });
    settings = result.settings || settings;
    $("asr-current").textContent = ui.current;
    $("asr-engine-label").textContent = ui.engines[result.provider || "local"];
    $("asr-selected").title = ui.engines[result.provider || "local"];
    return result;
  }
  async function open(result = null) {
    result ||= await refresh();
    $("asr-provider").value = settings.provider;
    $("asr-api-key").value = "";
    renderSettings(); showConnection(result);
    showSettingsFeedback("asr-settings-status", result.error || (result.connected && (result.provider || "local") === "local"
      ? result.gpuNotice || (result.device === "cuda" ? ui.gpuConnected : result.gpuEnabled ? ui.gpuPending : ui.cpuConnected)
      : result.provider !== "local" || result.componentConnected || result.needsPairing ? "" : ui.startService));
    navigate("asr-page");
    return result;
  }
  async function run(selected) {
    const catalog = getCatalog(), state = catalog.getState(), { meta } = state;
    if (state.running || state.loading || state.previewLoading || !meta || !selected.length) return;
    const connection = await refresh();
    if (meta.platform === "youtube" && connection.connected && !connection.youtubeAudio) {
      status(ui.updateRequired, true);
      return;
    }
    if (!connection.connected) {
      await open(connection); return;
    }
    const provider = connection.provider || "local";
    try { CourseCore.normalizeFolder($("folder").value); } catch (error) { status(error.message, true); return; }
    await navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
      if (!lock) { status(ui.locked, true); return; }
      catalog.setImporting(true);
      importAction.progress(0, selected.length, ui.phase);
      const counts = {}; let done = 0, runtimeNote = "";
      try {
        await catalog.persist(); await catalog.updateIndex();
        for (const page of selected) {
          if (catalog.getState().stopping) break;
          page.status = "running"; page.error = ""; catalog.render();
          try {
            const started = await catalog.request("asr-start", { page, provider });
            if (started.status === "exists") { page.status = "exists"; }
            else if (started.status === "subtitle-available") {
              const result = await catalog.request("import", { page });
              page.status = result.status;
            }
            else {
              activeAsrJob = started.id;
              while (!catalog.getState().stopping) {
                const job = await catalog.request("asr-poll", { page, jobId: activeAsrJob });
                if (catalog.getState().stopping) break;
                if (job.status === "done") {
                  runtimeNote = provider === "local" ? job.gpu_notice || (job.device === "cuda" ? ui.gpuResult : ui.cpuResult)
                    : `${ui.engines[provider]} · ${job.timestamps === false ? ui.plainText : ui.timestamped}`;
                  const result = await catalog.request("asr-finish", { page, jobId: activeAsrJob });
                  page.status = result.status;
                  if (result.body && catalog.getState().activeAsrPage?.cid === page.cid) {
                    previewView.transcript(meta, page, result.body, result.track.timestamps !== false);
                  }
                  break;
                }
                if (job.status === "failed" || job.status === "canceled") throw new Error(job.detail || ui.jobStopped);
                importAction.progress(done, selected.length, ui.stages[job.status] || ui.phase);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
              if (catalog.getState().stopping) {
                await catalog.request("asr-cancel", { page, jobId: activeAsrJob }).catch(() => {});
                if (provider !== "local") runtimeNote = ui.cancelCloud;
                page.status = "missing";
              }
            }
          } catch (error) {
            page.status = catalog.getState().stopping ? "missing" : "failed";
            page.error = catalog.getState().stopping ? "" : error.message;
          }
          finally { activeAsrJob = ""; }
          if (["saved", "exists"].includes(page.status) && catalog.getState().activeAsrPage?.cid === page.cid) {
            $("asr-panel").hidden = true;
            if (page.status === "exists") previewView.message(ui.exists);
          }
          counts[page.status] = (counts[page.status] || 0) + 1; done++; importAction.progress(done, selected.length, ui.phase);
          await catalog.persist(); catalog.render(); await catalog.updateIndex();
        }
        reportImportResult(catalog.getState().stopping ? ui.stopped : ui.complete, counts, selected.length - done, null, runtimeNote);
      } catch (error) { reportImportResult(ui.interrupted, counts, selected.length - done, error); }
      finally { catalog.setImporting(false); activeAsrJob = ""; }
    });
  }
  $("asr-current").addEventListener("click", () => {
    if (getCatalog().getState().activeAsrPage) run([getCatalog().getState().activeAsrPage]).catch(error => status(error.message, true));
  });
  $("asr-change-engine").addEventListener("click", () => open().catch(error => status(error.message, true)));
  $("asr-selected").addEventListener("click", () => run(getCatalog().getState().pages.filter(p => p.selected && p.status === "missing")).catch(error => status(error.message, true)));
  $("asr-connect").addEventListener("click", async () => {
    $("asr-connect").disabled = true;
    try {
      if ($("asr-provider").value === "local" && $("asr-token").value.trim()) await send({ type: "asr-pair", token: $("asr-token").value });
      $("asr-token").value = "";
      const result = await send({ type: "asr-settings-save", settings: { provider: $("asr-provider").value, apiKey: $("asr-api-key").value } });
      settings = result.settings;
      $("asr-api-key").value = "";
      renderSettings(); showConnection(await refresh());
      showSettingsFeedback("asr-settings-status", settings.provider === "local" ? ui.localSettingsSaved : ui.settingsSaved);
    } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
    finally { $("asr-connect").disabled = false; }
  });
  $("asr-refresh").addEventListener("click", async () => {
    $("asr-refresh").disabled = true;
    try {
      const result = await send({ type: "asr-component-status" });
      showConnection({ ...result, componentConnected: result.connected, connected: result.connected && result.modelReady });
      showSettingsFeedback("asr-settings-status", result.error || (result.needsPairing ? ui.pairRequired : result.modelReady ? ui.connected : ui.modelRequired));
    } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
    finally { $("asr-refresh").disabled = false; }
  });
  $("asr-provider").addEventListener("change", () => { $("asr-api-key").value = ""; renderSettings(); });
  $("asr-clear-key").addEventListener("click", async () => {
    $("asr-clear-key").disabled = true;
    try {
      const result = await send({ type: "asr-settings-save", settings: { provider: $("asr-provider").value, clearKey: true } });
      settings = result.settings; $("asr-api-key").value = "";
      renderSettings(); await refresh(); showSettingsFeedback("asr-settings-status", ui.keyCleared);
    } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
    finally { $("asr-clear-key").disabled = false; }
  });
  $("local-asr-settings").addEventListener("click", () => open().catch(error => status(error.message, true)));
  UiText.i18n.subscribe(() => { renderSettings(); });
  return { refresh, open, run };
};
