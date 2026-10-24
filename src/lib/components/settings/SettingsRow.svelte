<script lang="ts">
  // Row recipes (settings redesign spec §3.3). Every Settings page builds its rows from these:
  // - Switch row: <SettingsRow {settingKey} {title} {description} control={toggleSwitch} onActivate={toggle} pressed={on} />,
  //   the snippet rendering <SettingsSwitch value={on} onToggle={toggle} label={title} interactive={false} />.
  //   The whole row is the button; the switch only shows the state. No On/Off text.
  // - Choice/value row: <SettingsChoiceRow … />, an inline SelectMenu printing the current value.
  // - Slider row: controlLayout="stack" with a control snippet holding the range input and an <output> readout.
  // - Link row: <SettingsRow {title} {description} {value} {href} chevron />, with no control, children or onActivate.
  // - Action row: a control snippet holding one button.
  // - Credential row: value = the masked status ("Saved · hidden" / "Not set"), the CredentialField as
  //   children, expanded on activate.
  // Descriptions stay on one line (about 80 characters, keyword first); longer text goes in learnMore.
  import type { Snippet } from 'svelte'
  import * as h from '$lib/haptics'
  import { ripple } from '$lib/actions/ripple'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import LearnMore from './LearnMore.svelte'
  import { controllerHides, controllerSurfaces, settingsControllerMode } from '$lib/settings/surface'
  import { describeRowFocusables } from '$lib/settings/row-description'

  let {
    title,
    description,
    leading,
    meta,
    control,
    children,
    settingKey,
    expanded = true,
    controlLayout = 'inline',
    size = 'default',
    onActivate,
    pressed,
    value,
    chevron = false,
    learnMore,
    href,
  }: {
    title: string
    description?: string
    leading?: Snippet
    meta?: Snippet
    control?: Snippet
    children?: Snippet
    settingKey?: string
    expanded?: boolean
    controlLayout?: 'inline' | 'stack'
    size?: 'default' | 'lg'
    onActivate?: () => void
    pressed?: boolean
    /** Muted current value printed before the control (value and link rows). */
    value?: string
    /** Trailing chevron: a link row, or a row that opens something. */
    chevron?: boolean
    /** Long explanation behind a "Learn more" disclosure, kept out of the one-line description. */
    learnMore?: string
    /** Link row: the whole row is one link to this href. A link row takes no control, children or
     *  onActivate: children and onActivate are ignored, and a control would nest inside the <a>. */
    href?: string
  } = $props()
  // Rows the index hides on a controller surface (hideOn 'tv' / 'gamemode', spec §5.6) render
  // nothing, so a row is hidden exactly where its search hit is.
  const shown = $derived(!controllerHides(settingKey, $controllerSurfaces))
  const large = $derived(size === 'lg')
  // Controller mode (spec §5.1): Learn more is no extra d-pad stop. Its text shows while the row has
  // focus (app.css [data-learn-more]) and describes the row's focusables for screen readers
  // (describeRowFocusables: a control row's focusables live in its control snippet and children).
  const learnId = $props.id()
  const describedBy = $derived(learnMore && $settingsControllerMode ? learnId : undefined)
</script>

<!-- data-setting-row marks every row's root, keyed or not (a [data-setting-key] can also wrap several
     rows): nav navRect and the controller row highlight in app.css anchor on it.
     data-nav-line: on a controller the d-pad measures a narrow control here by this whole line on
     Up/Down (nav navRect). -->
{#snippet header()}
  <div data-nav-line class="flex gap-3 {large ? 'min-h-12' : 'min-h-9'} {controlLayout === 'stack' ? 'flex-col items-stretch sm:flex-row sm:items-center' : 'items-center'}">
    <!-- One inner row, so a stacked row drops only its controls below and the icon stays beside the title. -->
    <div class="flex min-w-0 flex-1 items-center gap-3">
      {#if leading}<span class="shrink-0">{@render leading()}</span>{/if}
      <div class="min-w-0 flex-1">
        <div class="font-bold leading-5 {large ? 'text-base' : 'text-sm'}">{title}</div>
        {#if meta}
          <div class="mt-0.5 text-xs leading-4 text-muted-foreground">{@render meta()}</div>
        {:else if description}
          <p class="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
        {/if}
      </div>
    </div>
    {#if control || value || chevron}
      <div class="flex items-center gap-1.5 {controlLayout === 'stack' ? 'w-full justify-end sm:w-auto sm:shrink-0' : 'shrink-0'}">
        {#if value}<span class="max-w-[12rem] truncate text-sm text-muted-foreground">{value}</span>{/if}
        {#if control}{@render control()}{/if}
        {#if chevron}<ChevronRight size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />{/if}
      </div>
    {/if}
  </div>
{/snippet}

<!-- Learn more sits after the row's own button or link: one control never nests inside another. -->
{#snippet more()}
  {#if learnMore}<div data-learn-more={describedBy ? '' : undefined} class="-mt-1.5 pb-2.5 {large ? 'px-3.5' : 'px-3'}"><LearnMore text={learnMore} label={title} id={learnId} /></div>{/if}
{/snippet}

{#if shown}
{#if href}
  <div data-setting-row data-setting-key={settingKey} use:describeRowFocusables={describedBy}>
    <a
      href={href}
      data-focusable
      use:ripple
      onclick={() => h.tap()}
      class="ripple-host block w-full rounded-[inherit] text-left transition-colors active:bg-secondary sm:hover:bg-secondary/70
        {large ? 'px-3.5 py-3.5' : 'px-3 py-2.5'}"
    >
      {@render header()}
    </a>
    {@render more()}
  </div>
{:else if onActivate}
  <div data-setting-row data-setting-key={settingKey} use:describeRowFocusables={describedBy}>
    <button
      type="button"
      data-focusable
      use:ripple
      data-row-activate
      aria-pressed={pressed}
      aria-expanded={children ? expanded : undefined}
      onclick={() => { h.tap(); onActivate() }}
      class="ripple-host block w-full text-left transition-colors active:bg-secondary sm:hover:bg-secondary/70
        {large ? 'px-3.5 py-3.5' : 'px-3 py-2.5'}
        {children && expanded ? 'rounded-t-[inherit]' : 'rounded-[inherit]'}"
    >
      {@render header()}
    </button>
    {@render more()}
    {#if children && expanded}
      <div class="mx-3 mb-2.5 border-t border-border/70 pt-3">{@render children()}</div>
    {/if}
  </div>
{:else}
  <div data-setting-row data-setting-key={settingKey} use:describeRowFocusables={describedBy}
       class="{large ? 'px-3.5 py-3.5' : 'px-3 py-2.5'}">
    {@render header()}
    {#if learnMore}<div data-learn-more={describedBy ? '' : undefined} class="mt-1"><LearnMore text={learnMore} label={title} id={learnId} /></div>{/if}
    {#if children && expanded}
      <div class="mt-2.5 border-t border-border/70 pt-3">{@render children()}</div>
    {/if}
  </div>
{/if}
{/if}
