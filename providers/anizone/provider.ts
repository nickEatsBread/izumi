// Online-stream provider for a Laravel Livewire anime site that serves HLS with sidecar ASS
// subtitle tracks. Written against the site's observed behaviour (endpoints, DOM, wire protocol).
//
// Site shape, and why the code looks like this:
//  • Listing/search is a Livewire component. There is no query-string route for it — `?search=`
//    is rejected at the edge — so search MUST round-trip through POST /livewire/update, carrying
//    the page's CSRF token and the component snapshot. Session cookies are handled by the host's
//    extension HTTP client (it keeps a jar), so we only carry the token + snapshot ourselves.
//  • Titles are NOT in the markup. Cards render them client-side from an Alpine `x-data` blob, so
//    `img[alt]` and the detail `<h1>` are both EMPTY server-side. The readable title is the second
//    argument of the `getTitle(this.anmTitles, '…')` getter. See titleFromCard.
//  • Episode lists lazy-load: while a `$wire.loadMore()` sentinel is present, another Livewire
//    round-trip appends the next page. The returned HTML is cumulative, so we re-parse the whole
//    document each pass instead of concatenating.

const BASE = 'https://anizone.to'

interface SearchOpts { query?: string; dub?: boolean; year?: number }
interface SearchResult { id: string; title: string; url: string; subOrDub: string }
interface Episode { id: string; number: number; url: string; title: string }
interface VideoSubtitle { url: string; language: string; isDefault: boolean }
interface VideoSource { url: string; type: string; quality: string; subtitles: VideoSubtitle[] }
interface EpisodeServer { server: string; headers: Record<string, string>; videoSources: VideoSource[] }

// A wire session: the CSRF token plus the live component snapshot, both scraped from a page load.
interface Wire { token: string; snapshot: string }

/** Decode one level of JS string-literal escaping (`\\` stays an escape for the layer below,
 *  `\uXXXX` becomes its character). The card blob is HTML-escaped JS wrapping JSON wrapping
 *  more `\uXXXX` — decoding the wrong number of layers yields mojibake or a JSON parse error. */
function jsUnquote(s: string): string {
  let out = ''
  for (let i = 0; i < s.length;) {
    if (s[i] !== '\\') { out += s[i]; i += 1; continue }
    const n = s[i + 1]
    if (n === '\\') { out += '\\\\'; i += 2 }
    else if (n === 'u' && i + 6 <= s.length) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6 }
    else { out += n ?? ''; i += 2 }
  }
  return out
}

const unescapeUnicode = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

const decodeEntities = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/** The card's display title, read out of the Alpine getter's fallback argument. */
function titleFromCard(xData: string): string {
  const fallback = xData.match(/getTitle\(\s*this\.anmTitles\s*,\s*'([^']*)'\s*\)/)
  if (fallback) return decodeEntities(unescapeUnicode(jsUnquote(fallback[1]))).trim()
  // No getter (markup changed): fall back to the first value in the titles map.
  const blob = xData.match(/anmTitles:\s*JSON\.parse\('([^']*)'\)/)
  if (blob) {
    try {
      const map = JSON.parse(jsUnquote(blob[1])) as Record<string, string>
      const first = Object.values(map)[0]
      if (first) return decodeEntities(unescapeUnicode(first)).trim()
    } catch { /* fall through */ }
  }
  return ''
}

