import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  adjustFontFallback: true,
  variable: '--font-manrope',
})

export const metadata: Metadata = {
  title: 'Kova - AI Execution Agent',
  description: 'AI-powered execution agent for professionals and teams',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${manrope.className} ${manrope.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
