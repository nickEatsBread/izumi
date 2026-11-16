import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('handheld shortcuts and sign-in', () => {
  it('View opens Search from the drawer navigation, never over a dialog or a playing video', () => {
    const sidebar = read('./Sidebar.svelte')
    const drawer = sidebar.slice(sidebar.indexOf('if (!drawerNav) return'))
    expect(drawer).toContain("if (!pressed || name !== 'select' || get(playing) || get(startupAnimationPlaying)) return")
    expect(drawer).toContain("void goto('/app/search')")
    expect(drawer).toContain('stopView()')
  })

  it("shows a source sign-in code's page as a QR for a phone to scan", () => {
    const settings = read('../settings/ExtensionServiceSettings.svelte')
    expect(settings).toContain('<QrCode value={notice.action.url} label="Sign-in page" />')
    // Only a web address becomes a code to scan.
    expect(settings).toContain('.test(notice.action.url)}')
  })
})
