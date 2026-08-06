import { supabase } from './client';
import {
  getFestivalContext, resetEventCache, getSelectedEventId, setSelectedEventId,
} from './currentEvent';
import { CATEGORIES } from '../../config/categories';

/**
 * EVENT APPLICATION CONFIGURATION — the organiser's half of an application.
 *
 * ⭐ An application is assembled from three inputs: the applicant's PROFILE,
 * this EVENT CONFIGURATION, and the platform's HISTORY of them. This module
 * owns the middle one — dates, departments, and which categories are open.
 *
 * ⛔ NOTHING HERE MAY BE HARDCODED. A department list is 16 items at one
 * festival and 30+ at another, and a beach festival's reads Boat Crew / Beach
 * Patrol / Shuttle Drivers. The public page renders whatever the organiser
 * created, so opening applications never requires a code change again.
 *
 * ⚠ Dates live in their own table rather than on `events`. `events.config` is
 * the Scene app's blob and nothing outside its eventViewModel may interpret it;
 * adding columns to a shared table for one portal's needs is the other way to
 * get this wrong.
 */
/** The twelve categories a new event starts with — all CLOSED. */
const SEED_CATEGORIES = CATEGORIES.map(c => ({
  key: c.key,
  state: 'closed',
  decision_mode: c.key === 'volunteer' ? 'immediate' : 'hold',
  intent: c.intent ?? 'open_call',
}));

