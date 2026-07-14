import { get, writable } from 'svelte/store'
import { gameMode } from '$lib/player/session'

export interface DeckKeyboardWarning {
  service: string
}

interface PendingWarning extends DeckKeyboardWarning {
  resolve: () => void
}

export const deckKeyboardWarning = writable<DeckKeyboardWarning | null>(null)

const queue: PendingWarning[] = []
let active: PendingWarning | null = null

function showNext() {
  if (active) return
  active = queue.shift() ?? null
  deckKeyboardWarning.set(active ? { service: active.service } : null)
}

/** Wait for the Deck user to acknowledge the Steam+X keyboard shortcut. Desktop is a no-op. */
export function warnBeforeThirdPartyLogin(service: string, forceDeck = false): Promise<void> {
  if (!forceDeck && !get(gameMode)) return Promise.resolve()
  return new Promise((resolve) => {
    queue.push({ service, resolve })
    showNext()
  })
}

export function acknowledgeDeckKeyboardWarning() {
  if (!active) return
  const completed = active
  active = null
  deckKeyboardWarning.set(null)
  completed.resolve()
  showNext()
}
