/* Follows Obsidian Web Clipper / Defuddle: existing DOM, caption files, then open DOM.
 * Reference: https://github.com/kepano/defuddle/blob/main/src/extractors/youtube.ts */
async function youtubePageRead(videoId, preference, includeBody, includeAudio, playlistId, tracksOnly = false) {
  try {
  const currentId = new URL(location.href).searchParams.get("v");
  if (currentId !== videoId) throw new Error("YouTube 页面已切换视频，请重新读取。");
  const inlineJson = name => {
    const marker = new RegExp(`\\b${name}\\s*=\\s*\\{`);
    for (const script of document.scripts) {
      const text = script.textContent || "";
      const match = marker.exec(text);
      if (!match) continue;
      const start = match.index + match[0].lastIndexOf("{");
      let depth = 0, quoted = false, escaped = false;
      for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); }
          catch { break; }
        }
      }
    }
    return null;
  };
  let player = window.ytInitialPlayerResponse;
  if (player?.videoDetails?.videoId !== videoId) {
    try { player = JSON.parse(window.ytplayer?.config?.args?.player_response || "null"); }
    catch { player = null; }
  }
  if (player?.videoDetails?.videoId !== videoId) player = inlineJson("ytInitialPlayerResponse");
  const inlinePlayer = player?.videoDetails?.videoId === videoId ? player : null;
  player = inlinePlayer;
  let pageDetails = null;
  if (!includeBody && !includeAudio) {
    // Metadata need not wait for captions or a fresh initialization response.
    try {
      const live = document.querySelector("#movie_player")?.getVideoData?.();
      if (live?.video_id === videoId && live.title?.trim()) pageDetails = { videoId, title: live.title, author: live.author || "" };
    } catch { /* The player may still be mounting. */ }
    if (!pageDetails && !player?.videoDetails?.title?.trim()) {
      const watch = document.querySelector("ytd-watch-flexy");
      const title = watch?.getAttribute("video-id") === videoId ? watch.querySelector("ytd-watch-metadata h1")?.textContent?.trim() : "";
      const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
      let matchingUrl = false;
      try { matchingUrl = new URL(ogUrl).searchParams.get("v") === videoId; } catch { /* No validated metadata URL. */ }
      const ogTitle = matchingUrl ? document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() : "";
      if (title || ogTitle) pageDetails = { videoId, title: title || ogTitle, author: "" };
    }
  }
  if (!includeBody && ((!pageDetails && !player?.videoDetails?.title?.trim()) || (includeAudio && !player?.streamingData?.adaptiveFormats?.some(item => String(item.mimeType || "").startsWith("audio/") && item.url)))) {
    try {
      const response = await fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "IOS", clientVersion: "20.10.3" } }, videoId }),
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok) {
        const fresh = await response.json();
        if (fresh?.videoDetails?.videoId === videoId) player = fresh;
      }
    } catch { /* The inline player response may still be usable. */ }
  }
  if (!includeBody && player?.playabilityStatus?.status === "LOGIN_REQUIRED") throw new Error("YouTube 要求验证登录状态；请在 Edge 打开视频并确认能播放后重试。");
  // A rendered transcript is usable even when the player response is unavailable.
  if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("YouTube 页面已切换视频，请重新读取。");
  const details = pageDetails || (player?.videoDetails?.videoId === videoId ? player.videoDetails : {});
  if (!includeBody && !details.videoId) throw new Error("无法读取 YouTube 视频信息；请先打开视频页并确认能播放。");
  const meta = { platform: "youtube", videoId, bvid: `YT_${videoId}`, title: details.title || document.title.replace(/\s*-\s*YouTube$/, ""), author: details.author || "", pages: [{ cid: videoId, page: 1, part: details.title || "视频字幕", duration: Number(details.lengthSeconds) || 0 }] };
  if (playlistId && !includeBody && !includeAudio) {
    if (new URL(location.href).searchParams.get("list") !== playlistId) throw new Error("YouTube 页面已切换播放列表，请重新读取。");
    const playlist = (window.ytInitialData || inlineJson("ytInitialData"))?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
    const entries = (playlist?.contents || []).map(item => item.playlistPanelVideoRenderer).filter(Boolean);
    const fromData = entries.map(item => ({ cid: item.videoId, part: item.title?.simpleText || item.title?.runs?.map(run => run.text).join("") || "视频字幕", duration: Number(item.lengthSeconds) || 0 }));
    const fromDom = [...document.querySelectorAll("ytd-playlist-panel-video-renderer")].map(item => {
      const link = item.querySelector("a#wc-endpoint");
      let cid = "";
      try { cid = new URL(link?.href || "", location.href).searchParams.get("v") || ""; } catch { /* Ignore unavailable item. */ }
      return { cid, part: item.querySelector("#video-title")?.textContent?.trim() || link?.title || "视频字幕", duration: 0 };
    });
    const items = fromData.length >= fromDom.length ? fromData : fromDom;
    const unique = [...new Map(items.filter(item => /^[\w-]{11}$/.test(item.cid)).map(item => [item.cid, item])).values()];
    if (!unique.length) throw new Error("无法读取 YouTube 播放列表目录；请在浏览器中打开列表中的视频后重试。");
    meta.playlistId = playlistId;
    meta.bvid = `YTPL_${playlistId}`;
    meta.title = (typeof playlist?.title === "string" ? playlist.title : "") || document.querySelector("ytd-playlist-panel-renderer #title")?.textContent?.trim() || details.title;
    meta.pages = unique.map((item, index) => ({ ...item, page: index + 1 }));
  }
  if (includeAudio) {
    const formats = (player.streamingData?.adaptiveFormats || inlinePlayer?.streamingData?.adaptiveFormats || []).filter(item => String(item.mimeType || "").startsWith("audio/") && item.url);
    const audioUrls = formats.sort((a, b) => Number(a.bitrate || 0) - Number(b.bitrate || 0)).map(item => item.url).filter(value => {
      try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com")); }
      catch { return false; }
    }).slice(0, 4);
    if (!audioUrls.length) throw new Error("YouTube 没有提供可用的音轨地址，暂时无法启动本地转写。");
    return { meta, audioUrls };
  }
  if (!includeBody) return { meta };
  const getTracks = data => data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  let tracks = getTracks(player);
  const chosen = preference && typeof preference === "object" ? preference : null;
  if (chosen && (chosen.platform !== "youtube" || chosen.videoId !== videoId)) throw new Error("字幕轨不属于当前视频，请重新选择。");
  const language = ["zh", "en"].includes(preference) ? preference : "auto";
  const name = (track = {}) => track.name?.simpleText || track.name?.runs?.map(run => run.text || "").join("") || track.languageCode || "字幕";
  const family = track => String(track?.languageCode || "").replace(/_/g, "-").toLowerCase().split("-")[0];
  const trackId = track => track.vssId || `${track.languageCode}:${track.kind || "manual"}:${name(track)}`;
  const listTracks = () => [...new Map(tracks.map(track => [trackId(track), {
    platform: "youtube", videoId, id: trackId(track), lan: track.languageCode || "", kind: track.kind || "manual",
    lanDoc: track.kind === "asr" && !/自动|auto/i.test(name(track)) ? `${name(track)}（自动生成）` : name(track)
  }])).values()];
  if (tracksOnly && tracks.length) return { tracks: listTracks() };
  const pickTrack = data => {
    const available = getTracks(data);
    if (chosen) return available.find(track => trackId(track) === chosen.id) || null;
    const matching = available.filter(track => family(track) === (language === "auto" ? "zh" : language));
    if (matching.length) return matching.find(track => track.kind !== "asr") || matching[0];
    if (language !== "auto") return null;
    const renderer = data?.captions?.playerCaptionsTracklistRenderer;
    const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex || 0] || renderer?.audioTracks?.[0];
    const defaultTrack = available[audio?.defaultCaptionTrackIndex ?? renderer?.defaultCaptionTrackIndex];
    const spoken = available.find(track => track.kind === "asr");
    const original = spoken && available.find(track => track.kind !== "asr" && family(track) === family(spoken));
    const manual = available.filter(track => track.kind !== "asr");
    const remaining = manual.length ? manual : available;
    return defaultTrack || original || spoken || remaining.find(track => family(track) === "en") || remaining[0];
  };
  const diagnostics = [];
  const report = (stage, outcome) => {
    diagnostics.push(`${stage}：${outcome}`);
    // Only route outcomes; never log cookies, response payloads or signed URLs.
    console.debug("[Course Cove YouTube]", stage, outcome);
  };
  const checkVideo = () => {
    if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("YouTube 页面已切换视频，请重新读取。");
  };
  const seconds = value => {
    const parts = value.split(":").map(Number);
    return parts.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite)
      ? parts.reduce((total, part) => total * 60 + part, 0) : NaN;
  };
  const containerSelector = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #segments-container, ytm-macro-markers-list-renderer .ytm-macro-markers-list-container';
  const segmentSelector = "ytd-transcript-segment-renderer, transcript-segment-view-model";
  const poll = async (predicate, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      checkVideo();
      const found = predicate();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, Math.min(150, Math.max(0, deadline - Date.now()))));
    }
    return null;
  };
  const panelSelector = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const usable = node => node && !node.disabled && node.getAttribute("aria-disabled") !== "true" && node.getClientRects().length;
  const panelOpen = () => document.querySelector(panelSelector)?.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  const readBody = container => [...(container?.querySelectorAll(segmentSelector) || [])].map(item => ({
    from: seconds(item.querySelector(".segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp")?.textContent?.trim() || ""),
    content: item.querySelector(".segment-text, span.yt-core-attributed-string")?.textContent?.replace(/\s+/g, " ").trim() || ""
  })).filter(item => Number.isFinite(item.from) && item.content);
  const currentContainer = () => {
    const owner = document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
    return owner && owner !== videoId ? null : document.querySelector(containerSelector);
  };
  const validContainer = () => {
    const container = currentContainer();
    return readBody(container).length ? container : null;
  };
  async function readTranscript(openPanel = false) {
    let container = validContainer();
    // One short budget for opening the panel and, if requested, changing its language.
    const deadline = Date.now() + 8000;
    const wait = predicate => poll(predicate, Math.max(0, deadline - Date.now()));
    if (openPanel && !container) {
      const ready = await wait(() => {
        const owner = document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
        return !owner || owner === videoId;
      });
      if (!ready) return null;
      if (document.querySelector('ytm-slim-video-metadata-section-renderer')) {
        document.querySelector('button[aria-label="Show more"]')?.click();
        const viewAll = await wait(() => document.querySelector('button[aria-label="View all"]'));
        if (!viewAll) return null;
        viewAll.click();
        const timeline = await wait(() => document.querySelector('button[aria-label="Timeline"]'));
        if (!timeline) return null;
        timeline.click();
      } else {
        let expanded = false;
        const entry = await wait(() => {
          if (validContainer() || panelOpen()) return true;
          const button = document.querySelector("ytd-video-description-transcript-section-renderer button");
          if (usable(button)) return button;
          const more = document.querySelector("ytd-watch-metadata #description-inline-expander #expand");
          if (!expanded && usable(more)) { more.click(); expanded = true; }
          return null;
        });
        if (!entry) { report("页面文稿", "8 秒内未找到可用入口或正文"); return null; }
        if (entry !== true) {
          entry.click();
          report("文稿入口", "已点击，等待有效正文");
        }
      }
      container = await wait(validContainer);
      if (!container) { report("页面文稿", "8 秒内未出现有效正文"); return null; }
    }
    if (!container) return null;
    const languageButton = () => document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #footer yt-sort-filter-sub-menu-renderer yt-dropdown-menu button, ytd-transcript-footer-renderer yt-dropdown-menu button'
    );
    const exactName = value => value.replace(/\s+/g, " ").trim().toLowerCase();
    const normalize = value => value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const labelFamily = label => /English|英语|英文/i.test(label) ? "en" : /中文|汉语|Chinese/i.test(label) ? "zh" : "";
    const panelTrack = label => {
      const exact = tracks.filter(item => exactName(name(item)) === exactName(label));
      const matching = tracks.filter(item => normalize(name(item)) === normalize(label));
      return exact.length === 1 ? exact[0] : matching.length === 1 ? matching[0]
        : (tracks.length === 1 && (!labelFamily(label) || family(tracks[0]) === labelFamily(label)) ? tracks[0] : null);
    };
    const currentLabel = languageButton()?.textContent?.trim() || "";
    const currentTrack = panelTrack(currentLabel);
    const alreadySelected = chosen ? currentTrack && trackId(currentTrack) === chosen.id
      : (labelFamily(currentLabel) || family(currentTrack)) === language;
    const target = pickTrack({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });
    // Switch the platform's own menu only for an explicitly requested track/language.
    // Never accept a different visible language as the requested one.
    if (openPanel && (chosen || language !== "auto") && !alreadySelected && target && languageButton()) {
      languageButton().click();
      const option = await wait(() => [...document.querySelectorAll('tp-yt-paper-listbox [role="option"], tp-yt-paper-listbox tp-yt-paper-item')]
        .find(item => exactName(item.textContent || "") === exactName(name(target)) && item.getClientRects().length));
      if (option) {
        const previous = container.querySelector(segmentSelector);
        option.click();
        const updated = await wait(() => {
          const current = validContainer();
          return exactName(languageButton()?.textContent || "") === exactName(name(target))
            && current?.querySelector(segmentSelector) && current.querySelector(segmentSelector) !== previous ? current : null;
        });
        if (!updated) return null;
        container = updated;
      } else languageButton().click();
    }
    const label = languageButton()?.textContent?.trim() || "";
    const labelLanguage = labelFamily(label);
    const track = panelTrack(label);
    const selectedLanguage = labelLanguage || family(track);
    if (chosen && (!track || trackId(track) !== chosen.id)) return null;
    if (language !== "auto" && selectedLanguage !== language) return null;
    const body = readBody(container);
    if (!body.length) return null;
    checkVideo();
    report("页面文稿", `${body.length} 条`);
    return { meta, track: { lan: track?.languageCode || selectedLanguage, lanDoc: label || name(track || {}), source: "youtube-transcript-panel" }, body };
  }
  const visible = !tracksOnly && await readTranscript();
  if (visible) return visible;

  // Both caption paths run together. A usable result cancels the other path.
  const controller = new AbortController();
  const budget = AbortSignal.timeout(8000);
  const captionFetch = (url, options = {}) => fetch(url, {
    ...options, credentials: "include", cache: "no-store",
    signal: AbortSignal.any([controller.signal, budget, AbortSignal.timeout(4000)])
  });
  async function readCaption(track) {
    if (!track?.baseUrl) return null;
    try {
      const url = new URL(track.baseUrl);
      if (url.protocol !== "https:" || !(url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))) return null;
      const response = await captionFetch(url.href);
      if (!response.ok) { report("字幕文件", `HTTP ${response.status}`); return null; }
      const text = await response.text();
      if (!text.trim()) { report("字幕文件", "返回空内容"); return null; }
      let body;
      // Read the original URL once; parse the format returned by YouTube.
      if (text.trimStart().startsWith("{")) {
        const data = JSON.parse(text);
        body = (data.events || []).filter(item => Array.isArray(item.segs)).map(item => ({
          from: Number(item.tStartMs) / 1000,
          to: (Number(item.tStartMs) + Number(item.dDurationMs || 0)) / 1000,
          content: item.segs.map(segment => segment.utf8 || "").join("")
        }));
      } else {
        const xml = new DOMParser().parseFromString(text, "text/xml");
        body = [...xml.querySelectorAll("text, p")].map(item => {
          const from = item.tagName === "p" ? Number(item.getAttribute("t")) / 1000 : Number(item.getAttribute("start"));
          const duration = item.tagName === "p" ? Number(item.getAttribute("d")) / 1000 : Number(item.getAttribute("dur"));
          return { from, to: from + (Number.isFinite(duration) ? duration : 0), content: item.textContent || "" };
        });
      }
      body = body.map(item => ({ ...item, content: item.content.replace(/\s+/g, " ").trim() })).filter(item => Number.isFinite(item.from) && item.content);
      if (!body.length) { report("字幕文件", "未解析出正文"); return null; }
      checkVideo();
      return { meta, track: { lan: track.languageCode || "", lanDoc: name(track), source: track.kind === "asr" ? "youtube-auto-caption" : "youtube-caption" }, body };
    } catch (error) {
      if (!controller.signal.aborted) report("字幕文件", error.name === "TimeoutError" || error.name === "AbortError" ? "请求超时" : "请求或解析失败");
      return null;
    }
  }
  const inlineTrack = pickTrack(player);
  const inlineCaption = tracksOnly ? Promise.resolve(null) : readCaption(inlineTrack);
  async function readPlayerCaption() {
    // Match Defuddle's player fallback, selecting one track rather than probing
    // every language/format. Reuse the inline request when its URL is identical.
    for (const client of [
      { clientName: "IOS", clientVersion: "20.10.3" },
      { clientName: "ANDROID", clientVersion: "20.10.38" },
      { clientName: "WEB", clientVersion: "2.20240101.00.00" }
    ]) {
      if (controller.signal.aborted || budget.aborted) break;
      try {
        const response = await captionFetch("/youtubei/v1/player?prettyPrint=false", {
          method: "POST", headers: { "Content-Type": "application/json", ...(language === "auto" ? {} : { "Accept-Language": language }) },
          body: JSON.stringify({ context: { client }, videoId })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.videoDetails?.videoId && data.videoDetails.videoId !== videoId) continue;
        if (getTracks(data).length) {
          tracks = [...new Map([...tracks, ...getTracks(data)].map(track => [trackId(track), track])).values()];
          if (tracksOnly) return { tracks: listTracks() };
        }
        const track = pickTrack(data);
        if (track?.baseUrl) return track.baseUrl === inlineTrack?.baseUrl ? inlineCaption : readCaption(track);
      } catch { /* Try the next player client within the same time budget. */ }
    }
    return null;
  }
  let caption;
  try {
    caption = await Promise.any([inlineCaption, readPlayerCaption()].map(async request => {
      const result = await request;
      if (!result) throw new Error("未取得字幕文件");
      return result;
    })).catch(() => null);
  } finally { controller.abort(); }
  if (caption) { checkVideo(); return caption; }
  if (tracksOnly) throw new Error("暂未读取到语言选项，可重试读取；仍可尝试自动获取页面文稿。");
  const opened = await readTranscript(true);
  if (opened) return opened;
  if (player?.playabilityStatus?.status === "LOGIN_REQUIRED") throw new Error("YouTube 要求登录验证；请在视频页完成验证后重试。");
  if (chosen) throw new Error("所选字幕轨读取失败，请重试或在视频页切换到该字幕后再读取。");
  report("页面文稿", "未读取到匹配语言的文稿");
  throw new Error(`YouTube 字幕获取失败，尚不能判定视频无字幕。${[...new Set(diagnostics)].join("；")}`);
  } catch (error) {
    // executeScript does not reliably propagate an injected function's thrown error.
    return { error: error.message || "YouTube 字幕读取失败" };
  }
}

