/* App language is independent of subtitle language and the note language preference.
 * Fixed HTML opts in through data-i18n; never translate arbitrary DOM/user content.
 * Source phrases are dictionary keys (gettext-style); new text needs both locales.
 */
(function(root) {
  const node = typeof module !== "undefined" && module.exports;
  const dictionaries = node ? { en: require("./locales/en.js"), "zh-TW": require("./locales/zh-TW.js") } : root.LocaleMessages;
  const storageKey = "featherclipper:ui-locale";
  const listeners = new Set(), proxies = new WeakMap();
  let locale = "zh-CN", errorPatterns, reverseMessages;
  const normalize = value => /^en(?:-|$)/i.test(value || "") ? "en" : /^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(value || "") ? "zh-TW" : "zh-CN";
  const outputLocale = (value = locale) => normalize(value) === "zh-CN" ? "zh-CN" : "en";
  function t(source, values = {}, target = locale) {
    const template = dictionaries?.[normalize(target)]?.[source] ?? source;
    return String(template).replace(/\{(\w+)\}/g, (match, key) => values[key] == null ? match : String(values[key]));
  }
  function map(source) {
    if (!source || typeof source !== "object") return source;
    if (!proxies.has(source)) proxies.set(source, new Proxy(source, { get(object, key) {
      const value = Reflect.get(object, key);
      if (key === "i18n") return value;
      return typeof value === "string" ? t(value) : typeof value === "object" ? map(value) : value;
    } }));
    return proxies.get(source);
  }
  function catalog(source, target) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, typeof value === "string" ? t(value, {}, target) : value && typeof value === "object" ? catalog(value, target) : value]));
  }
  function error(message, target = locale) {
    if (!message) return message;
    target = normalize(target);
    reverseMessages ||= new Map(Object.values(dictionaries).flatMap(messages => Object.entries(messages).map(([source, translated]) => [translated, source])));
    const source = reverseMessages.get(message) || message;
    if (source !== message || dictionaries?.en?.[source]) return t(source, {}, target);
    if (target === "zh-CN") return message;
    // Translate only known product error templates. Preserve remote error details.
    errorPatterns ||= Object.keys(dictionaries.en).filter(key => /\{(?:\w+)\}/.test(key)).flatMap(key => [...new Set([key, dictionaries.en[key], dictionaries["zh-TW"][key]])].map(template => {
      const names = [], pattern = template.split(/(\{\w+\})/).map(part => {
        if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1,-1)); return "(.+?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("");
      return { key, names, regex: new RegExp("^" + pattern + "$", "s") };
    }));
    for (const item of errorPatterns) {
      const match = String(message).match(item.regex);
      if (match) return t(item.key, Object.fromEntries(item.names.map((name, i) => [name, error(match[i+1], target)])), target);
    }
    if (String(message).includes("；")) return String(message).split("；").map(part => error(part, target)).join(target === "en" ? "; " : "；");
    return message;
  }
  function apply(scope = root.document) {
    if (!scope?.querySelectorAll) return;
    if (scope.documentElement) scope.documentElement.lang = locale;
    for (const element of scope.querySelectorAll("[data-i18n]")) element.textContent = t(element.getAttribute("data-i18n"));
    for (const attr of ["placeholder", "title", "aria-label"]) {
      for (const element of scope.querySelectorAll(`[data-i18n-${attr}]`)) element.setAttribute(attr, t(element.getAttribute(`data-i18n-${attr}`)));
    }
    for (const select of scope.querySelectorAll("[data-language-selector]")) {
      select.value = locale;
      if (!select.dataset.languageBound) {
        select.dataset.languageBound = "true";
        select.addEventListener("change", () => setLocale(select.value).catch(err => { select.value = locale; console.error(err); }));
      }
    }
  }
  async function setLocale(value, persist = true) {
    const next = normalize(value);
    // The storage key is separate from connection settings and credentials.
    if (persist && root.chrome?.storage?.local?.set) await root.chrome.storage.local.set({ [storageKey]: next });
    const previous = locale;
    locale = next;
    apply();
    if (previous !== next) for (const listener of listeners) await listener({ locale, previous, outputChanged: outputLocale(previous) !== outputLocale(next) });
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  const ready = (async () => {
    if (node) return;
    const browser = root.chrome?.i18n?.getUILanguage?.() || root.navigator?.language || "zh-CN";
    const stored = await root.chrome?.storage?.local?.get?.(storageKey);
    // A preview query is deliberately confined to the development iframe.
    const preview = root.frameElement && new URL(root.parent.location.href).searchParams.get("locale");
    locale = normalize(preview || stored?.[storageKey] || browser);
    apply();
  })();
  root.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === "local" && changes[storageKey]) setLocale(changes[storageKey].newValue, false).catch(console.error);
  });
  const api = { t, map, catalog, error, apply, setLocale, subscribe, ready, normalize, outputLocale, storageKey, get locale() { return locale; } };
  if (node) module.exports = api;
  else root.I18n = api;
})(globalThis);
