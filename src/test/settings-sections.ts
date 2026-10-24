// Test-only helpers for Settings section pages (settings redesign P1). vitest has no Svelte plugin,
// so a section page is read through the compiler's AST: which <SettingsSubcategory> blocks it
// declares, in source order, and which row keys it renders as literal text.
import type { AST } from 'svelte/compiler'
import { importClosure, parseSvelte, readSvelteSource, walkTemplate } from './svelte-markup'

export interface SubcategoryNode {
  id: string
  /** Static text, true when bare, null when an expression, undefined when absent. */
  summary: string | true | null | undefined
  collapsible: boolean
  plain: boolean
  /** The block's own markup, for "this row sits in this subcategory" checks. */
  source: string
}

function attributeValue(node: AST.Component, name: string): string | true | null | undefined {
  const found = node.attributes.find((attribute): attribute is AST.Attribute => attribute.type === 'Attribute' && attribute.name === name)
  if (!found) return undefined
  if (found.value === true) return true
  const parts = Array.isArray(found.value) ? found.value : [found.value]
  return parts.every((part) => part.type === 'Text') ? parts.map((part) => (part as AST.Text).data).join('') : null
}

/** Every <SettingsSubcategory> in `file`, in source order (blocks inside {#if} included). */
export function subcategoriesOf(file: string): SubcategoryNode[] {
  const source = readSvelteSource(file)
  const found: SubcategoryNode[] = []
  walkTemplate(parseSvelte(file).fragment, (node) => {
    if (node.type !== 'Component' || node.name !== 'SettingsSubcategory') return
    found.push({
      id: String(attributeValue(node, 'id')),
      summary: attributeValue(node, 'summary'),
      collapsible: attributeValue(node, 'collapsible') !== undefined,
      plain: attributeValue(node, 'plain') !== undefined,
      source: source.slice(node.start, node.end),
    })
  })
  return found
}

/** The `section` of the first <SettingsSection> in `file`. */
export function sectionOf(file: string): string | true | null | undefined {
  let section: string | true | null | undefined
  walkTemplate(parseSvelte(file).fragment, (node) => {
    if (section === undefined && node.type === 'Component' && node.name === 'SettingsSection') section = attributeValue(node, 'section')
  })
  return section
}

/** Keys rendered as literal `settingKey="…"` / `data-setting-key="…"` by `file` and its .svelte imports. */
export function renderedSettingKeys(file: string): Set<string> {
  const keys = new Set<string>()
  for (const each of importClosure([file])) {
    for (const match of readSvelteSource(each).matchAll(/(?:data-setting-key|settingKey)="([^"]+)"/g)) keys.add(match[1])
  }
  return keys
}
