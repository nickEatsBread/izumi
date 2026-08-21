/** Traditional Auto ABR (YouTube / Netflix / Shaka): start on a cheap rung so the
 *  first frame is fast, keep the estimator ON so those bytes train throughput, then
 *  lift the height cap and climb the ladder. Chrome's Network Information `downlink`
 *  is often a 10 Mbps privacy cap or a stale 4G guess, so it must not override
 *  measured segment throughput on desktop. */
export const AUTO_ABR = {
  enabled: true,
  useNetworkInformation: false,
  defaultBandwidthEstimate: 2_500_000,
  switchInterval: 4,
  bandwidthUpgradeTarget: 0.85,
  bandwidthDowngradeTarget: 0.95,
  restrictToElementSize: false,
  restrictToScreenSize: false,
} as const

export const ABR_FAST_START_MAX_HEIGHT = 360

/** Cap Auto to a fast-start rung only before the first frame. After that, Shaka
 *  must keep ABR enabled — pinning 360p or `abr.enabled = false` on seek is what
 *  left Auto stuck. */
export function shouldPinFastStart(qualityMode: 'auto' | number, firstFrame: boolean): boolean {
  return qualityMode === 'auto' && !firstFrame
}

/** Soft ABR height cap. Infinity after the first frame so measured bandwidth can upgrade. */
export function abrMaxHeight(qualityMode: 'auto' | number, firstFrame: boolean): number {
  if (qualityMode !== 'auto') return Infinity
  return firstFrame ? Infinity : ABR_FAST_START_MAX_HEIGHT
}
