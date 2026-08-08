/**
 * THE TOUR, AS DATA.
 *
 * ⚠⚠ THE ENGINE (TourOverlay) KNOWS NOTHING ABOUT ANY PARTICULAR SCREEN, and
 * that is the whole architecture. It reads this list, lights the rect a step
 * asks for, and shows the words a step supplies. Adding a walkthrough for a
 * feature built next year means adding an object to this array — never
 * touching the engine, and never adding a screen-specific branch to it.
 *
 * The moment a step needs "just one special case" in the overlay, the design
 * has failed. Extend the vocabulary below instead.
 *
 * ── A STEP ──────────────────────────────────────────────────────────────
 *   id       stable string; survives reordering, used for jump-to-section.
 *   route    where the step makes sense. The engine navigates here first.
 *            ⚠ OMIT IT for a surface that is not a route. Industry is a
 *            panel opened by its own tab handler, not a URL — there is no
 *            `/industry` route at all, and asking for one navigates to
 *            nothing.
 *   onEnter  optional side effect, run once when the step becomes active.
 *            For surfaces the tour has to OPEN rather than navigate to. See
 *            `clickTarget` — the tour presses the app's own control, which
 *            means it can never drift from what a real tap does.
 *   target   (ctx) => DOMRect | null — the region to light. Helpers below.
 *   radius   corner radius of the spotlight, px.
 *   Demo     optional component reference, rendered inside `lift`'s rect,
 *            clipped and non-interactive. For a screen that is genuinely
 *            empty for a first-run guest (My Scene with nothing followed, an
 *            inbox with no conversations) — a scripted loop standing in for
 *            what the screen looks like once it has something to show. See
 *            TourDemos.jsx. Never used on a screen that already has real
 *            content to spotlight.
 *   lift     optional (ctx) => rect — a SECOND, much softer highlight.
 *            ⚠ NOT A SECOND SPOTLIGHT, and it cannot be one. The darkness is
 *            cast by the spotlight's own outward box-shadow, so two cutouts
 *            do not compose: each one's shadow falls across the other, the
 *            page outside both goes twice as dark, and neither reads as lit.
 *            `lift` is additive light painted ON TOP of the dim instead —
 *            which is also the more faithful reading of "subtly illuminate
 *            the personalised content" — so it can sit anywhere, overlap
 *            anything, and never fights the lamp.
 *   title    heading on the card.
 *   body     array of paragraphs. An array, not a string, because the card
 *            spaces paragraphs and a "\n\n" convention would put layout
 *            decisions inside copy.
 *            An ENTRY may itself be an array of strings — those render as one
 *            paragraph with line breaks, for lines that belong together
 *            rhythmically ("Found a bug? / Have an idea? / …"). Six separate
 *            paragraphs of three words each is mostly margin, and margin is
 *            what pushes the card over the lit area.
 *   pulse    optional true — the lit area breathes once every 8s while the
 *            step is up. For a step whose target is a control the user is
 *            being invited to press at ANY time, rather than a place they
 *            are being shown. Costs a little attention; use it sparingly or
 *            it stops meaning anything.
 *   scrollLive  optional true — auto-scrolls the REAL page (not a
 *            screenshot) while the step is up, and restores the original
 *            scroll position the instant the step ends. For a screen that is
 *            genuinely current for a guest. Never combine with `Demo`: one
 *            fakes an empty screen, the other shows a real one moving; a
 *            step is always exactly one of those, never both.
 *   scrollRails  optional array of `data-tour` selectors — horizontal rails
 *            (a portrait-card row) dragged through their own scroll,
 *            independently of whether the page itself has anywhere to go. On
 *            a short page this is the only motion, and often the point.
 *            Requires `scrollLive`.
 *   scrollWaypoints  optional `data-tour` selector matching, in DOM order,
 *            every element the page should stop at. Stops past the page's
 *            actual scroll limit are clamped and de-duplicated, so a screen
 *            with little to scroll degrades to "no vertical motion" rather
 *            than to a stuttering loop of unreachable targets — see
 *            useLiveScroll.js. Requires `scrollLive`.
 *   card     'bottom' | 'top' — which end of the screen the card docks to,
 *            so a step lighting the bottom nav can move it out of the way.
 *   when     optional () => boolean. False skips the step entirely — the
 *            page counter and dots skip it too, so a suppressed step never
 *            leaves a gap in "3 / 7".
 *   cta      optional label override for the primary button.
 *
 * ── THE COUNTER ─────────────────────────────────────────────────────────
 * ⚠ "1 / 7" COUNTS THE STEPS THAT WILL RUN, not the length of this array.
 * A conditional step that is skipped (already-installed users never see the
 * install step) must not be counted, or the tour ends at "6 / 7" and looks
 * broken. See `activeSteps()`.
 */
