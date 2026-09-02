// ============================================================
// E3/E5 · EMAIL WORKER — drains the delivery queue and renders the templates.
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
// until something wakes this function. ⛔ Never lost, never duplicated — the
// (notification_id, channel) PK forbids that — merely late.
//
// ── ⛔⛔ WHAT MAY REACH AN EMAIL BODY, AND WHAT MAY NOT ──────────────────
//
// `notifications.message` is NEVER read. The INSERT policy on that table is
// `auth.role() = 'authenticated'` — an interim residual by its own comment — so
// ANY signed-up user can write ANY text to ANY other user's inbox. Rendering it
// would let a stranger compose mail sent from the verified YesPleez domain.
//
// ⚠⚠ AND THE SAME APPLIES TO `data.event_name`, `data.venue_name` AND
// `from_name`, WHICH IS THE LESS OBVIOUS HALF. Those are strings the writer
// chose too. So a name is never taken from the payload: the payload's `event_id`
// is used to LOOK THE NAME UP in `events`, server-side, and the looked-up value
// is HTML-escaped. An attacker can still point at somebody else's event id, but
// that only surfaces an event name which is already public.
//
// ⛔ Every interpolated value goes through `esc()`. There are no exceptions and
// there is no "this one is safe" case.
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY   = Deno.env.get('EMAIL_NOTIFY_RESEND_KEY');

const FROM     = 'YesPleez <noreply@yespleez.com>';
const REPLY_TO = 'YesPleez <hello@yespleez.com>';

/* ⚠ HashRouter: the app's routes live after the `#`. A link without it lands on
   What's On and the reader has to go hunting for what the email was about. */
const APP = 'https://yespleez.com';
const linkNotifications = () => `${APP}/#/notifications`;
const linkMessages      = () => `${APP}/#/messages`;
const linkEvent         = (id?: string | null) => (id ? `${APP}/#/event/${id}` : linkNotifications());
const linkSetTimes      = (id?: string | null) => (id ? `${APP}/#/event/${id}/set-times` : linkNotifications());
const linkApplications  = (id?: string | null) => (id ? `${APP}/#/event/${id}/applications` : linkNotifications());

/**
 * ⛔⛔ EVERY interpolated value passes through this. An email body is HTML in a
 * client we do not control, and a single unescaped name is a script tag in
 * somebody's webmail.
 */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ⛔ NO EM DASHES IN USER-FACING COPY, EVER (standing UI law, and it applies to
 * email exactly as it applies to a screen). Every string below is written with
 * ordinary punctuation. ⚠ This includes the footer separator, which was an em
 * dash in the first draft of this file.
 */
type Tpl = {
  subject: (ctx: Ctx) => string;
  preheader: (ctx: Ctx) => string;
  line: (ctx: Ctx) => string;
  /* ⚠ A PLAIN STRING FOR ALMOST EVERY TYPE. The function form exists for the
     one template whose button depends on what the notice turned out to be about
     — `booking_cancelled`, which may or may not name an event. Resolve it with
     `ctaOf()`; ⛔ never read `.cta` directly, it may not be a string. */
  cta: string | ((ctx: Ctx) => string);
  link: (ctx: Ctx) => string;
};

const ctaOf = (t: Tpl, ctx: Ctx) => (typeof t.cta === 'function' ? t.cta(ctx) : t.cta);

type Ctx = {
  eventName: string | null;   // looked up server-side, never from the payload
  eventId: string | null;
  conversationId: string | null;
};

/** ⭐ "your event" when the lookup found nothing. ⛔ Never an empty gap and
 *  never the raw id, which means nothing to a reader. */
const ev = (c: Ctx) => c.eventName ?? 'your event';

/**
 * ⭐⭐ ONE ENTRY PER TYPE, AND AN UNKNOWN TYPE SENDS NOTHING.
 *
 * ⛔ The default is SILENCE, not a generic email. A type nobody has written copy
 * for is a type nobody has decided should be emailed, and defaulting to "you
 * have a notification" would widen the email surface every time someone adds a
 * notification type.
 *
 * ⛔ `contact_joined` and `new_follower` are ABSENT on purpose: their categories
 * (contacts, social) are out of email scope in E3. High volume, no deadline,
 * and the likeliest source of spam complaints.
 */
