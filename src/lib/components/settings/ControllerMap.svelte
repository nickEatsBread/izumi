<script lang="ts">
  import Glyph from '$lib/components/shell/Glyph.svelte'
  import { glyphFamily, lastPadId } from '$lib/nav/glyphs'
  import { gameMode } from '$lib/player/session'
  import { CONTROLLER_MAP, MAP_KEY_LABEL, isGlyphKey } from '$lib/settings/controller-map'
  const family = $derived(glyphFamily($lastPadId, $gameMode))
</script>

<!-- Game mode (spec §5.5): what each button does, read-only, where desktop has keyboard rebinding. -->
<div data-controller-map class="space-y-4 px-3 py-3">
  {#each CONTROLLER_MAP as group (group.title)}
    <div>
      <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h4>
      <dl class="space-y-2">
        {#each group.rows as row (row.action)}
          <div class="flex items-center gap-3">
            <dt class="flex w-24 shrink-0 items-center gap-1">
              {#each row.keys as key (key)}
                {#if isGlyphKey(key)}
                  <Glyph {family} button={key} />
                {:else}
                  <span class="inline-grid h-6 min-w-8 place-items-center rounded-md bg-foreground px-1.5 text-sm font-black leading-none text-background">{MAP_KEY_LABEL[key]}</span>
                {/if}
              {/each}
            </dt>
            <dd class="text-sm">{row.action}</dd>
          </div>
        {/each}
      </dl>
    </div>
  {/each}
</div>
