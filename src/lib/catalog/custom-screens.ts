// Create, rename and delete custom screens. A screen's Home layout lives in `catalogHomeLayouts` under its
// screen id and its theme in `screenThemes`; deleting it removes both, and the blocks only it used.
import { get } from 'svelte/store'
import { pruneHomeBlocks } from '$lib/home/block-rows'
import {
  CUSTOM_SCREEN_LIMIT, catalogDefaultProvider, catalogProviders, catalogScreen, catalogScreens, customScreenId,
  customScreens, normalizeCustomScreens, selectCatalogScreen, type CustomScreenId,
} from '$lib/settings/catalog'
import { setScreenTheme, type ScreenThemeRef } from '$lib/themes/screen-theme'
import { catalogHomeLayouts } from './home-layout'

const named = (name: string): string => {
  if (!name.trim()) throw new Error('Give this screen a name.')
  return name
}

export function createCustomScreen(name: string, theme: ScreenThemeRef | null = null): CustomScreenId {
  const current = get(customScreens)
  if (current.length >= CUSTOM_SCREEN_LIMIT) throw new Error(`You can make up to ${CUSTOM_SCREEN_LIMIT} screens.`)
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const next = normalizeCustomScreens([...current, { id, name: named(name) }])
  const screen = customScreenId(id)
  // A new screen opens on the banner and Continue Watching; every other section starts off.
  catalogHomeLayouts.update((layouts) => ({ ...layouts, [screen]: { order: ['hero', 'continue'], disabled: [] } }))
  if (theme) setScreenTheme(screen, theme)
  customScreens.set(next)
  selectCatalogScreen(screen)
  return screen
}

export function renameCustomScreen(screen: CustomScreenId, name: string): void {
  named(name)
  customScreens.update((all) => normalizeCustomScreens(all.map((item) => (customScreenId(item.id) === screen ? { ...item, name } : item))))
}

export function deleteCustomScreen(screen: CustomScreenId): void {
  customScreens.update((all) => all.filter((item) => customScreenId(item.id) !== screen))
  catalogHomeLayouts.update((layouts) => {
    const next = { ...layouts }
    delete next[screen]
    return next
  })
  setScreenTheme(screen, null)
  pruneHomeBlocks()
  if (get(catalogDefaultProvider) === screen) catalogDefaultProvider.set('adaptive')
  if (get(catalogScreen) === screen) selectCatalogScreen(catalogScreens(get(catalogProviders), get(customScreens))[0])
}
