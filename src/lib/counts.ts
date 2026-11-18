import { storage } from 'wxt/utils/storage';

/**
 * Hidden-spoiler counts for one tab, per frame (YouTube's live chat is its own frame).
 * Kept in session storage: in memory only, gone when the browser closes, and it survives
 * the background service worker being put to sleep.
 */
export interface TabCounts {
  /** The top frame's document; a new one means the old frames are gone. */
  documentId?: string;
  frames: Record<string, number>;
}

export const tabCountsKey = (tabId: number) => `session:tab-counts:${tabId}` as const;

export function totalOf(counts: TabCounts | null): number {
  if (!counts) return 0;
  return Object.values(counts.frames).reduce((sum, count) => sum + count, 0);
}

export const getTabCounts = (tabId: number) => storage.getItem<TabCounts>(tabCountsKey(tabId));

export const watchTabCounts = (tabId: number, callback: (counts: TabCounts | null) => void) =>
  storage.watch<TabCounts>(tabCountsKey(tabId), callback);
