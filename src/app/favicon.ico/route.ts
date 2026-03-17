const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="codex-gradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f0bf6d" />
      <stop offset="1" stop-color="#4fa9cd" />
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="52" height="52" rx="16" fill="#0b0e14" />
  <path
    d="M20 22h12c9.941 0 18 8.059 18 18S41.941 58 32 58H20V22Zm12 28c5.523 0 10-4.477 10-10s-4.477-10-10-10h-4v20h4Z"
    fill="url(#codex-gradient)"
  />
</svg>
`.trim()

export async function GET() {
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
