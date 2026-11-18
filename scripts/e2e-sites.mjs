// Checks the X, Facebook and generic adapters. X and Facebook need a login, so this serves
// pages that mirror their DOM structure from the real x.com / facebook.com URLs (the content
// script only sees the URL and the DOM, so it behaves exactly as it would on the live site).
// Usage: pnpm build && pnpm test:sites
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

const shell = (title, body, bg = '#000', fg = '#e7e9ea') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px/1.4 system-ui;background:${bg};color:${fg};width:620px;margin:20px auto}
article,[role=article],[data-testid=trend],li,p,h1{padding:12px;margin:0 0 8px;border:1px solid #333;border-radius:12px;list-style:none}
[contenteditable]{padding:12px;border:1px dashed #1d9bf0}</style></head><body>${body}</body></html>`;

const pages = {
  'https://x.com/home': shell(
    'Home / X',
    `<div data-testid="primaryColumn">
      <div data-testid="cellInnerDiv" id="t1"><article data-testid="tweet"><b>@leaker</b><div data-testid="tweetText">The GTA 6 ending is wild, can't believe Lucia...</div></article></div>
      <div data-testid="cellInnerDiv" id="t2"><article data-testid="tweet"><b>@friend</b><div data-testid="tweetText">Just had the best pizza of my life</div></article></div>
      <div data-testid="cellInnerDiv" id="t3"><article data-testid="tweet"><b>@spammer</b><div data-testid="tweetText">𝐆𝐓𝐀 𝟔 full map leak thread 🧵</div></article></div>
      <div data-testid="cellInnerDiv" id="t4"><article data-testid="tweet"><b>@dev</b><div data-testid="tweetText">Shipping a new build today</div></article></div>
    </div>
    <div data-testid="trend" id="trend">Trending in Gaming · #GTA6Launch</div>
    <div role="textbox" contenteditable="true" id="composer">My own draft about GTA 6</div>
    <script>
      setTimeout(() => {
        const cell = document.createElement('div');
        cell.dataset.testid = 'cellInnerDiv'; cell.id = 't5';
        cell.innerHTML = '<article data-testid="tweet"><b>@news</b><div data-testid="tweetText">#GTAVI is finally out, here is the twist</div></article>';
        document.querySelector('[data-testid=primaryColumn]').append(cell);
      }, 300);
      // X recycles cells: the pizza tweet's node gets new content.
      setTimeout(() => { document.querySelector('#t2 [data-testid=tweetText]').textContent = 'Jason Duval is my favorite character'; }, 600);
      setTimeout(() => { document.querySelector('#t1 [data-testid=tweetText]').textContent = 'Anyway, back to work'; }, 900);
    </script>`,
  ),
  'https://www.facebook.com/': shell(
    'Facebook',
    `<div role="feed">
      <div aria-posinset="1" id="p1"><div role="article"><b>Mike</b><p>Can't wait for Grand Theft Auto VI tomorrow!</p>
        <div role="article" aria-label="Comment by Sam">Same here dude</div></div></div>
      <div aria-posinset="2" id="p2"><div role="article"><b>Aunt Linda</b><p>My cat learned a new trick</p></div></div>
      <div aria-posinset="3" id="p3"><div role="article"><b>Gamer Group</b><p>Post</p>
        <div role="article" aria-label="Comment by Leaker">Port Gellhorn is where the final mission happens</div></div></div>
    </div>`,
    '#f0f2f5',
    '#050505',
  ),
  'https://www.example.com/news': shell(
    'GTA 6 review: a masterpiece - Example News',
    `<h1 id="h">GTA 6 review: a masterpiece</h1>
     <p id="p1">Elsewhere in gaming, Nintendo had a quiet week.</p>
     <p id="p2">The story takes you across Leonida, and the final act is something else.</p>
     <ul><li id="l1">Top story: Minecraft update</li><li id="l2">GTA VI breaks sales records</li></ul>
     <textarea id="ta">GTA 6 in a textarea</textarea>`,
    '#fff',
    '#111',
  ),
};

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vv-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 900, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (const [url, body] of Object.entries(pages)) {
  await context.route(url, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
}
const page = context.pages()[0] ?? (await context.newPage());
const state = (selector) => page.locator(selector).first().getAttribute('data-vv');
const hidden = async (selector) => ['on', 'confirm'].includes(await state(selector));

// ---------------------------------------------------------------- X
await page.goto('https://x.com/home');
check('X: GTA 6 tweet hidden', await hidden('#t1'));
await page.waitForTimeout(1300);
check('X: recycled tweet shows again once its spoiler is gone', !(await hidden('#t1')));
check('X: fancy-font tweet hidden', await hidden('#t3'));
check('X: tweet inserted later hidden', await hidden('#t5'));
check('X: recycled cell hidden after new text', await hidden('#t2'));
check('X: unrelated tweet untouched', !(await hidden('#t4')));
check('X: trend hidden', await hidden('#trend'));
check('X: your own draft is never hidden', !(await state('#composer')));
check('X: tab title untouched when it is clean', (await page.title()) === 'Home / X');
await page.screenshot({ path: path.join(out, '5-x.png') });

// ---------------------------------------------------------------- live count for the popup
const hiddenOnPage = () =>
  page.evaluate(() => document.querySelectorAll('[data-vv="on"]:not([data-vv-linked])').length);
const savedCount = () =>
  worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    const key = `tab-counts:${tab.id}`;
    const counts = (await chrome.storage.session.get(key))[key];
    return Object.values(counts?.frames ?? {}).reduce((a, b) => a + b, 0);
  });
const addSpoilerTweet = (text) =>
  page.evaluate((text) => {
    const cell = document.createElement('div');
    cell.dataset.testid = 'cellInnerDiv';
    cell.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText">${text}</div></article>`;
    document.querySelector('[data-testid=primaryColumn]').append(cell);
  }, text);

const saved = await savedCount();
check('saved count matches what the page hides', saved > 0 && saved === (await hiddenOnPage()), `saved=${saved}`);

// The real popup page, opened in a background tab so it follows the X tab like the toolbar popup does.
const popupOpened = context.waitForEvent('page');
await worker.evaluate((url) => chrome.tabs.create({ url, active: false }), `chrome-extension://${new URL(worker.url()).host}/popup.html`);
const popup = await popupOpened;
await popup.waitForLoadState();
await popup.waitForTimeout(600);
const shownBefore = Number(await popup.locator('#count').textContent());
await addSpoilerTweet('GTA 6 final mission leak');
await popup.waitForTimeout(900);
const shownAfter = Number(await popup.locator('#count').textContent());
check('open popup updates live as spoilers load', shownBefore === saved && shownAfter === saved + 1, `${shownBefore} -> ${shownAfter}`);
await addSpoilerTweet('Another #GTAVI spoiler');
await popup.waitForTimeout(900);
const shownLater = Number(await popup.locator('#count').textContent());
check('and keeps updating', shownLater === saved + 2, `${shownAfter} -> ${shownLater}`);
await popup.screenshot({ path: path.join(out, '8b-popup-live.png') });
await popup.close();

// ---------------------------------------------------------------- Facebook
await page.goto('https://www.facebook.com/');
await page.waitForTimeout(600);
check('Facebook: GTA 6 post hidden', await hidden('#p1'));
check('Facebook: post with spoiler comment hidden', await hidden('#p3'));
check('Facebook: unrelated post untouched', !(await hidden('#p2')));
await page.screenshot({ path: path.join(out, '6-facebook.png') });

// ---------------------------------------------------------------- any other site
await page.goto('https://www.example.com/news');
await page.waitForTimeout(600);
check('Other sites: headline hidden', await hidden('#h'));
check('Other sites: Leonida paragraph hidden', await hidden('#p2'));
check('Other sites: GTA VI list item hidden', await hidden('#l2'));
check('Other sites: unrelated paragraph untouched', !(await hidden('#p1')));
check('Other sites: unrelated list item untouched', !(await hidden('#l1')));
check('Other sites: textarea untouched', !(await state('#ta')));
check('Other sites: tab title masked', !/gta/i.test(await page.title()), await page.title());
await page.screenshot({ path: path.join(out, '7-other-site.png') });

await context.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in scripts/out/`);
process.exit(failed.length ? 1 : 0);
