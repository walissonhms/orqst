import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en-US.json';
import pt from './locales/pt-BR.json';
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { 'en-US': { translation: en }, 'pt-BR': { translation: pt } },
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'pt-BR'],
    nonExplicitSupportedLngs: false,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    load: 'currentOnly',
  });
export default i18n;
