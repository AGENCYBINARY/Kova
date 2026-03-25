'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button, Card } from '@/components/ui'
import styles from './AssistantSettingsForm.module.css'

interface Skill {
  id: string
  title: string
  description: string
}

interface Profile {
  executiveMode: boolean
  assistantName: string
  roleDescription: string
  defaultLanguage: 'fr' | 'en'
  writingTone: 'executive' | 'concise' | 'warm' | 'sales' | 'support'
  writingDirectness: 'soft' | 'balanced' | 'direct'
  signatureName: string
  signatureBlock: string
  executionPolicy: 'always_ask' | 'auto_low_risk' | 'auto_when_confident'
  confidenceThreshold: number
  autoResolveKnownContacts: boolean
  schedulingBufferMinutes: number
  meetingDefaultDurationMinutes: number
  enabledSkills: string[]
}

const defaultProfile: Profile = {
  executiveMode: true,
  assistantName: 'Kova',
  roleDescription: 'Executive AI operator across Gmail, Calendar, Docs, Drive, and Notion',
  defaultLanguage: 'fr',
  writingTone: 'executive',
  writingDirectness: 'balanced',
  signatureName: 'AGENCY BINARY',
  signatureBlock: 'AGENCY BINARY\nExecutive Operations',
  executionPolicy: 'auto_low_risk',
  confidenceThreshold: 0.75,
  autoResolveKnownContacts: true,
  schedulingBufferMinutes: 15,
  meetingDefaultDurationMinutes: 30,
  enabledSkills: [],
}

