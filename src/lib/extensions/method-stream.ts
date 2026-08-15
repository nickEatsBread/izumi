/** Run extension methods concurrently while releasing each answer as soon as that method settles. */
export async function settleExtensionMethods<M, R>(
  methods: readonly M[],
  run: (method: M) => Promise<R>,
  onSettled: (method: M, result: R) => void,
): Promise<Array<{ method: M; result: R }>> {
  return Promise.all(methods.map(async (method) => {
    const result = await run(method)
    onSettled(method, result)
    return { method, result }
  }))
}

/** Bind work to one extension's readiness without making sibling extensions wait for it. */
export function afterExtensionReady<A extends unknown[], R>(
  ready: Promise<boolean>,
  run: (...args: A) => Promise<R>,
  unavailable: R,
): (...args: A) => Promise<R> {
  return async (...args: A) => (await ready ? run(...args) : unavailable)
}
