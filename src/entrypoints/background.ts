import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { tabCountsKey, totalOf, type TabCounts } from '@/lib/counts';

interface CountMessage {
  type: 'vv:count';
  count: number;
}

/**
 * Keeps each tab's hidden-spoiler count: shown on the toolbar badge, and saved to session
 * storage so the popup can follow it live.
 */
export default defineBackground(() => {
  // Frames report independently; run updates one at a time so none overwrite each other.
  let queue = Promise.resolve();

  async function record(tabId: number, frameId: number, documentId: string | undefined, count: number) {
    const key = tabCountsKey(tabId);
    const counts: TabCounts = (await storage.getItem<TabCounts>(key)) ?? { frames: {} };
    if (frameId === 0 && counts.documentId !== documentId) {
      counts.documentId = documentId;
      counts.frames = {};
    }
    counts.frames[frameId] = count;
    await storage.setItem(key, counts);

    const total = totalOf(counts);
    const text = total === 0 ? '' : total > 999 ? '999+' : String(total);
    await Promise.all([
      browser.action.setBadgeText({ tabId, text }),
      browser.action.setBadgeBackgroundColor({ tabId, color: '#ff2e88' }),
      browser.action.setBadgeTextColor({ tabId, color: '#ffffff' }),
    ]).catch(() => {
      // The tab closed in the meantime.
    });
  }

  browser.runtime.onMessage.addListener((message: CountMessage, sender) => {
    if (message?.type !== 'vv:count') return;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    queue = queue
      .then(() => record(tabId, sender.frameId ?? 0, sender.documentId, message.count))
      .catch((error) => console.error('[Vice Visor] count update failed', error));
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    queue = queue.then(() => storage.removeItem(tabCountsKey(tabId)));
  });

  // Chrome only injects content scripts into pages loaded after install. On install or update,
  // put the current version into tabs that are already open, so they're protected (and count,
  // and obey the on/off switch) without a refresh.
  browser.runtime.onInstalled.addListener(async () => {
    const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || tab.discarded) return;
        const target = { tabId: tab.id, allFrames: true };
        try {
          await browser.scripting.insertCSS({ target, files: ['/content-scripts/content.css'] });
          await browser.scripting.executeScript({ target, files: ['/content-scripts/content.js'] });
        } catch {
          // Pages extensions aren't allowed to touch, such as the Chrome Web Store.
        }
      }),
    );
  });
});
