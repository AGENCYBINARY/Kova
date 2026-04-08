'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Lang, translations, Translations } from './i18n'

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translations
}

const LangContext = createContext<LangContextValue>({
  lang: 'fr',
  setLang: () => {},
  t: translations.fr,
})

export function LangProvider({ children, initialLang = 'fr' }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  useEffect(() => {
    if (initialLang === 'fr' || initialLang === 'en') {
      return
    }
    const saved = document.cookie
      .split('; ')
      .find((row) => row.startsWith('lang='))
      ?.split('=')[1] as Lang | undefined
    if (saved === 'fr' || saved === 'en') {
      setLangState(saved)
    }
  }, [initialLang])

  const setLang = (l: Lang) => {
    setLangState(l)
    document.cookie = `lang=${l};path=/;max-age=31536000;SameSite=Lax`
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t: translations[lang] as Translations }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
