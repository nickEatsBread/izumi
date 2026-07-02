// The player window loads `WebviewUrl::App("player")`, so adapter-static must
// emit this route as a real HTML file (not just the SPA fallback). `prerender`
// makes the build write `player.html`; `ssr = false` keeps it a client-only
// Tauri page (no server render, matching the rest of the app).
export const prerender = true
export const ssr = false
