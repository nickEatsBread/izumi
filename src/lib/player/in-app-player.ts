import { derived, type Readable } from 'svelte/store'
import { androidUiPreview, isAndroid, isNativeAndroid } from '$lib/platform'
import { androidPlayerPlugin, hasEmbeddedPlayer } from './android-mpv'

/**
 * Whether videos play in izumi's own player on this build (spec §5.1). Every desktop build does. On
 * Android only the full build does: it ships the embedded mpv plugin, where the lite build hands
 * videos to the device's video player. The development preview of the Android UI counts as the full
 * build. While the plugin probe has not answered (null), Android counts as unavailable, so the Player
 * page's in-app rows only ever appear and never vanish from under a focused row (TV focus).
 */
export const inAppPlayerAvailable: Readable<boolean> = derived(
  [isAndroid, androidUiPreview, androidPlayerPlugin],
  ([android, preview, plugin]) => !android || preview || plugin === true,
)

/**
 * Boot probe, called by the app layout right after initPlatform(). On a native Android build it asks
 * once whether the embedded player plugin is compiled in; hasEmbeddedPlayer() caches the answer and
 * publishes it to androidPlayerPlugin. Everywhere else (desktop, the desktop Android preview, plain
 * web) it does nothing. Never rejects: hasEmbeddedPlayer() turns a failed probe into `false`.
 */
export async function probeInAppPlayer(): Promise<void> {
  if (!isNativeAndroid()) return
  await hasEmbeddedPlayer()
}
