<script lang="ts">
  import { m } from '$lib/paraglide/messages.js'
  import ConnectTile from './ConnectTile.svelte'
  import { tileBusy, type ConnectStates } from '$lib/onboarding/connect-state'
  import { connectAniList } from '$lib/trackers/anilist-auth'
  import { connectMal } from '$lib/trackers/mal-auth'
  import { anilistToken, anilistUserName, malToken, malUserName } from '$lib/trackers/config'

  let { connections = $bindable() }: { connections: ConnectStates } = $props()

  // Reflect trackers connected before setup ran, so a re-run does not offer them again.
  $effect(() => {
    if ($anilistToken && connections.anilist.status !== 'connected') connections = { ...connections, anilist: { status: 'connected', identity: $anilistUserName } }
    if ($malToken && connections.mal.status !== 'connected') connections = { ...connections, mal: { status: 'connected', identity: $malUserName } }
  })

  async function connect(service: 'anilist' | 'mal') {
    if (tileBusy(connections[service])) return
    connections = { ...connections, [service]: { status: 'busy' } }
    try {
      if (service === 'anilist') await connectAniList()
      else await connectMal()
      connections = { ...connections, [service]: { status: 'connected', identity: service === 'anilist' ? $anilistUserName : $malUserName } }
    } catch (cause) {
      connections = { ...connections, [service]: { status: 'error', message: cause instanceof Error ? cause.message : m.onboarding_connect_failed() } }
    }
  }
</script>

<div class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
  <ConnectTile name="AniList" logo="/brand/anilist.svg" initial="A" description={m.onboarding_connect_tracker_body()} state={connections.anilist} onexpand={() => connect('anilist')} />
  <ConnectTile name="MyAnimeList" logo="/brand/myanimelist.svg" initial="M" description={m.onboarding_connect_tracker_body()} state={connections.mal} onexpand={() => connect('mal')} />
</div>
