import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateManifest, UPDATE_MANIFEST } from '../cloudflare-sync-worker/src/worker-self-deploy.js'

const repo = 'nickEatsBread/izumi'
const root = resolve(import.meta.dirname, '..')
export async function publishWorkerRelease({ directory = `${root}/artifacts/worker`, env = process.env, fetcher = fetch } = {}) {
  const manifestText = readFileSync(`${directory}/worker-update.json`, 'utf8')
  const manifest = validateManifest(JSON.parse(manifestText))
  const pkg = readFileSync(`${directory}/worker-package.json`)
  if (manifest.tag !== `worker-v${manifest.version}` || createHash('sha256').update(pkg).digest('hex') !== manifest.sha256) {
    throw new Error('The versioned Worker package is not verified.')
  }
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/main'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || !env.GH_TOKEN) {
    throw new Error('Publish stable Workers only from the main repository workflow.')
  }
  async function api(path, method = 'GET', body, missing = false) {
    const response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    })
    if (missing && response.status === 404) return null
    if (!response.ok) throw new Error(`Worker publication request failed (${response.status}).`)
    return response.json()
  }
  let release = await api(`/releases/tags/${manifest.tag}`, 'GET', undefined, true)
  if (!release) {
    const tag = await api(`/git/ref/tags/${manifest.tag}`, 'GET', undefined, true)
    if (tag && tag.object.sha !== env.GITHUB_SHA) throw new Error('The Worker tag already points to another commit.')
    release = await api('/releases', 'POST', {
      tag_name: manifest.tag, target_commitish: env.GITHUB_SHA, name: `Izumi Worker ${manifest.version}`,
      body: 'Stable private Worker update. Updates install automatically through the existing Worker and preserve its database and device connections.',
      draft: true, prerelease: false, make_latest: 'false',
    })
  }
  for (const [name, bytes] of [['worker-update.json', Buffer.from(manifestText)], ['worker-package.json', pkg]]) {
    const existing = release.assets.find(asset => asset.name === name)
    if (existing) {
      // Published assets are immutable. A runtime change requires a new Worker version.
      const response = await fetcher(`https://api.github.com/repos/${repo}/releases/assets/${existing.id}`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/octet-stream' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error('Existing release differs; bump the Worker version before publishing.')
    } else {
      if (!release.draft) throw new Error('Published Worker release is missing an asset.')
      const response = await fetcher(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${name}`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'Content-Type': 'application/json' },
        body: bytes, signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`Worker asset upload failed (${response.status}).`)
    }
  }
  if (release.draft) await api(`/releases/${release.id}`, 'PATCH', { draft: false, prerelease: false, make_latest: 'false' })
  // Verify public availability before advertising a release to private Workers.
  for (const name of ['worker-update.json', 'worker-package.json']) {
    const response = await fetcher(`https://github.com/${repo}/releases/download/${manifest.tag}/${name}`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('Release assets are not publicly available yet; retry publication.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.equals(name === 'worker-package.json' ? pkg : Buffer.from(manifestText))) throw new Error('Public release verification failed.')
  }
  const ref = await api('/git/ref/heads/worker-updates', 'GET', undefined, true)
  if (ref) {
    const file = await api('/contents/stable.json?ref=worker-updates')
    const previous = validateManifest(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')))
    const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }
    if (compare(previous.version, manifest.version) > 0) throw new Error('Refusing to move the stable feed backwards.')
    if (previous.version === manifest.version) {
      if (previous.sha256 !== manifest.sha256) throw new Error('Stable version checksum cannot change.')
      console.log(`Worker ${manifest.version} is already published.`)
      return
    }
  }
  const tree = await api('/git/trees', 'POST', { tree: [{ path: 'stable.json', mode: '100644', type: 'blob', content: manifestText }] })
  const commit = await api('/git/commits', 'POST', {
    message: `Publish stable Worker ${manifest.version}`, tree: tree.sha, parents: ref ? [ref.object.sha] : [],
  })
  if (ref) await api('/git/refs/heads/worker-updates', 'PATCH', { sha: commit.sha, force: false })
  else await api('/git/refs', 'POST', { ref: 'refs/heads/worker-updates', sha: commit.sha })
  console.log(`Published Worker ${manifest.version}: ${UPDATE_MANIFEST}`)

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await publishWorkerRelease({ directory: resolve(process.argv[2] || `${root}/artifacts/worker`) })
}
