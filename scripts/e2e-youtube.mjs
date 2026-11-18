// End-to-end check against live YouTube with the built extension loaded in Chromium.
// Usage: pnpm build && pnpm test:e2e   (HEADED=1 to watch it)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.output/chrome-mv3');
const out = path.join(root, 'scripts/out');
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vv-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 960 },
  locale: 'en-US',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
check('extension service worker started', !!worker, worker.url());

const page = context.pages()[0] ?? (await context.newPage());

async function acceptConsent() {
  if (page.url().includes('consent.')) {
    await page.getByRole('button', { name: /reject all/i }).first().click();
    await page.waitForURL(/youtube\.com\/(?!.*consent)/);
  }
  // In-page cookie dialog shown in some regions.
  const lightbox = page.locator('ytd-consent-bump-v2-lightbox button', { hasText: /reject all/i });
  try {
    await lightbox.first().click({ timeout: 6000 });
    await page.waitForTimeout(800);
  } catch {
    // no dialog
  }
}

/** Hidden cards are visibility:hidden under the panel, so click the panel by position. */
async function clickPanel(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = await locator.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function stats() {
  return page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll(
        'ytd-video-renderer, ytd-rich-item-renderer, yt-lockup-view-model, ytd-compact-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-channel-renderer, ytd-playlist-renderer',
      ),
    ].filter((el) => el.getBoundingClientRect().height > 0 && !el.parentElement?.closest('ytd-rich-item-renderer'));
    const titleOf = (el) =>
      (el.querySelector('#video-title, h3, a[title], .yt-lockup-metadata-view-model__title, [role="heading"]')
        ?.textContent ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 90);
    const hiddenSel = '[data-vv="on"],[data-vv="confirm"]';
    const hidden = cards.filter((el) => el.matches(hiddenSel) || el.closest(hiddenSel));
    const visible = cards.filter((el) => !hidden.includes(el));
    return {
      total: cards.length,
      hidden: hidden.length,
      hiddenTitles: hidden.map(titleOf).slice(0, 8),
      visibleTitles: visible.map(titleOf).slice(0, 12),
    };
  });
}

async function badge() {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
}

// ---------------------------------------------------------------- 1. search results
await page.goto('https://www.youtube.com/results?search_query=gta+6', { waitUntil: 'domcontentloaded' });
await acceptConsent();
await page.waitForSelector('ytd-video-renderer, yt-lockup-view-model', { state: 'attached', timeout: 30000 });
await acceptConsent();
await page.mouse.wheel(0, 2500);
await page.waitForTimeout(2500);
await page.mouse.wheel(0, -2500);
await page.waitForTimeout(1500);
const gta = await stats();
console.log('gta 6 search:', JSON.stringify(gta, null, 2));
check('GTA 6 search: most results hidden', gta.total > 5 && gta.hidden / gta.total >= 0.7, `${gta.hidden}/${gta.total}`);
const gtaVisibleLeaks = gta.visibleTitles.filter((t) => /gta\s*(6|vi\b)|grand theft auto (6|vi\b)/i.test(t));
check('GTA 6 search: no visible card names GTA 6', gtaVisibleLeaks.length === 0, gtaVisibleLeaks.join(' | '));
const badgeText = await badge();
check('toolbar badge shows a count', Number.parseInt(badgeText, 10) > 0, `badge="${badgeText}"`);
await page.screenshot({ path: path.join(out, '1-search-gta6.png') });

// ---------------------------------------------------------------- 2. click twice to reveal
const urlBefore = page.url();
await page
  .locator('ytd-video-renderer[data-vv="on"], yt-lockup-view-model[data-vv="on"]')
  .nth(2)
  .evaluate((el) => el.setAttribute('data-e2e-target', ''));
const target = page.locator('[data-e2e-target]');
await clickPanel(target);
await page.waitForTimeout(400);
const afterFirst = await target.getAttribute('data-vv');
check('first click asks for confirmation, no navigation', afterFirst === 'confirm' && page.url() === urlBefore, `state=${afterFirst}`);
await page.screenshot({ path: path.join(out, '2-confirm.png') });
await clickPanel(target);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, '2b-revealed.png') });
const afterSecond = await target.getAttribute('data-vv');
check('second click reveals the card', afterSecond === 'revealed' && page.url() === urlBefore, `state=${afterSecond}`);

// ---------------------------------------------------------------- 3. SPA navigation to an unrelated search
const searchBox = page.locator('input[name="search_query"]').first();
await searchBox.click();
await searchBox.fill('minecraft house tutorial');
await searchBox.press('Enter');
await page.waitForURL(/search_query=minecraft/);
await page.waitForTimeout(4000);
const mc = await stats();
console.log('minecraft search:', JSON.stringify(mc, null, 2));
const mcFalse = mc.hiddenTitles.filter((t) => !/gta|grand theft|leonida/i.test(t));
check('unrelated search: recycled cards un-hide (no false positives)', mc.total > 5 && mcFalse.length === 0, `${mc.hidden}/${mc.total} hidden; unexpected: ${mcFalse.join(' | ')}`);
await page.screenshot({ path: path.join(out, '3-search-minecraft.png') });

// ---------------------------------------------------------------- 4. watch page of a GTA 6 trailer
await page.goto('https://www.youtube.com/watch?v=QdBZY2fkU-0', { waitUntil: 'domcontentloaded' });
await acceptConsent();
await page.waitForSelector('ytd-watch-metadata', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(6000);
const watch = await page.evaluate(() => {
  const video = document.querySelector('#movie_player video');
  return {
    metadata: document.querySelector('ytd-watch-metadata')?.getAttribute('data-vv'),
    player: document.querySelector('#movie_player')?.getAttribute('data-vv'),
    comments: document.querySelector('ytd-comments#comments')?.getAttribute('data-vv'),
    paused: video ? video.paused : null,
    currentTime: video ? video.currentTime : null,
    title: document.title,
  };
});
console.log('watch page:', watch);
check('watch page: title + description hidden', watch.metadata === 'on');
check('watch page: player covered', watch.player === 'on');
check('watch page: comment section covered', watch.comments === 'on', `comments=${watch.comments}`);
check('watch page: video kept paused', watch.paused === true || watch.paused === null, `paused=${watch.paused} t=${watch.currentTime?.toFixed?.(2)}`);
check('watch page: tab title masked', !/gta|grand theft/i.test(watch.title), watch.title);
await page.screenshot({ path: path.join(out, '4-watch-trailer.png') });
const side = await stats();
console.log('watch sidebar:', JSON.stringify(side, null, 2));

// ---------------------------------------------------------------- 5. turning the shield off unhides everything
await worker.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...(settings ?? {}), enabled: false } });
});
await page.waitForTimeout(1000);
const off = await page.evaluate(() => document.querySelectorAll('[data-vv="on"]').length);
check('shield off: nothing hidden', off === 0, `${off} still hidden`);
await worker.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, enabled: true } });
});
await page.waitForTimeout(1000);
const on = await page.evaluate(() => document.querySelectorAll('[data-vv="on"]').length);
check('shield back on: hidden again', on > 0, `${on} hidden`);

await context.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in scripts/out/`);
process.exit(failed.length ? 1 : 0);
