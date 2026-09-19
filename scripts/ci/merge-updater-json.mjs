// No shebang (see next-beta-version.mjs). Invoked as `node scripts/ci/merge-updater-json.mjs`.
//
// Rebuilds the updater manifest (`latest.json`) for a release from the `.sig` assets every
// platform build uploaded, and writes it to ./latest.json for the workflow to attach.
//
// Why: tauri-action merges its platform entries into the release's `latest.json` per job — read the
// current file, add my platforms, upload with clobber. Three matrix jobs doing that concurrently is
// a race, and on 2026-09-12 (v0.1.64) the Linux job won it: the published manifest carried only the
// four Linux entries, so every Windows and macOS client failed with "None of the fallback platforms
// … were found in the response `platforms` object". This runs once, after ALL builds, and derives
// the manifest from what is actually attached to the release, so ordering can never matter.
//
// The signature for a platform is the content of `<asset>.sig`; the URL is the asset's API URL,
// exactly what tauri-action publishes. Entries for platforms whose `.sig` is missing fall back to
// whatever the existing manifest already had, so a partial rebuild can only add, never lose.

/** Platform keys per Tauri-emitted asset name. Arch is fixed to what the release matrix builds. */
const RULES = [
  { test: (n) => n.endsWith('.AppImage'), keys: ['linux-x86_64', 'linux-x86_64-appimage'] },
  { test: (n) => n.endsWith('.deb'), keys: ['linux-x86_64-deb'] },
  { test: (n) => n.endsWith('.rpm'), keys: ['linux-x86_64-rpm'] },
  { test: (n) => n.endsWith('.msi'), keys: ['windows-x86_64', 'windows-x86_64-msi'] },
  { test: (n) => n.endsWith('-setup.exe'), keys: ['windows-x86_64-nsis'] },
  { test: (n) => n.endsWith('.app.tar.gz'), keys: ['darwin-aarch64', 'darwin-aarch64-app'] },
]

/** @param {string} name asset name (without `.sig`) → platform keys, or [] when not an installer */
export function platformKeysFor(name) {
  for (const rule of RULES) if (rule.test(name)) return rule.keys
  return []
}

/**
 * @param {object} input
 * @param {string} input.version  release version without the leading `v`
 * @param {{ notes?: string, pub_date?: string, platforms?: Record<string, { signature: string, url: string }> } | null} input.existing
 *   the manifest currently attached to the release, if any
 * @param {Array<{ name: string, url: string }>} input.assets  every release asset (name + API url)
 * @param {Record<string, string>} input.signatures  `<asset name>.sig` → signature content
 * @param {string} input.now  ISO timestamp used when the existing manifest has no pub_date
 */
export function buildUpdaterManifest({ version, existing, assets, signatures, now }) {
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const platforms = { ...(existing?.platforms ?? {}) }
  const rebuilt = []
  for (const [sigName, signature] of Object.entries(signatures)) {
    if (!sigName.endsWith('.sig')) continue
    const assetName = sigName.slice(0, -'.sig'.length)
    const asset = byName.get(assetName)
    const keys = platformKeysFor(assetName)
    const trimmed = signature.trim()
    if (!asset || !keys.length || !trimmed) continue
    for (const key of keys) {
      platforms[key] = { signature: trimmed, url: asset.url }
      rebuilt.push(key)
    }
  }
  return {
    manifest: {
      version,
      notes: existing?.notes ?? '',
      pub_date: existing?.pub_date ?? now,
      platforms,
    },
    rebuilt: rebuilt.sort(),
  }
}

async function github(path, token, accept = 'application/vnd.github+json') {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response
}

async function main() {
  const { GITHUB_REPOSITORY: repo, RELEASE_ID: releaseId, GH_TOKEN: token, VERSION: version } = process.env
  for (const [name, value] of Object.entries({ repo, releaseId, token, version })) {
    if (!value) throw new Error(`missing ${name}`)
  }
  const assets = []
  for (let page = 1; ; page++) {
    const chunk = await (await github(`/repos/${repo}/releases/${releaseId}/assets?per_page=100&page=${page}`, token)).json()
    assets.push(...chunk.map((asset) => ({ name: asset.name, url: asset.url })))
    if (chunk.length < 100) break
  }
  // Draft releases have no public download URL; the asset API with the octet-stream accept header
  // redirects to a signed CDN URL, which fetch follows without re-sending the token.
  const download = async (asset) => (await github(`/repos/${repo}/releases/assets/${asset.url.split('/').pop()}`, token, 'application/octet-stream')).text()
  const signatures = {}
  for (const asset of assets) if (asset.name.endsWith('.sig')) signatures[asset.name] = await download(asset)
  let existing = null
  const current = assets.find((asset) => asset.name === 'latest.json')
  if (current) {
    try { existing = JSON.parse(await download(current)) } catch { existing = null }
  }
  const { manifest, rebuilt } = buildUpdaterManifest({ version, existing, assets, signatures, now: new Date().toISOString() })
  const { writeFileSync } = await import('node:fs')
  writeFileSync('latest.json', JSON.stringify(manifest, null, 2) + '\n')
  console.log(`latest.json: ${Object.keys(manifest.platforms).length} platforms (${rebuilt.length} rebuilt from .sig assets: ${rebuilt.join(', ') || 'none'})`)
  if (!rebuilt.length) throw new Error('no updater signatures found on the release; refusing to publish an empty manifest')
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
