/** Overlay lines. "Be patient, dude." is the house line, so it shows up most. */
const MESSAGES = [
  'Be patient, dude.',
  'Be patient, dude.',
  'Be patient, dude.',
  'Not yet, homie.',
  'You waited 13 years.\nHang in there.',
  'Eyes on the road,\nnot the leaks.',
  'Mission failed:\nspoiler blocked.',
  'Wanted level:\nzero spoilers.',
  'Nice try, internet.',
];

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Same text always gets the same line, so recycled cards don't flicker between messages. */
export function pickMessage(seed: string): string {
  return MESSAGES[hashString(seed) % MESSAGES.length] ?? MESSAGES[0]!;
}

export const TITLE_MASK = 'Be patient, dude. (spoiler hidden by Vice Visor)';
