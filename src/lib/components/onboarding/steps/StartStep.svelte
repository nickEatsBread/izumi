<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import { m } from '$lib/paraglide/messages.js'

  let { onnew, onimport, ontransfer }: { onnew: () => void; onimport: () => void; ontransfer: () => void } = $props()
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_welcome_title()}</h1>
<p class="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_start_new_body()}</p>

<!-- Most people are new, so that path is the one button. The other two starts are offered as plain
     links instead of competing with it as equal cards. -->
<button type="button" data-focusable onclick={onnew} class="setup-inline-button mt-7 bg-foreground px-5 text-background">{m.onboarding_start_cta()}<ArrowRight size={17} /></button>

<div class="mt-7 grid gap-2 text-sm">
  <p><span class="text-muted-foreground">{m.onboarding_start_import_prompt()}</span> <button type="button" data-focusable onclick={onimport} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_import_link()}</button></p>
  <p><span class="text-muted-foreground">{m.onboarding_start_transfer_prompt()}</span> <button type="button" data-focusable onclick={ontransfer} class="font-semibold underline underline-offset-4 hover:opacity-80">{m.onboarding_start_transfer_link()}</button></p>
</div>
