// ============================================================
// MP4 · PUSH DISPATCH — the ONLY place a push is ever sent.
// ============================================================
//
// Triggered by a Supabase Database Webhook on `public.notifications` INSERT.
// Nothing else calls this, and this calls nothing that writes a
// notification — see the architecture rules below, all owner-ratified
// 2026-07-25.
//
// ── PUSH IS A DELIVERY CHANNEL, NEVER A SOURCE OF TRUTH ─────────────────
//
// The `notifications` table (M8e's `notify_new_message` trigger, N1 held
// rows, NP1 suppression) is the ONLY authority on whether a notification
// exists and whether it should be shown. This function does not decide
// any of that — it reacts to a row that authority already wrote and
// approved, and only re-derives DISPLAY TEXT for the OS notification tray
// (title/body), never new facts. If a second way to trigger a push is ever
// proposed — a client-side call, a cron sweep — that is a second pipeline
// and must be rejected; extend the trigger that already exists instead.
//
// ── WHY IT READS notifications, NOT messages, FOR ITS TRIGGER CONDITION ──
//
// `notify_new_message` (M8e) already encodes who gets notified (fan-out to
// every human behind the recipient profile, skip the sender, hold for an
// unclaimed profile) and whether they get notified (NP1 suppression, via
// the BEFORE trigger that stamps `suppressed_at`). Re-implementing any of
// that here — e.g. "just look at conversation_participants" — would be a
// second, divergent notification pipeline. So this function trusts the row
// completely: to_user_id IS NOT NULL and suppressed_at IS NULL is the
// entire eligibility check.
//
// ── C32 / THE PAYLOAD CONTRACT — never plaintext message content ────────
//
// `notifications.message` is ALREADY safe (M8e writes literally 'New
// message', never the body) and `data` carries only ids. This function
// adds exactly two more values by looking them up: the sender's display
// NAME (public profile metadata, not conversation content) and the
// message's `kind` (text/voice/image/… — a dispatch tag, not the payload).
// `messages.body` and `messages.payload` are NEVER read here. This is
// also what keeps push forward-compatible with libsignal: once messages
// are end-to-end encrypted, this function still only needs a name and a
// kind, values that were never encrypted to begin with.
//
// ── FAN-OUT AND PRUNING ──────────────────────────────────────────────────
//
// One recipient may hold several push_subscriptions rows (phone, laptop,
// tablet) — every one gets sent to, independently. A 404/410 from the push
// service means that endpoint is gone for good (uninstalled, permission
// revoked, browser storage cleared) and is deleted immediately; any other
// failure is left alone; it may be transient.
// ============================================================

// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC   = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE  = Deno.env.get('VAPID_PRIVATE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET'); // optional extra check, see below

