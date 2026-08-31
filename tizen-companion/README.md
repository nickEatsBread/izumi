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
