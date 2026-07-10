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