// Batch imports activate the reading tab so YouTube can render the transcript.
// Only navigate our helper, and only while its URL is still the one we set.
async function youtubeTab(videoId, playlistId, activate = false) {
  const matches = tab => {
    try { const url = new URL(tab.url); return url.searchParams.get("v") === videoId && (!playlistId || url.searchParams.get("list") === playlistId); }
    catch { return false; }
  };
  const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/watch*", "https://m.youtube.com/watch*"] });
  let tab = tabs.filter(matches).sort((a, b) => Number(b.status === "complete") - Number(a.status === "complete") || Number(b.active) - Number(a.active))[0];
  if (tab && activate && !tab.active) tab = await chrome.tabs.update(tab.id, { active: true });
  if (tab?.status === "complete") return tab;
  if (!tab) {
    const key = "course-cove-youtube-tab";
    const saved = (await chrome.storage.session.get(key))[key];
    const helper = saved && await chrome.tabs.get(saved.id).catch(() => null);
    const url = `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ""}`;
    tab = helper && (!helper.active || activate) && helper.url === saved.url
      ? await chrome.tabs.update(helper.id, { url, ...(activate ? { active: true } : {}) })
      : await chrome.tabs.create({ url, active: activate });
    await chrome.storage.session.set({ [key]: { id: tab.id, url } });
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current) throw new Error("YouTube 视频页已关闭，请重新读取。");
    if (current.status === "complete" && matches(current)) return current;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("YouTube 视频页尚未加载完成，请稍后重试。");
}

