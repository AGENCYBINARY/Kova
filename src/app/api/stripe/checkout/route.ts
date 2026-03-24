import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/db/prisma"
import { getStripe, PlanKey } from "@/lib/stripe"

// Read price IDs lazily at request time (never at module load)
function getPriceId(plan: Exclude<PlanKey, "free">): string | undefined {
  if (plan === "plus") return process.env.STRIPE_PRICE_PLUS
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO
  return undefined
}

export async function POST(req: Request) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const plan = body.plan as string

    if (plan !== "plus" && plan !== "pro")
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 })

    const validPlan = plan as Exclude<PlanKey, "free">
    const priceId = getPriceId(validPlan)
    if (!priceId) {
      console.error(`[checkout] priceId missing for plan: ${validPlan}`)
      return NextResponse.json({ error: "Price not configured" }, { status: 500 })
    }

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    let sub = await prisma.subscription.findUnique({ where: { userId: user.id } })
    let customerId = sub?.stripeCustomerId

    const stripe = getStripe()

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://kova.agencybinary.fr"

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: appUrl + "/dashboard?upgraded=1",
      cancel_url: appUrl + "/settings",
      metadata: { userId: user.id, plan: validPlan },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("[checkout] Stripe error:", err)
    const message = err instanceof Error ? err.message : "Unexpected error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
