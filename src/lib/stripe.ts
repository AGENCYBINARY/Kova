import Stripe from "stripe"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
    _stripe = new Stripe(key, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    })
  }
  return _stripe
}

// Keep named export for backwards compat (lazy)
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export const PLANS = {
  free: {
    name: "Gratuit",
    requests: 50,
    priceId: null,
    price: 0,
  },
  plus: {
    name: "Plus",
    requests: 200,
    priceId: process.env.STRIPE_PRICE_PLUS,
    price: 10,
  },
  pro: {
    name: "Pro",
    requests: 500,
    priceId: process.env.STRIPE_PRICE_PRO,
    price: 25,
  },
} as const

export type PlanKey = keyof typeof PLANS
