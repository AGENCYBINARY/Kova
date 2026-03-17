import { HTMLAttributes } from 'react'
import styles from './Badge.module.css'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'
  size?: 'sm' | 'md'
}

export function Badge({
  variant = 'default',
  size = 'md',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[variant]} ${styles[size]} ${className || ''}`}
      {...props}
    >
      {children}
    </span>
  )
}