webpush.setVapidDetails('mailto:yespleez.aus@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

function restHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/**
 * Send one payload to every registered device, pruning the dead ones.
 *
 * Extracted when contact joins joined messages in the push scope (CJ2). The
 * two paths differ ONLY in what they put in the payload; the sending, the
 * 404/410 pruning and the failure accounting are identical, and duplicating
 * them is how one copy would quietly stop pruning.
 */
async function deliver(subscriptions: any[], payload: string) {
  let sent = 0;
  let pruned = 0;
  const failures: Array<{ endpoint: string; status?: number; message: string }> = [];

  await Promise.all(subscriptions.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err: any) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        // The push service itself says this endpoint will never work again
        // — not a network blip, a permanent fact about that device.
        await rest(`push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE' }).catch(() => {});
        pruned++;
      } else {
        failures.push({ endpoint: sub.endpoint, status, message: String(err?.message || err) });
      }
    }
  }));

  if (failures.length) console.error('push-notify: non-fatal send failures', JSON.stringify(failures));

  return { sent, pruned, devices: subscriptions.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // ── OPTIONAL DEFENCE IN DEPTH ──────────────────────────────────────
  // The function's own JWT verification (Supabase's default, left ON at
  // deploy) already means only a caller holding the service_role key can
  // invoke this — which is exactly what the Database Webhook is configured
  // to send. PUSH_WEBHOOK_SECRET is a second, independent check: set it as
  // a function secret AND as a custom header on the webhook, and a stolen
  // service_role key alone no longer suffices. Skipped if not configured,
  // so this is additive, not a new required step.
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const record = body?.record;
  if (!record) return new Response(JSON.stringify({ ok: true, skipped: 'no record' }), { status: 200 });

  // ── ELIGIBILITY: trust the row completely ──────────────────────────
  if (record.to_user_id == null) {
    return new Response(JSON.stringify({ ok: true, skipped: 'held (N1) — no delivery identity yet' }), { status: 200 });
  }
  if (record.suppressed_at != null) {
    return new Response(JSON.stringify({ ok: true, skipped: 'suppressed (NP1) — recipient muted this category' }), { status: 200 });
  }

  // ⚠ CJ2 · SECOND LINE OF DEFENCE, NOT THE PRIMARY ONE. The primary guard is
  // the `WHEN (new.channel IS DISTINCT FROM 'in_app')` clause on
  // trg_trigger_push_notify, so this function is normally never invoked for an
  // in_app row at all. It is repeated here because that clause lives on a
  // TRIGGER: anyone who drops and recreates trg_trigger_push_notify without
  // carrying the WHEN across silently turns every "In Messages only" choice
  // back into a push, and nothing would fail loudly. Two independent places
  // now have to be wrong before a user's choice is broken.
  if (record.channel === 'in_app') {
    return new Response(JSON.stringify({ ok: true, skipped: 'channel in_app — badge only, never push' }), { status: 200 });
  }

  // Push scope. Extended from message-only (v1) to include contact joins
  // (CJ2). Other types (bookings, follows, claims…) already flow through the
  // same notifications table and are added by extending THIS set — never by
  // adding a second trigger or a second function.
  const PUSH_TYPES = new Set(['new_message', 'contact_joined']);
  if (!PUSH_TYPES.has(record.type)) {
    return new Response(JSON.stringify({ ok: true, skipped: `type '${record.type}' not yet in push scope` }), { status: 200 });
  }

  const subscriptionsFor = (userId: string) =>
    rest(`push_subscriptions?user_id=eq.${userId}&select=id,endpoint,p256dh,auth`);
  // The same §5.6 count every other surface uses, called server-side because
  // the service worker has no access to the live app's state. See the
  // new_message path below for why null (not 0) is the failure value.
  const badgeFor = (userId: string) =>
    rest(`rpc/total_unread_count_for`, { method: 'POST', body: JSON.stringify({ p_user_id: userId }) })
      .catch(() => null);

  // ── CJ2 · CONTACT JOINED ────────────────────────────────────────────
  //
  // ⚠ THE SERVER HAS NO NAME TO SEND AND MUST NEVER BE GIVEN ONE. The row's
  // own message text is the deliberate fallback ("Someone from your contacts
  // joined YesPleez") — contact names live only in the recipient's device
  // IndexedDB and are resolved by sw.js at render time. All that travels here
  // is `contactCodeId`, an opaque identifier that means nothing off-device.
  // This is the same constraint that keeps push compatible with libsignal.
  if (record.type === 'contact_joined') {
    const contactCodeId = record.data?.contact_code_id ?? null;
    const [subs, badge] = await Promise.all([
      subscriptionsFor(record.to_user_id),
      badgeFor(record.to_user_id),
    ]);
    if (!subs?.length) {
      return new Response(JSON.stringify({ ok: true, skipped: 'recipient has no registered devices' }), { status: 200 });
    }
    const joinPayload = JSON.stringify({
      notificationId: record.id,
      type: 'contact_joined',
      contactCodeId,
      badgeCount: typeof badge === 'number' ? badge : null,
    });
    const result = await deliver(subs, joinPayload);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const conversationId = record.data?.conversation_id;
  const messageId      = record.data?.message_id;
  const aboutProfileId = record.about_profile_id;
  if (!conversationId) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no conversation_id on the row' }), { status: 200 });
  }

  // ── RESOLVE DISPLAY METADATA — names and kinds, never body/payload ──
  const [senderRows, messageRows, subscriptions, badgeCount] = await Promise.all([
    aboutProfileId
      ? rest(`profiles?id=eq.${aboutProfileId}&select=name`).catch(() => [])
      : Promise.resolve([]),
    messageId
      ? rest(`messages?id=eq.${messageId}&select=kind`).catch(() => [])
      : Promise.resolve([]),
    rest(`push_subscriptions?user_id=eq.${record.to_user_id}&select=id,endpoint,p256dh,auth`),
    // MP5b — the SAME count §5.6 already uses everywhere else, just called
    // server-side. The service worker (all that runs on iOS/Android when the
    // app is fully closed) has no access to the live app's state, so this is
    // the only way it can ever set the OS icon badge to the true number
    // instead of guessing or leaving it stale. Falls back to null (skip
    // setting the badge) rather than 0 (which would WRONGLY clear a real
    // badge) if the lookup fails — see sw.js's push handler for that check.
    rest(`rpc/total_unread_count_for`, { method: 'POST', body: JSON.stringify({ p_user_id: record.to_user_id }) }).catch(() => null),
  ]);

  if (!subscriptions?.length) {
    return new Response(JSON.stringify({ ok: true, skipped: 'recipient has no registered devices' }), { status: 200 });
  }

  const senderName = senderRows?.[0]?.name || 'Someone';
  const kind       = messageRows?.[0]?.kind || 'text';

  // Routing information and an encrypted-forward-compatible identifier
  // set only — see the file header. sw.js's `push` listener is the only
  // consumer of this shape; keep them in sync.
  const payload = JSON.stringify({
    notificationId: record.id,
    conversationId,
    senderName,
    kind,
    badgeCount: typeof badgeCount === 'number' ? badgeCount : null,
  });

  const result = await deliver(subscriptions, payload);

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
