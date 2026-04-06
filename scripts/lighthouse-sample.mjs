#!/usr/bin/env node
/**
 * Lighthouse sample for /chat and /settings (requires `npm run dev` on port 3000).
 * Writes HTML reports to ./.lighthouse/ (gitignored).
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..')
const outDir = join(root, '.lighthouse')

const base = process.env.LH_BASE_URL || 'http://127.0.0.1:3000'
const paths = ['/chat', '/settings']

async function run() {
  await mkdir(outDir, { recursive: true })
  for (const path of paths) {
    const url = `${base}${path}`
    const name = path.replace(/\//g, '-') || 'home'
    const out = join(outDir, `lighthouse${name}.html`)
    console.log(`Running Lighthouse: ${url} -> ${out}`)
    await new Promise((resolve, reject) => {
      const child = spawn(
        'npx',
        [
          '--yes',
          'lighthouse@11',
          url,
          '--only-categories=performance',
          '--output=html',
          `--output-path=${out}`,
          '--chrome-flags=--headless --no-sandbox',
        ],
        { stdio: 'inherit', shell: true, cwd: root }
      )
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`lighthouse exited ${code}`))))
    })
  }
  console.log('Done. Open .lighthouse/*.html in a browser.')
}

run().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
