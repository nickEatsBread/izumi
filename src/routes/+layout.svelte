<script lang="ts">
  import '@fontsource-variable/nunito'
  import '@fontsource/geist-mono'
  import '../app.css'
  import { setContextClient } from '@urql/svelte'
  import { anilist } from '$lib/anilist/client'
  import { onMount } from 'svelte'
  import { startQualitySync } from '$lib/player/quality'
  import { startEnhancementSync } from '$lib/player/enhancements'
  import { startThemeSync } from '$lib/theme'
  import { getLocale, getTextDirection } from '$lib/paraglide/runtime.js'
  setContextClient(anilist)
  let { children } = $props()
  onMount(() => {
    document.documentElement.lang = getLocale()
    document.documentElement.dir = getTextDirection()
    startQualitySync()
    startEnhancementSync()
    return startThemeSync()
  })
</script>
{@render children()}
