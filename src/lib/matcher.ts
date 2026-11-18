import type { Strictness } from './settings';

/**
 * Terms that only ever mean GTA 6. Blocked in every mode.
 *
 * Number forms use `6(?!\d)` instead of `\b` so hashtags like "#GTA6Trailer"
 * match while "GTA 60fps" does not. Roman numerals keep `\b` so "GTA Vice City"
 * never trips the "GTA VI" rule.
 */
const SIX = String.raw`(?:[6٦۶](?![\d٠-٩۰-۹])|vi\b|six\b)`;

const STANDARD = [
  // GTA 6, GTA VI, GTA-6, gta6, GTAVI, G.T.A. 6, GTA Six, #GTA6
  String.raw`(?<![a-z])g\.?\s?t\.?\s?a\.?\s*[-_:.]?\s*${SIX}`,
  // Grand Theft Auto 6 / VI / Six
  String.raw`grand\s+theft\s+auto\s*[-_:.]?\s*${SIX}`,
  // Russian, Arabic, Japanese and Chinese spellings
  String.raw`гта\s*${SIX}`,
  String.raw`(?:جاتا|جتا|جي\s?تي\s?اي)\s*${SIX}`,
  String.raw`(?:グラセフ|グランド・?セフト・?オート)\s*${SIX}`,
  String.raw`(?:侠盗猎车手|俠盜獵車手)\s*${SIX}`,
  // The state and regions of Leonida
  String.raw`\bleonida\b`,
  String.raw`\bport\s+gellhorn\b`,
  String.raw`\bgrassrivers\b`,
  String.raw`\bmount\s+kalaga\b`,
  // The cast revealed so far
  String.raw`\bjason\s+duval\b`,
  String.raw`\blucia\s+caminos\b`,
  String.raw`\bcal\s+hampton\b`,
  String.raw`\bboobie\s+ike\b`,
  String.raw`\bdre['’]?\s?quan\b`,
  String.raw`\breal\s+dimez\b`,
  String.raw`\braul\s+bautista\b`,
  String.raw`\bbrian\s+heder\b`,
];

/** Broader terms that are almost always about GTA 6 this week, but not only. */
const PARANOID = [
  String.raw`(?<![a-z])gta(?![a-z])`,
  String.raw`grand\s+theft\s+auto`,
  String.raw`\bvice\s*city\b`,
  String.raw`\brockstar\s*games?\b`,
  String.raw`\b(?:jason\s*(?:&|and|\+|x)\s*lucia|lucia\s*(?:&|and|\+|x)\s*jason)\b`,
];

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/**
 * Folds the tricks people use to dodge filters: fullwidth or "fancy font"
 * letters (NFKC), zero-width characters and soft hyphens.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(ZERO_WIDTH, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turns a user keyword into a pattern; whitespace inside it matches any run of whitespace. */
function keywordToPattern(keyword: string): string | null {
  const trimmed = normalizeText(keyword).trim();
  if (!trimmed) return null;
  const body = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
  // Only add word boundaries where the keyword itself starts or ends with a word character.
  const start = /^\w/.test(trimmed) ? '\\b' : '';
  const end = /\w$/.test(trimmed) ? '\\b' : '';
  return `${start}${body}${end}`;
}

export interface Matcher {
  test(text: string): boolean;
  /** The first matching snippet, for debugging and tests. */
  find(text: string): string | null;
}

export function createMatcher(strictness: Strictness, customKeywords: string[] = []): Matcher {
  const sources = [...STANDARD];
  if (strictness === 'paranoid') sources.push(...PARANOID);
  for (const keyword of customKeywords) {
    const pattern = keywordToPattern(keyword);
    if (pattern) sources.push(pattern);
  }
  const regex = new RegExp(sources.map((s) => `(?:${s})`).join('|'), 'iu');

  return {
    test(text) {
      if (!text) return false;
      return regex.test(normalizeText(text));
    },
    find(text) {
      if (!text) return null;
      return normalizeText(text).match(regex)?.[0] ?? null;
    },
  };
}
