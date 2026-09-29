<script lang="ts">
  import Settings2 from '@lucide/svelte/icons/settings-2'
  import { page } from '$app/state'
  import { traktToken } from '$lib/trakt/config'
  import { letterboxdUsername, letterboxdImportedRecords } from '$lib/letterboxd/config'
</script>
<nav aria-label="Library sections" data-part="library.tabs" data-page-tabs class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6 border-b border-border px-4 pt-4 sm:px-8">
  {#each [{ href: '/app/library', label: 'My lists' }, { href: '/app/discovery-queue', label: 'Discover' }, { href: '/app/trakt', label: 'Trakt', available: Boolean($traktToken) }, { href: '/app/letterboxd', label: 'Letterboxd', available: Boolean($letterboxdUsername || $letterboxdImportedRecords.length) }] as section}
    <a href={section.href} data-focusable aria-current={page.url.pathname === section.href ? 'page' : undefined} class="inline-flex min-h-12 items-center gap-2 border-b-2 text-sm font-bold {page.url.pathname === section.href ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}">{section.label}{#if section.available}<span class="size-1.5 rounded-full bg-emerald-400" aria-label="Connected"></span>{/if}</a>
  {/each}
  <a href="/app/settings/accounts?section=connections" aria-label="Manage services" data-focusable data-page-tabs-skip class="ml-auto inline-flex min-h-12 min-w-8 items-center justify-center text-sm text-muted-foreground hover:text-foreground"><Settings2 size={18} class="sm:hidden" /><span class="hidden sm:inline">Manage services</span></a>
</nav>
