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

  if (!session) return null;

  const displayName =
    profile?.name?.trim()
    || session.user.user_metadata?.name
    || session.user.email?.split('@')[0]
    || 'Profile';

  // ⚠ TAKES ROUTER STATE, because Find People below has to reach a control
  // that lives inside InboxScreen. Same channel the app already uses for
  // `openConversation` — one mechanism for "go there and do a thing", not two.
  const go = (path, state) => { setOpen(false); navigate(path, state ? { state } : undefined); };

  const items = [
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
    // ⚠ Settings points at /me, which is where display name, photo and home
    // locality actually live. Privacy Centre points at /messages, where
    // PrivacyInfo renders inside PhoneNumberSettings — behind the FIND FRIENDS
    // toggle, so it lands NEAR rather than ON the privacy copy. Neither has a
    // page of its own yet; see the note in the handover.
    { label: 'Settings',       onClick: () => go('/me') },
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
        aria-label={unreadCount > 0
          ? `${displayName} — account menu, ${unreadCount} unread`
          : `${displayName} — account menu`}
      >
        <span className={s.name}>{displayName}</span>
        <span className={s.avatarWrap}>
          {/* 32px (owner, 2026-08-04, up from 28). Still inside the 44px hit
              area with 6px clear each side, so the control's height — and
              therefore --yp-header-height and everything reserving space
              against it — does not move. */}
          <MessengerAvatar src={profile?.avatar_thumb || profile?.avatar} size={32} />
          {/* R3 · no zero badge. A dot that says "0" is worse than no dot. */}
          {unreadCount > 0 && (
            <span className={s.badge} aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
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
