<script lang="ts">
  import '@fontsource-variable/nunito'
  import '@fontsource/geist-mono'
  import '../app.css'
  import { setContextClient } from '@urql/svelte'
  import { anilist } from '$lib/anilist/client'
  setContextClient(anilist)
  let { children } = $props()
</script>
{@render children()}
