export type ClientPerformanceSample = {
  name: string
  at: string
  startTime: number
  duration?: number
  detail?: Record<string, number | string | boolean>
}

const STORAGE_KEY = 'izumi-client-performance-v1'
const MAX_SAMPLES = 80

let samples: ClientPerformanceSample[] = []
let initialized = false

function canMeasure() {
  return typeof window !== 'undefined' && typeof performance !== 'undefined'
}

function loadStored() {
  if (samples.length || typeof sessionStorage === 'undefined') return
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(value)) samples = value.slice(-MAX_SAMPLES)
  } catch { /* diagnostics are best-effort */ }
}

function record(sample: ClientPerformanceSample) {
  loadStored()
  samples = [...samples, sample].slice(-MAX_SAMPLES)
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(samples)) } catch { /* unavailable */ }
}

export function markClientPerformance(
  name: string,
  detail?: ClientPerformanceSample['detail'],
) {
  if (!canMeasure()) return
  const startTime = performance.now()
  try { performance.mark(name) } catch { /* older WebViews still get the local sample */ }
  record({ name, at: new Date().toISOString(), startTime, detail })
}

export function clientPerformanceSnapshot(): ClientPerformanceSample[] {
  loadStored()
  return samples.slice()
}

/**
 * Local-only launch diagnostics. Nothing leaves the device: the bounded samples are included in
 * the existing opt-in diagnostics export so cold-start and jank reports have useful timing data.
 */
export function initClientPerformance(): () => void {
  if (initialized || !canMeasure()) return () => {}
  initialized = true
  markClientPerformance('izumi:app-mounted')

  requestAnimationFrame(() => requestAnimationFrame(() => {
    markClientPerformance('izumi:shell-first-paint', {
      sinceNavigationMs: Math.round(performance.now() * 100) / 100,
    })
  }))

  let observer: PerformanceObserver | undefined
  try {
    if (typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record({
          name: 'izumi:long-task',
          at: new Date().toISOString(),
          startTime: entry.startTime,
          duration: entry.duration,
        })
      })
      observer.observe({ entryTypes: ['longtask'] })
    }
  } catch { /* long-task observation is not available in every WebView */ }

  return () => {
    observer?.disconnect()
  }
}

if (canMeasure()) markClientPerformance('izumi:client-module')
