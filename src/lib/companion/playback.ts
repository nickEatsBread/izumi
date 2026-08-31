import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'
import { mediaRef } from '$lib/catalog/identity'
import type { Stream } from '$lib/stremio/addon'
import { castSourceDecision, castSubtitleFormat } from '$lib/player/android-cast'
import { playerNotice } from '$lib/player/session'
import { setTizenReceiverRelayForeground, startTizenReceiverCast } from '$lib/player/tizen-receiver-cast'
import { effectiveSubtitleStyle, sessionSubtitleStyle } from '$lib/settings/subtitle-presets'
import {
  subtitleBold,
  subtitleBorderColor,
  subtitleBorderSize,
  subtitleFont,
  subtitleFontSize,
  subtitleOverrideScope,
  subtitlePosition,
  subtitleShadow,
  subtitleStyleEnabled,
  subtitleTextColor,
} from '$lib/settings/ui'
import { updateCloudflareCompanionRequest } from '$lib/sync/cloudflare'
import { pendingCompanionPlayback } from './client'
import type { CompanionMedia } from './protocol'

export interface CompanionCastSubtitle {
  url: string
  lang?: string
  title?: string
  headers?: Record<string, string>
  isDefault?: boolean
}

interface PreparedCastSource {
  url: string
  relayed: boolean
  subtitles: { url: string; lang?: string; title?: string; contentType: string }[]
}

export function companionPlaybackMatches(
  requested: CompanionMedia,
  media: Pick<Media, 'id' | 'type' | 'format' | 'catalog'>,
  episode?: number,
): boolean {
  const actual = mediaRef(media)
  return requested.ref.provider === actual.provider
    && requested.ref.type === actual.type
    && requested.ref.id === actual.id
    && (requested.episode == null || requested.episode === episode)
}

function castStyle() {
  const style = effectiveSubtitleStyle(get(sessionSubtitleStyle), {
    enabled: get(subtitleStyleEnabled),
    scope: get(subtitleOverrideScope),
    font: get(subtitleFont),
    bold: get(subtitleBold),
    fontSize: get(subtitleFontSize),
    textColor: get(subtitleTextColor),
    borderColor: get(subtitleBorderColor),
    borderSize: get(subtitleBorderSize),
    shadow: get(subtitleShadow),
    position: get(subtitlePosition),
  })
  return {
    enabled: style.enabled,
    scope: style.scope,
    font: style.font,
    bold: style.bold,
    fontSize: style.fontSize,
    textColor: style.textColor,
    borderColor: style.borderColor,
    borderSize: style.borderSize,
    shadow: style.shadow,
    position: style.position,
  }
}

/** Consume the session-only TV target after source resolution. Returns false for ordinary plays. */
export async function startPendingCompanionCast(input: {
  media: Media
  episode?: number
  stream: Stream
  startSeconds: number
  subtitles: CompanionCastSubtitle[]
}): Promise<boolean> {
  const pending = get(pendingCompanionPlayback)
  if (!pending) return false
  if (pending.expiresAt && pending.expiresAt <= Date.now()) {
    pendingCompanionPlayback.set(null)
    throw new Error('The TV playback request expired. Start it again from the TV.')
  }
  if (!companionPlaybackMatches(pending.media, input.media, input.episode)) {
    pendingCompanionPlayback.set(null)
    if (pending.pairingId && pending.requestId) {
      void updateCloudflareCompanionRequest(pending.pairingId, pending.requestId, 'cancelled').catch(() => {})
    }
    return false
  }

  const source = {
    url: input.stream.url,
    headers: input.stream.__headers ?? {},
    infoHash: input.stream.infoHash,
    filename: input.stream.behaviorHints?.filename,
    manifest: input.stream.__manifest,
    drm: input.stream.__drm,
  }
  const decision = castSourceDecision(source, [], undefined, 'tv')
  if (!decision.ok) throw new Error(decision.error)

  const candidates = input.subtitles
    .flatMap((item) => {
      const format = castSubtitleFormat(item.url)
      return format ? [{ ...item, format }] : []
    })
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
    .slice(0, 8)
  const prepared = await invoke<PreparedCastSource>('cast_prepare_source', {
    request: {
      url: decision.url,
      headers: source.headers,
      manifest: source.manifest,
      forceRelay: false,
      contentType: decision.contentType,
      subtitleDelivery: 'tizenReceiver',
      subtitles: candidates.map((item) => ({
        url: item.url,
        lang: item.lang,
        title: item.title,
        format: item.format,
        headers: item.headers ?? {},
      })),
    },
  })

  const castTitle = input.episode != null ? `${title(input.media)} — Episode ${input.episode}` : title(input.media)
  const streamDrm = input.stream.__drm
  const drmSystem = streamDrm?.keySystem?.toLowerCase().includes('playready')
    ? 'playready'
    : streamDrm?.keySystem?.toLowerCase().includes('widevine')
      ? 'widevine'
      : undefined
  if (streamDrm && (!drmSystem || !streamDrm.licenseUrl)) {
    throw new Error('This protected stream does not expose a Samsung-compatible online license.')
  }
  await startTizenReceiverCast({
    id: pending.device.deviceId,
    name: pending.device.name,
    address: pending.device.address,
  }, {
    url: prepared.url,
    title: castTitle,
    contentRating: input.media.contentRating || (input.media.isAdult ? '18' : undefined),
    contentType: decision.contentType,
    positionSeconds: input.startSeconds,
    subtitles: prepared.subtitles,
    activeTrackIds: prepared.subtitles.length ? [1] : [],
    subtitleStyle: castStyle(),
    adaptive: /mpegurl|dash/i.test(decision.contentType) ? { startBitrate: 'AVERAGE' } : undefined,
    drm: drmSystem && streamDrm?.licenseUrl ? {
      system: drmSystem,
      licenseServer: streamDrm.licenseUrl,
      headers: streamDrm.licenseHeaders,
      deleteLicenseAfterUse: true,
    } : undefined,
  }, 'Izumi')
  if (prepared.relayed) await setTizenReceiverRelayForeground(true, castTitle)

  pendingCompanionPlayback.set(null)
  if (pending.pairingId && pending.requestId) {
    void updateCloudflareCompanionRequest(pending.pairingId, pending.requestId, 'accepted').catch(() => {})
  }
  playerNotice.set(`Playing on ${pending.device.name}`)
  return true
}
