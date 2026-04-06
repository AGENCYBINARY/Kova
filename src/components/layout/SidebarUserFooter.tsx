'use client'

import { UserButton } from '@clerk/nextjs'
import styles from './Sidebar.module.css'

type Props = {
  userName: string
  userEmail: string
}

export function SidebarUserFooter({ userName, userEmail }: Props) {
  return (
    <div className={styles.footer}>
      <div className={styles.user}>
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: styles.userAvatar,
            },
          }}
        />
        <div className={styles.userInfo}>
          <span className={styles.userName}>{userName}</span>
          <span className={styles.userEmail}>{userEmail}</span>
        </div>
      </div>
    </div>
  )
}
