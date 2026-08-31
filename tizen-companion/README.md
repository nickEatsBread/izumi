# Izumi Companion for Samsung TV

The standalone TV client is a Preact + TypeScript + Vite application. Its browser preview and Tizen package use the same components, focus model, cast protocol, and player state.

## Local UI preview

```powershell
cd tizen-companion
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. Use the preview bar, mouse, or the arrow keys, Enter, and Backspace. Add `?screen=ready`, `?screen=loading`, `?screen=player`, or `?screen=error` to open a state directly.

## Tizen build

```powershell
npm run build
```

The finished `dist/` contains the app, `config.xml`, icon, Samsung Smart View receiver library, legacy browser chunks, and the AVPlay bootstrap. Package that directory with the Tizen CLI or Tizen Studio.

The production app opens on the pairing/ready state. A companion snapshot opens the home UI; a cast request is handed to the typed AVPlay controller.

## Playback routing

The TV always asks an open paired Izumi client first. If no client acknowledges and this TV was
paired to the owner's self-hosted Worker, it can ask that same Worker for a direct source only when
the owner has explicitly enabled **Resolve TV sources in my Worker**. The TV validates the response
and gives the selected URL to AVPlay; Cloudflare never carries the media bytes.

If resolving is disabled, fails, or returns no portable source, Android can receive the existing
encrypted Web Push request. A TV without a private Worker simply asks the user to open Izumi.
