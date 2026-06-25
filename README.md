# even-g2-posture

Even Realities G2 向けの**姿勢 nudge アプリ**。
頭の前傾（IMU）を検知して「うつむき・猫背が続いたら HUD にそっと知らせる」のが最終ゴール。

このリポジトリの現状は **MVP（第一歩）= IMU の生値を可視化する校正アプリ**。
グラスを着けて頭を動かし、「どの軸がうつむきで動くか」「どの値で猫背とみなすか」を実機で観察するための土台。

## 技術スタック
- Web アプリ（TypeScript + Vite）を Even アプリの WebView 内で動かす
- `@evenrealities/even_hub_sdk` でグラスの IMU 取得・HUD 描画
- 開発・配信は公式 `@evenrealities/evenhub-cli`

## 必要なもの
- Node.js 20+
- Even G2 + Even アプリ（スマホ）でペアリング済み
- スマホと Mac が**同じ Wi-Fi**

## 開発（実機テスト）

```bash
npm install

# 1. dev サーバー起動（LAN に公開される）
npm run dev

# 2. 別ターミナルで QR を生成（dev サーバーの URL をエンコード）
npm run qr
```

→ Even アプリの **Developer Center** で QR をスキャンするとグラスに sideload される。
グラスを着けて頭を前後・左右に動かすと、HUD とスマホ画面に IMU の `x / y / z` が出る。

> 通常のブラウザで `localhost:5173` を開いても SDK のネイティブ機能（IMU）は動かない。
> 値が見たいときは必ず Even アプリ経由で開くこと（ブラウザでは案内メッセージのみ表示）。

## 配布パッケージ
```bash
npm run build
npx evenhub pack app.json ./dist --output even-g2-posture.ehpk
```

## ファイル構成
- `src/main.ts` — IMU 取得 → HUD / 画面に描画（本体）
- `index.html` — スマホ画面のデバッグ表示
- `app.json` — Even Hub アプリのメタdata（package_id 等）
- `vite.config.ts` — `host: true` で LAN 公開（QR sideload のため）

## ロードマップ
1. ✅ IMU 生値を可視化（校正）← 今ここ
2. 頭の前傾角を算出し「前傾◯度が△分継続」で発火するしきい値を実測で決める
3. HUD に控えめな nudge を出す（一定時間で消す）
4. （発展）うつむき時間を life-log へ記録 → 可視化・睡眠/身体データ連載のネタに

## 出自
brain#473 から派生。当初は「G2 から life-log を音声照会」案だったが、Even の公式接続口（Terminal Mode / Add Agent）が用途に合わず、SDK で素直に作れる「IMU × 姿勢」案へピボット。
