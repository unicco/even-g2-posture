"""Record one demo cycle of the cat from the official simulator's glasses framebuffer.

Prerequisites (two terminals):
  npm run dev
  evenhub-simulator "http://127.0.0.1:5173/?demo=1" --automation-port 9898

Then:
  python3 -I scripts/capture-demo.py <out_dir>

Polls GET /api/screenshot/glasses at 10 fps for 60 s, aligns to the "[demo] cycle N start"
console log that the app prints with `?demo=1`, cuts exactly one 26 s cycle and encodes
<out_dir>/posture-cat-demo-576.mp4, posture-cat-demo-1152.mp4 and posture-cat-demo.gif
(black background; the framebuffer PNG is transparent). Needs ffmpeg on PATH.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

FPS = 10
CAPTURE_SEC = 60
PERIOD_SEC = 26  # must match DEMO_TIMELINE_MS in src/main.ts
BASE = "http://127.0.0.1:9898"
BLACK_BG = "color=c=black:s=576x288:r=10[bg];[bg][0:v]overlay=shortest=1:format=auto"


def get(path: str) -> bytes:
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return r.read()


def capture(raw_dir: str) -> list[tuple[int, str]]:
    os.makedirs(raw_dir, exist_ok=True)
    frames: list[tuple[int, str]] = []
    interval = 1.0 / FPS
    t0 = time.time()
    n = 0
    while time.time() - t0 < CAPTURE_SEC:
        target = t0 + n * interval
        now = time.time()
        if target > now:
            time.sleep(target - now)
        ts = int(time.time() * 1000)
        path = os.path.join(raw_dir, f"raw_{n:05d}.png")
        with open(path, "wb") as f:
            f.write(get("/api/screenshot/glasses"))
        frames.append((ts, path))
        n += 1
    return frames


def cut_one_cycle(frames: list[tuple[int, str]], seq_dir: str) -> int:
    entries = json.loads(get("/api/console"))["entries"]
    cycles = [e["ts"] for e in entries if e["message"].startswith("[demo] cycle")]
    first_ts, last_ts = frames[0][0], frames[-1][0]
    starts = [c for c in cycles if c >= first_ts and c + PERIOD_SEC * 1000 <= last_ts]
    if not starts:
        sys.exit(f"no full cycle inside the capture window (frames {first_ts}..{last_ts}, cycles {cycles})")
    start = starts[0]
    os.makedirs(seq_dir, exist_ok=True)
    selected = [p for ts, p in frames if start <= ts < start + PERIOD_SEC * 1000]
    for i, p in enumerate(selected):
        os.replace(p, os.path.join(seq_dir, f"f_{i:05d}.png"))
    return len(selected)


def encode(seq_dir: str, out_dir: str) -> None:
    src = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(seq_dir, "f_%05d.png")]
    x264 = ["-c:v", "libx264", "-crf", "18", "-r", str(FPS)]
    subprocess.run(src + ["-filter_complex", BLACK_BG + ",format=yuv420p"] + x264 + [os.path.join(out_dir, "posture-cat-demo-576.mp4")], check=True)
    subprocess.run(src + ["-filter_complex", BLACK_BG + ",scale=1152:576:flags=neighbor,format=yuv420p"] + x264 + [os.path.join(out_dir, "posture-cat-demo-1152.mp4")], check=True)
    subprocess.run(src + ["-filter_complex", BLACK_BG + ",split[a][b];[a]palettegen=max_colors=16[p];[b][p]paletteuse=dither=none", os.path.join(out_dir, "posture-cat-demo.gif")], check=True)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    frames = capture(os.path.join(out_dir, "raw"))
    count = cut_one_cycle(frames, os.path.join(out_dir, "seq"))
    encode(os.path.join(out_dir, "seq"), out_dir)
    print(f"captured {len(frames)} frames, kept {count} for one {PERIOD_SEC}s cycle -> {out_dir}")


if __name__ == "__main__":
    main()
