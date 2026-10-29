<script lang="ts">
  // The app's one loading spinner: a faint ring with the primary colour on its top edge, or with
  // `inline` a ring in the surrounding text colour for use inside buttons and coloured overlays.
  // Reduced motion needs nothing here: app.css stops every animation under it. `loading-spinner`
  // steps the turn in Game mode, where a smooth spin repaints the Deck's screen every frame.
  let { size = 'sm', label = '', inline = false, frame, class: className = '' }: {
    /** 12, 16, 20 or 32 px. */
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** Announced to screen readers; leave empty when visible text beside it already says it. */
    label?: string
    inline?: boolean
    /** A turn stepped by the caller (0–7, 45° each) where CSS animation time cannot be trusted to
     *  advance, such as a Game mode surface captured frame by frame. */
    frame?: number
    class?: string
  } = $props()

  const SIZES = { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-8' }
</script>

<span
  data-part="spinner"
  role={label ? 'status' : undefined}
  aria-hidden={label ? undefined : 'true'}
  class="loading-spinner inline-block shrink-0 rounded-full border-2 {SIZES[size]} {inline ? 'border-current border-t-transparent' : 'border-foreground/15 border-t-primary'} {className}"
  class:animate-spin={frame == null}
  style:transform={frame == null ? undefined : `rotate(${frame * 45}deg)`}
>{#if label}<span class="sr-only">{label}</span>{/if}</span>
