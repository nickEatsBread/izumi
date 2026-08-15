type Lookup = () => Promise<number | undefined>

/** Resolve a title mapping in cost order; expensive bulk data is a last-resort fallback. */
export async function resolveKitsuMapping(
  perTitle: Lookup,
  byMalId: Lookup,
  bulkIndex: Lookup,
): Promise<number | undefined> {
  return await perTitle() ?? await byMalId() ?? await bulkIndex()
}
