<script lang="ts">
  import Film from '@lucide/svelte/icons/film'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { m } from '$lib/paraglide/messages.js'
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_welcome_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_welcome_body()}</p>
<div class="welcome-details"><span><Sparkles size={22} />{m.onboarding_anime_title()}</span><span><Film size={22} />{m.onboarding_movies_title()}</span><span><LibraryBig size={22} />{m.onboarding_change_later_hint()}</span></div>
<p class="mt-8 text-xs leading-relaxed text-muted-foreground">{m.onboarding_once_detail()}</p>

<style>
  .welcome-details { display: grid; gap: 1.4rem; margin-top: 2rem; }
  .welcome-details span { display: flex; align-items: center; gap: 1rem; font-size: .95rem; }
  .welcome-details :global(svg) { flex-shrink: 0; color: hsl(var(--muted-foreground)); }
  @media (max-width: 767px) { .welcome-details { gap: 1rem; margin-top: 1.5rem; } }
</style>
