import { get, writable } from 'svelte/store'
import { clearResolveDiagnostics, recentResolveDiagnostics } from '$lib/debug/resolve-trace'
import { clientPerformanceSnapshot } from '$lib/performance/client'
import { baseStorageKey, classifyStorageKey, harvestSecretStrings, redactFieldValue } from '$lib/storage/key-policy'

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
const REDACTED = '[redacted]'
/** The profile roster holds each PIN verifier: one salted SHA-256 of a 4-6 digit PIN, which is
 *  brute-forced in moments. Backups keep it on purpose (owner decision 14); a diagnostics report is
 *  not a backup. It is pasted into public bug reports and saved from About without a PIN. */
const PROFILE_ROSTER_KEY = 'izumi-profiles-v1'

/** The union spec §6.2 asks for: the name test above, the storage-key policy (secret, device and
 *  session keys hidden; a fields key loses its credential field) and the harvest (any other setting
 *  whose value embeds a secret string is hidden), plus the profile roster. */
function reportedSetting(key: string, value: string, harvested: readonly string[]): string {
  if (baseStorageKey(key) === PROFILE_ROSTER_KEY) return REDACTED
  const kind = classifyStorageKey(key)
  if (sensitive.test(key) || kind === 'secret' || kind === 'device' || kind === 'transient') return REDACTED
  const shown = kind === 'fields' ? redactFieldValue(key, value).value : value
  if (shown == null || harvested.some((secret) => shown.includes(secret))) return REDACTED
  return shown
}

export function diagnosticsSnapshot(extra: Record<string, unknown> = {}) {
  const settings: Record<string, string | null> = {}
  if (typeof localStorage !== 'undefined') {
    const entries: Record<string, string> = {}
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      const value = key ? localStorage.getItem(key) : null
      if (key && value != null) entries[key] = value
    }
    const harvested = harvestSecretStrings(entries)
    for (const [key, value] of Object.entries(entries)) settings[key] = reportedSetting(key, value, harvested)
  }
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    location: typeof location === 'undefined' ? '' : location.href,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    viewport: typeof window === 'undefined' ? null : {
      width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio,
    },
    events: get(diagnosticEvents),
    performance: clientPerformanceSnapshot(),
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
