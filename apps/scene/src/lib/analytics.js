/**
 * SCENE'S COLLECTOR — now a construction of the shared one.
 *
 * The 800-line collector that lived here moved VERBATIM to
 * @yespleez/analytics-client (Analytics v2, Phase G). This shim does
 * exactly two things: injects Scene's own Supabase client and suburb
 * map (⛔ the package never creates a client — a second GoTrue client
 * on one storage key destroys the session), and re-exports the same
 * surface every call site has always imported. Storage keys are
 * unchanged, so every existing device identity survives the move.
 *
 * ⚠ configureAnalytics runs at MODULE LOAD, which is why it is safe:
 * any call site importing track() from here evaluates this module —
 * and therefore the injection — first.
 */

import { supabase } from './supabase';
import { SUBURB_MAP } from './auLocations';
import { configureAnalytics } from '@yespleez/analytics-client';

configureAnalytics({ supabase, suburbMap: SUBURB_MAP });

export {
  EVENTS, SURFACES, DISPLAY_MODES, PLATFORMS,
  newUuid, deviceId, sessionId,
  normaliseScreenPath, normaliseRegion,
  displayMode, isInstalled, platform, browserName,
  setAnalyticsUser, track, trackScreenView, trackError, trackFiltered,
  initAnalytics, __resetAnalyticsForTests,
} from '@yespleez/analytics-client';
