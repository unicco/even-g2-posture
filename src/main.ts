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

// 姿勢 nudge（v13・角度ベース + 設定 + i18n）。
//   浅い前傾（concernX 以下）→ ! 警告（尻尾フリフリ）/ 深い前傾（slumpX 以下）→ ぐったり。
//   どちらも delaySec 続いてから発動。直す（exit 超え）と proud。
// 設定（デバッグ表示 / 反応秒数 / concernX / slumpX）はスマホ画面で変更・localStorage 保存・即反映。
// 文言は navigator.language で ja/en 自動切替。HUD は猫のみ（言語非依存）。

const EMA_ALPHA = 0.5
const TICK_MS = 250
const WAG_MS = 900
const EXIT_MARGIN = 0.08
const STALE_REARM_MS = 8_000
const REARM_EVERY_MS = 8_000
const IMG_RETRY_MS = 500

const ICON_W = 64
const ICON_H = 64
const ICON_X = Math.round((576 - ICON_W) / 2)
const ICON_Y = Math.round((288 - ICON_H) / 2) - 8

type Config = { debug: boolean; delaySec: number; concernX: number; slumpX: number }
const DEFAULTS: Config = { debug: false, delaySec: 3, concernX: -0.22, slumpX: -0.33 }
const SKEY = 'postureCat.settings'
let config: Config = { ...DEFAULTS }
function loadConfig(): void {
  try {
    const s = localStorage.getItem(SKEY)
    if (s) config = { ...DEFAULTS, ...JSON.parse(s) }
  } catch {
    /* ignore */
  }
}
function saveConfig(): void {
  try {
    localStorage.setItem(SKEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
}

type Str = Record<string, string>
const JA: Str = {
  tag: '猫が背すじを見守ります',
  secSettings: '設定',
  lblDebug: 'デバッグ表示',
  lblDelay: '反応までの秒数',
  lblConcern: '「！」になる傾き X',
  lblSlump: 'ぐったりになる傾き X',
  lblCurrentX: '現在の傾き X',
  secHowto: '使い方',
  step1: '1. グラスを装着する',
  step2: '2. うつむきが続くと猫が「！」で警告',
  step3: '3. 背すじを伸ばすと猫が元気に戻る',
  foot: 'すべて端末内で動作・通信なし',
  connecting: 'グラスと接続中…',
  connectingSub: 'Even グラスを装着してください',
  good: 'いい姿勢です',
  goodSub: 'その調子！猫もごきげん',
  concern: '猫背気味です',
  concernSub: '背すじを伸ばして',
  slump: '猫がぐったり…',
  slumpSub: '背すじを伸ばすと起き上がります',
  openInApp: 'Even アプリで開いてください',
  openInAppSub: '通常のブラウザでは動作しません',
}
const EN: Str = {
  tag: 'A cat that watches your posture',
  secSettings: 'Settings',
  lblDebug: 'Debug overlay',
  lblDelay: 'Delay before reacting (sec)',
  lblConcern: 'Warn (!) at tilt X',
  lblSlump: 'Go limp at tilt X',
  lblCurrentX: 'Current tilt X',
  secHowto: 'How it works',
  step1: '1. Put on the glasses',
  step2: '2. Slouch too long and the cat warns with "!"',
  step3: '3. Sit up straight and the cat perks up',
  foot: 'Runs entirely on-device. No network.',
  connecting: 'Connecting to glasses…',
  connectingSub: 'Please put on your Even glasses',
  good: 'Good posture',
  goodSub: 'Nice! Your cat is happy',
  concern: 'Slouching a bit',
  concernSub: 'Sit up straight',
  slump: 'Your cat went limp…',
  slumpSub: 'Sit up straight to revive it',
  openInApp: 'Open in the Even app',
  openInAppSub: 'It does not run in a normal browser',
}
const L: Str = (navigator.language || '').toLowerCase().startsWith('ja') ? JA : EN

const faceEl = document.getElementById('face') as HTMLElement
const msgEl = document.getElementById('stateMsg') as HTMLElement
const subEl = document.getElementById('stateSub') as HTMLElement
const techEl = document.getElementById('tech') as HTMLElement
const valXEl = document.getElementById('valX') as HTMLElement

function setText(id: string, key: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = L[key]
}
function setPhone(face: string, msg: string, sub: string): void {
  faceEl.textContent = face
  msgEl.textContent = msg
  subEl.textContent = sub
}
function tech(s: string): void {
  techEl.style.display = config.debug ? 'block' : 'none'
  if (config.debug) techEl.textContent = s
}
function applyI18n(): void {
  document.documentElement.lang = L === JA ? 'ja' : 'en'
  for (const id of ['tag', 'secSettings', 'lblDebug', 'lblDelay', 'lblConcern', 'lblSlump', 'lblCurrentX', 'secHowto', 'step1', 'step2', 'step3', 'foot']) {
    setText(id, id)
  }
}
function initSettingsUI(): void {
  const dbg = document.getElementById('optDebug') as HTMLInputElement
  const delay = document.getElementById('optDelay') as HTMLInputElement
  const con = document.getElementById('optConcern') as HTMLInputElement
  const slu = document.getElementById('optSlump') as HTMLInputElement
  const conVal = document.getElementById('valConcern') as HTMLElement
  const sluVal = document.getElementById('valSlump') as HTMLElement

  dbg.checked = config.debug
  delay.value = String(config.delaySec)
  con.value = String(config.concernX)
  slu.value = String(config.slumpX)
  conVal.textContent = config.concernX.toFixed(2)
  sluVal.textContent = config.slumpX.toFixed(2)

  dbg.addEventListener('change', () => {
    config.debug = dbg.checked
    saveConfig()
    if (!config.debug) techEl.style.display = 'none'
  })
  delay.addEventListener('change', () => {
    const v = Math.max(1, Math.min(15, Math.round(Number(delay.value) || DEFAULTS.delaySec)))
    config.delaySec = v
    delay.value = String(v)
    saveConfig()
  })
  con.addEventListener('input', () => {
    config.concernX = Number(con.value)
    conVal.textContent = config.concernX.toFixed(2)
    saveConfig()
  })
  slu.addEventListener('input', () => {
    config.slumpX = Number(slu.value)
    sluVal.textContent = config.slumpX.toFixed(2)
    saveConfig()
  })
}

type Pose = 'proud' | 'concernA' | 'concernB' | 'slump'
const pngs: Record<Pose, Uint8Array> = {} as Record<Pose, Uint8Array>
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

let latestX: number | null = null
let lastSampleAt = 0
let smoothedX: number | null = null
let engaged = false
let holdMs = 0
let lastTick = 0
let lastRearm = 0
let pendingPose: Pose = 'proud'
let sentPose: Pose | null = null
let imgSending = false
let lastImgSendAt = 0
let lastHudText = ''
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
      if (r === ImageRawDataUpdateResult.success) sentPose = target
    })
    .catch(() => {
      /* 次 tick で再送 */
    })
    .finally(() => {
      imgSending = false
    })
}

