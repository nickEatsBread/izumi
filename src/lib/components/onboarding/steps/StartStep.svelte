<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import MonitorPlay from '@lucide/svelte/icons/monitor-play'
  import Plug from '@lucide/svelte/icons/plug'
  import { m } from '$lib/paraglide/messages.js'

  let { onnew, onimport, ontransfer }: { onnew: () => void; onimport: () => void; ontransfer: () => void } = $props()

  // What izumi is, in three lines, for someone who has never opened it.
  const features = [
    { Icon: MonitorPlay, label: m.onboarding_start_feature_library() },
    { Icon: Plug, label: m.onboarding_start_feature_sources() },
    { Icon: ListChecks, label: m.onboarding_start_feature_tracking() },
  ]
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_welcome_title()}</h1>
<p class="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_start_new_body()}</p>

<ul class="mt-6 grid gap-3 text-sm">
  {#each features as feature}
    <li class="flex items-center gap-3"><span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground"><feature.Icon size={16} /></span>{feature.label}</li>
  {/each}
</ul>

<!-- Most people are new, so that path is the one button. The other two starts are offered as plain
     links instead of competing with it as equal cards. -->
<button type="button" data-focusable onclick={onnew} class="setup-inline-button mt-7 bg-foreground px-5 text-background">{m.onboarding_start_cta()}<ArrowRight size={17} /></button>

<div class="mt-7 grid gap-2 text-sm">
  <p><span class="text-muted-foreground">{m.onboarding_start_import_prompt()}</span> <button type="button" data-focusable onclick={onimport} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_import_link()}</button></p>
  <p><span class="text-muted-foreground">{m.onboarding_start_transfer_prompt()}</span> <button type="button" data-focusable onclick={ontransfer} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_transfer_link()}</button></p>
</div>
