'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { AssistantSettingsForm } from '@/components/settings/AssistantSettingsForm'
import { Avatar, Button, Card } from '@/components/ui'
import { useLang } from '@/lib/lang-context'
import styles from './page.module.css'

export default function SettingsPage() {
  const { user } = useUser()
  const { t } = useLang()
  const [autoApproveActions, setAutoApproveActions] = useState(false)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [approvalSummaryDigest, setApprovalSummaryDigest] = useState(true)
  const [blockExternalSends, setBlockExternalSends] = useState(true)
  const [actionTimeout, setActionTimeout] = useState('60')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const notify = (message: string) => setToast(message)

  return (
    <div className={styles.container}>
      {toast ? <div className={styles.toast}>{toast}</div> : null}
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t.settings.eyebrow}</p>
          <h1 className={styles.title}>{t.settings.title}</h1>
          <p className={styles.subtitle}>{t.settings.subtitle}</p>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.settings.profile}</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.profile}>
              <Avatar
                src={user?.imageUrl}
                fallback={user?.fullName || 'U'}
                size="lg"
              />
              <div className={styles.profileInfo}>
                <h3 className={styles.profileName}>{user?.fullName || 'User'}</h3>
                <p className={styles.profileEmail}>
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
              <Button variant="secondary" size="sm">
                {t.settings.editProfile}
              </Button>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.settings.assistant}</h2>
          <AssistantSettingsForm />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t.settings.preferences}</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>{t.settings.autoApprove}</h4>
                <p className={styles.settingDescription}>{t.settings.autoApproveDesc}</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={autoApproveActions}
                  onChange={(e) => {
                    setAutoApproveActions(e.target.checked)
                    notify(t.settings.autoApprove + ' ' + (e.target.checked ? '✓' : '✗'))
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>{t.settings.emailNotifs}</h4>
                <p className={styles.settingDescription}>{t.settings.emailNotifsDesc}</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(e) => {
                    setEmailNotifications(e.target.checked)
                    notify(t.settings.emailNotifs + ' ' + (e.target.checked ? '✓' : '✗'))
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>{t.settings.actionTimeout}</h4>
                <p className={styles.settingDescription}>{t.settings.actionTimeoutDesc}</p>
              </div>
              <select
                className={styles.select}
                value={actionTimeout}
                onChange={(e) => {
                  setActionTimeout(e.target.value)
                  notify(t.settings.actionTimeout + ': ' + e.target.value + 's')
                }}
              >
                <option value="30">30 {t.settings.seconds}</option>
                <option value="60">60 {t.settings.seconds}</option>
                <option value="120">120 {t.settings.seconds}</option>
              </select>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Execution Defaults</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>{t.settings.approvalDigest}</h4>
                <p className={styles.settingDescription}>{t.settings.approvalDigestDesc}</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={approvalSummaryDigest}
                  onChange={(e) => {
                    setApprovalSummaryDigest(e.target.checked)
                    notify(t.settings.approvalDigest + ' ' + (e.target.checked ? '✓' : '✗'))
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>{t.settings.blockExternal}</h4>
                <p className={styles.settingDescription}>{t.settings.blockExternalDesc}</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={blockExternalSends}
                  onChange={(e) => {
                    setBlockExternalSends(e.target.checked)
                    notify(t.settings.blockExternal + ' ' + (e.target.checked ? '✓' : '✗'))
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Danger Zone</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.dangerSetting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Supprimer toutes les données</h4>
                <p className={styles.settingDescription}>
                  Supprime définitivement tous vos messages, actions et historique
                </p>
              </div>
              <Button variant="danger" size="sm">
                Supprimer
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </div>
  )
}
