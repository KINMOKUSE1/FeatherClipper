/* YouTube 元数据、播放列表和页面音轨；字幕由 youtube-subtitles.js 在后台读取。 */
async function youtubePageRead(videoId, includeAudio, playlistId) {
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
    if ((!pageDetails && !player?.videoDetails?.title?.trim()) || (includeAudio && !getAudioUrls().length && !player?.streamingData?.serverAbrStreamingUrl)) {
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
    if (player?.playabilityStatus?.status === "LOGIN_REQUIRED") throw new Error("YouTube 要求验证登录状态；请在 Edge 打开视频并确认能播放后重试。");
    if (new URL(location.href).searchParams.get("v") !== videoId) throw new Error("YouTube 页面已切换视频，请重新读取。");
    const details = pageDetails || (player?.videoDetails?.videoId === videoId ? player.videoDetails : {});
    if (!details.videoId) throw new Error("无法读取 YouTube 视频信息；请先打开视频页并确认能播放。");
    const meta = { platform: "youtube", videoId, bvid: `YT_${videoId}`, title: details.title || document.title.replace(/\s*-\s*YouTube$/, ""), author: details.author || "", pages: [{ cid: videoId, page: 1, part: details.title || "视频字幕", duration: Number(details.lengthSeconds) || 0 }] };
    if (playlistId && !includeAudio) {
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
          console.debug("[FeatherClipper YouTube] playlist", playlistId, diagnostic);
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
    return { meta };
  } catch (error) {
    // executeScript does not reliably propagate an injected function's thrown error.
    return { error: error.message || "YouTube 视频信息读取失败" };
  }
}

// Only navigate our helper, and only while its URL is still the one we set.
async function youtubeTab(videoId, playlistId) {
  const matches = tab => {
    try { const url = new URL(tab.url); return url.searchParams.get("v") === videoId && (!playlistId || url.searchParams.get("list") === playlistId); }
    catch { return false; }
  };
  const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/watch*", "https://m.youtube.com/watch*"] });
  let tab = tabs.filter(matches).sort((a, b) => Number(b.status === "complete") - Number(a.status === "complete") || Number(b.active) - Number(a.active))[0];
  if (tab?.status === "complete") return tab;
  if (!tab) {
    const key = "featherclipper-youtube-tab";
    const saved = (await chrome.storage.session.get(key))[key];
    const helper = saved && await chrome.tabs.get(saved.id).catch(() => null);
    const url = `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ""}`;
    tab = helper && !helper.active && helper.url === saved.url
      ? await chrome.tabs.update(helper.id, { url })
      : await chrome.tabs.create({ url, active: false });
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
async function youtubeRead(videoId, includeBody = false, includeAudio = false, playlistId = "", purpose = "read", trackId = "", subtitleLanguage = "") {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("请输入有效的 YouTube 视频链接。");
  if (playlistId && !/^[\w-]{8,60}$/.test(playlistId)) throw new Error("YouTube 播放列表链接无效。");
  const resultKey = `${videoId}:${includeBody}:${includeAudio}:${playlistId}:${JSON.stringify([trackId, subtitleLanguage])}`;
  const requestKey = `${resultKey}:${purpose}`;
  if (youtubePendingReads.has(requestKey)) return youtubePendingReads.get(requestKey);
  const metadataOnly = !includeBody && !includeAudio;
  const timed = metadataOnly || includeBody;
  const milliseconds = includeBody ? 8000 : 12000;
  const expires = Date.now() + milliseconds;
  let timer;
  const controller = includeBody ? new AbortController() : null;
  const timeoutError = () => new Error(includeBody ? "字幕获取超时（8 秒），请重试" : "视频信息读取超时，请在视频页加载完成后点击“读取”重试。");
  const timeout = timed ? new Promise((resolve, reject) => { timer = setTimeout(() => { controller?.abort(); reject(timeoutError()); }, milliseconds); }) : null;
  const run = async existingTab => {
    if (timed && Date.now() >= expires) throw timeoutError();
    // Keep only the latest preview for one subsequent import. Reads and retries
    // always fetch fresh subtitles; no subtitle results live in session storage.
    if (purpose === "import") {
      const preview = youtubePreview;
      youtubePreview = null;
      if (preview?.key === resultKey) return preview.result;
    } else if (includeBody) youtubePreview = null;
    const tab = includeBody ? null : existingTab || await youtubeTab(videoId, playlistId);
    if (timed && Date.now() >= expires) throw timeoutError();
    const request = includeBody ? youtubeSubtitleRead(videoId, controller.signal, trackId, subtitleLanguage) : chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", ...(metadataOnly ? { injectImmediately: true } : {}), func: youtubePageRead, args: [videoId, includeAudio, playlistId] });
    const results = await (timed ? Promise.race([request, timeout]) : request);
    if (timed && Date.now() >= expires) throw timeoutError();
    const result = includeBody ? results : results?.[0]?.result;
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
    // needing a new page share the helper queue.
    return existing ? run(existing) : enqueue();
  })(), timeout]) : includeBody ? Promise.race([run(), timeout]) : enqueue();
  youtubePendingReads.set(requestKey, work);
  try { return await work; }
  finally { if (timed) clearTimeout(timer); youtubePendingReads.delete(requestKey); }
}
