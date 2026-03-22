'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import s from './KovaDemoVideo.module.css'

// ─────────────────────────────────────────────────────────────────────────────
// Chaque scène décrit :
//   - Le zoom caméra (scale + transformOrigin qui colle au curseur)
//   - L'état du contenu (messages, proposal…)
//   - La position du curseur dans le viewport (% width, % height)
// ─────────────────────────────────────────────────────────────────────────────
interface Scene {
  label: string
  duration: number
  // Zoom caméra
  scale: number
  originX: string   // transformOrigin X  (doit = cursorX%)
  originY: string   // transformOrigin Y  (doit = cursorY%)
  // Contenu
  showUserMsg: boolean
  showTyping: boolean
  showAIMsg: boolean
  showProposal: boolean
  approved: boolean
  success: boolean
  // Curseur
  cx: number   // % du viewport
  cy: number   // % du viewport
  click: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT DYNAMIQUE (viewport 500 px, sidebar 165 px) :
//
//   Sans proposal (scènes 1-4) :
//     chatHeader  : y   0 –  44 px
//     messages    : y  44 – 450 px  (flex:1 → remplit l'espace, chat naturel)
//     inputRow    : y 450 – 488 px  (en bas, comme un vrai chat)
//
//   Avec proposal (scènes 5-8) :
//     chatHeader  : y   0 –  44 px
//     messages    : y  44 – 184 px  (max-height:140px, se rétracte)
//     inputRow    : y 184 – 234 px
//     proposal    : y 234 – 379 px
//     approve btn : y ≈ 353 px → 70.6 % du viewport
//
//   RÈGLE : originX/Y == cx/cy  ⇒  zoom toujours centré sur le curseur
// ─────────────────────────────────────────────────────────────────────────────
const SCENES: Scene[] = [
  // 1 – Vue d'ensemble (chat vide, pas de zoom)
  {
    label: 'Interface Kova',
    duration: 1600,
    scale: 1, originX: '50%', originY: '50%',
    showUserMsg: false, showTyping: false, showAIMsg: false,
    showProposal: false, approved: false, success: false,
    cx: 50, cy: 50, click: false,
  },
  // 2 – L'utilisateur envoie le message (curseur en bas sur la zone de saisie)
  //     messages=flex:1 → input en bas à y≈90%, curseur là-bas → gros déplacement
  {
    label: 'Message envoyé',
    duration: 2000,
    scale: 1, originX: '50%', originY: '50%',
    showUserMsg: true, showTyping: false, showAIMsg: false,
    showProposal: false, approved: false, success: false,
    cx: 76, cy: 90, click: false,
  },
  // 3 – Kova réfléchit (curseur remonte vers les points de frappe en haut)
  //     messages=flex:1, typing à y≈120px=24%, gros déplacement visible du curseur
  {
    label: 'Kova réfléchit…',
    duration: 1800,
    scale: 1.3, originX: '30%', originY: '24%',
    showUserMsg: true, showTyping: true, showAIMsg: false,
    showProposal: false, approved: false, success: false,
    cx: 30, cy: 24, click: false,
  },
  // 4 – Réponse générée (curseur sur le message AI, y≈26%)
  {
    label: 'Réponse générée',
    duration: 2200,
    scale: 1.3, originX: '36%', originY: '26%',
    showUserMsg: true, showTyping: false, showAIMsg: true,
    showProposal: false, approved: false, success: false,
    cx: 36, cy: 26, click: false,
  },
  // 5 – Action proposée : messages se rétracte, proposal apparaît,
  //     curseur descend vers le bouton Approuver (gros mouvement visible)
  {
    label: 'Action proposée',
    duration: 2000,
    scale: 1.2, originX: '27%', originY: '71%',
    showUserMsg: true, showTyping: false, showAIMsg: true,
    showProposal: true, approved: false, success: false,
    cx: 27, cy: 71, click: false,
  },
  // 6 – Zoom sur le bouton Approuver
  {
    label: 'Approuver ?',
    duration: 1700,
    scale: 1.75, originX: '27%', originY: '71%',
    showUserMsg: true, showTyping: false, showAIMsg: true,
    showProposal: true, approved: false, success: false,
    cx: 27, cy: 71, click: false,
  },
  // 7 – Clic → Approuvé !
  {
    label: '✓ Approuvé !',
    duration: 1400,
    scale: 1.75, originX: '27%', originY: '71%',
    showUserMsg: true, showTyping: false, showAIMsg: true,
    showProposal: true, approved: true, success: false,
    cx: 27, cy: 71, click: true,
  },
  // 8 – Zoom arrière → succès
  {
    label: '🎉 Exécuté !',
    duration: 2600,
    scale: 1, originX: '50%', originY: '50%',
    showUserMsg: true, showTyping: false, showAIMsg: true,
    showProposal: true, approved: true, success: true,
    cx: 50, cy: 44, click: false,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
export default function KovaDemoVideo() {
  const [idx, setIdx] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIdx((prev) => (prev + 1) % SCENES.length)
    }, SCENES[idx].duration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [idx])

  const sc = SCENES[idx]

  return (
    <div className={s.outer}>
      {/* ── Browser chrome ─────────────────────────────────────────────── */}
      <div className={s.browser}>
        <div className={s.chrome}>
          <div className={s.dots}>
            <span style={{ background: '#ff5f57' }} />
            <span style={{ background: '#ffbd2e' }} />
            <span style={{ background: '#28c940' }} />
          </div>
          <div className={s.urlBar}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            app.kova.ai/chat
          </div>
          <div style={{ flex: 1 }} />
        </div>

        {/* ── Viewport (overflow hidden) ──────────────────────────────── */}
        <div className={s.viewport}>

          {/* App frame qui zoome via CSS transition */}
          <div
            className={s.appFrame}
            style={{
              transform: `scale(${sc.scale})`,
              transformOrigin: `${sc.originX} ${sc.originY}`,
              transition: 'transform 1.1s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            }}
          >
            {/* ── Sidebar ── */}
            <aside className={s.sidebar}>
              <div className={s.brand}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#6a8cff" />
                  <path d="M2 17L12 22L22 17" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" />
                  <path d="M2 12L12 17L22 12" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
                </svg>
                Kova
              </div>
              {[
                { label: 'Dashboard', glyph: '▦' },
                { label: 'Chat',      glyph: '◎', active: true },
                { label: 'Actions',   glyph: '◈' },
                { label: 'History',   glyph: '◷' },
                { label: 'Settings',  glyph: '⊙' },
              ].map((item) => (
                <div key={item.label} className={`${s.navItem} ${item.active ? s.navActive : ''}`}>
                  <span className={s.navGlyph}>{item.glyph}</span>
                  {item.label}
                </div>
              ))}
              <div className={s.intégrations}>
                <div className={s.integLabel}>Intégrations</div>
                {['Gmail', 'Calendar', 'Notion', 'Drive'].map((app) => (
                  <div key={app} className={s.integRow}>
                    <span className={`${s.integDot} ${sc.success ? s.integGreen : ''}`} />
                    {app}
                  </div>
                ))}
              </div>
            </aside>

            {/* ── Chat ── */}
            <main className={s.chat}>
              {/* Header */}
              <div className={s.chatHeader}>
                <span className={s.chatTitle}>Chat avec Kova</span>
              </div>

              {/* Messages — flex:1 par défaut, se rétracte quand proposal visible */}
              <div className={`${s.messages} ${sc.showProposal ? s.messagesCompact : ''}`}>
                <AnimatePresence>
                  {sc.showUserMsg && (
                    <motion.div key="um" className={`${s.msg} ${s.msgUser}`}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                      <div className={s.bubble}>
                        Programme un déjeuner avec Maxime lundi à 13h
                      </div>
                    </motion.div>
                  )}
                  {sc.showTyping && (
                    <motion.div key="typing" className={`${s.msg} ${s.msgAI}`}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                      <div className={s.avatar}>K</div>
                      <div className={`${s.bubble} ${s.typingBubble}`}>
                        <span className={s.dot} style={{ animationDelay: '0ms' }} />
                        <span className={s.dot} style={{ animationDelay: '200ms' }} />
                        <span className={s.dot} style={{ animationDelay: '400ms' }} />
                      </div>
                    </motion.div>
                  )}
                  {sc.showAIMsg && (
                    <motion.div key="ai" className={`${s.msg} ${s.msgAI}`}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                      <div className={s.avatar}>K</div>
                      <div className={s.bubble}>
                        Bien sûr ! J&apos;ai préparé l&apos;invitation Calendar pour{' '}
                        <strong>lundi à 13h00</strong> avec Maxime. Vérifie ci-dessous.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Input */}
              <div className={s.inputRow}>
                <div className={s.inputBox}>
                  <span className={s.inputPlaceholder}>
                    {sc.showUserMsg ? 'Demande quelque chose…' : 'Programme un déjeuner avec Maxime…'}
                  </span>
                </div>
                <div className={s.sendBtn}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" />
                  </svg>
                </div>
              </div>

              {/* Proposal */}
              <AnimatePresence>
                {sc.showProposal && (
                  <motion.div key="proposal"
                    className={`${s.proposal} ${sc.approved ? s.proposalOk : ''} ${sc.success ? s.proposalDone : ''}`}
                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.4 }}>
                    <div className={s.proposalTop}>
                      <div className={s.proposalBadge}>
                        <span className={s.pulseDot} />
                        Action proposée · Calendar
                      </div>
                      <span className={s.riskTag}>Risque faible</span>
                    </div>
                    <div className={s.proposalTitle}>📅 &nbsp;Déjeuner avec Maxime Neveu</div>
                    <div className={s.proposalMeta}>
                      <div className={s.metaCol}>
                        <span className={s.metaKey}>Date</span>
                        <span className={s.metaVal}>Lundi 24 mars · 13:00–14:00</span>
                      </div>
                      <div className={s.metaCol}>
                        <span className={s.metaKey}>Invité</span>
                        <span className={s.metaVal}>maxime@example.com</span>
                      </div>
                    </div>
                    <div className={s.proposalBtns}>
                      <motion.button
                        className={`${s.btnApprove} ${sc.approved ? s.btnApproved : ''}`}
                        animate={sc.approved ? { scale: [1, 0.93, 1.04, 1] } : {}}
                        transition={{ duration: 0.35 }}>
                        {sc.approved ? '✓ Approuvé' : 'Approuver'}
                      </motion.button>
                      <button className={s.btnReject}>Rejeter</button>
                    </div>
                    <AnimatePresence>
                      {sc.success && (
                        <motion.div className={s.successBanner}
                          initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }}
                          style={{ transformOrigin: 'left' }} transition={{ duration: 0.55 }}>
                          ✓ Événement créé sur Google Calendar
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </div>

          {/* ── Curseur SVG flottant (en dehors du frame zoomé) ────────── */}
          <motion.div
            className={s.cursor}
            initial={{ left: `${SCENES[0].cx}%`, top: `${SCENES[0].cy}%` }}
            animate={{ left: `${sc.cx}%`, top: `${sc.cy}%` }}
            transition={{ duration: 0.9, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <svg
              width="28" height="32"
              viewBox="0 0 28 32"
              fill="none"
              style={{ transform: sc.click ? 'scale(0.84)' : 'scale(1)', transition: 'transform 0.12s' }}
            >
              <path
                d="M3 2L3 27L10 19.5L14 29.5L18 27.5L14 17.5L23 17.5L3 2Z"
                fill="white"
                stroke="#1a1a2e"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            {sc.click && <span key={`ripple-${idx}`} className={s.ripple} />}
          </motion.div>

        </div>{/* /viewport */}
      </div>{/* /browser */}

      {/* ── Progress ── */}
      <div className={s.progress}>
        {SCENES.map((_, i) => (
          <div key={i} className={`${s.pip} ${i === idx ? s.pipActive : i < idx ? s.pipPast : ''}`} />
        ))}
      </div>

      {/* ── Label de scène ── */}
      <AnimatePresence mode="wait">
        <motion.p key={sc.label} className={s.sceneLabel}
          initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.25 }}>
          {sc.label}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}
