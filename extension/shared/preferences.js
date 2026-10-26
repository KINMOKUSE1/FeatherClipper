/* 持久偏好统一使用扩展本地存储；首次读取时迁移旧 localStorage。 */
(function (root) {
  const keys = ["skill-builder", "notes-delivery", "notes-installed", "notes-install-method", "notes-exported"].map(name => `featherclipper:${name}:v1`);
  let values = {}, pending = Promise.resolve();
  const area = () => root.chrome.storage.local;
  async function init(legacy = root.localStorage) {
    const stored = await area().get(keys), migrated = {};
    for (const key of keys) {
      const old = legacy?.getItem(key);
      if (stored[key] === undefined && old !== null && old !== undefined) migrated[key] = old;
    }
    if (Object.keys(migrated).length) await area().set(migrated);
    values = { ...stored, ...migrated };
    for (const key of keys) if (values[key] !== undefined && !root.frameElement) legacy?.removeItem(key);
  }
  function update(changes) {
    Object.assign(values, changes);
    const write = pending.catch(() => {}).then(() => area().set(changes));
    pending = write;
    return write;
  }
  const api = { init, update, get: key => values[key] ?? null,
    set: (key, value) => update({ [key]: value }), remove: key => update({ [key]: null }) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Preferences = api;
})(globalThis);
