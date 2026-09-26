<script lang="ts">
  // One span per letter so a theme stylesheet can colour any run, e.g.
  // [data-part="brand.char"]:nth-child(n+4) for a two-tone "izu|mi". The text is always "izumi".
  let { className = '' }: { className?: string } = $props()
  const letters = [...'izumi']
</script>

<span data-slot="brand" class="izumi-brand-text {className}"><span data-part="brand.text">{#each letters as letter, index (index)}<span data-part="brand.char">{letter}</span>{/each}</span></span>
