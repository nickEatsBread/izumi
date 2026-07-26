import { describe, it, expect } from 'vitest'
import { loadExtractor, loadEpisodeServer, extractorFor } from './registry'
import { findSources, findSubtitles, qualityOf, linkType } from './common'
import type { ExtractorFetch } from './types'

/** A fetch stub that serves canned pages and records the headers each request carried. */
function stubFetch(pages: Record<string, string>) {
  const calls: { url: string; headers?: Record<string, string> }[] = []
  const fetch: ExtractorFetch = async (url, init) => {
    calls.push({ url, headers: init?.headers })
    const body = pages[url]
    return {
      ok: body != null,
      status: body != null ? 200 : 404,
      url,
      text: async () => body ?? '',
      json: async () => JSON.parse(body ?? '{}'),
    }
  }
  return { fetch, calls }
}

describe('host matching', () => {
  it('claims known hosts, including subdomains', () => {
    expect(extractorFor('https://streamwish.to/e/abc')?.name).toBe('StreamWish')
    expect(extractorFor('https://www.mp4upload.com/embed-x.html')?.name).toBe('Mp4Upload')
    expect(extractorFor('https://cdn.filemoon.sx/e/y')?.name).toBe('Filemoon')
    expect(extractorFor('https://vidmoly.to/embed-z.html')?.name).toBe('Vidmoly')
    expect(extractorFor('https://streamtape.com/e/q')?.name).toBe('StreamTape')
    expect(extractorFor('https://d0o0d.com/e/w')?.name).toBe('DoodStream')
    expect(extractorFor('https://slwatch.co/e/r')?.name).toBe('StreamLare')
    expect(extractorFor('https://ok.ru/videoembed/1')?.name).toBe('OK.ru')
    expect(extractorFor('https://playtaku.net/streaming.php?id=x')?.name).toBe('GogoStream')
  })

  it('does not claim an unrelated host', () => {
    expect(extractorFor('https://example.com/e/abc')).toBeUndefined()
    expect(extractorFor('not a url')).toBeUndefined()
  })
})

