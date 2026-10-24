// The YouTube IFrame API over postMessage, for embeds izumi drives with its own controls. A direct
// embed talks to the YouTube origin; a loopback-bridged embed (desktop WebViews with a non-HTTP app
// origin, youtube-embed.ts) wraps each message in an izumi envelope addressed to the bridge origin.
import { youtubePlayerOrigins, type YoutubeEmbedSource } from './youtube-embed'

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com'

/** What `infoDelivery` (and `initialDelivery`) report. playerState: -1 unstarted, 0 ended,
 *  1 playing, 2 paused, 3 buffering, 5 cued. */
export interface YoutubeInfo {
  playerState?: number
  currentTime?: number
  duration?: number
  muted?: boolean
  videoData?: { isPlayable?: boolean }
}

export interface YoutubeEvent { event: string; info: YoutubeInfo }

/** Posts one IFrame API message to the embed; a no-op until the frame and its source exist. */
export function postToYoutube(target: Window | null | undefined, embed: YoutubeEmbedSource | undefined, message: object): void {
  if (!target || !embed) return
  const payload = JSON.stringify(message)
  if (embed.bridgeOrigin) target.postMessage({ type: 'izumi-youtube-command', payload }, embed.bridgeOrigin)
  else target.postMessage(payload, PLAYER_ORIGIN)
}

/** The handshake that makes the player start sending events; repeat it until `onReady`. */
export function youtubeHandshake(target: Window | null | undefined, embed: YoutubeEmbedSource | undefined): void {
  postToYoutube(target, embed, { event: 'listening', id: 1, channel: 'widget' })
}

/** A player command: `playVideo`, `pauseVideo`, `seekTo` [seconds, true], `mute`, `unMute`. */
export function youtubeCommand(target: Window | null | undefined, embed: YoutubeEmbedSource | undefined, func: string, args: unknown[] = []): void {
  postToYoutube(target, embed, { event: 'command', func, args })
}

/** The player event in a window message, or null when the message is not from this embed (another
 *  window, another origin, the wrong envelope) or not an event at all. */
export function readYoutubeMessage(
  message: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null | undefined,
  embed: YoutubeEmbedSource | undefined,
): YoutubeEvent | null {
  if (!frame || !embed || message.source !== frame) return null
  let payload: unknown
  if (embed.bridgeOrigin) {
    if (message.origin !== embed.bridgeOrigin || message.data?.type !== 'izumi-youtube-event') return null
    payload = message.data.payload
  } else {
    if (!youtubePlayerOrigins.has(message.origin)) return null
    payload = message.data
  }
  if (typeof payload !== 'string') return null
  let json: { event?: unknown; info?: unknown }
  try { json = JSON.parse(payload) } catch { return null }
  if (!json || typeof json.event !== 'string') return null
  return { event: json.event, info: json.info && typeof json.info === 'object' ? json.info as YoutubeInfo : {} }
}
