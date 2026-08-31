// ============================================================
// E3 · EMAIL WORKER — drains the delivery queue.
// ============================================================
//
// Woken by `enqueue_email_delivery` (pg_net ping) or invoked directly with the
// service role. ⛔ Not reachable by any user: the ping carries no payload and
// this function accepts none, so there is nothing a caller can ask it to send.
//
// ── ⭐⭐ IT DRAINS A BATCH, NOT THE ROW THAT WOKE IT ──────────────────────
//
// ⚠⚠ THERE IS NO pg_cron IN THIS PROJECT — recorded in the repository already
// (20260821000000_fe1_featured_allocation) — so there is no scheduled sweep and
// retry has to come from somewhere else. It comes from here: every invocation
// processes every pending row it can see, so a delivery that failed an hour ago
// is retried by the NEXT notification's ping. Retry costs no infrastructure.
//
// ⚠ THE HONEST LIMIT: on a completely idle platform a failed row sits pending
// until something wakes this function. ⛔ It is never lost and never duplicated
// — the (notification_id, channel) PK forbids that — merely late. Any external
// ping drains it.
//
// ── ⛔⛔ THE COPY IS A CONSTANT, CHOSEN BY TYPE ───────────────────────────
//
// `notifications.message` is NEVER read, and that is the single most important
// rule in this file. The `notifications` INSERT policy is
// `auth.role() = 'authenticated'` — its own comment calls it an interim
// residual — so ANY signed-up user can write to ANY other user's inbox with ANY
// content. Rendering that column would let a stranger compose an email sent
// from the verified YesPleez domain to another person.
//
// So the body is picked from the table below by `type`, and the ONLY variable
// that reaches a message is the recipient's own address in the To header. An
// attacker who can insert a notification can choose WHICH of these fixed
// notices fires — bounded further by E3's per-recipient hourly cap — but cannot
// author a word of it.
//
// ⛔ Text only, no HTML. Nothing to inject, and it renders everywhere.
// ⚠ Phase 5 will enrich these from data READ SERVER-SIDE by id. It must never
// enrich them from the notification row's own text.
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY   = Deno.env.get('EMAIL_NOTIFY_RESEND_KEY');

const FROM     = 'YesPleez <noreply@yespleez.com>';
const REPLY_TO = 'YesPleez <hello@yespleez.com>';

/* ⚠ HashRouter, so the app's routes live after the `#`. A link without it
   lands on What's On and the reader has to go hunting. */
const APP = 'https://yespleez.com';
const LINK_NOTIFICATIONS = `${APP}/#/notifications`;
const LINK_MESSAGES      = `${APP}/#/messages`;

/**
 * ⭐⭐ ONE ENTRY PER TYPE, AND AN UNKNOWN TYPE SENDS NOTHING.
 *
 * ⛔ The default is SILENCE, not a generic email. A type nobody has written copy
 * for is a type nobody has decided should be emailed — defaulting to "you have
 * a notification" would quietly widen the email surface every time someone adds
 * a notification type, which is how a platform starts sending mail it never
 * agreed to send.
 */
