/**
 * THE FESTIVAL PORTAL, AS SCENE SEES IT.
 *
 * Scene knows exactly two things about the Portal: where it is, and that it
 * owns the application pipeline for events a festival runs. Everything else —
 * categories, editions, review states, the eight festival roles — is the
 * Portal's, and Scene has deliberately never heard of it.
 *
 * ⭐ OWNER'S RULING, 2026-08-06: "A user should never be able to apply through
 * the wrong application. If Deliverance is a Festival-managed event, Scene
 * shouldn't have its own application UI at all."
 *
 * One pipeline, one table, one dashboard. Scene remains the discovery surface
 * and hands off at the moment of applying.
 */

/**
 * ⚠ THE PREVIEW ENVIRONMENT HAS NO `VITE_*` VARS, so a preview build falls
 * back to localhost and the apply hand-off will not resolve there. That is the
 * first thing to fix when the Portal gets a deployed URL.
 */
export const FESTIVAL_PORTAL_URL = safeEnvUrl() || 'http://localhost:5180';

// `import.meta.env` is a Vite construct and does not exist under plain Node,
// where reading a property off it THROWS rather than yielding undefined — so an
// unguarded read here would take down every test that imports this module, at
// import time, before a single assertion ran. Same idiom and same reason as
// authDiagnostics.js.
function safeEnvUrl() {
  try {
    return import.meta.env.VITE_FESTIVAL_PORTAL_URL;
  } catch {
    return undefined;
  }
}

/**
 * Does the Festival app own applications for this event?
 *
 * Derived from the OWNER PROFILE'S TYPE rather than a flag on the event, and
 * that choice is deliberate: a flag is a second fact that can disagree with the
 * first. An event owned by a festival profile is a festival's event —
 * there is nothing to keep in sync and nothing to forget to set.
 *
 * ⚠ IT DOES NOT CHECK WHETHER THE PORTAL IS CONFIGURED. An event owned by a
 * festival that has not opened any category still defers, and the Portal's
 * apply page then says so honestly. That is the correct failure: one pipeline
 * saying "not open yet" beats two pipelines disagreeing about whether you have
 * applied.
 *
 * @param {{type?: string}|null|undefined} ownerProfile
 * @returns {boolean}
 */
export function applicationsBelongToFestival(ownerProfile) {
  return ownerProfile?.type === 'festival';
}

/* ⛔ `festivalApplyUrl()` WAS HERE AND IS GONE — do not restore it.
 *
 * It pointed the public at the Portal's own apply page, which the owner
 * reversed on 2026-08-06: "The public doesn't need to know a Festival app
 * exists. They discover festivals through Scene exactly as they discover any
 * other event." Applying now happens on Scene's event page — see
 * screens/event/FestivalApply.jsx and lib/festivalApplications.js.
 *
 * FESTIVAL_PORTAL_URL survives because the ORGANISER still goes there, through
 * the FESTIVAL card in the role picker. That is the only crossing left, and it
 * is Industry → Festival → Festival App, never a punter's path. */
