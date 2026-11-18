import { browser } from 'wxt/browser';
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
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = withDefaults({ ...settings, ...patch });
  render();
  await settingsItem.setValue(settings);
}

enabledInput.addEventListener('change', () => {
  save({ enabled: enabledInput.checked });
  refreshCount();
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

async function refreshCount(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const restricted = !tab?.url || !/^(https?|file):/.test(tab.url);
  if (tab?.id === undefined) return;

  // Give the page a beat to unhide or rehide after a toggle.
  await new Promise((resolve) => setTimeout(resolve, 350));
  const badge = await browser.action.getBadgeText({ tabId: tab.id }).catch(() => '');
  const count = Number.parseInt(badge, 10) || 0;

  hero.classList.toggle('is-quiet', count === 0);
  if (!settings.enabled) {
    countEl.textContent = 'Off';
    countLabel.textContent = 'Shield is down. Spoilers can reach you.';
  } else if (restricted && tab.url !== undefined) {
    countEl.textContent = '0';
    countLabel.textContent = 'Nothing to shield on this page';
  } else {
    countEl.textContent = badge.endsWith('+') ? badge : String(count);
    countLabel.textContent =
      count === 0 ? 'Nothing spoilery on this tab' : count === 1 ? 'spoiler hidden on this tab' : 'spoilers hidden on this tab';
  }
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
  refreshCount();
  settingsItem.watch((value) => {
    settings = withDefaults(value);
    render();
  });
}

init();
