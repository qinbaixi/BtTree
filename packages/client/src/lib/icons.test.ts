import { describe, expect, it } from 'vitest';
import { FA_SOLID_ICONS } from './faIcons.generated';
import { countIcons, filterIcons } from './icons';

describe('generated solid icon list', () => {
  it('contains solid icons and no brand-only icons', () => {
    expect(FA_SOLID_ICONS).toContain('question');
    expect(FA_SOLID_ICONS).toContain('arrow-right');
    expect(FA_SOLID_ICONS).not.toContain('github');
    expect(FA_SOLID_ICONS.length).toBeGreaterThan(1000);
  });

  it('is sorted and free of duplicates', () => {
    const sorted = [...FA_SOLID_ICONS].sort();
    expect([...FA_SOLID_ICONS]).toEqual(sorted);
    expect(new Set(FA_SOLID_ICONS).size).toBe(FA_SOLID_ICONS.length);
  });
});

describe('filterIcons', () => {
  const names = ['arrow-up', 'arrow-right', 'arrow-right-long', 'bars', 'question'];

  it('returns everything (up to the limit) for an empty query', () => {
    expect(filterIcons(names, '')).toEqual(names);
    expect(filterIcons(names, '  ', 2)).toEqual(['arrow-up', 'arrow-right']);
  });

  it('matches substrings and ranks prefix matches first, then shorter names', () => {
    expect(filterIcons(names, 'arrow')).toEqual(['arrow-up', 'arrow-right', 'arrow-right-long']);
    expect(filterIcons(names, 'right')).toEqual(['arrow-right', 'arrow-right-long']);
  });

  it('ignores a leading fa- and treats spaces as dashes', () => {
    expect(filterIcons(names, 'fa-question')).toEqual(['question']);
    expect(filterIcons(names, 'arrow right')).toEqual(['arrow-right', 'arrow-right-long']);
  });

  it('counts matches without the limit', () => {
    expect(countIcons(names, 'arrow')).toBe(3);
    expect(countIcons(FA_SOLID_ICONS, '')).toBe(FA_SOLID_ICONS.length);
  });
});