const COPY: Record<string, { subject: string; line: string; link: string }> = {
  // ── bookings ───────────────────────────────────────────────
  new_application:      { subject: 'New application on YesPleez',        line: 'Someone has applied to play at one of your events.',       link: LINK_NOTIFICATIONS },
  shortlisted:          { subject: 'You have been shortlisted',          line: 'An organiser has shortlisted you for an event.',           link: LINK_NOTIFICATIONS },
  application_declined: { subject: 'Update on your application',         line: 'There is an update on an application you sent.',           link: LINK_NOTIFICATIONS },
  slot_offer:           { subject: 'You have been offered a slot',       line: 'An organiser has offered you a slot. It needs a response.', link: LINK_NOTIFICATIONS },
  slot_accepted:        { subject: 'A slot offer was accepted',          line: 'An act has accepted a slot on one of your events.',        link: LINK_NOTIFICATIONS },
  slot_declined:        { subject: 'A slot offer was declined',          line: 'An act has declined a slot on one of your events.',        link: LINK_NOTIFICATIONS },
  slot_removed:         { subject: 'A slot has been removed',            line: 'A slot you were on has been removed.',                     link: LINK_NOTIFICATIONS },
  event_invite:         { subject: 'You have an event invitation',       line: 'You have been invited to an event. It needs a response.',  link: LINK_NOTIFICATIONS },
  invite_accepted:      { subject: 'An invitation was accepted',         line: 'Someone has accepted an invitation to your event.',        link: LINK_NOTIFICATIONS },
  invite_declined:      { subject: 'An invitation was declined',         line: 'Someone has declined an invitation to your event.',        link: LINK_NOTIFICATIONS },
  booking_confirmed:    { subject: 'A booking is confirmed',             line: 'A booking has been confirmed.',                            link: LINK_NOTIFICATIONS },
  booking_cancelled:    { subject: 'A booking has been cancelled',       line: 'A booking has been cancelled.',                            link: LINK_NOTIFICATIONS },
  availability_request: { subject: 'New enquiry on YesPleez',            line: 'Someone has enquired about your availability.',            link: LINK_NOTIFICATIONS },
  festival_accepted:    { subject: 'A festival application was accepted',line: 'There is an update on a festival application.',            link: LINK_NOTIFICATIONS },
  festival_declined:    { subject: 'A festival application was declined',line: 'There is an update on a festival application.',            link: LINK_NOTIFICATIONS },

  // ── schedule (E1's email-only category) ────────────────────
  slot_changed:         { subject: 'Your YesPleez set time changed',     line: 'A set time you are booked for has changed.',               link: LINK_NOTIFICATIONS },
  set_times_released:   { subject: 'Set times are out',                  line: 'The running order has been published for an event you are on.', link: LINK_NOTIFICATIONS },

  // ── events ─────────────────────────────────────────────────
  event_updated:        { subject: 'An event you follow was updated',    line: 'Details have changed on an event you are involved with.',  link: LINK_NOTIFICATIONS },
  event_reminder:       { subject: 'Event reminder',                     line: 'An event you are involved with is coming up.',             link: LINK_NOTIFICATIONS },

  // ── messages ───────────────────────────────────────────────
  // ⛔⛔ NO SENDER NAME AND NO PREVIEW. `notifications.message` is attacker-
  // writable and the message body is conversation CONTENT under C32, which
  // even push refuses to carry. An email is a worse place for it, not a better
  // one: it lands in a third-party mailbox and is retained indefinitely.
  new_message:          { subject: 'New message on YesPleez',            line: 'You have a new message.',                                  link: LINK_MESSAGES },

  // ── payments / account (un-mutable, per NP1) ───────────────
  payment_requested:    { subject: 'A payment has been requested',       line: 'A payment has been requested on YesPleez.',                link: LINK_NOTIFICATIONS },
  payment_received:     { subject: 'A payment was received',             line: 'A payment has been recorded on YesPleez.',                 link: LINK_NOTIFICATIONS },
  profile_claimed:      { subject: 'Profile claim update',               line: 'There is an update on a profile claim.',                   link: LINK_NOTIFICATIONS },
};

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

/** ⚠ Never carries provider or recipient detail — see the send path. */
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * ⭐⭐ THE `role` CLAIM, ⛔ NOT A STRING COMPARE AGAINST THE ENV VAR.
 *
 * ⚠⚠ THE STRING COMPARE WAS TRIED FIRST AND IS WRONG. A project can hold more
 * than one valid service_role key at a time — measured here: the key in the
 * repo's own `.env.local` and the one the platform injects as
 * SUPABASE_SERVICE_ROLE_KEY have different digests, and BOTH are genuine
 * `role: service_role` tokens for this project ref. Equality would have
 * rejected a perfectly valid credential, which is exactly what it did on the
 * first test run. Supabase has also deprecated these legacy keys in favour of
 * SUPABASE_SECRET_KEYS, so pinning to one string ages badly.
 *
 * ⛔⛔ READING A CLAIM IS ONLY SAFE BECAUSE THE PLATFORM ALREADY VERIFIED THE
 * SIGNATURE. `verify_jwt: true` on this function means a token with a forged
 * payload never reaches this code. ⚠⚠ IF ANYONE EVER REDEPLOYS THIS FUNCTION
 * WITH `--no-verify-jwt`, THIS CHECK BECOMES FORGEABLE BY ANYONE — a claim is
 * just text without a checked signature. That is the same class of mistake
 * `rapid-responder` shipped. The env-var equality below is kept as a second,
 * signature-independent path for exactly that reason: one of the two holds even
 * if the deployment config is wrong.
 */
