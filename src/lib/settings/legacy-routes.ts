// Where old Settings URLs live now (spec §3.2). Each old route's +page.ts throws
// `redirect(307, legacySettingsRedirect(url))` once its content has moved; surviving routes (Sources,
// Accounts) redirect only when their URL carries an old tab or section.
import { SETTINGS_SEARCH_INDEX, SETTING_PARAM } from './search'
import { LEGACY_SETTINGS_ROUTES, settingsSection } from './sections'

const ROOT = '/app/settings'

/** Routes whose old query named a tab or section that now has its own place: the parameter, and where
 *  each value lives (`<route>[#<subcategory>]`). The parameter is dropped from the redirect. */
const QUERY_ROUTES = new Map<string, { param: string; targets: ReadonlyMap<string, string> }>([
  ['sources', { param: 'tab', targets: new Map([['manage', 'sources/manage'], ['playback', 'playback#quality'], ['ordering', 'sources#priority']]) }],
  ['accounts', { param: 'section', targets: new Map([['connections', 'accounts#trackers'], ['libraries', 'accounts#trackers'], ['behaviour', 'accounts#trackers']]) }],
  ['sync', { param: 'section', targets: new Map([['tv', 'devices#tv']]) }],
])

/**
 * Where an old Settings URL lives now; null when it needs no redirect (a current route, or a
 * surviving route without an old query value). A `?setting=` key the search index knows decides the
 * section, so a row that moved still lands on itself (revealSetting scrolls to it, so no anchor).
 * Every other parameter (`setting`, `settingFallback`, `offer`, `provider`, …) is kept.
 */
export function legacySettingsRedirect(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.startsWith(`${ROOT}/`)) return null
  const rest = path.slice(ROOT.length + 1)
  const params = new URLSearchParams(url.searchParams)
  const query = QUERY_ROUTES.get(rest)
  const value = query ? params.get(query.param) : null
  let target = (value && query?.targets.get(value)) || LEGACY_SETTINGS_ROUTES.get(rest)
  if (!target) return null
  if (query) params.delete(query.param)
  const key = params.get(SETTING_PARAM)
  const entry = key ? SETTINGS_SEARCH_INDEX.find((item) => item.key === key) : undefined
  if (entry) target = settingsSection(entry.section).href.slice(ROOT.length + 1)
  const [route, hash] = target.split('#')
  const search = params.toString()
  return `${ROOT}/${route}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`
}