const youtubePendingReads = new Map();
let youtubeReadQueue = Promise.resolve();
let youtubePreview = null;
async function youtubeRead(videoId, preference = "auto", includeBody = false, includeAudio = false, playlistId = "", purpose = "read", activate = false) {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("请输入有效的 YouTube 视频链接。");
  if (playlistId && !/^[\w-]{8,60}$/.test(playlistId)) throw new Error("YouTube 播放列表链接无效。");
  const resultKey = `${videoId}:${JSON.stringify(preference)}:${includeBody}:${includeAudio}:${playlistId}`;
  const requestKey = `${resultKey}:${purpose}:${activate}`;
  if (youtubePendingReads.has(requestKey)) return youtubePendingReads.get(requestKey);
  const metadataOnly = !includeBody && !includeAudio;
  const expires = Date.now() + 12000;
  let timer;
  const timeoutError = () => new Error("视频信息读取超时，请在视频页加载完成后点击“读取”重试。");
  const timeout = metadataOnly ? new Promise((resolve, reject) => { timer = setTimeout(() => reject(timeoutError()), 12000); }) : null;
  const run = async existingTab => {
    if (metadataOnly && Date.now() >= expires) throw timeoutError();
    // Keep only the latest preview for one subsequent import. Reads and retries
    // always inspect the page again; no subtitle results live in session storage.
    if (purpose === "import") {
      const preview = youtubePreview;
      youtubePreview = null;
      if (preview?.key === resultKey) return preview.result;
    } else if (includeBody && purpose !== "tracks") youtubePreview = null;
    const tab = existingTab || await youtubeTab(videoId, playlistId, activate);
    if (metadataOnly && Date.now() >= expires) throw timeoutError();
    const request = chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", ...(metadataOnly ? { injectImmediately: true } : {}), func: youtubePageRead, args: [videoId, preference, includeBody, includeAudio, playlistId, purpose === "tracks"] });
    const results = await (metadataOnly ? Promise.race([request, timeout]) : request);
    const result = results?.[0]?.result;
    if (!result) throw new Error("无法读取 YouTube 页面，请确认视频可以播放。");
    if (result.error) throw new Error(result.error);
    if (purpose === "preview" && result.body?.length) youtubePreview = { key: resultKey, result };
    return result;
  };
  const enqueue = () => {
    const queued = youtubeReadQueue.then(() => run());
    youtubeReadQueue = queued.catch(() => {});
    return queued;
  };
  const work = metadataOnly ? Promise.race([(async () => {
    const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/watch*", "https://m.youtube.com/watch*"] });
    const existing = tabs.filter(tab => {
      try { const url = new URL(tab.url); return url.searchParams.get("v") === videoId && (!playlistId || url.searchParams.get("list") === playlistId); }
      catch { return false; }
    }).sort((a, b) => Number(b.active) - Number(a.active))[0];
    // Reading an existing page cannot navigate the shared helper. Only requests
    // needing a new page stay queued with subtitle reads.
    return existing ? run(existing) : enqueue();
  })(), timeout]) : enqueue();
  youtubePendingReads.set(requestKey, work);
  try { return await work; }
  finally { if (metadataOnly) clearTimeout(timer); youtubePendingReads.delete(requestKey); }
}
