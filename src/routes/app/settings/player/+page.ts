import { redirect } from '@sveltejs/kit'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'

export const load = ({ url }) => {
  throw redirect(307, legacySettingsRedirect(url) ?? '/app/settings/playback')
}
