import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/app-context"
import { getErrorStatus } from "@/lib/http/errors"
import { checkQuota } from "@/lib/subscription"
import { PLANS } from "@/lib/stripe"

export async function GET() {
  try {
    const { dbUserId } = await getAppContext()
    const quota = await checkQuota(dbUserId)
    return NextResponse.json({ ...quota, plans: PLANS })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
