import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * ⛔ `root` AND `envDir` ARE PINNED ON PURPOSE. DO NOT REMOVE THEM.
 *
 * Vite resolves both from the current working directory when unset, so in a
 * monorepo a build invoked from the repo root rather than this directory would
 * resolve them one level up — finding no index.html and no .env.local, and
 * handing every VITE_* value back as `undefined`.
 *
 * ⭐ This is a guard, not a change: `here` is the directory the build already
 * used, `build.outDir` and `publicDir` do not move, and package.json is already
 * read path-independently via import.meta.url. Verified byte-identical output.
 */
const here = dirname(fileURLToPath(import.meta.url))

// Stamped onto every analytics row so a metric can be read per release —
// "did installs drop after the last build" is unanswerable without it.
// Read from package.json rather than hand-maintained here, so bumping the
// version in one place is the whole job. Read with fs rather than imported:
// a JSON import needs an assertion and behaves differently across the Node
// versions this config runs under, and this cannot be allowed to fail.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * WHICH BUILD IS THIS, EXACTLY.
 *
 * The version alone cannot answer that: it only changes when someone
 * remembers to bump it, so two different builds routinely share one. The
 * COMMIT does change every deploy, which is what makes "am I looking at a
 * stale build?" answerable — a question that has now wasted real debugging
 * time more than once, most expensively when a phone kept showing a bundle
 * from before a fix and every diagnostic looked healthy.
 *
 * Cloudflare Pages exposes CF_PAGES_COMMIT_SHA to the build, so production
 * needs no git. Locally we ask git, and fall back to 'dev' — a dev server has
 * no commit worth naming, and failing the build over a version string would
 * be an absurd trade.
 */
function buildSha() {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) return fromPages.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  root: here,
  envDir: here,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__:   JSON.stringify(buildSha()),
    // Date of the BUILD, not of the commit — that is what tells you how old
    // the thing in front of you is.
    __BUILD_TIME__:  JSON.stringify(new Date().toISOString()),
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