import { MySceneReelDemo, MessagesChatDemo, IndustryDashboardDemo } from '../components/TourDemos';

/**
 * The app's own content column. The header is `min(100%, 680px)` centred, and
 * every screen sits inside that, so on anything wider than a phone the page
 * has empty gutters either side.
 */
const COLUMN = 680;

/**
 * The region from the top of the screen down to wherever the card starts —
 * what "spotlight the entire first viewport" means in practice. The brief
 * also says the card must not cover the highlighted content, and those two
 * only reconcile if the lit region stops where the card begins.
 *
 * ⚠⚠ IT IS INSET FROM THE VIEWPORT, AND THAT IS THE WHOLE DIFFERENCE BETWEEN
 * A SPOTLIGHT AND A BRIGHT PAGE. Run flush to the screen edges, three of the
 * lamp's four feathered edges fall off-screen — you see one dark band at the
 * bottom and nothing else, so the composition reads as an undimmed app with a
 * floating window stuck to it rather than as a lit area. Owner, seeing
 * exactly that: "what's with the top half of the screen… it looks weird."
 *
 * A 12px margin is enough for the falloff to be visible on all four sides
 * while still lighting every pixel of content. Nothing is cropped: the app's
 * own gutters live in that margin.
 *
 * ⚠ AND IT IS CLAMPED TO THE CONTENT COLUMN. On a desktop-width window a
 * full-width lamp spends most of its area lighting empty page margins, which
 * makes the lit region look arbitrary — it has no relationship to anything on
 * screen. Clamped, the light lands on the column the app actually occupies.
 *
 * ⚠ THE CARD'S HEIGHT IS NOT KNOWN UNTIL IT HAS RENDERED, so this is passed
 * the live card rect by the engine rather than guessing. On the first frame
 * the card has no rect yet and this falls back to two-thirds of the screen;
 * the engine holds the lamp back until it has a real measurement, so that
 * fallback is a safety net rather than something anyone sees.
 */
export function regionAboveCard({ cardRect, viewport }) {
  const gap = 18;
  const inset = 12;
  const bottom = cardRect ? cardRect.top - gap : viewport.height * 0.62;
  const width = Math.min(viewport.width - inset * 2, COLUMN);
  return {
    top: inset,
    left: Math.round((viewport.width - width) / 2),
    width,
    height: Math.max(120, bottom - inset),
  };
}

/** The union of one or more live elements, padded. For nav tabs, buttons. */
export function elementsTarget(selectors, pad = 10) {
  return () => {
    const els = selectors
      .map(sel => document.querySelector(sel))
      .filter(Boolean);
    if (!els.length) return null;

    let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      top = Math.min(top, r.top); left = Math.min(left, r.left);
      right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    if (top === Infinity) return null;

    /**
     * ⚠ KEPT ON SCREEN. The first and last nav tabs sit flush against the
     * viewport edges, so padding them pushes the lamp to a negative left (or
     * past the right edge) and its feathered edge falls off-screen — the same
     * thing that made page 1 read as a bright page rather than a spotlight,
     * just narrower. A lamp with an invisible edge does not look like a lamp.
     *
     * EDGE controls how much dark is guaranteed outside it. It is smaller
     * than page 1's 12px inset because a nav tab is small: pull it in further
     * and the padding stops clearing the tab's own label.
     */
    /**
     * ⚠ THE MARGIN IS A PREFERENCE; NOT CROPPING THE TARGET IS A RULE. The
     * nav sits flush against the bottom of the screen and the first and last
     * tabs against its sides, so a plain clamp to `vh - EDGE` sliced 6px off
     * the bottom of the very tab being pointed at — cutting into its label.
     *
     * So each edge takes the padded position where there is room, and falls
     * back to the element's own edge where there is not. An element flush
     * against the screen loses the feather on that side, which is fine: there
     * is nothing beyond it to dim, and the eye reads the lamp from the edges
     * that ARE on screen. Lighting less than the thing you are pointing at is
     * never fine.
     */
    const EDGE = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const l = Math.min(Math.max(EDGE, left - pad), left);
    const t = Math.min(Math.max(EDGE, top - pad), top);
    const r = Math.max(Math.min(vw - EDGE, right + pad), right);
    const b = Math.max(Math.min(vh - EDGE, bottom + pad), bottom);

    return { top: t, left: l, width: Math.max(0, r - l), height: Math.max(0, b - t) };
  };
}

