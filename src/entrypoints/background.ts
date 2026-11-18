import { browser } from 'wxt/browser';

interface CountMessage {
  type: 'vv:count';
  count: number;
}

/** Shows how many spoilers are hidden on each tab, summed across its frames. */
export default defineBackground(() => {
  const frames = new Map<number, Map<number, number>>();
  const topDocument = new Map<number, string | undefined>();

  browser.runtime.onMessage.addListener((message: CountMessage, sender) => {
    if (message?.type !== 'vv:count') return;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const frameId = sender.frameId ?? 0;

    let perFrame = frames.get(tabId);
    if (!perFrame) frames.set(tabId, (perFrame = new Map()));
    // A new top-level document means the old frames are gone.
    if (frameId === 0 && topDocument.get(tabId) !== sender.documentId) {
      topDocument.set(tabId, sender.documentId);
      perFrame.clear();
    }
    perFrame.set(frameId, message.count);

    let total = 0;
    for (const count of perFrame.values()) total += count;
    const text = total === 0 ? '' : total > 999 ? '999+' : String(total);
    browser.action.setBadgeText({ tabId, text }).catch(() => {});
    browser.action.setBadgeBackgroundColor({ tabId, color: '#ff2e88' }).catch(() => {});
    browser.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    frames.delete(tabId);
    topDocument.delete(tabId);
  });
});
