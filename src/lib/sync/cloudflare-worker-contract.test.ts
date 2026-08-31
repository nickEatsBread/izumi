import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const worker = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/src/index.js', import.meta.url)), 'utf8')
const resolver = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/src/resolver.js', import.meta.url)), 'utf8')
const config = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/wrangler.jsonc', import.meta.url)), 'utf8')
const manifest = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/package.json', import.meta.url)), 'utf8')
const companionMigration = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/migrations/0002_companion_wake.sql', import.meta.url)), 'utf8')
const resolverMigration = readFileSync(fileURLToPath(new URL('../../../cloudflare-sync-worker/migrations/0003_cloud_resolver.sql', import.meta.url)), 'utf8')
const resolverGenerator = fileURLToPath(new URL('../../../scripts/generate-cloudflare-resolver-core.mjs', import.meta.url))

describe('Cloudflare Worker deployment contract', () => {
  it('uses an auto-provisioned D1 binding and deploy-time migration', () => {
    expect(config).toContain('"binding": "DB"')
    expect(manifest).toContain('wrangler d1 migrations apply DB --remote')
  })

  it('requires a one-time bootstrap secret without Cloudflare credentials', () => {
    expect(worker).toContain("request.headers.get('x-izumi-bootstrap')")
    expect(worker).not.toMatch(/cloudflare[_ -]?api[_ -]?(key|token)/i)
  })

  it('bounds records, devices, and invitations', () => {
    expect(worker).toContain('MAX_BODY_BYTES = 512 * 1024')
    expect(worker).toContain('MAX_DEVICES = 32')
    expect(worker).toContain('MAX_INVITES = 16')
    expect(worker).toContain('INVITE_TTL_MS = 10 * 60 * 1000')
  })

  it('keeps private TV waking inside the existing Worker', () => {
    expect(worker).toContain("features: ['companion-wake-v1', 'web-push-v1', 'cloud-resolver-v1']")
    expect(worker).toContain("import webpush from 'web-push'")
    expect(worker).toContain('companion_push_subscriptions')
    expect(worker).not.toMatch(/firebase|izumi.*wake.*(?:service|relay)/i)
    expect(companionMigration).toContain('CREATE TABLE companion_pairings')
    expect(companionMigration).toContain('CREATE TABLE companion_requests')
    expect(companionMigration).toContain('CREATE TABLE companion_push_subscriptions')
  })

  it('intertwines opt-in source resolving without adding a media proxy', () => {
    expect(worker).toContain("'/v1/resolver/profile'")
    expect(worker).toContain('resolveForTv')
    expect(worker).toContain('resolver_profiles')
    expect(resolverMigration).toContain('CREATE TABLE resolver_profiles')
    expect(resolverMigration).toContain('last_resolve_at')
    expect(worker).not.toMatch(/media[_ -]?proxy|stream[_ -]?relay/i)
  })

  it('ships a current, self-contained copy of the shared resolver core', () => {
    expect(resolver).toContain("from './generated/resolver-core/resolver-core.ts'")
    expect(resolver).not.toMatch(/from\s+['"]\.\.\//)
    const result = spawnSync(process.execPath, [resolverGenerator, '--check'], { encoding: 'utf8' })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })
})
