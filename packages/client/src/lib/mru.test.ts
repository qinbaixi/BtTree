import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMruList,
  getPathLastSegment,
  MRU_MAX_ITEM_COUNT,
  MRU_STORAGE_KEY,
  registerMru,
  removeMru,
} from './mru';

describe('mru', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty list when nothing is stored or the value is malformed', () => {
    expect(getMruList()).toEqual([]);
    window.localStorage.setItem(MRU_STORAGE_KEY, '{not json');
    expect(getMruList()).toEqual([]);
    window.localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify([{ path: 'a' }, 3, { x: 1 }]));
    expect(getMruList()).toEqual([{ path: 'a' }]);
  });

  it('adds new paths to the beginning', () => {
    registerMru('a');
    registerMru('b');
    expect(getMruList().map((i) => i.path)).toEqual(['b', 'a']);
  });

  it('moves an existing path to the beginning without duplicating it', () => {
    registerMru('a');
    registerMru('b');
    registerMru('c');
    registerMru('a');
    expect(getMruList().map((i) => i.path)).toEqual(['a', 'c', 'b']);
  });

  it('keeps at most the max count, dropping the least recently used', () => {
    for (let i = 0; i < MRU_MAX_ITEM_COUNT + 5; i++) {
      registerMru(`p${i}`);
    }
    const items = getMruList();
    expect(items).toHaveLength(MRU_MAX_ITEM_COUNT);
    expect(items[0].path).toBe(`p${MRU_MAX_ITEM_COUNT + 4}`);
    expect(items[items.length - 1].path).toBe('p5');
  });

  it('removes a path', () => {
    registerMru('a');
    registerMru('b');
    removeMru('a');
    expect(getMruList().map((i) => i.path)).toEqual(['b']);
  });

  it('uses the original storage key', () => {
    registerMru('x');
    expect(window.localStorage.getItem('TreeMruList.items')).toBe('[{"path":"x"}]');
  });

  it('takes the last path segment with either separator', () => {
    expect(getPathLastSegment('D:\\trees\\owl.json')).toBe('owl.json');
    expect(getPathLastSegment('/home/u/owl.json')).toBe('owl.json');
    expect(getPathLastSegment('owl.json')).toBe('owl.json');
  });
});
