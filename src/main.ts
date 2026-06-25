import {
  waitForEvenAppBridge,
  ImuReportPace,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
} from '@evenrealities/even_hub_sdk'

// 姿勢 nudge（v9・リアクティブ猫・送信リトライ）。
//   良い姿勢/軽い前傾 → proud / うつむき継続 → slump / 直すと proud。
// 実機校正: まっすぐ x≈-0.08 / 下 x≈-0.36。
//
// 画像送信は BLE でたまに sendFailed する。sendFailed は例外でなく結果値で返るので、
// 「結果が success 以外なら失敗扱い → 1 秒間隔で success するまで再送」する。
// IMU は静止で配信停止するため最後の姿勢を保持。途絶が続けば imuControl を貼り直す。

const ENTER = -0.25
const EXIT = -0.15
const SUSTAIN_MS = 30_000 // うつむきが続いたらぐったりするまでの時間
const EMA_ALPHA = 0.5
const TICK_MS = 250
const STALE_REARM_MS = 8_000
const REARM_EVERY_MS = 8_000
const IMG_RETRY_MS = 1_000 // 画像送信の最短間隔（失敗時の再送間隔）

const ICON_W = 96
const ICON_H = 96
const ICON_X = Math.round((576 - ICON_W) / 2)
const ICON_Y = Math.round((288 - ICON_H) / 2) - 10

type Pose = 'proud' | 'slump'

let latestX: number | null = null
let lastSampleAt = 0
let smoothedX: number | null = null
let isDown = false
let downAccumMs = 0
let slumped = false
let lastTick = 0
let lastRearm = 0

let proudPng: Uint8Array
let slumpPng: Uint8Array
let pendingPose: Pose = 'proud' // 出したいポーズ
let sentPose: Pose | null = null // success で送れたポーズ
let imgSending = false
let lastImgSendAt = 0
let lastDebugContent = ''

const statusEl = document.getElementById('status') as HTMLElement
const valuesEl = document.getElementById('values') as HTMLElement
const maxEl = document.getElementById('max') as HTMLElement

async function makePng(draw: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_W
  canvas.height = ICON_H
  const ctx = canvas.getContext('2d')!
  draw(ctx)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

const W = ICON_W
const H = ICON_H

function drawProud(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  const cx = W / 2
  ctx.beginPath()
  ctx.moveTo(cx - W * 0.24, H * 0.94)
  ctx.quadraticCurveTo(cx - W * 0.32, H * 0.55, cx - W * 0.15, H * 0.44)
  ctx.lineTo(cx + W * 0.15, H * 0.44)
  ctx.quadraticCurveTo(cx + W * 0.32, H * 0.55, cx + W * 0.24, H * 0.94)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, H * 0.32, H * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - H * 0.17, H * 0.21)
  ctx.lineTo(cx - H * 0.08, H * 0.04)
  ctx.lineTo(cx - H * 0.01, H * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx + H * 0.17, H * 0.21)
  ctx.lineTo(cx + H * 0.08, H * 0.04)
  ctx.lineTo(cx + H * 0.01, H * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = W * 0.1
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx + W * 0.2, H * 0.9)
  ctx.quadraticCurveTo(cx + W * 0.44, H * 0.82, cx + W * 0.4, H * 0.55)
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(cx - H * 0.07, H * 0.32, H * 0.028, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + H * 0.07, H * 0.32, H * 0.028, 0, Math.PI * 2)
  ctx.fill()
}

