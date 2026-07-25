/** Move an element to <body> for its lifetime, so `position: fixed` means the VIEWPORT again.
 *
 *  Needed because an ancestor with a transform (or filter/perspective/will-change) becomes the
 *  containing block for fixed descendants — and the home rows' `.load-in` card wrapper animates
 *  `transform` with `fill-mode: both`, which keeps that containing block alive after the
 *  animation finishes. A hover popup rendered in place then gets offset by its card's origin,
 *  clipped by the carousel's overflow, and painted under sibling posters. Re-parenting to <body>
 *  sidesteps every ancestor: clipping, stacking and containing blocks alike.
 *
 *  Svelte moves, not recreates, the node — bind:this and in:/out: transitions keep working. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() {
      // out: transitions run before destroy; the node may already be gone on teardown races.
      node.parentNode?.removeChild(node)
    },
  }
}
