import { getStorageItem, setStorageItem } from '../lib/storage';
import { zh } from './zh';

/*
 * UI translations. The English text is the key: `t('Save all')` returns the text of the current
 * language, or the English text itself when there is no translation. `{name}` placeholders are
 * replaced from `params`. The language is fixed for the page load; switching reloads the page.
 */

export type Language = 'en' | 'zh';

export interface LanguageInfo {
  id: Language;
  /** Name of the language in that language. */
  label: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

export const LANGUAGE_STORAGE_KEY = 'owlbt.language';

export type Dictionary = Readonly<Record<string, string>>;

const DICTIONARIES: Record<Language, Dictionary> = { en: {}, zh };

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.id === value);
}

/** Stored language, else Chinese when the browser prefers it, else English. */
export function detectLanguage(): Language {
  const stored = getStorageItem(LANGUAGE_STORAGE_KEY);
  if (isLanguage(stored)) {
    return stored;
  }
  const preferred = typeof navigator !== 'undefined' ? (navigator.language ?? '') : '';
  return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let current: Language = detectLanguage();

export function getLanguage(): Language {
  return current;
}

/** Changes the language for this page load only (tests); use `switchLanguage` in the UI. */
export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }
}

/** Persists the language and reloads the page so that every text is rendered again. */
export function switchLanguage(language: Language): void {
  setStorageItem(LANGUAGE_STORAGE_KEY, language);
  if (language !== current) {
    window.location.reload();
  }
}

export type TranslateParams = Readonly<Record<string, string | number>>;

function interpolate(text: string, params?: TranslateParams): string {
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** Translates an English UI text (see the module comment). */
export function t(text: string, params?: TranslateParams): string {
  const translated = DICTIONARIES[current][text];
  return interpolate(translated ?? text, params);
}

/** The dictionary of a language (for tests). */
export function dictionaryOf(language: Language): Dictionary {
  return DICTIONARIES[language];
}

setLanguage(current);
