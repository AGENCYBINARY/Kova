'use client'

import { Slot } from '@radix-ui/react-slot'
import { ButtonHTMLAttributes, forwardRef } from 'react'
import styles from './Button.module.css'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  /** Render child as the element (e.g. `<Button asChild><Link href="…">…</Link></Button>`). */
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading,
      disabled,
      asChild = false,
      type = 'button',
      children,
      ...props
    },
    ref
  ) => {
    const classNames = `${styles.button} ${styles[variant]} ${styles[size]} ${className || ''}`.trim()

    if (asChild) {
      return (
        <Slot ref={ref} className={classNames} {...props}>
          {children}
        </Slot>
      )
    }

    return (
      <button ref={ref} type={type} className={classNames} disabled={disabled || loading} {...props}>
        {loading ? <span className={styles.spinner} /> : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
