import { redirect } from '@sveltejs/kit'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'

// The tab strip is gone: an old `?tab=` link lands on the sub-page or subcategory that replaced it.
export const load = ({ url }: { url: URL }) => {
  if (url.searchParams.has('tab')) throw redirect(307, legacySettingsRedirect(url) ?? '/app/settings/sources')
}
