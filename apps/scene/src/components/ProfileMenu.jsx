// THE ONE IDENTITY CONTROL — name, avatar, unread badge, account menu.
//
// Replaces the notification bell AND My Scene's profile pill (owner,
// 2026-08-04). Two controls doing adjacent jobs became one: the name gives
// immediate recognition, the avatar is the visual anchor, and the badge rides
// the avatar instead of occupying a button of its own.
//
// ⚠ IT LIVES IN GlobalHeader, WHICH IS EVERY SCREEN. That is deliberate — the
// bell was app-wide, and "no bell anywhere in the header" only means anything
// if its replacement is app-wide too. My Scene's own pill and email line are
// deleted rather than left as a second copy.

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import MessengerAvatar from './MessengerAvatar';
import { useAlwaysVisibleHeader } from '../lib/headerBehaviour';
import { unreadContactJoinCount, markContactJoinsRead } from '../lib/contactJoins';
import { startTour } from '../lib/tourState';
import PhoneNumberSettings from './PhoneNumberSettings';
import InviteRows from './InviteRows';
import s from './ProfileMenu.module.css';

export default function ProfileMenu({ session, unreadCount = 0, onSignOut, onOpenNotifications, onOpenHelp }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const wrapRef = useRef(null);
  /**
   * ⚠ THE MENU IS PORTALLED, SO IT IS NOT INSIDE `wrapRef`.
   *
   * This ref exists because leaving it out silently broke every menu item
   * (owner, 2026-08-04: "none of them are doing anything when i click on
   * them?"). The close-on-outside-click handler asked only whether the event
   * landed inside the CONTROL — and a portalled menu never does, so:
   *
   *    mousedown on a menu item -> "outside" -> setOpen(false) -> unmounts
   *    -> the click that would have run onClick has nothing left to land on
   *
   * Nothing errored and nothing logged; the menu just shut and the app stayed
   * where it was.
   */
  const menuRef = useRef(null);

  /**
   * ⭐ THE MENU PINS THE HEADER OPEN.
   *
   * The header hides on downward scroll and takes its children with it — so
   * without this, scrolling with the menu open would slide the menu off the
   * top of the screen while it still had focus. This is the first real use of
   * the opt-out built alongside the auto-hide; it existed with nothing calling
   * it until now.
   */
  useAlwaysVisibleHeader(open);

  useEffect(() => {
    if (!session?.user?.id) { setProfile(null); return; }
    let cancelled = false;
    // The PERSONAL profile — the same row My Scene's pill read, so the two
    // cannot show different names or pictures for one person. Industry
    // profiles are chosen from the Industry tab and are not "you".
    supabase.from('profiles')
      // `type` is here for Invite Friends: profileUrl() emits `?type=` and a
      // link without it resolves through the legacy precedence chain instead
      // of pointing straight at this row.
      .select('id, name, type, avatar, avatar_thumb')
      .eq('user_id', session.user.id).eq('type', 'punter')
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data || null); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  /**
   * CJ1's count, for the Find People badge.
   *
   * ⚠ FETCHED WHEN THE MENU OPENS, NOT ON MOUNT. This component renders on
   * every screen in the app, so a mount-time query would be one extra request
   * per page load for a number nobody can see until the menu is open. The old
   * home for this count was InboxScreen, which is visited far less often than
   * "every route".
   */
  const [joinCount, setJoinCount] = useState(0);

  /**
   * Find People, expanded inside the menu rather than on another screen.
   *
   * ⚠ RESET WHENEVER THE MENU CLOSES. Left open, the next tap on the avatar
   * would reopen the menu already showing a settings panel — which is not what
   * "open my account menu" asks for, and buries the seven other items.
   */
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => { if (!open) setFindOpen(false); }, [open]);

  /**
   * HOW IT ALL WORKS, expanded. Same mechanism and same reset-on-close as
   * Find People above: reopening the menu must not land someone straight
   * back inside a panel they were finished with.
   *
   * ⚠ DECLARED WITH THE OTHER HOOKS, ABOVE THE SIGNED-OUT RETURN. It sat
   * below it for one revision — a rules-of-hooks violation, because the hook
   * order changes the moment `session` flips and React pairs state to the
   * WRONG hook. Lint caught it; the test suite could not. Second time today.
   */
  const [learnOpen, setLearnOpen] = useState(false);
  useEffect(() => { if (!open) setLearnOpen(false); }, [open]);
  /* SETTINGS EXPANDS, IT DOES NOT NAVIGATE — same mechanism and same
     reset-on-close as How it all works. See the item itself for why. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!open) setSettingsOpen(false); }, [open]);
  useEffect(() => {
    if (!open || !session?.user?.id) return undefined;
    let cancelled = false;
    unreadContactJoinCount(session.user.id).then((n) => { if (!cancelled) setJoinCount(n); });
    return () => { cancelled = true; };
  }, [open, session?.user?.id]);

  // Close on outside click and on Escape. ⚠ `mousedown`, not `click`: a
  // `click` listener fires after the menu item's own handler has already
  // navigated, which on a route change means closing a menu that has been
  // unmounted.
  useEffect(() => {
    if (!open) return undefined;
    // BOTH refs. The control and the portalled menu are two separate subtrees
    // that together make one component — "outside" means outside both.
    const onDown = e => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey  = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * ⭐ SIGNED OUT, THE SLOT IS THE ACCOUNT ENTRY POINT, NOT AN EMPTY SPACE
   * (owner, 2026-08-12). With the auth wall gone this header is the one
   * surface every anonymous visitor has, so the identity control's signed-out
   * state is a SIGN IN button — same 44px geometry and 32px face as the
   * signed-in control, so --yp-header-height cannot move between the two
   * states, and no box, because this header draws none. The face is the Hand
   * placeholder MessengerAvatar already renders with no src: the brand's own
   * "no one here yet".
   *
   * ⚠ `data-tour="info"` stays on the signed-in control only. The tour's
   * final step describes the account MENU; for a signed-out viewer the engine
   * skips the missing anchor, exactly as it did when this branch was null.
   */
  if (!session) {
    return (
      <div className={s.wrap}>
        <button
          type="button"
          className={s.control}
          onClick={() => navigate('/auth')}
          aria-label="Sign in or create an account"
        >
          <span className={`${s.name} ${s.signInName}`}>SIGN IN</span>
          <span className={s.avatarWrap}>
            <MessengerAvatar size={32} />
          </span>
        </button>
      </div>
    );
  }

  const displayName =
    profile?.name?.trim()
    || session.user.user_metadata?.name
    || session.user.email?.split('@')[0]
    || 'Profile';

  // ⚠ TAKES ROUTER STATE, because Find People below has to reach a control
  // that lives inside InboxScreen. Same channel the app already uses for
  // `openConversation` — one mechanism for "go there and do a thing", not two.
  const go = (path, state) => { setOpen(false); navigate(path, state ? { state } : undefined); };

  /**
   * ⭐ HOW IT ALL WORKS (owner, 2026-08-12) — the three "explain this app"
   * actions, behind a menu item that opens them.
   *
   * They used to live inside the ⓘ info sheet, two taps deep, behind an item
   * called Help & Feedback. That sheet still explains the SCREEN you are on;
   * these three are about the PRODUCT, and they are the answer to "what is
   * this and what do I do with it" — the question the tour used to ask on
   * everybody's behalf, uninvited, 1200ms after launch.
   *
   * ⚠ A HEADING WOULD HAVE PUT THREE PERMANENT ROWS ABOVE EVERY OTHER ITEM.
   * It expands instead, exactly as Find People does — same mechanism, same
   * reset-on-close — so the menu opens at its normal length and these appear
   * only when asked for.
   *
   * ⛔ Not duplicated in the sheet. One control, one home.
   */
  /**
   * What lives under Settings. One entry today; the rest of the usual list
   * (light/dark, theme colour, …) joins it here.
   *
   * ⚠ THE SAME DESTINATION THE NOTIFICATION PANEL'S COG USES — `/notifications`
   * with `openPrefs`, not a second preferences surface. That panel's own note
   * says the cog is the only way to settings from there; this makes the menu
   * the second way to the SAME place rather than a rival one.
   */
  const settingsItems = [
    { label: 'Notification settings', onClick: () => go('/notifications', { openPrefs: true }) },
  ];

  const learnItems = [
    { label: 'TAKE THE TOUR', onClick: () => { setOpen(false); startTour(); } },
    { label: 'SET UP A PROFILE', onClick: () => go('/start') },
    // ⚠ A PLACEHOLDER, AND IT MUST READ AS ONE — `disabled` in the DOM, not
    // merely styled dead: a button that only looks inert still takes focus and
    // still announces itself as pressable. The SOON tag says why. Delete the
    // flag and the tag together when the per-role walkthroughs land.
    { label: 'INDUSTRY ROLE TOURS', soon: true },
  ];

  const items = [
    {
      label: 'How it all works',
      onClick: () => setLearnOpen(v => !v),
      expanded: learnOpen,
    },
    /**
     * ⚠ VIEW PROFILE IS MUTED, NOT DELETED (owner, 2026-08-05: "i dont really
     * want to have it as a socials network, or do i? at least mute it while i
     * figure it out").
     *
     * ⛔ THE ROUTE AND THE PAGE ARE UNTOUCHED. `/profile/:id?type=punter` still
     * resolves, and every link to it from elsewhere — search results, a shared
     * invite link, the profile a contact taps — still works. What is gone is
     * the account menu's own way of saying "here is your public self", which is
     * the bit that makes it feel like a social network.
     *
     * Restoring it is uncommenting one line. It is left here rather than
     * deleted precisely because the question is open:
     *
     * { label: 'View Profile', onClick: () => (profile?.id ? go(`/profile/${profile.id}?type=punter`) : go('/me')) },
     */
    {
      // ⚠ WAS THE "FIND FRIENDS" PILL IN THE MESSAGES HEADER, renamed and moved
      // here (owner, 2026-08-05) so that header can carry messaging identities
      // instead. Renamed to Find People because it finds artists and venues too,
      // which the old name quietly denied.
      //
      // ⚠ CJ1's BADGE CAME WITH IT. The rule is that contact joins badge THIS
      // control and never the bell — the position IS the message — so moving the
      // control without its badge would silently retire a ratified behaviour.
      // ⚠ EXPANDS IN PLACE — it does NOT navigate. Owner, 2026-08-05: "i want
      // this window to appear as another drop down from the find people line".
      // It used to route to Messages and open a panel there, which meant a
      // control in the app-wide menu only worked by taking you to one screen.
      label: 'Find People',
      onClick: () => {
        setFindOpen((v) => {
          const next = !v;
          // CJ1 · cleared optimistically on OPEN, matching the behaviour this
          // inherited from InboxScreen: a badge that lingers for a round trip
          // after the user has plainly acted on it reads as a stuck badge.
          if (next && joinCount > 0) {
            setJoinCount(0);
            markContactJoinsRead(session?.user?.id);
          }
          return next;
        });
      },
      badge: joinCount,
      expanded: findOpen,
    },
    {
      label: 'Notifications',
      // ⚠ Opens the SAME panel the bell opened, rather than routing to
      // /notifications. The brief removed the bell, not the panel behind it —
      // sending people somewhere new here would be losing functionality under
      // cover of a redesign.
      onClick: () => { setOpen(false); onOpenNotifications?.(); },
      badge: unreadCount,
    },
    /**
     * ⭐ SETTINGS IS A DRAWER, AND IT EDITS NOTHING (owner, 2026-08-14).
     *
     * ⛔ IT USED TO OPEN /me, WHICH IS A PROFILE EDITOR — display name, photo,
     * home locality. That made the one item people look for when they want
     * preferences the one item that changes their public identity instead.
     * "Edit Profile" already sits at the top of this menu on the account
     * header, so nothing is lost by Settings no longer going there; what is
     * gained is that the two stop being the same door.
     *
     * ⚠ ONE CHILD FOR NOW, DELIBERATELY. Light/dark, theme colour and the rest
     * of the usual list land here as siblings as they are built. It expands
     * rather than routing precisely so that growth costs a line in
     * `settingsItems` instead of a screen — and so the menu opens at its
     * normal length until asked.
     *
     * ⛔ NOT a new /settings route. A page with one link on it is a worse
     * version of this drawer, and it would need its own back-navigation to say
     * what the ‹ in Find People already says.
     */
    {
      label: 'Settings',
      onClick: () => setSettingsOpen(v => !v),
      expanded: settingsOpen,
    },
    { label: 'Privacy Centre', onClick: () => go('/messages') },
    // ⚠ OPENS THE INFO SHEET, not /beta-feedback. The header's ⓘ button was
    // removed in the same pass, and that sheet is the only place the app
    // explains the screen you are on — routing straight past it would have
    // deleted that content rather than moved it. The sheet itself now carries
    // a GIVE FEEDBACK button, so this one item genuinely is help AND feedback.
    { label: 'Help & Feedback', onClick: () => { setOpen(false); onOpenHelp?.(); } },
  ];

  return (
    <div className={s.wrap} ref={wrapRef}>
      {/* ONE button, name and avatar together — hover, focus and active all
          apply to the whole control rather than to either half. */}
      <button
        type="button"
        /* ⚠ THE TOUR'S ANCHOR, INHERITED FROM THE ⓘ BUTTON THIS REPLACED. The
           guided tour's final step targets `[data-tour="info"]`, and its engine
           skips a target it cannot find rather than throwing — so without this
           the last step would silently do nothing. Not a styling hook; the
           CSS-module class beside it is content-hashed and unusable from
           outside this file. */
        data-tour="info"
        className={s.control}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        /* ⛔ Commas, not dashes. A screen reader reads this aloud, which makes
           it copy like any other (owner rule, 2026-08-12). */
        aria-label={unreadCount > 0
          ? `${displayName}, account menu, ${unreadCount} unread`
          : `${displayName}, account menu`}
      >
        <span className={s.name}>{displayName}</span>
        <span className={s.avatarWrap}>
          {/* 32px (owner, 2026-08-04, up from 28). Still inside the 44px hit
              area with 6px clear each side, so the control's height — and
              therefore --yp-header-height and everything reserving space
              against it — does not move. */}
          <MessengerAvatar src={profile?.avatar_thumb || profile?.avatar} size={32} />
          {/* ⚠ THE COUNT BADGE MOVED TO THE BELL, AND BECAME A DOT. It read
              from `unreadCount` too, so leaving it here would put two marks
              for one fact on one control — and the reader would reasonably
              assume two different facts. The count itself is not lost: the
              Notifications item in the menu still carries it, and that is the
              control that opens the list.
              ⛔ Do not re-add a badge here without removing the dot. */}
        </span>
      </button>

      {/* ⭐ THE BELL — the header's notification signal (owner, 2026-08-14).
          Lucide's `bell` (the plain one; it replaced `bell-concierge` on the
          owner's call the same day): 24-box, 2px stroke, round caps and joins,
          so it belongs to the same family as every other icon in the app
          rather than reading as artwork.

          ⚠ ITS OWN CONTROL, TO THE RIGHT OF THE FACE (owner). Which also
          settles the HTML: interactive content nested in a button is invalid
          and can stop receiving events entirely, so as a sibling it is free to
          be a real button — and it opens the same panel the menu's
          Notifications item opens, rather than inventing a second surface.

          ⚠ 44px AND UNBORDERED. The full touch target with no box: the header
          draws no boxes (see the SIGN IN branch), and a bordered button here
          would be the only framed thing in the bar. Hover tints the icon, not
          a background, so the affordance lives in the mark itself.

          ⚠ LAST IN THE BAR, SO IT IS THE THING NEAREST THE SCREEN EDGE. The
          menu is portalled and right-aligned to this wrapper, so the order of
          these two children moves the anchor as well as the icon — checked
          after the move, not assumed.

          ⛔ NOT THE OLD 26px BELL RETURNING. That one was removed for sitting
          under the touch minimum; this one is 44. */}
      <button
        type="button"
        className={s.bellBtn}
        onClick={() => { setOpen(false); onOpenNotifications?.(); }}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <span className={s.bellWrap}>
          <svg
            width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
            <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
          </svg>
          {/* R3 · no zero dot, same rule the count badge followed. */}
          {unreadCount > 0 && <span className={s.bellDot} aria-hidden="true" />}
        </span>
      </button>

      {/* ⚠ PORTALLED TO BODY. `.header` carries a transform (translateX for its
          centring, translateY for the auto-hide), and a transform makes an
          element the containing block for `position: fixed` descendants — so a
          fixed menu rendered inside the header would be positioned against the
          HEADER, not the viewport, and would slide away with it. This is a
          standing rule in this codebase, not a precaution. */}
      {open && createPortal(
        <>
          <div className={s.scrim} onMouseDown={() => setOpen(false)} />
          {/* ⚠ ONE SHELL, TWO CONTENTS — the sheet REPLACES the menu rather
              than nesting inside it (owner, 2026-08-05: "i didnt mean literally
              inside the window… it can be another pop up"). Same container, same
              corner, same scrim: a second floating layer would be a second thing
              to dismiss and would have to solve its own outside-click.

              It widens and scrolls only while the sheet is showing — the panel
              carries a number field with a confirm, a radio list and contact
              sync, none of which fit a 232px popover. `calc(100vw - 24px)` keeps
              it on screen at 375px; scrollbars are hidden globally by index.css. */}
          <div
            className={s.menu}
            role="menu"
            ref={menuRef}
            style={findOpen
              ? { width: 'min(380px, calc(100vw - 24px))', maxHeight: '72vh', overflowY: 'auto' }
              : undefined}
          >
            {findOpen ? (
              <>
                {/* ⚠ BACK, NOT CLOSE. This sheet was reached from the menu, so
                    the reverse of the gesture that opened it is returning to the
                    menu — not dismissing everything and making the user start
                    again. The scrim still closes the lot. */}
                <div className={s.head} style={{ paddingBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => setFindOpen(false)}
                    aria-label="Back to account menu"
                    style={backButton}
                  >
                    ‹
                  </button>
                  <div className={s.headText}>
                    <div className={s.headName}>Find People</div>
                  </div>
                </div>

                <div className={s.rule} />

                <PhoneNumberSettings session={session}>
                  <InviteRows myProfile={profile} />
                </PhoneNumberSettings>
              </>
            ) : (
              <>
            <div className={s.head}>
              <MessengerAvatar src={profile?.avatar_thumb || profile?.avatar} size={40} />
              <div className={s.headText}>
                <div className={s.headName}>{displayName}</div>
                {/* "Edit Profile", not "Profile Photo" (owner, 2026-08-04) —
                    /me changes the display name and home locality as well as
                    the picture, so the old label named a third of what the
                    link does. */}
                <button type="button" className={s.headLink} onClick={() => go('/me')}>
                  Edit Profile
                </button>
              </div>
            </div>

            <div className={s.rule} />

            {items.map(it => (
              <Fragment key={it.label}>
                <button
                  type="button"
                  role="menuitem"
                  className={s.item}
                  onClick={it.onClick}
                  // Only the expandable item claims this; the rest still
                  // navigate, and announcing them as expandable would be a lie.
                  aria-expanded={it.expanded === undefined ? undefined : it.expanded}
                >
                  <span>{it.label}</span>
                  {it.badge > 0 && <span className={s.itemBadge}>{it.badge > 9 ? '9+' : it.badge}</span>}
                </button>

                {/* ⭐ THE THREE ACTIONS, ONLY ONCE ASKED FOR. Rendered as the
                    purple gradient buttons they were in the ⓘ sheet (owner,
                    2026-08-12) — same ramp as the tour's own Next button, so
                    "this explains the app" looks the same wherever it is
                    offered. They sit INSIDE the expanding row rather than
                    after the list, so closing the menu takes them with it. */}
                {/* Inside the row, like the learn panel, so closing the menu
                    takes the drawer with it. */}
                {it.label === 'Settings' && settingsOpen && (
                  <div className={s.subPanel}>
                    {settingsItems.map(sub => (
                      <button
                        key={sub.label}
                        type="button"
                        role="menuitem"
                        className={s.subItem}
                        onClick={sub.onClick}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}

                {it.label === 'How it all works' && learnOpen && (
                  <div className={s.learnPanel}>
                    {learnItems.map(l => (
                      <button
                        key={l.label}
                        type="button"
                        role="menuitem"
                        className={l.soon ? s.learnSoon : s.learnBtn}
                        onClick={l.onClick}
                        disabled={!!l.soon}
                      >
                        {l.label}
                        {l.soon && <span className={s.soonTag}>SOON</span>}
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            ))}

            <div className={s.rule} />

            <button type="button" role="menuitem" className={`${s.item} ${s.signOut}`}
              onClick={() => { setOpen(false); onSignOut?.(); }}>
              Sign Out
            </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

/* Sized to the avatar it replaces in `.head`, so the sheet's header sits at the
   same height as the menu's and the two do not jump when you move between them. */
const backButton = {
  width: 40, height: 40, flexShrink: 0,
  display: 'grid', placeItems: 'center',
  background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)',
  borderRadius: 999, cursor: 'pointer',
  color: 'var(--text)', fontSize: 22, lineHeight: 1, paddingBottom: 3,
};
