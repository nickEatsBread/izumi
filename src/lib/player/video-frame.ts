import { isSolidBlackImageData } from './drm'

/** Size a captured video frame so the long edge is at most `maxWidth`. */
export function videoFrameSize(videoWidth: number, videoHeight: number, maxWidth: number): { width: number; height: number } {
  const vw = Math.max(1, videoWidth)
  const vh = Math.max(1, videoHeight)
  const scale = Math.min(1, Math.max(1, maxWidth) / vw)
  return {
    width: Math.max(1, Math.round(vw * scale)),
    height: Math.max(1, Math.round(vh * scale)),
  }
}

async function canvasFromVideo(
  video: HTMLVideoElement,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) throw new Error('2D frame capture is unavailable')
  const painted = () => !isSolidBlackImageData(ctx.getImageData(0, 0, width, height).data)
  try {
    if (typeof VideoFrame === 'function') {
      const frame = new VideoFrame(video)
      ctx.drawImage(frame, 0, 0, width, height)
      frame.close()
      if (painted()) return canvas
    }
  } catch { /* EME or missing WebCodecs */ }
  try {
    const bitmap = await createImageBitmap(video)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    if (painted()) return canvas
  } catch { /* tainted / protected */ }
  ctx.drawImage(video, 0, 0, width, height)
  if (!painted()) throw new Error('protected video frame')
  return canvas
}

/** Paint sidecar HTML cues onto a video-sized canvas. Controls are not in `overlay`. */
export function paintDomOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: HTMLElement,
  video: HTMLVideoElement,
): void {
  const origin = video.getBoundingClientRect()
  if (origin.width < 1 || origin.height < 1) return
  const sx = ctx.canvas.width / origin.width
  const sy = ctx.canvas.height / origin.height
  const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const el = node.parentElement
    node = walker.nextNode()
    if (!text || !el) continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    const fontSize = Number.parseFloat(style.fontSize || '16') || 16
    ctx.save()
    ctx.font = style.font || `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = Math.max(2, fontSize * 0.08 * sx)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.fillStyle = style.color || '#fff'
    const x = (box.left + box.width / 2 - origin.left) * sx
    const y = (box.top + box.height / 2 - origin.top) * sy
    const maxWidth = Math.max(8, box.width * sx)
    ctx.strokeText(text, x, y, maxWidth)
    ctx.fillText(text, x, y, maxWidth)
    ctx.restore()
  }
}

/** Grab the decoded video bitmap (and optional sidecar cues). Player chrome is not in this frame. */
export async function encodeVideoFrame(
  video: HTMLVideoElement,
  mime: 'image/png' | 'image/jpeg',
  maxWidth: number,
  overlay?: HTMLElement | null,
): Promise<Uint8Array> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('video frame unavailable')
  const { width, height } = videoFrameSize(video.videoWidth, video.videoHeight, maxWidth)
  const canvas = await canvasFromVideo(video, width, height)
  const ctx = canvas.getContext('2d')
  if (ctx && overlay) paintDomOverlay(ctx, overlay, video)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.84))
  if (!blob || blob.size < 16) throw new Error('empty video frame')
  return new Uint8Array(await blob.arrayBuffer())
}
