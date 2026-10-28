/* Run with Playwright and an isolated Edge profile; all network responses use local preview fixtures. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.FEATHERCLIPPER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1050, height: 900 } });
  const page = await context.newPage(), errors = [];
  const connectionError = '无法连接 Obsidian，请确认它已打开且 Local REST API 正在运行。';
  let failureMode = '';
  const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), 'featherclipper-i18n-'));
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:48193') return route.abort();
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    try {
      let body = await fs.readFile(path.join(__dirname, '..', decodeURIComponent(url.pathname)));
      if (url.pathname.endsWith('/popup-preview-mock.js') && failureMode) {
        let fixture = body.toString();
        const failed = JSON.stringify({ status: 'failed', error: connectionError });
        if (failureMode === 'saved job') fixture = fixture.replace(/  let jobState = [^\n]+;/, '  let jobState = ' + failed + ';');
        if (failureMode === 'import response') fixture = fixture.replace('jobState = { status: "saved" };', 'jobState = ' + failed + ';');
        fixture = fixture.replace('onChanged: { addListener() {} }', 'onChanged: { addListener(listener) { (window.testStorageListeners ||= []).push(listener); } }');
        body = Buffer.from(fixture);
      }
      if (url.pathname.endsWith('/workbench-preview-mock.js') && failureMode === 'course import') {
        body = Buffer.from(body.toString().replace('  async function sendMessage(message) {', '  async function sendMessage(message) {\n    if (message.action === "index") return ' + JSON.stringify({ ok: false, fatal: true, error: connectionError }) + ';'));
      }
      await route.fulfill({ body, contentType: types[path.extname(url.pathname)] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  async function open(entry, query) {
    await page.goto(`http://127.0.0.1:48193/dev/${entry}.html?${query}`);
    const frame = await (await page.locator(entry === 'preview' ? '#popup-preview' : '#workbench-preview').elementHandle()).contentFrame();
    await frame.waitForFunction(() => window.I18n);
    await frame.evaluate(() => I18n.ready);
    if (entry !== 'preview') { await frame.waitForFunction(() => window.WorkbenchApp); await frame.evaluate(() => WorkbenchApp.ready); }
    return frame;
  }
  const select = (frame, id, value) => frame.locator('#' + id).evaluate((input, value) => {
    input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  try {
    for (const locale of ['en', 'zh-TW']) {
      const english = locale === 'en';
      const frame = await open('workbench-preview', `state=single&page=notes&locale=${locale}`);
      await frame.locator('#notes-nav').click();
      await select(frame, 'builder-environment', 'web');
      await select(frame, 'builder-task', 'continue');
      assert.equal(await frame.locator('#builder-web-materials-trigger').innerText(), english ? 'Choose file' : '選擇檔案');
      assert.equal(await frame.locator('#builder-web-reference-trigger').innerText(), english ? 'Choose files' : '選擇多個檔案');
      assert.equal(await frame.locator('#builder-web-materials-status').innerText(), english ? 'No file selected' : '未選擇檔案');
      assert.equal(await frame.locator('#builder-web-materials').isVisible(), false);
      assert.equal(await frame.locator('#builder-copy-label').innerText(), english ? 'Copy task instructions' : '複製任務指令');

      const chooserPromise = page.waitForEvent('filechooser');
      await frame.locator('#builder-web-materials-trigger').click();
      const chooser = await chooserPromise;
      await chooser.setFiles({ name: '课程字幕.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nOriginal transcript / 原文') });
      await frame.locator('#builder-web-materials-trigger').waitFor({ state: 'visible' });
      await frame.waitForFunction(() => !document.getElementById('builder-web-materials-trigger').disabled);
      assert.equal(await frame.locator('#builder-web-materials-status').innerText(), '课程字幕.srt');
      await frame.locator('#builder-web-reference').setInputFiles([
        { name: 'existing-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Existing notes') },
        { name: 'progress.md', mimeType: 'text/markdown', buffer: Buffer.from('# Progress') }
      ]);
      await frame.waitForFunction(() => !document.getElementById('builder-web-reference-trigger').disabled);
      assert.equal(await frame.locator('#builder-web-reference-status').innerText(), english ? 'Files selected: 2' : '已選擇 2 個檔案');
      await frame.locator('#builder-goal').fill('Keep my words / 我的目标');
      await frame.evaluate(locale => I18n.setLocale(locale, false), english ? 'zh-TW' : 'en');
      assert.equal(await frame.locator('#builder-web-materials-status').innerText(), '课程字幕.srt');
      assert.equal(await frame.locator('#builder-web-materials-trigger').innerText(), english ? '選擇檔案' : 'Choose file');
      assert.equal(await frame.locator('#builder-goal').inputValue(), 'Keep my words / 我的目标');
      await frame.evaluate(locale => I18n.setLocale(locale, false), locale);

      assert.ok(await frame.locator('.notes-section-nav a').evaluateAll(links => links.every(link => link.scrollWidth <= link.clientWidth + 1)), 'Section navigation labels must fit');

      await frame.locator('#builder-delivery-more').click();
      const label = frame.locator('#builder-format-trigger .builder-select-value');
      assert.equal(await label.innerText(), 'Markdown');
      assert.ok(await label.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Markdown must fit without truncation');
      const bounds = await frame.locator('#builder-delivery-menu').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1050, 'Export menu stays within the viewport');
      await page.screenshot({ path: path.join(screenshots, `notes-${locale}.png`) });
      await frame.locator('#builder-format-trigger').click();
      await frame.locator('#builder-format-trigger-menu').getByRole('option', { name: 'ZIP', exact: true }).click();
      assert.equal(await frame.locator('#builder-format').inputValue(), 'zip');
      await frame.locator('#builder-delivery-more').click();

      for (const width of [620, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await frame.locator('#builder-web-materials-trigger').scrollIntoViewIfNeeded();
        assert.ok(await frame.locator('#builder-web-materials-row .builder-file-input').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `Upload control must fit at ${width}px`);
      }
      await page.setViewportSize({ width: 1050, height: 900 });
      await frame.locator('#builder-web-materials').setInputFiles([]);
      await frame.waitForFunction(() => !document.getElementById('builder-web-materials-trigger').disabled);
      assert.equal(await frame.locator('#builder-web-materials-status').innerText(), english ? 'No file selected' : '未選擇檔案');
      for (const task of ['notes', 'supplement', 'continue', 'translate', 'review']) {
        await select(frame, 'builder-task', task);
        assert.equal(await frame.locator('#builder-task-trigger-menu').getAttribute('aria-label'), english ? 'Task type' : '任務類型');
      }
      for (const [nav, heading, expected] of [
        ['catalog-nav', '#course-name', null], ['history-nav', '#history-title', english ? 'Import history' : '匯入記錄'],
        ['local-asr-settings', '#asr-title', english ? 'Audio transcription' : '音訊轉寫'], ['settings', '#settings-title', english ? 'Connections' : '連線設定']
      ]) {
        await frame.locator('#' + nav).click();
        if (expected) assert.equal(await frame.locator(heading).innerText(), expected);
        if (nav === 'catalog-nav') {
          await frame.locator('#start').click();
          await frame.locator('.badge.saved').waitFor();
          await frame.waitForFunction(() => document.getElementById('start').getAttribute('aria-busy') === 'false');
          await frame.locator('#start').click();
          await frame.locator('.badge.exists').waitFor();
          assert.ok(await frame.locator('.badge.exists').evaluate(badge => badge.getBoundingClientRect().left >= badge.closest('td').getBoundingClientRect().left + 5), 'Already-exists badge must stay inside its status column');
        }
      }
      const popup = await open('preview', `state=series&locale=${locale}&expanded=1`);
      await popup.waitForFunction(() => document.getElementById('video-meta').textContent.includes('92'));
      assert.match(await popup.locator('#video-meta').innerText(), english ? /92 parts/ : /92 P/);
      await popup.locator('#scope-all').click();
      assert.match(await popup.locator('#import-label').innerText(), english ? /92 parts/ : /92 P/);
      await page.screenshot({ path: path.join(screenshots, `popup-${locale}.png`) });
    }
    for (const locale of ['en', 'zh-TW']) {
      const expected = locale === 'en' ? 'Cannot connect to Obsidian. Check that it is open and Local REST API is running.'
        : '無法連線 Obsidian，請確認它已開啟且 Local REST API 正在執行。';
      for (const mode of ['saved job', 'import response', 'storage update']) {
        failureMode = mode;
        const popup = await open('preview', 'state=single&locale=' + locale);
        await popup.waitForFunction(() => !document.getElementById('import').disabled);
        if (mode === 'import response') await popup.locator('#import').click();
        if (mode === 'storage update') await popup.evaluate(error => {
          for (const listener of window.testStorageListeners) listener({ 'preview-job': { newValue: { status: 'failed', error } } }, 'local');
        }, connectionError);
        await popup.waitForFunction(expected => document.getElementById('status').textContent === expected, expected);
        assert.equal(await popup.locator('#status').innerText(), expected);
        await page.screenshot({ path: path.join(screenshots, 'popup-error-' + locale + '-' + mode.replaceAll(' ', '-') + '.png') });
      }
      failureMode = 'course import';
      const frame = await open('workbench-preview', 'state=single&page=catalog&locale=' + locale);
      await frame.waitForFunction(() => document.querySelector(".part-title") && !document.getElementById("start").disabled);
      await frame.evaluate(error => WorkbenchApp.loadCourse({ subtitlePreview: { bvid: 'BV1ps4y1d73V', cid: '700001', status: 'failed', error } }), connectionError);
      assert.equal(await frame.locator('#preview-body .error').innerText(), expected);
      assert.equal(await frame.locator('.badge.failed').getAttribute('title'), expected);
      await frame.locator('#start').click();
      await frame.waitForFunction(() => document.getElementById('start').dataset.state === 'error');
      assert.ok((await frame.locator('#start').getAttribute('title')).includes(expected));
      assert.ok((await frame.locator('#start').getAttribute('aria-label')).includes(expected));
      await frame.evaluate(() => I18n.setLocale('zh-CN', false));
      assert.ok((await frame.locator('#start').getAttribute('title')).includes(connectionError));
      assert.equal(await frame.locator('#preview-body .error').innerText(), connectionError);
      failureMode = '';
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', verified: ['English and Traditional previews', 'native file chooser and file reading', 'multiple references', 'clear selection', 'language switching preserves filenames and custom input', 'all five task modes', 'export format menu at 1050px', 'workbench pages', 'popup part units', 'saved and live import errors', 'subtitle handoff errors', 'error tooltips and language changes'], screenshots }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
