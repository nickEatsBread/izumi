// Test-only helpers for source-contract tests over Svelte markup. Components are parsed with the
// Svelte compiler's modern AST instead of matched as text, so a rule can ask "is this <button>
// inside an inert preview" or "does this trap carry use:navLayer" without regex guesswork across
// attribute order, line breaks and {#if}/{#each}/{#snippet} blocks. Vitest has no Svelte plugin:
// parsing is all these tests can do with a component.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type AST } from 'svelte/compiler'

/** Absolute repository root (this file is src/test/svelte-markup.ts). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LIB_ROOT = fileURLToPath(new URL('../lib/', import.meta.url))

/** `value`: string = static text; true = bare attribute; null = an expression, a mixed
 *  `"a {b}"` value or a directive. `raw` is the attribute exactly as written. Directives are named
 *  `use:navLayer`, `bind:this`, `on:click`, `in:fade`, …; a spread is named `...`. */
export interface MarkupAttr { name: string; value: string | true | null; raw: string }

/** One element of a component's markup. `ancestors` is nearest-first and holds only elements:
 *  component boundaries are transparent (markup passed into <Foo> keeps its outer ancestors), and
 *  a snippet's markup is visited where the snippet is declared. */
export interface MarkupElement {
  file: string
  line: number
  name: string
  attrs: MarkupAttr[]
  ancestors: MarkupElement[]
  node: AST.RegularElement | AST.SvelteElement
}

export type TemplateNode = AST.Fragment['nodes'][number]
type ElementAttribute = AST.RegularElement['attributes'][number]

/** The file's text with CRLF normalised, so offsets, lines and multi-line matches agree. */
export function readSvelteSource(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

export function parseSvelteSource(source: string, file = 'inline.svelte'): AST.Root {
  return parse(source, { modern: true, filename: file })
}

export function parseSvelte(file: string): AST.Root {
  return parseSvelteSource(readSvelteSource(file), file)
}

/** 1-based line of `offset` in `source`. */
export function lineOf(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source.charCodeAt(index) === 10) line++
  }
  return line
}

/** The fragments directly under a template node, in source order. */
export function childFragments(node: TemplateNode): AST.Fragment[] {
  switch (node.type) {
    case 'IfBlock': return node.alternate ? [node.consequent, node.alternate] : [node.consequent]
    case 'EachBlock': return node.fallback ? [node.body, node.fallback] : [node.body]
    case 'AwaitBlock': return [node.pending, node.then, node.catch].filter((fragment): fragment is AST.Fragment => fragment !== null)
    case 'KeyBlock': return [node.fragment]
    case 'SnippetBlock': return [node.body]
    default: return 'fragment' in node && node.fragment ? [node.fragment] : []
  }
}

/** Depth-first over every template node under `fragment`: elements, components, blocks, tags. */
export function walkTemplate(fragment: AST.Fragment, visit: (node: TemplateNode) => void): void {
  for (const node of fragment.nodes) {
    visit(node)
    for (const child of childFragments(node)) walkTemplate(child, visit)
  }
}

const DIRECTIVE_PREFIX: Record<string, string> = {
  AnimateDirective: 'animate',
  BindDirective: 'bind',
  ClassDirective: 'class',
  LetDirective: 'let',
  OnDirective: 'on',
  StyleDirective: 'style',
  UseDirective: 'use',
}

function toAttr(source: string, attribute: ElementAttribute): MarkupAttr {
  const raw = source.slice(attribute.start, attribute.end)
  if (attribute.type === 'Attribute') {
    if (attribute.value === true) return { name: attribute.name, value: true, raw }
    const parts = Array.isArray(attribute.value) ? attribute.value : [attribute.value]
    const value = parts.every((part) => part.type === 'Text')
      ? parts.map((part) => (part as AST.Text).data).join('')
      : null
    return { name: attribute.name, value, raw }
  }
  if (attribute.type === 'SpreadAttribute') return { name: '...', value: null, raw }
  if (attribute.type === 'AttachTag') return { name: '@attach', value: null, raw }
  if (attribute.type === 'TransitionDirective') {
    const kind = attribute.intro && attribute.outro ? 'transition' : attribute.intro ? 'in' : 'out'
    return { name: `${kind}:${attribute.name}`, value: null, raw }
  }
  return { name: `${DIRECTIVE_PREFIX[attribute.type]}:${attribute.name}`, value: null, raw }
}

/** Every element of `source` in document order (see MarkupElement). */
export function markupElementsFromSource(source: string, file = 'inline.svelte'): MarkupElement[] {
  const elements: MarkupElement[] = []
  const visit = (fragment: AST.Fragment, ancestors: MarkupElement[]) => {
    for (const node of fragment.nodes) {
      if (node.type === 'RegularElement' || node.type === 'SvelteElement') {
        const element: MarkupElement = {
          file,
          line: lineOf(source, node.start),
          name: node.name,
          attrs: node.attributes.map((attribute) => toAttr(source, attribute)),
          ancestors,
          node,
        }
        elements.push(element)
        visit(node.fragment, [element, ...ancestors])
        continue
      }
      for (const child of childFragments(node)) visit(child, ancestors)
    }
  }
  visit(parseSvelteSource(source, file).fragment, [])
  return elements
}

export function markupElements(file: string): MarkupElement[] {
  return markupElementsFromSource(readSvelteSource(file), file)
}

export function attr(el: MarkupElement, name: string): MarkupAttr | undefined {
  return el.attrs.find((candidate) => candidate.name === name)
}

/** Present in any written form (static, bare, expression). A spread never counts. */
export function hasAttr(el: MarkupElement, name: string): boolean {
  return el.attrs.some((candidate) => candidate.name === name)
}

/** The attribute's static text, or undefined when it is missing, bare or an expression. */
export function staticAttr(el: MarkupElement, name: string): string | undefined {
  const value = attr(el, name)?.value
  return typeof value === 'string' ? value : undefined
}

export function hasSpread(el: MarkupElement): boolean {
  return hasAttr(el, '...')
}

export function descendantsOf(el: MarkupElement, elements: readonly MarkupElement[]): MarkupElement[] {
  return elements.filter((candidate) => candidate.ancestors.includes(el))
}

const SVELTE_IMPORT = /(?:import|export)\s[^'"]*?\sfrom\s+['"]([^'"]+\.svelte)['"]/g

function resolveImport(from: string, specifier: string): string | null {
  if (specifier.startsWith('$lib/')) return resolve(LIB_ROOT, specifier.slice('$lib/'.length))
  if (specifier.startsWith('./') || specifier.startsWith('../')) return resolve(dirname(from), specifier)
  return null
}

/** The .svelte files reachable from `entries` through static `import … from '….svelte'` (and
 *  `export … from`) with `$lib/…` or relative specifiers, plus `extras`: absolute, deduplicated,
 *  sorted. */
export function importClosure(entries: string[], extras: string[] = []): string[] {
  const seen = new Set<string>()
  const queue = [...entries, ...extras].map((file) => resolve(file))
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of readSvelteSource(file).matchAll(SVELTE_IMPORT)) {
      const target = resolveImport(file, match[1])
      if (target && existsSync(target)) queue.push(target)
    }
  }
  return [...seen].sort()
}

/** Every .svelte file under `directory`, absolute and sorted. */
export function svelteFilesUnder(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...svelteFilesUnder(path))
    else if (name.endsWith('.svelte')) files.push(resolve(path))
  }
  return files.sort()
}

/** `file` relative to the repository root with forward slashes, for readable failures. */
export function repoRelative(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/')
}
