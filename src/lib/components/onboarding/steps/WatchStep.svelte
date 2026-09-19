<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Film from '@lucide/svelte/icons/film'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { m } from '$lib/paraglide/messages.js'
  import type { OnboardingIntent } from '$lib/settings/onboarding'

  let { intent = $bindable() }: { intent: OnboardingIntent } = $props()

  /** Both may be off. The footer refuses to advance instead, so the artwork can react to an
   *  empty choice rather than the control fighting the user over it. */
  function toggle(key: 'anime' | 'films') {
    intent = { ...intent, [key]: !intent[key] }
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_watch_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_watch_body()}</p>

<fieldset class="mt-7 space-y-3">
  <legend class="sr-only">{m.onboarding_watch_title()}</legend>
  {#each [{ key: 'anime' as const, title: m.onboarding_anime_title(), body: m.onboarding_automatic_body(), Icon: Sparkles }, { key: 'films' as const, title: m.onboarding_movies_title(), body: m.onboarding_movies_body(), Icon: Film }] as choice}
    <label class="setup-choice flex w-full cursor-pointer items-center gap-4 p-5 text-left {intent[choice.key] ? 'selected' : ''}">
      <input type="checkbox" data-focusable class="sr-only" checked={intent[choice.key]} onchange={() => toggle(choice.key)} />
      <choice.Icon size={24} class="shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1"><span class="block text-lg font-semibold">{choice.title}</span><span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span></span>
      <span class="grid size-5 shrink-0 place-items-center rounded border border-foreground/40">{#if intent[choice.key]}<Check size={13} />{/if}</span>
    </label>
  {/each}
</fieldset>
