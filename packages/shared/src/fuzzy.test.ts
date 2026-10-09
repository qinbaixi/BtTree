import { describe, expect, it } from 'vitest';
import { fuzzyFilter, highlightMatches, scoreMatch } from './fuzzy';

describe('scoreMatch', () => {
  it('returns 1 for an exact match and 0 for an empty query', () => {
    expect(scoreMatch('Hello World', 'Hello World')).toBe(1);
    expect(scoreMatch('Hello World', '')).toBe(0);
  });

  it('returns 0 when a query character is missing', () => {
    expect(scoreMatch('hello world', 'hellx')).toBe(0);
    expect(scoreMatch('hello world', 'hello_world')).toBe(0);
  });

  it('requires matches to be in sequence', () => {
    expect(scoreMatch('Hello World', 'WH')).toBe(0);
  });

  it('matches regardless of case', () => {
    expect(scoreMatch('Hillsdale Michigan', 'himi')).toBeGreaterThan(0);
  });

  it('matches the reference values of the string_score library', () => {
    expect(scoreMatch('Hello World', 'he')).toBeCloseTo(0.5931818181818181, 12);
    expect(scoreMatch('Hello World', 'Hello')).toBeCloseTo(0.7318181818181818, 12);
    expect(scoreMatch('Hello World', 'hello')).toBeCloseTo(0.7172727272727272, 12);
    expect(scoreMatch('Hello World', 'Hel')).toBeCloseTo(0.6590909090909091, 12);
    expect(scoreMatch('Hello World', 'HW')).toBeCloseTo(0.6818181818181818, 12);
    expect(scoreMatch('Hillsdale Michigan', 'HiMi')).toBeCloseTo(0.6694444444444444, 12);
    expect(scoreMatch('Hillsdale', 'hi')).toBeCloseTo(0.6083333333333333, 12);
    expect(scoreMatch('Chippewa', 'hi')).toBeCloseTo(0.3125, 12);
    expect(scoreMatch('droand', 'dr')).toBeCloseTo(0.6833333333333333, 12);
    expect(scoreMatch('car house', 'house')).toBeCloseTo(0.6533333333333332, 12);
    expect(scoreMatch('Research Resources North', 'res')).toBeCloseTo(0.5812499999999999, 12);
    expect(scoreMatch('Mary Large', 'mar')).toBeCloseTo(0.6483333333333333, 12);
    expect(scoreMatch('Large Mary', 'mar')).toBeCloseTo(0.5416666666666667, 12);
    expect(scoreMatch('Silly Mary Large', 'mar')).toBeCloseTo(0.4947916666666667, 12);
  });

  it('gives 0 for house against car ho', () => {
    expect(scoreMatch('car ho', 'house')).toBe(0);
  });

  it('gives the same-case bonus', () => {
    expect(scoreMatch('Hello World', 'hello')).toBeLessThan(scoreMatch('Hello World', 'Hello'));
  });

  it('scores closer matches higher', () => {
    expect(scoreMatch('Hello World', 'H')).toBeLessThan(scoreMatch('Hello World', 'He'));
  });

  it('has the expected relative weighting', () => {
    const t = 'hello world';
    expect(scoreMatch(t, 'e')).toBeLessThan(scoreMatch(t, 'h'));
    expect(scoreMatch(t, 'h')).toBeLessThan(scoreMatch(t, 'he'));
    expect(scoreMatch(t, 'hel')).toBeLessThan(scoreMatch(t, 'hell'));
    expect(scoreMatch(t, 'hell')).toBeLessThan(scoreMatch(t, 'hello'));
    expect(scoreMatch(t, 'hello')).toBeLessThan(scoreMatch(t, 'helloworld'));
    expect(scoreMatch(t, 'helloworl')).toBeLessThan(scoreMatch(t, 'hello worl'));
    expect(scoreMatch(t, 'hello worl')).toBeLessThan(scoreMatch(t, 'hello world'));
  });

  it('rewards consecutive matches', () => {
    expect(scoreMatch('Hello World', 'Hel')).toBeGreaterThan(scoreMatch('Hello World', 'Hld'));
  });

  it('rewards acronym (word start) matches', () => {
    expect(scoreMatch('Hello World', 'HW')).toBeGreaterThan(scoreMatch('Hello World', 'Ho'));
    expect(scoreMatch('Hillsdale Michigan', 'HiMi')).toBeGreaterThan(
      scoreMatch('Hillsdale Michigan', 'Hil'),
    );
    expect(scoreMatch('Hillsdale Michigan', 'HiMi')).toBeGreaterThan(
      scoreMatch('Hillsdale Michigan', 'hills'),
    );
    expect(scoreMatch('Hillsdale Michigan', 'HiMi')).toBeLessThan(
      scoreMatch('Hillsdale Michigan', 'hillsd'),
    );
  });

  it('rewards matches at the start of the string', () => {
    expect(scoreMatch('Hillsdale', 'hi')).toBeGreaterThan(scoreMatch('Chippewa', 'hi'));
    expect(scoreMatch('hello world', 'h')).toBeGreaterThan(scoreMatch('hello world', 'w'));
    expect(scoreMatch('Mary Large', 'mar')).toBeGreaterThan(scoreMatch('Large Mary', 'mar'));
  });

  it('gives the start-of-string bonus only to the leading word position', () => {
    expect(scoreMatch('Silly Mary Large', 'mar')).toBeCloseTo(
      scoreMatch('Silly Large Mary', 'mar'),
      12,
    );
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: 1, name: 'house' },
    { id: 2, name: 'car house' },
    { id: 3, name: 'car ho' },
  ];
  const text = (i: { name: string }) => i.name;

  it('returns only items with a positive score', () => {
    const res = fuzzyFilter(items, 'house', text);
    expect(res.map((i) => i.id)).toEqual([1, 2]);
  });

  it('sorts by score descending so the perfect match is first', () => {
    const res = fuzzyFilter(items, 'house', text);
    expect(res[0].name).toBe('house');
  });

  it('returns the original objects', () => {
    const res = fuzzyFilter(items, 'house', text);
    expect(res[0]).toBe(items[0]);
    expect(res[1]).toBe(items[1]);
  });

  it('returns all items unchanged for an empty query', () => {
    expect(fuzzyFilter(items, '', text)).toEqual(items);
  });

  it('returns an empty array when nothing matches', () => {
    expect(fuzzyFilter(items, 'zzz', text)).toEqual([]);
  });

  it('keeps the original order of items with equal scores (stable)', () => {
    const same = [
      { id: 'a', name: 'abc' },
      { id: 'b', name: 'abc' },
      { id: 'c', name: 'abc' },
    ];
    expect(fuzzyFilter(same, 'abc', text).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const copy = [...items];
    fuzzyFilter(items, 'house', text);
    expect(items).toEqual(copy);
  });
});

describe('highlightMatches', () => {
  it('splits text into matching and non-matching parts (ported spec)', () => {
    const res = highlightMatches('droand roe da medameda', 'andromeda');
    expect(res).toEqual([
      { text: 'dro', match: false },
      { text: 'and', match: true },
      { text: ' ', match: false },
      { text: 'ro', match: true },
      { text: 'e da ', match: false },
      { text: 'meda', match: true },
      { text: 'meda', match: false },
    ]);
  });

  it('returns the whole text as one non-matching part when the query is not fully present', () => {
    const input = 'droand roe da medameda';
    expect(highlightMatches(input, 'andromeda car')).toEqual([{ text: input, match: false }]);
  });

  it('returns one matching part for an exact match', () => {
    expect(highlightMatches('andromeda', 'andromeda')).toEqual([
      { text: 'andromeda', match: true },
    ]);
  });

  it('is case-insensitive', () => {
    expect(highlightMatches('ABC', 'b')).toEqual([
      { text: 'A', match: false },
      { text: 'B', match: true },
      { text: 'C', match: false },
    ]);
  });

  it('returns a single non-matching part for an empty query', () => {
    expect(highlightMatches('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });

  it('returns no parts for empty text and empty query', () => {
    expect(highlightMatches('', '')).toEqual([]);
  });

  it('matches each query character only once, in order', () => {
    expect(highlightMatches('aa', 'aa')).toEqual([{ text: 'aa', match: true }]);
    expect(highlightMatches('a', 'aa')).toEqual([{ text: 'a', match: false }]);
  });
});
