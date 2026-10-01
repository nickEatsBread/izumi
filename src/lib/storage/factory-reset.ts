import { assertHouseholdAction } from '$lib/profiles/household-gate'

/** sessionStorage marker static/reset.html requires before it deletes anything. */
export const RESET_MARKER_KEY = 'izumi-reset-requested'

/** Where the reset starts from: the window in the app, a plain object in tests. */
export interface FactoryResetTarget {
  sessionStorage: Pick<Storage, 'setItem'>
  location: Pick<Location, 'replace'>
}

/** Start a factory reset: a full navigation to the standalone reset page, which stops stores,
 *  workers and sync before any data is removed. On a restricted profile this needs the household
 *  grant from authorizeHousehold('factory-reset'); without it, it throws and changes nothing. */
export function startFactoryReset(target: FactoryResetTarget = window): void {
  assertHouseholdAction('factory-reset')
  target.sessionStorage.setItem(RESET_MARKER_KEY, 'true')
  target.location.replace('/reset.html')
}
