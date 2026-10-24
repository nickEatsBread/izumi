<script lang="ts">
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import { sineOut } from 'svelte/easing'
  import { motion } from '$lib/motion/gm-motion'

  let { paused, size = 24, class: className = '', playClass = '' }: { paused: boolean; size?: number; class?: string; playClass?: string } = $props()

  // Like common web players: the outgoing glyph fades out over the incoming one, 150ms CSS
  // ease-out (sineOut is within 0.025 of it). Local transitions, so nothing fades when the
  // controls mount.
  const fade = { opacity: [0, 1], duration: 150, easing: sineOut } as const
</script>

<span class="grid {className}">
  {#key paused}
    <span class="col-start-1 row-start-1 grid place-items-center" in:motion={fade} out:motion={fade}>
      {#if paused}<Play {size} fill="currentColor" class={playClass} />{:else}<Pause {size} fill="currentColor" />{/if}
    </span>
  {/key}
</span>
