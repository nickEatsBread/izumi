import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import {
  audioProcessing,
  subtitleStripSdh,
  subtitleStripSdhHarder,
  subtitleRegexFilter,
  windowsVsr,
  type AudioProcessing,
  type WindowsVsr,
} from '$lib/settings/ui'

export function audioFilter(mode: AudioProcessing): string {
  if (mode === 'dialogue') return 'lavfi=[dynaudnorm=f=150:g=12:p=0.9]'
  if (mode === 'night') return 'lavfi=[loudnorm=I=-18:LRA=7:TP=-2]'
  return ''
}

export function vsrFilter(mode: WindowsVsr): string {
  return mode === 'off' ? '' : `d3d11vpp=scaling-mode=${mode}`
}

export function subtitleFilterOptions(strip: boolean, harder: boolean, regex: string): [string, string][] {
  return [
    ['sub-filter-sdh', strip ? 'yes' : 'no'],
    ['sub-filter-sdh-harder', strip && harder ? 'yes' : 'no'],
    ['sub-filter-regex', regex.replace(/[\r\n]/g, ' ').trim()],
  ]
}

async function setOption(name: string, value: string) {
  await invoke('player_command', { name: 'set', args: [name, value] }).catch(() => {})
}

export async function applyPlaybackEnhancements(): Promise<void> {
  await Promise.all([
    setOption('af', audioFilter(get(audioProcessing))),
    setOption('vf', vsrFilter(get(windowsVsr))),
    ...subtitleFilterOptions(get(subtitleStripSdh), get(subtitleStripSdhHarder), get(subtitleRegexFilter))
      .map(([name, value]) => setOption(name, value)),
  ])
}

let started = false
export function startEnhancementSync(): void {
  if (started) return
  started = true
  for (const store of [audioProcessing, windowsVsr, subtitleStripSdh, subtitleStripSdhHarder, subtitleRegexFilter]) {
    let first = true
    store.subscribe(() => {
      if (first) first = false
      else void applyPlaybackEnhancements()
    })
  }
}
