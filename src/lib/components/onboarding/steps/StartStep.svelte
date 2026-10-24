<script lang="ts">
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import MonitorPlay from '@lucide/svelte/icons/monitor-play'
  import Plug from '@lucide/svelte/icons/plug'
  import { m } from '$lib/paraglide/messages.js'

  // Every way to start (Get started, Stremio or Nuvio, another device, Skip setup) lives in the
  // shell's footer, so this screen only says what izumi is.

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
