<script lang="ts">
  import { focusWhenIdle } from '$lib/nav/initial-focus'
  import { applyKey, GRID_KEYBOARD_ROWS } from './grid-keyboard'

  // Types into the page's search field and fires the `input` its own binding listens to.
  function press(key: string) {
    const field = document.querySelector<HTMLInputElement>('[data-search-input]')
    if (!field) return
    const next = applyKey(field.value, key)
    if (next === field.value) return
    field.value = next
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
</script>

<!-- The TV themes' search keyboard (`search.keyboard`): `search.key` buttons named by `data-key`.
     Controller focus starts on "a". Sticky, so it stays beside the results as they scroll, 1rem under
     the top bar (`search.layout` aligns its items to the start, which lets it stick). -->
<div data-part="search.keyboard" role="group" aria-label="Search keyboard"
     class="sticky top-[calc(var(--theme-shell-top,2rem)+1rem)] ml-4 mt-4 grid shrink-0 grid-cols-[repeat(6,3.25rem)] auto-rows-[3.25rem] gap-1 sm:ml-8 sm:mt-8">
  {#each GRID_KEYBOARD_ROWS.flat() as key (key.key)}
    <button type="button" data-part="search.key" data-key={key.key} data-focusable
            aria-label={key.key === 'backspace' ? 'Backspace' : undefined}
            style:grid-column="span {key.span}"
            use:focusWhenIdle={key.key === 'a'}
            onclick={() => press(key.key)}
            class="rounded bg-[#333] text-white transition-colors hover:bg-[#444] focus:bg-white focus:text-black focus-visible:outline-none {key.span > 1 ? 'text-base font-semibold' : 'text-xl'}">
      {key.label}
    </button>
  {/each}
</div>