const TEMPLATES: Record<string, Tpl> = {
  // ── bookings ───────────────────────────────────────────────
  new_application: {
    subject:   c => `New application for ${ev(c)}`,
    preheader: c => `Someone has applied to play at ${ev(c)}.`,
    line:      c => `Someone has applied to play at <strong>${esc(ev(c))}</strong>. It is waiting in your applications list.`,
    cta: 'View applications',
    link: c => linkApplications(c.eventId),
  },
  shortlisted: {
    subject:   c => `You have been shortlisted for ${ev(c)}`,
    preheader: c => `An organiser has shortlisted you for ${ev(c)}.`,
    line:      c => `An organiser has shortlisted you for <strong>${esc(ev(c))}</strong>. Nothing is confirmed yet.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },
  application_declined: {
    subject:   c => `Update on your application for ${ev(c)}`,
    preheader: c => `There is an update on your application for ${ev(c)}.`,
    line:      c => `There is an update on your application for <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the update',
    link: c => linkNotifications(),
  },
  slot_offer: {
    subject:   c => `You have been offered a slot at ${ev(c)}`,
    preheader: c => 'This one needs a response.',
    line:      c => `An organiser has offered you a slot at <strong>${esc(ev(c))}</strong>. It is waiting for your response.`,
    cta: 'Respond to the offer',
    link: c => linkEvent(c.eventId),
  },
  slot_accepted: {
    subject:   c => `A slot at ${ev(c)} was accepted`,
    preheader: c => `An act has accepted their slot at ${ev(c)}.`,
    line:      c => `An act has accepted their slot at <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the lineup',
    link: c => linkEvent(c.eventId),
  },
  slot_declined: {
    subject:   c => `A slot at ${ev(c)} was declined`,
    preheader: c => `An act has declined their slot at ${ev(c)}.`,
    line:      c => `An act has declined their slot at <strong>${esc(ev(c))}</strong>. That slot is open again.`,
    cta: 'View the lineup',
    link: c => linkEvent(c.eventId),
  },
  slot_removed: {
    subject:   c => `Your slot at ${ev(c)} has been removed`,
    preheader: c => `A slot you were on at ${ev(c)} has been removed.`,
    line:      c => `A slot you were on at <strong>${esc(ev(c))}</strong> has been removed.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },
  event_invite: {
    subject:   c => `You have been invited to ${ev(c)}`,
    preheader: c => 'This one needs a response.',
    line:      c => `You have been invited to play at <strong>${esc(ev(c))}</strong>. It is waiting for your response.`,
    cta: 'Respond to the invitation',
    link: c => linkEvent(c.eventId),
  },
  invite_accepted: {
    subject:   c => `An invitation to ${ev(c)} was accepted`,
    preheader: c => `Someone has accepted their invitation to ${ev(c)}.`,
    line:      c => `Someone has accepted their invitation to <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the lineup',
    link: c => linkEvent(c.eventId),
  },
  invite_declined: {
    subject:   c => `An invitation to ${ev(c)} was declined`,
    preheader: c => `Someone has declined their invitation to ${ev(c)}.`,
    line:      c => `Someone has declined their invitation to <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the lineup',
    link: c => linkEvent(c.eventId),
  },
  booking_confirmed: {
    subject:   c => `Booking confirmed for ${ev(c)}`,
    preheader: c => `A booking has been confirmed for ${ev(c)}.`,
    line:      c => `A booking has been confirmed for <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the booking',
    link: c => linkEvent(c.eventId),
  },
  /**
   * ⛔⛔ NOT EVERY CANCELLED BOOKING HAS AN EVENT. This type is now also written
   * when an act withdraws from an accepted DATE ENQUIRY — the ordinary case, a
   * venue asked for a night that was never built into an event. `ev()` answers
   * "your event" when the lookup finds nothing, so the event-only copy mailed a
   * venue about the cancellation of an event that does not exist, and pointed
   * "View the event" at the notifications list.
   *
   * ⚠ THE ACT AND THE DATE ARE DELIBERATELY ABSENT. `Ctx` carries only
   * server-looked-up values; the notification's payload is attacker-controlled
   * and never interpolated into mail. The email says a spot opened and sends
   * them to the enquiry, which names both.
   */
  booking_cancelled: {
    subject:   c => c.eventId ? `Booking cancelled for ${ev(c)}` : 'A booking has been cancelled',
    preheader: c => c.eventId
      ? `A booking for ${ev(c)} has been cancelled.`
      : 'An act has pulled out. The spot is open again.',
    line:      c => c.eventId
      ? `A booking for <strong>${esc(ev(c))}</strong> has been cancelled.`
      : 'An act has pulled out of a date you had accepted. The spot is open again — the enquiry has the act and the date.',
    cta: c => c.eventId ? 'View the event' : 'View the enquiry',
    link: c => linkEvent(c.eventId),
  },
  availability_request: {
    subject:   () => 'New enquiry on YesPleez',
    preheader: () => 'Someone has asked about your availability.',
    line:      () => 'Someone has enquired about your availability. The details and the date they asked about are on the enquiry.',
    cta: 'View the enquiry',
    link: () => linkNotifications(),
  },
  festival_accepted: {
    subject:   () => 'Update on your festival application',
    preheader: () => 'There is a decision on a festival application.',
    line:      () => 'There is an update on a festival application you sent.',
    cta: 'View the update',
    link: () => linkNotifications(),
  },
  festival_declined: {
    subject:   () => 'Update on your festival application',
    preheader: () => 'There is a decision on a festival application.',
    line:      () => 'There is an update on a festival application you sent.',
    cta: 'View the update',
    link: () => linkNotifications(),
  },

  // ── schedule (E1's email-only category) ────────────────────
  slot_changed: {
    subject:   c => `Your set time at ${ev(c)} has changed`,
    preheader: () => 'Check the new time before you plan your day.',
    line:      c => `A set time you are booked for at <strong>${esc(ev(c))}</strong> has changed. Please check the new time.`,
    cta: 'View set times',
    link: c => linkSetTimes(c.eventId),
  },
  set_times_released: {
    subject:   c => `Set times are out for ${ev(c)}`,
    preheader: () => 'The running order has been published.',
    line:      c => `The running order has been published for <strong>${esc(ev(c))}</strong>. You can see when you are on.`,
    cta: 'View set times',
    link: c => linkSetTimes(c.eventId),
  },

  // ── events ─────────────────────────────────────────────────
  event_updated: {
    subject:   c => `${ev(c)} has been updated`,
    preheader: c => `Details have changed on ${ev(c)}.`,
    line:      c => `Details have changed on <strong>${esc(ev(c))}</strong>.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },
  event_reminder: {
    subject:   c => `${ev(c)} is coming up`,
    preheader: c => `A reminder about ${ev(c)}.`,
    line:      c => `<strong>${esc(ev(c))}</strong> is coming up.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },
  event_published: {
    subject:   c => `${ev(c)} is now live`,
    preheader: c => `${ev(c)} has been published.`,
    line:      c => `<strong>${esc(ev(c))}</strong> has been published and is now visible on YesPleez.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },
  event_nearly_full: {
    subject:   c => `${ev(c)} is nearly full`,
    preheader: c => `There is not much room left on ${ev(c)}.`,
    line:      c => `<strong>${esc(ev(c))}</strong> is nearly full.`,
    cta: 'View the event',
    link: c => linkEvent(c.eventId),
  },

  // ── messages ───────────────────────────────────────────────
  // ⛔⛔ NO SENDER NAME AND NO PREVIEW. The body is conversation CONTENT under
  // C32, which even push refuses to carry, and `from_name` is attacker-writable.
  // An email is a worse home for either: it lands in a third-party mailbox and
  // is retained indefinitely. ⚠ E4 also limits this to one per hour.
  new_message: {
    subject:   () => 'New message on YesPleez',
    preheader: () => 'Someone has sent you a message.',
    line:      () => 'You have a new message waiting in YesPleez.',
    cta: 'Open messages',
    link: () => linkMessages(),
  },

  // ── payments / account (un-mutable, per NP1) ───────────────
  payment_requested: {
    subject:   () => 'A payment has been requested',
    preheader: () => 'There is a payment request on your account.',
    line:      () => 'A payment has been requested on YesPleez.',
    cta: 'View the request',
    link: () => linkNotifications(),
  },
  payment_received: {
    subject:   () => 'A payment was recorded',
    preheader: () => 'A payment has been recorded on your account.',
    line:      () => 'A payment has been recorded on YesPleez.',
    cta: 'View the details',
    link: () => linkNotifications(),
  },
  profile_claimed: {
    subject:   () => 'Update on your profile claim',
    preheader: () => 'There is a decision on a profile claim.',
    line:      () => 'There is an update on a profile claim.',
    cta: 'View the update',
    link: () => linkNotifications(),
  },
};

