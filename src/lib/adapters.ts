import type { SiteId } from './settings';

export interface Adapter {
  site: SiteId;
  /**
   * Card-level elements hidden as one unit: a video tile, a tweet, a post.
   * When cards nest, the outermost one wins.
   */
  containers?: string;
  /** Elements that are hidden and revealed together with a matching container. */
  linked?(container: Element): Element[];
}

const YOUTUBE_CONTAINERS = [
  // Feeds, search, channel pages
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'yt-lockup-view-model',
  'ytd-playlist-renderer',
  'ytd-radio-renderer',
  'ytd-movie-renderer',
  'ytd-channel-renderer',
  'ytd-universal-watch-card-renderer',
  'ytd-watch-card-compact-video-renderer',
  'ytd-search-refinement-card-renderer',
  'yt-chip-cloud-chip-renderer',
  // Watch page sidebar and playlists
  'ytd-compact-video-renderer',
  'ytd-compact-radio-renderer',
  'ytd-compact-playlist-renderer',
  'ytd-compact-movie-renderer',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
  // Shorts
  'ytd-reel-item-renderer',
  'ytm-shorts-lockup-view-model',
  'ytm-shorts-lockup-view-model-v2',
  'ytd-reel-video-renderer',
  // Community posts, comments, notifications
  'ytd-backstage-post-thread-renderer',
  'ytd-post-renderer',
  'ytd-comment-view-model',
  'ytd-comment-renderer',
  'ytd-notification-renderer',
  'ytd-guide-entry-renderer',
  // Ads (preorder promos are spoilers too)
  'ytd-ad-slot-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-in-feed-ad-layout-renderer',
  // Live chat (runs inside the chat iframe)
  'yt-live-chat-text-message-renderer',
  'yt-live-chat-paid-message-renderer',
  'yt-live-chat-membership-item-renderer',
  'yt-live-chat-banner-renderer',
  // End screens and "up next" inside the player
  '.ytp-videowall-still',
  '.ytp-modern-videowall-still',
  '.ytp-ce-element',
  '.ytp-autonav-endscreen-upnext-container',
  // Watch page title + description (also hides the player, see `linked`)
  'ytd-watch-metadata',
].join(',');

export const youtube: Adapter = {
  site: 'youtube',
  containers: YOUTUBE_CONTAINERS,
  linked(container) {
    if (container.localName !== 'ytd-watch-metadata') return [];
    const player = document.querySelector('ytd-watch-flexy #movie_player, ytd-player #movie_player');
    return player ? [player] : [];
  },
};

export const x: Adapter = {
  site: 'x',
  containers: [
    '[data-testid="cellInnerDiv"]',
    'article[data-testid="tweet"]',
    'article[data-testid="notification"]',
    '[data-testid="trend"]',
    '[data-testid="UserCell"]',
    '[data-testid="TypeaheadUser"]',
    '[data-testid="conversation"]',
    '[data-testid="messageEntry"]',
    '[data-testid="card.wrapper"]',
  ].join(','),
};

export const facebook: Adapter = {
  site: 'facebook',
  containers: [
    '[data-pagelet^="FeedUnit"]',
    'div[aria-posinset]',
    'div[role="article"]',
    '[data-pagelet*="Reels"] [role="listitem"]',
  ].join(','),
};

/** Any other site: no known cards, only the text-based fallback. */
export const generic: Adapter = { site: 'other' };

export function adapterFor(hostname: string): Adapter {
  const host = hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
    return youtube;
  }
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) {
    return x;
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) return facebook;
  return generic;
}
