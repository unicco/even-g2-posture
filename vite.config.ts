import { defineConfig } from 'vite'

// host: true で LAN に公開 → スマホ（Even アプリ）から sideload する QR が機能する
export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
})
