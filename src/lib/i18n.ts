import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

const stored = (() => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
})();

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  // Until the profile loads, follow what was picked last on this device, else the device language
  // (a fresh install, like the iPhone app, would otherwise start in English).
  lng: (stored ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase().startsWith('es') ? 'es' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'en' | 'es') {
  i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* storage unavailable */
  }
}

export default i18n;
