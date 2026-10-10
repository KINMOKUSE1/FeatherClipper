/* Preview host: load the current branch's popup with mock extension APIs. */
const frame = document.getElementById("popup-preview");
const scenario = document.getElementById("scenario");
const expanded = document.getElementById("expanded");
const notice = document.getElementById("notice");
const params = new URLSearchParams(location.search);
if ([...scenario.options].some(option => option.value === params.get("state"))) scenario.value = params.get("state");
expanded.checked = params.get("expanded") === "1";
let renderRun = 0, resizeObserver;

function rememberState() {
  const url = new URL(location.href);
  url.searchParams.set("state", scenario.value);
  url.searchParams.set("expanded", expanded.checked ? "1" : "0");
  url.searchParams.delete("version");
  history.replaceState(null, "", url);
}

async function renderPreview() {
  const run = ++renderRun;
  rememberState();
  notice.textContent = "";
  try {
    const source = "../extension/popup/";
    const response = await fetch(`${source}index.html`, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取 popup/index.html（${response.status}）`);
    const html = await response.text();
    if (run !== renderRun) return;
    const documentCopy = new DOMParser().parseFromString(html, "text/html");
    const base = documentCopy.createElement("base");
    base.href = new URL(source, location.href).href;
    const mock = documentCopy.createElement("script");
    mock.src = new URL("popup-preview-mock.js", location.href).href;
    documentCopy.head.prepend(base, mock);
    // Refresh CSS and JavaScript too, without requiring a hard browser reload.
    for (const asset of documentCopy.querySelectorAll('link[rel="stylesheet"][href], script[src]')) {
      const attribute = asset.tagName === "LINK" ? "href" : "src";
      const url = new URL(asset.getAttribute(attribute), base.href);
      url.searchParams.set("preview", String(Date.now()));
      asset.setAttribute(attribute, url.href);
    }
    resizeObserver?.disconnect();
    frame.dataset.scenario = scenario.value;
    frame.srcdoc = "<!doctype html>\n" + documentCopy.documentElement.outerHTML;
  } catch (error) {
    notice.textContent = `${error.message}。请通过本地服务打开 preview.html。`;
  }
}

frame.addEventListener("load", () => {
  const doc = frame.contentDocument;
  if (!doc?.body || !doc.getElementById("clipper")) return;
  const panel = doc.getElementById("preview-panel");
  if (expanded.checked) panel.open = true;
  panel.addEventListener("toggle", () => {
    expanded.checked = panel.open;
    rememberState();
  });
  resizeObserver = new ResizeObserver(() => {
    frame.style.height = `${Math.max(180, Math.min(600, doc.body.offsetHeight))}px`;
  });
  resizeObserver.observe(doc.body);
});
window.addEventListener("message", event => {
  if (event.source === frame.contentWindow && event.data?.type === "preview-navigation") {
    notice.textContent = event.data.text;
  }
});
scenario.addEventListener("change", renderPreview);
document.getElementById("reload").addEventListener("click", renderPreview);
expanded.addEventListener("change", () => {
  const panel = frame.contentDocument?.getElementById("preview-panel");
  if (panel) panel.open = expanded.checked;
  rememberState();
});
renderPreview();
