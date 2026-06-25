import {
  waitForEvenAppBridge,
  ImuReportPace,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// 姿勢 nudge 本体（v4）。
// IMU の x 軸（前後の傾き）で「うつむき」を検知し、続いたら HUD に通知。
// 実機校正: まっすぐ x≈-0.08 / 下 x≈-0.36 / 上 x≈+0.44（下ほど x がマイナス）。
//
// 重要な実機知見: IMU は「動いている間だけ」データを出す（静止すると停止）。
// そこで「最後に観測した姿勢を保持し、次にデータが来るまで継続中とみなす」方式にする。
//   → 静止した猫背（動かない前かがみ）でもカウントが進み発火する。
//   → まっすぐに直すと頭が動くのでイベントが来て OK に戻る。
// 既知の限界: 下向きの角度でグラスを外して置くと誤カウントしうる（将来 装着検知で補強）。

// --- しきい値・タイミング（実機で調整可。SUSTAIN/COOLDOWN は今テスト用に短め） ---
const ENTER = -0.25 // これを下回ったら「うつむき」入り
const EXIT = -0.15 // これを上回ったら解除（ヒステリシス）
const SUSTAIN_MS = 30_000 // うつむきが続いたら nudge を出すまでの時間
const COOLDOWN_MS = 60_000 // 一度出したら次まで黙る時間
const NUDGE_SHOW_MS = 4_000
const EMA_ALPHA = 0.5 // 平滑化（イベントが疎なので速めに追従）
const TICK_MS = 250
const NUDGE_TEXT = '背すじ！'
const NUDGE_CLEAR = ' ' // 空文字だと HUD が更新を無視して前のテキストが残るため空白で上書き

// --- 状態 ---
let latestX: number | null = null // 最後に観測した x（動くまで保持）
let lastSampleAt = 0
let smoothedX: number | null = null
let isDown = false
let downAccumMs = 0
let lastNudge = -COOLDOWN_MS
let nudgeUntil = 0
let lastTick = 0

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

  // IMU イベントは「最新値の記録」だけ（判定は定期ループ側）
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

    // 最後に観測した姿勢を保持して毎 tick 判定する（静止＝姿勢継続中とみなす）
    if (latestX !== null) {
      smoothedX = smoothedX === null ? latestX : smoothedX * (1 - EMA_ALPHA) + latestX * EMA_ALPHA

      if (!isDown && smoothedX < ENTER) isDown = true
      else if (isDown && smoothedX > EXIT) isDown = false

      if (isDown) downAccumMs += dt
      else downAccumMs = 0

      if (downAccumMs >= SUSTAIN_MS && now - lastNudge >= COOLDOWN_MS) {
        lastNudge = now
        nudgeUntil = now + NUDGE_SHOW_MS
        downAccumMs = 0 // 発火後はリセット（次は再び SUSTAIN 必要）
      }
    }

    // --- HUD 描画（変化時のみ書き込み） ---
    // 表示は時間制限（NUDGE_SHOW_MS）かつ「まだ下向きの間」だけ。姿勢を直したら即消える。
    const nudgeContent = now < nudgeUntil && isDown ? NUDGE_TEXT : NUDGE_CLEAR
    if (nudgeContent !== lastNudgeContent) {
      lastNudgeContent = nudgeContent
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'nudge', content: nudgeContent }),
      )
    }

    const age = lastSampleAt === 0 ? Infinity : now - lastSampleAt
    const xStr = smoothedX === null ? '-' : smoothedX.toFixed(2)
    const ageStr = age === Infinity ? '-' : (age / 1000).toFixed(1)
    let state: string
    if (latestX === null) state = 'no data'
    else if (isDown) state = `DOWN ${(downAccumMs / 1000).toFixed(0)}s`
    else state = 'OK'
    const debugContent = `x ${xStr} ${state} age${ageStr}`
    if (debugContent !== lastDebugContent) {
      lastDebugContent = debugContent
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 2, containerName: 'debug', content: debugContent }),
      )
    }

    // スマホ画面（デバッグ用）
    valuesEl.textContent = `x(平滑): ${xStr}  age: ${ageStr}s`
    maxEl.textContent = `状態: ${state}${now < nudgeUntil ? ' 〔nudge〕' : ''}`
  }, TICK_MS)
}

void main()
