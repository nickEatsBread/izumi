import { writable } from 'svelte/store'
export const inputType = writable<'mouse' | 'touch' | 'dpad'>('mouse')
export function initInput() {
  window.addEventListener('pointerdown', e => inputType.set(e.pointerType === 'touch' ? 'touch' : 'mouse'))
  window.addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) inputType.set('dpad') })
}
