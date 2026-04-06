import Image from 'next/image'

const SRC = '/kova-layer-mark.png'

/**
 * Layered isometric Kova mark (PNG, transparent). Use next to visible “Kova” text — image is decorative.
 */
export function KovaLayerMark({
  size = 26,
  className,
  priority,
}: {
  size?: number
  className?: string
  priority?: boolean
}) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden
    >
      <Image
        src={SRC}
        alt=""
        width={size}
        height={size}
        priority={priority}
        sizes={`${size}px`}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    </span>
  )
}
