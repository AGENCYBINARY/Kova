'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { AssistantSettingsForm } from '@/components/settings/AssistantSettingsForm'
import { Avatar, Button, Card } from '@/components/ui'
import styles from './page.module.css'

export default function SettingsPage() {
  const { user } = useUser()
  const [autoApproveActions, setAutoApproveActions] = useState(false)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [approvalSummaryDigest, setApprovalSummaryDigest] = useState(true)
  const [blockExternalSends, setBlockExternalSends] = useState(true)
  const [actionTimeout, setActionTimeout] = useState('60')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return

    const timeout = window.setTimeout(() => {
      setToast(null)
    }, 3000)

    return () => window.clearTimeout(timeout)
  }, [toast])

  const notify = (message: string) => {
    setToast(message)
  }

  return (
    <div className={styles.container}>
      {toast ? <div className={styles.toast}>{toast}</div> : null}
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace Preferences</p>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>
            Tune approval behavior, notifications, and operator safeguards for this workspace.
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Profile</h2>
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
                Edit Profile
              </Button>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Executive Assistant</h2>
          <AssistantSettingsForm />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Preferences</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Auto-approve actions</h4>
                <p className={styles.settingDescription}>
                  Automatically approve low-risk actions without confirmation
                </p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={autoApproveActions}
                  onChange={(event) => {
                    setAutoApproveActions(event.target.checked)
                    notify(`Auto-approve actions ${event.target.checked ? 'enabled' : 'disabled'}.`)
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Email notifications</h4>
                <p className={styles.settingDescription}>
                  Receive email notifications for pending actions
                </p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(event) => {
                    setEmailNotifications(event.target.checked)
                    notify(`Email notifications ${event.target.checked ? 'enabled' : 'disabled'}.`)
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Action timeout</h4>
                <p className={styles.settingDescription}>
                  Maximum time to wait for action execution (seconds)
                </p>
              </div>
              <select
                className={styles.select}
                value={actionTimeout}
                onChange={(event) => {
                  setActionTimeout(event.target.value)
                  notify(`Action timeout set to ${event.target.value} seconds.`)
                }}
              >
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
                <option value="120">120 seconds</option>
              </select>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Execution Defaults</h2>
          <Card variant="bordered" className={styles.card}>
            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Approval summary digest</h4>
                <p className={styles.settingDescription}>
                  Bundle low-priority proposals into a single review digest every hour.
                </p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={approvalSummaryDigest}
                  onChange={(event) => {
                    setApprovalSummaryDigest(event.target.checked)
                    notify(`Approval summary digest ${event.target.checked ? 'enabled' : 'disabled'}.`)
                  }}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            <div className={styles.divider} />

            <div className={styles.setting}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingTitle}>Block external sends after failure</h4>
                <p className={styles.settingDescription}>
                  Pause outbound actions automatically when a provider authentication error is detected.
                </p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={blockExternalSends}
                  onChange={(event) => {
                    setBlockExternalSends(event.target.checked)
                    notify(`Failure protection ${event.target.checked ? 'enabled' : 'disabled'}.`)
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
                <h4 className={styles.settingTitle}>Delete all data</h4>
                <p className={styles.settingDescription}>
                  Permanently delete all your data including messages, actions, and history
                </p>
              </div>
              <Button variant="danger" size="sm">
                Delete Data
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </div>
  )
}
