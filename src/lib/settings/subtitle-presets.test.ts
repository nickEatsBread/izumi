import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  savedSubtitleStyles, sessionSubtitleStyle, saveSubtitlePreset, deleteSubtitlePreset,
  applyPresetGlobally, effectiveSubtitleStyle, subtitlePresetSourceName, type SubtitleStylePreset,
} from './subtitle-presets'
import {
  subtitleStyleEnabled, subtitleOverrideScope, subtitleFont, subtitleBold, subtitleFontSize, subtitleTextColor,
  subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition, subtitleAssSnapshot,
} from './ui'
import type { SubtitleStyle } from '$lib/player/subtitle-style'

const STYLE: Omit<SubtitleStyle, 'enabled'> = {
  scope: 'dialogue', font: 'Roboto Medium', bold: true, fontSize: 52, textColor: '#ffffff', borderColor: '#131220',
  borderSize: 2.6, shadow: 0, position: 94,
}

beforeEach(() => {
  savedSubtitleStyles.set([])
  sessionSubtitleStyle.set(null)
  subtitleAssSnapshot.set(null)
})

describe('saveSubtitlePreset', () => {
  it('appends a preset with the given name, style and source', () => {
    const saved = saveSubtitlePreset('SubsPlease', STYLE, { group: 'SubsPlease', title: 'Mushoku Tensei' })
    const list = get(savedSubtitleStyles)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(saved.id)
    expect(list[0].name).toBe('SubsPlease')
    expect(list[0].style.font).toBe('Roboto Medium')
    expect(list[0].source?.group).toBe('SubsPlease')
  })

  it('replaces a preset with the same name (trimmed, case-insensitive) keeping its id', () => {
    const first = saveSubtitlePreset('SubsPlease', STYLE)
    saveSubtitlePreset('  subsplease ', { ...STYLE, fontSize: 60 })
    const list = get(savedSubtitleStyles)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(first.id)
    expect(list[0].name).toBe('subsplease')
    expect(list[0].style.fontSize).toBe(60)
  })
})

describe('subtitlePresetSourceName', () => {
  it('prefers the release author over the anime title', () => {
    expect(subtitlePresetSourceName({ group: ' WAKANIM ', title: 'Anime Name' })).toBe('WAKANIM')
  })

  it('uses the anime name only when the release has no author', () => {
    expect(subtitlePresetSourceName({ title: 'Anime Name' })).toBe('Anime Name')
  })
})

describe('deleteSubtitlePreset', () => {
  it('removes by id and clears a session override that used it', () => {
    const preset = saveSubtitlePreset('SubsPlease', STYLE)
    sessionSubtitleStyle.set(preset)
    deleteSubtitlePreset(preset.id)
    expect(get(savedSubtitleStyles)).toHaveLength(0)
    expect(get(sessionSubtitleStyle)).toBeNull()
  })
})

describe('applyPresetGlobally', () => {
  it('writes every persisted style store and enables the override', () => {
    subtitleStyleEnabled.set(false)
    const preset = saveSubtitlePreset('SubsPlease', STYLE)
    applyPresetGlobally(preset)
    expect(get(subtitleStyleEnabled)).toBe(true)
    expect(get(subtitleFont)).toBe('Roboto Medium')
    expect(get(subtitleOverrideScope)).toBe('dialogue')
    expect(get(subtitleBold)).toBe(true)
    expect(get(subtitleFontSize)).toBe(52)
    expect(get(subtitleTextColor)).toBe('#ffffff')
    expect(get(subtitleBorderColor)).toBe('#131220')
    expect(get(subtitleBorderSize)).toBe(2.6)
    expect(get(subtitleShadow)).toBe(0)
    expect(get(subtitlePosition)).toBe(94)
  })

  it('keeps the lossless ASS snapshot when a captured preset is made global', () => {
    const assSnapshot = {
      reference: STYLE,
      scriptInfo: [['PlayResY', '1080']] as [string, string][],
      styles: [{ name: 'Default', fields: [['FontSize', '78']] as [string, string][] }],
    }
    const preset = saveSubtitlePreset('Exact', { ...STYLE, assSnapshot })
    applyPresetGlobally(preset)
    expect(get(subtitleAssSnapshot)).toEqual(assSnapshot)
  })
})

describe('effectiveSubtitleStyle', () => {
  const globals: SubtitleStyle = {
    enabled: false, scope: 'all', font: 'Nunito', bold: false, fontSize: 42, textColor: '#ffffff',
    borderColor: '#000000', borderSize: 3, shadow: 1, position: 92,
  }

  it('passes the globals through untouched when no session preset is set', () => {
    expect(effectiveSubtitleStyle(null, globals)).toEqual(globals)
  })

  it('uses the session preset with the override forced on', () => {
    const preset: SubtitleStylePreset = { id: 'x', name: 'SubsPlease', style: STYLE, savedAt: 1 }
    const style = effectiveSubtitleStyle(preset, globals)
    expect(style.enabled).toBe(true)
    expect(style.font).toBe('Roboto Medium')
    expect(style.position).toBe(94)
    expect(style.scope).toBe('dialogue')
    expect(style.bold).toBe(true)
  })

  it('fills fields missing from an older saved preset from the current global style', () => {
    const oldStyle = { ...STYLE } as Partial<typeof STYLE>
    delete oldStyle.scope
    delete oldStyle.bold
    const preset = { id: 'old', name: 'Older preset', style: oldStyle as typeof STYLE, savedAt: 1 }
    const style = effectiveSubtitleStyle(preset, globals)
    expect(style.scope).toBe('all')
    expect(style.bold).toBe(false)
  })
})
