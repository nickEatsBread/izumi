// Requests other parts of the series page make of its episode list. The phone More menu's "Download
// episodes" (beside a header Download, `detail.buttons` `download`) opens the list's download selection
// with the Play episode picked; the header Download itself queues that one episode.
// The list may not be on screen when it is asked (a theme's tabs mount it on first open), so a request
// made with no list open waits briefly for the next one to open: long enough for the page to switch to
// the episodes, never long enough to reach another series' page.

export interface DownloadSelectRequest {
  /** The episode to pick. */
  episode: number
  /** The series it belongs to; a list for another series ignores the request. */
  mediaId?: number
}

type Handler = (request: DownloadSelectRequest) => void

/** How long a request waits for an episode list to open. */
export const PENDING_MS = 5000

let listener: { mediaId: number; run: Handler } | null = null
let pending: (DownloadSelectRequest & { at: number }) | null = null

const forList = (request: DownloadSelectRequest, mediaId: number) => request.mediaId == null || request.mediaId === mediaId

/** Open the episode list's download selection with episode `ep` picked (and its page shown). Pass the
 *  series id when there is one, so the request never reaches another series' list. Returns `true` when
 *  an open list took it, `false` when it waits for the list to open. */
export function startDownloadSelect(ep: number, mediaId?: number): boolean {
  const request: DownloadSelectRequest = { episode: ep, mediaId }
  if (listener && forList(request, listener.mediaId)) {
    pending = null
    listener.run(request)
    return true
  }
  pending = { ...request, at: Date.now() }
  return false
}

/** The episode list's side: run the download-selection requests for series `mediaId`, starting with
 *  one made just before the list opened. Returns the function that stops listening. */
export function onDownloadSelect(mediaId: number, run: Handler): () => void {
  const own = { mediaId, run }
  listener = own
  const waiting = pending
  pending = null
  if (waiting && Date.now() - waiting.at <= PENDING_MS && forList(waiting, mediaId)) run({ episode: waiting.episode, mediaId: waiting.mediaId })
  return () => { if (listener === own) listener = null }
}
