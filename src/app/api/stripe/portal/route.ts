import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAppBaseUrl } from '@/lib/app-url'
import { getPrisma } from '@/lib/db/prisma'
import { getStripe } from '@/lib/stripe'

export async function POST() {
  const prisma = getPrisma()
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } })
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
  }

  const appUrl = getAppBaseUrl()
  const stripe = getStripe()

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/settings`,
  })

  return NextResponse.json({ url: session.url })
}
