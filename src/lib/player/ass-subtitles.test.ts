import { describe, expect, it } from 'vitest'
import {
  applyAssStyleOverrides,
  assFontFamilies,
  assTrackContent,
  fontsForFamilies,
  isAssSubtitle,
  needsOwnFonts,
  parseSubtitleFonts,
} from './ass-subtitles'
import { NO_SUBTITLE_ADJUSTMENTS, type SubtitleStyle } from './subtitle-style'

const SCRIPT = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Trebuchet MS,70,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,0,0,60,1',
  'Style: Sign,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,0,0,30,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,I, on the other hand, was exceptional.',
  'Dialogue: 0,0:00:04.00,0:00:06.00,Sign,,0,0,0,,{\\fnGeorgia\\b1\\pos(960,100)}Royal Capital',
].join('\r\n')

const style = (over: Partial<SubtitleStyle> = {}): SubtitleStyle => ({
  enabled: false,
  scope: 'dialogue',
  font: 'Nunito',
  bold: false,
  fontSize: 42,
  textColor: '#ffffff',
  borderColor: '#000000',
  borderSize: 3,
  shadow: 1,
  position: 92,
  ...over,
})

describe('isAssSubtitle', () => {
  it('knows a script by content or file name', () => {
    expect(isAssSubtitle('http://x/sub', SCRIPT)).toBe(true)
    expect(isAssSubtitle('http://x/en.ass?t=1', '')).toBe(true)
    expect(isAssSubtitle('http://x/en.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nhi')).toBe(false)
  })
})

describe('parseSubtitleFonts', () => {
  it('keeps families with http(s) URLs only', () => {
    expect(parseSubtitleFonts([
      { family: ' Arial ', url: 'http://127.0.0.1:17871/v/a/fonts/arial.ttf' },
      { family: 'Evil', url: 'file:///etc/passwd' },
      { family: '', url: 'https://x/y.ttf' },
      null,
      'Arial',
    ])).toEqual([{ family: 'Arial', url: 'http://127.0.0.1:17871/v/a/fonts/arial.ttf' }])
    expect(parseSubtitleFonts(undefined)).toEqual([])
  })
})

describe('applyAssStyleOverrides', () => {
  it('rewrites the named style and leaves the others as authored', () => {
    const out = applyAssStyleOverrides(SCRIPT, ['Default.FontName=Nunito', 'default.Outline=6'])
    expect(out).toContain('Style: Default,Nunito,70,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,2,0,0,60,1')
    expect(out).toContain('Style: Sign,Arial,48,')
    expect(out).toContain('{\\fnGeorgia\\b1\\pos(960,100)}Royal Capital')
  })

  it('applies an unprefixed field to every style and sets Script Info fields', () => {
    const out = applyAssStyleOverrides(SCRIPT, ['Bold=0', 'PlayResY=720', 'ScaledBorderAndShadow=yes'])
    expect(out).toMatch(/Style: Default,Trebuchet MS,70,[^\n]*,0,0,0,0,100/)
    expect(out).toContain('PlayResY: 720')
    expect(out).not.toContain('PlayResY: 1080')
    expect(out.indexOf('ScaledBorderAndShadow: yes')).toBeLessThan(out.indexOf('[V4+ Styles]'))
  })
})

describe('assTrackContent', () => {
  it('draws the script as authored when no style is on', () => {
    expect(assTrackContent(SCRIPT, style(), NO_SUBTITLE_ADJUSTMENTS)).toBe(SCRIPT)
  })

  it('restyles dialogue only when "Use my subtitle style" is on', () => {
    const out = assTrackContent(SCRIPT, style({ enabled: true, font: 'Nunito' }), NO_SUBTITLE_ADJUSTMENTS)
    expect(out).toMatch(/Style: Default,Nunito,/)
    expect(out).toMatch(/Style: Sign,Arial,/)
  })

  it('leaves a style that replaces everything to the plain-text renderer', () => {
    expect(assTrackContent(SCRIPT, style({ enabled: true, scope: 'all' }), NO_SUBTITLE_ADJUSTMENTS)).toBeNull()
  })
})

describe('fonts a script needs', () => {
  const fonts = ['Arial', 'Arial Bold', 'Arial Bold Italic', 'Arial Black', 'Arial Unicode MS', 'Trebuchet MS', 'Trebuchet MS Italic', 'Georgia', 'Verdana']
    .map((family) => ({ family, url: `http://h/${family}.ttf` }))

  it('reads style fonts and inline \\fn overrides', () => {
    expect(assFontFamilies(SCRIPT).sort()).toEqual(['arial', 'georgia', 'trebuchet ms'])
  })

  it('picks each family with its weight and italic faces, not unrelated families', () => {
    expect(fontsForFamilies(fonts, assFontFamilies(SCRIPT)).map((font) => font.family)).toEqual([
      'Arial', 'Arial Bold', 'Arial Bold Italic', 'Arial Black', 'Trebuchet MS', 'Trebuchet MS Italic', 'Georgia',
    ])
  })
})

describe('needsOwnFonts', () => {
  it('flags lines the fallback face cannot draw', () => {
    expect(needsOwnFonts(SCRIPT)).toBe(false)
    expect(needsOwnFonts('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Tiếng Việt có dấu')).toBe(false)
    expect(needsOwnFonts('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,要丢下这个精灵吗')).toBe(true)
    expect(needsOwnFonts('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,هل نترك هذه الإلف هنا؟')).toBe(true)
    expect(needsOwnFonts(['Title: 中文', 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello'].join('\n'))).toBe(false)
  })
})
