import {
  Bookmark,
  Clapperboard,
  Flame,
  House,
  Search,
  Settings,
  Tv,
} from 'lucide-preact'
import type { FocusLocation } from '../types'
import izumiMark from '../../../brand/svg/izumi-mark-color.svg'

const items = [
  { label: 'Home', icon: House },
  { label: 'Search', icon: Search },
  { label: 'Trending', icon: Flame },
  { label: 'Series', icon: Tv },
  { label: 'Movies', icon: Clapperboard },
  { label: 'My List', icon: Bookmark },
  { label: 'Settings', icon: Settings },
]

interface NavRailProps {
  activeIndex: number
  focus: FocusLocation
  catalogLabel?: string
  expanded?: boolean
  onFocus(index: number): void
  onSelect(index: number): void
}

export const navItemCount = items.length

export function NavRail({ activeIndex, focus, catalogLabel = 'Catalogue', expanded = false, onFocus, onSelect }: NavRailProps) {
  const markFocused = focus.zone === 'nav' && focus.index === -1

  const renderItem = ({ label, icon: Icon }: (typeof items)[number], index: number) => {
    const focused = focus.zone === 'nav' && focus.index === index
    return (
      <button
        key={label}
        type="button"
        class={`nav-item${activeIndex === index ? ' is-active' : ''}${focused ? ' is-focused' : ''}`}
        data-focus-id={`nav-${index}`}
        tabIndex={focused ? 0 : -1}
        aria-label={label}
        aria-current={activeIndex === index ? 'page' : undefined}
        onFocus={() => onFocus(index)}
        onMouseEnter={() => onFocus(index)}
        onClick={() => onSelect(index)}
      >
        <span class="nav-item-glyph">
          <Icon size={24} strokeWidth={2} aria-hidden="true" />
        </span>
        <span class="nav-item-label">{label}</span>
      </button>
    )
  }

  return (
    <nav class={`nav-rail${focus.zone === 'nav' || expanded ? ' is-open' : ''}`} aria-label="Main navigation">
      <button
        type="button"
        class={`nav-mark-button${markFocused ? ' is-focused' : ''}`}
        data-focus-id="nav--1"
        tabIndex={markFocused ? 0 : -1}
        aria-label={`Change catalogue. Current catalogue: ${catalogLabel}`}
        onFocus={() => onFocus(-1)}
        onMouseEnter={() => onFocus(-1)}
        onClick={() => onSelect(-1)}
      >
        <img class="nav-mark" src={izumiMark} alt="" />
        <span>{catalogLabel}</span>
      </button>
      <div class="nav-items">
        {items.slice(0, -1).map(renderItem)}
      </div>
      <div class="nav-utility">
        {items.slice(-1).map((item) => renderItem(item, items.length - 1))}
      </div>
    </nav>
  )
}
