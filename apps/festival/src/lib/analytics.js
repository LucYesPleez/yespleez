/**
 * FESTIVAL'S COLLECTOR — the portal's first (Analytics v2, Phase G).
 *
 * Same shim shape as Scene's: inject THIS app's Supabase client into
 * the shared collector (⛔ the package never creates one) and re-export
 * the surface. One backend, two front-ends, ONE collector — device and
 * session identity, usage events and campaign touches now record from
 * the portal exactly as they do from Scene, and the Echo Valley landing
 * page stops being invisible to analytics.
 *
 * suburbMap is Scene's location vocabulary; the portal tracks no
 * region facets, so the empty default is correct, not a gap.
 */

import { supabase } from '../data/supabase/client';
import { configureAnalytics } from '@yespleez/analytics-client';

configureAnalytics({ supabase });

export {
  EVENTS, track, trackScreenView, trackError,
  setAnalyticsUser, initAnalytics,
} from '@yespleez/analytics-client';
