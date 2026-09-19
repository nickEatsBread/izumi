<script lang="ts">
  import qrcode from 'qrcode-generator'

  let { value, label = '', className = '' }: { value: string; label?: string; className?: string } = $props()

  /** Four empty modules on every side. Without the quiet zone many scanners simply never lock on,
   *  and it is the single most common reason a QR that "looks fine" cannot be read. */
  const QUIET = 4

  const matrix = $derived.by(() => {
    // Type 0 picks the smallest version that fits. 'M' is the usual balance: a pairing code is
    // read once, close up, off a screen, so the extra redundancy of 'Q' only buys density.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    // One path beats one <rect> per module by a wide margin: a version-6 code is ~1700 modules,
    // and that many elements measurably costs layout time on Deck hardware.
    let path = ''
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (qr.isDark(row, column)) path += `M${column + QUIET} ${row + QUIET}h1v1h-1z`
      }
    }
    return { path, span: count + QUIET * 2 }
  })
</script>

<svg
  class="qr {className}"
  viewBox="0 0 {matrix.span} {matrix.span}"
  role="img"
  aria-label={label || 'Pairing QR code'}
  shape-rendering="crispEdges"
  xmlns="http://www.w3.org/2000/svg"
>
  <rect width={matrix.span} height={matrix.span} fill="var(--qr-bg, #F4F8FF)" />
  <path d={matrix.path} fill="var(--qr-ink, #0E1524)" />
</svg>

<style>
  .qr { display: block; width: 100%; height: auto; border-radius: .5rem; }
</style>
