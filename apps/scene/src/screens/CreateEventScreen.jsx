import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../App";
import s from "@yespleez/event-editor/styles.module.css";
import { getOwnerProfiles } from "../lib/actingProfile";
import { track, EVENTS } from "../lib/analytics";
/* ⭐ The SAME planner the enquiry card's picker uses — one definition of what
   may join a bill, so arriving from a link cannot bypass a rule the button
   enforces. */
import { planAddArtistToShortlist, addArtistToShortlist } from "../lib/shortlistFromArtist";
import { useEventEditorState, rowsToDays } from "@yespleez/event-editor";
import { loadEventSlots, saveEventSlots } from "../lib/eventSlotWrites";
import { withSetTimesEnabled } from "../lib/eventSetTimes";
import VenueCheckSheet, { nearestVenues } from "../components/VenueCheckSheet";
import EventEditorForm from "./event/SceneEventEditor";
import { uploadPosterCrop } from "../lib/uploadImage";
import { submitVenueRequest, venueRequestFromConfig } from "../lib/venueSubmissions";
import { loadEventStages, createEventStage, renameEventStage, deleteEventStage, nextStageName, nextStageAccent } from '../lib/eventStages';

/**
 * SCENE’S EVENT SCREEN — plumbing only.
 *
 * ⭐⭐ The editor itself is `event/EventEditorForm`, and Festival Companion
 * renders the SAME component. This file went from 1,344 lines to plumbing
 * because everything that was presentation moved there, and everything that
 * was form state moved to `useEventEditorState`.
 *
 * What a screen owns and a shared component must not: the route, the session,
 * loading, saving, deleting, and where to go afterwards.
 */
