import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * CONVERSATION UI STATE — owned by the APP SHELL, never by a screen.
 *
 * Canonical interaction model (owner, 20 Jul 2026):
 *
 *   Messaging is a SUPPORTING WORKFLOW, not a destination. A user stays in
 *   whatever they were doing — editing an event, reviewing applications,
 *   browsing a venue — while communicating. Minimise context switching.
 *
 * ── WHY THIS LIVES AT THE SHELL AND NOT IN A SCREEN ──────────────────
 *
 * A screen-owned drawer unmounts on navigation, and unmounting is exactly what
 * this model forbids: the draft, scroll position, playback, upload progress and
 * recording state all die with it. "Minimised" would then mean "destroyed and
 * re-fetched", which looks identical until the user loses a half-typed reply.
 *
 * So the drawer is mounted ONCE, above the router. Any screen may open it;
 * navigation does not touch it.
 *
 * ── CLOSING IS MINIMISING ────────────────────────────────────────────
 *
 * There is deliberately no "destroy" in the common path. `minimise` keeps the
 * conversation alive as a pill above the bottom nav; `dismiss` is the explicit
 * teardown and is the only thing that discards state. Treat conversations as
 * persistent application state, not modal windows.
 *
 * ── WHAT IS PRESERVED, AND WHY IT IS HELD HERE ───────────────────────
 *
 * Per-conversation UI state is kept in a ref-backed map rather than component
 * state: a draft changing on every keystroke must not re-render the whole app
 * shell. Only the OPEN/MINIMISED set is reactive, because only that changes
 * what is on screen.
 */

const ConversationUiCtx = createContext(null);

/** UI state kept alive for a minimised conversation. Extend here, not at call sites. */
function emptyUiState() {
  return {
    draft:        '',
    // Cursor/selection inside the composer. Restoring the draft without this
    // drops the caret to the end, so resuming mid-sentence silently moves
    // where the next character lands.
    selection:    null,   // {start, end}
    scrollTop:    null,
    playback:     null,   // {messageId, positionMs} — voice notes
    replyTo:      null,   // selected reply target
    uploads:      [],     // in-flight attachments
    recording:    null,   // in-progress voice note
    unread:       0,
    lastPreview:  null,   // {text, kind} for the pill
    profile:      null,   // {id, name, type, avatarUrl} for the pill
    /**
     * ⭐ WHICH OF MY PROFILES I OPENED THIS AS — a hint from the surface that
     * opened the drawer, and null when it did not say.
     *
     * ⚠⚠ WHY IT IS NEEDED: when BOTH participants belong to one account, the
     * conversation cannot tell which of them is "you". It fell back to the
     * first profile the account can act as, so pressing MESSAGE on a host
     * dashboard could seat you as your VENUE, talking to your own host —
     * the identity flipped for no reason the reader could see.
     *
     * ⛔ A HINT, NEVER A GRANT. The view still resolves ownership through
     * `actableProfileIds` and ignores this unless it names a profile that
     * check already returned (§A4: ownership is asked, never computed).
     */
    asProfileId:  null,
  };
}

export function ConversationUiProvider({ children }) {
  // Reactive: which conversation is open, and which are minimised (order matters).
  const [openId, setOpenId]       = useState(null);
  const [minimised, setMinimised] = useState([]);   // conversation ids, most recent first

  // Non-reactive: the preserved state itself. Keystrokes must not re-render the shell.
  const stateRef = useRef(new Map());

  const ensure = useCallback((id) => {
    if (!stateRef.current.has(id)) stateRef.current.set(id, emptyUiState());
    return stateRef.current.get(id);
  }, []);

  /** Open the drawer on a conversation, restoring whatever it held. */
  const open = useCallback((id, seed = null) => {
    if (!id) return;
    const st = ensure(id);
    if (seed?.profile && !st.profile) st.profile = seed.profile;
    /* ⚠ OVERWRITES, unlike `profile`. Opening the same thread from a
       different surface is a NEW statement about who is speaking, and the
       latest one is the true one — where the pill's profile is just a label
       that should not churn. */
    if (seed?.asProfileId) st.asProfileId = seed.asProfileId;
    st.unread = 0;                                  // opening clears the pill badge
    setMinimised(prev => prev.filter(x => x !== id));
    setOpenId(id);
  }, [ensure]);

  /**
   * Minimise the open drawer. This is what the close affordance does.
   * The conversation stays alive; only its presentation changes.
   */
  const minimise = useCallback((id = null) => {
    setOpenId(current => {
      const target = id ?? current;
      if (!target) return current;
      ensure(target);
      setMinimised(prev => (prev.includes(target) ? prev : [target, ...prev]));
      return current === target ? null : current;
    });
  }, [ensure]);

  /**
   * Explicit teardown — the ONLY thing that discards preserved state.
   * Separate from minimise on purpose: an accidental close must not be able to
   * throw away a draft.
   */
  const dismiss = useCallback((id) => {
    if (!id) return;
    stateRef.current.delete(id);
    setMinimised(prev => prev.filter(x => x !== id));
    setOpenId(current => (current === id ? null : current));
  }, []);

  /** Read preserved state. Returns a live object — mutate via patch, not directly. */
  const getState = useCallback((id) => (id ? ensure(id) : emptyUiState()), [ensure]);

  /**
   * Update preserved state without re-rendering the shell.
   *
   * `notify` re-renders only when something the PILL displays changed — unread,
   * preview, profile. A draft keystroke passes notify=false and stays silent.
   */
  const patch = useCallback((id, changes, notify = false) => {
    if (!id) return;
    Object.assign(ensure(id), changes);
    if (notify) setMinimised(prev => [...prev]);    // shallow bump to repaint pills
  }, [ensure]);

  const value = useMemo(() => ({
    openId, minimised, open, minimise, dismiss, getState, patch,
    isOpen: (id) => openId === id,
  }), [openId, minimised, open, minimise, dismiss, getState, patch]);

  return <ConversationUiCtx.Provider value={value}>{children}</ConversationUiCtx.Provider>;
}

/**
 * Open a conversation from anywhere.
 *
 * Screens should call this rather than navigating to /messages/:id — navigation
 * is the context switch the whole model exists to avoid. The full-screen inbox
 * remains, for search, archive, pinning and management.
 */
export function useConversationUi() {
  const ctx = useContext(ConversationUiCtx);
  if (!ctx) throw new Error('useConversationUi must be used inside ConversationUiProvider');
  return ctx;
}
