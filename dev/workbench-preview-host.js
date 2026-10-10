/* Development host only. Never loaded by the extension manifest. */
const frame = document.getElementById("workbench-preview");
const scenario = document.getElementById("scenario");
const initial = new URLSearchParams(location.search).get("state");
if ([...scenario.options].some(option => option.value === initial)) scenario.value = initial;
let renderRun = 0;
async function renderPreview() {
  const run = ++renderRun;
  const url = new URL(location.href);
  url.searchParams.set("state", scenario.value);
  url.searchParams.delete("version");
  history.replaceState(null, "", url);
  const error = document.getElementById("host-error");
  error.hidden = true;
  try {
    const response = await fetch("../extension/workbench/index.html", { cache: "no-store" });
    if (!response.ok) throw new Error(`界面读取失败：HTTP ${response.status}`);
    const html = await response.text();
    if (run !== renderRun) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = doc.createElement("base");
    base.href = new URL("../extension/workbench/", location.href).href;
    const mock = doc.createElement("script");
    mock.src = new URL("workbench-preview-mock.js", location.href).href;
    doc.head.prepend(base, mock);
    for (const asset of doc.querySelectorAll('link[rel="stylesheet"][href], script[src]')) {
      const attribute = asset.tagName === "LINK" ? "href" : "src";
      const assetUrl = new URL(asset.getAttribute(attribute), base.href);
      assetUrl.searchParams.set("preview", String(Date.now()));
      asset.setAttribute(attribute, assetUrl.href);
    }
    frame.dataset.scenario = scenario.value;
    frame.dataset.page = url.searchParams.get("page") || "";
    frame.srcdoc = "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch (failure) {
    error.textContent = `${failure.message}。请通过本地 HTTP 服务打开此预览。`;
    error.hidden = false;
  }
}
scenario.addEventListener("change", renderPreview);
document.getElementById("reload").addEventListener("click", renderPreview);
renderPreview();
