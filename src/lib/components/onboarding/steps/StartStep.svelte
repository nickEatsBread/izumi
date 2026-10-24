<script lang="ts">
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import MonitorPlay from '@lucide/svelte/icons/monitor-play'
  import Plug from '@lucide/svelte/icons/plug'
  import { m } from '$lib/paraglide/messages.js'

  // Get started lives in the shell's footer, bottom right like every other screen's forward action.
  let { onimport, ontransfer }: { onimport: () => void; ontransfer: () => void } = $props()

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

<div class="mt-7 grid gap-2 text-sm">
  <p><span class="text-muted-foreground">{m.onboarding_start_import_prompt()}</span> <button type="button" data-focusable onclick={onimport} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_import_link()}</button></p>
  <p><span class="text-muted-foreground">{m.onboarding_start_transfer_prompt()}</span> <button type="button" data-focusable onclick={ontransfer} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_transfer_link()}</button></p>
</div>