/**
 * ⭐ TABLE-BASED, INLINE STYLES, ONE COLUMN, 600px. Not nostalgia: Outlook on
 * Windows renders through Word, which ignores most modern CSS and float layout.
 * A table is what survives.
 *
 * ⚠ THE PREHEADER IS HIDDEN TEXT that inbox lists show beside the subject. It
 * is padded so the client cannot pull body copy in after it.
 * ⚠ `color-scheme` and an explicit background stop dark-mode clients inverting
 * the card into something unreadable.
 */
function renderHtml(t: Tpl, ctx: Ctx): string {
  const link = t.link(ctx);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(t.subject(ctx))}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(t.preheader(ctx))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;border:1px solid #e3e3e8;">
  <tr><td style="padding:26px 28px 6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#8a8a96;">YESPLEEZ</td></tr>
  <tr><td style="padding:0 28px 18px;font-family:Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:#1a1a1f;">${t.line(ctx)}</td></tr>
  <tr><td style="padding:0 28px 26px;">
    <a href="${esc(link)}" style="display:inline-block;background:#1a1a1f;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:8px;">${esc(ctaOf(t, ctx))}</a>
  </td></tr>
  <tr><td style="padding:0 28px 26px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a96;border-top:1px solid #eeeef1;padding-top:18px;">
    You are receiving this because you have a YesPleez account.<br>
    You can choose which emails you get in the app, under Notifications.<br>
    <a href="${esc(link)}" style="color:#8a8a96;">${esc(link)}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * ⭐ A REAL PLAIN-TEXT ALTERNATIVE, ⛔ not the HTML with the tags stripped.
 * Some clients show only this, and a multipart message whose text part is
 * missing or junk is a well-known spam signal.
 */
