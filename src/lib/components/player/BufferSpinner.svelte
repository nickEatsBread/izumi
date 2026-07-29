<script lang="ts">
  let { size = 48 }: { size?: number } = $props()
</script>

<!-- A transform-only spinner for the Android WebView. Rotating a CSS border forces the browser to
     re-rasterise its uneven border corners on every frame, which looks noticeably stepped on lower
     refresh-rate phones. This SVG arc is rasterised once; the compositor only rotates the layer. -->
<svg
  class="buffer-spinner"
  width={size}
  height={size}
  viewBox="0 0 48 48"
  aria-hidden="true"
>
  <circle class="track" cx="24" cy="24" r="19" pathLength="100" />
  <circle class="arc" cx="24" cy="24" r="19" pathLength="100" />
</svg>

<style>
  .buffer-spinner {
    display: block;
    overflow: visible;
    transform: translateZ(0) rotate(0deg);
    transform-origin: center;
    backface-visibility: hidden;
    will-change: transform;
    animation: buffer-rotate 840ms linear infinite;
  }

  circle {
    fill: none;
    stroke-width: 4;
  }

  .track {
    stroke: rgb(255 255 255 / 0.2);
  }

  .arc {
    stroke: white;
    stroke-linecap: round;
    stroke-dasharray: 72 28;
  }

  @keyframes buffer-rotate {
    to { transform: translateZ(0) rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .buffer-spinner { animation-duration: 1.5s; }
  }
</style>
