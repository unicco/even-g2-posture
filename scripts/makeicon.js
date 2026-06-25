// 24x24 monochrome(grayscale) PNG の猫アイコンを生成（標準 zlib のみ）
const fs = require('fs')
const zlib = require('zlib')

const N = 24
const px = new Uint8Array(N * N) // 0=black, 255=white

function set(x, y, v) {
  if (x >= 0 && x < N && y >= 0 && y < N) px[y * N + x] = v ? 255 : 0
}
function inTri(px_, py_, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  const a = ((by - cy) * (px_ - cx) + (cx - bx) * (py_ - cy)) / d
  const b = ((cy - ay) * (px_ - cx) + (ax - cx) * (py_ - cy)) / d
  const c = 1 - a - b
  return a >= 0 && b >= 0 && c >= 0
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const fx = x + 0.5,
      fy = y + 0.5
    let white = false
    // 頭（楕円）
    const dx = (fx - 12) / 9.0,
      dy = (fy - 13.5) / 8.5
    if (dx * dx + dy * dy <= 1) white = true
    // 耳（左右の三角）
    if (inTri(fx, fy, 5, 1.5, 2, 10, 10, 9)) white = true
    if (inTri(fx, fy, 19, 1.5, 14, 9, 22, 10)) white = true
    set(x, y, white ? 1 : 0)
  }
}
// 目・鼻（黒くくり抜く）
function dot(cx, cy, r) {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r * r) set(x, y, 0)
    }
}
dot(8.5, 13, 1.5)
dot(15.5, 13, 1.5)
dot(12, 16.5, 1.2)

// --- PNG エンコード（grayscale 8bit） ---
const crcTable = (() => {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // color type: grayscale
const raw = Buffer.alloc((N + 1) * N)
for (let y = 0; y < N; y++) {
  raw[y * (N + 1)] = 0
  for (let x = 0; x < N; x++) raw[y * (N + 1) + 1 + x] = px[y * N + x]
}
const idat = zlib.deflateSync(raw)
const out = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
const path = process.argv[2]
fs.writeFileSync(path, out)
console.log('wrote', path, out.length, 'bytes')
