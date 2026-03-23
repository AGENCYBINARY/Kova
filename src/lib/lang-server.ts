import { cookies } from 'next/headers'
import { Lang, translations, Translations } from './i18n'

export function getLang(): Lang {
  const cookieStore = cookies()
  const lang = cookieStore.get('lang')?.value
  if (lang === 'fr' || lang === 'en') return lang
  return 'fr'
}

export function getT(): Translations {
  return translations[getLang()] as Translations
}
