import { useState } from 'preact/hooks'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, SlidersHorizontal, X } from 'lucide-preact'
import type { RemoteAction } from '../lib/remote'
import type { ScreenName } from '../types'

const screens: { id: ScreenName; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'search', label: 'Search' },
  { id: 'trending', label: 'Trending' },
  { id: 'series', label: 'Series' },
  { id: 'movies', label: 'Movies' },
  { id: 'my-list', label: 'My List' },
  { id: 'settings', label: 'Settings' },
  { id: 'ready', label: 'Ready' },
  { id: 'loading', label: 'Loading' },
  { id: 'player', label: 'Player' },
  { id: 'error', label: 'Error' },
]

export function PreviewToolbar({
  screen,
  safeArea,
  onScreen,
  onRemote,
  onSafeArea,
}: {
  screen: ScreenName
  safeArea: boolean
  onScreen(screen: ScreenName): void
  onRemote(action: RemoteAction): void
  onSafeArea(): void
}) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) return (
    <button type="button" class="preview-toolbar-toggle" onClick={() => setCollapsed(false)}>
      <SlidersHorizontal size={16} /> Preview controls
    </button>
  )

  return (
    <aside class="preview-toolbar" aria-label="Local TV preview controls">
      <strong>TV preview</strong>
      <button type="button" class="preview-collapse" aria-label="Hide preview controls" onClick={() => setCollapsed(true)}><X size={16} /></button>
      <div class="preview-tabs">
        {screens.map(({ id, label }) => (
          <button type="button" class={screen === id ? 'selected' : ''} onClick={() => onScreen(id)} key={id}>{label}</button>
        ))}
      </div>
      <div class="preview-remote" aria-label="Remote control">
        <button type="button" aria-label="Up" onClick={() => onRemote('up')}><ArrowUp /></button>
        <button type="button" aria-label="Left" onClick={() => onRemote('left')}><ArrowLeft /></button>
        <button type="button" aria-label="Select" class="remote-ok" onClick={() => onRemote('select')}><CornerDownLeft /></button>
        <button type="button" aria-label="Right" onClick={() => onRemote('right')}><ArrowRight /></button>
        <button type="button" aria-label="Down" onClick={() => onRemote('down')}><ArrowDown /></button>
      </div>
      <button type="button" class={`safe-toggle${safeArea ? ' selected' : ''}`} onClick={onSafeArea}>Safe area</button>
      <span>Keyboard: arrows · Enter · Backspace</span>
    </aside>
  )
}
