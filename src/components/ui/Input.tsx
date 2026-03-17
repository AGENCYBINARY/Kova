'use client'

import { InputHTMLAttributes, forwardRef } from 'react'
import styles from './Input.module.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, className, ...props }, ref) => {
    return (
      <div className={styles.wrapper}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <input
          ref={ref}
          className={`${styles.input} ${icon ? styles.withIcon : ''} ${className || ''}`}
          {...props}
        />
      </div>
    )
  }
)

Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`${styles.textarea} ${error ? styles.error : ''} ${className || ''}`}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'