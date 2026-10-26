/* Real Edge check: preference migration, in-place update, and development preview in an isolated profile. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'featherclipper-user-data-'));
  const extension = path.join(temp, 'extension'), profile = path.join(temp, 'browser-profile');
  const source = path.join(__dirname, '../extension');
  const copySource = () => fs.cp(source, extension, { recursive: true, filter: file => !file.endsWith('.exe') });
  await copySource();
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.ok(manifest.key);
  const id = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  const errors = [], historyKey = 'featherclipper:import-history:BVfixture:1:Study';
  let context;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.FEATHERCLIPPER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    assert.equal(new URL(worker.url()).host, id);
  }
  async function open() {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/workbench/index.html`);
    await page.evaluate(() => WorkbenchApp.ready);
    return page;
  }
  try {
    await launch();
    let page = await open();
    await page.evaluate(async historyKey => {
      await chrome.storage.local.set({ noteFolder: 'Study', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'fixture-only-key',
        'featherclipper:ui-locale': 'en',
        [historyKey]: { courseId: 'BVfixture', cid: '1', title: 'Fixture lesson', base: 'Study', importedAt: 100 } });
      localStorage.setItem('featherclipper:skill-builder:v1', JSON.stringify({ goal: 'Migrated goal' }));
    }, historyKey);
    await page.reload(); await page.evaluate(() => WorkbenchApp.ready);
    assert.equal(await page.evaluate(() => localStorage.getItem('featherclipper:skill-builder:v1')), null);
    await page.click('#notes-nav');
    assert.equal(await page.locator('#builder-goal').inputValue(), 'Migrated goal');
    await page.locator('#builder-goal').fill('Persisted through the actual notes form');
    await page.waitForFunction(async () => JSON.parse((await chrome.storage.local.get('featherclipper:skill-builder:v1'))['featherclipper:skill-builder:v1']).goal === 'Persisted through the actual notes form');
    await context.close(); context = null;

    // Replace the program files in place and reload the same extension identity.
    await copySource();
    const version = manifest.version.split('.').map(Number); version[version.length - 1]++;
    const updatedVersion = version.join('.');
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ ...manifest, version: updatedVersion }));
    await launch(); page = await open();
    assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), updatedVersion);
    const stored = await page.evaluate(() => chrome.storage.local.get(null));
    assert.equal(stored.obsidianApiKey, 'fixture-only-key');
    assert.equal(stored.noteFolder, 'Study');
    assert.equal(stored[historyKey].title, 'Fixture lesson');
    assert.equal(stored['featherclipper:ui-locale'], 'en');
    assert.equal(JSON.parse(stored['featherclipper:skill-builder:v1']).goal, 'Persisted through the actual notes form');
    await page.click('#notes-nav');
    assert.equal(await page.locator('#builder-goal').inputValue(), 'Persisted through the actual notes form');
    await page.click('#settings');
    assert.equal(await page.locator('#settings-title').innerText(), 'Connections');
    await page.click('#interface-language-trigger');
    await page.getByRole('option', { name: '繁體中文', exact: true }).click();
    await page.waitForFunction(() => I18n.locale === 'zh-TW');
    assert.equal(await page.locator('#settings-title').innerText(), '連線設定');

    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    assert.equal(await popup.evaluate(() => PopupLanguageReady), true);
    assert.ok(popup.url().endsWith('/popup/index.html'));

    const preview = await context.newPage();
    preview.on('pageerror', error => errors.push(error.message));
    await preview.route('http://127.0.0.1:48193/**', async route => {
      const name = new URL(route.request().url()).pathname;
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      try { await route.fulfill({ body: await fs.readFile(path.join(__dirname, '..', name)), contentType: types[path.extname(name)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    await preview.goto('http://127.0.0.1:48193/dev/workbench-preview.html?state=series&page=notes');
    const previewFrame = await preview.locator('#workbench-preview').elementHandle();
    const frame = await previewFrame.contentFrame();
    await frame.waitForFunction(() => window.WorkbenchApp);
    await frame.evaluate(() => WorkbenchApp.ready);
    await frame.waitForFunction(() => !document.getElementById('note-preferences-page').hidden);
    assert.equal(await frame.locator('.sidebar > .nav-button').count(), 5);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', id, updatedVersion,
      verified: ['preference migration', 'notes form persistence', 'in-place version update', 'connection and history retention', 'language switching', 'popup startup', 'development preview'], temp }));
  } finally { if (context) await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
