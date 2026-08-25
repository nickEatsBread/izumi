import { redirect } from '@sveltejs/kit'
export const load = ({ url }) => {
  throw redirect(307, url.searchParams.has('capture-overlay') ? '/capture-overlay' : '/app/home')
}
