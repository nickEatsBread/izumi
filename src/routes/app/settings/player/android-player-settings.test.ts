import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { settingKey as keyForSetting } from '$lib/settings/search'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const toggle = read('../../../../lib/components/settings/Toggle.svelte')

describe('Toggle settingKey', () => {
  it('takes an explicit search key and keeps the label slug as the default', () => {
    expect(toggle).toContain('let { label, desc, value, onToggle, leading, settingKey }: {')
    expect(toggle).toContain('    settingKey?: string\n  } = $props()')
    expect(toggle).toContain('  data-setting-key={settingKey ?? keyForSetting(label)}')
    expect(toggle).toContain("import { settingKey as keyForSetting } from '$lib/settings/search'")
    // One source for the key: the old label-only derived value is gone.
    expect(toggle).not.toContain('$derived(keyForSetting(label))')
  })
})

// Spec §5.1: the Player page shows a row wherever the player that reads the setting runs. The
// evaluator below walks the page markup with the build's {#if} gates decided and lists the settings
// stores a user can reach. A gate on other runtime state ($developerLogging, the chosen quality
// preset, the audio output mode, a pending consent) counts as "either way": both branches are reachable.
const page = read('./+page.svelte')

type Gate = '$isAndroid' | '$isAndroidTv' | '$inAppPlayerAvailable' | '$isWindows'
type Env = Record<Gate, boolean>
const ENVIRONMENTS = {
  // Windows desktop, the widest desktop build (it adds Windows driver upscaling).
  desktop: { $isAndroid: false, $isAndroidTv: false, $inAppPlayerAvailable: true, $isWindows: true },
  // Android phone or tablet, full build: the embedded player plugin is compiled in.
  full: { $isAndroid: true, $isAndroidTv: false, $inAppPlayerAvailable: true, $isWindows: false },
  // Android TV, full build.
  tv: { $isAndroid: true, $isAndroidTv: true, $inAppPlayerAvailable: true, $isWindows: false },
  // Android lite build: videos open in the device's own video player.
  lite: { $isAndroid: true, $isAndroidTv: false, $inAppPlayerAvailable: false, $isWindows: false },
} satisfies Record<string, Env>
type EnvName = keyof typeof ENVIRONMENTS

interface AstNode { type: string; [key: string]: unknown }
interface Fragment { nodes: AstNode[] }
interface Reached { stores: string[]; texts: string[]; elements: AstNode[] }

/** true or false when the build decides the expression; null when runtime state does. */
function evaluate(node: AstNode, env: Env): boolean | null {
  if (node.type === 'Identifier') {
    const name = node.name as string
    return name in env ? env[name as Gate] : null
  }
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    const value = evaluate(node.argument as AstNode, env)
    return value === null ? null : !value
  }
  if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
    const left = evaluate(node.left as AstNode, env)
    const right = evaluate(node.right as AstNode, env)
    if (node.operator === '&&') {
      if (left === false || right === false) return false
      return left === true && right === true ? true : null
    }
    if (left === true || right === true) return true
    return left === false && right === false ? false : null
  }
  return null
}

/** Every `$store` read inside an expression or an attribute list (handlers too), in source order.
 *  The four build gates are left out: they decide rows, they are not rows. */
function collectStores(value: unknown, into: string[]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectStores(item, into)
    return
  }
  const node = value as AstNode
  const name = node.type === 'Identifier' ? node.name : undefined
  if (typeof name === 'string' && name.startsWith('$') && !(name in ENVIRONMENTS.desktop)
      && !into.includes(name.slice(1))) {
    into.push(name.slice(1))
  }
  for (const [key, child] of Object.entries(node)) if (key !== 'type') collectStores(child, into)
}

