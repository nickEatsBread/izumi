<script lang="ts">
  import { isMobile } from '$lib/platform'
  import PlayerSettings from './player/+page.svelte'
</script>

<!-- Desktop: the root settings pane shows Player. Mobile: the layout renders the grouped list
     index here instead, so this page renders nothing on mobile. -->
{#if !$isMobile}
  <PlayerSettings />
{/if}
