# Store screenshots

Accurate **576×288** HUD framebuffer captures for the Even Hub store listing.

| File | State |
|------|-------|
| `hud-proud.png` | Good posture (cat sits up, tail raised) |
| `hud-concern.png` | Slouch warning (`!` + wagging tail) |
| `hud-slump.png` | Limp (cat lying down) |

## Why these and not a mockup

The store listing screenshot **must match what the firmware actually renders**.
A hand-drawn mockup (even at 576×288) gets rejected on review. These are exported
straight from the official simulator's glasses framebuffer.

## How to regenerate

The simulator does **not** feed IMU data (`imuData` is always null), so the cat
stays in the default *proud* pose. To capture the other states, temporarily force
the pose, then capture via the simulator's automation HTTP API.

1. Install the official simulator (latest):

   ```bash
   npm install -g @evenrealities/evenhub-simulator
   ```

2. In `src/main.ts`, temporarily force the pose (remove before committing) — just
   before `pendingPose = pose` in the tick loop:

   ```ts
   const f = new URLSearchParams(location.search).get('pose')
   if (f === 'proud')   { pose = 'proud'; stateKey = 'good' }
   if (f === 'concern') { pose = 'concernA'; stateKey = 'concern' }
   if (f === 'slump')   { pose = 'slumpA'; stateKey = 'slump' }
   ```

3. Run the dev server, then launch the simulator with the automation port and pull
   each frame (restart the simulator per pose — the URL is read at startup):

   ```bash
   npm run dev
   evenhub-simulator "http://localhost:5173/?pose=proud" --automation-port 9898
   curl http://127.0.0.1:9898/api/screenshot/glasses > store-screenshots/hud-proud.png
   ```

`GET /api/screenshot/glasses` returns the glasses framebuffer as an RGBA PNG at
exactly 576×288 — the format the store listing expects.