/** Slug of an /anime/<slug>[/<ep>] URL — our stable id for a title. */
const slugOf = (url: string) => (url.match(/\/anime\/([^/?#]+)/) ?? [])[1] ?? ''

class Provider {
  private wire: Wire | null = null

  getSettings() {
    // One server: the site hosts the stream itself, there are no embed hosts to enumerate.
    return { episodeServers: ['default'], supportsDub: false }
  }

  private async getText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { Referer: `${BASE}/`, 'Accept-Language': 'en-US,en;q=0.9' } })
    if (!res.ok) throw new Error(`GET ${res.status}`)
    return await res.text()
  }

  /** Scrape a CSRF token + component snapshot out of a rendered page. */
  private readWire(html: string): Wire {
    const token = (html.match(/data-csrf="([^"]+)"/) ?? [])[1] ?? ''
    // The listing/episode component is the one inside <main>; the layout nav also carries a
    // snapshot and picking that one makes every later update a no-op.
    const scope = html.slice(Math.max(0, html.indexOf('<main')))
    const raw = (scope.match(/wire:snapshot="([^"]+)"/) ?? [])[1] ?? ''
    return { token, snapshot: decodeEntities(raw) }
  }

  /** One Livewire round-trip. Returns the component's rendered HTML and advances the snapshot. */
  private async wireUpdate(wire: Wire, updates: Record<string, unknown>, calls: unknown[]): Promise<string> {
    const res = await fetch(`${BASE}/livewire/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Livewire': '1',
        Referer: `${BASE}/anime`,
        Origin: BASE,
      },
      body: JSON.stringify({
        _token: wire.token,
        components: [{ snapshot: wire.snapshot, updates, calls }],
      }),
    })
    if (!res.ok) throw new Error(`livewire ${res.status}`)
    const json = await res.json()
    const component = json?.components?.[0]
    if (!component) throw new Error('livewire: no component')
    // Carry the new snapshot forward — reusing a stale one makes the server discard the update.
    if (component.snapshot) wire.snapshot = typeof component.snapshot === 'string' ? component.snapshot : JSON.stringify(component.snapshot)
    return component?.effects?.html ?? ''
  }

  /** Parse anime cards out of listing/search markup. */
  private parseCards(html: string): SearchResult[] {
    const out: SearchResult[] = []
    const seen: Record<string, boolean> = {}
    LoadDoc(html).find('div[wire\\:key]').each((_, card) => {
      const href = card.find('a[href*="/anime/"]').first().attr('href') ?? ''
      const id = slugOf(href)
      if (!id || seen[id]) return
      const title = titleFromCard(card.attr('x-data') ?? '')
      if (!title) return
      seen[id] = true
      out.push({ id, title, url: href.startsWith('http') ? href : `${BASE}${href}`, subOrDub: 'sub' })
    })
    return out
  }

  async search(opts: SearchOpts): Promise<SearchResult[]> {
    const query = (opts?.query ?? '').trim()
    if (!query) return []
    const wire = this.readWire(await this.getText(`${BASE}/anime`))
    if (!wire.token || !wire.snapshot) return []
    this.wire = wire
    return this.parseCards(await this.wireUpdate(wire, { search: query }, []))
  }

  async findEpisodes(id: string): Promise<Episode[]> {
    const url = `${BASE}/anime/${id}`
    let html = await this.getText(url)
    const wire = this.readWire(html)
    // The list paginates behind an intersection sentinel. Each pass returns the FULL list, so keep
    // the newest document rather than appending. Bounded so a markup change can't spin forever.
    for (let i = 0; i < 25 && /x-intersect="\$wire\.loadMore\(\)"/.test(html); i++) {
      if (!wire.token || !wire.snapshot) break
      const next = await this.wireUpdate(wire, {}, [{ path: '', method: 'loadMore', params: [] }])
      if (!next) break
      html = next
    }
    const out: Episode[] = []
    LoadDoc(html).find('li[x-data]').each((_, li) => {
      const href = li.find('a[href]').first().attr('href') ?? ''
      const number = Number((href.match(/\/anime\/[^/]+\/(\d+(?:\.\d+)?)/) ?? [])[1])
      if (!href || !isFinite(number)) return
      // "Episode 12: The Title" → "The Title"; a bare "Episode 12" has nothing after the colon.
      const heading = li.find('h3').first().text().trim()
      const title = heading.includes(':') ? heading.slice(heading.indexOf(':') + 1).trim() : heading
      out.push({ id: href.startsWith('http') ? href : `${BASE}${href}`, number, url: href, title })
    })
    return out
  }

  async findEpisodeServer(episode: { id?: string; url?: string }, _server: string): Promise<EpisodeServer> {
    const url = episode?.id ?? episode?.url ?? ''
    const empty: EpisodeServer = { server: 'default', headers: {}, videoSources: [] }
    if (!url) return empty
    const doc = LoadDoc(await this.getText(url))
    const player = doc.find('media-player').first()
    const src = player.attr('src') ?? ''
    if (!src) return empty
    const subtitles: VideoSubtitle[] = []
    // Sidecar tracks are usually .ass — libass renders them, so pass them straight through.
    player.find('track').each((_, t) => {
      const s = t.attr('src')
      if (!s) return
      subtitles.push({
        url: s,
        language: t.attr('label') || t.attr('srclang') || 'Subtitles',
        isDefault: t.attr('default') != null,
      })
    })
    // The stream host checks Referer; without it the CDN answers 403.
    return {
      server: doc.find('span.truncate').first().text().trim() || 'default',
      headers: { Referer: `${BASE}/` },
      videoSources: [{ url: src, type: /\.m3u8(\?|$)/i.test(src) ? 'm3u8' : 'mp4', quality: 'auto', subtitles }],
    }
  }
}
