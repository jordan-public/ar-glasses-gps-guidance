# navigation

Even Hub G2 navigation starter. Vite + TypeScript + SDK + CLI + simulator, with a glasses-first turn-by-turn route display, Google Maps Directions hookup, live GPS step advancement, and companion controls for testing.

## Run

```bash
npm install
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Google Maps setup

1. Create a browser-restricted Google Maps Platform API key.
2. Enable **Maps JavaScript API** and **Directions API** for the key's project.
3. Open the companion view, paste the key, enter a destination, pick a travel mode, and tap **Start Guidance**.

The API key is stored only in this browser's `localStorage`; it is not committed to the repo.

## Controls

- **Tap:** manually advance to the next navigation step
- **Scroll down:** advance to the next navigation step
- **Scroll up:** go back one step
- **Double-tap:** exit the app
- **Companion view:** start a live Google Maps route, reroute from current GPS, and use Previous, Mute, and Next while testing

## Pack for distribution

```bash
npm run pack
```

Produces an `.ehpk` file.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | WebView host. Viewport meta tag locks zoom; CSS kills iOS double-tap zoom + rubber-band scroll. |
| `src/main.ts` | Creates navigation text containers, loads Google Maps, converts Directions steps to glasses guidance, watches GPS, and handles tap/scroll lifecycle events. |
| `app.json` | Even Hub manifest. No permissions by default. |
| `tsconfig.json` | Standard Vite vanilla-ts config. |
| `vite.config.ts` | Dev server on port 5173, host binding for LAN QR access. |

## Next steps

- Add production key provisioning instead of manual key entry.
- Confirm whether the packaged Even Hub runtime needs an explicit location permission string for store distribution.
- Add image containers if you want map tiles or lane diagrams.