export const eventConfigRepository = {
  /**
   * Every event this festival has run, newest first.
   *
   * ⭐ Events BELONG TO the festival profile — the organisation outlives any
   * one year of it. Archived rows are returned and flagged rather than hidden:
   * last year's event is how this year's gets duplicated.
   */
  async listEvents() {
    const { profile } = await getFestivalContext();
    if (!profile) return [];
    const { data, error } = await supabase
      .from('events')
      .select('id, name, status, is_public, applications_open, created_at, festival_event_settings ( starts_on, ends_on, archived )')
      .eq('owner_profile_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(e => {
      const cfg = Array.isArray(e.festival_event_settings)
        ? e.festival_event_settings[0]
        : e.festival_event_settings;
      return {
        id: e.id,
        name: e.name,
        status: e.status,
        isPublic: Boolean(e.is_public),
        applicationsOpen: Boolean(e.applications_open),
        startsOn: cfg?.starts_on ?? null,
        endsOn: cfg?.ends_on ?? null,
        archived: Boolean(cfg?.archived),
      };
    });
  },

  /**
   * Create an event and associate it with the current festival profile.
   *
   * ⭐ Seeds all twelve categories CLOSED. An event that opens itself the
   * moment it exists can take applications the organiser has not finished
   * configuring — and nothing here is reversible for whoever already applied.
   *
   * ⛔ No default departments. A helpful seed is how a hardcoded list creeps
   * back in; duplicating last year's event is the way to reuse them.
   */
  async createEvent({ name, isPublic = false, applicationsOpen = false, dates = {} }) {
    const { profile } = await getFestivalContext();
    if (!profile) throw new Error('Create your festival profile first.');
    const { data: { user } } = await supabase.auth.getUser();

    const { data: created, error } = await supabase
      .from('events')
      .insert({
        host_id: user?.id ?? null,
        owner_profile_id: profile.id,
        name,
        status: isPublic ? 'live' : 'draft',
        is_public: isPublic,
        applications_open: applicationsOpen,
      })
      .select('id')
      .single();
    if (error) throw error;

    await this.saveSettings(created.id, dates);
    const { error: catErr } = await supabase
      .from('festival_categories')
      .insert(SEED_CATEGORIES.map(c => ({ ...c, event_id: created.id })));
    if (catErr) throw catErr;

    resetEventCache();
    return created.id;
  },

  /**
   * Copy an event: its settings, its categories AND its departments.
   *
   * ⭐ This is what makes "a new festival every year without SQL" true. Last
   * year's departments and category setup are the bulk of the configuration,
   * and retyping thirty departments is where an organiser gives up.
   */
  async duplicateEvent(sourceId, name) {
    const [settings, departments, categories] = await Promise.all([
      this.getSettings(sourceId),
      this.listDepartments(sourceId, { includeArchived: false }),
      this.listCategories(sourceId),
    ]);

    // Dates are deliberately NOT copied: last year's dates on this year's
    // event is a wrong answer that looks like a filled-in one.
    const newId = await this.createEvent({ name, dates: {} });

    if (categories.length) {
      await Promise.all(categories.map(c =>
        supabase.from('festival_categories')
          .update({ state: c.state })
          .eq('event_id', newId)
          .eq('key', c.key)));
    }
    if (departments.length) {
      const { error } = await supabase.from('festival_departments').insert(
        departments.map((d, i) => ({
          event_id: newId, name: d.name, description: d.description, sort_order: i,
        })));
      if (error) throw error;
    }
    void settings;
    return newId;
  },

  /** Public/draft and applications open/closed — the two switches that matter. */
  async setEventFlags(eventId, { isPublic, applicationsOpen }) {
    const patch = {};
    if (isPublic !== undefined) {
      patch.is_public = isPublic;
      // Scene lists on status as well as the flag; keeping them in step here
      // stops an event that says "public" from being invisible.
      patch.status = isPublic ? 'live' : 'draft';
    }
    if (applicationsOpen !== undefined) patch.applications_open = applicationsOpen;
    const { data, error } = await supabase
      .from('events').update(patch).eq('id', eventId).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Not saved: this account is not permitted to edit the event.');
    resetEventCache();
  },

  /**
   * ⛔ Archive is a PORTAL flag, not an event status. `events.status` only ever
   * holds 'draft' or 'live' in production and its CHECK constraint is not
   * visible from here — an invented value would be rejected and read as a save
   * that silently did nothing.
   */
  async setArchived(eventId, archived) {
    const { error } = await supabase
      .from('festival_event_settings')
      .upsert({ event_id: eventId, archived, updated_at: new Date().toISOString() },
        { onConflict: 'event_id' });
    if (error) throw error;
    resetEventCache();
  },

  /**
   * ⚠ Deletes the event and everything hanging off it — categories, settings,
   * departments and every APPLICATION — via ON DELETE CASCADE. Irreversible,
   * and the reason the caller must confirm by typing the name.
   */
  async deleteEvent(eventId) {
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) throw error;
    resetEventCache();
  },

  /**
   * The selected event is the Portal's context. Exposed through the repository
   * rather than imported from the module directly, so the rule that only
   * DataProvider knows where data comes from still holds.
   */
  getSelectedEventId() {
    return getSelectedEventId();
  },

  selectEvent(eventId) {
    setSelectedEventId(eventId);
  },

  async getEvent(eventId) {
    const { data, error } = await supabase
      .from('events')
      .select('id, name')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  /**
   * ⚠ Writes `events` — the SHARED table, governed by the Scene app's policies
   * rather than `owns_festival_event`. Same guard as the profile editor:
   * an UPDATE no policy permits succeeds having matched nothing, so the row
   * count is the evidence, not the absence of an error.
   */
  async setEventName(eventId, name) {
    const { data, error } = await supabase
      .from('events')
      .update({ name })
      .eq('id', eventId)
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      throw new Error('Not saved: this account is not permitted to rename the event.');
    }
  },

  async getSettings(eventId) {
    const { data, error } = await supabase
      .from('festival_event_settings')
      .select('event_id, build_starts_on, build_ends_on, starts_on, ends_on, packdown_starts_on, packdown_ends_on')
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw error;
    // Absent, not empty: a festival that has set no dates yet is a real state,
    // and the editor must show blank fields rather than refusing to render.
    return {
      buildStartsOn: data?.build_starts_on ?? '',
      buildEndsOn: data?.build_ends_on ?? '',
      startsOn: data?.starts_on ?? '',
      endsOn: data?.ends_on ?? '',
      packdownStartsOn: data?.packdown_starts_on ?? '',
      packdownEndsOn: data?.packdown_ends_on ?? '',
    };
  },

  async saveSettings(eventId, v) {
    const { error } = await supabase
      .from('festival_event_settings')
      .upsert({
        event_id: eventId,
        build_starts_on: v.buildStartsOn || null,
        build_ends_on: v.buildEndsOn || null,
        starts_on: v.startsOn || null,
        ends_on: v.endsOn || null,
        packdown_starts_on: v.packdownStartsOn || null,
        packdown_ends_on: v.packdownEndsOn || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'event_id' });
    if (error) throw error;
  },

  /**
   * @param {boolean} includeArchived  the editor needs archived rows, the
   *   public page must never see them.
   */
  async listDepartments(eventId, { includeArchived = false } = {}) {
    let q = supabase
      .from('festival_departments')
      .select('id, name, description, sort_order, archived')
      .eq('event_id', eventId)
      .order('sort_order');
    if (!includeArchived) q = q.eq('archived', false);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async createDepartment(eventId, name) {
    // Appended, never inserted at the top: a new department landing above the
    // ones already there silently reorders a list the organiser arranged.
    const existing = await this.listDepartments(eventId, { includeArchived: true });
    const nextOrder = existing.reduce((n, d) => Math.max(n, d.sort_order), -1) + 1;
    const { error } = await supabase
      .from('festival_departments')
      .insert({ event_id: eventId, name, sort_order: nextOrder });
    if (error) throw error;
  },

  async updateDepartment(id, patch) {
    const { error } = await supabase
      .from('festival_departments')
      .update(patch)
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * ⛔ ARCHIVE, NEVER DELETE. Applications already reference a department by
   * name; removing the row would leave last year's volunteers assigned to
   * something that no longer exists. Archiving hides it from applicants and
   * keeps the record honest.
   */
  async archiveDepartment(id, archived = true) {
    return this.updateDepartment(id, { archived });
  },

  /** Swap two departments' sort_order. Reordering is the whole point of it. */
  async moveDepartment(eventId, id, direction) {
    const all = await this.listDepartments(eventId, { includeArchived: true });
    const i = all.findIndex(d => d.id === id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= all.length) return;
    await Promise.all([
      this.updateDepartment(all[i].id, { sort_order: all[j].sort_order }),
      this.updateDepartment(all[j].id, { sort_order: all[i].sort_order }),
    ]);
  },

  /** Every category on this event, open or not — the editor toggles these. */
  async listCategories(eventId) {
    const { data, error } = await supabase
      .from('festival_categories')
      .select('id, key, state')
      .eq('event_id', eventId);
    if (error) throw error;
    return data ?? [];
  },

  async setCategoryState(id, state) {
    const { error } = await supabase
      .from('festival_categories')
      .update({ state })
      .eq('id', id);
    if (error) throw error;
  },
};