function isServiceRole(token: string): boolean {
  if (token === SERVICE_KEY) return true;   // unforgeable, independent of config
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/') + pad));
    return json?.role === 'service_role' && json?.ref === new URL(SUPABASE_URL).hostname.split('.')[0];
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  // ── ⛔⛔ SERVICE ROLE ONLY ────────────────────────────────────────────
  //
  // The platform's verify_jwt gate accepts the ANON KEY, which is public — so
  // it stops a stranger with no header and nothing else. `isServiceRole`
  // is the real gate: a user session fails, the anon key fails, and only the
  // database's own ping (or a deliberate admin invoke) gets through.
  // ⛔ Do not relax this to "any valid JWT" — that is the anon key again.
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !isServiceRole(token)) {
    return reply(401, { ok: false, error: 'service_role_required' });
  }

  if (!RESEND_KEY) {
    console.error('email-worker: EMAIL_NOTIFY_RESEND_KEY is not configured');
    return reply(500, { ok: false, error: 'provider_not_configured' });
  }

  // ── THE QUEUE ────────────────────────────────────────────────────────
  // ⛔ Read through the RPC, never with a table select. The RPC is where "what
  // may be sent" is defined — confirmed address, still-unsuppressed, still
  // wanted, under the attempt limit — and a direct select here would be a
  // second, divergent answer to that question.
  let queue: Array<{
    notification_id: string;
    notification_type: string;
    email_category: string | null;
    recipient_email: string;
    attempts: number;
  }> = [];
  try {
    const res = await rest('rpc/email_delivery_queue', {
      method: 'POST',
      body: JSON.stringify({ p_limit: 25 }),
    });
    if (!res.ok) {
      console.error(`email-worker: queue read failed, status ${res.status}`);
      return reply(500, { ok: false, error: 'queue_unavailable' });
    }
    queue = await res.json();
  } catch {
    return reply(500, { ok: false, error: 'queue_unavailable' });
  }

  if (!queue.length) return reply(200, { ok: true, processed: 0, sent: 0, failed: 0, skipped: 0 });

  let sent = 0, failed = 0, skipped = 0;

  for (const row of queue) {
    const copy = COPY[row.notification_type];

    // ⛔ An unknown type is SILENCE, and the row is closed as failed rather
    // than left pending forever — a queue that never empties hides the ones
    // that are genuinely stuck.
    if (!copy) {
      skipped++;
      await rest(`notification_deliveries?notification_id=eq.${row.notification_id}&channel=eq.email`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: `no email copy defined for type '${row.notification_type}'`,
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
      continue;
    }

    const text = [
      copy.line,
      '',
      copy.link,
      '',
      '—',
      'You are receiving this because you have an account on YesPleez.',
      'Manage which emails you get in the app under Notifications.',
    ].join('\n');

    let ok = false;
    let providerId: string | null = null;
    let reason = '';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [row.recipient_email],   // ⛔ from the RPC, resolved from auth.users
          reply_to: REPLY_TO,
          subject: copy.subject,
          text,
        }),
      });
      // ⛔⛔ THE UPSTREAM BODY IS NEVER LOGGED. A provider error can echo the
      // request it received, and that request carried the key in a header.
      // A status code cannot carry a credential.
      ok = res.ok;
      reason = ok ? '' : `provider status ${res.status}`;
      if (ok) {
        const j = await res.json().catch(() => ({}));
        providerId = typeof j?.id === 'string' ? j.id : null;
      }
    } catch {
      ok = false;
      reason = 'provider unreachable';
    }

    const nowIso = new Date().toISOString();
    const patch = ok
      ? { status: 'sent', attempts: row.attempts + 1, provider_message_id: providerId, sent_at: nowIso, updated_at: nowIso, last_error: null }
      // ⚠ STAYS `pending` until the attempt limit, so the next ping retries it.
      // The RPC stops handing it over at 5, and this closes it as failed then —
      // ⛔ so a permanently broken row cannot be retried forever.
      : { status: row.attempts + 1 >= 5 ? 'failed' : 'pending', attempts: row.attempts + 1, last_error: reason, updated_at: nowIso };

    const upd = await rest(`notification_deliveries?notification_id=eq.${row.notification_id}&channel=eq.email`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).catch(() => null);

    // ⚠⚠ A SEND THAT SUCCEEDS AND FAILS TO RECORD IS THE ONE DANGEROUS CASE:
    // the row stays pending and the next ping sends a SECOND email. It is
    // logged loudly because the PK cannot protect against it — the PK stops two
    // ROWS, not two sends against one row.
    if (ok && (!upd || !upd.ok)) {
      console.error(`email-worker: SENT but failed to record delivery for notification ${row.notification_id} — a retry may duplicate this email`);
    }

    if (ok) sent++; else failed++;
  }

  return reply(200, { ok: true, processed: queue.length, sent, failed, skipped });
});
