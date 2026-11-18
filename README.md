# Vice Visor

A Chrome extension that hides GTA 6 spoilers across the web: YouTube, Reddit, X, Facebook and everywhere else. Anything that mentions GTA 6 gets covered by a solid sunset panel that says **"Be patient, dude."**

Built with [WXT](https://wxt.dev) (Manifest V3, Vite, TypeScript).

## Install it in Chrome

```bash
pnpm install
pnpm build
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `.output/chrome-mv3` folder
4. Pin the sunglasses icon to the toolbar

After changing code, run `pnpm build` again and click the reload arrow on the extension's card.

## What it hides

| Where | What |
| --- | --- |
| YouTube | Home, search, channel and sidebar videos, Shorts, playlists, topic chips, comments, community posts, notifications, ads, live chat, end screens. On a GTA 6 video's page it covers the player, title, description and the whole comment section, and keeps the video paused. |
| Reddit | Feed and subreddit posts, search results, the AI answer box on search, community cards, individual comments. Anything posted in r/GTA6 (or any subreddit named after it) is hidden even if the title never says "GTA 6". On a spoiler post's page the whole comment section is covered with it. old.reddit.com posts and comments too. |
| X | Tweets, replies, quote cards, trends, people, DMs, notifications |
| Facebook | Feed posts (the whole post, if a comment spoils), comments, reels |
| Everywhere else | Any headline, paragraph, list item or table row that mentions GTA 6 |

The tab title is masked too, so a spoiler can't sit in your tab bar or history.

To peek at something, click it once ("Last chance, dude") and again within 4 seconds.

### Strictness

- **Standard** (default): anything naming GTA 6 in any spelling (`GTA 6`, `GTA VI`, `#GTA6Trailer`, `gta6`, `Grand Theft Auto VI`, fancy-font or fullwidth text, Russian, Arabic, Japanese and Chinese spellings), plus names that only exist in GTA 6: Leonida, Port Gellhorn, Jason Duval, Lucia Caminos and the rest of the cast.
- **Paranoid**: also any GTA, Grand Theft Auto, Vice City or Rockstar Games mention, older games included.

You can add your own words in the popup (one per line). The toolbar badge counts what's hidden on the current tab.

### Limits

- It reads text, not pixels. On Reddit that includes a subreddit's banner art.
- Text inside shadow DOM (for example Reddit's subreddit sidebar blurb) isn't scanned. A thumbnail with "GTA 6" in the image and a title that never mentions it will get through.
- X and Facebook are tested against pages that mirror their markup, not the logged-in sites. old.reddit.com now requires a login, so its selectors aren't tested live either. If either redesigns, the card selectors in `src/lib/adapters.ts` may need updating. Anything they miss still gets caught by the generic text fallback, just covering a smaller block.

## Development

```bash
pnpm dev          # WXT dev mode with hot reload
pnpm test         # matcher unit tests (Vitest)
pnpm build
pnpm test:e2e     # live YouTube, with the built extension loaded in Chromium
pnpm test:reddit  # live Reddit
pnpm test:sites   # X, Facebook and generic-site checks
pnpm zip          # package for the Chrome Web Store
```

Set `HEADED=1` on the e2e scripts to watch them run. Screenshots land in `scripts/out/`.

### Layout

```
src/
  lib/matcher.ts       what counts as a spoiler
  lib/adapters.ts      per-site card selectors (YouTube, Reddit, X, Facebook, generic)
  lib/engine.ts        MutationObserver engine: find, hide, reveal, re-check recycled cards
  lib/settings.ts      synced settings and the launch date
  entrypoints/content  content script + overlay CSS (runs at document_start, all frames)
  entrypoints/popup    toolbar popup
  entrypoints/background.ts  per-tab badge count
```

The engine never restructures the page. It sets `data-vv` attributes, and the stylesheet draws the panel with a `::before` pseudo-element over a `visibility: hidden` element. That way YouTube's and React's renderers don't fight it, and recycled cards (YouTube and X reuse DOM nodes as you scroll and navigate) are re-checked whenever their text changes.
