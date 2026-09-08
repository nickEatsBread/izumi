import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Patch-bump every source location that carries the Worker version, in one step, so a release can
// never ship with the copies disagreeing: the Worker's own package.json + lockfile, the VERSION
// string it reports from /v1/status, and the client constant used to offer deployed-Worker
// updates. The generated direct-upload bundle embeds the version too, so the caller (CLI below or
// the publish workflow) must regenerate it afterwards.

const root = resolve(import.meta.dirname, '..')

export function bumpedWorkerSources({ packageJson, packageLock, indexJs, cloudflareTs }) {
  const version = JSON.parse(packageJson).version
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('The Worker version must be X.Y.Z.')
  if (!indexJs.includes(`const VERSION = '${version}'`)) {
    throw new Error('The Worker VERSION constant does not match its package.json.')
  }
  if (!cloudflareTs.includes(`export const CLOUDFLARE_WORKER_VERSION = '${version}'`)) {
    throw new Error('The client CLOUDFLARE_WORKER_VERSION constant does not match the Worker package.json.')
  }
  const [major, minor, patch] = version.split('.').map(Number)
  const next = `${major}.${minor}.${patch + 1}`
  const lock = JSON.parse(packageLock)
  lock.version = next
  if (lock.packages?.['']) lock.packages[''].version = next
  return {
    version,
    next,
    packageJson: packageJson.replace(`"version": "${version}"`, `"version": "${next}"`),
    packageLock: JSON.stringify(lock, null, 2) + '\n',
    indexJs: indexJs.replace(`const VERSION = '${version}'`, `const VERSION = '${next}'`),
    cloudflareTs: cloudflareTs.replace(
      `export const CLOUDFLARE_WORKER_VERSION = '${version}'`,
      `export const CLOUDFLARE_WORKER_VERSION = '${next}'`,
    ),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = {
    packageJson: join(root, 'cloudflare-sync-worker/package.json'),
    packageLock: join(root, 'cloudflare-sync-worker/package-lock.json'),
    indexJs: join(root, 'cloudflare-sync-worker/src/index.js'),
    cloudflareTs: join(root, 'src/lib/sync/cloudflare.ts'),
  }
  const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]))
  const bumped = bumpedWorkerSources(sources)
  for (const key of Object.keys(paths)) writeFileSync(paths[key], bumped[key])
  const bundle = spawnSync(process.execPath, [join(root, 'scripts/build-cloudflare-direct-upload.mjs')], { stdio: ['ignore', 2, 2] })
  if (bundle.status !== 0) throw new Error('Regenerating the Worker bundle after the version bump failed.')
  console.error(`Bumped the Worker from ${bumped.version} to ${bumped.next}.`)
  // Stdout carries only the new version so workflows can capture it.
  console.log(bumped.next)
}
