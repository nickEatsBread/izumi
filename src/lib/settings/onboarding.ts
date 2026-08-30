import { persisted } from 'svelte-persisted-store'

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
