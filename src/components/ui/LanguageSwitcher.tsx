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
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '13px',
        padding: '4px 8px',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'none'
        e.currentTarget.style.color = 'var(--text-muted)'
      }}
    >
      <span style={{ fontSize: '16px' }}>{lang === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
      <span>{lang === 'fr' ? 'FR' : 'EN'}</span>
    </button>
  )
}