async function main(): Promise<void> {
  loadConfig()
  applyI18n()
  initSettingsUI()

  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await waitForEvenAppBridge()
  } catch {
    setPhone('🐱', L.openInApp, L.openInAppSub)
    return
  }
  bridgeRef = bridge

  pngs.proud = await makePng(drawProud)
  pngs.concernA = await makePng((c) => drawConcern(c, 0))
  pngs.concernB = await makePng((c) => drawConcern(c, 1))
  pngs.slump = await makePng(drawSlump)

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 2,
      imageObject: [
        new ImageContainerProperty({ xPosition: ICON_X, yPosition: ICON_Y, width: ICON_W, height: ICON_H, containerID: 1, containerName: 'cat' }),
      ],
      textObject: [
        new TextContainerProperty({ xPosition: 8, yPosition: 4, width: 380, height: 28, containerID: 2, containerName: 'debug', content: ' ', isEventCapture: 0 }),
      ],
    }),
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

    const concernX = config.concernX
    const slumpEff = Math.min(config.slumpX, concernX)
    const exitX = concernX + EXIT_MARGIN

    if (latestX !== null) {
      smoothedX = smoothedX === null ? latestX : smoothedX * (1 - EMA_ALPHA) + latestX * EMA_ALPHA
      if (!engaged && smoothedX <= concernX) engaged = true
      else if (engaged && smoothedX > exitX) engaged = false
      if (engaged) holdMs += dt
      else holdMs = 0
    }

    let pose: Pose = 'proud'
    let stateKey = 'good'
    if (latestX === null) {
      stateKey = 'connecting'
    } else if (engaged && holdMs >= config.delaySec * 1000) {
      if (smoothedX !== null && smoothedX <= slumpEff) {
        pose = 'slump'
        stateKey = 'slump'
      } else {
        pose = Math.floor(now / WAG_MS) % 2 === 0 ? 'concernA' : 'concernB'
        stateKey = 'concern'
      }
    }
    pendingPose = pose
    tickImage(now)

    const xStr = smoothedX === null ? '-' : smoothedX.toFixed(2)

    const hudText = config.debug ? `${stateKey} x${xStr}` : ' '
    if (hudText !== lastHudText) {
      lastHudText = hudText
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 2, containerName: 'debug', content: hudText }),
      )
    }

    if (stateKey === 'connecting') setPhone('⌛', L.connecting, L.connectingSub)
    else if (stateKey === 'slump') setPhone('😿', L.slump, L.slumpSub)
    else if (stateKey === 'concern') setPhone('🙀', L.concern, L.concernSub)
    else setPhone('😺', L.good, L.goodSub)

    valXEl.textContent = xStr
    const ageStr = age === Infinity ? '-' : (age / 1000).toFixed(1)
    tech(`${stateKey} x${xStr} age${ageStr}`)
  }, TICK_MS)
}

void main()
