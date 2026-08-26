import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('Downloads cloud navigation', () => {
  it('places Cloud immediately before the filter and removes it from the side rail', () => {
    const downloads = read('./+page.svelte')
    const sidebar = read('../../../lib/components/shell/Sidebar.svelte')
    const cloud = downloads.indexOf('href="/app/cloud"')
    const filter = downloads.indexOf('bind:value={filter}')

    expect(cloud).toBeGreaterThan(-1)
    expect(filter).toBeGreaterThan(cloud)
    expect(downloads.slice(cloud, filter)).not.toContain('{#if $isMobile}')
    expect(sidebar).not.toContain("href: '/app/cloud'")
    expect(sidebar).not.toContain("icons/cloud")
  })
})
