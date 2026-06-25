import {
  waitForEvenAppBridge,
  ImuReportPace,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// 姿勢 nudge アプリの第一歩（校正用）。
// IMU の生 x/y/z を スマホ画面（デバッグ用）と G2 HUD の両方に出すだけ。
// グラスを着けて頭を動かし、「うつむき」でどの軸がどう動くかを実機で観察し、
// あとで猫背判定のしきい値を決めるための土台にする。

const statusEl = document.getElementById('status') as HTMLElement
const valuesEl = document.getElementById('values') as HTMLElement
const maxEl = document.getElementById('max') as HTMLElement

const maxAbs = { x: 0, y: 0, z: 0 }
let lastHudUpdate = 0

function fmt(n: number): string {
  return (n >= 0 ? ' ' : '') + n.toFixed(2)
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

  statusEl.textContent = '接続済み。HUD を作成中…'

  // G2 HUD に表示枠を作る（576x288・左上原点・テキストは最大 8 個）
  const createRes = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({ xPosition: 20, yPosition: 20, width: 536, height: 40, containerID: 1, containerName: 'title', content: 'IMU monitor', isEventCapture: 0 }),
        new TextContainerProperty({ xPosition: 20, yPosition: 110, width: 536, height: 60, containerID: 2, containerName: 'xyz', content: 'x - y - z -', isEventCapture: 0 }),
        new TextContainerProperty({ xPosition: 20, yPosition: 210, width: 536, height: 50, containerID: 3, containerName: 'max', content: 'max -', isEventCapture: 0 }),
      ],
    }),
  )
  statusEl.textContent = 'HUD 作成結果: ' + String(createRes)

  // IMU を 100Hz で開始
  await bridge.imuControl(true, ImuReportPace.P100)
  statusEl.textContent = 'IMU 稼働中。頭を動かして値を確認してください。'

  bridge.onEvenHubEvent((event) => {
    const sys = event.sysEvent
    if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) return

    const x = sys.imuData.x ?? 0
    const y = sys.imuData.y ?? 0
    const z = sys.imuData.z ?? 0

    // スマホ画面は毎イベント更新（デバッグ用に生値を大きく表示）
    valuesEl.textContent = `x: ${fmt(x)}\ny: ${fmt(y)}\nz: ${fmt(z)}`

    maxAbs.x = Math.max(maxAbs.x, Math.abs(x))
    maxAbs.y = Math.max(maxAbs.y, Math.abs(y))
    maxAbs.z = Math.max(maxAbs.z, Math.abs(z))
    maxEl.textContent = `max |x| ${maxAbs.x.toFixed(2)}  |y| ${maxAbs.y.toFixed(2)}  |z| ${maxAbs.z.toFixed(2)}`

    // HUD 描画は 200ms ごとに間引く（毎フレーム書き換えるとちらつく・負荷も高い）
    const now = Date.now()
    if (now - lastHudUpdate < 200) return
    lastHudUpdate = now

    void bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 2, containerName: 'xyz', content: `x${fmt(x)} y${fmt(y)} z${fmt(z)}` }),
    )
    void bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: 3, containerName: 'max', content: `max x${maxAbs.x.toFixed(1)} y${maxAbs.y.toFixed(1)} z${maxAbs.z.toFixed(1)}` }),
    )
  })
}

void main()
