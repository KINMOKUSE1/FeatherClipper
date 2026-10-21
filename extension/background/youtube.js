/* Follows Obsidian Web Clipper / Defuddle: existing DOM, caption files, then open DOM.
 * Reference: https://github.com/kepano/defuddle/blob/main/src/extractors/youtube.ts */
async function youtubePageRead(videoId, includeBody, includeAudio, playlistId, subtitleDeadline = Date.now() + 5000) {
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
  const audioPlayers = inlinePlayer ? [inlinePlayer] : [];
  const getAudioUrls = () => {
    const byBitrate = (a, b) => Number(a.bitrate || 0) - Number(b.bitrate || 0);
    const audio = audioPlayers.flatMap(data => data.streamingData?.adaptiveFormats || [])
      .filter(item => String(item.mimeType || "").startsWith("audio/") && item.url).sort(byBitrate);
    // Progressive MP4 (e.g. itag 18) contains AAC even when adaptive audio is SABR-only.
    const muxed = audioPlayers.flatMap(data => data.streamingData?.formats || [])
      .filter(item => /^video\/mp4\b/i.test(item.mimeType || "") && /\bmp4a\./i.test(item.mimeType || "") && item.url).sort(byBitrate);
    return [...new Set([...audio, ...muxed].map(item => item.url))].filter(value => {
      try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com")); }
      catch { return false; }
    }).slice(0, 4);
  };
  let pageDetails = null;
  if (!includeBody) {
    // SPA navigation can leave startup globals absent or pointing to the previous video.
    const element = document.querySelector("#movie_player");
    try {
      const response = element?.getPlayerResponse?.();
      if (response?.videoDetails?.videoId === videoId) {
        player = response;
        audioPlayers.unshift(response);
      }
    } catch { /* The player may still be mounting. */ }
    try {
      const live = element?.getVideoData?.();
      if (live?.video_id === videoId && live.title?.trim()) pageDetails = { ...player?.videoDetails, videoId, title: live.title, author: live.author || "" };
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
  if (!includeBody && ((!pageDetails && !player?.videoDetails?.title?.trim()) || (includeAudio && !getAudioUrls().length && !player?.streamingData?.serverAbrStreamingUrl))) {
    try {
      const response = await fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "IOS", clientVersion: "20.10.3" } }, videoId }),
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok) {
        const fresh = await response.json();
        if (fresh?.videoDetails?.videoId === videoId) {
          audioPlayers.push(fresh);
          if (!player?.videoDetails?.title?.trim()) player = fresh;
        }
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
    const checkContext = () => {
      const url = new URL(location.href);
      if (url.searchParams.get("v") !== videoId || url.searchParams.get("list") !== playlistId) {
        throw new Error("YouTube 页面已切换视频或播放列表，请重新读取。");
      }
    };
    const text = value => (typeof value === "string" ? value : value?.simpleText || value?.runs?.map(run => run.text || "").join("") || "").trim();
    const linkParams = href => {
      if (!href || href.trim().startsWith("#")) return new URLSearchParams();
      try { return new URL(href, location.href).searchParams; }
      catch { return new URLSearchParams(); }
    };
    const fromInitialData = () => {
      const data = (window.ytInitialData || inlineJson("ytInitialData"))?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
      if (!data) return null;
      const entries = (data.contents || []).map(item => item.playlistPanelVideoRenderer).filter(Boolean);
      return {
        source: "initialData",
        evidence: { idSource: "playlist.playlistId", ids: [data.playlistId, ...entries.map(item => item.navigationEndpoint?.watchEndpoint?.playlistId).filter(Boolean)] },
        playlist: { id: data.playlistId, title: text(data.title), author: text(data.ownerName),
          videos: entries.map(item => ({ cid: item.videoId, part: text(item.title), duration: Number(item.lengthSeconds) || 0 })) }
      };
    };
    const fromDOM = panel => {
      const heading = panel.querySelector("#header-description .title, #header-description #title, #title");
      const headerLink = heading?.querySelector("a[href]") || heading?.closest("a[href]") || panel.querySelector('#header-description a[href*="list="]');
      const id = linkParams(headerLink?.getAttribute("href") || "").get("list");
      const entries = [...panel.querySelectorAll("ytd-playlist-panel-video-renderer")].map(item => {
        const link = item.querySelector("a#wc-endpoint");
        const params = linkParams(link?.getAttribute("href") || "");
        return { id: params.get("list"), cid: params.get("v"), part: item.querySelector("#video-title")?.textContent?.trim() || link?.title?.trim() || "", duration: 0 };
      });
      return {
        source: "dom",
        evidence: { idSource: "playlist-header-and-item-links", ids: [id, ...entries.map(item => item.id)] },
        playlist: { id, title: heading?.textContent?.trim() || "", author: panel.querySelector("#publisher-container")?.textContent?.trim() || "",
          videos: entries.map(({ cid, part, duration }) => ({ cid, part, duration })) }
      };
    };
    const validate = candidate => {
      if (!candidate) return "pending";
      const { playlist, evidence } = candidate;
      // IDs must come from the source itself, never from the requested URL.
      if (evidence.ids.some(id => id && id !== playlistId)) return "stale";
      if (!playlist.id || evidence.ids.some(id => !id)) return "pending";
      if (!playlist.title || !playlist.videos.length || !playlist.videos.some(item => item.cid === videoId)
        || playlist.videos.some(item => !/^[\w-]{11}$/.test(item.cid || "") || !item.part)) return "pending";
      return "ready";
    };
    const deadline = Date.now() + 3000;
    let accepted = null, lastDiagnostic = "";
    do {
      checkContext();
      const candidates = [fromInitialData(), ...[...document.querySelectorAll("ytd-playlist-panel-renderer")].map(fromDOM)].filter(Boolean);
      const states = candidates.map(candidate => ({ candidate, status: validate(candidate) }));
      // Select a whole validated source; field-by-field fallbacks can mix courses.
      accepted = states.find(item => item.status === "ready")?.candidate;
      const diagnostic = JSON.stringify(states.map(({ candidate, status }) => ({ source: candidate.source, status,
        idSource: candidate.evidence.idSource, ids: [...new Set(candidate.evidence.ids)] })));
      if (diagnostic !== lastDiagnostic) {
        console.debug("[Vid2Notes YouTube] playlist", playlistId, diagnostic);
        lastDiagnostic = diagnostic;
      }
      if (accepted || Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(150, deadline - Date.now())));
    } while (true);
    checkContext();
    if (!accepted) throw new Error("暂时无法确认当前播放列表信息，请等待页面加载完成后重新读取。");
    const playlist = accepted.playlist;
    meta.currentVideo = { id: videoId, title: details.title || "", author: details.author || "" };
    meta.playlistId = playlist.id;
    meta.bvid = `YTPL_${playlist.id}`;
    meta.title = playlist.title;
    meta.author = playlist.author;
    meta.pages = [...new Map(playlist.videos.map(item => [item.cid, item])).values()].map((item, index) => ({ ...item, page: index + 1 }));
  }
  if (includeAudio) {
    const audioUrls = getAudioUrls();
    const sabr = Boolean(player?.streamingData?.serverAbrStreamingUrl);
    if (!audioUrls.length && !sabr) throw new Error("YouTube 没有提供可用的音轨地址，无法启动音频转写");
    return { meta, audioUrls, sabr };
  }
  if (!includeBody) return { meta };
  const getTracks = data => data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  let tracks = getTracks(player);
  const name = (track = {}) => track.name?.simpleText || track.name?.runs?.map(run => run.text || "").join("") || track.languageCode || "字幕";
  const family = track => String(track?.languageCode || "").replace(/_/g, "-").toLowerCase().split("-")[0];
  const trackId = track => track.vssId || `${track.languageCode}:${track.kind || "manual"}:${name(track)}`;
  const pickTrack = data => {
    const available = getTracks(data);
    const matching = available.filter(track => family(track) === "zh");
    if (matching.length) return matching.find(track => track.kind !== "asr") || matching[0];
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
    console.debug("[Vid2Notes YouTube]", stage, outcome);
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
  const panelSelector = "ytd-engagement-panel-section-list-renderer";
  const legacyPanelSelector = `${panelSelector}[target-id="engagement-panel-searchable-transcript"]`;
  const usable = node => node && !node.disabled && node.getAttribute("aria-disabled") !== "true" && node.getClientRects().length;
  const panelOpen = () => currentContainer()?.closest(panelSelector)?.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  const readBody = container => [...(container?.querySelectorAll(segmentSelector) || [])].map(item => ({
    from: seconds(item.querySelector(".segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp")?.textContent?.trim() || ""),
    content: item.querySelector('.segment-text, span.yt-core-attributed-string, span.ytAttributedStringHost[role="text"]')?.textContent?.replace(/\s+/g, " ").trim() || ""
  })).filter(item => Number.isFinite(item.from) && item.content);
  const currentContainer = () => {
    const owner = document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
    if (owner && owner !== videoId) return null;
    // Panel IDs and wrapper nodes vary. Usable timestamp/text pairs identify
    // the transcript; an empty legacy panel must not hide a populated one.
    const candidates = [...document.querySelectorAll(panelSelector)].filter(panel => readBody(panel).length);
    return candidates.find(panel => panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED")
      || candidates[0] || document.querySelector(containerSelector) || document.querySelector(legacyPanelSelector);
  };
  const validContainer = () => {
    const container = currentContainer();
    return readBody(container).length ? container : null;
  };
  async function readTranscript(openPanel = false) {
    let container = validContainer();
    // One short budget for opening the panel and reading its contents.
    const deadline = subtitleDeadline;
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
        if (!entry) { report("页面文稿", "5 秒内未找到可用入口或正文"); return null; }
        if (entry !== true) {
          entry.click();
          report("文稿入口", "已点击，等待有效正文");
        }
      }
      container = await wait(validContainer);
      if (!container) { report("页面文稿", "5 秒内未出现有效正文"); return null; }
    }
    if (!container) return null;
    const languageButton = (current = container) => (current?.closest(panelSelector) || current)?.querySelector(
      '#footer yt-sort-filter-sub-menu-renderer yt-dropdown-menu button, ytd-transcript-footer-renderer yt-dropdown-menu button'
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
    const label = languageButton()?.textContent?.trim() || "";
    const labelLanguage = labelFamily(label);
    const track = panelTrack(label);
    const selectedLanguage = labelLanguage || family(track);
    const body = readBody(container);
    if (!body.length) return null;
    checkVideo();
    report("页面文稿", `${body.length} 条`);
    return { meta, track: { lan: track?.languageCode || selectedLanguage, lanDoc: label || name(track || {}), source: "youtube-transcript-panel" }, body };
  }
  const visible = await readTranscript();
  if (visible) return visible;

  // Both caption paths run together. A usable result cancels the other path.
  const controller = new AbortController();
  const budget = AbortSignal.timeout(Math.max(0, subtitleDeadline - Date.now()));
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
  const inlineCaption = readCaption(inlineTrack);
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
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: { client }, videoId })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.videoDetails?.videoId && data.videoDetails.videoId !== videoId) continue;
        if (getTracks(data).length) {
          tracks = [...new Map([...tracks, ...getTracks(data)].map(track => [trackId(track), track])).values()];
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
  const opened = await readTranscript(true);
  if (opened) return opened;
  if (player?.playabilityStatus?.status === "LOGIN_REQUIRED") throw new Error("YouTube 要求登录验证；请在视频页完成验证后重试。");
  report("页面文稿", "未读取到有效文稿");
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
    const key = "vid2notes-youtube-tab";
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
async function youtubeRead(videoId, includeBody = false, includeAudio = false, playlistId = "", purpose = "read", activate = false) {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("请输入有效的 YouTube 视频链接。");
  if (playlistId && !/^[\w-]{8,60}$/.test(playlistId)) throw new Error("YouTube 播放列表链接无效。");
  const resultKey = `${videoId}:${includeBody}:${includeAudio}:${playlistId}`;
  const requestKey = `${resultKey}:${purpose}:${activate}`;
  if (youtubePendingReads.has(requestKey)) return youtubePendingReads.get(requestKey);
  const metadataOnly = !includeBody && !includeAudio;
  const timed = metadataOnly || includeBody;
  const milliseconds = includeBody ? 5000 : 12000;
  const expires = Date.now() + milliseconds;
  let timer;
  const timeoutError = () => new Error(includeBody ? "字幕获取超时（5 秒），请重试" : "视频信息读取超时，请在视频页加载完成后点击“读取”重试。");
  const timeout = timed ? new Promise((resolve, reject) => { timer = setTimeout(() => reject(timeoutError()), milliseconds); }) : null;
  const run = async existingTab => {
    if (timed && Date.now() >= expires) throw timeoutError();
    // Keep only the latest preview for one subsequent import. Reads and retries
    // always inspect the page again; no subtitle results live in session storage.
    if (purpose === "import") {
      const preview = youtubePreview;
      youtubePreview = null;
      if (preview?.key === resultKey) return preview.result;
    } else if (includeBody) youtubePreview = null;
    const tab = existingTab || await youtubeTab(videoId, playlistId, activate);
    if (timed && Date.now() >= expires) throw timeoutError();
    const request = chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", ...(metadataOnly ? { injectImmediately: true } : {}), func: youtubePageRead, args: [videoId, includeBody, includeAudio, playlistId, ...(includeBody ? [expires] : [])] });
    const results = await (timed ? Promise.race([request, timeout]) : request);
    if (timed && Date.now() >= expires) throw timeoutError();
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
  })(), timeout]) : includeBody ? Promise.race([enqueue(), timeout]) : enqueue();
  youtubePendingReads.set(requestKey, work);
  try { return await work; }
  finally { if (timed) clearTimeout(timer); youtubePendingReads.delete(requestKey); }
}
