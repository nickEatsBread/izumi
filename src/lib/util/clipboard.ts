// Copy text to the clipboard, reliably inside BOTH Tauri webviews.
//
// `navigator.clipboard` is unreliable over the app's custom-protocol origin: UNDEFINED in WebKitGTK
// (Linux/Steam Deck — the origin isn't a secure context, so the async Clipboard API isn't exposed),
// and present-but-blocked/rejecting in WebView2 (Windows). Either way `navigator.clipboard.writeText`
// silently fails. So we lead with a temporary <textarea> + `document.execCommand('copy')`: the
// synchronous legacy path that works in WebView2 AND WebKitGTK as long as it runs inside a user
// gesture (a click handler — exactly where this is called). The async API is only a last resort.
// Returns whether the copy landed.
export function copyToClipboard(text: string): boolean {
  if (!text) return false
  if (execCopy(text)) return true
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return true }
  }
  catch { /* nothing else to try */ }
  return false
}

function execCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  // Preserve any existing selection so copying doesn't disturb the page.
  const sel = document.getSelection()
  const prev = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try { ok = document.execCommand('copy') }
  catch { ok = false }
  document.body.removeChild(ta)
  if (sel && prev) { sel.removeAllRanges(); sel.addRange(prev) }
  return ok
}
