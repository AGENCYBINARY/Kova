import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import Stripe from "stripe"

export async function POST(req: Request) {
  const body = await req.text()
  const signature = headers().get("stripe-signature")!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const getPlan = (priceId: string) => {
    if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus"
    if (priceId === process.env.STRIPE_PRICE_PRO) return "pro"
    return "free"
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.CheckoutSession
      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const priceId = sub.items.data[0].price.id
      const plan = getPlan(priceId)
      await prisma.subscription.update({
        where: { stripeCustomerId: session.customer as string },
        data: {
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          plan,
          status: "active",
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
        },
      })
      break
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const priceId = sub.items.data[0].price.id
      const plan = getPlan(priceId)
      await prisma.subscription.update({
        where: { stripeCustomerId: sub.customer as string },
        data: {
          plan,
          status: sub.status,
          stripePriceId: priceId,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
        },
      })
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      await prisma.subscription.update({
        where: { stripeCustomerId: sub.customer as string },
        data: { plan: "free", status: "active", stripeSubscriptionId: null, stripePriceId: null },
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
