// Shim for the globals Seanime onlinestream-provider payloads expect from Seanime's goja runtime,
// so they run unmodified in izumi's Web Worker. Installed on `self` by worker.ts for kind:"seanime".
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio'
import CryptoJSLib from 'crypto-js'
import { transform } from 'sucrase'

// goquery-shaped selection wrapper over cheerio. Matches Seanime's DocSelection surface — notably,
// each()/map()/filter() callbacks receive a WRAPPED DocSelection (single element), not a raw node.
export class DocSelection {
  constructor(private $: cheerio.CheerioAPI, private sel: cheerio.Cheerio<any>) {}
  private wrap(sel: cheerio.Cheerio<any>) { return new DocSelection(this.$, sel) }

  find(selector: string) { return this.wrap(this.sel.find(selector)) }
  children(selector?: string) { return this.wrap(this.sel.children(selector)) }
  parent() { return this.wrap(this.sel.parent()) }
  parents(selector?: string) { return this.wrap(this.sel.parents(selector)) }
  closest(selector: string) { return this.wrap(this.sel.closest(selector)) }
  first() { return this.wrap(this.sel.first()) }
  last() { return this.wrap(this.sel.last()) }
  eq(index: number) { return this.wrap(this.sel.eq(index)) }
  next() { return this.wrap(this.sel.next()) }
  prev() { return this.wrap(this.sel.prev()) }
  siblings(selector?: string) { return this.wrap(this.sel.siblings(selector)) }
  has(selector: string) { return this.wrap(this.sel.has(selector)) }

  filter(selector: string | ((index: number, element: DocSelection) => boolean)) {
    if (typeof selector === 'string') return this.wrap(this.sel.filter(selector))
    return this.wrap(this.sel.filter((i: number, el: any) => selector(i, new DocSelection(this.$, this.$(el)))))
  }

  attr(name: string): string | undefined { return this.sel.attr(name) }
  attrs(): Record<string, string> { return (this.sel.attr() as any) ?? {} }
  text(): string { return this.sel.text() }
  html(): string { return this.sel.html() ?? '' }
  is(selector: string): boolean { return this.sel.is(selector) }
  get length(): number { return this.sel.length }

  each(callback: (index: number, element: DocSelection) => void): DocSelection {
    this.sel.each((i: number, el: any) => callback(i, new DocSelection(this.$, this.$(el))))
    return this
  }
  map<T>(callback: (index: number, element: DocSelection) => T): T[] {
    return this.sel.map((i: number, el: any) => callback(i, new DocSelection(this.$, this.$(el)))).get() as T[]
  }
}

/** Parse an HTML string into a root DocSelection (Seanime `LoadDoc`). */
export function LoadDoc(html: string): DocSelection {
  const $ = cheerio.load(html)
  return new DocSelection($, $.root())
}

// Minimal Node-`Buffer` stand-in for the `Buffer.from(x, enc).toString(enc)` idiom providers use to
// decode base64 embed blobs. Backed by the Worker's atob/btoa + TextEncoder/Decoder.
class BufferShim {
  private constructor(private bytes: Uint8Array) {}
  static from(input: string, enc: string = 'utf8'): BufferShim {
    if (enc === 'base64') {
      const bin = atob(input.replace(/-/g, '+').replace(/_/g, '/'))
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return new BufferShim(arr)
    }
    if (enc === 'hex') {
      const arr = new Uint8Array(Math.floor(input.length / 2))
      for (let i = 0; i < arr.length; i++) arr[i] = parseInt(input.substr(i * 2, 2), 16)
      return new BufferShim(arr)
    }
    return new BufferShim(new TextEncoder().encode(input))
  }
  toString(enc: string = 'utf8'): string {
    if (enc === 'base64') {
      let bin = ''
      for (const b of this.bytes) bin += String.fromCharCode(b)
      return btoa(bin)
    }
    if (enc === 'hex') return Array.from(this.bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    return new TextDecoder().decode(this.bytes)
  }
}
export const Buffer = BufferShim

// crypto-js verbatim (AES/enc/mode/pad/MD5/…) — providers use it as-is to decrypt sources.
export const CryptoJS = CryptoJSLib

// Strip TypeScript types from a provider payload so it can run in the Worker (some Seanime payloads
// ship as raw .ts / .js-with-annotations). Type-strip only — payloads are self-contained (no imports).
// On any failure returns the ORIGINAL code, so plain JS always survives and a genuinely-broken payload
// still fails at the blob import (where it's caught), exactly as before.
export function transpileSeanime(code: string): string {
  try { return transform(code, { transforms: ['typescript'], production: true }).code }
  catch { return code }
}

// Minimal release-name parser for the $habari global that anime-torrent-provider extensions call.
// Extensions consume only { title, episode_number }, so extract those and skip everything else.
export const habari = {
  parse(name: string): { title: string; episode_number: number | undefined } {
    const raw = name ?? ''
    // Blank out tokens that must never be read as an episode (resolution, 4-digit year, bit depth).
    const deNoise = raw
      .replace(/\b(?:2160|1440|1080|720|480|360|240)p?\b/gi, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ')
      .replace(/\b(?:8|10)\s?-?bit\b/gi, ' ')
    const ep =
      deNoise.match(/\bS\d{1,2}\s?E(\d{1,4})\b/i)?.[1]
      ?? deNoise.match(/\bE(\d{1,4})\b/i)?.[1]
      ?? deNoise.match(/\bEp\.?\s*(\d{1,4})\b/i)?.[1]
      ?? deNoise.match(/\s-\s*(\d{1,4})(?:v\d)?\b/)?.[1]
    const episode_number = ep != null ? Number(ep) : undefined
    const title = raw
      .replace(/^\s*\[[^\]]*\]\s*/, '')       // leading [group]
      .replace(/[[(][^\])]*[\])]/g, ' ')      // any [..] / (..) tag
      .replace(/\bS\d{1,2}\s?E\d{1,4}\b.*$/i, ' ') // cut at SxxExx
      .replace(/\s-\s*\d{1,4}(?:v\d)?\b.*$/, ' ')  // cut at ' - NN'
      .replace(/[._]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return { title, episode_number }
  },
}

// anime-torrent-provider extensions read user-config values via $getUserPreference. izumi has no
// per-extension config store yet, so return undefined — providers fall back to their own defaults.
export function getUserPreference(_name: string): string | undefined {
  return undefined
}
