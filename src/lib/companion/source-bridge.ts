import { get, writable } from 'svelte/store'
import { describe } from '$lib/stremio/addon'
import type { Stream } from '$lib/stremio/addon'
import { commitResolveSelection, createResolveSession, playStream, type PlayState } from '$lib/stremio/play'
import { connecting, streamPicker, type StreamPickerState } from '$lib/player/session'
import {
  pendingCompanionPlayback,
  publishCompanionSourceOptions,
  type PairedCompanion,
} from './client'
import { companionPlaybackMatches } from './playback'

let activeKey = ''
let nextChoiceId = 1
let ids = new Map<Stream, string>()
let streamsById = new Map<string, Stream>()
let lastSignature = ''
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** TV-owned resolve state is deliberately separate from the on-screen picker. A live Companion
 * request can therefore rank and prepare a source without replacing anything the linked device's
 * user is currently looking at. */
export const companionStreamPicker = writable<StreamPickerState | null>(null)
export const companionResolveSession = createResolveSession()

function activePicker() {
  const pending = get(pendingCompanionPlayback)
  return pending?.headless ? get(companionStreamPicker) : get(streamPicker)
}

function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
}

function scheduleRetry() {
  if (retryTimer !== null) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    publishCurrent()
  }, 1_000)
}

function reset(key = '') {
  clearRetry()
  activeKey = key
  nextChoiceId = 1
  ids = new Map()
  streamsById = new Map()
  lastSignature = ''
}

function choiceFor(stream: Stream) {
  let id = ids.get(stream)
  if (!id) {
    id = `source-${nextChoiceId++}`
    ids.set(stream, id)
    streamsById.set(id, stream)
  }
  const info = describe(stream)
  const label = (info.filename || info.label || info.group || info.addon || 'Source').slice(0, 180)
  const detail = [
    ...info.badges.slice(0, 4),
    info.server,
    info.addon,
  ].filter((part): part is string => Boolean(part) && part !== label)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(' · ')
    .slice(0, 240)
  return { id, label, detail: detail || undefined }
}

function publishCurrent(error?: string) {
  const pending = get(pendingCompanionPlayback)
  const picker = activePicker()
  if (!pending?.requestId || pending.media.playback?.selection !== 'manual' || !picker
    || !companionPlaybackMatches(pending.media, picker.media, picker.episode)) {
    if (activeKey) reset()
    return
  }
  const key = `${pending.device.deviceId}:${pending.requestId}`
  if (key !== activeKey) reset(key)
  const choices = picker.streams.slice(0, 40).map(choiceFor)
  const message = error ?? picker.playbackError
  const signature = JSON.stringify([key, picker.resolving === true, message ?? '', choices])
  if (signature === lastSignature) return
  if (publishCompanionSourceOptions(pending.device.deviceId, pending.requestId, {
    choices,
    resolving: picker.resolving === true,
    error: message,
  })) {
    lastSignature = signature
    clearRetry()
  } else {
    scheduleRetry()
  }
}

/** Mirrors a manual linked-device resolve to the TV without exposing signed URLs. */
export function initCompanionSourceBridge(): () => void {
  const update = () => publishCurrent()
  const stopPicker = streamPicker.subscribe(update)
  const stopCompanionPicker = companionStreamPicker.subscribe(update)
  const stopPending = pendingCompanionPlayback.subscribe(update)
  return () => {
    stopPicker()
    stopCompanionPicker()
    stopPending()
    companionStreamPicker.set(null)
    reset()
  }
}

/** Commit the opaque row selected on TV. The ordinary playStream path still owns debrid/P2P,
 * preparation, and the final receiver load, so there is no second resolver implementation. */
export async function selectPendingCompanionSource(requestId: string, choiceId: string, device: PairedCompanion): Promise<void> {
  const pending = get(pendingCompanionPlayback)
  const picker = activePicker()
  const key = `${device.deviceId}:${requestId}`
  const stream = key === activeKey ? streamsById.get(choiceId) : undefined
  if (!pending || pending.requestId !== requestId || pending.device.deviceId !== device.deviceId
    || !picker || !stream || !companionPlaybackMatches(pending.media, picker.media, picker.episode)) return

  const pickerStore = pending.headless ? companionStreamPicker : streamPicker
  commitResolveSelection(pending.headless ? companionResolveSession : undefined)
  if (!pending.headless) connecting.set(null)
  pickerStore.update((current) => current ? { ...current, hidden: true, playbackError: undefined } : current)
  await playStream(picker.media, picker.episode, stream, (state: PlayState) => {
    if (state.status === 'playing') pickerStore.set(null)
    else if (state.status === 'error') {
      pickerStore.update((current) => current ? { ...current, resolving: false, playbackError: state.message, hidden: true } : current)
      publishCurrent(state.message ?? 'That source could not be played on the TV.')
    }
  }, {
    autoplay: true,
    startSeconds: picker.startSeconds,
    companion: true,
  })
}
