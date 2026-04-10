import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

/** Classes identiques à `<Button>` pour un `<Link>` (évite `<a><button>` invalide). Usage côté Server Components. */
export function buttonClassNames(opts?: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}): string {
  const variant = opts?.variant ?? 'primary'
  const size = opts?.size ?? 'md'
  const base = `${styles.button} ${styles[variant]} ${styles[size]}`
  return opts?.className ? `${base} ${opts.className}` : base
}
