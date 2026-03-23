import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/db/prisma"
import { stripe } from "@/lib/stripe"

export async function POST() {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } })
  if (!sub?.stripeCustomerId)
    return NextResponse.json({ error: "No subscription found" }, { status: 404 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://kova.agencybinary.fr"

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: appUrl + "/settings",
  })

  return NextResponse.json({ url: session.url })
}
