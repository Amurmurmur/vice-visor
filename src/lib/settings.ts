import { storage } from 'wxt/utils/storage';

export type Strictness = 'standard' | 'paranoid';
export type SiteId = 'youtube' | 'x' | 'facebook' | 'other';

export interface Settings {
  enabled: boolean;
  strictness: Strictness;
  sites: Record<SiteId, boolean>;
  /** Extra words or phrases the user wants hidden, one per entry. */
  customKeywords: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  strictness: 'standard',
  sites: { youtube: true, x: true, facebook: true, other: true },
  customKeywords: [],
};

export const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
});

/** Fills in fields added in later versions so older saved settings keep working. */
export function withDefaults(value: Partial<Settings> | null | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    sites: { ...DEFAULT_SETTINGS.sites, ...value?.sites },
    customKeywords: value?.customKeywords ?? [],
  };
}

/** The day the shield can (maybe) retire. */
export const LAUNCH_DATE = new Date('2026-11-19T00:00:00');
