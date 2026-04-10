import styles from './Avatar.module.css'

interface AvatarProps {
  src?: string | null
  alt?: string
  size?: 'sm' | 'md' | 'lg'
  fallback?: string
}

/** Plain <img>: OAuth avatars (Google, GitHub, etc.) use many hostnames; next/image would require each in remotePatterns and still break on new IdPs. */
export function Avatar({ src, alt = 'Avatar', size = 'md', fallback }: AvatarProps) {
  const initials = fallback
    ? fallback
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?'

  if (src) {
    return (
      <div className={`${styles.avatar} ${styles[size]}`}>
        <img src={src} alt={alt} className={styles.image} referrerPolicy="no-referrer" />
      </div>
    )
  }

  return (
    <div className={`${styles.avatar} ${styles[size]} ${styles.fallback}`}>
      {initials}
    </div>
  )
}