export function AssistantSettingsForm() {
  const [profile, setProfile] = useState<Profile>(defaultProfile)
  const [skills, setSkills] = useState<Skill[]>([])
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading executive assistant settings...')
  const [toast, setToast] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!toast) return

    const timeout = window.setTimeout(() => {
      setToast(null)
    }, 3000)

    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await fetch('/api/settings/assistant', { cache: 'no-store' })
        const data = await response.json()
        if (!active) return

        if (!response.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load assistant settings.')
        }

        const nextSkills = Array.isArray(data.skills) ? data.skills : []
        const nextProfile =
          data.profile && typeof data.profile === 'object'
            ? {
                ...defaultProfile,
                ...(data.profile as Profile),
                enabledSkills:
                  Array.isArray((data.profile as Profile).enabledSkills) &&
                  (data.profile as Profile).enabledSkills.length > 0
                    ? (data.profile as Profile).enabledSkills
                    : nextSkills.map((skill: Skill) => skill.id),
              }
            : {
                ...defaultProfile,
                enabledSkills: nextSkills.map((skill: Skill) => skill.id),
              }

        setProfile(nextProfile)
        setSkills(nextSkills)
        setExpandedSkillId((current) => current || nextSkills[0]?.id || null)
        setStatus('Executive assistant profile active.')
      } catch (error) {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Failed to load assistant settings.'
        setStatus(message)
      } finally {
        if (active) {
          setHasLoaded(true)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  const updateField = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  const toggleSkill = (skillId: string) => {
    setProfile((prev) => ({
      ...prev,
      enabledSkills: prev.enabledSkills.includes(skillId)
        ? prev.enabledSkills.filter((id) => id !== skillId)
        : [...prev.enabledSkills, skillId],
    }))
  }

  const toggleExpandedSkill = (skillId: string) => {
    setExpandedSkillId((current) => (current === skillId ? null : skillId))
  }

  const save = () => {
    startTransition(async () => {
      try {
        const response = await fetch('/api/settings/assistant', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(profile),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save assistant settings.')
        }

        setProfile(data.profile)
        setStatus('Executive assistant settings saved.')
        setToast('Assistant settings saved.')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save assistant settings.'
        setStatus(message)
        setToast(message)
      }
    })
  }

  return (
    <div className={styles.stack}>
      {toast ? <div className={styles.toast}>{toast}</div> : null}
      <Card variant="bordered" className={styles.card}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Executive Assistant Mode</h3>
            <p className={styles.description}>
              Configure Kova to behave like a senior executive secretary: polished writing, stronger judgment, and proactive execution rules.
            </p>
          </div>
          <div className={styles.toggleLine}>
            <span className={styles.muted}>{profile.executiveMode ? 'Enabled' : 'Disabled'}</span>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={profile.executiveMode}
                onChange={(event) => updateField('executiveMode', event.target.checked)}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Assistant name</span>
            <input value={profile.assistantName} onChange={(event) => updateField('assistantName', event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <input value={profile.roleDescription} onChange={(event) => updateField('roleDescription', event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Language</span>
            <select value={profile.defaultLanguage} onChange={(event) => updateField('defaultLanguage', event.target.value as Profile['defaultLanguage'])}>
              <option value="fr">French</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Writing tone</span>
            <select value={profile.writingTone} onChange={(event) => updateField('writingTone', event.target.value as Profile['writingTone'])}>
              <option value="executive">Executive</option>
              <option value="concise">Concise</option>
              <option value="warm">Warm</option>
              <option value="sales">Sales</option>
              <option value="support">Support</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Directness</span>
            <select value={profile.writingDirectness} onChange={(event) => updateField('writingDirectness', event.target.value as Profile['writingDirectness'])}>
              <option value="soft">Soft</option>
              <option value="balanced">Balanced</option>
              <option value="direct">Direct</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Execution policy</span>
            <select value={profile.executionPolicy} onChange={(event) => updateField('executionPolicy', event.target.value as Profile['executionPolicy'])}>
              <option value="always_ask">Always ask first</option>
              <option value="auto_low_risk">Auto for low-risk tasks</option>
              <option value="auto_when_confident">Auto when highly confident</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Confidence threshold</span>
            <input
              type="number"
              min="0.5"
              max="0.99"
              step="0.01"
              value={profile.confidenceThreshold}
              onChange={(event) => updateField('confidenceThreshold', Number(event.target.value))}
            />
          </label>
          <label className={styles.field}>
            <span>Meeting duration</span>
            <input
              type="number"
              min="15"
              max="120"
              step="15"
              value={profile.meetingDefaultDurationMinutes}
              onChange={(event) => updateField('meetingDefaultDurationMinutes', Number(event.target.value))}
            />
          </label>
          <label className={styles.field}>
            <span>Calendar buffer</span>
            <input
              type="number"
              min="0"
              max="60"
              step="5"
              value={profile.schedulingBufferMinutes}
              onChange={(event) => updateField('schedulingBufferMinutes', Number(event.target.value))}
            />
          </label>
          <label className={styles.field}>
            <span>Signature name</span>
            <input value={profile.signatureName} onChange={(event) => updateField('signatureName', event.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            <span>Signature block</span>
            <textarea value={profile.signatureBlock} onChange={(event) => updateField('signatureBlock', event.target.value)} />
          </label>
        </div>

        <div className={styles.optionRow}>
          <label className={styles.checkboxLine}>
            <input
              type="checkbox"
              checked={profile.autoResolveKnownContacts}
              onChange={(event) => updateField('autoResolveKnownContacts', event.target.checked)}
            />
            <span>Auto-resolve known contacts when the user only names the person.</span>
          </label>
        </div>
      </Card>

      <Card variant="bordered" className={styles.card}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Enabled Skills</h3>
            <p className={styles.description}>Choisis les compétences qui doivent guider le comportement de l’assistant. Ouvre une ligne pour lire le mini descriptif.</p>
          </div>
        </div>

        <div className={styles.skillsList}>
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`${styles.skillRow} ${profile.enabledSkills.includes(skill.id) ? styles.skillRowActive : ''}`}
            >
              <button
                type="button"
                className={styles.skillSummary}
                onClick={() => toggleExpandedSkill(skill.id)}
                aria-expanded={expandedSkillId === skill.id}
              >
                <span className={styles.skillArrow}>{expandedSkillId === skill.id ? '▾' : '▸'}</span>
                <strong className={styles.skillTitle}>{skill.title}</strong>
              </button>

              <label className={styles.skillToggle}>
                <input
                  type="checkbox"
                  checked={profile.enabledSkills.includes(skill.id)}
                  onChange={() => toggleSkill(skill.id)}
                />
                <span className={styles.skillToggleIndicator} aria-hidden="true" />
                <span>{profile.enabledSkills.includes(skill.id) ? 'Actif' : 'Inactif'}</span>
              </label>

              {expandedSkillId === skill.id ? (
                <p className={styles.skillDescription}>{skill.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <div className={styles.actions}>
        <span className={styles.status}>{status}</span>
        <Button onClick={save} loading={isPending} disabled={!hasLoaded || profile.enabledSkills.length === 0}>
          Save assistant profile
        </Button>
      </div>
    </div>
  )
}
