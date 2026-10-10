/* 本地转写的连接页面、配对操作和转写队列。 */
window.createTranscriptionPage = function ({ getCatalog, send, feedback, navigate, importAction, previewView }) {
  const ui = UiText.transcription;
  const $ = id => document.getElementById(id);
  const { status, settings: showSettingsFeedback } = feedback;
  let activeAsrJob = "", pendingAsrPages = [];
  function reportImportResult(label, counts, remaining, error = null, detail = "") {
    return importAction.result(label, counts, remaining, error, detail, getCatalog().getState().stopping);
  }
  async function refresh() {
    const result = await send({ type: "asr-status" });
    $("asr-current").textContent = result.connected ? ui.current : result.paired ? ui.check : ui.setup;
    return result;
  }
  async function open(result = null) {
    result ||= await refresh();
    $("asr-pair-fields").hidden = !result.needsPairing;
    $("asr-connect").hidden = !result.needsPairing;
    $("asr-state").textContent = result.connected ? ui.connected : ui.disconnected;
    $("asr-state").classList.toggle("is-ready", result.connected);
    showSettingsFeedback("asr-settings-status", result.error || (result.connected
      ? result.gpuNotice || (result.device === "cuda" ? ui.gpuConnected : result.gpuEnabled ? ui.gpuPending : ui.cpuConnected)
      : result.needsPairing ? "" : ui.startService));
    navigate("asr-page");
    return result;
  }
  async function continuePendingAsr() {
    const selected = pendingAsrPages;
    pendingAsrPages = [];
    if (selected.length) { navigate("catalog-page"); await run(selected); }
    else await open();
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
      if (connection.installed && connection.paired && !connection.needsPairing) {
        status(connection.error || ui.unavailable, true);
        return;
      }
      pendingAsrPages = selected; await open(connection); return;
    }
    pendingAsrPages = [];
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
            const started = await catalog.request("asr-start", { page });
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
                  runtimeNote = job.gpu_notice || (job.device === "cuda" ? ui.gpuResult : ui.cpuResult);
                  const result = await catalog.request("asr-finish", { page, jobId: activeAsrJob });
                  page.status = result.status; break;
                }
                if (job.status === "failed" || job.status === "canceled") throw new Error(job.detail || ui.jobStopped);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
              if (catalog.getState().stopping) { await catalog.request("asr-cancel", { page, jobId: activeAsrJob }).catch(() => {}); page.status = "missing"; }
            }
          } catch (error) {
            page.status = catalog.getState().stopping ? "missing" : "failed";
            page.error = catalog.getState().stopping ? "" : error.message;
          }
          finally { activeAsrJob = ""; }
          if (["saved", "exists"].includes(page.status) && catalog.getState().activeAsrPage?.cid === page.cid) {
            $("asr-panel").hidden = true;
            previewView.message(page.status === "saved" ? ui.saved : ui.exists);
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
  $("asr-selected").addEventListener("click", () => run(getCatalog().getState().pages.filter(p => p.selected && p.status === "missing")).catch(error => status(error.message, true)));
  $("asr-connect").addEventListener("click", async () => {
    $("asr-connect").disabled = true;
    try {
      await send({ type: "asr-pair", token: $("asr-token").value });
      $("asr-token").value = "";
      if ((await refresh()).connected) await continuePendingAsr();
      else await open();
    } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
    finally { $("asr-connect").disabled = false; }
  });
  $("asr-refresh").addEventListener("click", async () => {
    $("asr-refresh").disabled = true;
    try {
      if ((await open()).connected) await continuePendingAsr();
    } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
    finally { $("asr-refresh").disabled = false; }
  });
  $("local-asr-settings").addEventListener("click", () => open().catch(error => status(error.message, true)));
  return { refresh, open, run };
};
