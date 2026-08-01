<script lang="ts">
  import '@fontsource-variable/nunito'
  import '@fontsource/geist-mono'
  import '../app.css'
  import { setContextClient } from '@urql/svelte'
  import { anilist } from '$lib/anilist/client'
  import { onMount } from 'svelte'
  import { startQualitySync } from '$lib/player/quality'
  import { startEnhancementSync } from '$lib/player/enhancements'
  setContextClient(anilist)
  let { children } = $props()
  onMount(() => { startQualitySync(); startEnhancementSync() })
</script>
{@render children()}
