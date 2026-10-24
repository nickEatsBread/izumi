// Lucide icons for the Settings sections, one import per icon file. Kept apart from
// settings/sections.ts so the registry stays plain data: tests (no Svelte plugin) and the app-wide
// Back path import the registry, and only .svelte files import this.
import Play from '@lucide/svelte/icons/play'
import Captions from '@lucide/svelte/icons/captions'
import Languages from '@lucide/svelte/icons/languages'
import Library from '@lucide/svelte/icons/library'
import Rss from '@lucide/svelte/icons/rss'
import Download from '@lucide/svelte/icons/download'
import Palette from '@lucide/svelte/icons/palette'
import User from '@lucide/svelte/icons/user'
import RefreshCw from '@lucide/svelte/icons/refresh-cw'
import Globe from '@lucide/svelte/icons/globe'
import Info from '@lucide/svelte/icons/info'
import { settingsSection, type SettingsSectionIconName, type SettingsSectionId } from '$lib/settings/sections'

// Taken off an icon we import, never from the `@lucide/svelte` barrel (see settings/nav.ts).
type LucideIcon = typeof Play

export const SECTION_ICONS: Record<SettingsSectionIconName, LucideIcon> = {
  play: Play,
  captions: Captions,
  languages: Languages,
  library: Library,
  rss: Rss,
  download: Download,
  palette: Palette,
  user: User,
  'refresh-cw': RefreshCw,
  globe: Globe,
  info: Info,
}

export function sectionIcon(id: SettingsSectionId): LucideIcon {
  return SECTION_ICONS[settingsSection(id).iconName]
}
