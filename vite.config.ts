import { defineConfig } from 'vite'

// host: '0.0.0.0' で全 IPv4 インターフェース（LAN 10.x / Tailscale 100.x）に bind。
// host: true だと IPv6 のみの listen になり、スマホからの IPv4 接続が届かないことがある。
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    // vite 5 は許可外 Host を弾く。Tailscale serve(ts.net)経由で開けるよう許可。
    // IP 直アクセス(LAN)は allowedHosts に関わらず許可される。
    allowedHosts: ['.ts.net'],
  },
})
