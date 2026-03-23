import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs"
import { prisma } from "@/lib/prisma"
import { stripe, PLANS } from "@/lib/stripe"

export async function POST(req: Request) {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { plan } = await req.json()
  if (plan !== "plus" && plan !== "pro")
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })

  const priceId = PLANS[plan].priceId
  if (!priceId) return NextResponse.json({ error: "Price not configured" }, { status: 500 })

  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  let sub = await prisma.subscription.findUnique({ where: { userId: user.id } })

  let customerId = sub?.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id, clerkId },
    })
    customerId = customer.id
    if (sub) {
      await prisma.subscription.update({ where: { userId: user.id }, data: { stripeCustomerId: customerId } })
    } else {
      await prisma.subscription.create({ data: { userId: user.id, stripeCustomerId: customerId } })
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: ,
    cancel_url: ,
    metadata: { userId: user.id, plan },
  })

  return NextResponse.json({ url: session.url })
}