describe('loadExtractor', () => {
  it('returns a direct media URL as-is without fetching', async () => {
    const { fetch, calls } = stubFetch({})
    const res = await loadExtractor('https://cdn.example/hls/master.m3u8', { fetch })
    expect(res.links).toHaveLength(1)
    expect(res.links[0]).toMatchObject({ url: 'https://cdn.example/hls/master.m3u8', type: 'm3u8', source: 'Direct' })
    expect(calls).toEqual([])
  })

  it('extracts a packed JWPlayer config and its subtitle track', async () => {
    // Shape hosts actually serve: the config only exists after the packed dictionary is restored.
    const inner = 'jwplayer("v").setup({sources:[{file:"https://cdn.wish/hls/master.m3u8",label:"1080p"}],tracks:[{file:"https://cdn.wish/sub/en.vtt",kind:"captions",label:"English"}]});'
    const packed = packSource(inner)
    const embed = 'https://streamwish.to/e/abc'
    const { fetch } = stubFetch({ [embed]: `<html><script>${packed}</script></html>` })
    const res = await loadExtractor(embed, { fetch, referer: 'https://provider.site/ep/1' })
    expect(res.links).toHaveLength(1)
    expect(res.links[0]).toMatchObject({ url: 'https://cdn.wish/hls/master.m3u8', type: 'm3u8', quality: '1080p', source: 'StreamWish' })
    expect(res.subtitles).toEqual([
      { url: 'https://cdn.wish/sub/en.vtt', label: 'English', headers: { Referer: embed, Origin: 'https://streamwish.to' } },
    ])
  })

  it('sends the provider page as Referer, which these CDNs gate on', async () => {
    const embed = 'https://vidmoly.to/embed-x.html'
    const { fetch, calls } = stubFetch({ [embed]: 'sources:[{file:"https://cdn.moly/v.mp4"}]' })
    await loadExtractor(embed, { fetch, referer: 'https://anime.site/ep/3' })
    expect(calls[0].headers?.Referer).toBe('https://anime.site/ep/3')
  })

  it('uses the embed URL as Referer for extracted media', async () => {
    const embed = 'https://www.mp4upload.com/embed-x.html'
    const { fetch } = stubFetch({ [embed]: 'player.src({src:"https://cdn.mp4upload.com/video.mp4"})' })
    const res = await loadExtractor(embed, { fetch, referer: 'https://allanime.day/' })
    expect(res.links[0].headers).toEqual({
      Referer: embed,
      Origin: 'https://www.mp4upload.com',
    })
  })

  it('falls back to the generic parser for an unknown host', async () => {
    // Embed domains rotate constantly; an unknown host should still resolve if it is the usual
    // JWPlayer config, rather than silently returning nothing.
    const embed = 'https://brand-new-mirror.xyz/e/abc'
    const { fetch } = stubFetch({ [embed]: 'sources: [{"file":"https://cdn.new/v/index.m3u8","label":"720p"}]' })
    const res = await loadExtractor(embed, { fetch })
    expect(res.links[0]).toMatchObject({ url: 'https://cdn.new/v/index.m3u8', quality: '720p', type: 'm3u8' })
  })

  it('resolves StreamTape\'s split-and-substring link', async () => {
    const embed = 'https://streamtape.com/e/abc'
    const page = `<div id="robotlink"></div><script>document.getElementById('robotlink').innerHTML = '//streamtape.com/get_video?id=abc' + 'XXXX&expires=99&stream=1'.substring(4);</script>`
    const { fetch } = stubFetch({ [embed]: page })
    const res = await loadExtractor(embed, { fetch })
    expect(res.links).toHaveLength(1)
    expect(res.links[0].url).toBe('https://streamtape.com/get_video?id=abc&expires=99&stream=1')
  })

  it('resolves StreamLare HLS variants through its API', async () => {
    const embed = 'https://slwatch.co/e/abc'
    const api = 'https://slwatch.co/api/video/stream/get'
    const master = 'https://cdn.streamlare.test/hls/master.m3u8'
    const { fetch, calls } = stubFetch({
      [api]: JSON.stringify({ type: 'hls', file: master }),
      [master]: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720/index.m3u8',
    })
    const res = await loadExtractor(embed, { fetch })
    expect(calls[0]).toMatchObject({ url: api })
    expect(res.links[0]).toMatchObject({
      url: 'https://cdn.streamlare.test/hls/720/index.m3u8',
      type: 'm3u8',
      quality: '720p',
      source: 'StreamLare',
    })
  })

  it('reads OK.ru direct qualities from data-options', async () => {
    const embed = 'https://ok.ru/videoembed/1'
    const options = '{&quot;videos&quot;:[{&quot;name&quot;:&quot;hd&quot;,&quot;url&quot;:&quot;https://cdn.ok.test/v.mp4&quot;}]}'
    const { fetch } = stubFetch({ [embed]: `<div data-options="${options}"></div>` })
    const res = await loadExtractor(embed, { fetch })
    expect(res.links[0]).toMatchObject({
      url: 'https://cdn.ok.test/v.mp4',
      quality: '720p',
      source: 'OK.ru',
    })
  })

  it('returns nothing rather than throwing when the page is unreachable', async () => {
    const { fetch } = stubFetch({})
    expect(await loadExtractor('https://streamwish.to/e/gone', { fetch })).toEqual({ links: [], subtitles: [] })
  })
})

