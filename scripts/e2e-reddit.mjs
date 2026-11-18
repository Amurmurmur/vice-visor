// End-to-end check against live Reddit with the built extension loaded in Chromium.
// Usage: pnpm build && pnpm test:reddit   (HEADED=1 to watch it)
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
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const SPOILER = /gta\s*(6|vi\b)|grand theft auto (6|vi\b)|leonida|lucia caminos|jason duval/i;

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vv-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1400, height: 1000 },
  locale: 'en-US',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker'));
const page = context.pages()[0] ?? (await context.newPage());

/** Reddit sometimes serves a JS challenge first; it clears itself and sets a cookie. */
async function open(url, readySelector) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(readySelector, { state: 'attached', timeout: 15000 });
      await page.waitForTimeout(2500);
      return true;
    } catch {
      await page.waitForTimeout(3000);
    }
  }
  return false;
}

/** Cards of one kind, split into hidden and visible, with their text for spot checks. */
async function split(selector) {
  return page.evaluate((selector) => {
    const hiddenSel = '[data-vv="on"],[data-vv="confirm"]';
    const cards = [...document.querySelectorAll(selector)].filter((el) => el.getBoundingClientRect().height > 0);
    const text = (el) =>
      (el.getAttribute('post-title') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90);
    const hidden = cards.filter((el) => el.matches(hiddenSel) || el.closest(hiddenSel));
    const visible = cards.filter((el) => !hidden.includes(el));
    return { total: cards.length, hidden: hidden.map(text), visible: visible.map(text) };
  }, selector);
}

async function clickPanel(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = await locator.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Warm up so the challenge cookie is set before the real checks.
await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// ---------------------------------------------------------------- 1. search
const SEARCH_CARD = '[data-testid="search-sdui-post"]';
const SEARCH_TITLE = 'a[data-testid="post-title"]';
check('search page loaded', await open('https://www.reddit.com/search/?q=gta+6', SEARCH_TITLE), page.url());
const gta = await split(SEARCH_TITLE);
console.log('gta 6 search:', JSON.stringify({ total: gta.total, hidden: gta.hidden.length, visible: gta.visible }, null, 1));
check('GTA 6 search: results hidden', gta.total > 3 && gta.hidden.length / gta.total >= 0.7, `${gta.hidden.length}/${gta.total}`);
const leaks = gta.visible.filter((t) => SPOILER.test(t));
check('GTA 6 search: no visible result names GTA 6', leaks.length === 0, leaks.join(' | '));
const answer = await page.evaluate(() => {
  const box = document.querySelector('div:has(> [data-testid="sources-header"])');
  return box ? box.getAttribute('data-vv') ?? 'visible' : 'none on page';
});
check('AI answer box hidden (or absent)', answer === 'on' || answer === 'none on page', answer);
await page.screenshot({ path: path.join(out, 'r1-search-gta6.png') });

// click twice to peek
await page
  .locator(`${SEARCH_CARD}[data-vv="on"]`)
  .first()
  .evaluate((el) => el.setAttribute('data-e2e-target', ''));
const target = page.locator('[data-e2e-target]');
const before = page.url();
await clickPanel(target);
await page.waitForTimeout(400);
const first = await target.getAttribute('data-vv');
await clickPanel(target);
await page.waitForTimeout(400);
const second = await target.getAttribute('data-vv');
check('click once asks, twice reveals, no navigation', first === 'confirm' && second === 'revealed' && page.url() === before, `${first} -> ${second}`);

// ---------------------------------------------------------------- 2. unrelated search
check('unrelated search loaded', await open('https://www.reddit.com/search/?q=minecraft+house', SEARCH_TITLE));
const mc = await split(SEARCH_TITLE);
const falsePositives = mc.hidden.filter((t) => !SPOILER.test(t));
check('unrelated search: no false positives', mc.total > 3 && falsePositives.length === 0, `${mc.hidden.length}/${mc.total} hidden; unexpected: ${falsePositives.join(' | ')}`);

// ---------------------------------------------------------------- 3. the GTA 6 subreddit
check('r/GTA6 loaded', await open('https://www.reddit.com/r/GTA6/', 'shreddit-post'));
await page.mouse.wheel(0, 2500);
await page.waitForTimeout(2500);
await page.mouse.wheel(0, -2500);
await page.waitForTimeout(800);
const sub = await split('shreddit-post');
console.log('r/GTA6:', JSON.stringify({ total: sub.total, hidden: sub.hidden.length, visible: sub.visible }, null, 1));
check('r/GTA6: every post hidden, spoiler title or not', sub.total > 2 && sub.visible.length === 0, `${sub.hidden.length}/${sub.total} hidden; visible: ${sub.visible.join(' | ')}`);
const panel = await page.evaluate(() => {
  const post = document.querySelector('shreddit-post[data-vv="on"]');
  if (!post) return null;
  const before = getComputedStyle(post, '::before');
  return { content: before.content, position: before.position, hostVisibility: getComputedStyle(post).visibility };
});
check('overlay panel renders on Reddit posts', panel?.content?.length > 2 && panel.position === 'absolute', JSON.stringify(panel));
await page.screenshot({ path: path.join(out, 'r2-subreddit.png') });

// ---------------------------------------------------------------- 4. a post page with comments
const postUrl = await page.evaluate(() => document.querySelector('shreddit-post[data-vv="on"]')?.getAttribute('permalink'));
check('found a hidden post to open', !!postUrl, postUrl ?? '');
if (postUrl) {
  await open(`https://www.reddit.com${postUrl}`, 'shreddit-post');
  await page.waitForSelector('shreddit-comment', { state: 'attached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const post = await page.evaluate(() => document.querySelector('shreddit-post')?.getAttribute('data-vv'));
  check('post page: the post itself is hidden', post === 'on');
  check('post page: tab title masked', !SPOILER.test(await page.title()), await page.title());
  const tree = await page.evaluate(() => {
    const el = document.querySelector('shreddit-comment-tree');
    return el ? `${el.getAttribute('data-vv')} (${el.querySelectorAll('shreddit-comment').length} comments)` : 'no comment tree';
  });
  check('post page: whole comment section hidden with the post', tree.startsWith('on'), tree);
  await page.screenshot({ path: path.join(out, 'r3-post.png') });
}

// ---------------------------------------------------------------- 5. comments on a non-GTA thread
check('r/gaming loaded', await open('https://www.reddit.com/r/gaming/', 'shreddit-post'));
const gamingPost = await page.evaluate(() =>
  [...document.querySelectorAll('shreddit-post:not([data-vv])')].find((p) => +p.getAttribute('comment-count') > 30)?.getAttribute('permalink'),
);
if (gamingPost) {
  await open(`https://www.reddit.com${gamingPost}`, 'shreddit-comment');
  await page.waitForTimeout(1500);
  const comments = await split('shreddit-comment [slot="comment"]');
  const leaks = comments.visible.filter((t) => SPOILER.test(t));
  const falsePos = comments.hidden.filter((t) => !SPOILER.test(t));
  check('other threads: comments stay visible unless they spoil', comments.total > 3 && leaks.length === 0 && falsePos.length === 0, `${comments.hidden.length}/${comments.total} hidden; leaks: ${leaks.join(' | ')}; unexpected: ${falsePos.slice(0, 2).join(' | ')}`);
}

await context.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in scripts/out/`);
process.exit(failed.length ? 1 : 0);
