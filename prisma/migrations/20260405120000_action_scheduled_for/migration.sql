-- Deferred Gmail sends after approval (cron picks up status=scheduled + scheduledFor)
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Action_status_scheduledFor_idx" ON "Action"("status", "scheduledFor");
