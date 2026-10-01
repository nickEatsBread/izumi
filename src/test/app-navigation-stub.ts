// `$app/navigation` for unit tests (the vitest.config.ts alias). A jsdom test file transforms its
// imports for the browser, where an unresolvable `$app/navigation` fails before `vi.mock` can
// replace it. Tests that check navigation mock it (`vi.mock('$app/navigation', () => ({ goto }))`);
// anything else that reaches it gets this no-op.
export async function goto(): Promise<void> {}
