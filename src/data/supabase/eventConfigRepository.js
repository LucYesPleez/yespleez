import { supabase } from './client';

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
export const eventConfigRepository = {
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
