import { redirect } from '@sveltejs/kit'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'

export const load = ({ url }: { url: URL }) => {
  throw redirect(307, legacySettingsRedirect(url) ?? '/app/settings/sources/manage')
}
