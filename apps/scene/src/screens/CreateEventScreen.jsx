import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../App";
import s from "@yespleez/event-editor/styles.module.css";
import { getOwnerProfiles } from "../lib/actingProfile";
import { track, EVENTS } from "../lib/analytics";
import { useEventEditorState } from "@yespleez/event-editor";
import EventEditorForm from "./event/SceneEventEditor";
import { uploadPosterCrop } from "../lib/uploadImage";

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

  /**
   * ⭐⭐ ALL FORM STATE LIVES IN THE SHARED HOOK, so Festival Companion renders
   * the identical editor rather than growing a second one.
   */
  const ed = useEventEditorState({ userId: session?.user?.id, uploadPosterCrop });

  // Only what the plumbing below reads. Everything else is the form’s.
  const {
    name, venue, owners, ownerId, coHosts, requiredItems, isPublic, appsOpen,
    setOwners, setOwnerId, setCoHosts,
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
    supabase.from('events').select('*').eq('id', editId).single().then(({ data }) => {
      if (!data) return;
      ed.hydrate(data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);


  async function handleSave(goLive) {
    if (!name.trim()) { setError('Event name is required.'); return; }
    if (!session)     { setError('You must be signed in.'); return; }
    setSaving(true); setError('');

    /**
     * ⭐ The form → config mapping moved to `eventEditorModel.toConfig`, the
     * mirror of `fromConfig` used by the load above. One writer of the blob,
     * shared with Festival Companion. Every rule it carried came with it,
     * including the cover/gallery split and the posterCropY write that the
     * editor spent months not persisting.
     */
    const cfg = ed.toConfig();

    if (editId) {
      const { error:err } = await supabase.from('events').update({ name, config:cfg, is_public:isPublic, applications_open:appsOpen, required_items:requiredItems }).eq('id', editId);
      setSaving(false);
      if (err) { setError(err.message); return; }
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
    const ownerProfile = owners.find(o => o.id === ownerId) || null;
    const typed  = (venue || '').trim().toLowerCase();
    const ownNm  = (ownerProfile?.name || '').trim().toLowerCase();
    const venueProfileId =
      ownerProfile?.type === 'venue' && (!typed || typed === ownNm)
        ? ownerProfile.id
        : null;

    const { data, error:err } = await supabase.from('events').insert({
      name, config:cfg, host_id:session.user.id,
      owner_profile_id: ownerId,
      status: goLive ? 'live' : 'draft',
      is_public:isPublic, applications_open:appsOpen,
      venue_profile_id: venueProfileId,
      required_items: requiredItems,
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
    if (data?.id && coHosts.length) {
      const { error: chErr } = await supabase.from('event_hosts').insert(
        coHosts.map((p, i) => ({ event_id: data.id, profile_id: p.id, position: i })),
      );
      if (chErr) setError(`Event saved, but the co-hosts could not be added: ${chErr.message}`);
    }

    // A1 · two separate facts, not one. Creating is the effort; going live is
    // the outcome, and an event saved as a draft has not been published. They
    // coincide here only when the host used "go live" on the create form —
    // a draft published later fires PUBLISHED_EVENT from EventScreen instead.
    track(EVENTS.CREATED_EVENT, { go_live: !!goLive });
    if (goLive) track(EVENTS.PUBLISHED_EVENT, { from: 'create' });

    navigate(`/event/${data.id}`, { replace:true });
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this event? This cannot be undone.')) return;
    await supabase.from('events').delete().eq('id', editId);
    navigate(-1);
  }

  return (
    <div className={s.screen}>
      <div className={s.content}>
        <h1 className={s.pageTitle}>{editId ? "EDIT EVENT" : "SET UP YOUR EVENT"}</h1>
        {!editId && <p className={s.pageSubtitle}>Fill in the details, generate or build slots manually, then go live</p>}

        {/* ⭐⭐ THE SHARED EDITOR. Festival Companion renders this exact
            component in its Event room. What is left in this file is the
            plumbing a screen owns and a component must not: the route, the
            session, the load, the save, the delete. */}
        <EventEditorForm
          ed={ed}
          editId={editId}
          saving={saving}
          error={error}
          session={session}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
