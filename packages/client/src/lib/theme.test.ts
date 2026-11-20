import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStoredTheme,
  DEFAULT_THEME,
  getTheme,
  isThemeId,
  setTheme,
  THEME_STORAGE_KEY,
  themeLabel,
  THEMES,
} from './theme';

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to the light theme', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(getTheme()).toBe('light');
  });

  it('lists the light and classic themes with their labels', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['light', 'classic']);
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('classic')).toBe('Classic dark');
  });

  it('falls back to the default for unknown stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(getTheme()).toBe('light');
    expect(isThemeId('neon')).toBe(false);
    expect(isThemeId('classic')).toBe(true);
  });

  it('persists the theme and sets it on the document', () => {
    setTheme('classic');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('classic');
    expect(document.documentElement.dataset.theme).toBe('classic');
    expect(getTheme()).toBe('classic');
  });

  it('applies the stored theme on startup', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'classic');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('classic');
  });

  it('applies the default theme when nothing is stored', () => {
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to in-memory theme when localStorage writes throw', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      setTheme('classic');
      expect(getTheme()).toBe('classic');
      expect(document.documentElement.dataset.theme).toBe('classic');
    } finally {
      spy.mockRestore();
      // Restore normal persistence state for later tests.
      setTheme('light');
    }
  });
});
