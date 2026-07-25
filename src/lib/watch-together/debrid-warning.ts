/**
 * Gate for the "hosting streams your debrid link from every guest's IP" warning.
 *
 * Kept out of the Svelte page so the condition is unit-testable: getting it wrong either nags
 * users who are not on debrid, or silently skips the warning for the users who need it.
 */

/**
 * Is debrid the mode playback will ACTUALLY use? `play.ts` falls back to the local P2P engine when
 * no key is set (`direct = mode === 'direct' || !key`), so the mode alone is not enough — warning a
 * keyless user about their debrid account would be wrong.
 */
export function isEffectiveDebridMode(mode: 'debrid' | 'direct', key: string): boolean {
  return mode === 'debrid' && key.trim().length > 0
}

/** Show the warning before creating a room: debrid is live and the user has not dismissed it. */
export function shouldWarnBeforeHosting(
  mode: 'debrid' | 'direct',
  key: string,
  acknowledged: boolean,
): boolean {
  return isEffectiveDebridMode(mode, key) && !acknowledged
}
