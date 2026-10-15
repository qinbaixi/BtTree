import { useSyncExternalStore } from 'react';
import { getStorageItem, setStorageItem } from './storage';
import { t } from '../i18n';

export type ThemeId = 'light' | 'classic';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'light', label: 'Light' },
  { id: 'classic', label: 'Classic dark' },
];

export const THEME_STORAGE_KEY = 'owlbt.theme';
export const DEFAULT_THEME: ThemeId = 'light';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** Translated name of a theme. */
export function themeLabel(id: ThemeId): string {
  const label = THEMES.find((theme) => theme.id === id)?.label;
  return label !== undefined ? t(label) : id;
}

/** Stored theme, or the default when nothing (or an unknown value) is stored. */
export function getTheme(): ThemeId {
  const stored = getStorageItem(THEME_STORAGE_KEY);
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyToDocument(id: ThemeId): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id;
  }
}

/** Persists the theme, applies it to the document and notifies subscribers. */
export function setTheme(id: ThemeId): void {
  setStorageItem(THEME_STORAGE_KEY, id);
  applyToDocument(id);
  for (const listener of listeners) {
    listener();
  }
}

/** Applies the stored theme before the first render (called from main.tsx). */
export function applyStoredTheme(): void {
  applyToDocument(getTheme());
}

/** Current theme; components re-render when it changes. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME);
}