/**
 * Press one of the app's own controls.
 *
 * ⚠ IT CLICKS THE REAL BUTTON RATHER THAN REACHING FOR THE STATE BEHIND IT.
 * Industry is a panel owned by App's `handleTabPress`, and the tour has no
 * access to that setter — plumbing one down would be a second way to open the
 * panel, free to drift from the first the moment anyone changes what tapping
 * Industry does. Pressing the control the step is already pointing at cannot
 * drift, because it IS the thing the user is being taught to press.
 *
 * Silent when the control is missing, like every other target lookup here: a
 * step whose anchor has been renamed should go quiet, not throw inside an
 * effect and take the overlay down with it.
 */
export function clickTarget(selector) {
  return () => {
    const el = document.querySelector(selector);
    if (el) el.click();
  };
}

/**
 * ⚠ SEVEN STEPS ARE PLANNED; ONE IS WRITTEN. The counter and the dots read
 * from PLANNED_TOTAL so the tour presents as "1 / 7" with seven dots from the
 * first day, which is what the owner specified — but `Next` on the last
 * DEFINED step ends the tour, because there is nothing after it yet. Adding
 * steps 2-7 to the array below is the only change needed; delete
 * PLANNED_TOTAL once the array is complete and the count becomes honest on
 * its own.
 */
export const PLANNED_TOTAL = 7;

