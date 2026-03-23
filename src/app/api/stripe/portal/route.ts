import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"

export async function POST() {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } })
  if (!sub?.stripeCustomerId)
    return NextResponse.json({ error: "No subscription found" }, { status: 404 })

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: ,
  })

  return NextResponse.json({ url: session.url })
}
