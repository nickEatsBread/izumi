export type HotkeyScope = 'Global' | 'Player'
export type HotkeyId =
  | 'globalSearch'
  | 'playerPlayPause'
  | 'playerClose'
  | 'playerSeekBack'
  | 'playerSeekForward'
  | 'playerPreviousChapter'
  | 'playerNextChapter'
  | 'playerVolumeUp'
  | 'playerVolumeDown'
  | 'playerMute'
  | 'playerFullscreen'
  | 'playerNextEpisode'
  | 'playerPreviousEpisode'
  | 'playerScreenshot'
  | 'playerSubtitleCycle'
  | 'playerSubDelayDown'
  | 'playerSubDelayUp'
  | 'playerStats'
  | 'playerGif'
  | 'playerClip'
  | 'playerSleep'
  | 'playerLoopA'
  | 'playerLoopB'
  | 'playerLoopClear'

export type HotkeyDefinition = {
  id: HotkeyId
  scope: HotkeyScope
  group: string
  label: string
  description: string
  defaultBinding: string
}

export const HOTKEYS: HotkeyDefinition[] = [
  { id: 'globalSearch', scope: 'Global', group: 'Navigation', label: 'Quick search', description: 'Open the quick-search overlay from anywhere.', defaultBinding: 'ctrl+k' },
  { id: 'playerPlayPause', scope: 'Player', group: 'Playback', label: 'Play / pause', description: 'Toggle playback.', defaultBinding: 'Space' },
  { id: 'playerClose', scope: 'Player', group: 'Playback', label: 'Exit fullscreen', description: 'Leave fullscreen playback.', defaultBinding: 'Escape' },
  { id: 'playerFullscreen', scope: 'Player', group: 'Playback', label: 'Toggle fullscreen', description: 'Enter or leave fullscreen.', defaultBinding: 'f' },
  { id: 'playerMute', scope: 'Player', group: 'Playback', label: 'Toggle mute', description: 'Mute or restore player audio.', defaultBinding: 'm' },
  { id: 'playerScreenshot', scope: 'Player', group: 'Playback', label: 'Screenshot', description: 'Save the current frame to Pictures/izumi.', defaultBinding: 'p' },
  { id: 'playerStats', scope: 'Player', group: 'Tools', label: 'Stats overlay', description: 'Show or hide live playback diagnostics.', defaultBinding: 'i' },
  { id: 'playerGif', scope: 'Player', group: 'Tools', label: 'Record GIF', description: 'Start or stop a GIF recording.', defaultBinding: 'o' },
  { id: 'playerClip', scope: 'Player', group: 'Tools', label: 'Save recent clip', description: 'Save the previous 30 seconds as MP4.', defaultBinding: 'c' },
  { id: 'playerSleep', scope: 'Player', group: 'Tools', label: 'Sleep after episode', description: 'Stop autoplay when this episode ends.', defaultBinding: 'l' },
  { id: 'playerLoopA', scope: 'Player', group: 'Tools', label: 'Set loop A', description: 'Set the A/B loop start.', defaultBinding: '[' },
  { id: 'playerLoopB', scope: 'Player', group: 'Tools', label: 'Set loop B', description: 'Set the A/B loop end.', defaultBinding: ']' },
  { id: 'playerLoopClear', scope: 'Player', group: 'Tools', label: 'Clear A/B loop', description: 'Disable the active A/B loop.', defaultBinding: '\\' },
  { id: 'playerSeekBack', scope: 'Player', group: 'Seeking', label: 'Seek back', description: 'Seek by the configured player step.', defaultBinding: 'ArrowLeft' },
  { id: 'playerSeekForward', scope: 'Player', group: 'Seeking', label: 'Seek forward', description: 'Seek by the configured player step.', defaultBinding: 'ArrowRight' },
  { id: 'playerPreviousChapter', scope: 'Player', group: 'Seeking', label: 'Previous chapter', description: 'Restart this chapter, or jump back a chapter if it just started.', defaultBinding: 'PageUp' },
  { id: 'playerNextChapter', scope: 'Player', group: 'Seeking', label: 'Next chapter', description: 'Jump to the start of the next chapter.', defaultBinding: 'PageDown' },
  { id: 'playerVolumeUp', scope: 'Player', group: 'Audio', label: 'Volume up', description: 'Raise volume five points.', defaultBinding: 'ArrowUp' },
  { id: 'playerVolumeDown', scope: 'Player', group: 'Audio', label: 'Volume down', description: 'Lower volume five points.', defaultBinding: 'ArrowDown' },
  { id: 'playerSubtitleCycle', scope: 'Player', group: 'Subtitles', label: 'Cycle subtitles', description: 'Select the next subtitle track.', defaultBinding: 's' },
  { id: 'playerSubDelayDown', scope: 'Player', group: 'Subtitles', label: 'Subtitle earlier', description: 'Shift subtitles earlier by 0.1 seconds.', defaultBinding: 'z' },
  { id: 'playerSubDelayUp', scope: 'Player', group: 'Subtitles', label: 'Subtitle later', description: 'Shift subtitles later by 0.1 seconds.', defaultBinding: 'x' },
  { id: 'playerNextEpisode', scope: 'Player', group: 'Episodes', label: 'Next episode', description: 'Play the next available episode.', defaultBinding: 'n' },
  { id: 'playerPreviousEpisode', scope: 'Player', group: 'Episodes', label: 'Previous episode', description: 'Play the previous episode.', defaultBinding: 'b' },
]

const definitions = Object.fromEntries(HOTKEYS.map((hotkey) => [hotkey.id, hotkey])) as Record<HotkeyId, HotkeyDefinition>

export function eventToBinding(event: KeyboardEvent) {
  const modifiers: string[] = []
  let key = event.key
  const letter = key.length === 1 && /[a-z]/i.test(key)
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.shiftKey && !letter) modifiers.push('shift')
  if (event.altKey) modifiers.push('alt')
  if (event.metaKey) modifiers.push('meta')
  if (key === ' ') key = 'Space'
  if (letter) key = key.toLowerCase()
  return [...modifiers, key].join('+')
}

export function isModifierOnly(event: KeyboardEvent) {
  return ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
}

export function effectiveBinding(id: HotkeyId, overrides: Record<string, string>) {
  return overrides[id] || definitions[id].defaultBinding
}

export function findHotkey(event: KeyboardEvent, overrides: Record<string, string>, scope: HotkeyScope) {
  const binding = eventToBinding(event)
  return HOTKEYS.find((hotkey) => hotkey.scope === scope && effectiveBinding(hotkey.id, overrides) === binding)?.id ?? null
}

export function conflictingHotkey(id: HotkeyId, binding: string, overrides: Record<string, string>) {
  const source = definitions[id]
  return HOTKEYS.find((hotkey) =>
    hotkey.id !== id
    && hotkey.scope === source.scope
    && effectiveBinding(hotkey.id, overrides) === binding,
  ) ?? null
}

export function displayBinding(binding: string) {
  const labels: Record<string, string> = {
    ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Meta',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    PageUp: 'Page Up', PageDown: 'Page Down',
  }
  return binding.split('+').map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join(' + ')
}

export function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return !!element && (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.isContentEditable
    || ['textbox', 'searchbox', 'combobox'].includes(element.getAttribute('role') ?? '')
  )
}