export const TOUR_STEPS = [
  {
    id: 'whats-happening',
    route: '/',
    target: regionAboveCard,
    radius: 30,
    // ⚠ THE REAL PAGE, SCROLLING, NOT A SCREENSHOT — owner: "these screens
    // should scroll as the info that's already there is current." Unlike My
    // Scene/Messages, a guest's What's On is never empty, so there is
    // nothing to fake here; useLiveScroll drives the actual window scroll
    // and restores it the moment the step ends.
    scrollLive: true,
    // ⚠ WAYPOINTS, NOT A BLIND SCROLL — owner: "should go from the heading,
    // to the featured event, then to each sub heading that['s] available at
    // the time." Every section this can stop at is conditionally rendered
    // already (no events tonight → no TONIGHT section), and each carries
    // this shared attribute — see the note in WhatsOnScreen.jsx. Querying it
    // IS "each sub heading available right now"; nothing here hardcodes
    // which sections exist.
    scrollWaypoints: '[data-tour="whatson-section"]',
    // ⚠ NO 'G'. The screen this points at is titled WHATS HAPPENIN' — the
    // dropped g is the brand's voice, not a typo, and a card sitting directly
    // beneath that heading spelling it differently is the one place the
    // inconsistency is unmissable.
    title: "What's Happenin'",
    body: [
      'This is the heart of YesPleez. Every gig, venue, artist and promoter comes together here.',
      "Whether you're discovering your next night out or promoting your next event, this is where your local music scene comes alive.",
    ],
    card: 'bottom',
  },

  {
    id: 'my-scene',
    route: '/my-scene',
    // ⚠⚠ THE CONTENT REGION, EXACTLY LIKE WHAT'S ON AND DISCOVER. This used
    // to light the nav tab and merely `lift` the page, which left the
    // screenshot sitting under the 75% veil — visibly duller and softer than
    // the two steps that light real content, and owner: "it's weird that the
    // uploaded images look different." A `lift` adds light on top of the dim;
    // it cannot remove it. Only making the content region the actual lamp
    // gets the same brightness, because it is the same target function.
    //
    // The trade is the nav-tab lamp — the same one already accepted for
    // Discover. The tab is visibly active anyway (the app highlights the
    // current one), and this step is about what is on the screen.
    target: regionAboveCard,
    radius: 30,
    // ⚠ A GUEST'S REAL MY SCENE IS ONE SIGN-IN PROMPT. Lighting that honestly
    // would spotlight an empty screen and undercut everything the copy below
    // just said about a "personalised music calendar". The scrolling reel is
    // what following actually builds — scripted, not real; see TourDemos.jsx.
    Demo: MySceneReelDemo,
    title: 'My Scene',
    body: [
      'Make the scene yours.',
      'Follow your favourite artists, venues and events to build a personalised music calendar that grows with you.',
      'Every announcement, booking and saved event comes together in one place.',
    ],
    card: 'bottom',
  },

  /**
   * ⚠ DELIBERATELY THE SAME SHAPE AS MY SCENE — tab as the lamp, page as the
   * lift — and not because it was quicker. The brief for this step asks to
   * "transition seamlessly from the My Scene walkthrough" with "identical
   * styling"; a step that spotlit the tab AND the content as two equal lamps
   * would break the visual grammar the user has just learned, one card in.
   *
   * Steps 2-5 all point at a nav tab. Keeping their treatment identical is
   * what makes the lamp's travel read as one light moving along the nav
   * rather than four unrelated highlights.
   */
  {
    id: 'discover',
    route: '/discover',
    // ⚠⚠ LIT LIKE WHAT'S ON, NOT LIKE THE OTHER NAV-TAB STEPS — owner:
    // "I can't see the background. Undim the window to the same opacity of
    // What's On." This step used to spotlight the nav tab and merely `lift`
    // the page behind it, which left the real content sitting under the
    // veil at ~75% dim. A `lift` cannot undo that: it adds light on top of
    // the dim, it does not remove the dim. Lighting the content region
    // itself is the only way to get What's On's brightness, because it is
    // literally the same target function.
    //
    // The trade is the nav-tab lamp, and it is worth it here: the tab is
    // already visibly active (the app highlights the current tab), and this
    // step's whole point is the artists and events that are actually on
    // screen — which the user could not see.
    target: regionAboveCard,
    radius: 30,
    // Same reasoning as What's On: Discover is real and current for a guest
    // too, so it scrolls instead of faking a screenshot — and the same
    // waypoint treatment: heading → RECENTLY ADDED / ACTIVE → RECENTLY ADDED
    // EVENTS, whichever of those actually has content right now, per owner:
    // "do the same for discover."
    scrollLive: true,
    scrollWaypoints: '[data-tour="discover-section"]',
    // The portrait-card rail keeps scrolling through its own cards on the
    // fraction curve WHILE the page holds at a waypoint — per owner: "show
    // scrolling thru the portrait cards too." A rail moving gently while the
    // page itself is paused reads as life, not as two competing motions.
    scrollRails: ['[data-tour="discover-rail"]'],
    title: 'Discover',
    body: [
      'Meet your local music community.',
      'Search for artists, venues, promoters and events.',
      'Follow the people and places that matter to you, and discover everything happening around your local scene.',
    ],
    card: 'bottom',
  },

  /**
   * ⚠ THE LIFT IS THE WHOLE CONTENT AREA, NOT JUST THE ROWS, and that is a
   * judgement call worth knowing about. The brief says "highlight the
   * conversations list while keeping the rest of the interface softly
   * darkened"; on this screen the only thing between the top of the content
   * and the first row is the MESSAGES title, which is the list's own heading
   * rather than "surrounding UI".
   *
   * Anchoring the rows exactly would mean a hard top edge slicing through
   * that title, and it would need a wrapper element that InboxScreen does not
   * currently have — the rows are siblings, not a list container. Lighting
   * the section as a whole is both truer to what a reader considers "the
   * conversations" and consistent with steps 2 and 3, which the same brief
   * asks for ("identical styling", "transition smoothly").
   */
  {
    id: 'messages',
    route: '/messages',
    // Content region, matching every other content step — see the note on
    // My Scene for why the nav-tab lamp and `lift` were dropped.
    target: regionAboveCard,
    radius: 30,
    // Same reasoning as My Scene: a guest's real inbox correctly says "no
    // conversations yet", which is honest but not what "everything lives in
    // one place" is trying to show. Scripted exchange, not a recording.
    Demo: MessagesChatDemo,
    title: 'Messages',
    /**
     * ⚠ THE THIRD LINE PROMISES PHONE DISCOVERY, which is designed and
     * cleared to build but not shipped. Onboarding is the worst place for a
     * feature that is not there yet: it is read once, on first launch, by
     * someone forming their model of what the app does — and the first thing
     * they will try is texting a friend who has no account.
     *
     * Owner's call, made knowingly. If Phone Discovery slips past the beta,
     * this line is the one to pull.
     */
    body: [
      'One messenger for your entire music scene.',
      'Talk direct to artists, venues, promoters.',
      "Even your friends don't need a YesPleez account, just their phone number.",
      'Everything stays together in one place.',
    ],
    card: 'bottom',
  },

  /**
   * ⚠ NO `route`, AND THAT IS NOT AN OVERSIGHT. Industry is the one tab that
   * does not navigate: `handleTabPress` in App.jsx intercepts it and opens a
   * panel, and no `/industry` route exists. Declaring one sends the user to a
   * blank screen with the card still confidently describing a dashboard.
   *
   * So the step opens the panel the way a user would — by pressing the tab it
   * is already spotlighting.
   *
   * ⚠ THE PANEL STAYS OPEN INTO LATER STEPS. Nothing closes it, so steps 6
   * and 7 will render over the Industry surface unless they close it in their
   * own `onEnter`. Worth deciding when those steps are written rather than
   * discovering it on a phone.
   */
  {
    id: 'industry',
    onEnter: clickTarget('[data-tour="nav-industry"]'),
    // Content region, matching every other content step — see the note on
    // My Scene for why the nav-tab lamp and `lift` were dropped.
    target: regionAboveCard,
    radius: 30,
    // ⚠ THE ONE STEP WHOSE REAL SCREEN RENDERS BUT RENDERS EMPTY. Unlike My
    // Scene and Messages (empty for a guest) or What's On and Discover
    // (always current), /industry/venue loads fine and shows zeroes: it is
    // the signed-in user's own dashboard, so it cannot be populated for
    // anyone else. Owner's capture of the real Elbows Rest venue dashboard
    // stands in — see IndustryDashboardDemo.
    Demo: IndustryDashboardDemo,
    title: 'Industry',
    body: [
      'Where the music industry gets things done.',
      'Manage opportunities, discover artists, find venues, organise bookings and build professional relationships.',
      'We have a more in depth walk-thru of each of the profiles and how they work inside the info button at the top of the screen.',
      'This is where the business happens.',
    ],
    card: 'bottom',
  },

  /**
   * ⚠ `onEnter` CLOSES THE INDUSTRY PANEL step 5 opened. Nothing else does —
   * `setIndustryOpen` only flips back inside App's own tab handler — so
   * without this the whole rest of the tour plays over the Industry surface
   * while the cards talk about something else. Pressing WHAT'S ON runs that
   * handler, which clears the panel AND navigates home in one go.
   *
   * ⚠ NO `route`, deliberately: the press above already lands on '/'. Adding
   * one would navigate a second time, after the panel had closed, for no
   * reason.
   *
   * The BETA button lives in the global header, so this step would work from
   * any screen — home is chosen because it is where the tour started and
   * where "Start Exploring" should leave them.
   */
  {
    id: 'beta',
    onEnter: clickTarget('[data-tour="nav-whats-on"]'),
    target: elementsTarget(['[data-tour="beta"]'], 10),
    radius: 12,
    // The one step pointing at something the user is invited to press ANY
    // time rather than a place they are being shown — so it breathes.
    pulse: true,
    title: 'Help Shape YesPleez',
    body: [
      'YesPleez is built with its community.',
      ['Found a bug?', 'Have an idea?', 'Think something could work better?'],
      'Tap the BETA button any time.',
      'Every piece of feedback helps shape what gets built next.',
    ],
    card: 'bottom',
  },

  /**
   * THE LAST STEP, AND THE ONE THE WHOLE TOUR DEPENDS ON.
   *
   * ⚠ WITHOUT IT, "SKIP TOUR" READS AS "DESTROY THE TOUR". Everything the
   * user has just been shown is reachable again from one button they have
   * never had a reason to press — so the tour ends by pressing the eye
   * against it. The toast says the same thing four seconds later, in words;
   * this says it in light, while they are still looking.
   *
   * ⚠ NO `onEnter`. Step 6 already brought them home and the ⓘ lives in the
   * global header, so there is nothing to open and nowhere to go.
   *
   * Pulses for the same reason step 6 does: it points at a control the user
   * is invited to press ANY time, not a place they are being shown.
   */
  {
    id: 'info',
    target: elementsTarget(['[data-tour="info"]'], 10),
    radius: 14,
    pulse: true,
    title: 'Anytime You Like',
    body: [
      'Everything you have just seen lives here.',
      'Tap it for this tour again, plus a closer look at whichever kind of profile you are using.',
    ],
    card: 'bottom',
  },
];

/**
 * The steps that will actually run, in order, with their conditions applied.
 * Everything user-facing — the counter, the dots, next/previous — works off
 * this, never off TOUR_STEPS directly.
 */
export function activeSteps() {
  return TOUR_STEPS.filter(s => (typeof s.when === 'function' ? s.when() : true));
}
