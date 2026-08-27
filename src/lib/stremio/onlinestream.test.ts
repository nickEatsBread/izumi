import { describe, it, expect } from 'vitest'
import {
  allowedByLanguage,
  langRank,
  matchesPreferredLang,
  passesForAudio,
  pickEpisode,
  pickSearchResult,
  providerEpisodeLabel,
  searchQueries,
  searchTitleScore,
  providerProblemText,
  videoSourceToStream,
} from './onlinestream'
import { describe as describeStream } from './parse'
import { rankStreams, pickBest } from './addon'

// Provider content language. A catalog is typically half non-English, and the picker auto-selects
// the first row — so an unlabelled foreign provider plays with foreign subtitles unannounced.
describe('provider language', () => {
  it('matches the ISO 639-1 manifest code against the ISO 639-2 setting', () => {
    expect(matchesPreferredLang('en', 'eng')).toBe(true)
    expect(matchesPreferredLang('EN', 'eng')).toBe(true)
    expect(matchesPreferredLang('ja', 'jpn')).toBe(true)
    expect(matchesPreferredLang('fr', 'eng')).toBe(false)
  })

  it('treats an undeclared language as unknown, not as a mismatch', () => {
    expect(matchesPreferredLang(undefined, 'eng')).toBe(false)
    // Ranked between "preferred" and "wrong language" so it stays ahead of a known-foreign source.
    expect(langRank(undefined, 'eng')).toBe(1)
    expect(langRank('en', 'eng')).toBe(0)
    expect(langRank('fr', 'eng')).toBe(2)
  })

  it('renders the language as a real badge, not inside the row name', () => {
    // The row name is never displayed — the picker builds its pills from describe(). A language
    // baked into `name` was therefore invisible, which is how an Italian source read as just "SUB".
    const s = videoSourceToStream({ url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'vidmoly', {}, 'AnimeUnity', 'Ep 3', 'sub', 'animeunity', 'it', true)
    expect(s.__lang).toBe('it')
    expect(s.__langMismatch).toBe(true)
    const info = describeStream(s)
    expect(info.badges).toContain('IT')
    expect(info.badges).toContain('SUB')
    expect(info.langMismatch).toBe(true)
  })

  it('marks a preferred-language source as no mismatch but still badges it', () => {
    const s = videoSourceToStream({ url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'srv', {}, 'AnimePahe', 'Ep 3', 'sub', 'animepahe', 'en', false)
    expect(describeStream(s).badges).toContain('EN')
    expect(describeStream(s).langMismatch).toBe(false)
  })

  it('orders preferred first, unknown next, foreign last — without dropping any', () => {
    const provs = [{ lang: 'it' }, { lang: undefined }, { lang: 'fr' }, { lang: 'en' }]
    const sorted = [...provs].sort((a, b) => langRank(a.lang, 'eng') - langRank(b.lang, 'eng'))
    expect(sorted.map((p) => p.lang)).toEqual(['en', undefined, 'it', 'fr'])
    expect(sorted).toHaveLength(provs.length)
  })

  it('keeps the server in the row name', () => {
    const s = videoSourceToStream({ url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'vidmoly', {}, 'AnimeSama', 'Ep 1', 'sub', 'animesamaanime', 'fr', true)
    expect(s.name).toBe('⚡ AnimeSama · vidmoly · 1080p')
  })

  it('carries Referer-gated subtitle headers instead of dropping them', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/z.m3u8', type: 'm3u8', quality: '720p', subtitles: [{ url: 'https://s/f.ass', label: 'Français', headers: { Referer: 'https://site/' } }] },
      'srv', {}, 'ProviderZ', undefined, 'sub', 'provider-z',
    )
    expect(s.__subtitles).toEqual([
      { url: 'https://s/f.ass', lang: 'fre', title: 'Français', isDefault: false, headers: { Referer: 'https://site/' }, kind: undefined, switchUrl: undefined },
    ])
  })

  it('keeps an unrecognizable label as the title and leaves lang unset', () => {
    // Real label from a live provider. Auto-select must NOT fire on a guess.
    const s = videoSourceToStream(
      { url: 'https://cdn/a.m3u8', type: 'm3u8', quality: 'auto', subtitles: [{ url: 'https://s/a.ass', label: 'wowmdildo {+Eternal Blizzard}', isDefault: true }] },
      'srv', {}, 'AniZone', undefined, 'sub', 'anizone',
    )
    expect(s.__subtitles?.[0].lang).toBeUndefined()
    expect(s.__subtitles?.[0].title).toBe('wowmdildo {+Eternal Blizzard}')
    expect(s.__subtitles?.[0].isDefault).toBe(true)
  })

  it('drops an unnamed "default" server rather than printing it', () => {
    const s = videoSourceToStream({ url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'default', {}, 'AniZone', 'Ep 1', 'sub', 'anizone', '')
    expect(s.name).toBe('⚡ AniZone · 1080p')
  })

  it('leaves the row name unchanged when there is no badge', () => {
    const s = videoSourceToStream({ url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'vidmoly', {}, 'AnimePahe', 'Ep 1', 'sub', 'animepahe', '')
    expect(s.name).toBe('⚡ AnimePahe · vidmoly · 1080p')
  })
})

describe('language allowlist', () => {
  it('treats an empty allowlist as "all"', () => {
    expect(allowedByLanguage('it', [])).toBe(true)
    expect(allowedByLanguage(undefined, [])).toBe(true)
  })

  it('keeps only the chosen languages', () => {
    expect(allowedByLanguage('en', ['en', 'ja'])).toBe(true)
    expect(allowedByLanguage('it', ['en', 'ja'])).toBe(false)
  })

  it('is case insensitive on both sides', () => {
    expect(allowedByLanguage('EN', ['en'])).toBe(true)
    expect(allowedByLanguage('en', ['EN'])).toBe(true)
  })

  it('never drops a provider that declares no language', () => {
    // Missing metadata is not a mismatch — dropping it would lose working sources silently.
    expect(allowedByLanguage(undefined, ['en'])).toBe(true)
  })
})

describe('audio filter', () => {
  it('leaves the provider-driven choice alone on "both"', () => {
    expect(passesForAudio([false, true], 'both')).toEqual([false, true])
    expect(passesForAudio([false], 'both')).toEqual([false])
  })

  it('narrows to the requested flavour', () => {
    expect(passesForAudio([false, true], 'sub')).toEqual([false])
    expect(passesForAudio([false, true], 'dub')).toEqual([true])
  })

  it('yields nothing when the provider cannot serve the requested flavour', () => {
    // A sub-only provider under "Dubbed only" is skipped rather than queried for discarded results.
    expect(passesForAudio([false], 'dub')).toEqual([])
    expect(passesForAudio([true], 'sub')).toEqual([])
  })
})

// The reported failure: an Italian provider was auto-selected as BEST and the episode played with
// Italian subtitles. Every direct-stream row is `instant` with quality "auto", so cache tier and
// quality tie and the language has to break it.
describe('foreign-language sources cannot win the pick', () => {
  const row = (name: string, lang: string | undefined, mismatch: boolean, quality = '1080p') =>
    videoSourceToStream({ url: `https://cdn/${name}.m3u8`, type: 'm3u8', quality }, 'srv', {}, name, 'Ep 3', 'sub', name, lang, mismatch)

  it('ranks a preferred-language source above a foreign one', () => {
    const italian = row('AnimeUnity', 'it', true)
    const english = row('AnimeHeaven', 'en', false)
    expect(rankStreams([italian, english]).map((s) => s.__addonName)).toEqual(['AnimeHeaven', 'AnimeUnity'])
  })

  it('never auto-picks a foreign source when a preferred one exists, even at lower quality', () => {
    const italian = row('AnimeUnity', 'it', true, '1080p')
    const english = row('AnimeHeaven', 'en', false, '720p')
    expect(pickBest([italian, english], 'any')?.__addonName).toBe('AnimeHeaven')
    // Asking for 1080p must still not drag in the Italian one.
    expect(pickBest([italian, english], '1080')?.__addonName).toBe('AnimeHeaven')
  })

  it('still picks a foreign source when it is the only one', () => {
    const italian = row('AnimeUnity', 'it', true)
    expect(pickBest([italian], 'any')?.__addonName).toBe('AnimeUnity')
  })

  it('leaves language-less rows (torrents) unreordered', () => {
    const a = { url: 'https://t/a', name: 'A', __addonName: 'A' } as never
    const b = { url: 'https://t/b', name: 'B', __addonName: 'B' } as never
    expect(rankStreams([a, b]).map((s) => s.__addonName)).toEqual(['A', 'B'])
  })
})

describe('pickSearchResult', () => {
  const results = [
    { id: 'a', title: 'Some Other Show' },
    { id: 'b', title: 'Sousou no Frieren' },
    { id: 'c', title: 'Frieren: Beyond Journey' },
  ]
  it('picks the best token-overlap match', () => {
    const best = pickSearchResult(results, ['Frieren: Beyond Journey’s End', 'Sousou no Frieren'])
    expect(best?.id === 'b' || best?.id === 'c').toBe(true)
  })
  it('returns undefined when nothing overlaps', () => {
    expect(pickSearchResult(results, ['One Piece'])).toBeUndefined()
  })
  it('returns undefined for empty results', () => {
    expect(pickSearchResult([], ['Frieren'])).toBeUndefined()
  })

  it('rejects the real weak AniDB results returned for Lovely Day', () => {
    const anidb = [
      { id: 'a', title: 'Zettai Karen Children: Oobanburumai! Natsuko to Hotaru no B.A.B.E.L. Tsuushin' },
      { id: 'b', title: 'Jubei-chan the Ninja Girl: Secret of the Lovely Eyepatch' },
      { id: 'c', title: 'Lovely★Complex' },
      { id: 'd', title: 'Zettai Karen Children OVA: Aitazousei! Ubawareta Mirai?' },
    ]
    expect(pickSearchResult(anidb, ['Lovely Day: Boku to Kanojo no Nanoka Kan'])).toBeUndefined()
  })

  it('does not combine unrelated words from separate aliases into a fake match', () => {
    const results = [{ id: 'wrong', title: 'Alpha Gamma Show' }]
    expect(pickSearchResult(results, ['Alpha Beta', 'Gamma Delta'])).toBeUndefined()
  })

  it('rejects a different production even when the base title matches', () => {
    expect(searchTitleScore('One Piece Film Red', ['One Piece'])).toBe(0)
    expect(searchTitleScore('Jujutsu Kaisen 2nd Season', ['Jujutsu Kaisen'])).toBe(0)
  })

  it('accepts exact aliases and harmless provider presentation suffixes', () => {
    expect(searchTitleScore('Sousou no Frieren', ['Frieren: Beyond Journey’s End', 'Sousou no Frieren'])).toBeGreaterThan(0)
    expect(searchTitleScore('Bleach (Dub)', ['Bleach'])).toBeGreaterThan(0)
  })

  it('queries unique aliases in primary-to-fallback order', () => {
    expect(searchQueries(['Frieren', 'frieren', 'Sousou no Frieren', ''])).toEqual([
      'Frieren',
      'Sousou no Frieren',
    ])
  })

  it('labels rows with the provider match rather than the requested media title', () => {
    expect(providerEpisodeLabel('Sousou no Frieren', 2, 'Episode 2')).toBe('Sousou no Frieren — Episode 2')
    expect(providerEpisodeLabel('Sousou no Frieren', 2, 'The Journey')).toBe(
      'Sousou no Frieren — Episode 2 · The Journey',
    )
  })
})

describe('pickEpisode', () => {
  const eps = [{ id: '1', number: 1 }, { id: '2', number: 2 }, { id: '3', number: 3 }]
  it('finds by episode number', () => {
    expect(pickEpisode(eps, 2)?.id).toBe('2')
  })
  it('undefined when absent', () => {
    expect(pickEpisode(eps, 99)).toBeUndefined()
  })
})

describe('videoSourceToStream', () => {
  it('retains upstream order as weak evidence', () => {
    const stream = videoSourceToStream(
      { url: 'https://s/v.m3u8', type: 'm3u8', quality: '1080p' },
      'srv', {}, 'Provider', 'Episode 1', 'sub', 'provider-id', 'en', false, 'eng', 'Show', 4,
    )
    expect(stream.__evidence).toEqual({ upstreamRank: 4 })
  })

  it('preserves the explicit JVM host-server marker without inferring it from every localhost URL', () => {
    const hosted = videoSourceToStream(
      { url: 'http://127.0.0.1:43123/video', localServer: true },
      'AnimePahe', {}, 'AnimePahe',
    )
    const privateProxy = videoSourceToStream(
      { url: 'http://127.0.0.1:43124/video' },
      'Izumi proxy', {}, 'Izumi proxy',
    )
    expect(hosted.__hosted).toBe(true)
    expect(privateProxy.__hosted).toBeUndefined()
  })

  it('preserves per-source headers and split audio tracks', () => {
    const stream = videoSourceToStream(
      {
        url: 'https://cdn.example/video.m4s',
        quality: '1080p',
        headers: {},
        audioTracks: [{
          url: 'https://cdn.example/audio.m4s',
          language: 'ja',
          title: 'Japanese',
        }],
      },
      'default',
      { Referer: 'https://embed.example/' },
      'AllAnime',
    )
    expect(stream.__headers).toEqual({})
    expect(stream.__audioTracks).toEqual([{
      url: 'https://cdn.example/audio.m4s',
      lang: 'jpn',
      title: 'Japanese',
      headers: undefined,
      switchUrl: undefined,
    }])
  })

  it('maps a VideoSource to a direct streaming Stream', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/x.m3u8', type: 'm3u8', quality: '1080p', subtitles: [{ url: 'https://s/en.vtt', lang: 'en' }] },
      'server-1', { Referer: 'https://site' }, 'ProviderX', 'The Journey', 'sub', 'provider-x',
      undefined, undefined, undefined, 'Sousou no Frieren',
    )
    expect(s.url).toBe('https://cdn/x.m3u8')
    expect(s.__stream).toBe(true)
    expect(s.__manifest).toBe('hls')
    expect(s.__headers).toEqual({ Referer: 'https://site' })
    // `lang` is normalized to an ISO code so mpv's `slang` can match it; `title` keeps the label.
    expect(s.__subtitles).toEqual([{ url: 'https://s/en.vtt', lang: 'eng', title: 'en', isDefault: false, headers: undefined, kind: undefined, switchUrl: undefined }])
    expect(s.__audio).toBe('sub')
    expect(s.__addonName).toBe('ProviderX')
    expect(s.__sourceTitle).toBe('Sousou no Frieren')
    expect(s.__origin).toEqual({ kind: 'online-extension', id: 'provider-x', name: 'ProviderX' })
    expect(s.name).toContain('ProviderX')
    expect(s.name).toContain('1080p')
    expect(s.behaviorHints?.filename).toContain('The Journey')
  })

  it('uses the individual JVM server and audio flavour instead of the provider wrapper', () => {
    const s = videoSourceToStream(
      {
        url: 'https://cdn/hd.m3u8',
        type: 'm3u8',
        quality: '1080p',
        server: 'HD-1',
        audio: 'dub',
        subtitleMode: 'soft',
      },
      'legacy provider',
      {},
      'legacy provider',
      'Episode 3',
      'sub',
    )
    expect(s.__server).toBe('HD-1')
    expect(s.__audio).toBe('dub')
    expect(s.__subtitleMode).toBe('soft')
    expect(s.name).toContain('HD-1')
    expect(describeStream(s).server).toBe('HD-1')
  })

  it('selects a matching preferred soft subtitle when the provider omitted a default', () => {
    const s = videoSourceToStream(
      {
        url: 'https://cdn/hd.m3u8',
        type: 'm3u8',
        quality: '1080p',
        subtitleMode: 'soft',
        subtitles: [
          { url: 'https://s/es.vtt', label: 'Spanish' },
          { url: 'https://s/en.vtt', label: 'English' },
        ],
      },
      'HD-1',
      {},
      'legacy provider',
      undefined,
      'sub',
      undefined,
      'en',
      false,
      'eng',
    )
    expect(s.__subtitles?.map((track) => track.isDefault)).toEqual([false, true])
    expect(describeStream(s).badges).toContain('CC 2')
    expect(describeStream(s).subtitleLabel).toContain('2 selectable subtitles')
  })

  it('does not select an external subtitle when subtitles are disabled', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/hd.m3u8', subtitles: [{ url: 'https://s/en.vtt', label: 'English' }] },
      'HD-1',
      {},
      'legacy provider',
      undefined,
      'sub',
      undefined,
      'en',
      false,
      'none',
    )
    expect(s.__subtitles?.[0].isDefault).toBe(false)
  })

  it('labels hard subtitles explicitly rather than implying a missing soft track', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/hard.m3u8', subtitleMode: 'hard' },
      'HD-1',
      {},
      'legacy provider',
    )
    const info = describeStream(s)
    expect(info.badges).toContain('HARDSUB')
    expect(info.subtitleLabel).toBe('Hard subtitles (burned into video)')
  })

  it('normalizes the SDK subtitle shape (language + isDefault) and dub audio', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/y.m3u8', type: 'm3u8', quality: 'auto', subtitles: [{ url: 'https://s/e.vtt', language: 'en', isDefault: true }] },
      'srv', {}, 'ProviderY', undefined, 'dub',
    )
    expect(s.__subtitles).toEqual([{ url: 'https://s/e.vtt', lang: 'eng', title: 'en', isDefault: true, headers: undefined, kind: undefined, switchUrl: undefined }])
    expect(s.__audio).toBe('dub')
    // no episode title → a sensible direct-stream filename
    expect(s.behaviorHints?.filename).toContain('Direct')
  })

  it('keeps a provider LAN playback equivalent separate from the local source', () => {
    const s = videoSourceToStream(
      {
        url: 'http://127.0.0.1:17871/v/local/manifest.mpd',
        drm: { licenseUrl: 'http://127.0.0.1:17871/v/local/license' },
        share: {
          url: 'http://192.168.1.8:17871/share/cap/v/local/manifest.mpd',
          drm: {
            keySystem: 'com.widevine.alpha',
            licenseUrl: 'http://192.168.1.8:17871/share/cap/v/local/license',
          },
          subtitles: [{
            url: 'http://192.168.1.8:17871/share/cap/v/local/asset?u=en',
            language: 'en-US',
          }],
        },
      },
      'LocalService', {}, 'LocalService',
    )
    expect(s.url).toContain('127.0.0.1')
    expect(s.__party).toMatchObject({
      url: expect.stringContaining('192.168.1.8'),
      __drm: { keySystem: 'com.widevine.alpha', licenseUrl: expect.stringContaining('/share/cap/') },
      __subtitles: [{ lang: 'en-US' }],
    })
  })
})

// The runtime reports a provider failure as a plain message, but Rust re-serializes the
// `status: "error"` form as a JSON string. Both must read as one clean line in the picker.
describe('providerProblemText', () => {
  it('unwraps a JSON-quoted runtime error', () => {
    expect(providerProblemText('"Failed to load items, please log in to google drive through webview"'))
      .toBe('Failed to load items, please log in to google drive through webview')
  })

  it('keeps only the first line of a stack-carrying message', () => {
    expect(providerProblemText(new Error('boom\n\tat Foo.bar(Unknown Source)'))).toBe('boom')
    // Rust hands the JSON form back with the newline still ESCAPED, so it isn't a line break yet.
    expect(providerProblemText(String.raw`boom\n\tat Foo.bar`)).toBe('boom at Foo.bar')
  })

  it('truncates a runaway message rather than blowing out the row', () => {
    const text = providerProblemText('x'.repeat(500))
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text.endsWith('…')).toBe(true)
  })
})
