interface SubtitleCue {
  start: number
  end: number
  text: string
}

function timecode(value: string): number {
  const fields = value.trim().replace(',', '.').split(':')
  if (fields.length === 2) fields.unshift('0')
  if (fields.length !== 3) return Number.NaN
  return Number(fields[0]) * 3600 + Number(fields[1]) * 60 + Number(fields[2])
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

function timedText(source: string): SubtitleCue[] {
  return source.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n')
    const timingIndex = lines[0]?.includes('-->') ? 0 : 1
    const halves = (lines[timingIndex] || '').split('-->')
    if (halves.length !== 2) return []
    const start = timecode(halves[0])
    const end = timecode(halves[1].trim().split(/\s+/)[0])
    const text = plainText(lines.slice(timingIndex + 1).join('\n'))
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && text ? [{ start, end, text }] : []
  })
}

function assText(source: string): SubtitleCue[] {
  return source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').flatMap((line) => {
    if (!/^Dialogue\s*:/i.test(line)) return []
    const fields = line.slice(line.indexOf(':') + 1).split(',')
    if (fields.length < 10) return []
    const start = timecode(fields[1])
    const end = timecode(fields[2])
    const text = plainText(fields.slice(9).join(','))
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && text ? [{ start, end, text }] : []
  })
}

export class ExternalSubtitleController {
  private cues: SubtitleCue[] = []
  private key = ''

  async load(url: string, contentType = ''): Promise<void> {
    this.clear()
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`)
    const source = await response.text()
    this.cues = /(?:ass|ssa)/i.test(contentType) || /\.(?:ass|ssa)(?:[?#]|$)/i.test(url)
      ? assText(source)
      : timedText(source)
    this.cues.sort((a, b) => a.start - b.start)
  }

  textAt(positionSeconds: number, delayMs = 0): string {
    const time = positionSeconds - delayMs / 1000
    const active = this.cues.filter((cue) => cue.start <= time && cue.end >= time)
    const key = active.map((cue) => `${cue.start}:${cue.end}`).join('|')
    if (key === this.key && !active.length) return ''
    this.key = key
    return active.map((cue) => cue.text).join('\n')
  }

  clear(): void {
    this.cues = []
    this.key = ''
  }
}
