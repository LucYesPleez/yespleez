// ============================================================
// E2 · EMAIL DISPATCH — the ONLY place an email is ever sent.
// ============================================================
//
// ⛔⛔ PHASE 3 IS A CREDENTIAL PROOF, NOT THE EMAIL SYSTEM. This function exists
// to establish ONE thing: that a JWT-gated, server-side path can send through
// the new Resend credential on the verified yespleez.com domain. It is
// deliberately incapable of anything else.
//
//   ⛔ It reads NO notification. It does not know the `notifications` table
//      exists, and it must not learn until Phase 4.
//   ⛔ It accepts NO content. Not a recipient, not a subject, not a line of
//      HTML. The message it sends is a constant in this file.
//   ⛔ It is NOT the worker. Nothing enqueues, nothing retries, nothing loops.
//
// ── ⛔⛔ THE LESSON FROM `rapid-responder`, WHICH THIS REPLACES ──────────
//
// Its predecessor was deployed with `verify_jwt: false` and took its recipient
// from the request body, with `Access-Control-Allow-Origin: *` and caller
// strings interpolated into HTML unescaped. Anyone on the internet could send
// arbitrary mail from the verified domain, and one of its branches could
// provision accounts. It was deleted on 2026-08-31 (commit 2bcd85c).
//
// Every rule below is that incident written as code. In particular:
//
//   ⭐⭐ THE RECIPIENT IS DERIVED FROM THE CALLER'S OWN TOKEN, NEVER SUPPLIED.
//   There is no code path in this file that can address an email to anyone
//   other than the authenticated user who invoked it. Not "validated", not
//   "allowlisted" — DERIVED. A parameter that does not exist cannot be abused.
//
//   ⛔⛔ `verify_jwt: true` IS NECESSARY AND NOT SUFFICIENT. The platform gate
//   accepts the ANON KEY, which is public and sits in the shipped bundle. So
//   the gate stops an unauthenticated stranger and nothing more. The real check
//   is below: the token is resolved against /auth/v1/user, and only a genuine
//   USER session yields an identity. An anon-key caller resolves to no user and
//   is refused — which is exactly the hole `rapid-responder` left open.
//
// ── THE SECRET ──────────────────────────────────────────────────────────
//
// `EMAIL_NOTIFY_RESEND_KEY` — a NEW, sending-scoped Resend key created
// 2026-08-31, distinct from the revoked `yespleez` key that rapid-responder
// used. ⛔ Deliberately NOT named `RESEND_API_KEY`: Supabase edge secrets are
// PROJECT-WIDE, the old secret of that name was still set, and reusing the name
// would have silently fed the old, exposed credential to this function.
//
// ⛔ IT IS NEVER LOGGED, NEVER RETURNED, AND NEVER PUT IN AN ERROR MESSAGE.
// Provider failures are reported by STATUS and a short reason, never by echoing
// the upstream response body, which is the usual way a key reaches a log.
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_KEY   = Deno.env.get('EMAIL_NOTIFY_RESEND_KEY');

/**
 * ⭐ THE SENDER, FIXED HERE (owner, 2026-09-01).
 */
const FROM = 'YesPleez <noreply@yespleez.com>';

/**
 * ⭐⭐ REPLY-TO EXISTS BECAUSE THE MAILBOX DOES (owner, 2026-09-01).
 *
 * ⚠ IT WAS DELIBERATELY ABSENT UNTIL NOW, and the reason is worth keeping: a
 * Reply-To pointing at an address nobody reads is worse than none at all — it
 * invites a reply into a void, and a booking notice that swallows a reply is a
 * small hostility. `hello@yespleez.com` was created as a Cloudflare Email
 * Routing rule forwarding to the YesPleez inbox, and PROVEN by a real delivery
 * before this line was written.
 *
 * ⛔ THE `from` STAYS `noreply@`. The two answer different questions: `from`
 * says who sent it, `reply_to` says where a human can be reached. Sending AS
 * hello@ would put a monitored mailbox in the envelope of every automated
 * message, and bounces for the whole notification stream would land in it.
 *
 * ⛔ Still not caller-settable — `reply_to` remains in the FORBIDDEN list below.
 */
const REPLY_TO = 'YesPleez <hello@yespleez.com>';

/**
 * ⛔⛔ THE ENTIRE MESSAGE, AS A CONSTANT. Phase 3 proves the PATH, so the
 * content must be incapable of carrying anything real. No notification data, no
 * user data beyond the address the mail is going to, and nothing a caller can
 * influence. When Phase 5 brings templates they will be rendered from ids read
 * server-side — ⛔ never from a request body.
 */
const TEST_SUBJECT = 'YesPleez email delivery test';
const TEST_TEXT = [
  'This is a controlled test of the YesPleez transactional email delivery system.',
  '',
  'No action is required. If you did not expect this, you can ignore it.',
].join('\n');

/**
 * ⚠ A NARROW ALLOWLIST, ⛔ NOT `*`. rapid-responder's wildcard is what let any
 * web page on the internet drive it from a victim's browser. This endpoint has
 * no browser caller today; the list exists so that when one arrives it is an
 * explicit decision rather than a default that was never revisited.
 */
