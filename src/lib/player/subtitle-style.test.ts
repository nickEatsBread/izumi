import { describe, expect, it } from 'vitest'
import {
  assColor, dialogueBottom, mpvColor, readSubtitleDefaults, subtitleStyleProps, subtitleTrackFrom,
  DEFAULT_SUBTITLE_FONT, MPV_SUBTITLE_DEFAULTS, TEXT_TRACK, type SubtitleStyle, type SubtitleTrack,
} from './subtitle-style'
import { captureFromExtradata, parseAssStyles } from './ass-style-capture'

const style = (overrides: Partial<SubtitleStyle> = {}): SubtitleStyle => ({
  enabled: true,
  scope: 'dialogue',
  font: 'Nunito',
  bold: false,
  fontSize: 42,
  textColor: '#ffffff',
  borderColor: '#000000',
  borderSize: 3,
  shadow: 1,
  position: 92,
  ...overrides,
})

const FORMAT = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
const styleLine = (name: string, font: string, size: number, alignment: number, marginV: number) =>
  `Style: ${name},${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,${alignment},10,10,${marginV},1`
const script = (playResX: number, playResY: number, styles: string[]) =>
  `[Script Info]\nScriptType: v4.00+\nPlayResX: ${playResX}\nPlayResY: ${playResY}\n\n[V4+ Styles]\n${FORMAT}\n${styles.join('\n')}\n`

// A web release: dialogue lives in `main` and its variants (not in `Default`), plus sign styles.
const WEB_360 = script(640, 360, [
  styleLine('Default', 'Arial', 20, 2, 18),
  styleLine('main', 'Trebuchet MS', 24, 2, 18),
  styleLine('top', 'Trebuchet MS', 24, 8, 18),
  styleLine('italics', 'Trebuchet MS', 24, 2, 18),
  styleLine('sign_Arial', 'Arial', 30, 8, 10),
  styleLine('Episode Title', 'Times New Roman', 30, 2, 20),
])
// A disc release at 1080 lines with a top-aligned opening song style.
const DISC_1080 = script(1448, 1080, [
  styleLine('OP', 'Cheltenham Condensed', 71, 8, 55),
  styleLine('Default', 'Gandhi Sans', 71, 2, 55),
  styleLine('Default - Overlap', 'Gandhi Sans', 71, 2, 55),
  styleLine('Default - Alt', 'Gandhi Sans', 71, 8, 55),
  styleLine('Signs', 'Arial', 50, 2, 55),
])
const ass = (extradata: string): SubtitleTrack => ({ ass: true, header: parseAssStyles(extradata) })
const lookup = (props: [string, string][]) => Object.fromEntries(props)

describe('mpvColor', () => {
  it('puts the alpha FIRST, as mpv parses #AARRGGBB', () => {
    expect(mpvColor('#000000')).toBe('#ff000000')
    expect(mpvColor('#ff0000')).toBe('#ffff0000')
  })

  it('normalizes case and a missing hash', () => {
    expect(mpvColor('AABBCC')).toBe('#ffaabbcc')
  })

  it('falls back to opaque white on an unparseable value', () => {
    expect(mpvColor('')).toBe('#ffffffff')
    expect(mpvColor('rgb(1,2,3)')).toBe('#ffffffff')
  })
})

describe('assColor', () => {
  it('converts RGB into libass AABBGGRR order', () => {
    expect(assColor('#131220')).toBe('&H00201213&')
  })
})

