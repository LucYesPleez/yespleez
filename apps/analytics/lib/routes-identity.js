/**
 * IDENTITY ROUTES — people, teams, links, the derived device map.
 * ---------------------------------------------------------------------------
 * Routes fetch and serve; the decisions live in lib/identity.js. Two
 * standing rules from the phase plan are enforced here:
 *
 * ⭐ THE LEGACY MIRROR (transitional, dies in Phase F): Studio's weekly
 * snapshots still read public.analytics_account_segments, so every
 * segment write here is mirrored to that table. One writer, two
 * destinations, one planned death — mirrorLegacy() is the only code
 * that touches the legacy table, so retiring it is one deletion.
 *
 * ⛔ 'public' IS ABSENCE: classifying someone public DELETES their row
 * (both tables). The CHECK constraint enforces it; the route honours
 * it rather than fighting it.
 */

import { deriveDeviceSegments, missingLinks, segmentRowForNewMember, STORABLE_SEGMENTS, SEGMENTS } from './identity.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mountIdentityRoutes(app, db) {

  /** Read every account segment as a {user_id: segment} map. */
  async function userSegmentMap() {
    const { rows } = await db.readAll('account_segments?select=user_id,segment&order=user_id.asc');
    const map = {};
    rows.forEach((r) => { map[r.user_id] = r.segment; });
    return map;
  }

  /** Mirror one classification change into the legacy public table. */
  async function mirrorLegacy(userId, segment, note) {
    try {
      if (segment === SEGMENTS.PUBLIC) {
        await db.write('analytics_account_segments?user_id=eq.' + userId,
          { method: 'DELETE', schema: 'public', prefer: 'return=minimal' });
      } else {
        await db.write('analytics_account_segments?on_conflict=user_id', {
          method: 'POST', schema: 'public',
          body: { user_id: userId, segment, note: note ?? null, updated_at: new Date().toISOString() },
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
      return { mirrored: true };
    } catch (e) {
      // The canonical write already succeeded; a mirror failure is a
      // REPORTED divergence, never a silent one — Studio's snapshots
      // would quietly disagree otherwise.
      return { mirrored: false, mirrorError: e.message };
    }
  }

  // ── PEOPLE ────────────────────────────────────────────────────────

  /**
   * Every account the raw record has ever seen, with its segment, its
   * provenance, its teams, and enough shape to identify it by eye.
   * Like Studio's device index: computed from EVERYTHING, before any
   * population filter — this list is the registry's UI and must show
   * what exists, not what is currently being counted.
   */
  app.get('/api/people', async (req, res) => {
    try {
      const [events, segs, members, teams] = await Promise.all([
        db.readAll('usage_events?select=user_id,device_id,created_at&user_id=not.is.null&order=id.asc', { schema: 'public' }),
        db.readAll('account_segments?select=user_id,segment,source,note,updated_at&order=user_id.asc'),
        db.readAll('team_members?select=team_id,user_id,role,removed_at&order=user_id.asc'),
        db.readAll('teams?select=id,name,default_segment&order=name.asc'),
      ]);
      const teamName = new Map(teams.rows.map((t) => [t.id, t.name]));
      const segByUser = new Map(segs.rows.map((s) => [s.user_id, s]));
      const byUser = new Map();
      for (const r of events.rows) {
        let u = byUser.get(r.user_id);
        if (!u) {
          u = { user_id: r.user_id, events: 0, devices: new Set(), firstSeen: r.created_at, lastSeen: r.created_at };
          byUser.set(r.user_id, u);
        }
        u.events++;
        u.devices.add(r.device_id);
        if (r.created_at < u.firstSeen) u.firstSeen = r.created_at;
        if (r.created_at > u.lastSeen) u.lastSeen = r.created_at;
      }
      // A classified account with no events yet still exists.
      for (const s of segs.rows) {
        if (!byUser.has(s.user_id)) {
          byUser.set(s.user_id, { user_id: s.user_id, events: 0, devices: new Set(), firstSeen: null, lastSeen: null });
        }
      }
      const people = [...byUser.values()].map((u) => {
        const s = segByUser.get(u.user_id);
        return {
          user_id: u.user_id,
          segment: s?.segment ?? SEGMENTS.PUBLIC,
          source: s?.source ?? null,
          note: s?.note ?? null,
          teams: members.rows
            .filter((m) => m.user_id === u.user_id && !m.removed_at)
            .map((m) => ({ team_id: m.team_id, name: teamName.get(m.team_id) ?? null, role: m.role })),
          events: u.events,
          devices: u.devices.size,
          first_seen: u.firstSeen,
          last_seen: u.lastSeen,
        };
      }).sort((a, b) => b.events - a.events || a.user_id.localeCompare(b.user_id));
      res.json({ people, rawComplete: events.complete });
    } catch (e) {
      console.error('[analytics] ' + e.message);
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * Classify one account. THE writer defect D5 said was missing.
   * segment 'public' deletes the row — absence is the default, stored
   * as absence. Everything else upserts with source 'direct'.
   */
  app.put('/api/people/:userId/segment', async (req, res) => {
    const userId = String(req.params.userId || '');
    const { segment, note } = req.body ?? {};
    if (!UUID_RE.test(userId)) return res.status(400).json({ error: 'userId must be a uuid.' });
    if (segment !== SEGMENTS.PUBLIC && !STORABLE_SEGMENTS.includes(segment)) {
      return res.status(400).json({ error: "segment must be one of: public, internal, beta, test." });
    }
    try {
      if (segment === SEGMENTS.PUBLIC) {
        await db.write('account_segments?user_id=eq.' + userId, { method: 'DELETE', prefer: 'return=minimal' });
      } else {
        await db.write('account_segments?on_conflict=user_id', {
          method: 'POST',
          body: { user_id: userId, segment, source: 'direct', note: note ?? null, updated_at: new Date().toISOString() },
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
      const mirror = await mirrorLegacy(userId, segment, note);
      res.json({ user_id: userId, segment, source: segment === SEGMENTS.PUBLIC ? null : 'direct', ...mirror });
    } catch (e) {
      console.error('[analytics] ' + e.message);
      res.status(502).json({ error: e.message });
    }
  });

  // ── TEAMS ─────────────────────────────────────────────────────────

  app.get('/api/teams', async (req, res) => {
    try {
      const [teams, members] = await Promise.all([
        db.readAll('teams?select=id,name,description,default_segment,created_at&order=name.asc'),
        db.readAll('team_members?select=team_id,user_id,role,added_at,removed_at&order=added_at.asc'),
      ]);
      res.json({
        teams: teams.rows.map((t) => ({
          ...t,
          members: members.rows.filter((m) => m.team_id === t.id && !m.removed_at),
          former: members.rows.filter((m) => m.team_id === t.id && m.removed_at).length,
        })),
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post('/api/teams', async (req, res) => {
    const { name, description, default_segment } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required.' });
    if (default_segment != null && !STORABLE_SEGMENTS.includes(default_segment)) {
      return res.status(400).json({ error: "default_segment must be internal, beta, test, or omitted (= public)." });
    }
    try {
      const rows = await db.write('teams', {
        body: { name, description: description ?? null, default_segment: default_segment ?? null },
      });
      res.status(201).json({ team: rows[0] ?? null });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * Add a member. If the team carries a default segment and the account
   * is unclassified, the default is MATERIALISED as an explicit row —
   * at add time, in code, never at read time. A 'direct' row is never
   * touched: lib/identity.js decides, this route obeys.
   */
  app.post('/api/teams/:teamId/members', async (req, res) => {
    const teamId = String(req.params.teamId || '');
    const { user_id, role } = req.body ?? {};
    if (!UUID_RE.test(teamId) || !UUID_RE.test(String(user_id || ''))) {
      return res.status(400).json({ error: 'teamId and user_id must be uuids.' });
    }
    try {
      const team = (await db.read('teams?select=id,name,default_segment&id=eq.' + teamId)).rows[0];
      if (!team) return res.status(404).json({ error: 'No such team.' });
      await db.write('team_members?on_conflict=team_id,user_id', {
        body: { team_id: teamId, user_id, role: role ?? null, removed_at: null },
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      const existing = (await db.read('account_segments?select=segment&user_id=eq.' + user_id)).rows[0];
      const rowToAdd = segmentRowForNewMember({ team, userId: user_id, existingSegment: existing?.segment ?? null });
      let materialised = null;
      if (rowToAdd) {
        await db.write('account_segments', { body: rowToAdd, prefer: 'return=minimal' });
        await mirrorLegacy(user_id, rowToAdd.segment, rowToAdd.note);
        materialised = rowToAdd.segment;
      }
      res.status(201).json({ team_id: teamId, user_id, materialised_segment: materialised });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /** Soft removal — history is evidence; classification is untouched. */
  app.delete('/api/teams/:teamId/members/:userId', async (req, res) => {
    const { teamId, userId } = req.params;
    if (!UUID_RE.test(teamId) || !UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'teamId and userId must be uuids.' });
    }
    try {
      await db.write('team_members?team_id=eq.' + teamId + '&user_id=eq.' + userId, {
        method: 'PATCH',
        body: { removed_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });
      res.json({ team_id: teamId, user_id: userId, removed: true, note: 'Membership ended; classification unchanged — reclassify explicitly if intended.' });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // ── IDENTITY LINKS & THE DERIVED DEVICE MAP ──────────────────────

  app.get('/api/identity/links', async (req, res) => {
    try {
      const { rows, total, complete } = await db.readAll('identity_links?select=device_id,user_id,linked_at,method&order=id.asc');
      res.json({ links: rows, total, complete });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * The derived internal-device map — the approved rule's output, made
   * inspectable. The approval's stated cost was "a wrong entry must be
   * findable": this is where it is found, each device with the internal
   * accounts that made it internal.
   */
  app.get('/api/identity/devices', async (req, res) => {
    try {
      const [links, segments] = await Promise.all([
        db.readAll('identity_links?select=device_id,user_id,linked_at,method&order=id.asc'),
        userSegmentMap(),
      ]);
      const derived = deriveDeviceSegments(links.rows, segments);
      const devices = Object.keys(derived).map((deviceId) => ({
        device_id: deviceId,
        segment: derived[deviceId],
        via: links.rows
          .filter((l) => l.device_id === deviceId && segments[l.user_id] === SEGMENTS.INTERNAL)
          .map((l) => ({ user_id: l.user_id, linked_at: l.linked_at, method: l.method })),
      }));
      res.json({
        internal_devices: devices.length,
        devices,
        rule: 'anonymous events on these devices classify internal; attributed events always classify by their own account',
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * The observed-link sweep: witnessed pairs not yet linked become
   * 'observed' links, stamped with their first co-occurrence.
   * Idempotent by arithmetic (missingLinks) AND by constraint
   * (unique + merge-duplicates) — run it twice, get zero the second time.
   */
  app.post('/api/identity/sweep', async (req, res) => {
    try {
      const [events, links] = await Promise.all([
        db.readAll('usage_events?select=device_id,user_id,created_at&user_id=not.is.null&order=id.asc', { schema: 'public' }),
        db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
      ]);
      const firstSeen = new Map();
      for (const r of events.rows) {
        const k = r.device_id + '|' + r.user_id;
        if (!firstSeen.has(k) || r.created_at < firstSeen.get(k).first_seen) {
          firstSeen.set(k, { device_id: r.device_id, user_id: r.user_id, first_seen: r.created_at });
        }
      }
      const fresh = missingLinks([...firstSeen.values()], links.rows);
      if (fresh.length) {
        await db.write('identity_links?on_conflict=device_id,user_id', {
          body: fresh.map((f) => ({ device_id: f.device_id, user_id: f.user_id, linked_at: f.first_seen, method: 'observed' })),
          prefer: 'resolution=ignore-duplicates,return=minimal',
        });
      }
      res.json({ witnessed_pairs: firstSeen.size, existing_links: links.rows.length, new_links: fresh.length, rawComplete: events.complete });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
}
