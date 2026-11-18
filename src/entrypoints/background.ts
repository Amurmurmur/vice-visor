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
});
