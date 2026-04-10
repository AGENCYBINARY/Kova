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

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.className} ${manrope.variable}`}>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  if (!publishableKey) {
    return <AppShell>{children}</AppShell>
  }
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <AppShell>{children}</AppShell>
    </ClerkProvider>
  )
}
