// Kept out of index.ts so the Worker's vendored resolver core never carries UI asset paths.
/** Bundled provider logo (static/brand/debrid/<id>.png). A missing file falls back to the name's
 *  first letter in SelectMenu, so a new provider needs no entry here. */
export const providerIcon = (id: string) => `/brand/debrid/${id}.png`
