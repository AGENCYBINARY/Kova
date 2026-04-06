import type { Metadata, Viewport } from 'next'
import { Manrope } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  adjustFontFallback: true,
  variable: '--font-manrope',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Kova - AI Execution Agent',
  description: 'AI-powered execution agent for professionals and teams',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${manrope.className} ${manrope.variable}`}>
        <body>
          {children}
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
