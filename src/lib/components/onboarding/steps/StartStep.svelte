<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Download from '@lucide/svelte/icons/download'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { m } from '$lib/paraglide/messages.js'

  let { onnew, onimport, ontransfer }: { onnew: () => void; onimport: () => void; ontransfer: () => void } = $props()

  // Each card is the way forward rather than a selection waiting for Next: one click per path.
  const choices = $derived([
    { title: m.onboarding_start_new_title(), body: m.onboarding_start_new_body(), Icon: Sparkles, action: onnew },
    { title: m.onboarding_start_import_title(), body: m.onboarding_start_import_body(), Icon: Download, action: onimport },
    { title: m.onboarding_start_transfer_title(), body: m.onboarding_start_transfer_body(), Icon: MonitorSmartphone, action: ontransfer },
  ])
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_welcome_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_start_body()}</p>

<div class="mt-8 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-3">
  {#each choices as choice}
    <button type="button" data-focusable onclick={choice.action} class="setup-choice flex flex-col items-start gap-3 p-6 text-left">
      <choice.Icon size={28} class="text-muted-foreground" />
      <span class="block text-xl font-semibold">{choice.title}</span>
      <span class="block flex-1 text-sm leading-relaxed text-muted-foreground">{choice.body}</span>
      <ArrowRight size={18} class="mt-2 text-muted-foreground" />
    </button>
  {/each}
</div>