function renderText(t: Tpl, ctx: Ctx): string {
  const line = t.line(ctx).replace(/<[^>]+>/g, '');
  return [
    line,
    '',
    `${ctaOf(t, ctx)}: ${t.link(ctx)}`,
    '',
    '...',
    'You are receiving this because you have a YesPleez account.',
    'You can choose which emails you get in the app, under Notifications.',
  ].join('\n');
}

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

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * ⭐⭐ THE `role` CLAIM, ⛔ NOT A STRING COMPARE AGAINST THE ENV VAR.
 *
 * ⚠⚠ THE STRING COMPARE WAS TRIED FIRST AND IS WRONG. A project can hold more
 * than one valid service_role key at a time — measured here: the key in the
 * repo's `.env.local` and the one the platform injects have different digests,
 * and BOTH are genuine `role: service_role` tokens for this project ref.
 * Equality rejected a perfectly valid credential on the first test run.
 *
 * ⛔⛔ READING A CLAIM IS ONLY SAFE BECAUSE THE PLATFORM VERIFIED THE SIGNATURE.
 * `verify_jwt: true` means a forged payload never reaches this code. ⚠⚠ A
 * redeploy with `--no-verify-jwt` makes this forgeable by anyone — the same
 * class of mistake `rapid-responder` shipped. The env equality is kept as a
 * signature-independent second path for exactly that reason.
 */
