#!/usr/bin/env node
// Next beta version, printed to stdout for the version-bump workflow.
//
// Betas are numbered `x.y.z-N`, NOT `x.y.z-beta.N`. Tauri's MSI bundler rejects a non-numeric
// pre-release identifier outright — "optional pre-release identifier in app version must be
// numeric-only" — so a `-beta.0` version builds every target except Windows and fails the release
// run after 25 minutes of compiling. Every beta before the `--preid beta` change used the numeric
// form; this restores it.
//
// From a stable version the patch advances (0.1.16 → 0.1.17-1), because a beta precedes the release
// it will become. From an existing beta the counter increments (0.1.17-3 → 0.1.17-4). A leftover
// non-numeric identifier restarts the counter on the same patch (0.1.17-beta.0 → 0.1.17-1).

/** @param {string} version a semver string from package.json */
export function nextBetaVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim())
  if (!match) throw new Error(`Unparseable version: ${version}`)
  const [, major, minor, patch, pre] = match
  const numericPre = pre !== undefined && /^\d+$/.test(pre)
  const counter = numericPre ? Number(pre) + 1 : 1
  // A beta already sits on the patch it is heading for; a stable release does not.
  const target = pre === undefined ? Number(patch) + 1 : Number(patch)
  return `${major}.${minor}.${target}-${counter}`
}

// Only read package.json when run as a script, so the export stays unit-testable.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  process.stdout.write(nextBetaVersion(pkg.version))
}
