/** The sandbox a plugin runs in: a hidden `<iframe sandbox="allow-scripts">` (an opaque origin: no
 *  izumi storage, cookies or IPC, which Tauri injects into the main frame only) whose CSP allows only
 *  this bootstrap and blob: workers, and no connections at all. The bootstrap starts a classic Worker
 *  (off the UI thread; removing the iframe kills it), which inherits that CSP and imports the plugin's
 *  module from a blob. A module Worker cannot start from a blob in an opaque origin on WebView2. The
 *  plugin talks to izumi only through the MessagePort handed to it. */

// WebView2 injects Tauri's IPC globals into every frame, this sandbox included (seen 2026-11-15).
// `__TAURI_INTERNALS__` and `ipc` are non-configurable here, but Tauri ignores IPC from this frame:
// an invoke gets no answer and a `set volume` from it changed nothing. Plugin code never runs in the
// frame anyway (only in the Worker, where these do not exist). The bootstrap still removes what it
// can, and the probe checks that an invoke from the frame stays unanswered.
const BOOTSTRAP = `for (const name of ['__TAURI_INTERNALS__', '__TAURI__', '__TAURI_POST_MESSAGE__', '__TAURI_IPC__', 'ipc']) {
  try { delete window[name] } catch {}
  try { if (window[name] !== undefined) Object.defineProperty(window, name, { value: undefined, configurable: false }) } catch {}
}
try { if (window.chrome && window.chrome.webview) Object.defineProperty(window.chrome, 'webview', { value: undefined, configurable: false }) } catch {}
addEventListener('message', (event) => {
  const data = event.data
  if (event.source !== parent || !data || data.type !== 'izumi-plugin-boot' || !event.ports[0]) return
  const port = event.ports[0]
  const run = (results) => {
    const worker = new Worker(URL.createObjectURL(new Blob([data.prelude], { type: 'text/javascript' })))
    worker.onerror = (e) => port.postMessage({ type: 'failed', error: String(e.message || 'worker error') })
    worker.postMessage({ type: 'boot', code: data.code, probe: !!data.probe, frame: results }, [port])
  }
  if (!data.probe) return run(null)
  // Conformance probe (frame side): each must fail.
  const results = {}
  const attempt = async (name, fn) => { try { await fn(); results[name] = 'escaped' } catch { results[name] = 'blocked' } }
  Promise.all([
    attempt('frame.parent', () => parent.document.title),
    attempt('frame.localStorage', () => localStorage.length),
    attempt('frame.indexedDB', () => new Promise((ok, no) => { const r = indexedDB.open('probe'); r.onsuccess = ok; r.onerror = no })),
    attempt('frame.cookie', () => { void document.cookie }),
    attempt('frame.ipc', () => new Promise((ok, no) => {
      const internals = window.__TAURI_INTERNALS__
      if (!internals || typeof internals.invoke !== 'function') return no()
      const timer = setTimeout(no, 2000)
      internals.invoke('plugin:app|version').then((v) => { clearTimeout(timer); ok(v) }, () => { clearTimeout(timer); no() })
    })),
    attempt('frame.webview', () => { if (!(window.chrome && window.chrome.webview)) throw 0 }),
    attempt('frame.fetch', () => fetch('https://example.com/', { mode: 'no-cors' })),
    attempt('frame.ipcFetch', () => fetch('http://ipc.localhost/plugin%3Aapp%7Cversion', { method: 'POST' })),
  ]).then(() => run(results))
}, { once: false })`

/** Runs in the Worker before the plugin: builds the `izumi` API over the port, then imports the plugin
 *  module and calls its `activate(izumi)`. */
