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

  // v1 scope (owner-decided): message notifications only. Other types
  // (bookings, follows, claims…) already flow through the same
  // notifications table and can be added here later by extending this
  // switch — NOT by adding a second trigger or a second function.
  if (record.type !== 'new_message') {
    return new Response(JSON.stringify({ ok: true, skipped: `type '${record.type}' not yet in push scope` }), { status: 200 });
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

  return new Response(JSON.stringify({ ok: true, sent, pruned, devices: subscriptions.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