export default function CreateEventScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [venueCheckOpen, setVenueCheckOpen] = useState(false);
  const [venueCandidates, setVenueCandidates] = useState([]);
  /* ⚠ An unreadable running order is stated, never guessed at — see the load
     effect. A form that silently shows the wrong schedule will save it. */
  const [slotLoadError, setSlotLoadError] = useState('');
  const [stages, setStages] = useState([]);

  /**
   * ⭐⭐ ALL FORM STATE LIVES IN THE SHARED HOOK, so Festival Companion renders
   * the identical editor rather than growing a second one.
   */
  const ed = useEventEditorState({ userId: session?.user?.id, uploadPosterCrop });

  // Only what the plumbing below reads. Everything else is the form’s.
  const {
    name, venue, venueProfileId, owners, ownerId, coHosts, requiredItems, isPublic, appsOpen,
    setOwners, setOwnerId, setCoHosts, setVenueProfileId, setVenue, setVenueTown,
  } = ed;

  // Owner resolution. Skipped when editing — an event's owner is set once at
  // creation and changed only by exception (Phase 13 Q6 `T1`, erratum E2), so
  // the edit path must never restamp it.
  useEffect(() => {
    if (editId || !session?.user?.id) return;
    // Full profile objects, not just ids — `type` and `name` are needed by the
    // picker and by venue resolution below.
    getOwnerProfiles(session.user.id, searchParams.get('as')).then(list => {
      setOwners(list);
      setOwnerId(list.length === 1 ? list[0].id : null);
    });
  }, [editId, session?.user?.id, searchParams]);

  /**
   * ── ⭐⭐ ARRIVING FROM AN ACCEPTED ENQUIRY ────────────────────────────
   *
   * The enquiry already settled the date, and often the room. Making the
   * organiser retype them is friction at best; at worst the retyped date
   * disagrees with the one both parties accepted, and nothing in the app
   * would ever notice.
   *
   * ⛔ NEW EVENTS ONLY. An edit's values come from the stored row and must
   * never be overwritten by a URL.
   *
   * ⚠ ONCE. A prefill is a starting point, not a binding: the moment it has
   * been applied the organiser owns those fields, so a re-render must not
   * drag an edited date back to what the link said.
   */
  const prefilled = useRef(false);
  useEffect(() => {
    if (editId || prefilled.current) return;
    const date = searchParams.get('date');
    const venueId = searchParams.get('venue');
    if (!date && !venueId) return;
    prefilled.current = true;

    if (date) { ed.setStartDate(date); ed.setEndDate(date); }
    if (venueId) {
      /* ⚠ The NAME is read from the profile rather than carried in the URL: a
         name in a link is a copy that goes stale, and the venue field is what
         the public page prints. */
      ed.setVenueProfileId(venueId);
      supabase.from('profiles').select('name, location, suburb, state, postcode')
        .eq('id', venueId).maybeSingle()
        .then(({ data }) => { if (data?.name) ed.setVenue(data.name); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, searchParams]);

  /**
   * Existing co-hosts, when editing.
   *
   * ⚠ SEPARATE FROM THE EVENT LOAD BELOW, and ordered by `position`. The chips
   * have to show what is actually stored before the host can sensibly add or
   * remove one — a picker that opened empty on an event that already had
   * co-hosts would invite someone to re-add a row the PK then rejects.
   * `ownerId` is also set here: the edit path deliberately never restamps the
   * owner (see the resolution effect above), so without this the picker would
   * not know which profile to keep out of its own results.
   */
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      const { data: ev } = await supabase.from('events').select('owner_profile_id').eq('id', editId).maybeSingle();
      if (!cancelled && ev?.owner_profile_id) setOwnerId(ev.owner_profile_id);
      const { data: rows } = await supabase.from('event_hosts')
        .select('profile_id, position').eq('event_id', editId).order('position');
      const ids = (rows || []).map(r => r.profile_id).filter(Boolean);
      if (!ids.length) return;
      const { data: profs } = await supabase.from('profiles')
        .select('id, name, type, avatar_thumb, avatar, location, state').in('id', ids);
      if (cancelled) return;
      const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
      setCoHosts(ids.map(i => byId[i]).filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [editId]);

  /**
   * Load the event being edited.
   *
   * ⭐ The config → form mapping moved into `eventEditorModel.fromConfig`, via
   * `ed.hydrate`. This effect keeps the fetch; the interpretation of the blob
   * now lives in ONE place that Festival Companion uses too, which is what
   * stops two apps disagreeing about what an event says.
   */
  useEffect(() => {
    if (!editId) return;
    supabase.from('events').select('*').eq('id', editId).single().then(async ({ data }) => {
      if (!data) return;
      ed.hydrate(data);
      /**
       * ⭐ THE SCHEDULE COMES FROM `event_slots`, AFTER hydrate.
       *
       * `hydrate` fills `days` from `config.days`, which is now the stale copy —
       * the event page reads rows. Overwriting it here is what stops the editor
       * showing a running order the rest of the app no longer believes in.
       *
       * ⚠ `setTimesNeeded` has to follow. It is derived, not stored (see
       * `fromConfig`), and it was derived from the blob — so an event whose
       * slots live only in rows would load with the toggle OFF and the next
       * save would clear the lot.
       *
       * ⛔ A FAILED READ MUST NOT FALL THROUGH TO THE BLOB. `saveEventSlots`
       * diffs against what it can see, so an editor holding `config.days` after
       * an unreadable slot query would delete every real slot on save.
       */
      try {
        const rows = await loadEventSlots(supabase, editId);
        if (rows.length) { ed.setDays(rowsToDays(rows)); ed.setSetTimesNeeded(true); }
        else if ((data.config?.days || []).some(d => (d.slots || []).length)) {
          // Rows are empty but the blob is not: this event predates the
          // migration or its slots were removed elsewhere. ⛔ Do not guess —
          // say so rather than silently offering the old schedule for re-save.
          setSlotLoadError('This event\'s running order could not be loaded. Editing and saving would clear it, so the schedule is shown empty on purpose.');
          ed.setDays([]); ed.setSetTimesNeeded(false);
        }
      } catch (e) {
        setSlotLoadError(e.message);
        ed.setDays([]); ed.setSetTimesNeeded(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  /* ⭐ An event's stages, when editing. ⛔ Separate from the load above: stages
     are rows the organiser creates and removes live, not part of the config
     blob, and this list is re-read after each of those actions. */
  useEffect(() => {
    if (!editId) { setStages([]); return; }
    refreshStages(editId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);


  /**
   * ⭐ THE VENUE CHECK — the last gate before an event goes public.
   *
   * An unmatched venue is only worth interrupting for at GO LIVE: a draft can
   * hold a half-typed name harmlessly, and asking mid-form made the promoter
   * reason about the venue database while naming a pub. Here the question is
   * concrete — "did you mean one of these five?" — and it is the moment a
   * duplicate would otherwise be created.
   *
   * ⛔ DRAFTS ARE NEVER INTERRUPTED. Saving a draft is how someone parks an
   * event they have not finished thinking about.
   */
  async function handleSave(goLive, opts = {}) {
    if (!name.trim()) { setError('Event name is required.'); return; }
    if (!session)     { setError('You must be signed in.'); return; }

    /* ⛔ NOT ASKED FOR A SECRET LOCATION. A withheld venue is deliberately not
       in the catalogue and never will be, so "did you mean one of these?" is
       arguing with a decision the host has already made explicitly. */
    if (goLive && !opts.venueChecked && !venueProfileId && venue.trim() && !ed.locationWithheld) {
      setError('');
      const { data: venues } = await supabase.from('profiles')
        .select('id, name, suburb, location, state, postcode, lat, lng')
        .eq('type', 'venue');
      setVenueCandidates(nearestVenues(venues || [], {
        town: ed.venueTown, postcode: ed.venuePostcode, state: ed.venueState, name: venue,
      }));
      setVenueCheckOpen(true);
      return;
    }

    setSaving(true); setError('');

    /**
     * ⭐ The form → config mapping moved to `eventEditorModel.toConfig`, the
     * mirror of `fromConfig` used by the load above. One writer of the blob,
     * shared with Festival Companion. Every rule it carried came with it,
     * including the cover/gallery split and the posterCropY write that the
     * editor spent months not persisting.
     */
    /**
     * ⭐⭐ THE SET-TIMES ANSWER IS NOW STORED, ⛔ no longer inferred from
     * whether slot rows happen to exist (2026-08-17).
     *
     * ⚠ The editor already asks the question; this is what makes the answer
     * survive. Until an event states it, `lib/eventSetTimes` falls back to the
     * OLD derivation, so ⛔ nothing existing changes shape and ⛔ there is no
     * backfill.
     *
     * ⛔ MERGED into the config the editor produced, ⛔ never replacing it —
     * `config` also carries days, poster, venue and `set_times_locked`.
     */
    const cfg = withSetTimesEnabled(ed.toConfig(), ed.setTimesNeeded);

    if (editId) {
      /**
       * ── ⚠ MERGE ONTO THE STORED CONFIG, NEVER REPLACE IT ──────────────
       *
       * `toConfig` emits a fixed list of the keys this form owns. Writing that
       * object straight into `config` therefore DELETED every key the form does
       * not offer — `set_times_locked`, `doors`, `price`, `age`, `accessibility`,
       * `parking`, `location`, `locationWithheld`, `date_confidence` — so
       * changing a poster silently wiped an event's door time and unlocked its
       * published set times. Nothing threw, and the loss was only visible on the
       * public page afterwards.
       *
       * ⚠ READ IMMEDIATELY BEFORE THE WRITE, not at load. The organiser may have
       * published set times from the event page while this form sat open;
       * merging onto the config we loaded minutes ago would resurrect the state
       * from before that and lose the lock all over again, just more subtly.
       *
       * ⛔ A failed read ABORTS. Falling back to a bare replace here would be
       * the exact destructive write this exists to prevent, and it would happen
       * on precisely the flaky-connection save nobody is watching.
       */
      const { data: current, error: readErr } = await supabase
        .from('events').select('config').eq('id', editId).single();
      if (readErr || !current) {
        setSaving(false);
        setError('Could not read the current event to save onto it. Nothing was changed.');
        return;
      }

      const { error:err } = await supabase.from('events').update({
        name,
        config: { ...(current.config || {}), ...cfg },
        is_public:isPublic, applications_open:appsOpen, required_items:requiredItems,
        // The venue picker owns this column now, so an edit can both ATTACH a
        // link to an older event that never had one and clear it again. It is
        // a column rather than part of `cfg`, so the config merge above leaves
        // it alone either way.
        venue_profile_id: venueProfileId || null,
      }).eq('id', editId);
      setSaving(false);
      if (err) { setError(err.message); return; }
      await persistSlots(editId);
      await queueVenueRequest(editId, cfg);
      navigate(`/event/${editId}`, { replace:true });
      return;
    }

    // M14b (identity v1.3 O-R4/O-R6): an event must name its owning profile
    // at creation. venue_profile_id answers WHERE; owner_profile_id answers
    // WHO IS ACCOUNTABLE; host_id records the human. Three columns, three
    // questions — they coincide for a venue running its own night, and that
    // is a coincidence of values rather than of meaning.
    if (!ownerId) {
      setSaving(false);
      setError(owners.length > 1
        ? 'Choose which profile is hosting this event.'
        : 'You need a host or venue profile before you can create an event.');
      return;
    }

    // M14c fix · venue_profile_id is LOCATION, not ownership (v1.3 O-R4).
    //
    // It previously read `resolveProfileId(session.user.id, 'venue')` — the
    // CREATOR's own venue profile — so every event created by an account that
    // owns a venue was stamped with that venue regardless of where the gig
    // actually was. The M14c dry run found all 24 existing events pointing at
    // one venue while their config.venue named four different places.
    //
    // Linked only when the evidence supports it: the owning profile IS the
    // venue, and the typed venue name is blank or matches it. A promoter's
    // event at someone else's room resolves to NULL, which is correct and
    // honest — the venue link is optional (v1.3 O-R4: warehouses, parks,
    // house shows). Resolving it properly for those needs a venue picker,
    // which is a feature rather than a defect fix.
    // ⭐ THE PICKER IS NOW THE ANSWER, where one was given. The inference below
    // survives only as the fallback for a venue running its own night without
    // touching the control — it can no longer be the ONLY way a link gets set,
    // which is what left a promoter's event at someone else's room pointing at
    // nothing. See VenuePicker for what that cost.
    const ownerProfile = owners.find(o => o.id === ownerId) || null;
    const typed  = (venue || '').trim().toLowerCase();
    const ownNm  = (ownerProfile?.name || '').trim().toLowerCase();
    const resolvedVenueProfileId =
      venueProfileId
      || (ownerProfile?.type === 'venue' && (!typed || typed === ownNm)
        ? ownerProfile.id
        : null);

    const { data, error:err } = await supabase.from('events').insert({
      name, config:cfg, host_id:session.user.id,
      owner_profile_id: ownerId,
      status: goLive ? 'live' : 'draft',
      is_public:isPublic, applications_open:appsOpen,
      venue_profile_id: resolvedVenueProfileId,
      required_items: requiredItems,
      /**
       * ⭐⭐ THE BOOKING CONTRACT, STATED AT CREATION (ratified 2026-08-17).
       *
       * ⚠ A MANUALLY CREATED EVENT IS `managed`: artists arrive through
       * SHORTLIST, the host offers the EVENT, the artist accepts, and only then
       * are they on the lineup. ⛔ The Gig Importer writes `imported`; ⛔ every
       * event that existed on 2026-08-17 is `legacy` and is grandfathered.
       *
       * ⛔ ONLY ON INSERT. An edit must never rewrite this — changing an
       * event's contract underneath a bill that was booked under the old one is
       * the exact damage the whole model is built to avoid.
       *
       * ⚠ The column is NULLABLE with ⛔ no default, and `lib/eventProvenance`
       * reads NULL as `legacy`. So forgetting it here grandfathers an event
       * rather than downgrading somebody's bill — the safe direction.
       */
      booking_model: 'managed',
    }).select('id').single();
    setSaving(false);
    if (err) { setError(err.message); return; }

    /**
     * The buffered co-hosts, now that there is an event_id to hang them on.
     *
     * ⚠ AFTER the insert and deliberately NOT fatal. The event exists and is
     * saved; a failure here costs a line of billing, not the night's work, so
     * it must not send the organiser back to a form whose event has already
     * been created — that path ends in duplicate events. Surfaced as an error
     * on the page they land on instead of thrown away.
     */
    /**
     * ⭐⭐ THE ACT THAT CAUSED THIS EVENT JOINS IT — the half of the lifecycle
     * that was manual: ACCEPT → CREATE EVENT → (until now) go and find them
     * again in a picker.
     *
     * ⭐ SHORTLIST, ⛔ not the bill. Adding to a bill is a separate, deliberate
     * act that offers a slot and notifies a person; this only puts them where
     * the funnel expects them, exactly as the picker on the enquiry card does.
     *
     * ⚠ AFTER THE INSERT AND NON-FATAL, like the co-hosts below it. The event
     * exists and is saved — a failure here costs one row, and sending the
     * organiser back to a form whose event already exists is the path that
     * ends in duplicate events.
     *
     * ⛔ The PLANNER decides, not this screen: it refuses a profile that is not
     * a bookable act, so a `?act=` naming a venue adds nothing rather than
     * writing a nonsense member.
     */
    const actId = searchParams.get('act');
    if (data?.id && actId) {
      const { data: act } = await supabase.from('profiles')
        .select('id, user_id, name, type').eq('id', actId).maybeSingle();
      const plan = planAddArtistToShortlist(act || {}, data.id, []);
      if (plan.ok) await addArtistToShortlist(supabase, plan);
    }

    if (data?.id && coHosts.length) {
      const { error: chErr } = await supabase.from('event_hosts').insert(
        coHosts.map((p, i) => ({ event_id: data.id, profile_id: p.id, position: i })),
      );
      if (chErr) setError(`Event saved, but the co-hosts could not be added: ${chErr.message}`);
    }

    await persistSlots(data?.id);
    await queueVenueRequest(data?.id, cfg);

    // A1 · two separate facts, not one. Creating is the effort; going live is
    // the outcome, and an event saved as a draft has not been published. They
    // coincide here only when the host used "go live" on the create form —
    // a draft published later fires PUBLISHED_EVENT from EventScreen instead.
    track(EVENTS.CREATED_EVENT, { go_live: !!goLive });
    if (goLive) track(EVENTS.PUBLISHED_EVENT, { from: 'create' });

    navigate(`/event/${data.id}`, { replace:true });
  }

  /**
   * A PENDING VENUE BECOMES A REVIEWABLE REQUEST — the app half of the loop
   * Studio closes.
   *
   * ⚠ AFTER the save and deliberately NOT fatal, exactly like the co-host
   * insert above. The event is already stored and correct; the worst case here
   * is that a place does not reach the review queue, which is a missing line in
   * a moderation list rather than a lost night's work. ⛔ Never let this send
   * the organiser back to a form whose event already exists.
   *
   * The write is idempotent per event, so re-saving does not re-queue —
   * `submitVenueRequest` reads before it inserts, and the partial unique index
   * is the real guarantee behind it.
   *
   * ⛔ NOTHING HERE TOUCHES `config.venueRequest`. That flag is the organiser's
   * own record of having asked, and Studio's decision lands in
   * `venue_submissions`, never back on the event.
   */
  /**
   * THE SCHEDULE, WRITTEN TO ROWS.
   *
   * ⚠ NOT FATAL, and after the event is saved — same contract as the co-host
   * insert and the venue request below it. The event exists and is correct; a
   * failure here must never send the organiser back to a form whose event has
   * already been created, because that path ends in duplicate events.
   *
   * ⛔ SKIPPED ENTIRELY IF THE SCHEDULE COULD NOT BE READ. `saveEventSlots`
   * diffs against what it loaded, so saving a form that never received the real
   * slots would delete all of them. Doing nothing is the correct answer to "I
   * do not know what is there".
   *
   * ⚠ Removing a slot cascades its `performances` away — by design. The act is
   * NOT dropped from the event: `lineup_members` is untouched, so they return
   * to the Lineup with no set time, which is where the LINEUP surface shows
   * them. That is the ratified model, not a silent loss.
   */
  /**
   * ⭐⭐ STAGES — the database half. The editor holds the SHAPE of a multi-stage
   * running order; ⛔ it must never learn where stages live, so the reading, the
   * creating and the removing are all here.
   *
   * ⛔⛔ A STAGE EXISTS THE MOMENT IT IS ADDED, not when the form is saved. It
   * has to: `event_slots.stage_id` is a foreign key, so a slot cannot point at a
   * stage that has no row yet, and the FIRST stage adopts the event's existing
   * slots inside the RPC's transaction. That means stages are only offered on an
   * event that has already been created once — there is no event id to hang
   * them on before that, and inventing a local one would put the adoption on the
   * wrong side of the save.
   */
  async function refreshStages(id = editId) {
    if (!id) return;
    try { setStages(await loadEventStages(supabase, id)); }
    catch (e) { setError(`Could not load this event's stages: ${e.message}`); }
  }

  async function handleCreateStage() {
    if (!editId) {
      setError('Save the event first, then you can add a second stage to it.');
      return null;
    }
    try {
      const created = await createEventStage(
        supabase, editId, nextStageName(stages), nextStageAccent(stages));
      await refreshStages();
      /* ⭐ The FIRST stage adopted every existing slot inside the RPC, so the
         form's copy of those slots is now stale — it still thinks they have no
         stage, and saving would write NULL straight back over the adoption.
         Stamp them here rather than re-reading the whole running order. */
      if (stages.length === 0 && created?.id) {
        ed.setDays(ds => ds.map(d => ({
          ...d, slots: (d.slots || []).map(sl => ({ ...sl, stageId: sl.stageId || created.id })),
        })));
      }
      return created;
    } catch (e) {
      setError(`Could not add that stage: ${e.message}`);
      return null;
    }
  }

  async function handleRenameStage(stageId, name) {
    // Optimistic: the input must stay responsive while typing.
    setStages(p => p.map(st => (st.id === stageId ? { ...st, name } : st)));
    try { await renameEventStage(supabase, stageId, name); }
    catch (e) { setError(`Could not rename that stage: ${e.message}`); refreshStages(); }
  }

  async function handleDeleteStage(stageId) {
    /* ⛔ REFUSED WHILE IT HOLDS SLOTS. Checked against the FORM's slots, not the
       database's, so a slot the organiser has just dragged onto this stage
       counts even though it is not saved yet. The database refuses too
       (ON DELETE RESTRICT); this is the half that can explain why. */
    const held = (ed.days || []).flatMap(d => d.slots || []).filter(sl => sl.stageId === stageId);
    if (held.length) {
      setError(`That stage still has ${held.length} slot${held.length === 1 ? '' : 's'}. Move or remove them first.`);
      return;
    }
    try { await deleteEventStage(supabase, stageId, []); await refreshStages(); }
    catch (e) { setError(`Could not remove that stage: ${e.message}`); }
  }

  async function persistSlots(eventId) {
    if (!eventId || slotLoadError) return;
    try {
      await saveEventSlots(supabase, eventId, ed.days, { setTimesNeeded: ed.setTimesNeeded });
    } catch (e) {
      setError(`The event was saved, but its running order was not: ${e.message}`);
    }
  }

  async function queueVenueRequest(eventId, cfg) {
    const venue = venueRequestFromConfig(cfg);
    if (!eventId || !venue || !session?.user?.id) return;
    try {
      await submitVenueRequest({ eventId, userId: session.user.id, venue });
    } catch (_) {
      // Swallowed on purpose: see the contract above. A thrown error here would
      // abort the navigate and strand the organiser on a stale form.
    }
  }

  /**
   * ⛔⛔ DELETING AN EVENT REPORTED SUCCESS WHILE DELETING NOTHING.
   *
   * ⚠⚠ RLS **FILTERS** A DELETE RATHER THAN ERRORING IT. The old body was
   * `await …delete().eq('id', editId); navigate(-1);` — no error check, and
   * there would have been no error to check: a blocked delete returns `null`
   * error and zero rows. The screen navigated back and the event was still
   * there, which reads as "the button does nothing".
   *
   * ⭐⭐ `.select('id')` IS THE PROOF. PostgREST returns the rows it actually
   * removed, so an EMPTY array is the difference between "deleted" and
   * "silently refused". ⛔ A null error is NOT proof the row is gone — that
   * assumption is the one this codebase keeps paying for.
   *
   * ⚠⚠ AND IT IS BLOCKED TODAY FOR ALMOST EVERY EVENT. The only write policy
   * on `events` is the baseline's `hosts manage own events` USING
   * `(host_id = auth.uid())`, and `host_id` is NULL on 82 of 92 rows. L1 fixed
   * exactly this on `lineup_members`/`performances` with
   * `can_act_as(owner_profile_id)` and did not reach the `events` table
   * itself. ⛔ THE CLIENT HALF ALONE DOES NOT MAKE DELETE WORK — it only makes
   * the failure visible. The migration is the other half.
   */
  async function handleDelete() {
    if (!editId || !window.confirm('Delete this event? This cannot be undone.')) return;
    setError('');
    const { data, error: delErr } = await supabase
      .from('events').delete().eq('id', editId).select('id');
    if (delErr) { setError(`That event could not be deleted. ${delErr.message}`); return; }
    if (!data?.length) {
      setError('That event could not be deleted. You may not have permission to remove it, and nothing was changed.');
      return;
    }
    navigate(-1);
  }

  return (
    <div className={s.screen}>
      <div className={s.content}>
        <h1 className={s.pageTitle}>{editId ? "EDIT EVENT" : "SET UP YOUR EVENT"}</h1>
        {!editId && <p className={s.pageSubtitle}>Fill in the details, generate or build slots manually, then go live</p>}

        {/* ⭐⭐ THE SHARED EDITOR. Every application that edits an event renders
            this exact component. What is left in this file is the plumbing a
            screen owns and a component must not: the route, the session, the
            load, the save, the delete — and the actions below, because what
            "publishing" means is this application's decision, not the
            editor's. */}
        <EventEditorForm
          ed={ed}
          editId={editId}
          userId={session?.user?.id}
          /* ⭐⭐ STAGES. The editor holds the shape; Scene owns the rows. ⛔ An
             event with none of these is single-stage and shows no stage chrome
             at all, which is every event until somebody adds one. */
          stages={stages}
          onCreateStage={handleCreateStage}
          onRenameStage={handleRenameStage}
          onDeleteStage={handleDeleteStage}
          actions={
            <>
              {/* ⚠ An unreadable running order, said out loud. The schedule
                  above is empty because it is UNKNOWN, not because it is gone —
                  and saving deliberately leaves the stored slots untouched
                  rather than writing this blank over them. */}
              {slotLoadError && <p className={s.error}>{slotLoadError}</p>}
              {error && <p className={s.error}>{error}</p>}

              <button className={s.goLiveBtn} onClick={() => handleSave(true)} disabled={saving}>
                {saving ? 'SAVING…' : 'GO LIVE →'}
              </button>

              {!editId && (
                <button className={s.saveDraftBtn} onClick={() => handleSave(false)} disabled={saving}>
                  SAVE AS DRAFT
                </button>
              )}

              {editId && (
                <button className={s.deleteBtn} onClick={handleDelete}>
                  🗑 Delete Event
                </button>
              )}
            </>
          }
        />
      </div>

      {venueCheckOpen && (
        <VenueCheckSheet
          typedName={venue}
          town={ed.venueTown}
          candidates={venueCandidates}
          busy={saving}
          /* Picked an existing room: link it and carry straight on to publish,
             so answering the question IS the click they already made. */
          onPick={v => {
            setVenueProfileId(v.id);
            setVenue(v.name);
            if (v.suburb) setVenueTown(v.suburb, { state: v.state || '', postcode: v.postcode || '' });
            setVenueCheckOpen(false);
            handleSave(true, { venueChecked: true });
          }}
          /* ⚠ "None of these" PUBLISHES — it does not block. The check exists to
             catch a room that is already here under a name they did not guess;
             a genuinely new venue is a normal thing to have, and refusing to
             publish it would punish the honest answer. The event keeps the
             typed name with no venue link, exactly as before this sheet
             existed. Routing new venues to Studio for review is the next step
             and needs its own table — see the handover. */
          onNoneOfThese={() => { setVenueCheckOpen(false); handleSave(true, { venueChecked: true }); }}
          onCancel={() => setVenueCheckOpen(false)}
        />
      )}
    </div>
  );
}
