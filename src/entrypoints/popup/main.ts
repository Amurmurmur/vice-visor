import { browser } from 'wxt/browser';
import { getTabCounts, totalOf, watchTabCounts } from '@/lib/counts';
import { LAUNCH_DATE, settingsItem, withDefaults, type Settings, type SiteId, type Strictness } from '@/lib/settings';

const STRICTNESS_HINTS: Record<Strictness, string> = {
  standard: 'Hides anything that names GTA 6, its cast, or Leonida.',
  paranoid: 'Also hides any GTA, Vice City, or Rockstar Games mention. Old games included.',
};

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const enabledInput = $<HTMLInputElement>('#enabled');
const siteInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-site]')];
const strictnessInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="strictness"]')];
const strictnessHint = $<HTMLParagraphElement>('#strictness-hint');
const keywordsInput = $<HTMLTextAreaElement>('#keywords');
const keywordsStatus = $<HTMLParagraphElement>('#keywords-status');
const hero = $<HTMLElement>('#hero');
const countEl = $<HTMLDivElement>('#count');
const countLabel = $<HTMLParagraphElement>('#count-label');
const countdownEl = $<HTMLParagraphElement>('#countdown');

let settings: Settings = withDefaults(null);

function render(): void {
  enabledInput.checked = settings.enabled;
  document.body.classList.toggle('is-off', !settings.enabled);
  for (const input of siteInputs) {
    input.checked = settings.sites[input.dataset.site as SiteId];
    input.disabled = !settings.enabled;
  }
  for (const input of strictnessInputs) {
    input.checked = input.value === settings.strictness;
    input.disabled = !settings.enabled;
  }
  strictnessHint.textContent = STRICTNESS_HINTS[settings.strictness];
  if (document.activeElement !== keywordsInput) {
    keywordsInput.value = settings.customKeywords.join('\n');
  }
  keywordsInput.disabled = !settings.enabled;
  renderCount();
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = withDefaults({ ...settings, ...patch });
  render();
  await settingsItem.setValue(settings);
}

enabledInput.addEventListener('change', () => {
  save({ enabled: enabledInput.checked });
});

for (const input of siteInputs) {
  input.addEventListener('change', () => {
    save({ sites: { ...settings.sites, [input.dataset.site as SiteId]: input.checked } });
  });
}

for (const input of strictnessInputs) {
  input.addEventListener('change', () => {
    if (input.checked) save({ strictness: input.value as Strictness });
  });
}

let keywordTimer: number | undefined;
keywordsInput.addEventListener('input', () => {
  keywordsStatus.textContent = 'Saving…';
  window.clearTimeout(keywordTimer);
  keywordTimer = window.setTimeout(async () => {
    const customKeywords = keywordsInput.value
      .split(/[\n,]/)
      .map((word) => word.trim())
      .filter(Boolean);
    await save({ customKeywords });
    keywordsStatus.textContent = customKeywords.length
      ? `Hiding ${customKeywords.length} extra ${customKeywords.length === 1 ? 'word' : 'words'}.`
      : 'Saved automatically. Applies to open tabs right away.';
  }, 400);
});

/** The tab the popup was opened over, and how many spoilers it is hiding right now. */
let activeTab: { id: number; restricted: boolean } | null = null;
let hiddenCount = 0;

function renderCount(): void {
  hero.classList.toggle('is-quiet', hiddenCount === 0 || !settings.enabled);
  if (!settings.enabled) {
    countEl.textContent = 'Off';
    countLabel.textContent = 'Shield is down. Spoilers can reach you.';
  } else if (activeTab?.restricted) {
    countEl.textContent = '0';
    countLabel.textContent = 'Nothing to shield on this page';
  } else {
    countEl.textContent = hiddenCount > 999 ? '999+' : String(hiddenCount);
    countLabel.textContent =
      hiddenCount === 0
        ? 'Nothing spoilery on this tab'
        : hiddenCount === 1
          ? 'spoiler hidden on this tab'
          : 'spoilers hidden on this tab';
  }
}

/** Reads the active tab's count, then follows it as the page hides or reveals things. */
async function followActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  // Without host access to a page (chrome://, the Web Store) its url is hidden or non-web.
  activeTab = { id: tab.id, restricted: tab.url !== undefined && !/^(https?|file):/.test(tab.url) };
  hiddenCount = totalOf(await getTabCounts(tab.id));
  renderCount();
  watchTabCounts(tab.id, (counts) => {
    hiddenCount = totalOf(counts);
    renderCount();
  });
}

function renderCountdown(): void {
  const ms = LAUNCH_DATE.getTime() - Date.now();
  if (ms <= 0) {
    const days = Math.floor(-ms / 86_400_000);
    countdownEl.textContent =
      days < 14 ? "It's out. Go play it before the internet ruins it." : 'Beat the story yet? You can turn me off.';
    return;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  countdownEl.textContent =
    hours >= 48 ? `${Math.ceil(hours / 24)} days to launch. Be patient, dude.` : `Launch in ${hours}h ${minutes}m. Be patient, dude.`;
}

async function init(): Promise<void> {
  settings = withDefaults(await settingsItem.getValue());
  render();
  renderCountdown();
  window.setInterval(renderCountdown, 30_000);
  await followActiveTab();
  settingsItem.watch((value) => {
    settings = withDefaults(value);
    render();
  });
}

init();