export const WORKER_PRELUDE = `self.onmessage = async (event) => {
  const data = event.data
  if (!data || data.type !== 'boot' || !event.ports[0]) return
  self.onmessage = null
  const port = event.ports[0]
  if (data.probe) {
    const results = { ...(data.frame || {}) }
    const attempt = async (name, fn) => { try { await fn(); results[name] = 'escaped' } catch { results[name] = 'blocked' } }
    await attempt('worker.fetch', () => fetch('https://example.com/', { mode: 'no-cors' }))
    await attempt('worker.xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.onload = ok; x.onerror = no; x.open('GET', 'https://example.com/'); x.send() }))
    await attempt('worker.websocket', () => new Promise((ok, no) => { const s = new WebSocket('wss://example.com/'); s.onopen = ok; s.onerror = no }))
    await attempt('worker.import', () => import('https://example.com/probe.js'))
    await attempt('worker.indexedDB', () => new Promise((ok, no) => { const r = indexedDB.open('probe'); r.onsuccess = ok; r.onerror = no }))
    await attempt('worker.caches', () => caches.open('probe'))
    await attempt('worker.ipc', () => { if (!self.__TAURI_INTERNALS__ && !self.ipc && !(self.chrome && self.chrome.webview)) throw 0 })
    await attempt('worker.ipcFetch', () => fetch('http://ipc.localhost/plugin%3Aapp%7Cversion', { method: 'POST' }))
    port.postMessage({ type: 'probe', results })
    return
  }
  let seq = 0
  const waiting = new Map()
  const handlers = Object.create(null)
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    port.postMessage({ type: 'call', id, method, args })
  })
  port.onmessage = (e) => {
    const m = e.data
    if (!m) return
    if (m.type === 'reply') {
      const w = waiting.get(m.id)
      if (!w) return
      waiting.delete(m.id)
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.value)
    } else if (m.type === 'event') {
      const handler = handlers[m.name]
      if (handler) Promise.resolve().then(() => handler(m.payload)).catch((err) => call('log', 'error', String(err && err.stack || err)))
    } else if (m.type === 'ping') port.postMessage({ type: 'pong', n: m.n })
  }
  const izumi = Object.freeze({
    settings: Object.freeze({ get: () => call('settings.get') }),
    storage: Object.freeze({ get: (key) => call('storage.get', key), set: (key, value) => call('storage.set', key, value), delete: (key) => call('storage.delete', key) }),
    secrets: Object.freeze({ get: (key) => call('secrets.get', key), set: (key, value) => call('secrets.set', key, value), delete: (key) => call('secrets.delete', key) }),
    signin: Object.freeze({ listen: (path) => call('signin.listen', path), open: (url) => call('signin.open', String(url)), wait: () => call('signin.wait'), cancel: () => call('signin.cancel') }),
    fetch: async (url, init = {}) => {
      const r = await call('fetch', String(url), { method: init.method, headers: init.headers, body: init.body })
      return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers, text: async () => r.body, json: async () => JSON.parse(r.body) }
    },
    player: Object.freeze({ status: () => call('player.status'), subtitles: () => call('player.subtitles'), seek: (seconds) => call('player.seek', seconds) }),
    ui: Object.freeze({ setPanel: (state) => call('ui.setPanel', state), setAccount: (state) => call('ui.setAccount', state), notice: (text) => call('ui.notice', text) }),
    log: (...parts) => call('log', 'info', parts.map(String).join(' ')),
    on: (name, handler) => { handlers[name] = handler },
  })
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) { try { self[name] = undefined } catch {} }
  try {
    const url = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }))
    const mod = await import(url)
    URL.revokeObjectURL(url)
    const plugin = mod.default
    if (!plugin || typeof plugin.activate !== 'function') throw new Error('The plugin has no default export with activate(izumi).')
    await plugin.activate(izumi)
    port.postMessage({ type: 'ready' })
  } catch (err) {
    port.postMessage({ type: 'failed', error: String(err && err.stack || err) })
  }
}`

let srcdoc: Promise<string> | undefined
/** The iframe document: the bootstrap, allowed by its hash and nothing else. */
export function sandboxDocument(): Promise<string> {
  return (srcdoc ??= (async () => {
    const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOOTSTRAP)))))
    const csp = `default-src 'none'; script-src 'sha256-${hash}' blob:; worker-src blob:`
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${BOOTSTRAP}</script>`
  })())
}

/** A hidden sandbox frame, booted with `code` (or the conformance probe). Resolves with its port once
 *  the frame has loaded. */
export async function createSandbox(code: string, probe = false): Promise<{ frame: HTMLIFrameElement; port: MessagePort }> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('data-plugin-sandbox', '')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
  frame.srcdoc = await sandboxDocument()
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }))
  document.body.append(frame)
  await loaded
  const channel = new MessageChannel()
  frame.contentWindow?.postMessage({ type: 'izumi-plugin-boot', prelude: WORKER_PRELUDE, code, probe }, '*', [channel.port2])
  return { frame, port: channel.port1 }
}

/** Every way out must fail before plugins run on this engine (spec §7.5). Results by check name. */
export async function runConformance(timeoutMs = 8000): Promise<Record<string, 'blocked' | 'escaped'> | null> {
  const { frame, port } = await createSandbox('', true)
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      port.onmessage = (event) => {
        if (event.data?.type !== 'probe') return
        clearTimeout(timer)
        resolve(event.data.results)
      }
    })
  } finally {
    port.close()
    frame.remove()
  }
}

