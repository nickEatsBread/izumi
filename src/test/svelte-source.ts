/**
 * The whole opening tag containing `index`. Naive `[^>]*>` does not work here: Svelte
 * attributes hold arrow functions (`onclick={() => toggle(url)}`), so `>` appears inside
 * the tag. Track quotes and brace depth instead.
 */
export function openingTagAt(source: string, index: number): string {
  const start = source.lastIndexOf('<', index)
  let depth = 0
  let quote = ''
  let i = start + 1
  for (; i < source.length; i++) {
    const char = source[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) break
  }
  return source.slice(start, i + 1)
}
