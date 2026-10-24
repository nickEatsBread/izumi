<script lang="ts">
  import { page } from '$app/stores'
  import { homeCollections } from '$lib/catalog/collections/store'
  import CollectionBrowser from '$lib/components/catalog/CollectionBrowser.svelte'
  import CollectionFolderCard from '$lib/components/catalog/CollectionFolderCard.svelte'
  const collection = $derived($homeCollections.find((item) => item.id === $page.url.searchParams.get('collection')))
  const folder = $derived(collection?.folders.find((item) => item.id === $page.url.searchParams.get('folder')))
</script>

{#if collection && folder}
  {#key `${collection.id}:${folder.id}`}<CollectionBrowser {collection} {folder} />{/key}
{:else if collection && !$page.url.searchParams.get('folder')}
  <div class="px-4 pb-16 pt-24 sm:px-8">
    <a href="/app/home" data-focusable class="text-sm text-muted-foreground">← Home</a>
    <h1 class="mt-3 text-3xl font-black">{collection.title}</h1>
    <a href="/app/settings/library/collections" data-focusable class="mt-3 inline-block text-sm font-bold text-primary">Edit collection and covers</a>
    <div class="mt-6 flex flex-wrap items-start gap-4">
      {#each collection.folders as item (item.id)}<CollectionFolderCard collectionId={collection.id} folder={item} />{/each}
    </div>
  </div>
{:else}
  <div class="px-4 pb-16 pt-24 sm:px-8">
    <h1 class="text-2xl font-black">Collection unavailable</h1>
    <p class="mt-2 text-muted-foreground">This folder may have been removed or replaced by an import.</p>
    <a href="/app/settings/library/collections" data-focusable class="mt-4 inline-block font-bold text-primary">Manage collections</a>
  </div>
{/if}
