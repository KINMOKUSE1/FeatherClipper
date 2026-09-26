const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

test('real track menus keep video choices separate from the saved batch preference', async () => {
  const elements = new Map(), writes = [];
  const document = { activeElement: null, addEventListener() {}, getElementById: id => elements.get(id), createElement: () => element() };
  function element() {
    return {
      children: [], handlers: {}, attributes: {}, hidden: true,
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key]; },
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      focus() { document.activeElement = this; },
      click() { return this.handlers.click?.(); },
      contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    };
  }
  for (const prefix of ['language', 'batch-language']) {
    for (const suffix of ['picker', 'trigger', 'options', 'label']) elements.set(`${prefix}-${suffix}`, element());
    elements.get(`${prefix}-picker`).append(elements.get(`${prefix}-trigger`));
    elements.get(`${prefix}-picker`).append(elements.get(`${prefix}-options`));
  }
  const context = vm.createContext({ document, chrome: { storage: { local: {
    get: async key => ({ [key]: 'en' }), set: async value => { writes.push(value); }
  } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/subtitle-language.js'), 'utf8'), context);
  const api = vm.runInContext('SubtitleLanguage', context);
  let selected;
  const single = await api.create({ onChange: value => { selected = value; } });
  const batch = await api.create({ prefix: 'batch-language', batch: true });
  assert.equal(single.current(), 'auto');
  assert.equal(batch.current(), 'en');
  const tracks = [
    { id: '.en', videoId: 'first', lan: 'en', lanDoc: 'English' },
    { id: 'a.en', videoId: 'first', lan: 'en', lanDoc: 'English（自动生成）' },
    { id: '.ja', videoId: 'first', lan: 'ja', lanDoc: '日本語' }
  ];
  single.tracks(tracks);
  const menu = elements.get('language-options');
  assert.deepEqual(menu.children.map(option => option.textContent), ['自动（推荐）', 'English', 'English（自动生成）', '日本語']);
  await menu.children[2].click();
  assert.equal(single.current().id, 'a.en');
  assert.equal(selected.videoId, 'first');
  assert.equal(batch.current(), 'en');
  assert.equal(writes.length, 0);
  single.tracks([tracks[0]], selected);
  assert.equal(single.current().id, 'a.en');
  assert.match(elements.get('language-label').textContent, /暂不可用/);
  assert.ok(menu.children.every(item => item.textContent !== 'English（自动生成）'));
  single.tracks([{ ...tracks[0], videoId: 'second' }]);
  assert.equal(single.current(), 'auto');
  assert.equal(elements.get('language-label').textContent, '自动（推荐）');
  await elements.get('batch-language-options').children[1].click();
  assert.equal(writes[0]['course-cove-subtitle-language'], 'zh');
  assert.equal(single.current(), 'auto');
  single.tracks([], 'auto', '暂未读取到语言选项');
  assert.equal(menu.children.length, 2);
  assert.equal(menu.children[1].textContent, '暂未读取到语言选项');
});
