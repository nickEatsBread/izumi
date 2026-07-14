/** First non-empty agenda day at or after today; -1 outside the current week or with none left. */
export function agendaTargetDay(days: unknown[][], todayIndex: number): number {
  if (todayIndex < 0) return -1
  return days.findIndex((day, index) => index >= todayIndex && day.length > 0)
}

/** Absolute document position that leaves the target heading below the measured sticky header. */
export function agendaScrollTop(
  currentScrollY: number,
  targetViewportTop: number,
  headerHeight: number,
  gap = 8,
): number {
  return Math.max(0, currentScrollY + targetViewportTop - headerHeight - gap)
}

/** Keys that indicate the viewer intentionally took control of vertical positioning. */
export const isAgendaScrollKey = (key: string) =>
  ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)
