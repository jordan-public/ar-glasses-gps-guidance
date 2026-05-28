# navigation

Even Hub G2 navigation starter. Vite + TypeScript + SDK + CLI + simulator, with a glasses-first turn-by-turn route display and companion controls for testing.

## Run

```bash
npm install
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Controls

- **Tap:** advance to the next navigation step
- **Scroll down:** advance to the next navigation step
- **Scroll up:** go back one step
- **Double-tap:** exit the app
- **Companion view:** use Previous, Mute, and Next while testing in the WebView or simulator

## Pack for distribution

```bash
npm run pack
```

Produces an `.ehpk` file.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | WebView host. Viewport meta tag locks zoom; CSS kills iOS double-tap zoom + rubber-band scroll. |
| `src/main.ts` | Creates navigation text containers, renders route steps, and handles tap/scroll lifecycle events. |
| `app.json` | Even Hub manifest. No permissions by default. |
| `tsconfig.json` | Standard Vite vanilla-ts config. |
| `vite.config.ts` | Dev server on port 5173, host binding for LAN QR access. |

## Next steps

- Replace the demo route in `src/main.ts` with route steps from your navigation service.
- Add location permissions and a routing API when you are ready for live navigation.
- Add image containers if you want map tiles or lane diagrams.