function visit(nodes: AstNode[], env: Env, reached: Reached) {
  for (const node of nodes) {
    switch (node.type) {
      case 'Comment':
        break
      case 'Text': {
        const text = String(node.data).replace(/\s+/g, ' ').trim()
        if (text) reached.texts.push(text)
        break
      }
      case 'IfBlock': {
        const truth = evaluate(node.test as AstNode, env)
        if (truth !== false) visit((node.consequent as Fragment).nodes, env, reached)
        const alternate = node.alternate as Fragment | null
        if (truth !== true && alternate) visit(alternate.nodes, env, reached)
        break
      }
      case 'EachBlock':
        collectStores(node.expression, reached.stores)
        visit((node.body as Fragment).nodes, env, reached)
        if (node.fallback) visit((node.fallback as Fragment).nodes, env, reached)
        break
      case 'ExpressionTag':
      case 'HtmlTag':
      case 'RenderTag':
        collectStores(node.expression, reached.stores)
        break
      case 'RegularElement':
      case 'Component':
        reached.elements.push(node)
        collectStores(node.attributes, reached.stores)
        visit((node.fragment as Fragment).nodes, env, reached)
        break
      default:
        throw new Error(`the Player page has a ${node.type} node; teach this evaluator about it`)
    }
  }
}

const pageRoot = (parse(page, { modern: true }) as unknown as { fragment: Fragment }).fragment

function reach(name: EnvName): Reached {
  const reached: Reached = { stores: [], texts: [], elements: [] }
  visit(pageRoot.nodes, ENVIRONMENTS[name], reached)
  return reached
}

/** Static value of an attribute: its text, true when bare, null when it is an expression, undefined
 *  when absent. */
function attribute(element: AstNode, name: string): string | true | null | undefined {
  const found = (element.attributes as AstNode[]).find((attr) => attr.type === 'Attribute' && attr.name === name)
  if (!found) return undefined
  if (found.value === true) return true
  const parts = (Array.isArray(found.value) ? found.value : [found.value]) as AstNode[]
  return parts.every((part) => part.type === 'Text') ? parts.map((part) => String(part.data)).join('') : null
}

const sorted = (values: readonly string[]) => [...values].sort()

/** Rows every build shows: they steer source choice and the end-of-series prompt, not a player. */
const EVERY_BUILD = ['preferredAudioLang', 'preferredSubLang', 'continueSourcePreference', 'seriesRatingPrompt']
/** Settings the in-app player reads: desktop mpv and the Android full build's embedded player. */
const IN_APP = [
  'videoQualityPreset', 'qualityNotice', 'rawMpvOptions', 'qualityFailedKeys', 'audioProcessing',
  'p2pStatusVisibility', 'autoplayNext', 'upNextOverlay', 'keepAwakeWhilePlaying', 'bingePreload',
  'autoSkip', 'skipPreviews', 'skipFiller', 'scrubThumbnails', 'gifIncludeSubtitles', 'seekDuration',
  'audioOutputMode', 'audioPassthroughAc3', 'audioPassthroughEac3', 'audioPassthroughTruehd',
  'audioPassthroughDts', 'audioPassthroughDtsHd', 'audioExclusive', 'dolbyVisionOutputMode',
  'dolbyCapabilities', 'drmDolbyStatus', 'dolbyCapabilityError',
]
/** Desktop mpv tuning and OS / Game-mode integrations. */
const DESKTOP_ONLY = [
  'windowsVsr', 'systemMediaControls', 'discordRichPresence', 'playerProgressAnimations',
  'subtitleLineNavigation', 'gifScale', 'gifMaxSeconds', 'playerCacheMb', 'enableExternalPlayer',
  'externalPlayerPath', 'audioOutputDevice', 'playerTitleTop',
]
const LITE_NOTICE = "This build plays videos in your device's video player, so the in-app player options are not shown."

