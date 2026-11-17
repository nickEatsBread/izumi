// The icons a theme screen's navigation entry may name (API 8 `layout.screens[].icon`). `grid` without one.
import Star from '@lucide/svelte/icons/star'
import Heart from '@lucide/svelte/icons/heart'
import Flame from '@lucide/svelte/icons/flame'
import Sparkles from '@lucide/svelte/icons/sparkles'
import Trophy from '@lucide/svelte/icons/trophy'
import Compass from '@lucide/svelte/icons/compass'
import Clock from '@lucide/svelte/icons/clock'
import Calendar from '@lucide/svelte/icons/calendar'
import Tv from '@lucide/svelte/icons/tv'
import Film from '@lucide/svelte/icons/film'
import LayoutGrid from '@lucide/svelte/icons/layout-grid'
import List from '@lucide/svelte/icons/list'
import type { ThemeLayoutScreen, ThemeScreenIcon } from '$lib/themes/presentation'

export const SCREEN_ICONS: Record<ThemeScreenIcon, typeof Star> = {
  star: Star, heart: Heart, flame: Flame, sparkles: Sparkles, trophy: Trophy, compass: Compass,
  clock: Clock, calendar: Calendar, tv: Tv, film: Film, grid: LayoutGrid, list: List,
}

/** A theme screen as a navigation destination: `data-dest="screen"`, named by `data-screen`. */
export function screenDestination(screen: ThemeLayoutScreen) {
  return { id: 'screen', screen: screen.id, href: `/app/screen/${screen.id}`, icon: SCREEN_ICONS[screen.icon ?? 'grid'], label: screen.title, anim: '' }
}
