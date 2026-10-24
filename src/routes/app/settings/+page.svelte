<script lang="ts">
  import { isMobile } from '$lib/platform'
  import Playback from './playback/+page.svelte'
</script>

<!-- Desktop: the root settings pane shows Playback. Mobile: the layout renders the grouped list
     index here instead, so this page renders nothing on mobile. -->
{#if !$isMobile}
  <Playback />
{/if}
