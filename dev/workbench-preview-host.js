/* Development host only. Never loaded by the extension manifest. */
const frame = document.getElementById("workbench-preview");
const scenario = document.getElementById("scenario");
const version = document.getElementById("version");
const initial = new URLSearchParams(location.search).get("state");
if (new URLSearchParams(location.search).get("version") === "current") version.value = "current";
if ([...scenario.options].some(option => option.value === initial)) scenario.value = initial;
let renderRun = 0;
async function renderPreview() {
  const run = ++renderRun;
  const url = new URL(location.href);
  url.searchParams.set("state", scenario.value);
  url.searchParams.set("version", version.value);
  history.replaceState(null, "", url);
  const error = document.getElementById("host-error");
  error.hidden = true;
  try {
    const responses = await Promise.all([
      fetch("../extension/course.html", { cache: "no-store" }),
      ...(version.value === "dev" ? [fetch("skill-builder.html", { cache: "no-store" })] : [])
    ]);
    const failed = responses.find(response => !response.ok);
    if (failed) throw new Error(`界面读取失败：HTTP ${failed.status}`);
    const [html, builderHtml] = await Promise.all(responses.map(response => response.text()));
    if (run !== renderRun) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (version.value === "dev") {
      const builderDoc = new DOMParser().parseFromString(builderHtml, "text/html");
      doc.getElementById("note-preferences-page").replaceWith(doc.importNode(builderDoc.getElementById("note-preferences-page"), true));
      for (const file of ["skill-builder-core.js", "skill-builder.js"]) doc.querySelector(`script[src="${file}"]`).src = new URL(file, location.href).href;
      doc.querySelector('link[href="skill-builder.css"]').href = new URL("skill-builder.css", location.href).href;
    }
    const base = doc.createElement("base");
    base.href = new URL("../extension/", location.href).href;
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
version.addEventListener("change", renderPreview);
document.getElementById("reload").addEventListener("click", renderPreview);
renderPreview();