describe('subtitleStyleProps with the style off', () => {
  it('renders the subtitles as authored and restores every text property mpv defaulted', () => {
    const props = lookup(subtitleStyleProps(style({ enabled: false }), ass(DISC_1080)))
    expect(props['sub-ass-override']).toBe('no')
    expect(props['sub-ass-style-overrides']).toBe('')
    expect(props['sub-pos']).toBe('100')
    expect(props['sub-scale']).toBe('1')
    for (const property of ['sub-font', 'sub-bold', 'sub-font-size', 'sub-color', 'sub-border-color', 'sub-border-size', 'sub-shadow-offset']) {
      expect(props[property]).toBe(MPV_SUBTITLE_DEFAULTS[property])
    }
  })

  it('does not leave an applied style on text subtitles after switching back', () => {
    // Real-client repro: an SRT stayed 1.27× bigger, bold and in the preset's font after
    // "Your settings", because switching off only reset the ASS override.
    const defaults = { ...MPV_SUBTITLE_DEFAULTS, 'sub-font-size': '38', 'sub-font': 'sans-serif' }
    const applied = lookup(subtitleStyleProps(style({ fontSize: 50, bold: true, font: 'Gandhi Sans' }), TEXT_TRACK))
    const back = lookup(subtitleStyleProps(style({ enabled: false }), TEXT_TRACK, undefined, defaults))
    expect(applied['sub-font-size']).toBe('50')
    expect(back['sub-font-size']).toBe('38')
    expect(back['sub-bold']).toBe('no')
    expect(back['sub-font']).toBe('sans-serif')
  })

  it('lets the player move and resize authored subtitles without restyling them', () => {
    const moved = lookup(subtitleStyleProps(style({ enabled: false }), ass(WEB_360), { position: 70, scale: 1 }))
    expect(moved['sub-ass-override']).toBe('scale')
    expect(moved['sub-ass-style-overrides']).toBe('')
    // `main` ends 18/360 above the bottom (95%); sub-pos S puts it at 95% × S / 100.
    expect(moved['sub-pos']).toBe('73.68')
    const bigger = lookup(subtitleStyleProps(style({ enabled: false }), ass(WEB_360), { position: null, scale: 1.2 }))
    expect(bigger['sub-ass-override']).toBe('scale')
    expect(bigger['sub-scale']).toBe('1.2')
    expect(bigger['sub-pos']).toBe('100')
  })
})

describe('subtitleStyleProps for dialogue only', () => {
  it('converts the 720-line settings into each script’s own units', () => {
    const at360 = lookup(subtitleStyleProps(style(), ass(WEB_360)))['sub-ass-style-overrides']
    const at1080 = lookup(subtitleStyleProps(style(), ass(DISC_1080)))['sub-ass-style-overrides']
    expect(at360).toContain('main.FontSize=21')
    expect(at360).toContain('main.Outline=1.5')
    expect(at1080).toContain('Default.FontSize=63')
    expect(at1080).toContain('Default.Outline=4.5')
    expect(at360).not.toMatch(/(^|,)FontSize=/)
  })

  it('restyles the dialogue family, whatever it is called, and leaves signs and songs alone', () => {
    const web = lookup(subtitleStyleProps(style(), ass(WEB_360)))['sub-ass-style-overrides']
    for (const name of ['main', 'top', 'italics']) expect(web).toContain(`${name}.FontName=Nunito`)
    for (const name of ['Default', 'sign_Arial', 'Episode Title']) expect(web).not.toContain(`${name}.`)
    const disc = lookup(subtitleStyleProps(style(), ass(DISC_1080)))['sub-ass-style-overrides']
    for (const name of ['Default', 'Default - Overlap', 'Default - Alt']) expect(disc).toContain(`${name}.FontName=Nunito`)
    for (const name of ['OP', 'Signs']) expect(disc).not.toContain(`${name}.`)
  })

  it('never forces an alignment or another resolution onto the script', () => {
    const overrides = lookup(subtitleStyleProps(style(), ass(DISC_1080)))['sub-ass-style-overrides']
    expect(overrides).not.toContain('Alignment')
    expect(overrides).not.toContain('PlayRes')
    expect(overrides).not.toContain('MarginV')
  })

  it('places dialogue where the style says, measured from the script’s own dialogue margin', () => {
    // Default ends 55/1080 above the bottom: 94.91%. Position 92 → sub-pos 96.94.
    expect(lookup(subtitleStyleProps(style(), ass(DISC_1080)))['sub-pos']).toBe('96.94')
    expect(dialogueBottom(style(), ass(DISC_1080))).toBe(92)
  })

  it('styles text subtitles through mpv’s own 720-line options', () => {
    const props = lookup(subtitleStyleProps(style({ fontSize: 55, bold: true, borderSize: 4, shadow: 2 }), TEXT_TRACK))
    expect(props['sub-ass-style-overrides']).toBe('')
    expect(props['sub-font']).toBe('Nunito')
    expect(props['sub-font-size']).toBe('55')
    expect(props['sub-bold']).toBe('yes')
    expect(props['sub-border-size']).toBe('4')
    expect(props['sub-shadow-offset']).toBe('2')
    expect(props['sub-border-color']).toBe('#ff000000')
  })

  it('falls back to the bundled font when the field is cleared', () => {
    expect(lookup(subtitleStyleProps(style({ font: '   ' })))['sub-font']).toBe(DEFAULT_SUBTITLE_FONT)
  })
})

