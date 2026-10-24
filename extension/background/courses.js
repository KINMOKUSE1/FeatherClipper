/* 课程请求路由：平台素材读取、导入、转写结果保存和课程清单更新。 */
async function handleCourseMessage(message) {
  const { action, meta, page, base } = message;
  const locale = I18n.outputLocale(message.locale || (await chrome.storage.local.get(I18n.storageKey))[I18n.storageKey] || "zh-CN");
  if (action === "meta") {
    const parsed = CourseCore.parseSource(message.bvid);
    const youtubeId = message.youtubeId || (parsed?.platform === "youtube" ? parsed.id : "");
    const playlistId = message.playlistId || (parsed?.platform === "youtube" ? parsed.playlistId : "");
    if (youtubeId) {
      const result = await youtubeRead(youtubeId, false, false, playlistId);
      const settings = await getMergedSettings();
      const folder = String(settings.noteFolder || "Clippings/Bilibili").replace(/\{\{created\}\}/g, formatLocalDate()).replace(/\{\{upload_date\}\}/g, formatLocalDate()).replace(/\{\{author\}\}/g, CourseCore.safeName(result.meta.author)).replace(/\{\{bvid\}\}/g, result.meta.videoId);
      return { meta: result.meta, folder: folder === "Clippings/Bilibili" ? "Clippings/YouTube" : folder };
    }
    const bvid = parsed?.platform === "bilibili" ? parsed.id : message.bvid;
    if (!/^BV[0-9A-Za-z]+$/.test(bvid || "")) throw new Error("请输入有效的 B站或 YouTube 视频链接。");
    const payload = await courseBiliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    const data = payload.data;
    const settings = await getMergedSettings();
    const folder = String(settings.noteFolder || "Clippings/Bilibili").replace(/\{\{created\}\}/g, formatLocalDate()).replace(/\{\{upload_date\}\}/g, formatLocalDate(data.pubdate * 1000)).replace(/\{\{author\}\}/g, CourseCore.safeName(data.owner?.name)).replace(/\{\{bvid\}\}/g, bvid);
    return { meta: { bvid: data.bvid, aid: String(data.aid), title: data.title, author: data.owner?.name || "", thumbnail: String(data.pic || "").replace(/^http:/, "https:").replace(/^\/\//, "https://"), pages: (data.pages || []).map(p => ({ cid: String(p.cid), page: p.page, part: p.part, duration: p.duration })) }, folder };
  }
  if (!meta || !(meta.platform === "youtube" ? /^[\w-]{11}$/.test(meta.videoId || "") && (meta.playlistId ? /^[\w-]{8,60}$/.test(meta.playlistId) && meta.bvid === `YTPL_${meta.playlistId}` : meta.bvid === `YT_${meta.videoId}`) : /^BV[0-9A-Za-z]+$/.test(meta.bvid || ""))) throw new Error("课程信息无效，请重新读取目录。");
  if (action === "raw-paths") {
    const sources = await courseRawSources(meta, message.pages || meta.pages, base);
    const index = Object.keys(sources).length ? await existingCourseIndex(meta, base, locale) : null;
    return { sources, index: index?.content?.startsWith(CourseCore.marker) ? index.path : "" };
  }
  if (["asr-start", "asr-poll", "asr-finish", "asr-cancel"].includes(action)) {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") : /^\d+$/.test(page?.cid || "")) || !meta.pages?.some(item => item.cid === page.cid)) throw new Error("视频信息无效。");
    if (action === "asr-poll") {
      const job = await asrPoll(message.jobId);
      return { status: job.status, detail: job.detail, progress: job.progress, provider: job.provider,
        timestamps: job.timestamps, device: job.device, gpu_notice: job.gpu_notice };
    }
    if (action === "asr-cancel") return asrCancel(message.jobId);
    const path = CourseCore.rawPath(meta, page, base, locale);
    const existingPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (existingPath) return rememberCourseImport(meta, page, base, { status: "exists", path: existingPath });
    if (action === "asr-start") {
      // YouTube 的转写由用户主动发起，字幕读取失败不阻断独立的音轨读取。
      if (meta.platform !== "youtube") {
        const subtitle = await courseSubtitle(meta, page);
        if (subtitle) return { status: "subtitle-available" };
      }
      return asrStart(meta, page, message.provider);
    }
    const job = await asrPoll(message.jobId);
    if (job.bvid !== meta.bvid || String(job.cid) !== page.cid) throw new Error("转写结果与所选分 P 不一致，未保存到 Obsidian。");
    if (job.status !== "done") return { status: job.status, detail: job.detail, progress: job.progress };
    const provider = job.provider || "local", timestamps = job.timestamps !== false;
    if (!["local", "groq", "siliconflow"].includes(provider)
      || (provider === "siliconflow" && timestamps)
      || !Array.isArray(job.body) || !job.body.length
      || job.body.some(item => !item || typeof item.content !== "string" || !item.content.trim()
        || (timestamps && (!Number.isFinite(item.from) || item.from < 0)))) {
      throw new Error("转写结果无效，未保存到 Obsidian。");
    }
    const appearedPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (appearedPath) return rememberCourseImport(meta, page, base, { status: "exists", path: appearedPath });
    const models = { local: "faster-whisper-small", groq: "whisper-large-v3-turbo", siliconflow: "FunAudioLLM/SenseVoiceSmall" };
    const names = Object.fromEntries(Object.entries({ local: "本地转写", groq: "Groq 转写", siliconflow: "硅基流动转写" }).map(([key, value]) => [key, I18n.t(value, {}, locale)]));
    const track = { lan: job.language || "unknown", lanDoc: `${names[provider]}（${models[provider]}）`,
      source: provider === "local" ? "local-asr" : `${provider}-asr`, model: models[provider], timestamps };
    await courseLocalRequest(path, "PUT", CourseCore.buildRaw(meta, page, track, job.body, locale));
    const result = await rememberCourseImport(meta, page, base, { status: "saved", path }, track);
    if (provider !== "local") await onlineAsrRequest("forget", { id: message.jobId }).catch(() => {});
    return { ...result, body: job.body, track };
  }
  if (action === "preview") {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") : /^\d+$/.test(page?.cid || "")) || !meta.pages?.some(item => item.cid === page.cid)) throw new Error("视频信息无效。");
    const signal = AbortSignal.timeout(8000);
    const tracks = meta.platform === "youtube" ? [] : await courseBiliSubtitleTracks(meta, page, signal);
    const subtitle = meta.platform === "youtube" ? await courseSubtitle(meta, page, action, message.trackId || "", message.subtitleLanguage || "") : await courseReadBiliSubtitle(tracks, page, message.trackId || "", message.subtitleLanguage || "", signal);
    return { tracks: (meta.platform === "youtube" ? subtitle?.tracks || [] : tracks).map(({ id, lan, lanDoc }) => ({ id, lan, lanDoc })), ...(subtitle
      ? { track: { id: subtitle.track.id, lan: subtitle.track.lan, lanDoc: subtitle.track.lanDoc }, body: subtitle.body }
      : { body: [], missing: true }) };
  }
  const folder = CourseCore.courseFolder(meta, base);
  if (action === "index") {
    const { path, content: existing } = await existingCourseIndex(meta, base, locale);
    if (existing !== null && !existing.startsWith(CourseCore.marker)) {
      const error = new Error("课程导入清单.md 已存在且不是本工具生成，已停止，避免覆盖。");
      error.fatal = true;
      throw error;
    }
    const sources = await courseRawSources(meta, message.pages, base);
    for (const page of message.pages) page.sourcePath = sources[page.cid] || "";
    await courseLocalRequest(path, "PUT", CourseCore.buildIndex(meta, message.pages, base, locale));
    return { path, sources };
  }
  if (action === "import") {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") && meta.pages?.some(item => item.cid === page.cid) : /^\d+$/.test(page?.cid || ""))) throw new Error("视频信息无效。");
    const path = CourseCore.rawPath(meta, page, base, locale);
    const existingPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (existingPath) return rememberCourseImport(meta, page, base, { status: "exists", path: existingPath });
    const subtitle = await courseSubtitle(meta, page, "import", message.trackId || "", message.subtitleLanguage || "");
    if (!subtitle) return { status: "missing" };
    // Recheck after network work in case a note appeared while fetching subtitles.
    const appearedPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (appearedPath) return rememberCourseImport(meta, page, base, { status: "exists", path: appearedPath });
    await courseLocalRequest(path, "PUT", CourseCore.buildRaw(meta, page, subtitle.track, subtitle.body, locale));
    return rememberCourseImport(meta, page, base, { status: "saved", path }, subtitle.track);
  }
  throw new Error("未知的课程操作。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "course-request") return false;
  if (sender.id !== chrome.runtime.id || !(String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL("workbench/index.html") || (["meta", "preview"].includes(message.action) && String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL("popup/index.html")))) {
    sendResponse({ ok: false, error: "请从扩展的课程导入页面操作。" });
    return false;
  }
  handleCourseMessage(message).then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message, fatal: Boolean(error.fatal) }));
  return true;
});
