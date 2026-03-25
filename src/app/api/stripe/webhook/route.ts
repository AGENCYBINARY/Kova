import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/db/prisma"
import Stripe from "stripe"

type StripeSubscriptionLike = Stripe.Subscription & {
  current_period_end?: number | null
}

function getPeriodEnd(sub: StripeSubscriptionLike): Date | null {
  const ts = sub.current_period_end ?? null
  return ts ? new Date(ts * 1000) : null
}

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
      const session = event.data.object as Stripe.Checkout.Session
      const sub = await stripe.subscriptions.retrieve(session.subscription as string) as StripeSubscriptionLike
      const priceId = sub.items.data[0].price.id
      const plan = getPlan(priceId)
      const userId = session.metadata?.userId

      if (!userId) {
        console.error("[stripe-webhook] missing userId in checkout session metadata", session.id)
        break
      }

      await prisma.subscription.upsert({
        where: { userId },
        update: {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          plan,
          status: "active",
          currentPeriodEnd: getPeriodEnd(sub),
        },
        create: {
          userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          plan,
          status: "active",
          currentPeriodEnd: getPeriodEnd(sub),
        }
      })
      break
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as StripeSubscriptionLike
      const priceId = sub.items.data[0].price.id
      const plan = getPlan(priceId)

      const existing = await prisma.subscription.findUnique({
        where: { stripeCustomerId: sub.customer as string },
        select: { userId: true },
      })

      if (!existing) {
        console.warn("[stripe-webhook] subscription updated for unknown customer", sub.customer)
        break
      }

      await prisma.subscription.update({
        where: { stripeCustomerId: sub.customer as string },
        data: {
          plan,
          status: sub.status,
          stripePriceId: priceId,
          currentPeriodEnd: getPeriodEnd(sub),
        },
      })
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription

      const existing = await prisma.subscription.findUnique({
        where: { stripeCustomerId: sub.customer as string },
        select: { userId: true },
      })

      if (!existing) {
        console.warn("[stripe-webhook] subscription deleted for unknown customer", sub.customer)
        break
      }

      await prisma.subscription.update({
        where: { stripeCustomerId: sub.customer as string },
        data: { plan: "free", status: "active", stripeSubscriptionId: null, stripePriceId: null },
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