describe('loadEpisodeServer', () => {
  it('names the row after the resolving host, in findEpisodeServer shape', async () => {
    const embed = 'https://vidmoly.to/embed-x.html'
    const { fetch } = stubFetch({ [embed]: 'sources:[{file:"https://cdn.moly/v/index.m3u8",label:"1080p"}]' })
    const res = await loadEpisodeServer(embed, { fetch, referer: 'https://anime.site/ep/3', extension: 'AnimeSama' })
    // This is the name that reaches the picker: "⚡ AnimeSama · FR · Vidmoly · 1080p".
    expect(res.server).toBe('Vidmoly')
    expect(res.headers).toMatchObject({ Referer: embed })
    expect(res.videoSources).toEqual([
      { url: 'https://cdn.moly/v/index.m3u8', type: 'm3u8', quality: '1080p', subtitles: [] },
    ])
  })

  it('attaches the embed\'s subtitles to the first source only', async () => {
    const embed = 'https://streamwish.to/e/abc'
    const page = 'sources:[{file:"https://c/1080.mp4",label:"1080p"},{file:"https://c/720.mp4",label:"720p"}],tracks:[{file:"https://c/en.vtt",kind:"captions",label:"English"}]'
    const { fetch } = stubFetch({ [embed]: page })
    const res = await loadEpisodeServer(embed, { fetch })
    expect(res.videoSources).toHaveLength(2)
    // The tracks belong to the embed, not to a rendition — duplicating them per source would add
    // the same subtitle to mpv once per quality.
    expect(res.videoSources[0].subtitles).toEqual([{ url: 'https://c/en.vtt', language: 'English', headers: expect.anything() }])
    expect(res.videoSources[1].subtitles).toEqual([])
  })

  it('falls back to the calling extension name so a row is never unlabelled', async () => {
    const { fetch } = stubFetch({})
    const res = await loadEpisodeServer('https://streamwish.to/e/gone', { fetch, extension: 'SomeProvider' })
    expect(res.server).toBe('SomeProvider')
    expect(res.videoSources).toEqual([])
  })

  it('labels an already-direct media URL as Direct', async () => {
    const { fetch } = stubFetch({})
    const res = await loadEpisodeServer('https://cdn.example/hls/master.m3u8', { fetch, extension: 'P' })
    expect(res.server).toBe('Direct')
    expect(res.videoSources[0].type).toBe('m3u8')
  })
})

describe('parsers', () => {
  it('reads quality from a label, then the URL, then falls back to auto', () => {
    expect(qualityOf('1080p', 'https://x/v.mp4')).toBe('1080p')
    expect(qualityOf(undefined, 'https://x/720p/v.m3u8')).toBe('720p')
    expect(qualityOf(undefined, 'https://x/v.mp4')).toBe('auto')
  })

  it('classifies containers', () => {
    expect(linkType('https://x/master.m3u8?t=1')).toBe('m3u8')
    expect(linkType('https://x/v.mpd')).toBe('dash')
    expect(linkType('https://x/v.mp4')).toBe('mp4')
  })

  it('dedupes repeated sources and unescapes JSON slashes', () => {
    const links = findSources('sources:[{file:"https:\\/\\/x\\/v.mp4"},{file:"https://x/v.mp4"}]', 'T', {})
    expect(links.map((l) => l.url)).toEqual(['https://x/v.mp4'])
  })

  it('ignores thumbnail tracks, which use the same field as subtitles', () => {
    const subs = findSubtitles('tracks:[{file:"https://x/thumbs.vtt",kind:"thumbnails"},{file:"https://x/en.vtt",kind:"captions",label:"English"}]', {})
    expect(subs.map((s) => s.url)).toEqual(['https://x/en.vtt'])
  })

  it('reads plain <track> elements too', () => {
    const subs = findSubtitles('<track src="https://x/fr.ass" kind="subtitles" label="Français">', {})
    expect(subs).toEqual([{ url: 'https://x/fr.ass', label: 'Français', headers: {} }])
  })
})

/** Minimal P.A.C.K.E.R. encoder so the extractor test exercises a genuinely packed page. */
function packSource(source: string, base = 62): string {
  const words = Array.from(new Set(source.match(/\b\w+\b/g) ?? []))
  const symbol = (n: number): string => {
    const digit = (c: number) => (c > 35 ? String.fromCharCode(c + 29) : c.toString(36))
    return (n < base ? '' : symbol(Math.floor(n / base))) + digit(n % base)
  }
  let payload = source
  words.forEach((w, i) => { payload = payload.replace(new RegExp(`\\b${w}\\b`, 'g'), symbol(i)) })
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('${esc(payload)}',${base},${words.length},'${esc(words.join('|'))}'.split('|'),0,{}))`
}
