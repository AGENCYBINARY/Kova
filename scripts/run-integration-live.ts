if (process.env.DATABASE_URL_UNPOOLED?.trim()) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED.trim()
}

void import('./integration-live-runner').catch((error) => {
  console.error(error)
  process.exit(1)
})
