/* Real Chromium check: node tests/user-data-browser.cjs; uses an isolated temporary profile. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'featherclipper-user-data-'));
  const first = path.join(temp, 'original'), second = path.join(temp, 'relocated');
  const source = path.join(__dirname, '../extension');
  await fs.cp(source, first, { recursive: true, filter: file => !file.endsWith('.exe') });
  const manifest = JSON.parse(await fs.readFile(path.join(first, 'manifest.json'), 'utf8'));
  const fixedId = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  const oldManifest = { ...manifest }; delete oldManifest.key;
  await fs.writeFile(path.join(first, 'manifest.json'), JSON.stringify(oldManifest));
  const profile = path.join(temp, 'browser-profile');
  const errors = [];
  let context;
  async function launch(extension) {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.FEATHERCLIPPER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    return new URL(worker.url()).host;
  }
  async function open(id) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/workbench/index.html`);
    await page.evaluate(() => WorkbenchApp.ready);
    return page;
  }
  try {
    const oldId = await launch(first), page = await open(oldId);
    assert.notEqual(oldId, fixedId);
    await page.evaluate(async () => {
      await chrome.storage.local.set({ noteFolder: 'Study', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'fixture-only-key' });
      localStorage.setItem('featherclipper:skill-builder:v1', JSON.stringify({ goal: 'Migrated goal' }));
    });
    // New source is available before the extension manager reloads the manifest.
    await fs.writeFile(path.join(first, 'manifest.json'), JSON.stringify(manifest));
    await page.reload(); await page.evaluate(() => WorkbenchApp.ready);
    assert.equal(await page.evaluate(() => chrome.runtime.id), oldId);
    await page.click('#backup-nav');
    assert.equal(await page.locator('#backup-page').isVisible(), true);
    assert.equal(await page.locator('#connection-page').isVisible(), false);
    assert.equal(await page.locator('#backup-nav').getAttribute('aria-current'), 'page');
    await page.click('#settings');
    assert.equal(await page.locator('#export-backup').isVisible(), false);
    await page.click('#backup-nav'); await page.check('#backup-secrets');
    const downloaded = page.waitForEvent('download');
    await page.click('#export-backup');
    assert.notEqual(await page.locator('#backup-status').innerText(), '');
    const backupPath = await (await downloaded).path();
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    assert.equal(backup.data.obsidianApiKey, 'fixture-only-key');
    assert.equal(JSON.parse(backup.data['featherclipper:skill-builder:v1']).goal, 'Migrated goal');
    assert.equal(await page.evaluate(() => localStorage.getItem('featherclipper:skill-builder:v1')), null);
    const retainedBackup = path.join(temp, 'backup.json');
    await fs.writeFile(retainedBackup, JSON.stringify(backup));
    await context.close(); context = null;
    await fs.cp(first, second, { recursive: true });
    assert.equal(await launch(second), fixedId);
    const restored = await open(fixedId);
    await restored.click('#backup-nav');
    await restored.locator('#backup-file').setInputFiles(retainedBackup);
    await restored.waitForFunction(async () => (await chrome.storage.local.get('obsidianApiKey')).obsidianApiKey === 'fixture-only-key');
    await restored.waitForLoadState('load');
    await restored.evaluate(() => WorkbenchApp.ready);
    const state = await restored.evaluate(() => chrome.storage.local.get(['noteFolder', 'featherclipper:skill-builder:v1']));
    assert.equal(state.noteFolder, 'Study');
    assert.equal(JSON.parse(state['featherclipper:skill-builder:v1']).goal, 'Migrated goal');
    await context.close(); context = null;
    // Same public key, different installation path, same browser profile and stored data.
    assert.equal(await launch(first), fixedId);
    const updated = await open(fixedId);
    assert.equal(await updated.evaluate(async () => (await chrome.storage.local.get('obsidianApiKey')).obsidianApiKey), 'fixture-only-key');
    await updated.click('#notes-nav');
    await updated.locator('#builder-goal').fill('Persisted through the actual notes form');
    await updated.waitForFunction(async () => JSON.parse((await chrome.storage.local.get('featherclipper:skill-builder:v1'))['featherclipper:skill-builder:v1']).goal === 'Persisted through the actual notes form');
    await updated.reload(); await updated.evaluate(() => WorkbenchApp.ready); await updated.click('#notes-nav');
    assert.equal(await updated.locator('#builder-goal').inputValue(), 'Persisted through the actual notes form');
    await updated.click('#backup-nav');
    await updated.setViewportSize({ width: 980, height: 800 });
    await updated.screenshot({ path: path.join(temp, 'backup-settings.png'), fullPage: true });
    await updated.click('#interface-language-trigger');
    await updated.getByRole('option', { name: 'English', exact: true }).click();
    await updated.waitForFunction(() => I18n.locale === 'en');
    assert.equal(await updated.locator('#backup-title').innerText(), 'Data backup');
    await updated.click('#interface-language-trigger');
    await updated.getByRole('option', { name: '繁體中文', exact: true }).click();
    await updated.waitForFunction(() => I18n.locale === 'zh-TW');
    assert.equal(await updated.locator('#backup-title').innerText(), '資料備份');
    const preview = await context.newPage();
    preview.on('pageerror', error => errors.push(error.message));
    await preview.route('http://127.0.0.1:48193/**', async route => {
      const name = new URL(route.request().url()).pathname;
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      try { await route.fulfill({ body: await fs.readFile(path.join(__dirname, '..', name)), contentType: types[path.extname(name)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    await preview.goto('http://127.0.0.1:48193/dev/workbench-preview.html?state=empty&page=backup');
    const previewFrame = await preview.locator('#workbench-preview').elementHandle();
    const frame = await previewFrame.contentFrame();
    await frame.waitForFunction(() => window.WorkbenchApp);
    await frame.evaluate(() => WorkbenchApp.ready);
    await frame.waitForFunction(() => !document.getElementById('backup-page').hidden);
    assert.equal(await frame.locator('#export-backup').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', oldId, fixedId, screenshot: path.join(temp, 'backup-settings.png'), temp }));
  } finally { if (context) await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
