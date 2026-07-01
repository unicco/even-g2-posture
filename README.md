# Posture Cat 🐱

A reactive posture reminder for the [Even Realities G2](https://www.evenrealities.com/) smart glasses.

A little cat sits in the corner of your HUD and mirrors how you hold your head:

- **Good posture** → the cat sits up proud.
- **Slouching for a while** → it warns you with a `!` and a wagging tail.
- **Keep slouching** → it goes limp.
- **Sit up straight** → it perks right back.

Everything runs **on-device**. Only the built-in motion sensor (IMU) is used — no camera, microphone, network, or account.

| Good | Warning | Limp |
|------|---------|------|
| ![good](./store-screenshots/hud-proud.png) | ![warning](./store-screenshots/hud-concern.png) | ![limp](./store-screenshots/hud-slump.png) |

(Actual 576×288 HUD framebuffers, captured from the official simulator.)

## Features

- Reactive cat with three states (good / warning / limp), drawn on a `<canvas>` and pushed to the HUD.
- Tail-wag animation in the warning and limp states.
- In-app settings on the phone screen, applied live and saved to `localStorage`:
  - tilt threshold (how far down counts as slouching)
  - seconds before the `!` warning
  - seconds before the cat goes limp
  - debug overlay on/off
- Japanese / English UI, auto-selected from the device language.
- 100% on-device, no network calls.

## How it works

The IMU reports head orientation; the app watches the **X axis (pitch)**. Looking down drives X negative. When the smoothed X stays below the configured threshold for the configured time, the cat reacts. The cat is drawn with the Canvas API, exported to PNG, and rendered to the HUD through the Even Hub SDK's image container. The phone WebView shows a small status/settings screen.

## Develop

Requirements: Node 18+, an Even G2 paired with the Even app, and developer mode enabled (sign in at [hub.evenrealities.com](https://hub.evenrealities.com), then a Developer Center appears in the app).

```bash
npm install
npm run dev            # Vite dev server (binds 0.0.0.0 for LAN access)
npx evenhub qr         # QR of the dev URL -> scan it in the app's Developer Center
```

Build & package:

```bash
npm run build
npx evenhub pack app.json ./dist -o posture-cat.ehpk
```

## Notes & gotchas (learned the hard way)

Even G2 examples are scarce, so here are the things that tripped us up:

- **The IMU only streams while the head is moving.** When you hold still, the data stops. Don't gate your logic on sample freshness — hold the last reading and treat "no new data" as "posture unchanged".
- **`updateImageRawData` can resolve with `sendFailed`** — a *result value*, not a thrown error — when BLE is flaky. Re-send until it returns `success`.
- **HUD images are PNG/BMP bytes** (`Uint8Array`); the host converts them to grayscale. Draw on a Canvas → `canvas.toBlob('image/png')` → send. Images can only be sent **after** `createStartUpPageContainer`, and not concurrently (await each send).
- **Container properties are classes**, not plain objects — use `new TextContainerProperty({...})`, `new ImageContainerProperty({...})`, etc.
- **The dev server must bind IPv4** (`server.host: '0.0.0.0'`). `host: true` binds IPv6-only and the phone can't reach it. Add any tunnel hostname to `server.allowedHosts`.
- **HUD text has a fixed font size** — you can position and bound a text box but not scale the glyphs. Use images for anything graphic.
- **`shutDownPageContainer` has two modes, and review checks both.** On a **double-tap** (`DOUBLE_CLICK_EVENT`) — the homepage exit gesture — call `shutDownPageContainer(1)` to pop the OS confirmation dialog and let the *user* decide; don't tear down yet. Only once the user confirms does the OS fire an **exit event** (`FOREGROUND_EXIT` / `ABNORMAL_EXIT` / `SYSTEM_EXIT`); handle those by calling `imuControl(false)` to stop the sensor and `shutDownPageContainer(0)` (immediate exit / post-confirmation cleanup) instead of relying on the OS to auto-kill the page. Using `(0)` on the double-tap skips the dialog and fails review.
- **The simulator has no IMU.** `@evenrealities/evenhub-simulator` rejects `imuControl` (and `imuData` is always null), so don't `await imuControl(true)` un-guarded — an unhandled rejection there kills the whole app before it draws. Wrap it; the re-arm loop retries on real hardware.
- **Store screenshots come from the simulator**, not a mockup — see [`store-screenshots/`](./store-screenshots/).

## Tech

TypeScript + [Vite](https://vite.dev) + [`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk), packaged with [`@evenrealities/evenhub-cli`](https://www.npmjs.com/package/@evenrealities/evenhub-cli).

## License

[MIT](./LICENSE)

---

**日本語**: Even Realities G2 用の姿勢リマインダー。HUD の隅に猫がいて、うつむきが続くと `!` で警告し、放置するとぐったり、背すじを伸ばすと元気に戻ります。すべて端末内で完結（IMU のみ使用・通信なし）。設定（傾き・秒数・デバッグ）はスマホ画面から変更でき、日本語/英語は端末言語で自動切替。
