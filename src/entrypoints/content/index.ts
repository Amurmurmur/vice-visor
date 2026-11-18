import './style.css';
import { browser } from 'wxt/browser';
import { adapterFor } from '@/lib/adapters';
import { CensorEngine } from '@/lib/engine';
import { createMatcher } from '@/lib/matcher';
import { settingsItem, withDefaults, type Settings } from '@/lib/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  cssInjectionMode: 'manifest',

  async main(ctx) {
    const adapter = adapterFor(location.hostname);
    const isTop = window.top === window;

    const sendCount = (count: number) => {
      browser.runtime.sendMessage({ type: 'vv:count', count }).catch(() => {
        // The service worker may be asleep or the extension reloaded; the next change resends.
      });
    };

    let engine: CensorEngine | null = null;

    const apply = (settings: Settings) => {
      const active = settings.enabled && settings.sites[adapter.site];
      if (!active) {
        engine?.stop();
        return;
      }
      const opts = {
        adapter,
        matcher: createMatcher(settings.strictness, settings.customKeywords),
        // Known sites get card-level hiding; the text fallback catches whatever sits outside cards.
        fallback: true,
        maskTitle: isTop,
        onCount: sendCount,
      };
      if (engine) engine.update(opts);
      else engine = new CensorEngine(opts);
      engine.start();
    };

    // Start as early as possible with whatever is stored, then follow changes live.
    apply(withDefaults(await settingsItem.getValue()));
    const unwatch = settingsItem.watch((value) => apply(withDefaults(value)));
    // Fires when a newer copy of this script starts in the page (the background injects one
    // into open tabs after an update). Step aside without unhiding; the new copy takes over.
    ctx.onInvalidated(() => {
      unwatch();
      engine?.detach();
    });
  },
});
