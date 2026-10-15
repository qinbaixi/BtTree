import { afterEach, describe, expect, it } from 'vitest';
import { dictionaryOf, getLanguage, setLanguage, t } from '.';

describe('i18n', () => {
  const initial = getLanguage();
  afterEach(() => setLanguage(initial));

  it('returns the English text without a translation', () => {
    setLanguage('en');
    expect(t('Save')).toBe('Save');
    expect(t('No translation for this text')).toBe('No translation for this text');
  });

  it('translates to Chinese and fills placeholders', () => {
    setLanguage('zh');
    expect(t('Save')).toBe('保存');
    expect(t('Unknown {name} ({count})', { name: 'x', count: 2 })).toBe('Unknown x (2)');
  });

  it('keeps the placeholders of every translation', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [english, chinese] of Object.entries(dictionaryOf('zh'))) {
      expect(placeholders(chinese), english).toEqual(placeholders(english));
    }
  });
});
