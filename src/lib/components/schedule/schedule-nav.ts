export type ScheduleCardNav = {
  id?: string
  left?: string
  right?: string
}

const cardId = (base: string, index: number) => index === 0 ? base : `${base}-${index}`

/** Explicit horizontal neighbours for the selected day's two-column schedule grid. */
export function scheduleCardNav(base: string | undefined, index: number, total: number): ScheduleCardNav {
  if (!base) return {}
  return {
    id: cardId(base, index),
    left: index % 2 === 1 ? cardId(base, index - 1) : undefined,
    right: index % 2 === 0 && index + 1 < total ? cardId(base, index + 1) : undefined,
  }
}
