import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dictionaryOf,
  getLanguage,
  LANGUAGE_STORAGE_KEY,
  setLanguage,
  setUnsavedChangesCheck,
  switchLanguage,
  t,
} from '.';
import { common } from './zh/common';
import { editor } from './zh/editor';
import { panels } from './zh/panels';
import { projectEditor } from './zh/projectEditor';

describe('i18n', () => {
  const initial = getLanguage();
  afterEach(() => {
    setLanguage(initial);
    setUnsavedChangesCheck(undefined);
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns the English text without a translation', () => {
    setLanguage('en');
    expect(t('Save')).toBe('Save');
    expect(t('No translation for this text')).toBe('No translation for this text');
  });

  it('translates to Chinese and fills placeholders', () => {
    setLanguage('zh');
    expect(t('Save')).toBe('保存');
    expect(t('Tick {tick}', { tick: 3 })).toBe('第 3 个 tick');
    expect(t('Unknown {name} ({count})', { name: 'x', count: 2 })).toBe('Unknown x (2)');
  });

  it('keeps the placeholders of every translation', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [english, chinese] of Object.entries(dictionaryOf('zh'))) {
      expect(placeholders(chinese), english).toEqual(placeholders(english));
    }
  });

  it('has no duplicate keys across the Chinese dictionary files', () => {
    const parts: Array<[string, Record<string, string>]> = [
      ['common', common],
      ['editor', editor],
      ['panels', panels],
      ['projectEditor', projectEditor],
    ];
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [name, dict] of parts) {
      for (const key of Object.keys(dict)) {
        const previous = seen.get(key);
        if (previous !== undefined) {
          duplicates.push(`${key} (${previous}, ${name})`);
        } else {
          seen.set(key, name);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('asks before switching language when there are unsaved changes', () => {
    setLanguage('en');
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    switchLanguage('zh');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});
