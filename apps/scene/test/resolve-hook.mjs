/**
 * Extensionless-import resolver for `node --test`.
 *
 * The app is built by Vite, which resolves `import { supabase } from './supabase'`
 * without a file extension. Plain Node ESM does not — it throws
 * ERR_MODULE_NOT_FOUND before any test hook can intervene, which also means
 * `mock.module()` never gets a chance to substitute a stub.
 *
 * This hook retries a failed relative resolution with .js / .jsx, giving Node
 * the same resolution Vite performs. It exists so tests can exercise the REAL
 * production modules unmodified.
 *
 * The alternative was adding a dependency-injection seam to writeNotification.js
 * purely so it could be tested — production code contorted to suit the harness.
 * Fixing the harness instead keeps the thing under test identical to the thing
 * that ships, which is the entire point of testing it.
 *
 * Used via: node --experimental-test-module-mocks --import ./test/resolve-hook.mjs --test
 */
import { registerHooks } from 'node:module';

const RELATIVE = /^\.{1,2}\//;
const HAS_EXT = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!RELATIVE.test(specifier) || HAS_EXT.test(specifier)) throw err;
      for (const ext of ['.js', '.jsx', '/index.js']) {
        try {
          return nextResolve(specifier + ext, context);
        } catch {
          // try the next candidate
        }
      }
      throw err;
    }
  },
});
