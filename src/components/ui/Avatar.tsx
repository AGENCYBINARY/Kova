import Image from 'next/image'
import styles from './Avatar.module.css'

interface AvatarProps {
  src?: string | null
  alt?: string
  size?: 'sm' | 'md' | 'lg'
  fallback?: string
}

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
        <Image src={src} alt={alt} fill sizes={size === 'lg' ? '48px' : size === 'md' ? '36px' : '28px'} className={styles.image} />
      </div>
    )
  }

  return (
    <div className={`${styles.avatar} ${styles[size]} ${styles.fallback}`}>
      {initials}
    </div>
  )
}
