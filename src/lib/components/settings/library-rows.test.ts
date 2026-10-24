import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const descriptions = (source: string) => [...source.matchAll(/\sdescription="([^"]*)"/g)].map((match) => match[1])

describe('HistorySettings', () => {
  const source = read('./HistorySettings.svelte')

  it('renders its rows with the row recipes and stable keys', () => {
    for (const key of ['save-watch-history-on-this-device', 'incognito-mode', 'import-export-history', 'watched-history']) {
      expect(source).toContain(`settingKey="${key}"`)
    }
    expect(source).toContain('onActivate={toggleSaving}')
    expect(source).toContain('onActivate={toggleIncognito}')
    expect(source.match(/interactive=\{false\}/g)).toHaveLength(2)
    expect(source).not.toContain('<Toggle')
  })

  it('keeps the two-press clear and the per-title remove', () => {
    expect(source).toContain("confirmClear ? 'Click again to clear all' : 'Clear all'")
    expect(source).toContain('setTimeout(() => (confirmClear = false), 4000)')
    expect(source).toContain('onclick={() => forgetMedia(e.media.id)}')
  })

  it('keeps import, both exports and the For You reset', () => {
    expect(source).toContain('onclick={doExportJson}')
    expect(source).toContain('onclick={doExportXml}')
    expect(source).toContain('onchange={onImportFile}')
    expect(source).toContain('dismissedForYouIds.set([])')
  })

  it('keeps every description to one line', () => {
    for (const text of descriptions(source)) expect(text.length, text).toBeLessThanOrEqual(80)
  })
})

describe('SceneBookmarkSettings', () => {
  const source = read('./SceneBookmarkSettings.svelte')

  it('puts the feature switch beside the saved scenes', () => {
    expect(source).toContain('settingKey="scene-bookmarks"')
    expect(source).toContain('settingKey="saved-scenes"')
    expect(source).toContain('$sceneBookmarksEnabled = !$sceneBookmarksEnabled')
    expect(source.indexOf('settingKey="scene-bookmarks"')).toBeLessThan(source.indexOf('settingKey="saved-scenes"'))
  })

  it('keeps resume, notes, remove and the two-press clear', () => {
    expect(source).toContain('{ startSeconds: scene.position, autoplay: true }')
    expect(source).toContain('updateSceneBookmark(scene.id, { note: event.currentTarget.value })')
    expect(source).toContain('onclick={() => removeSceneBookmark(scene.id)}')
    expect(source).toContain("confirmClear ? 'Confirm clear' : 'Clear all'")
  })

  it('keeps every description to one line', () => {
    for (const text of descriptions(source)) expect(text.length, text).toBeLessThanOrEqual(80)
  })
})