const ALLOWED_ORIGINS = new Set([
  'https://yespleez.com',
  'https://www.yespleez.com',
  'http://localhost:5173',
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin! } : {}),
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

/**
 * ⚠ ONE SHAPE FOR EVERY REPLY, so a caller can never distinguish "your token is
 * invalid" from "that account has no confirmed address" by response SHAPE, only
 * by the reason we choose to state. Controlled, and never carrying provider
 * detail.
 */
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return reply(405, { ok: false, error: 'method_not_allowed' }, origin);
  }

  // ── 1 · A REAL USER TOKEN, OR NOTHING ────────────────────────────────
  //
  // ⚠ The platform's verify_jwt gate has already refused a request with no
  // Authorization header. This repeats the check because that gate lives in
  // deployment CONFIG, not in code: anyone redeploying with --no-verify-jwt
  // would silently reopen the door, and nothing would fail loudly. Two
  // independent places now have to be wrong.
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return reply(401, { ok: false, error: 'missing_authorization' }, origin);
  }

  // ⛔⛔ THIS IS THE CHECK THAT MATTERS. The anon key is a structurally valid
  // JWT and passes the platform gate, but it carries no user, so /auth/v1/user
  // returns no identity for it. Only a genuine signed-in session resolves here.
  let user: { id?: string; email?: string; email_confirmed_at?: string } | null = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (res.ok) user = await res.json();
  } catch {
    user = null;
  }
  if (!user?.id) {
    return reply(401, { ok: false, error: 'invalid_token' }, origin);
  }

  // ── 2 · NO CONTENT IS ACCEPTED, AND SAYING SO IS THE POINT ───────────
  //
  // ⭐⭐ REFUSED LOUDLY RATHER THAN IGNORED SILENTLY. Ignoring a `to` field
  // would be equally safe and UNPROVABLE from outside — a security test could
  // not tell "ignored it" from "used it and the mail went elsewhere". A 400
  // makes the property observable: send a recipient, get refused.
  let body: unknown = null;
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return reply(400, { ok: false, error: 'invalid_json' }, origin);
  }
  if (body && typeof body === 'object') {
    const FORBIDDEN = ['to', 'email', 'recipient', 'from', 'subject', 'html', 'text', 'body', 'cc', 'bcc', 'reply_to', 'replyTo'];
    const offending = FORBIDDEN.filter(k => k in (body as Record<string, unknown>));
    if (offending.length) {
      return reply(400, {
        ok: false,
        error: 'content_not_accepted',
        detail: 'This endpoint derives its recipient and composes its own message. It accepts no addressing or content fields.',
        rejected: offending,
      }, origin);
    }
  }

  // ── 3 · THE RECIPIENT, DERIVED ───────────────────────────────────────
  //
  // ⚠ CONFIRMED ADDRESSES ONLY. An unconfirmed address is one nobody has proven
  // they control; mailing it is how a platform becomes the delivery mechanism
  // for someone else's typo, and how a sending domain earns complaints.
  if (!user.email) {
    return reply(422, { ok: false, error: 'account_has_no_email' }, origin);
  }
  if (!user.email_confirmed_at) {
    return reply(422, { ok: false, error: 'email_not_confirmed' }, origin);
  }

  if (!RESEND_KEY) {
    // ⚠ Names the SECRET, never its value, and never whether it looked valid.
    console.error('email-notify: EMAIL_NOTIFY_RESEND_KEY is not configured');
    return reply(500, { ok: false, error: 'provider_not_configured' }, origin);
  }

  // ── 4 · SEND ─────────────────────────────────────────────────────────
  let providerStatus = 0;
  let providerId: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],          // ⛔ derived above; there is no other source
        reply_to: REPLY_TO,        // ⛔ a constant, never the caller's
        subject: TEST_SUBJECT,
        text: TEST_TEXT,           // ⛔ text only — no HTML, so nothing to inject
      }),
    });
    providerStatus = res.status;
    const json = await res.json().catch(() => ({}));
    providerId = typeof json?.id === 'string' ? json.id : null;

    if (!res.ok) {
      // ⛔⛔ THE UPSTREAM BODY IS NOT LOGGED AND NOT RETURNED. A provider error
      // can echo the request it received, and the request carried the key in a
      // header — echoing it is the ordinary way a secret reaches a log file.
      // The STATUS is enough to diagnose from, and it cannot carry a credential.
      console.error(`email-notify: provider rejected the message, status ${providerStatus}`);
      return reply(502, { ok: false, error: 'provider_rejected', provider_status: providerStatus }, origin);
    }
  } catch {
    console.error('email-notify: provider request failed');
    return reply(502, { ok: false, error: 'provider_unreachable' }, origin);
  }

  // ⚠ Returns the provider's message id so a send can be traced in the Resend
  // dashboard. ⛔ Does NOT return the recipient — the caller already knows it,
  // and a response that echoes an address is a response that can leak one if
  // this endpoint is ever called on someone else's behalf.
  return reply(200, { ok: true, provider_status: providerStatus, provider_message_id: providerId }, origin);
});
