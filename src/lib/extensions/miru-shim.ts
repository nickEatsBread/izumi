// Runtime shim for a second community extension format, so izumi can run those extensions
// unmodified. izumi ships none of them: the user adds a catalog URL and picks what to install.
//
// Their host injects an `Extension` base class into a JS runtime and answers a handful of messages
// (request / querySelector / getSetting / registerSetting). This reimplements that base class on
// top of izumi's Worker primitives — the bridged `fetch` (CORS-free, forwards Referer/Origin/Cookie
// and keeps a cookie jar) and cheerio — then adapts the result to izumi's onlinestream contract.
//
// Shapes below mirror the upstream base class exactly, including the parts that look odd:
// `request` CONCATENATES its argument onto a base URL rather than resolving it, and the element
// accessors are async getters. Deviating on either would break extensions that rely on them.
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as cheerio from 'cheerio'
import type { MiruMeta } from './miru-header'
export { isMiruExtension, parseMiruHeader, type MiruMeta } from './miru-header'

/** Which of the element accessors an extension asked for. */
type ElementOp = 'text' | 'outerHTML' | 'innerHTML'

/**
 * cheerio-backed stand-in for the host's element wrapper. `text`/`outerHTML`/`innerHTML` are
 * PROMISE-returning getters upstream (each was a round-trip to the host), and extensions `await`
 * them — so they stay async here even though cheerio is synchronous.
 */
export class MiruElement {
  constructor(private content: string | Promise<string>, private selector: string = '') {}

  private async run(op: ElementOp = 'outerHTML'): Promise<string> {
    const html = await this.content
    const $ = cheerio.load(html ?? '')
    const node = this.selector ? $(this.selector).first() : $.root()
    if (op === 'text') return node.text()
    if (op === 'innerHTML') return node.html() ?? ''
    return $.html(node)
  }

  get text(): Promise<string> { return this.run('text') }
  get outerHTML(): Promise<string> { return this.run('outerHTML') }
  get innerHTML(): Promise<string> { return this.run('innerHTML') }

  async querySelector(selector: string): Promise<MiruElement> {
    return new MiruElement(await this.run('outerHTML'), selector)
  }

  async getAttributeText(attr: string): Promise<string> {
    const html = await this.content
    const $ = cheerio.load(html ?? '')
    return (this.selector ? $(this.selector).first() : $.root()).attr(attr) ?? ''
  }

  async removeSelector(selector: string): Promise<MiruElement> {
    const $ = cheerio.load((await this.content) ?? '')
    $(selector).remove()
    this.content = $.html()
    return this
  }
}

/** The subset of the bridged fetch this shim needs. */
type BridgedFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

/** Build the `Extension` base class an extension's `export default class extends Extension` needs. */
export function createExtensionBase(meta: MiruMeta, doFetch: BridgedFetch): any {
  const site = meta.webSite ?? ''
  return class Extension {
    package = meta.package ?? ''
    name = meta.name ?? ''
    settingKeys: string[] = []

    async request(url: string, options: any = {}): Promise<any> {
      const headers: Record<string, string> = { ...(options.headers ?? {}) }
      // `Miru-Url` overrides the base for one call; upstream CONCATENATES rather than resolving,
      // and extensions depend on that (they pass an absolute URL plus an empty path).
      const base = headers['Miru-Url'] ?? site
      delete headers['Miru-Url'] // an internal marker — never send it to the site
      let target = `${base}${url ?? ''}`
      const qp = options.queryParameters
      if (qp && Object.keys(qp).length) {
        const qs = Object.entries(qp).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
        target += (target.includes('?') ? '&' : '?') + qs
      }
      const res = await doFetch(target, {
        method: String(options.method ?? 'get').toUpperCase(),
        headers,
        body: options.data != null ? (typeof options.data === 'string' ? options.data : JSON.stringify(options.data)) : undefined,
      })
      const body = await res.text()
      // Upstream returns parsed JSON when it parses and the raw body otherwise; extensions branch
      // on the result type, so both paths must behave the same way here.
      try { return JSON.parse(body) } catch { return body }
    }

    querySelector(content: string, selector: string): MiruElement {
      return new MiruElement(content, selector)
    }

    async querySelectorAll(content: string, selector: string): Promise<MiruElement[]> {
      const $ = cheerio.load(content ?? '')
      return $(selector).toArray().map((el) => new MiruElement($.html(el), ''))
    }

    async getAttributeText(content: string, selector: string, attr: string): Promise<string> {
      return new MiruElement(content, selector).getAttributeText(attr)
    }

    queryXPath(): never {
      // Rare, and cheerio has no XPath engine. Fail loudly rather than return silent nonsense.
      throw new Error('queryXPath is not supported')
    }

    // Upstream resolves a setting as `storedValue ?? defaultValue`. izumi has no per-extension
    // settings store, so there is never a stored value — but the DEFAULT still has to come back, or
    // an extension that reads a preference it registered gets undefined and takes a broken branch
    // (a quality preference, say, matching no source).
    private settingDefaults = new Map<string, unknown>()
    async getSetting(key: string): Promise<unknown> { return this.settingDefaults.get(key) }
    async registerSetting(settings: any): Promise<void> {
      if (!settings?.key) return
      this.settingKeys.push(settings.key)
      this.settingDefaults.set(settings.key, settings.value ?? settings.defaultValue)
    }
    async load(): Promise<void> {}

    popular(_page: number): never { throw new Error('not implement popular') }
    latest(_page: number): never { throw new Error('not implement latest') }
    search(_kw: string, _page?: number): never { throw new Error('not implement search') }
    detail(_url: string): never { throw new Error('not implement detail') }
    watch(_url: string): never { throw new Error('not implement watch') }
    checkUpdate(_url: string): never { throw new Error('not implement checkUpdate') }
  }
}

