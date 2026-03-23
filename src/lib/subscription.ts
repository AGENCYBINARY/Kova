import { prisma } from "@/lib/db/prisma"
import { PLANS, PlanKey } from "@/lib/stripe"

export async function getOrCreateSubscription(userId: string) {
  let sub = await prisma.subscription.findUnique({ where: { userId } })
  if (!sub) {
    sub = await prisma.subscription.create({
      data: { userId, plan: "free", status: "active" },
    })
  }

  // Reset mensuel
  const now = new Date()
  const resetAt = new Date(sub.monthResetAt)
  if (
    now.getFullYear() > resetAt.getFullYear() ||
    now.getMonth() > resetAt.getMonth()
  ) {
    sub = await prisma.subscription.update({
      where: { userId },
      data: { requestsUsedThisMonth: 0, monthResetAt: now },
    })
  }

  return sub
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  plan: PlanKey
  used: number
  limit: number
}> {
  const sub = await getOrCreateSubscription(userId)
  const plan = (sub.plan as PlanKey) in PLANS ? (sub.plan as PlanKey) : "free"
  const limit = PLANS[plan].requests
  const used = sub.requestsUsedThisMonth
  return {
    allowed: used < limit,
    plan,
    used,
    limit,
  }
}

export async function incrementUsage(userId: string) {
  await prisma.subscription.update({
    where: { userId },
    data: { requestsUsedThisMonth: { increment: 1 } },
  })
}
