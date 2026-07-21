import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // DEV ONLY — lets a phone reach this server through an HTTPS tunnel.
    //
    // Phones refuse microphone access on an insecure origin, and a LAN address
    // like http://192.168.1.239:5173 is insecure, so `canRecordVoice()` returns
    // false and the composer correctly hides the mic. Testing Voiceys on a real
    // device therefore needs HTTPS, which a tunnel provides:
    //
    //   npx cloudflared tunnel --url http://localhost:5173
    //
    // Vite blocks unknown Host headers by default (DNS-rebinding protection),
    // which is why the tunnel returns "Blocked request" until the domain is
    // listed here. A leading dot allows subdomains.
    //
    // Scoped to these two providers rather than `true`: `true` would disable
    // the protection for ANY host, and this file ships in the repo.
    allowedHosts: ['.trycloudflare.com', '.loca.lt'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
