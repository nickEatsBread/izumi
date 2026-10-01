<script lang="ts">
  import { navLayer } from '$lib/nav/overlay'

  let { name, installedFrom, storeName, onconfirm, oncancel }: {
    name: string
    /** Where the installed copy came from, in plain words. */
    installedFrom: string
    /** The store or catalog this copy would come from instead. */
    storeName: string
    onconfirm: () => void
    oncancel: () => void
  } = $props()
</script>

<div class="fixed inset-0 z-[110] grid place-items-end bg-black/75 sm:place-items-center sm:p-4" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget) oncancel() }}>
  <!-- A nav layer: Escape (the shared capture), B and remote Back cancel only this question, even
       when it sits on top of another store sheet. -->
  <div role="alertdialog" data-theme-protected aria-modal="true" aria-labelledby="replace-package-title" aria-describedby="replace-package-body" data-nav-trap data-nav-escape
       use:navLayer={{ kind: 'replace-package', onClose: () => oncancel() }}
       class="w-full max-w-md rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-6">
    <h2 id="replace-package-title" class="text-lg font-black">Replace {name}?</h2>
    <p id="replace-package-body" class="mt-2 text-sm text-muted-foreground">
      {name} is already installed from {installedFrom}. Installing it from {storeName} replaces that copy, and from then on it only updates from {storeName}.
    </p>
    <div class="mt-5 flex justify-end gap-2">
      <button type="button" data-focusable onclick={oncancel} class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground">Cancel</button>
      <button type="button" data-focusable onclick={onconfirm} class="rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground">Replace</button>
    </div>
  </div>
</div>