function isServiceRole(token: string): boolean {
  if (token === SERVICE_KEY) return true;
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

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !isServiceRole(token)) {
    return reply(401, { ok: false, error: 'service_role_required' });
  }

  if (!RESEND_KEY) {
    console.error('email-worker: EMAIL_NOTIFY_RESEND_KEY is not configured');
    return reply(500, { ok: false, error: 'provider_not_configured' });
  }

  // ⛔ Read through the RPC, never with a table select. The RPC is where "what
  // may be sent" is defined; a direct select would be a second, divergent
  // answer to that question.
  let queue: Array<{
    notification_id: string;
    notification_type: string;
    email_category: string | null;
    recipient_email: string;
    attempts: number;
  }> = [];
  try {
    const res = await rest('rpc/email_delivery_queue', { method: 'POST', body: JSON.stringify({ p_limit: 25 }) });
    if (!res.ok) {
      console.error(`email-worker: queue read failed, status ${res.status}`);
      return reply(500, { ok: false, error: 'queue_unavailable' });
    }
    queue = await res.json();
  } catch {
    return reply(500, { ok: false, error: 'queue_unavailable' });
  }

  if (!queue.length) return reply(200, { ok: true, processed: 0, sent: 0, failed: 0, skipped: 0 });

  // ── CONTEXT: IDS IN, NAMES OUT ───────────────────────────────────────
  //
  // ⚠ ONE ROUND TRIP FOR THE WHOLE BATCH, not one per row. Twenty five
  // sequential lookups inside a request that also makes twenty five provider
  // calls is how a worker times out and starts retrying work it already did.
  const ids = queue.map(r => r.notification_id);
  const byId = new Map<string, { eventId: string | null; conversationId: string | null }>();
  const eventIds = new Set<string>();
  try {
    const res = await rest(`notifications?id=in.(${ids.join(',')})&select=id,event_id,data`);
    if (res.ok) {
      for (const n of await res.json()) {
        const eid = n.event_id ?? n.data?.event_id ?? null;
        byId.set(n.id, { eventId: eid, conversationId: n.data?.conversation_id ?? null });
        if (eid) eventIds.add(eid);
      }
    }
  } catch { /* names are optional; the fallback copy is honest without them */ }

  // ⭐ THE NAME IS LOOKED UP, ⛔ never taken from `data.event_name`. That value
  // is written by whoever inserted the notification.
  const eventNames = new Map<string, string>();
  if (eventIds.size) {
    try {
      const res = await rest(`events?id=in.(${[...eventIds].join(',')})&select=id,name`);
      if (res.ok) for (const e of await res.json()) eventNames.set(e.id, e.name);
    } catch { /* falls back to "your event" */ }
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const row of queue) {
    const tpl = TEMPLATES[row.notification_type];

    // ⛔ An unknown type is SILENCE. The row is closed as failed rather than
    // left pending forever: a queue that never empties hides the rows that are
    // genuinely stuck.
    if (!tpl) {
      skipped++;
      await rest(`notification_deliveries?notification_id=eq.${row.notification_id}&channel=eq.email`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: `no email template for type '${row.notification_type}'`,
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
      continue;
    }

    const meta = byId.get(row.notification_id) ?? { eventId: null, conversationId: null };
    const ctx: Ctx = {
      eventId: meta.eventId,
      conversationId: meta.conversationId,
      eventName: meta.eventId ? (eventNames.get(meta.eventId) ?? null) : null,
    };

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
          subject: tpl.subject(ctx),
          html: renderHtml(tpl, ctx),
          text: renderText(tpl, ctx),
        }),
      });
      // ⛔⛔ THE UPSTREAM BODY IS NEVER LOGGED. A provider error can echo the
      // request it received, and that request carried the key in a header.
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
      // ⚠ Stays `pending` until the attempt limit so the next ping retries it.
      // The RPC stops handing it over at 5 and this closes it as failed then.
      : { status: row.attempts + 1 >= 5 ? 'failed' : 'pending', attempts: row.attempts + 1, last_error: reason, updated_at: nowIso };

    const upd = await rest(`notification_deliveries?notification_id=eq.${row.notification_id}&channel=eq.email`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).catch(() => null);

    // ⚠⚠ A SEND THAT SUCCEEDS AND FAILS TO RECORD IS THE ONE DANGEROUS CASE:
    // the row stays pending and the next ping sends a SECOND email. Logged
    // loudly because the PK cannot protect against it — the PK stops two ROWS,
    // not two sends against one row.
    if (ok && (!upd || !upd.ok)) {
      console.error(`email-worker: SENT but failed to record delivery for notification ${row.notification_id} — a retry may duplicate this email`);
    }

    if (ok) sent++; else failed++;
  }

  return reply(200, { ok: true, processed: queue.length, sent, failed, skipped });
});
