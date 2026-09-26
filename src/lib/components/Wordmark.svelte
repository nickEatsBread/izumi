<script lang="ts">
  import { themePresentation } from '$lib/themes/runtime'
  import BrandText from './BrandText.svelte'
  let { className = '' }: { className?: string } = $props()
  const text = $derived($themePresentation?.brand === 'text')
</script>

{#if text}
  <BrandText className="izumi-wordmark-text {className}" />
{:else}
  <span data-slot="brand" class="inline-block {className}"><span role="img" aria-label="izumi" data-part="brand.mark" class="izumi-wordmark"></span></span>
{/if}

<style>
  .izumi-wordmark {
    display: inline-block;
    width: 6.8rem;
    height: 2rem;
    background: currentColor;
    -webkit-mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
    mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
  }
  :global(.izumi-wordmark-text) { font-size: 2rem; font-weight: 900; letter-spacing: -0.04em; line-height: 1; }
</style>
