export type ClientPerformanceSample = {
  name: string
  at: string
  startTime: number
  duration?: number
  detail?: Record<string, number | string | boolean>
}

const STORAGE_KEY = 'izumi-client-performance-v1'
const MAX_SAMPLES = 80
const STARTUP_FRAME_WINDOW_MS = 12_000

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

  let stopped = false
  let frameHandle = 0
  let firstFrame = 0
  let previousFrame = 0
  let maxGap = 0
  const normalGaps: number[] = []
  let missedFrames = 0

  const finishFrames = (now: number) => {
    const sorted = normalGaps.slice().sort((a, b) => a - b)
    const frameBudget = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1000 / 60
    record({
      name: 'izumi:startup-frames',
      at: new Date().toISOString(),
      startTime: firstFrame,
      duration: Math.max(0, now - firstFrame),
      detail: {
        frameBudgetMs: Math.round(frameBudget * 100) / 100,
        maxGapMs: Math.round(maxGap * 100) / 100,
        missedFrames,
        sampledFrames: normalGaps.length,
      },
    })
  }

  const sampleFrame = (now: number) => {
    if (stopped) return
    if (!firstFrame) {
      firstFrame = now
      previousFrame = now
    } else {
      const gap = now - previousFrame
      previousFrame = now
      maxGap = Math.max(maxGap, gap)
      // Keep ordinary vsync gaps for refresh-rate estimation; long gaps would skew the median.
      if (gap > 0 && gap < 50) normalGaps.push(gap)
      const recent = normalGaps.slice(-60).sort((a, b) => a - b)
      const budget = recent.length ? recent[Math.floor(recent.length / 2)] : 1000 / 60
      // Respect high-refresh devices: 50ms-only accounting would hide several missed frames on
      // the Deck OLED (90Hz) and modern Android panels (90/120Hz).
      if (gap > Math.max(16, budget * 1.5)) missedFrames += 1
    }
    if (now - firstFrame < STARTUP_FRAME_WINDOW_MS) frameHandle = requestAnimationFrame(sampleFrame)
    else finishFrames(now)
  }
  frameHandle = requestAnimationFrame(sampleFrame)

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
    stopped = true
    cancelAnimationFrame(frameHandle)
    observer?.disconnect()
  }
}

if (canMeasure()) markClientPerformance('izumi:client-module')
