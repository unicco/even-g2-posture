import {
  waitForEvenAppBridge,
  ImuReportPace,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// 姿勢 nudge 本体（v2）。
// IMU の x 軸（前後の傾き）を見て、うつむき（猫背）が続いたら HUD にそっと知らせる。
// 実機校正の値: まっすぐ x≈-0.08 / 下を向く x≈-0.36 / 上 x≈+0.44（下ほど x がマイナス）。

// --- しきい値・タイミング（実機で調整可） ---
const ENTER = -0.25 // これを下回ったら「うつむき」入り
const EXIT = -0.15 // これを上回ったら解除（ヒステリシスでちらつき防止）
const SUSTAIN_MS = 30_000 // うつむきが続いたら nudge を出すまでの時間
const COOLDOWN_MS = 60_000 // 一度出したら次まで黙る時間
const NUDGE_SHOW_MS = 4_000 // nudge を表示しておく時間
const EMA_ALPHA = 0.2 // 平滑化の強さ（小さいほど滑らか）
const NUDGE_TEXT = '背すじ！'

// --- 状態 ---
let smoothedX: number | null = null
let isDown = false
let downSince = 0
let lastNudge = 0
let nudgeUntil = 0

// HUD への無駄な書き込みを避けるため、前回描いた内容を覚えておく
let lastNudgeContent = ''
let lastDebugContent = ''

const statusEl = document.getElementById('status') as HTMLElement
const valuesEl = document.getElementById('values') as HTMLElement
const maxEl = document.getElementById('max') as HTMLElement

async function main(): Promise<void> {
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await waitForEvenAppBridge()
  } catch {
    statusEl.textContent =
      'Even アプリ内で開いてください（通常のブラウザでは IMU を取得できません）'
    return
  }

  statusEl.textContent = 'HUD を作成中…'

  // HUD: 中央に nudge、下部に小さくデバッグ表示（576x288・左上原点）
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({ xPosition: 100, yPosition: 90, width: 376, height: 90, containerID: 1, containerName: 'nudge', content: '', isEventCapture: 0 }),
        new TextContainerProperty({ xPosition: 20, yPosition: 244, width: 536, height: 36, containerID: 2, containerName: 'debug', content: 'starting…', isEventCapture: 0 }),
      ],
    }),
  )

  await bridge.imuControl(true, ImuReportPace.P100)
  statusEl.textContent = '姿勢モニタ稼働中'

  // IMU イベント: 平滑化と状態遷移だけを担う（描画は別の定期処理に任せる）
  bridge.onEvenHubEvent((event) => {
    const sys = event.sysEvent
    if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) return
    if (typeof sys.imuData.x !== 'number') return
    const x = sys.imuData.x

    smoothedX = smoothedX === null ? x : smoothedX * (1 - EMA_ALPHA) + x * EMA_ALPHA

    const now = Date.now()
    if (!isDown && smoothedX < ENTER) {
      isDown = true
      downSince = now
    } else if (isDown && smoothedX > EXIT) {
      isDown = false
    }

    // うつむきが SUSTAIN_MS 続き、かつクールダウンを過ぎていれば nudge
    if (isDown && now - downSince >= SUSTAIN_MS && now - lastNudge >= COOLDOWN_MS) {
      lastNudge = now
      nudgeUntil = now + NUDGE_SHOW_MS
    }
  })

  // 描画: 250ms ごと。IMU がバーストで届いても表示は一定ペースで安定させる
  setInterval(() => {
    const now = Date.now()
    const sx = smoothedX

    const nudgeContent = now < nudgeUntil ? NUDGE_TEXT : ''
    if (nudgeContent !== lastNudgeContent) {
      lastNudgeContent = nudgeContent
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'nudge', content: nudgeContent }),
      )
    }

    let state: string
    if (sx === null) state = 'no data'
    else if (isDown) state = `DOWN ${Math.floor((now - downSince) / 1000)}s`
    else state = 'OK'
    const debugContent = `x ${sx === null ? '-' : sx.toFixed(2)}  ${state}`
    if (debugContent !== lastDebugContent) {
      lastDebugContent = debugContent
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 2, containerName: 'debug', content: debugContent }),
      )
    }

    // スマホ画面（デバッグ用）
    valuesEl.textContent = `x(平滑): ${sx === null ? '-' : sx.toFixed(3)}`
    maxEl.textContent = `状態: ${state}${now < nudgeUntil ? ' 〔nudge 表示中〕' : ''}`
  }, 250)
}

void main()