function drawSlump(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(W * 0.56, H * 0.76, W * 0.36, H * 0.15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(W * 0.26, H * 0.66, H * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W * 0.22, H * 0.54)
  ctx.lineTo(W * 0.1, H * 0.48)
  ctx.lineTo(W * 0.24, H * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W * 0.3, H * 0.52)
  ctx.lineTo(W * 0.3, H * 0.42)
  ctx.lineTo(W * 0.39, H * 0.52)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = W * 0.09
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(W * 0.88, H * 0.78)
  ctx.quadraticCurveTo(W * 0.98, H * 0.82, W * 0.93, H * 0.92)
  ctx.stroke()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = H * 0.022
  ctx.beginPath()
  ctx.moveTo(W * 0.19, H * 0.64)
  ctx.lineTo(W * 0.26, H * 0.64)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(W * 0.3, H * 0.64)
  ctx.lineTo(W * 0.37, H * 0.64)
  ctx.stroke()
}

let bridgeRef: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null

// pendingPose を sentPose に一致させる。success 以外は失敗とみなし IMG_RETRY_MS 間隔で再送。
function tickImage(now: number): void {
  if (!bridgeRef) return
  if (pendingPose === sentPose) return // 既に出ている
  if (imgSending) return // 同時送信不可
  if (now - lastImgSendAt < IMG_RETRY_MS) return // 連投/再送のバックオフ

  imgSending = true
  lastImgSendAt = now
  const target = pendingPose
  bridgeRef
    .updateImageRawData(
      new ImageRawDataUpdate({ containerID: 1, containerName: 'cat', imageData: target === 'slump' ? slumpPng : proudPng }),
    )
    .then((r) => {
      statusEl.textContent = `img: ${String(r)} (${target})`
      if (r === ImageRawDataUpdateResult.success) sentPose = target // 成功時のみ確定
    })
    .catch((e) => {
      statusEl.textContent = `img error: ${String(e)}`
    })
    .finally(() => {
      imgSending = false
    })
}

async function main(): Promise<void> {
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await waitForEvenAppBridge()
  } catch {
    statusEl.textContent =
      'Even アプリ内で開いてください（通常のブラウザでは IMU を取得できません）'
    return
  }
  bridgeRef = bridge

  proudPng = await makePng(drawProud)
  slumpPng = await makePng(drawSlump)

  statusEl.textContent = 'HUD を作成中…'
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 2,
      imageObject: [
        new ImageContainerProperty({ xPosition: ICON_X, yPosition: ICON_Y, width: ICON_W, height: ICON_H, containerID: 1, containerName: 'cat' }),
      ],
      textObject: [
        new TextContainerProperty({ xPosition: 20, yPosition: 252, width: 536, height: 30, containerID: 2, containerName: 'debug', content: 'starting…', isEventCapture: 0 }),
      ],
    }),
  )

  await bridge.imuControl(true, ImuReportPace.P100)
  statusEl.textContent = '姿勢モニタ稼働中'

  bridge.onEvenHubEvent((event) => {
    const sys = event.sysEvent
    if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) return
    if (typeof sys.imuData.x !== 'number') return
    latestX = sys.imuData.x
    lastSampleAt = Date.now()
  })

  lastTick = Date.now()
  setInterval(() => {
    const now = Date.now()
    const dt = now - lastTick
    lastTick = now

    const age = lastSampleAt === 0 ? Infinity : now - lastSampleAt
    if (age > STALE_REARM_MS && now - lastRearm > REARM_EVERY_MS) {
      lastRearm = now
      void bridge.imuControl(true, ImuReportPace.P100)
    }

    if (latestX !== null) {
      smoothedX = smoothedX === null ? latestX : smoothedX * (1 - EMA_ALPHA) + latestX * EMA_ALPHA
      if (!isDown && smoothedX < ENTER) isDown = true
      else if (isDown && smoothedX > EXIT) isDown = false
      if (isDown) {
        downAccumMs += dt
        if (downAccumMs >= SUSTAIN_MS) slumped = true
      } else {
        downAccumMs = 0
        slumped = false
      }
    }

    pendingPose = slumped ? 'slump' : 'proud'
    tickImage(now)

    const xStr = smoothedX === null ? '-' : smoothedX.toFixed(2)
    const ageStr = age === Infinity ? '-' : (age / 1000).toFixed(1)
    const state = latestX === null ? 'no data' : slumped ? 'SLUMP' : isDown ? `down ${(downAccumMs / 1000).toFixed(0)}s` : 'OK'
    const debugContent = `x ${xStr} ${state} age${ageStr}`
    if (debugContent !== lastDebugContent) {
      lastDebugContent = debugContent
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 2, containerName: 'debug', content: debugContent }),
      )
    }

    valuesEl.textContent = `x: ${xStr} age:${ageStr}s`
    maxEl.textContent = `状態:${state} 猫(want/shown):${pendingPose}/${sentPose ?? '-'}`
  }, TICK_MS)
}

void main()
