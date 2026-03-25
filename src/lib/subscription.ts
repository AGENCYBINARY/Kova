import { prisma } from "@/lib/db/prisma"
import { PLANS, PlanKey } from "@/lib/stripe"

function resolvePlanKey(plan: string): PlanKey {
  return plan in PLANS ? (plan as PlanKey) : "free"
}

function needsMonthlyReset(date: Date) {
  const now = new Date()
  return now.getFullYear() > date.getFullYear() || now.getMonth() > date.getMonth()
}

async function getOrCreateSubscriptionTx(
  tx: Pick<typeof prisma, "subscription">,
  userId: string
) {
  let sub = await tx.subscription.findUnique({ where: { userId } })
  if (!sub) {
    sub = await tx.subscription.create({
      data: { userId, plan: "free", status: "active" },
    })
  }

  const resetAt = new Date(sub.monthResetAt)
  if (needsMonthlyReset(resetAt)) {
    sub = await tx.subscription.update({
      where: { userId },
      data: { requestsUsedThisMonth: 0, monthResetAt: new Date() },
    })
  }

  return sub
}

export async function getOrCreateSubscription(userId: string) {
  return getOrCreateSubscriptionTx(prisma, userId)
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  plan: PlanKey
  used: number
  limit: number
}> {
  const sub = await getOrCreateSubscription(userId)
  const plan = resolvePlanKey(sub.plan)
  const limit = PLANS[plan].requests
  const used = sub.requestsUsedThisMonth
  return {
    allowed: used < limit,
    plan,
    used,
    limit,
  }
}

export async function consumeQuota(userId: string): Promise<{
  allowed: boolean
  plan: PlanKey
  used: number
  limit: number
}> {
  return prisma.$transaction(async (tx) => {
    const sub = await getOrCreateSubscriptionTx(tx, userId)
    const plan = resolvePlanKey(sub.plan)
    const limit = PLANS[plan].requests

    const updated = await tx.subscription.updateMany({
      where: {
        userId,
        requestsUsedThisMonth: {
          lt: limit,
        },
      },
      data: {
        requestsUsedThisMonth: {
          increment: 1,
        },
      },
    })

    if (updated.count === 0) {
      return {
        allowed: false,
        plan,
        used: sub.requestsUsedThisMonth,
        limit,
      }
    }

    const next = await tx.subscription.findUnique({
      where: { userId },
      select: {
        requestsUsedThisMonth: true,
      },
    })

    return {
      allowed: true,
      plan,
      used: next?.requestsUsedThisMonth ?? sub.requestsUsedThisMonth + 1,
      limit,
    }
  })
}

export async function refundQuota(userId: string) {
  await prisma.subscription.updateMany({
    where: {
      userId,
      requestsUsedThisMonth: {
        gt: 0,
      },
    },
    data: {
      requestsUsedThisMonth: {
        decrement: 1,
      },
    },
  })
}
