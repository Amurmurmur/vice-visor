import type { Adapter } from './adapters';
import type { Matcher } from './matcher';
import { hashString, pickMessage, TITLE_MASK } from './messages';

/**
 * State lives in one attribute so the stylesheet can draw everything:
 *   on        hidden behind the overlay
 *   confirm   first click landed, waiting for the second
 *   revealed  the user chose to look; left alone until its text changes
 */
const ATTR = 'data-vv';
const HIDDEN = `[${ATTR}="on"],[${ATTR}="confirm"]`;

/** Fallback blocks for text that is not inside a known card. */
const BLOCKS = [
  'article',
  'li',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'figure',
  'figcaption',
  'td',
  'th',
  'dd',
  'dt',
  'summary',
  '[role="article"]',
  '[role="listitem"]',
  '[role="option"]',
  '[role="row"]',
  '[role="heading"]',
].join(',');

const SKIP = 'script,style,noscript,template,textarea,select,title,head,svg defs';
const TEXT_ATTRS = ['aria-label', 'title', 'alt', 'post-title', 'subreddit-prefixed-name'];
const CONFIRM_MS = 4000;

export interface EngineOptions {
  adapter: Adapter;
  matcher: Matcher;
  /** Also check text that sits outside the adapter's cards. */
  fallback: boolean;
  /** Mask the tab title when it names GTA 6 (top frame only). */
  maskTitle: boolean;
  onCount(count: number): void;
}

