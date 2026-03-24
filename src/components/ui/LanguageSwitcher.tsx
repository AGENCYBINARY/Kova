'use client'
import { useLang } from '@/lib/lang-context'

export function LanguageSwitcher() {
  const { lang, setLang } = useLang()

  return (
    <button
      onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
      title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        padding: '4px 6px',
        color: 'rgba(255,255,255,0.28)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 6,
        transition: 'color 0.15s',
        letterSpacing: '0.04em',
        fontWeight: 500,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.65)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.28)' }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{lang === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
      <span>{lang === 'fr' ? 'FR' : 'EN'}</span>
    </button>
  )
}
