/**
 * App mark matching `src/app/icon.svg` — rounded tile + gradient K.
 * `gradientIdSuffix` must be unique when multiple instances share one document.
 */
export function KovaAppIcon({
  size = 28,
  gradientIdSuffix = 'icon',
  className,
}: {
  size?: number
  gradientIdSuffix?: string
  className?: string
}) {
  const gid = `kova-app-gradient-${gradientIdSuffix.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0bf6d" />
          <stop offset="1" stopColor="#4fa9cd" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="16" fill="#0b0e14" />
      <path
        d="M20 22h12c9.941 0 18 8.059 18 18S41.941 58 32 58H20V22Zm12 28c5.523 0 10-4.477 10-10s-4.477-10-10-10h-4v20h4Z"
        fill={`url(#${gid})`}
      />
    </svg>
  )
}