export class CensorEngine {
  private opts: EngineOptions;
  private observer: MutationObserver;
  private resizer: ResizeObserver;
  private pending = new Set<Element>();
  /** Identity of the content the user chose to reveal, per element (see `contentKey`). */
  private revealedFor = new WeakMap<Element, string>();
  /** Owner -> elements that are hidden along with it. */
  private links = new Map<Element, Element[]>();
  private linkOwner = new WeakMap<Element, Element>();
  private confirmTimers = new WeakMap<Element, number>();
  private countTimer: number | undefined;
  private lastCount = -1;
  private originalTitle: string | null = null;
  private relinkPending = false;
  private running = false;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.resizer = new ResizeObserver((entries) => {
      for (const entry of entries) sizeTag(entry.target, entry.contentRect);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const type of ['click', 'auxclick', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      window.addEventListener(type, this.onPointer, true);
    }
    window.addEventListener('keydown', this.onKey, true);
    // `play` does not bubble, but capture on the window sees every video.
    window.addEventListener('play', this.onPlay, true);
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.scan(document.documentElement);
    this.flush();
    this.checkTitle();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const type of ['click', 'auxclick', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      window.removeEventListener(type, this.onPointer, true);
    }
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('play', this.onPlay, true);
    this.observer.disconnect();
    this.pending.clear();
    this.clearAll();
    this.restoreTitle();
    this.reportCount();
  }

  /** Swap in new settings: unhide everything and scan from scratch. */
  update(opts: Partial<EngineOptions>): void {
    const wasRunning = this.running;
    this.stop();
    this.opts = { ...this.opts, ...opts };
    this.revealedFor = new WeakMap();
    if (wasRunning) this.start();
  }

  // ---------------------------------------------------------------- scanning

  private onMutations(records: MutationRecord[]): void {
    let titleChanged = false;
    for (const record of records) {
      const target = record.target;
      if (isInTitle(target)) {
        titleChanged = true;
        continue;
      }
      if (record.type === 'childList') {
        for (const node of record.addedNodes) this.scan(node);
        // New text inside a card that already existed (YouTube recycles cards).
        this.queueAround(target);
      } else {
        this.scan(target);
        this.queueAround(target);
      }
    }
    // Runs before the browser paints, so new spoilers never flash on screen.
    this.flush();
    if (titleChanged || this.originalTitle === null) this.checkTitle();
  }

  /** Queue every card in a new subtree, and every matching loose text node. */
  private scan(node: Node): void {
    const { containers } = this.opts.adapter;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (containers) {
        if (el.matches(containers)) this.pending.add(el);
        for (const card of el.querySelectorAll(containers)) this.pending.add(card);
      }
      const { linkTargets } = this.opts.adapter;
      if (linkTargets && this.links.size && (el.matches(linkTargets) || el.querySelector(linkTargets))) {
        this.relinkPending = true;
      }
      if (this.opts.fallback && el.firstChild) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) this.scanText(text as Text);
      }
    } else if (node.nodeType === Node.TEXT_NODE && this.opts.fallback) {
      this.scanText(node as Text);
    }
  }

  private scanText(text: Text): void {
    const value = text.data;
    if (value.length < 3 || !this.opts.matcher.test(value)) return;
    const parent = text.parentElement;
    if (!parent || parent.closest(SKIP) || parent.isContentEditable) return;
    const { containers } = this.opts.adapter;
    if (containers && parent.closest(containers)) return; // its card handles it
    this.pending.add(blockFor(parent));
  }

  /** Re-check whatever card or hidden block a changed node lives in. */
  private queueAround(node: Node): void {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!el) return;
    const { containers } = this.opts.adapter;
    const card = containers ? el.closest(containers) : null;
    if (card) this.pending.add(card);
    const marked = el.closest(`[${ATTR}]`);
    if (marked && marked !== card) this.pending.add(marked);
  }

  private flush(): void {
    if (this.relinkPending) {
      this.relinkPending = false;
      for (const owner of [...this.links.keys()]) {
        const state = owner.getAttribute(ATTR);
        if (owner.isConnected && (state === 'on' || state === 'confirm')) this.relink(owner);
      }
    }
    if (!this.pending.size) return;
    const batch = [...this.pending];
    this.pending.clear();
    const seen = new Set<Element>();
    for (const el of batch) {
      if (!el.isConnected) continue;
      const target = this.outermost(el);
      if (seen.has(target)) continue;
      seen.add(target);
      this.evaluate(target);
    }
    this.scheduleCount();
  }

  private outermost(el: Element): Element {
    const { containers } = this.opts.adapter;
    if (!containers || !el.matches(containers)) return el;
    let top = el;
    for (let up = top.parentElement?.closest(containers); up; up = up.parentElement?.closest(containers)) {
      top = up;
    }
    return top;
  }

  private evaluate(el: Element): void {
    if (this.linkOwner.has(el)) return; // follows its owner
    const text = collectText(el);
    const state = el.getAttribute(ATTR);
    if (!this.opts.matcher.test(text)) {
      if (state) this.unhide(el);
      return;
    }
    if (state === 'on' || state === 'confirm') {
      // Still a spoiler; refresh linked elements in case the page swapped them.
      this.relink(el);
      return;
    }
    if (state === 'revealed' && this.revealedFor.get(el) === contentKey(el, text)) return;
    if (el.parentElement?.closest(HIDDEN)) return; // already covered by a parent
    this.hide(el, text);
  }

  // ---------------------------------------------------------------- hiding

  private hide(el: Element, text: string): void {
    // A card that now covers previously hidden pieces takes over from them.
    for (const inner of el.querySelectorAll(`[${ATTR}]`)) {
      if (!this.linkOwner.has(inner)) this.unhide(inner);
    }
    el.setAttribute(ATTR, 'on');
    const message = pickMessage(text);
    const paintTargets = this.paint(el, message);
    const extra = this.opts.adapter.linked?.(el) ?? [];
    for (const linked of extra) this.paint(linked, message);
    const all = [...paintTargets.filter((t) => t !== el), ...extra];
    for (const linked of extra) this.clearInside(linked);
    for (const linked of all) {
      linked.setAttribute(ATTR, 'on');
      linked.setAttribute('data-vv-linked', '');
      this.linkOwner.set(linked, el);
    }
    this.links.set(el, all);
    this.revealedFor.delete(el);
  }

  /** Draws the overlay on `el`, or on its children if `el` has no box of its own. */
  private paint(el: Element, message: string): Element[] {
    const style = getComputedStyle(el);
    if (style.display === 'contents') {
      el.setAttribute('data-vv-contents', '');
      return [...el.children].flatMap((child) => this.paint(child, message));
    }
    el.setAttribute('data-vv-msg', message);
    if (style.position === 'static') el.setAttribute('data-vv-rel', '');
    if (style.display === 'inline' && el.firstElementChild && !hasOwnText(el)) el.setAttribute('data-vv-block', '');
    for (const video of el.querySelectorAll('video')) video.pause();
    if (el instanceof HTMLVideoElement) el.pause();
    this.resizer.observe(el);
    return [el];
  }

  private relink(owner: Element): void {
    const current = this.links.get(owner) ?? [];
    const wanted = this.opts.adapter.linked?.(owner) ?? [];
    const message = owner.getAttribute('data-vv-msg') ?? pickMessage('');
    for (const el of wanted) {
      if (current.includes(el) && el.getAttribute(ATTR) === owner.getAttribute(ATTR)) continue;
      this.clearInside(el);
      this.paint(el, message);
      el.setAttribute(ATTR, owner.getAttribute(ATTR) ?? 'on');
      el.setAttribute('data-vv-linked', '');
      this.linkOwner.set(el, owner);
      if (!current.includes(el)) current.push(el);
    }
    this.links.set(owner, current);
  }

  private clearInside(el: Element): void {
    for (const inner of el.querySelectorAll(`[${ATTR}]`)) {
      if (!this.linkOwner.has(inner)) this.unhide(inner);
    }
  }

  private unhide(el: Element): void {
    for (const linked of this.links.get(el) ?? []) {
      this.clearMarks(linked);
      this.linkOwner.delete(linked);
    }
    this.links.delete(el);
    this.clearMarks(el);
  }

  private clearMarks(el: Element): void {
    for (const name of [ATTR, 'data-vv-msg', 'data-vv-rel', 'data-vv-size', 'data-vv-linked', 'data-vv-contents', 'data-vv-block']) {
      el.removeAttribute(name);
    }
    this.resizer.unobserve(el);
  }

  private clearAll(): void {
    for (const el of document.querySelectorAll(`[${ATTR}],[data-vv-contents]`)) this.clearMarks(el);
    this.links.clear();
    this.linkOwner = new WeakMap();
  }

  private reveal(owner: Element): void {
    window.clearTimeout(this.confirmTimers.get(owner));
    this.revealedFor.set(owner, contentKey(owner, collectText(owner)));
    for (const linked of this.links.get(owner) ?? []) {
      this.clearMarks(linked);
      this.linkOwner.delete(linked);
    }
    this.links.delete(owner);
    this.clearMarks(owner);
    owner.setAttribute(ATTR, 'revealed');
    this.scheduleCount();
  }

  private setState(owner: Element, state: 'on' | 'confirm'): void {
    owner.setAttribute(ATTR, state);
    for (const linked of this.links.get(owner) ?? []) linked.setAttribute(ATTR, state);
  }

  // ---------------------------------------------------------------- input

  private onPointer = (event: Event): void => {
    const hit = (event.target as Element | null)?.closest?.(HIDDEN);
    if (!hit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;

    const owner = this.linkOwner.get(hit) ?? hit;
    if (owner.getAttribute(ATTR) === 'confirm') {
      this.reveal(owner);
      return;
    }
    this.setState(owner, 'confirm');
    window.clearTimeout(this.confirmTimers.get(owner));
    this.confirmTimers.set(
      owner,
      window.setTimeout(() => {
        if (owner.getAttribute(ATTR) === 'confirm') this.setState(owner, 'on');
      }, CONFIRM_MS),
    );
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const focused = event.target as Element | null;
    if (focused?.closest?.(HIDDEN)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private onPlay = (event: Event): void => {
    const video = event.target;
    if (video instanceof HTMLMediaElement && video.closest(HIDDEN)) video.pause();
  };

  // ---------------------------------------------------------------- tab title

  private checkTitle(): void {
    if (!this.opts.maskTitle) return;
    const title = document.title;
    if (!title || title === TITLE_MASK) return;
    if (this.opts.matcher.test(title)) {
      this.originalTitle = title;
      document.title = TITLE_MASK;
    }
  }

  private restoreTitle(): void {
    if (this.originalTitle !== null && document.title === TITLE_MASK) document.title = this.originalTitle;
    this.originalTitle = null;
  }

  // ---------------------------------------------------------------- counting

  private scheduleCount(): void {
    window.clearTimeout(this.countTimer);
    this.countTimer = window.setTimeout(() => this.reportCount(), 300);
  }

  private reportCount(): void {
    const count = document.querySelectorAll(
      `[${ATTR}="on"]:not([data-vv-linked]),[${ATTR}="confirm"]:not([data-vv-linked])`,
    ).length;
    if (count === this.lastCount) return;
    this.lastCount = count;
    this.opts.onCount(count);
  }
}

// ------------------------------------------------------------------ helpers

function collectText(el: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('script,style,noscript,template')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    if (value.trim()) parts.push(value);
  }
  for (const node of [el, ...el.querySelectorAll('[aria-label],[title],img[alt],[post-title],[subreddit-prefixed-name]')]) {
    for (const name of TEXT_ATTRS) {
      const value = node.getAttribute(name);
      if (value) parts.push(value);
    }
  }
  return parts.join(' ');
}

const KEY_LINKS = ['a[href*="watch?v="]', 'a[href*="/shorts/"]', 'a[href*="/status/"]', 'a[href*="/posts/"]', 'a[href]'];

/**
 * What a card is "about", so a revealed card stays revealed while the page fiddles with it
 * (hover previews, live view counts) but hides again if the site recycles it for other content.
 */
function contentKey(el: Element, text: string): string {
  for (const selector of KEY_LINKS) {
    const href = el.querySelector(selector)?.getAttribute('href');
    if (href) return href.split('&')[0] ?? href;
  }
  return String(hashString(text));
}

function blockFor(parent: Element): Element {
  let block = parent.closest(BLOCKS) ?? parent;
  if (block === document.body || block === document.documentElement) return parent;
  if (block !== parent) {
    // Never throw a giant overlay over half the page for one mention.
    const rect = block.getBoundingClientRect();
    if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.5) block = parent;
  }
  return block;
}

function isInTitle(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.localName === 'title' && el.parentElement?.localName === 'head';
}

function hasOwnText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
  }
  return false;
}

function sizeTag(el: Element, rect: DOMRectReadOnly): void {
  // Inline boxes report an empty content rect; measure the border box instead.
  const { width, height } = rect.width && rect.height ? rect : el.getBoundingClientRect();
  let size = height > 900 ? 'xl' : 'lg';
  if (height < 36 || width < 90) size = 'xs';
  else if (height < 100 || width < 180) size = 'sm';
  else if (height < 230) size = 'md';
  if (el.getAttribute('data-vv-size') !== size) el.setAttribute('data-vv-size', size);
}
