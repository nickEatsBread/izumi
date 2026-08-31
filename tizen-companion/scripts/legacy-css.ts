import type { Plugin } from 'postcss'

function splitFunctionArguments(value: string): string[] {
  const argumentsList: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) {
      argumentsList.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  argumentsList.push(value.slice(start).trim())
  return argumentsList
}

function replaceFunction(value: string, name: string, fallbackIndex: number): string {
  const marker = `${name}(`
  let output = value
  let offset = 0
  while ((offset = output.indexOf(marker, offset)) !== -1) {
    let depth = 1
    let end = offset + marker.length
    while (end < output.length && depth > 0) {
      if (output[end] === '(') depth += 1
      else if (output[end] === ')') depth -= 1
      end += 1
    }
    if (depth !== 0) break
    const argumentsList = splitFunctionArguments(output.slice(offset + marker.length, end - 1))
    const replacement = argumentsList[fallbackIndex] ?? argumentsList[0]
    output = `${output.slice(0, offset)}${replacement}${output.slice(end)}`
    offset += replacement.length
  }
  return output
}

export function legacyFunctionFallback(value: string): string {
  let fallback = replaceFunction(value, 'clamp', 1)
  fallback = replaceFunction(fallback, 'min', 1)
  fallback = replaceFunction(fallback, 'max', 0)
  return fallback
}

function insetSides(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  const trimmed = value.trim()
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (/\s/.test(character) && depth === 0) {
      if (index > start) parts.push(trimmed.slice(start, index))
      while (/\s/.test(trimmed[index + 1] || '')) index += 1
      start = index + 1
    }
  }
  if (start < trimmed.length) parts.push(trimmed.slice(start))
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  return parts.slice(0, 4)
}

/** PostCSS compatibility layer for the WebKit engine shipped on Tizen 2.3 TVs. */
export function legacyTvCss(): Plugin {
  return {
    postcssPlugin: 'izumi-legacy-tv-css',
    Declaration(declaration) {
      if (/\b(?:clamp|min|max)\(/.test(declaration.value)) {
        const fallback = legacyFunctionFallback(declaration.value)
        if (fallback !== declaration.value) declaration.cloneBefore({ value: fallback })
      }
      if (declaration.prop === 'inset') {
        const [top, right, bottom, left] = insetSides(declaration.value)
        declaration.cloneBefore({ prop: 'top', value: top })
        declaration.cloneBefore({ prop: 'right', value: right })
        declaration.cloneBefore({ prop: 'bottom', value: bottom })
        declaration.cloneBefore({ prop: 'left', value: left })
      }
    },
  }
}

legacyTvCss.postcss = true
