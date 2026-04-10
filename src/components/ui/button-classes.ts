import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

/** Same visual classes as `<Button>` for use on `<Link>` (avoid invalid `<a><button>` nesting). */
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
