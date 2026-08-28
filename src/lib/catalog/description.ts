import { descriptionText } from '$lib/anilist/description'

export interface CatalogDescriptionFact {
  label: string
  value: string
}

export interface CatalogDescriptionLink {
  label: string
  url: string
}

export interface ParsedCatalogDescription {
  synopsis: string
  score?: number
  facts: CatalogDescriptionFact[]
  alternativeTitles: string[]
  links: CatalogDescriptionLink[]
}

const FACT_LABELS: Record<string, string> = {
  type: 'Type',
  season: 'Season',
  duration: 'Duration',
  rating: 'Content rating',
  'date aired': 'Aired',
  'date ended': 'Ended',
}

const METADATA_MARKER = /\*\*\s*(Type|Season|Duration|Rating|Date Aired|Date Ended|Alternative Titles|Links)\s*:\s*\*\*/gi

function cleanMarkdownText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\((?:https?:\/\/)[^)]+\)/gi, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function trimField(value: string): string {
  return cleanMarkdownText(value)
    .replace(/^\s*[|•]\s*/, '')
    .replace(/\s*\|\s*$/, '')
    .trim()
}

function scoreAndSynopsis(value: string): { synopsis: string; score?: number } {
  const clean = cleanMarkdownText(value)
  const match = clean.match(/^([★☆]{5,10})\s*(\d+(?:[.,]\d+)?)\s*(?:\/\s*10)?\s*/u)
  if (!match) return { synopsis: clean }
  const score = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(score) || score < 0 || score > 10) return { synopsis: clean }
  return { synopsis: clean.slice(match[0].length).trim(), score }
}

function externalLinks(value: string): CatalogDescriptionLink[] {
  const links: CatalogDescriptionLink[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(/\[([^\]]{1,60})]\((https?:\/\/[^)\s]+)\)/gi)) {
    try {
      const url = new URL(match[2])
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || seen.has(url.href)) continue
      seen.add(url.href)
      links.push({ label: cleanMarkdownText(match[1]), url: url.href })
    } catch { /* Ignore malformed source links instead of exposing them to the opener. */ }
  }
  return links
}

function alternativeTitles(value: string): string[] {
  return [...new Set(value
    .split(/\n+|\s*\|\s*(?=[-•])/)
    .map((title) => cleanMarkdownText(title).replace(/^[-•]\s*/, '').trim())
    .filter(Boolean))]
}

/**
 * Aniyomi's SAnime model has one free-form description field. Most sources put only a synopsis in
 * it, while metadata-heavy sources append Markdown-labelled facts and links. Keep ordinary prose
 * untouched, but split that established rich shape into safe, scannable UI data when it appears.
 */
export function parseCatalogDescription(value?: string): ParsedCatalogDescription {
  const source = descriptionText(value)
  const markers = [...source.matchAll(METADATA_MARKER)]
  if (!markers.length) {
    const parsed = scoreAndSynopsis(source)
    return { ...parsed, facts: [], alternativeTitles: [], links: [] }
  }

  const parsed = scoreAndSynopsis(source.slice(0, markers[0].index))
  const facts: CatalogDescriptionFact[] = []
  let alternatives: string[] = []
  let links: CatalogDescriptionLink[] = []

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]
    const key = marker[1].toLowerCase()
    const start = (marker.index ?? 0) + marker[0].length
    const end = markers[index + 1]?.index ?? source.length
    const raw = source.slice(start, end)
    if (key === 'links') {
      links = externalLinks(raw)
    } else if (key === 'alternative titles') {
      alternatives = alternativeTitles(trimField(raw))
    } else {
      const fact = trimField(raw)
      if (fact) facts.push({ label: FACT_LABELS[key] ?? marker[1], value: fact })
    }
  }

  return { ...parsed, facts, alternativeTitles: alternatives, links }
}
