export const TRACKER_RATING_PROVIDERS = ['anilist', 'mal', 'kitsu', 'simkl'] as const

export type TrackerRatingProvider = (typeof TRACKER_RATING_PROVIDERS)[number]
export type TrackerConnections = Record<TrackerRatingProvider, boolean>

export function normalizeTrackerConnectionOrder(value: readonly string[] | unknown): TrackerRatingProvider[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(TRACKER_RATING_PROVIDERS)
  return [...new Set(value.filter((provider): provider is TrackerRatingProvider => typeof provider === 'string' && allowed.has(provider)))]
}

/** Preserve the order accounts were linked. `connectedBefore` also migrates accounts linked before
 * the ordering store existed; their exact historical order is unknowable, so the account UI order
 * is used once and every later connection is recorded precisely. */
export function connectionOrderAfterLink(
  current: readonly string[],
  provider: TrackerRatingProvider,
  connectedBefore: readonly TrackerRatingProvider[],
): TrackerRatingProvider[] {
  return normalizeTrackerConnectionOrder([...current, ...connectedBefore, provider])
}

export function preferredConnectedTracker(
  connections: TrackerConnections,
  order: readonly string[],
): TrackerRatingProvider | undefined {
  const candidates = normalizeTrackerConnectionOrder([...order, ...TRACKER_RATING_PROVIDERS])
  return candidates.find((provider) => connections[provider])
}
