<script lang="ts">
  let { desktop, phone, label, onclick }: {
    /** The theme's desktop Home screenshot, shown in a window. */
    desktop?: string
    /** Its phone Home screenshot, shown in front (or alone when there is no desktop one). */
    phone?: string
    label: string
    onclick: () => void
  } = $props()
</script>

<!-- Store artwork: the theme in device frames. Hover lifts the window and, a little further, the phone. -->
<button type="button" class="devices" tabindex="-1" aria-label={label} {onclick}>
  {#if desktop}<span class="window"><img src={desktop} alt="" referrerpolicy="no-referrer" /></span>{/if}
  {#if phone}<span class="phone" class:alone={!desktop}><img src={phone} alt="" referrerpolicy="no-referrer" /></span>{/if}
</button>

<style>
  .devices { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
  .window, .phone { position: absolute; overflow: hidden; transition: translate 450ms cubic-bezier(.2, .8, .2, 1), box-shadow 450ms ease; }
  .window { left: 4%; top: 13%; width: 86%; border-radius: 10px; border: 1px solid hsl(0 0% 100% / .12); box-shadow: 0 24px 60px hsl(0 0% 0% / .55); }
  .phone { right: 3%; bottom: -6%; width: 20%; border-radius: 14px; border: 3px solid #0b0b0d; box-shadow: 0 24px 60px hsl(0 0% 0% / .65); }
  .phone.alone { right: auto; left: 34%; width: 32%; bottom: -12%; }
  img { display: block; width: 100%; }
  .devices:hover .window { translate: 0 -6px; box-shadow: 0 34px 70px hsl(0 0% 0% / .6); }
  .devices:hover .phone { translate: 0 -12px; box-shadow: 0 36px 70px hsl(0 0% 0% / .7); }
  @media (prefers-reduced-motion: reduce) { .window, .phone { transition: none; } }
</style>
