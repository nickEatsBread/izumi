<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import Minus from 'lucide-svelte/icons/minus'
  import Square from 'lucide-svelte/icons/square'
  import X from 'lucide-svelte/icons/x'

  const win = getCurrentWindow()
  const minimize = () => win.minimize()
  const maximize = () => win.toggleMaximize()
  const close = () => win.close()
</script>

<!--
  Thin custom titlebar for the frameless window. The bar itself is a drag region
  (data-tauri-drag-region); the control buttons are NOT, so they stay clickable.
  Transparent so the hero banner shows through to the very top edge.
-->
<div
  data-tauri-drag-region
  class="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-end"
>
  <button
    onclick={minimize}
    aria-label="Minimize"
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
  >
    <Minus size={15} />
  </button>
  <button
    onclick={maximize}
    aria-label="Maximize"
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
  >
    <Square size={12} />
  </button>
  <button
    onclick={close}
    aria-label="Close"
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white"
  >
    <X size={16} />
  </button>
</div>
