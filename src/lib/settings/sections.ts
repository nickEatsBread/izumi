// The Settings taxonomy (spec §3.1): 11 sections in 5 groups, each split into subcategories. One
// source for the rail and phone index (SettingsNav), the route table (hierarchy.ts), search metadata
// (search.ts) and old-route redirects (legacy-routes.ts). Plain data with no imports: tests (no Svelte
// plugin) and the app-wide Back path load it. Icons live in components/settings/section-icons.ts.

export type SettingsGroupId = 'watch' | 'library' | 'look' | 'you' | 'system'
export type SettingsSectionId =
  | 'playback' | 'subtitles' | 'languages'
  | 'library' | 'sources' | 'downloads'
  | 'appearance'
  | 'accounts' | 'devices'
  | 'network' | 'about'
/** Lucide icon file name (`@lucide/svelte/icons/<name>`), resolved by section-icons.ts. */
export type SettingsSectionIconName =
  | 'play' | 'captions' | 'languages' | 'library' | 'rss' | 'download'
  | 'palette' | 'user' | 'refresh-cw' | 'globe' | 'info'

export interface SettingsSubcategoryDef { id: string; title: string; advanced?: true }
export interface SettingsSectionDef {
  id: SettingsSectionId
  group: SettingsGroupId
  title: string
  /** Static one-line phone index subtitle (no live values). */
  subtitle: string
  href: `/app/settings/${string}`
  iconName: SettingsSectionIconName
  subcategories: readonly SettingsSubcategoryDef[]
}
export interface SettingsSubPageDef { section: SettingsSectionId; title: string }

/** Svelte context key: SettingsSection hands its SettingsSectionDef to its SettingsSubcategory blocks. */
export const SETTINGS_SECTION_CONTEXT = 'izumi-settings-section'
/** DOM CustomEvent that unfolds the `[data-settings-subcategory]` element it is dispatched on. */
export const SUBCATEGORY_OPEN_EVENT = 'izumi-subcategory-open'

const ROOT = '/app/settings'
const ADVANCED: SettingsSubcategoryDef = { id: 'advanced', title: 'Advanced', advanced: true }

export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: string }[] = [
  { id: 'watch', label: 'Watch' },
  { id: 'library', label: 'Library' },
  { id: 'look', label: 'Look' },
  { id: 'you', label: 'You' },
  { id: 'system', label: 'System' },
]

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: 'playback', group: 'watch', title: 'Playback', subtitle: 'Autoplay, skipping and the player',
    href: '/app/settings/playback', iconName: 'play',
    subcategories: [
      { id: 'up-next', title: 'Up next and autoplay' },
      { id: 'skipping', title: 'Skipping' },
      { id: 'seeking', title: 'Seeking and scrubbing' },
      { id: 'player-window', title: 'Player window' },
      { id: 'quality', title: 'Quality and sources' },
      { id: 'controls', title: 'Controls' },
      ADVANCED,
    ],
  },
  {
    id: 'subtitles', group: 'watch', title: 'Subtitles', subtitle: 'Style, saved styles and providers',
    href: '/app/settings/subtitles', iconName: 'captions',
    subcategories: [
      { id: 'appearance', title: 'Appearance' },
      { id: 'styles', title: 'Saved styles' },
      { id: 'providers', title: 'Providers' },
      ADVANCED,
    ],
  },
  {
    id: 'languages', group: 'watch', title: 'Languages', subtitle: 'App, audio, subtitle and source languages',
    href: '/app/settings/languages', iconName: 'languages',
    subcategories: [
      { id: 'app', title: 'App and titles' },
      { id: 'playback', title: 'Audio and subtitles' },
      { id: 'sources', title: 'Sources and sub/dub' },
      { id: 'downloads', title: 'Downloads' },
    ],
  },
  {
    id: 'library', group: 'library', title: 'Home and library', subtitle: 'Platforms, Home, layouts and history',
    href: '/app/settings/library', iconName: 'library',
    subcategories: [
      { id: 'home', title: 'Platforms and Home' },
      { id: 'layouts', title: 'Layouts' },
      { id: 'ratings', title: 'Ratings and spoilers' },
      { id: 'notifications', title: 'Notifications' },
      { id: 'history', title: 'History' },
      { id: 'scenes', title: 'Scene bookmarks' },
      { id: 'features', title: 'Optional features' },
      ADVANCED,
    ],
  },
  {
    id: 'sources', group: 'library', title: 'Sources and store', subtitle: 'Add, manage and order sources',
    href: '/app/settings/sources', iconName: 'rss',
    subcategories: [
      { id: 'my-sources', title: 'My sources' },
      { id: 'store', title: 'Store' },
      { id: 'debrid', title: 'Torrent and debrid' },
      { id: 'discussion', title: 'Discussion' },
      { id: 'priority', title: 'Priority' },
      ADVANCED,
    ],
  },
  {
    id: 'downloads', group: 'library', title: 'Downloads and storage', subtitle: 'Offline library, folder and caches',
    href: '/app/settings/downloads', iconName: 'download',
    subcategories: [
      { id: 'offline', title: 'Offline mode' },
      { id: 'folder', title: 'Folder and automatic downloads' },
      { id: 'storage', title: 'Storage and caches' },
      ADVANCED,
    ],
  },
  {
    id: 'appearance', group: 'look', title: 'Appearance', subtitle: 'Theme, accessibility and navigation',
    href: '/app/settings/appearance', iconName: 'palette',
    subcategories: [
      { id: 'theme', title: 'Theme' },
      { id: 'accessibility', title: 'Accessibility' },
      { id: 'navigation', title: 'Navigation' },
      { id: 'tv', title: 'TV layout' },
      ADVANCED,
    ],
  },
  {
    id: 'accounts', group: 'you', title: 'Accounts and profiles', subtitle: 'Trackers, keys and household profiles',
    href: '/app/settings/accounts', iconName: 'user',
    subcategories: [
      { id: 'trackers', title: 'Trackers and lists' },
      { id: 'keys', title: 'Keys' },
      { id: 'profiles', title: 'Profiles' },
      { id: 'content', title: 'Content' },
    ],
  },
  {
    id: 'devices', group: 'you', title: 'Devices and backup', subtitle: 'Device sync, TV connections and backups',
    href: '/app/settings/devices', iconName: 'refresh-cw',
    subcategories: [
      { id: 'devices', title: 'Devices' },
      { id: 'tv', title: 'TV connections' },
      { id: 'backup', title: 'Backup and restore' },
      { id: 'transfer', title: 'Transfer' },
      ADVANCED,
    ],
  },
  {
    id: 'network', group: 'system', title: 'Network and P2P', subtitle: 'P2P limits, DNS and VPN',
    href: '/app/settings/network', iconName: 'globe',
    subcategories: [
      { id: 'p2p', title: 'P2P status and limits' },
      ADVANCED,
    ],
  },
  {
    id: 'about', group: 'system', title: 'About', subtitle: 'Version, changelog and licences',
    href: '/app/settings/about', iconName: 'info',
    subcategories: [
      { id: 'version', title: 'Version and updates' },
      { id: 'changelog', title: 'Changelog' },
      { id: 'licenses', title: 'Licenses' },
      { id: 'reset', title: 'Reset' },
      ADVANCED,
    ],
  },
]

