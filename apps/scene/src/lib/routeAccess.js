/**
 * ROUTE ACCESS — the single client-side statement of who may stand where.
 *
 * Onboarding architecture (ratified 2026-08-12):
 *
 *     Discovery is anonymous. Participation is identified.
 *
 * Every route the router serves is declared here with an access class, and
 * routeAccess.test.js holds this table and App.jsx's <Route> tree equal in
 * both directions — a route cannot be added to one without the other, so the
 * router and this declaration cannot silently drift apart.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────
 *
 * This is the UX boundary: which surfaces invite an account and which are
 * open to anyone. It is ⛔ NOT the security boundary. Row-level security is
 * the security boundary — SEC-1/SEC-2 define what an anonymous client can
 * actually read, and they would hold even if every route here were marked
 * PUBLIC by mistake. If this table and RLS ever disagree, RLS wins; fix the
 * table.
 *
 * ── THE CLASSES ──────────────────────────────────────────────────────
 *
 * PUBLIC   Renders real content with no session. Anonymous discovery.
 * ACCOUNT  Participation surface — needs a signed-in account to be useful.
 *          ⚠ In O1 nothing enforces this client-side: these screens keep
 *          their existing per-screen behaviour (empty states, inline gates).
 *          O2's ParticipationGate will render in place for these — never a
 *          redirect, so the URL survives as the return route.
 * OWNER    Needs an account AND ownership of the resource (the screen and
 *          RLS both check; the screen for UX, RLS for truth).
 *
 * ⚠ `/my-scene` is deliberately PUBLIC: it renders the signed-out invite
 * state (the "YOUR SCENE AWAITS" card), which is a real surface with a job —
 * per My Scene philosophy it is the front door to participation, not an
 * error page.
 */

export const ACCESS = Object.freeze({
  PUBLIC:  'public',
  ACCOUNT: 'account',
  OWNER:   'owner',
});

/**
 * path → { access, devOnly? }. Paths are the exact strings App.jsx gives
 * <Route>, params included — the test compares them verbatim.
 */
export const ROUTE_ACCESS = Object.freeze({
  '/':                        { access: ACCESS.PUBLIC },
  '/discover':                { access: ACCESS.PUBLIC },
  '/event/:id':               { access: ACCESS.PUBLIC },
  /* QR1 · both are printed-code destinations, so both are read by strangers
     standing in front of a poster. ⛔ Neither may become ACCOUNT: a sign-in
     wall behind a QR is the participation wall O1 removed, by another door.
     What each surface actually shows is still decided by RLS and, for set
     times, by the organiser's publish switch. */
  '/event/:id/set-times':     { access: ACCESS.PUBLIC },
  '/q/:type/:id':             { access: ACCESS.PUBLIC },
  '/profile/:id':             { access: ACCESS.PUBLIC },
  '/my-scene':                { access: ACCESS.PUBLIC },
  '/auth':                    { access: ACCESS.PUBLIC },
  /* ⛔ PUBLIC IS NOT A SLIP HERE. Someone completing a password reset is by
     definition unable to sign in, so an ACCOUNT class would lock the door
     against the only people who need it. The recovery token, not a session,
     is what authorises the change, and updateUser is checked by GoTrue. */
  '/reset-password':          { access: ACCESS.PUBLIC },
  '/access-required':         { access: ACCESS.PUBLIC },
  /* ⛔ PUBLIC, and it must be. This is the catch-all that turns a link nothing
     claims into a page that SAYS SO — before it existed, a wrong link rendered
     blank. Gating it would send a signed-out reader from "there's nothing
     here" to a sign-in wall, which answers a question they did not ask. */
  '*':                        { access: ACCESS.PUBLIC },
  '/dev/event-layout':        { access: ACCESS.PUBLIC, devOnly: true },
  /* The sticker effects harness. PUBLIC and devOnly for the same reason as the
     layout harness above: it renders bundled artwork and whatever file the
     developer drops in, reads nothing from the database, and is not routed in
     a production build at all. */
  '/dev/stickers':            { access: ACCESS.PUBLIC, devOnly: true },
  /* S3 · the public schedule projection, against real production rows. PUBLIC
     because it renders exactly what a signed-out punter may read — that is the
     point of it — and it writes nothing. */
  '/dev/schedule':            { access: ACCESS.PUBLIC, devOnly: true },
  /* QR1 · the QR surfaces, which otherwise live only behind a venue or host
     dashboard. Reads production ids and writes nothing. */
  '/dev/qr':                  { access: ACCESS.PUBLIC, devOnly: true },

  // O3 · post-signup only. ACCOUNT because it acts on behalf of an account;
  // a guest who types the URL is sent to What's On by the screen itself.
  '/start':                   { access: ACCESS.ACCOUNT },
  /* Poster Wall — the user's own archive; a guest has no history to hang.
     The My Scene teaser strip is what advertises it to everyone. */
  '/poster-wall':             { access: ACCESS.ACCOUNT },
  '/messages':                { access: ACCESS.ACCOUNT },
  '/messages/:id':            { access: ACCESS.ACCOUNT },
  '/notifications':           { access: ACCESS.ACCOUNT },
  /* Calendar sync — the user's own commitments and their private feed URL. */
  '/calendar':                { access: ACCESS.ACCOUNT },
  '/me':                      { access: ACCESS.ACCOUNT },
  '/profile-edit':            { access: ACCESS.ACCOUNT },
  '/role-select':             { access: ACCESS.ACCOUNT },
  '/create-event':            { access: ACCESS.ACCOUNT },
  /* ⭐ PUBLIC SINCE 2026-09-03. Feedback is not participation — the person
     most worth hearing from is often the one who bounced off before signing
     up, and refusing them silently is what feedback #24 reported. A guest
     writes a row with a NULL user_id and no attachments (enforced by RLS, not
     by the client); a signed-in user is unchanged and still gets a reference
     number back. */
  '/beta-feedback':           { access: ACCESS.PUBLIC },
  '/industry/artist':         { access: ACCESS.ACCOUNT },
  '/industry/artist/setup':   { access: ACCESS.ACCOUNT },
  '/industry/venue':          { access: ACCESS.ACCOUNT },
  '/industry/venue/setup':    { access: ACCESS.ACCOUNT },
  '/industry/host':           { access: ACCESS.ACCOUNT },
  '/industry/host/setup':     { access: ACCESS.ACCOUNT },
  '/industry/band':           { access: ACCESS.ACCOUNT },
  '/industry/band/setup':     { access: ACCESS.ACCOUNT },
  '/industry/standup':        { access: ACCESS.ACCOUNT },
  '/industry/standup/setup':  { access: ACCESS.ACCOUNT },

  '/event/:id/applications':  { access: ACCESS.OWNER },
});

/** The paths of one class, for guards and tests. */
export function routesWithAccess(access) {
  return Object.keys(ROUTE_ACCESS).filter(p => ROUTE_ACCESS[p].access === access);
}
