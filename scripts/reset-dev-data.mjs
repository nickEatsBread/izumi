#!/usr/bin/env node
// Wipe the side-by-side DEV build's app storage, and only that.
//
// The installed release lives under the `com.nicho.izumi` identifier; `npm run dev:app` runs under
// the `com.nicho.izumi.dev` identifier from src-tauri/tauri.dev.conf.json. Those are different
// directory trees, so this script never has to be clever about which files belong to whom — it
// reads the dev identifier out of the overlay config and refuses to touch anything else.
//
// This is the offline equivalent of the in-app factory reset (Settings → About), which is already
// identifier-scoped in Rust (src-tauri/src/reset.rs). Use this one when the dev build won't boot.
import { readFileSync, rmSync, statSync, lstatSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const devConfigPath = join(root, 'src-tauri', 'tauri.dev.conf.json')
const releaseConfigPath = join(root, 'src-tauri', 'tauri.conf.json')

const devIdentifier = JSON.parse(readFileSync(devConfigPath, 'utf8')).identifier
const releaseIdentifier = JSON.parse(readFileSync(releaseConfigPath, 'utf8')).identifier

// Two independent guards. Either one alone is enough to make deleting the installed release's data
// impossible; both are here because a silent config typo is exactly how that would happen.
if (!devIdentifier || !devIdentifier.endsWith('.dev')) {
  console.error(`Refusing to reset: '${devIdentifier}' is not a .dev identifier (${devConfigPath}).`)
  process.exit(1)
}
if (devIdentifier === releaseIdentifier) {
  console.error(`Refusing to reset: the dev overlay does not override the release identifier '${releaseIdentifier}'.`)
  process.exit(1)
}

/** The same directories Tauri's path resolver hands the app, per platform. */
function appDirectories(id) {
  const home = homedir()
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [join(roaming, id), join(local, id)]
  }
  if (process.platform === 'darwin') {
    const library = join(home, 'Library')
    return [
      join(library, 'Application Support', id),
      join(library, 'Caches', id),
      join(library, 'Logs', id),
      join(library, 'WebKit', id),
      join(library, 'HTTPStorages', id),
    ]
  }
  const dataHome = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  const configHome = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const cacheHome = process.env.XDG_CACHE_HOME ?? join(home, '.cache')
  return [join(dataHome, id), join(configHome, id), join(cacheHome, id)]
}

const targets = appDirectories(devIdentifier)
// Final guard: every path must be a real directory literally named after the dev identifier, never
// a symlink/junction that could redirect the delete somewhere else.
for (const target of targets) {
  if (basename(target) !== devIdentifier) {
    console.error(`Refusing to reset '${target}': not named after the dev identifier.`)
    process.exit(1)
  }
  let stats
  try {
    stats = lstatSync(target)
  } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    console.error(`Refusing to reset '${target}': it is a link or not a directory.`)
    process.exit(1)
  }
}

let removed = 0
for (const target of targets) {
  let entries
  try {
    entries = readdirSync(target)
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`  (absent)   ${target}`)
      continue
    }
    throw error
  }
  // WebView2 child processes keep a handle on EBWebView\lockfile for a moment after their parent
  // exits, so a delete straight after closing the dev build reliably hits EBUSY. Retry on the same
  // schedule the in-app reset uses (src-tauri/src/reset.rs) instead of asking the user to guess.
  let lastError
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      lastError = undefined
      break
    } catch (error) {
      lastError = error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
  if (lastError) {
    console.error(`\nCould not remove '${target}': ${lastError.message}`)
    console.error('Close the dev build (and any leftover izumi.exe / msedgewebview2.exe children of it) and retry.')
    process.exit(1)
  }
  removed += 1
  console.log(`  removed    ${target}  (${entries.length} entries)`)
}

console.log(`\nDev data reset: ${removed} director${removed === 1 ? 'y' : 'ies'} cleared for ${devIdentifier}.`)
console.log(`The installed release's data under ${releaseIdentifier} was not touched.`)
// `statSync` is imported for the release-data sanity line below: prove, in the same run, that the
// release tree is still there rather than merely asserting it.
for (const target of appDirectories(releaseIdentifier)) {
  try {
    statSync(target)
    console.log(`  intact     ${target}`)
  } catch {
    /* A release directory that never existed is not this script's business. */
  }
}
