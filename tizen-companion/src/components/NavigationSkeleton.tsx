import type { ScreenName } from '../types'

export function NavigationSkeleton({ screen, leaving }: { screen: ScreenName; leaving: boolean }) {
  const utility = screen === 'search' || screen === 'settings'
  return (
    <section
      class={`navigation-skeleton skeleton-${screen}${utility ? ' is-utility' : ''}${leaving ? ' is-leaving' : ''}`}
      aria-label="Loading page"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="skeleton-hero" aria-hidden="true" />
      <div class="skeleton-copy" aria-hidden="true">
        <i class="skeleton-line skeleton-eyebrow" />
        <i class="skeleton-line skeleton-title" />
        <i class="skeleton-line skeleton-title skeleton-title-short" />
        <i class="skeleton-line skeleton-meta" />
        <i class="skeleton-line skeleton-body" />
        <i class="skeleton-line skeleton-body skeleton-body-short" />
      </div>
      <div class="skeleton-content" aria-hidden="true">
        <i class="skeleton-line skeleton-section-title" />
        <div class="skeleton-card-row">
          {Array.from({ length: utility ? 8 : 6 }, (_, index) => <i class="skeleton-card" key={index} />)}
        </div>
      </div>
    </section>
  )
}
