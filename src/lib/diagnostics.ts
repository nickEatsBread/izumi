import { get, writable } from 'svelte/store'
import { clearResolveDiagnostics, recentResolveDiagnostics } from '$lib/debug/resolve-trace'

export type DiagnosticEvent = {
  at: string
  kind: 'error' | 'rejection' | 'note'
  message: string
  source?: string
}

const STORAGE_KEY = 'izumi-diagnostic-events-v1'
const MAX_EVENTS = 40

function storedEvents(): DiagnosticEvent[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.slice(-MAX_EVENTS) : []
  } catch { return [] }
}

export const diagnosticEvents = writable<DiagnosticEvent[]>(storedEvents())
let initialized = false

function record(event: DiagnosticEvent) {
  event.message = event.message.replace(/https?:\/\/\S+/gi, '[url redacted]')
  diagnosticEvents.update((events) => {
    const next = [...events, event].slice(-MAX_EVENTS)
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* unavailable */ }
    return next
  })
}

export function initCrashReporting() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('error', (event) => record({
    at: new Date().toISOString(),
    kind: 'error',
    message: event.error?.stack || event.message || 'Unknown window error',
    source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
  }))
  window.addEventListener('unhandledrejection', (event) => record({
    at: new Date().toISOString(),
    kind: 'rejection',
    message: event.reason?.stack || String(event.reason),
  }))
}

const sensitive = /(token|secret|password|credential|api.?key|jwt|debrid|addon|extension.?url)/i

export function diagnosticsSnapshot(extra: Record<string, unknown> = {}) {
  const settings: Record<string, string | null> = {}
  if (typeof localStorage !== 'undefined') {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key) continue
      settings[key] = sensitive.test(key) ? '[redacted]' : localStorage.getItem(key)
    }
  }
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    location: typeof location === 'undefined' ? '' : location.href,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    viewport: typeof window === 'undefined' ? null : {
      width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio,
    },
    events: get(diagnosticEvents),
    resolveTraces: recentResolveDiagnostics(),
    settings,
    ...extra,
  }, null, 2)
}

export function clearDiagnostics() {
  diagnosticEvents.set([])
  clearResolveDiagnostics()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* unavailable */ }
}
