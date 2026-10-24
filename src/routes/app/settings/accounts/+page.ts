import { redirect } from '@sveltejs/kit'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'

// Old `?section=` links (deep links, the Trakt callback) land on the subcategory that holds them now.
export const load = ({ url }: { url: URL }) => {
  const target = legacySettingsRedirect(url)
  if (target) throw redirect(307, target)
}
