import { prisma } from "@/lib/db/prisma"
import { PLANS, PlanKey } from "@/lib/stripe"

function resolvePlanKey(plan: string): PlanKey {
  return plan in PLANS ? (plan as PlanKey) : "free"
}

export function getMonthlyResetAnchor(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

export function needsMonthlyReset(date: Date, now = new Date()) {
  return date.getTime() < getMonthlyResetAnchor(now).getTime()
}

async function getOrCreateSubscriptionTx(
  tx: Pick<typeof prisma, "subscription">,
  userId: string
) {
  let sub = await tx.subscription.upsert({
    where: { userId },
    update: {},
    create: { userId, plan: "free", status: "active" },
  })

  const monthAnchor = getMonthlyResetAnchor()
  if (needsMonthlyReset(new Date(sub.monthResetAt), monthAnchor)) {
    await tx.subscription.updateMany({
      where: {
        userId,
        monthResetAt: {
          lt: monthAnchor,
        },
      },
      data: {
        requestsUsedThisMonth: 0,
        monthResetAt: monthAnchor,
      },
    })

    const next = await tx.subscription.findUnique({
      where: { userId },
    })

    if (next) {
      sub = next
    }
  }

  return sub
}

export async function getOrCreateSubscription(userId: string) {
  return getOrCreateSubscriptionTx(prisma, userId)
}

async function readSubscriptionForQuota(userId: string) {
  let sub = await prisma.subscription.findUnique({
    where: { userId },
  })

  if (!sub) {
    sub = await prisma.subscription.create({
      data: { userId, plan: "free", status: "active" },
    })
  }

  const monthAnchor = getMonthlyResetAnchor()
  if (needsMonthlyReset(new Date(sub.monthResetAt), monthAnchor)) {
    await prisma.subscription.updateMany({
      where: {
        userId,
        monthResetAt: {
          lt: monthAnchor,
        },
      },
      data: {
        requestsUsedThisMonth: 0,
        monthResetAt: monthAnchor,
      },
    })

    const next = await prisma.subscription.findUnique({
      where: { userId },
    })

    if (next) {
      sub = next
    }
  }

  return sub
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  plan: PlanKey
  used: number
  limit: number
}> {
  const sub = await readSubscriptionForQuota(userId)
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
      const current = await tx.subscription.findUnique({
        where: { userId },
        select: {
          requestsUsedThisMonth: true,
        },
      })

      return {
        allowed: false,
        plan,
        used: current?.requestsUsedThisMonth ?? sub.requestsUsedThisMonth,
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
  await prisma.$transaction(async (tx) => {
    await getOrCreateSubscriptionTx(tx, userId)

    await tx.subscription.updateMany({
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
  })
}
