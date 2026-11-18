// What happens to an already-open tab when the extension is reloaded or updated.
// Chrome cuts the old content script off from the extension but leaves it running, so
// without a hand-over the page keeps its panels but stops counting and stops obeying
// the on/off switch until it's refreshed.
// Usage: pnpm build && pnpm test:update
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.output/chrome-mv3');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const body = `<!doctype html><html><head><meta charset="utf-8"><title>Home / X</title></head><body>
<div data-testid="primaryColumn">
  <div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="tweetText">GTA 6 ending leak</div></article></div>
  <div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="tweetText">Lucia Caminos dies?!</div></article></div>
  <div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="tweetText">Lunch was great</div></article></div>
</div></body></html>`;

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vv-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;
/** An extension page to call chrome.* from (it works whether or not the service worker is awake). */
let api = await context.newPage();
await api.goto(`chrome-extension://${extensionId}/popup.html`);
await context.route('https://x.com/**', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body }),
);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://x.com/home');
await page.waitForTimeout(800);

const hidden = () => page.evaluate(() => document.querySelectorAll('[data-vv="on"]').length);
const badge = () =>
  api.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ index: 0, currentWindow: true }); // the X page
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
const setEnabled = (enabled) =>
  api.evaluate(async (enabled) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings ?? {}), enabled } });
  }, enabled);

check('before the update: spoilers hidden and counted', (await hidden()) === 2 && (await badge()) === '2', `hidden=${await hidden()} badge="${await badge()}"`);

// Reload the extension the way the reload arrow on chrome://extensions does.
const extensionsPage = await context.newPage();
await extensionsPage.goto('chrome://extensions');
// Same as yours: Developer mode on (Chrome disables a reloaded unpacked extension without it).
await extensionsPage.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
await extensionsPage.evaluate((id) => chrome.developerPrivate.reload(id, { failQuietly: true }), extensionId);
await page.waitForTimeout(1500);
api = await context.newPage();
for (let attempt = 0; ; attempt++) {
  // The extension takes a moment to come back after a reload.
  try {
    await api.goto(`chrome-extension://${extensionId}/popup.html`);
    break;
  } catch (error) {
    if (attempt > 20) throw error;
    await api.waitForTimeout(500);
  }
}
await page.bringToFront();
await page.waitForTimeout(500);

check('after the update: spoilers still hidden', (await hidden()) === 2, `hidden=${await hidden()}`);
check('after the update: the open tab is counted again', (await badge()) === '2', `badge="${await badge()}"`);

await setEnabled(false);
await page.waitForTimeout(800);
check('after the update: switching off un-hides the open tab', (await hidden()) === 0, `hidden=${await hidden()}`);

// If the old copy didn't really stop, it keeps hiding new content even with the shield off.
await page.evaluate(() => {
  const cell = document.createElement('div');
  cell.dataset.testid = 'cellInnerDiv';
  cell.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText">#GTA6 twist</div></article>';
  document.querySelector('[data-testid=primaryColumn]').append(cell);
});
await page.waitForTimeout(500);
check('after the update: no leftover old copy still hiding things', (await hidden()) === 0, `hidden=${await hidden()}`);

await setEnabled(true);
await page.waitForTimeout(800);
check('after the update: switching back on hides again', (await hidden()) === 3, `hidden=${await hidden()}`);

// What chrome://extensions shows under "Errors" for the extension.
const errors = await extensionsPage.evaluate(
  (id) => chrome.developerPrivate.getExtensionInfo(id).then((info) => info.runtimeErrors.map((e) => e.message)),
  extensionId,
);
check('no errors on the extension page', errors.length === 0, errors.join(' | '));

await context.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
