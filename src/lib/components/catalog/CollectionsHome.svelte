<script lang="ts">
  import { homeCollections } from '$lib/catalog/collections/store'
  import { collectionFolderHref } from '$lib/catalog/collections/model'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import CollectionFolderCard from './CollectionFolderCard.svelte'
  /** Collection ids, in the order the Home layout places them. */
  let { ids }: { ids: string[] } = $props()
  const collections = $derived(ids.flatMap((id) => $homeCollections.find((collection) => collection.id === id) ?? []))
</script>

{#each collections as collection (collection.id)}
  {#if collection.folders.length}
    <Carousel title={collection.title} viewMoreHref={collectionFolderHref(collection.id)}>
      {#each collection.folders as folder (folder.id)}
        <CollectionFolderCard collectionId={collection.id} {folder} />
      {/each}
    </Carousel>
  {/if}
{/each}
