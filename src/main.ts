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

// 姿勢 nudge（v12・3 段階 + 警告アニメ・Even 風スマホ画面）。
//   proud / concern(! + 尻尾フリフリ) / slump の 3 段階。
// 実機校正: まっすぐ x≈-0.08 / 下 x≈-0.36。IMU は静止で配信停止 → 最後の姿勢を保持。
// スマホ WebView 画面はユーザーに見える「アプリの顔」なので Even 風の状態表示にする。

// デバッグ（HUD 左上の状態テキスト + スマホ下部の技術表示）。本番は false。
const DEBUG = false

const ENTER = -0.25
const EXIT = -0.15
const WARN_AFTER_MS = 3_000
const SUSTAIN_MS = 30_000
const EMA_ALPHA = 0.5
const TICK_MS = 250
const WAG_MS = 900
const STALE_REARM_MS = 8_000
const REARM_EVERY_MS = 8_000
const IMG_RETRY_MS = 500

const ICON_W = 64
const ICON_H = 64
const ICON_X = Math.round((576 - ICON_W) / 2)
const ICON_Y = Math.round((288 - ICON_H) / 2) - 8

type Pose = 'proud' | 'concernA' | 'concernB' | 'slump'

let latestX: number | null = null
let lastSampleAt = 0
let smoothedX: number | null = null
let isDown = false
let downAccumMs = 0
let slumped = false
let lastTick = 0
let lastRearm = 0

const pngs: Record<Pose, Uint8Array> = {} as Record<Pose, Uint8Array>
let pendingPose: Pose = 'proud'
let sentPose: Pose | null = null
let imgSending = false
let lastImgSendAt = 0
let lastDebugContent = ''

const faceEl = document.getElementById('face') as HTMLElement
const msgEl = document.getElementById('stateMsg') as HTMLElement
const subEl = document.getElementById('stateSub') as HTMLElement
const techEl = document.getElementById('tech') as HTMLElement

function setPhone(face: string, msg: string, sub: string): void {
  faceEl.textContent = face
  msgEl.textContent = msg
  subEl.textContent = sub
}
function tech(s: string): void {
  if (!DEBUG) return
  techEl.style.display = 'block'
  techEl.textContent = s
}

const W = ICON_W
const H = ICON_H
const CX = W * 0.42

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

