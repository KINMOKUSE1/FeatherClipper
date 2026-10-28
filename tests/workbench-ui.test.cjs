const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function boot(file, copy = require('../extension/shared/ui-text.js')) {
  const nodes = new Map();
  function node() {
    return { hidden: true, dataset: {}, children: [], attributes: {}, handlers: {},
      classList: { add() {}, remove() {} }, style: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }, focus() {} };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const window = { matchMedia: () => ({ matches: true }) };
  const context = vm.createContext({ UiText: copy, window, setTimeout: () => 1, clearTimeout() {},
    document: { getElementById: get, createElement: node, querySelector: selector => get(selector),
      querySelectorAll: () => [] }
  });
  vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  return { window, get };
}

test('extracted subtitle view renders messages and opens/closes without catalog globals', () => {
  const h = boot('../extension/workbench/catalog/preview.js');
  const view = h.window.createSubtitlePreview();
  view.open(true);
  view.message('正在获取字幕');
  assert.equal(view.isOpen(), true);
  assert.equal(h.get('preview-panel').hidden, false);
  assert.equal(h.get('preview-body').children[0].textContent, '正在获取字幕');
  view.message('读取失败', true);
  assert.equal(h.get('preview-body').children[0].className, 'preview-message error');
  view.close();
  assert.equal(view.isOpen(), false);
  assert.equal(h.get('preview-panel').hidden, true);
});

test('import action ignores repeated cancellation but allows restarting after canceled result', () => {
  const h = boot('../extension/workbench/catalog/import-button.js');
  let activations = 0;
  const action = h.window.createImportButton({ onActivate: () => activations++, clearStatus() {} });
  const button = h.get('start');
  action.progress(1, 4);
  button.handlers.click();
  assert.equal(activations, 1);
  action.render({ stopping: true });
  button.handlers.click();
  assert.equal(activations, 1);
  action.result('已停止', { saved: 1 }, 3, null, '', true);
  assert.equal(button.dataset.state, 'canceled');
  button.handlers.click();
  assert.equal(activations, 2);
  action.render({ stopping: false });
  action.progress(0, 3);
  assert.equal(button.dataset.state, 'running');
  assert.match(button.attributes['aria-label'], /再次点击取消/);
});

test('central copy can change result wording while preserving import state and count', () => {
  const copy = require('../extension/shared/ui-text.js');
  const h = boot('../extension/workbench/catalog/import-button.js', {
    ...copy, i18n: copy.i18n, importButton: { ...copy.importButton, savedCount: '保存完成，共 {count} 节' }
  });
  const action = h.window.createImportButton({ onActivate() {}, clearStatus() {} });
  action.progress(2, 2);
  action.result('导入完成', { saved: 2 }, 0);
  const button = h.get('start');
  const content = button.children.find(item => item.className === 'import-button-content');
  const label = content.children.find(item => item.className === 'import-button-label');
  assert.equal(button.dataset.state, 'complete');
  assert.equal(label.textContent, '保存完成，共 2 节');
});

test('copy placeholders preserve zero counts and literal values', () => {
  const { format } = require('../extension/shared/ui-text.js');
  assert.equal(format('{count} 个 · {name}', { count: 0, name: '$& {count}' }), '0 个 · $& {count}');
});

test('subtitle error messages localize on first render and follow UI language changes', async () => {
  const copy = require('../extension/shared/ui-text.js');
  const source = '无法连接 Obsidian，请确认它已打开且 Local REST API 正在运行。';
  try {
    await copy.i18n.setLocale('en', false);
    const h = boot('../extension/workbench/catalog/preview.js');
    const view = h.window.createSubtitlePreview();
    view.message(source, true);
    assert.equal(h.get('preview-body').children[0].textContent, copy.i18n.error(source));
    await copy.i18n.setLocale('zh-TW', false);
    assert.equal(h.get('preview-body').children[0].textContent, copy.i18n.error(source));
    view.message('Provider error: insufficient_quota', true);
    assert.equal(h.get('preview-body').children[0].textContent, 'Provider error: insufficient_quota');
  } finally { await copy.i18n.setLocale('zh-CN', false); }
});

test('import result tooltips and accessible labels localize error details and summaries', async () => {
  const copy = require('../extension/shared/ui-text.js');
  const source = '无法连接 Obsidian，请确认它已打开且 Local REST API 正在运行。';
  try {
    await copy.i18n.setLocale('en', false);
    const h = boot('../extension/workbench/catalog/import-button.js');
    const action = h.window.createImportButton({ onActivate() {}, clearStatus() {} });
    action.progress(0, 2);
    action.result('导入已中断', {}, 2, new Error(source), '本次使用 CPU 转写。');
    for (const locale of ['en', 'zh-TW', 'zh-CN']) {
      await copy.i18n.setLocale(locale, false); action.render();
      const button = h.get('start');
      assert.equal(button.title, [copy.i18n.error('导入已中断') + ' · ' + copy.importButton.summaryRemaining + ' 2', copy.i18n.error(source), copy.i18n.error('本次使用 CPU 转写。')].join('\n'));
      assert.equal(button.attributes['aria-label'], button.title);
    }
    action.result('导入已中断', {}, 2, new Error('Provider error: insufficient_quota'));
    assert.match(h.get('start').title, /Provider error: insufficient_quota/);
  } finally { await copy.i18n.setLocale('zh-CN', false); }
});
