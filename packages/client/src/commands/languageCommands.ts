import { LANGUAGES, switchLanguage, t, type Language } from '../i18n';
import { registerCommand, type Command } from './registry';

export const LANGUAGE_COMMAND_IDS: Record<Language, string> = {
  en: 'core:LanguageEnglish',
  zh: 'core:LanguageChinese',
};

/** Menu / palette title of a language item, e.g. "Language: 中文". */
export function languageItemTitle(language: Language): string {
  const label = LANGUAGES.find((info) => info.id === language)?.label ?? language;
  return t('Language: {name}', { name: label });
}

/**
 * Switch the UI language (persisted; the page reloads). Always executable, so they also appear
 * in the command palette.
 */
export const languageCommands: Command[] = LANGUAGES.map((info) => ({
  id: LANGUAGE_COMMAND_IDS[info.id],
  name: languageItemTitle(info.id),
  canExec: () => true,
  exec: () => switchLanguage(info.id),
}));

for (const command of languageCommands) {
  registerCommand(command);
}