describe('Player settings per build (spec §5.1)', () => {
  it('keeps every desktop row, in the order it had before the gates', () => {
    expect(reach('desktop').stores).toEqual([
      'preferredAudioLang', 'preferredSubLang', 'videoQualityPreset', 'qualityNotice', 'rawMpvOptions',
      'qualityFailedKeys', 'windowsVsr', 'audioProcessing', 'p2pStatusVisibility', 'continueSourcePreference',
      'autoplayNext', 'upNextOverlay', 'seriesRatingPrompt', 'systemMediaControls', 'discordRichPresence',
      'keepAwakeWhilePlaying', 'bingePreload', 'autoSkip', 'skipPreviews', 'skipFiller', 'scrubThumbnails',
      'playerProgressAnimations', 'subtitleLineNavigation', 'gifIncludeSubtitles', 'gifScale', 'gifMaxSeconds',
      'playerCacheMb', 'seekDuration', 'enableExternalPlayer', 'externalPlayerPath', 'audioOutputMode',
      'audioPassthroughAc3', 'audioPassthroughEac3', 'audioPassthroughTruehd', 'audioPassthroughDts',
      'audioPassthroughDtsHd', 'audioExclusive', 'audioOutputDevice', 'dolbyCapabilities',
      'dolbyVisionOutputMode', 'drmDolbyStatus', 'dolbyCapabilityError', 'playerTitleTop',
    ])
    expect(sorted(reach('desktop').stores)).toEqual(sorted([...EVERY_BUILD, ...IN_APP, ...DESKTOP_ONLY]))
  })

  it('shows the Android full build every row its embedded player reads, plus the miniplayer', () => {
    expect(sorted(reach('full').stores)).toEqual(sorted([...EVERY_BUILD, ...IN_APP, 'androidAutoPip']))
  })

  it('shows Android TV the same rows without the phone miniplayer', () => {
    expect(sorted(reach('tv').stores)).toEqual(sorted([...EVERY_BUILD, ...IN_APP]))
  })

  it('hides every in-app player row on the lite build behind one notice', () => {
    expect(sorted(reach('lite').stores)).toEqual(sorted(EVERY_BUILD))
    expect(reach('lite').texts).toContain(LITE_NOTICE)
    for (const name of ['desktop', 'full', 'tv'] as const) expect(reach(name).texts, name).not.toContain(LITE_NOTICE)
    expect(page).not.toContain("The mpv tuning options further down don't apply on this platform.")
  })

  it('gives Android a preset menu for the seek step, never a number field', () => {
    for (const name of ['full', 'tv'] as const) {
      const { elements } = reach(name)
      expect(elements.filter((el) => el.name === 'input' && attribute(el, 'type') === 'number'), name).toEqual([])
      const seek = elements.filter((el) => el.name === 'SelectMenu' && attribute(el, 'ariaLabel') === 'Seek duration')
      expect(seek, name).toHaveLength(1)
      expect(attribute(seek[0], 'searchable'), name).toBeUndefined()
    }
    // Desktop keeps its two number fields: the Custom player cache and the seek step.
    expect(reach('desktop').elements.filter((el) => el.name === 'input' && attribute(el, 'type') === 'number')).toHaveLength(2)
    expect(page).toContain('const SEEK_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90]')
    expect(page).toContain('ariaLabel="Seek duration" options={seekOptions}')
  })

  it('documents that Binge also advances with Auto-play off (decision 11)', () => {
    const binge = reach('desktop').elements.find((el) => el.name === 'Toggle' && attribute(el, 'label') === 'Binge next episode (preload)')
    expect(binge && attribute(binge, 'desc')).toContain('the next episode also starts by itself when one ends, even with Auto-play off')
  })

  it('keys every Toggle whose label is a translated message, and the desktop GIF row, for search', () => {
    const toggles = [...reach('desktop').elements, ...reach('full').elements].filter((el) => el.name === 'Toggle')
    const translated = toggles.filter((el) => attribute(el, 'label') === null)
    expect(translated.length).toBeGreaterThan(0)
    for (const el of translated) expect(typeof attribute(el, 'settingKey')).toBe('string')
    const keys = new Set(toggles.map((el) => attribute(el, 'settingKey')).filter((key): key is string => typeof key === 'string'))
    expect([...keys].sort()).toEqual([
      'ask-for-a-rating-when-a-series-ends',
      'auto-play-next-episode',
      'include-subtitles-in-gifs',
      'show-up-next-countdown',
    ])
    const desktopGif = reach('desktop').elements.find((el) => el.name === 'Toggle' && attribute(el, 'label') === 'Include subtitles')
    expect(desktopGif && attribute(desktopGif, 'settingKey')).toBe('include-subtitles-in-gifs')
  })

  it('uses the keys English already derives, so search anchors do not move in English', () => {
    const en = JSON.parse(read('../../../../../messages/en.json')) as Record<string, string>
    expect(keyForSetting(en.player_autoplay_next)).toBe('auto-play-next-episode')
    expect(keyForSetting(en.player_up_next_overlay)).toBe('show-up-next-countdown')
    expect(keyForSetting(en.player_series_rating_prompt)).toBe('ask-for-a-rating-when-a-series-ends')
    expect(keyForSetting('Include subtitles in GIFs')).toBe('include-subtitles-in-gifs')
  })
})