function bg(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
}
function bodyHeadEars(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(CX - W * 0.24, H * 0.94)
  ctx.quadraticCurveTo(CX - W * 0.32, H * 0.55, CX - W * 0.15, H * 0.44)
  ctx.lineTo(CX + W * 0.15, H * 0.44)
  ctx.quadraticCurveTo(CX + W * 0.32, H * 0.55, CX + W * 0.24, H * 0.94)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(CX, H * 0.32, H * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(CX - H * 0.17, H * 0.21)
  ctx.lineTo(CX - H * 0.08, H * 0.04)
  ctx.lineTo(CX - H * 0.01, H * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(CX + H * 0.17, H * 0.21)
  ctx.lineTo(CX + H * 0.08, H * 0.04)
  ctx.lineTo(CX + H * 0.01, H * 0.2)
  ctx.closePath()
  ctx.fill()
}
function eyes(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(CX - H * 0.07, H * 0.32, H * 0.03, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(CX + H * 0.07, H * 0.32, H * 0.03, 0, Math.PI * 2)
  ctx.fill()
}
function bang(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#fff'
  ctx.fillRect(W * 0.82, H * 0.04, W * 0.06, H * 0.14)
  ctx.beginPath()
  ctx.arc(W * 0.85, H * 0.24, W * 0.045, 0, Math.PI * 2)
  ctx.fill()
}

function drawProud(ctx: CanvasRenderingContext2D): void {
  bg(ctx)
  bodyHeadEars(ctx)
  ctx.lineWidth = W * 0.1
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(CX + W * 0.2, H * 0.9)
  ctx.quadraticCurveTo(CX + W * 0.42, H * 0.82, CX + W * 0.38, H * 0.55)
  ctx.stroke()
  eyes(ctx)
}

function drawConcern(ctx: CanvasRenderingContext2D, phase: number): void {
  bg(ctx)
  bodyHeadEars(ctx)
  ctx.lineWidth = W * 0.1
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(CX + W * 0.2, H * 0.9)
  if (phase === 0) ctx.quadraticCurveTo(CX + W * 0.44, H * 0.78, CX + W * 0.3, H * 0.5)
  else ctx.quadraticCurveTo(CX + W * 0.4, H * 0.92, CX + W * 0.46, H * 0.64)
  ctx.stroke()
  eyes(ctx)
  bang(ctx)
}

function drawSlump(ctx: CanvasRenderingContext2D): void {
  bg(ctx)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(W * 0.52, H * 0.76, W * 0.34, H * 0.15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(W * 0.24, H * 0.66, H * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W * 0.2, H * 0.54)
  ctx.lineTo(W * 0.08, H * 0.48)
  ctx.lineTo(W * 0.22, H * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W * 0.28, H * 0.52)
  ctx.lineTo(W * 0.28, H * 0.42)
  ctx.lineTo(W * 0.37, H * 0.52)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = W * 0.09
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(W * 0.84, H * 0.78)
  ctx.quadraticCurveTo(W * 0.94, H * 0.82, W * 0.89, H * 0.92)
  ctx.stroke()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = H * 0.025
  ctx.beginPath()
  ctx.moveTo(W * 0.17, H * 0.64)
  ctx.lineTo(W * 0.24, H * 0.64)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(W * 0.28, H * 0.64)
  ctx.lineTo(W * 0.35, H * 0.64)
  ctx.stroke()
}

let bridgeRef: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null

function tickImage(now: number): void {
  if (!bridgeRef) return
  if (pendingPose === sentPose) return
  if (imgSending) return
  if (now - lastImgSendAt < IMG_RETRY_MS) return
  imgSending = true
  lastImgSendAt = now
  const target = pendingPose
  bridgeRef
    .updateImageRawData(new ImageRawDataUpdate({ containerID: 1, containerName: 'cat', imageData: pngs[target] }))
    .then((r) => {
      tech(`img: ${String(r)} (${target})`)
      if (r === ImageRawDataUpdateResult.success) sentPose = target
    })
    .catch((e) => {
      tech(`img error: ${String(e)}`)
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
    setPhone('🐱', 'Even アプリで開いてください', '通常のブラウザでは動作しません')
    return
  }
  bridgeRef = bridge

  pngs.proud = await makePng(drawProud)
  pngs.concernA = await makePng((c) => drawConcern(c, 0))
  pngs.concernB = await makePng((c) => drawConcern(c, 1))
  pngs.slump = await makePng(drawSlump)

  const imageObject = [
    new ImageContainerProperty({ xPosition: ICON_X, yPosition: ICON_Y, width: ICON_W, height: ICON_H, containerID: 1, containerName: 'cat' }),
  ]
  const textObject = DEBUG
    ? [new TextContainerProperty({ xPosition: 8, yPosition: 4, width: 360, height: 28, containerID: 2, containerName: 'debug', content: '', isEventCapture: 0 })]
    : []

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: DEBUG ? 2 : 1, imageObject, textObject }),
  )

  await bridge.imuControl(true, ImuReportPace.P100)

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

    let pose: Pose = 'proud'
    let label = 'OK'
    if (latestX === null) {
      label = 'no data'
    } else if (slumped) {
      pose = 'slump'
      label = 'SLUMP'
    } else if (isDown && downAccumMs >= WARN_AFTER_MS) {
      pose = Math.floor(now / WAG_MS) % 2 === 0 ? 'concernA' : 'concernB'
      label = `warn ${(downAccumMs / 1000).toFixed(0)}s`
    } else if (isDown) {
      label = `down ${(downAccumMs / 1000).toFixed(0)}s`
    }
    pendingPose = pose
    tickImage(now)

    // HUD のデバッグ文字
    const xStr = smoothedX === null ? '-' : smoothedX.toFixed(2)
    if (DEBUG) {
      const debugContent = `${label} x${xStr}`
      if (debugContent !== lastDebugContent) {
        lastDebugContent = debugContent
        void bridge.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: 2, containerName: 'debug', content: debugContent }),
        )
      }
    }

    // スマホ画面（ユーザー向けの状態表示）
    if (latestX === null) setPhone('⌛', 'グラスと接続中…', 'Even グラスを装着してください')
    else if (pose === 'slump') setPhone('😿', '猫がぐったり…', '背すじを伸ばすと起き上がります')
    else if (pose === 'concernA' || pose === 'concernB') setPhone('🙀', '猫背気味です', '背すじを伸ばして')
    else setPhone('😺', 'いい姿勢です', 'その調子！猫もごきげん')

    const ageStr = age === Infinity ? '-' : (age / 1000).toFixed(1)
    tech(`${label} x${xStr} age${ageStr}`)
  }, TICK_MS)
}

void main()
