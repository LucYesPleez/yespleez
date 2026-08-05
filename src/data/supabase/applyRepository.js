import { supabase } from './client';
import { CATEGORIES } from '../../config/categories';

/**
 * THE PUBLIC APPLY SURFACE.
 *
 * Separate from the organiser repositories on purpose: those resolve "which
 * festival do I run" from the signed-in owner, and an applicant runs no
 * festival. Everything here is keyed by the event id in the URL.
 *
 * ⭐ THE PROFILE IS THE APPLICATION. Applying links an existing profile to a
 * category. Nothing re-asks what the profile already says, and the organiser
 * reviews the profile itself.
 */
export const applyRepository = {
  /** The event behind a public apply link. Readable signed out. */
  async getEvent(eventId) {
    const { data, error } = await supabase
      .from('events')
      .select('id, name, applications_open, owner_profile_id, profiles!events_owner_profile_id_fkey ( name )')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      applicationsOpen: Boolean(data.applications_open),
      festivalName: data.profiles?.name ?? null,
    };
  },

  /**
   * The categories this event is actually taking, merged with the registry.
   *
   * A category whose `appliesAs` is empty is still RETURNED, not hidden: the
   * page says who may apply, and silently dropping Market Stalls would look
   * like the festival forgot it rather than that it is not open to anyone yet.
   */
  async listOpenCategories(eventId) {
    const { data, error } = await supabase
      .from('festival_categories')
      .select('id, key, state, closes_at, intent')
      .eq('event_id', eventId)
      .eq('state', 'open');
    if (error) throw error;

    const open = new Map((data ?? []).map(r => [r.key, r]));
    return CATEGORIES
      .filter(c => open.has(c.key))
      .map(c => ({
        key: c.key,
        label: c.label,
        icon: c.icon,
        noun: c.noun,
        intent: c.intent,
        appliesAs: c.appliesAs ?? [],
        asksAvailability: Boolean(c.asksAvailability),
        asksDepartments: Boolean(c.asksDepartments),
        closesAt: open.get(c.key).closes_at ?? null,
      }));
  },

  /**
   * The organiser's configuration, read publicly.
   *
   * ⭐ The apply page renders ENTIRELY from this. Nothing about Deliverance's
   * departments or dates exists in the code — they are the first real data
   * entered through the editor, and the next festival needs no code change.
   */
  async getEventConfig(eventId) {
    const [settingsRes, deptRes] = await Promise.all([
      supabase
        .from('festival_event_settings')
        .select('build_starts_on, build_ends_on, starts_on, ends_on, packdown_starts_on, packdown_ends_on')
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('festival_departments')
        .select('id, name, description')
        .eq('event_id', eventId)
        // ⛔ Archived departments are never offered to an applicant. They exist
        // so last year's records still name something real.
        .eq('archived', false)
        .order('sort_order'),
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (deptRes.error) throw deptRes.error;

    const d = settingsRes.data;
    return {
      settings: {
        buildStartsOn: d?.build_starts_on ?? '',
        buildEndsOn: d?.build_ends_on ?? '',
        startsOn: d?.starts_on ?? '',
        endsOn: d?.ends_on ?? '',
        packdownStartsOn: d?.packdown_starts_on ?? '',
        packdownEndsOn: d?.packdown_ends_on ?? '',
      },
      departments: deptRes.data ?? [],
    };
  },

  /** Every profile the signed-in user owns. The set they can apply as. */
  async listMyProfiles() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('id, type, name')
      .eq('user_id', user.id);
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Apply.
   *
   * ⚠ There is no "have I already applied?" query, and that is deliberate:
   * applicants have NO read on festival_applications, because RLS cannot hide
   * a column and a readable row would expose `status` and `decided_at` before
   * the organiser releases them. Hold-and-release is enforced at the database,
   * not in the UI.
   *
   * So a duplicate is detected by letting the unique index reject it. 23505 is
   * the applicant applying twice — an ordinary outcome to report plainly, not
   * an error to throw.
   */
  async apply({ eventId, categoryKey, profileId, answers = {} }) {
    const { error } = await supabase
      .from('festival_applications')
      .insert({
        event_id: eventId,
        category_key: categoryKey,
        from_profile_id: profileId,
        status: 'submitted',
        answers,
      });
    if (error) {
      if (error.code === '23505') return { ok: false, reason: 'already_applied' };
      throw error;
    }
    return { ok: true };
  },
};