/** Sub-pages that stay routes (list editors and studios), below /app/settings: level 2 under their
 *  section, titled for the phone header. */
export const SETTINGS_SUB_PAGES: ReadonlyMap<string, SettingsSubPageDef> = new Map<string, SettingsSubPageDef>([
  ['sources/manage', { section: 'sources', title: 'Manage sources' }],
  ['sources/priority', { section: 'sources', title: 'Source priority' }],
  ['store', { section: 'sources', title: 'Store' }],
  ['library/home', { section: 'library', title: 'Customize Home' }],
  ['library/collections', { section: 'library', title: 'Collections and covers' }],
  ['themes', { section: 'appearance', title: 'Themes' }],
  ['theme-studio', { section: 'appearance', title: 'Theme Studio' }],
  ['about/changelog', { section: 'about', title: 'Changelog' }],
  ['about/license-information', { section: 'about', title: 'License information' }],
])

/** Old routes below /app/settings and where they live now (`<route>[#<subcategory>]`). An old page
 *  keeps rendering, answering as its target (hierarchy.ts), until its content moves; then its route
 *  redirects (legacy-routes.ts). */
export const LEGACY_SETTINGS_ROUTES: ReadonlyMap<string, string> = new Map<string, string>([
  ['player', 'playback'],
  ['hotkeys', 'playback#controls'],
  ['catalog', 'library#home'],
  ['catalog/home', 'library/home'],
  ['catalog/collections', 'library/collections'],
  ['extensions', 'sources/manage'],
  ['storage', 'downloads#storage'],
  ['profiles', 'accounts#profiles'],
  ['interface', 'appearance'],
  ['navigation', 'appearance#navigation'],
  ['history', 'library#history'],
  ['scenes', 'library#scenes'],
  ['sync', 'devices#devices'],
  ['backup', 'devices#backup'],
  ['changelog', 'about/changelog'],
])

export function settingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((section) => section.id === id)!
}

const under = (rest: string, base: string) => rest === base || rest.startsWith(`${base}/`)

/** The section a pathname belongs to (section page or one of its sub-pages); null outside. */
export function sectionForPath(pathname: string): SettingsSectionDef | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '')
  if (!path.startsWith(`${ROOT}/`)) return null
  const rest = path.slice(ROOT.length + 1)
  for (const [base, page] of SETTINGS_SUB_PAGES) if (under(rest, base)) return settingsSection(page.section)
  return SETTINGS_SECTIONS.find((section) => under(rest, section.id)) ?? null
}

export function subcategoryDef(section: SettingsSectionId, id: string): SettingsSubcategoryDef | undefined {
  return settingsSection(section).subcategories.find((subcategory) => subcategory.id === id)
}
