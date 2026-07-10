// Shim for the globals Seanime onlinestream-provider payloads expect from Seanime's goja runtime,
// so they run unmodified in izumi's Web Worker. Installed on `self` by worker.ts for kind:"seanime".
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio'

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
