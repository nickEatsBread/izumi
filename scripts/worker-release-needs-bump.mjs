import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Published Worker release assets are immutable: the same version may never be re-published with
// different content. This probe tells the publish workflow whether the packaged Worker collides
// with an already-published release of the same version — the signal to bump automatically
// instead of failing after the merge has already landed.

const repo = 'nickEatsBread/izumi'
const root = resolve(import.meta.dirname, '..')

export async function workerReleaseNeedsBump({ directory = `${root}/artifacts/worker`, env = process.env, fetcher = fetch } = {}) {
  const manifest = JSON.parse(readFileSync(`${directory}/worker-update.json`, 'utf8'))
  if (typeof manifest.tag !== 'string' || typeof manifest.sha256 !== 'string') {
    throw new Error('Package the Worker release before probing for a version collision.')
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(env.GH_TOKEN ? { Authorization: `Bearer ${env.GH_TOKEN}` } : {}),
  }
  const release = await fetcher(`https://api.github.com/repos/${repo}/releases/tags/${manifest.tag}`,
    { headers, signal: AbortSignal.timeout(30_000) })
  if (release.status === 404) return false
  if (!release.ok) throw new Error(`Worker release lookup failed (${release.status}).`)
  const asset = (await release.json()).assets?.find((entry) => entry.name === 'worker-update.json')
  // A draft crashed before uploading its manifest: publication resumes it, no new version needed.
  if (!asset) return false
  const published = await fetcher(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
    { headers: { ...headers, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30_000) })
  if (!published.ok) throw new Error(`Worker release manifest download failed (${published.status}).`)
  const value = JSON.parse(Buffer.from(await published.arrayBuffer()).toString('utf8'))
  return value.sha256 !== manifest.sha256
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const bump = await workerReleaseNeedsBump({ directory: process.argv[2] ? resolve(process.argv[2]) : undefined })
    console.error(bump
      ? 'The packaged Worker differs from the published release of the same version.'
      : 'No published Worker release collides with this version.')
    process.exit(bump ? 0 : 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
