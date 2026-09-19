#!/usr/bin/env node
// Desktop `tauri dev` must use the overlay in src-tauri/tauri.dev.conf.json.
// Without it the process keeps the release identifier, so a developer who also
// has the installed app shares that app's native data (and, on macOS, can
// share WKWebView storage). `tauri build` and mobile commands are left alone.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const overlay = join(root, 'src-tauri', 'tauri.dev.conf.json')
const args = process.argv.slice(2)
const hasConfig = args.some((arg) => arg === '--config' || arg.startsWith('--config='))
const isDesktopDev =
  args.includes('dev') && !args.includes('android') && !args.includes('ios')

if (isDesktopDev && !hasConfig) {
  args.push('--config', overlay)
}

const require = createRequire(import.meta.url)
const cli = require.resolve('@tauri-apps/cli/tauri.js')
const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