describe('subtitleStyleProps for all elements', () => {
  it('lets mpv restyle every line from its resolution-independent options', () => {
    const props = lookup(subtitleStyleProps(style({ scope: 'all' }), ass(WEB_360)))
    expect(props['sub-ass-override']).toBe('force')
    expect(props['sub-ass-style-overrides']).toBe('')
    // Text margin 34/720 → bottom 95.28%; position 92 → sub-pos 96.56.
    expect(props['sub-pos']).toBe('96.56')
  })
})

describe('saved release styles', () => {
  const captured = captureFromExtradata(DISC_1080)!

  it('replays exactly onto the release they were captured from', () => {
    const props = lookup(subtitleStyleProps({ enabled: true, ...captured }, ass(DISC_1080)))
    expect(props['sub-ass-style-overrides']).toContain('PlayResY=1080')
    expect(props['sub-ass-style-overrides']).toContain('Default.FontSize=71')
    // Top-aligned styles stay at the top (libass VALIGN_TOP = 4, centre = 8).
    expect(props['sub-ass-style-overrides']).toContain('OP.Alignment=6')
    expect(props['sub-pos']).toBe('100')
  })

  it('converts onto another release instead of forcing the capture’s resolution on it', () => {
    // Real-client repro: a 1080-line capture shrank a 360-line release’s dialogue to a third, and a
    // 360-line capture blew a 1080-line release’s songs up threefold.
    const props = lookup(subtitleStyleProps({ enabled: true, ...captured }, ass(WEB_360)))
    const overrides = props['sub-ass-style-overrides']
    expect(overrides).not.toContain('PlayRes')
    expect(overrides).not.toContain('OP.')
    expect(overrides).toContain('main.FontName=Gandhi Sans')
    // 71 at 1080 lines is 47 on the 720-line scale, which is 23.5 at 360 lines.
    expect(overrides).toContain('main.FontSize=23.5')
  })

  it('changes something even when the release names its dialogue style differently', () => {
    const props = lookup(subtitleStyleProps({ enabled: true, ...captured }, ass(WEB_360)))
    expect(props['sub-ass-style-overrides']).toContain('main.')
  })
})

describe('subtitleTrackFrom', () => {
  const tracks = (codec: string) => JSON.stringify([
    { type: 'video', id: 1, selected: true, codec: 'hevc' },
    { type: 'sub', id: 1, selected: false, codec: 'ass' },
    { type: 'sub', id: 2, selected: true, codec },
  ])

  it('reads the selected ASS track’s header', () => {
    const track = subtitleTrackFrom(tracks('ass'), DISC_1080)
    expect(track.ass).toBe(true)
    expect(track.header?.playResY).toBe(1080)
  })

  it('treats converted text formats as text', () => {
    expect(subtitleTrackFrom(tracks('subrip'), DISC_1080)).toEqual(TEXT_TRACK)
    expect(subtitleTrackFrom('not json', '')).toEqual(TEXT_TRACK)
  })
})

describe('readSubtitleDefaults', () => {
  it('asks the running mpv and falls back per property', async () => {
    const known: Record<string, string> = {
      'option-info/sub-font-size/default-value': '55',
      'option-info/sub-outline-size/default-value': '3',
    }
    const defaults = await readSubtitleDefaults(async (name) => {
      if (name in known) return known[name]
      throw new Error('unknown option')
    })
    expect(defaults['sub-font-size']).toBe('55')
    expect(defaults['sub-border-size']).toBe('3')
    expect(defaults['sub-font']).toBe(MPV_SUBTITLE_DEFAULTS['sub-font'])
  })
})
