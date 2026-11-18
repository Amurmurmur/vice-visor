import { describe, expect, it } from 'vitest';
import { createMatcher } from '../src/lib/matcher';

const standard = createMatcher('standard');
const paranoid = createMatcher('paranoid');

describe('standard mode', () => {
  it.each([
    'GTA 6 Trailer 3 breakdown',
    'gta6 launch stream LIVE',
    'GTA VI ending explained',
    'Grand Theft Auto VI: every secret',
    'Grand Theft Auto 6 review',
    '#GTA6',
    '#GTA6Trailer is insane',
    'GTA-6 leaks',
    'G.T.A. 6 day one',
    'GTAVI is finally here',
    'gta six map size',
    'Is GTA VI worth $80?',
    'GTA VI’s map',
    'ГТА 6 обзор',
    'بث مباشر بداية تختيم جاتا 6',
    'GTA ٦ مباشر',
    'グラセフ6 発売日',
    '侠盗猎车手6 预告',
    'GTA Ⅵ roman numeral glyph',
    'Exploring all of Leonida',
    'Port Gellhorn at night',
    'Jason Duval and Lucia Caminos',
    'Boobie Ike interview',
    "Dre'Quan Priest music",
    'Ｇ Ｔ Ａ ６ fullwidth',
    'G​TA 6 with a zero-width space',
    '𝐆𝐓𝐀 𝟔 in a fancy font',
  ])('blocks %j', (text) => {
    expect(standard.test(text)).toBe(true);
  });

  it.each([
    'GTA Vice City Definitive Edition',
    'GTA 5 heist guide',
    'GTA V online money glitch',
    'GTA 60fps mod',
    'GTA 64 bit',
    'Red Dead Redemption 2 photo mode',
    'Minecraft 1.21 update',
    'Top 6 games of the year',
    'The big ta 6 meeting',
    'Rockstar Games',
    'Jason and Lucia',
    '',
  ])('lets %j through', (text) => {
    expect(standard.test(text)).toBe(false);
  });
});

describe('paranoid mode', () => {
  it.each([
    'GTA 5 heist guide',
    'GTA Vice City Definitive Edition',
    'Rockstar Games newswire',
    'Jason and Lucia are so cute',
    'Grand Theft Auto: the trilogy',
    'GTA 6 trailer',
  ])('also blocks %j', (text) => {
    expect(paranoid.test(text)).toBe(true);
  });

  it.each(['Rockstar energy drink review', 'Minecraft speedrun', 'Agta language', 'vice president'])(
    'still lets %j through',
    (text) => {
      expect(paranoid.test(text)).toBe(false);
    },
  );
});

describe('custom keywords', () => {
  const custom = createMatcher('standard', ['Lucia', 'heist finale', '  ', 'c++ (beta)']);

  it('blocks custom words case-insensitively', () => {
    expect(custom.test('LUCIA gets arrested')).toBe(true);
    expect(custom.test('the HEIST   finale')).toBe(true);
    expect(custom.test('learning c++ (beta) today')).toBe(true);
  });

  it('respects word boundaries and ignores blank entries', () => {
    expect(custom.test('Lucian is a different name')).toBe(false);
    expect(custom.test('nothing to see here')).toBe(false);
  });

  it('reports what matched', () => {
    expect(standard.find('Watch the GTA VI trailer')).toBe('GTA VI');
  });
});
