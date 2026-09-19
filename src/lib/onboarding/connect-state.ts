/** The four accounts the connect screen offers, in the order they are drawn. */
export const CONNECT_SERVICES = ['stremio', 'nuvio', 'anilist', 'mal'] as const
export type ConnectService = (typeof CONNECT_SERVICES)[number]

export type ConnectState =
  | { status: 'idle' }
  | { status: 'busy' }
  /** Nuvio's device link: the user approves this code on nuvio.tv while izumi polls. */
  | { status: 'code'; code: string; url: string; completing: boolean }
  | { status: 'connected'; identity: string }
  | { status: 'error'; message: string }

export type ConnectStates = Record<ConnectService, ConnectState>

export function idleConnectStates(): ConnectStates {
  return { stremio: { status: 'idle' }, nuvio: { status: 'idle' }, anilist: { status: 'idle' }, mal: { status: 'idle' } }
}

export function connectedServices(states: ConnectStates): ConnectService[] {
  return CONNECT_SERVICES.filter((service) => states[service].status === 'connected')
}

export function anyConnected(states: ConnectStates): boolean {
  return connectedServices(states).length > 0
}

/** True while the tile is waiting on the network or on an approval, so its action must not re-fire. */
export function tileBusy(state: ConnectState): boolean {
  return state.status === 'busy' || state.status === 'code'
}
