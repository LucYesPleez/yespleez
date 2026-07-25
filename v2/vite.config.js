import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped onto every analytics row so a metric can be read per release —
// "did installs drop after the last build" is unanswerable without it.
// Read from package.json rather than hand-maintained here, so bumping the
// version in one place is the whole job. Read with fs rather than imported:
// a JSON import needs an assertion and behaves differently across the Node
// versions this config runs under, and this cannot be allowed to fail.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
  preview: {
    // `vite preview` does NOT inherit `server.allowedHosts` — it is a
    // separate config block, so the same tunnel-domain allowance has to be
    // repeated here. Needed for real-device testing of anything that only
    // exists in a production build (the service worker, push notifications)
    // since those cannot be exercised under `vite dev` at all.
    host: true,
    allowedHosts: ['.trycloudflare.com', '.loca.lt'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
