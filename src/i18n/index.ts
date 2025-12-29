/**
 * i18n Configuration for Protoagente
 * Manages internationalization using i18next with filesystem backend
 */

import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { join } from 'path';

// Initialize i18next
await i18next
  .use(Backend)
  .init({
    lng: process.env.DEFAULT_LANGUAGE || 'pt-BR',
    fallbackLng: 'pt-BR',
    ns: ['common', 'telegram', 'api', 'resilience', 'whisper'],
    defaultNS: 'common',
    backend: {
      loadPath: join(process.cwd(), 'src/i18n/locales/{{lng}}/{{ns}}.json')
    },
    interpolation: {
      escapeValue: false // HTML allowed for Telegram parse_mode
    },
    returnEmptyString: false,
    returnNull: false,
  });

// Export the i18next instance and helper function
export default i18next;
export const t = i18next.t.bind(i18next);
export const changeLanguage: (lng: string) => Promise<any> = i18next.changeLanguage.bind(i18next);
