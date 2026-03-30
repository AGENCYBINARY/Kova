import { pruneExecutionLogs } from '@/lib/audit/retention'

async function main() {
  const result = await pruneExecutionLogs()
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