/** Episode number from a label like "Episode 12" / "EP 12" / "12", else undefined. */
export function episodeNumber(name: string | undefined, fallbackIndex: number): number {
  const n = name?.match(/(\d+(?:\.\d+)?)/)?.[1]
  const parsed = n != null ? Number(n) : NaN
  return Number.isFinite(parsed) ? parsed : fallbackIndex + 1
}

/**
 * Adapt an instantiated extension to izumi's onlinestream contract
 * (search → findEpisodes → getSettings → findEpisodeServer).
 *
 * `detail()` returns episodes GROUPED — a group per quality or mirror. izumi's episode model is one
 * id per episode, so the largest group is used (the most complete listing) rather than interleaving
 * groups into duplicate rows that all play the same episode.
 */
export function adaptMiru(ext: any): any {
  return {
    async search(opts: any) {
      // The third argument is a filter map. Upstream's UI always supplies one, and extensions that
      // support filtering mutate and iterate it immediately (`delete filter[...]`, `Object.entries`)
      // — omitting it makes those throw before they issue a single request. An empty map means
      // "no filters selected", which is exactly the unfiltered search we want.
      const list = await ext.search(opts?.query ?? '', 1, {})
      return (Array.isArray(list) ? list : []).map((x: any) => ({
        id: String(x?.url ?? ''),
        title: String(x?.title ?? ''),
        url: String(x?.url ?? ''),
      })).filter((x: any) => x.id && x.title)
    },

    async findEpisodes(id: string) {
      const detail = await ext.detail(id)
      const groups: any[] = Array.isArray(detail?.episodes) ? detail.episodes : []
      if (!groups.length) return []
      const best = groups.reduce((a, b) => ((b?.urls?.length ?? 0) > (a?.urls?.length ?? 0) ? b : a))
      const urls: any[] = Array.isArray(best?.urls) ? best.urls : []
      return urls.map((u: any, i: number) => ({
        id: String(u?.url ?? ''),
        url: String(u?.url ?? ''),
        number: episodeNumber(u?.name, i),
        title: u?.name ? String(u.name) : undefined,
      })).filter((e: any) => e.id)
    },

    async getSettings() {
      // One server: these extensions resolve a single playable URL per episode.
      return { episodeServers: ['default'], supportsDub: false }
    },

    async findEpisodeServer(episode: any, _server?: string) {
      const target = episode?.id ?? episode?.url ?? ''
      const empty = { server: 'default', headers: {}, videoSources: [] }
      if (!target) return empty
      const w = await ext.watch(target)
      const url = w?.url
      if (!url) return empty
      return {
        server: 'default',
        headers: w?.headers ?? {},
        videoSources: [{
          url: String(url),
          type: String(w?.type ?? '').toLowerCase() === 'hls' ? 'm3u8' : 'mp4',
          quality: 'auto',
          subtitles: (Array.isArray(w?.subtitles) ? w.subtitles : []).map((s: any) => ({
            url: String(s?.url ?? ''),
            language: s?.language ?? s?.title ?? s?.name,
          })).filter((s: any) => s.url),
        }],
      }
    },
  }
}
