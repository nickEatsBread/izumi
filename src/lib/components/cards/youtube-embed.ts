import { invoke } from '@tauri-apps/api/core'

export type YoutubeEmbedOptions = {
  controls: boolean
  muted: boolean
}

export type YoutubeEmbedSource = {
  src: string
  bridgeOrigin?: string
}

export const youtubePlayerOrigins = new Set([
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
])

export function youtubeEmbedNeedsBridge(protocol = location.protocol): boolean {
  return protocol !== 'http:' && protocol !== 'https:'
}

export function directYoutubeEmbedUrl(
  id: string,
  options: YoutubeEmbedOptions,
  pageOrigin = location.origin,
): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    autoplay: '1',
    controls: options.controls ? '1' : '0',
    mute: options.muted ? '1' : '0',
    disablekb: options.controls ? '0' : '1',
    cc_lang_pref: 'ja',
    iv_load_policy: '3',
    playsinline: '1',
    rel: '0',
  })

  if (pageOrigin.startsWith('http://') || pageOrigin.startsWith('https://')) {
    params.set('origin', pageOrigin)
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`
}

export async function youtubeEmbedSource(
  id: string,
  options: YoutubeEmbedOptions,
): Promise<YoutubeEmbedSource> {
  if (!youtubeEmbedNeedsBridge()) {
    return { src: directYoutubeEmbedUrl(id, options) }
  }

  const src = await invoke<string>('youtube_embed_url', {
    id,
    controls: options.controls,
    muted: options.muted,
  })
  const url = new URL(src)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('The YouTube embed bridge returned an unsafe URL')
  }
  return { src, bridgeOrigin: url.origin }
}
