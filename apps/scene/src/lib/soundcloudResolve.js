/**
 * "IF IT PLAYS ON SOUNDCLOUD, IT PLAYS HERE."
 *
 * The same promise the social-handle normalisation makes: whatever a person
 * pastes, the app works out what they meant. Paste a share link, a full track
 * URL, a profile URL, a bare handle, anything with tracking junk stapled to
 * the end — it plays.
 *
 * ── WHY THIS IS NOT JUST STRING TIDYING ──────────────────────────────
 *
 * The socials fix could be done with a regex because a handle maps to a URL by
 * rule. This one cannot, and measuring it is what showed why:
 *
 *   w.soundcloud.com/player/?url=https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg
 *     → 404, silent empty player
 *   w.soundcloud.com/player/?url=https://soundcloud.com/8ballaudio/enlil-...
 *     → 200
 *
 * `on.soundcloud.com` is a REDIRECT, resolved by the browser when a human
 * clicks it — and the widget's backend does not follow it. ⛔ The app cannot
 * follow it either: the redirect is cross-origin and opaque to fetch, so
 * reading the destination in JavaScript is impossible.
 *
 * ⭐⭐ SoundCloud's own oEmbed endpoint resolves it, and answers with
 * `access-control-allow-origin: *`. It takes ANY of those shapes and returns
 * an iframe whose `url=` parameter is a canonical `api.soundcloud.com/tracks/N`
 * resource — which the widget always accepts. That is the whole trick: ask
 * SoundCloud what the link means rather than trying to parse it.
 *
 * ⚠ ONE NETWORK CALL, AND IT IS ALLOWED TO FAIL. The raw URL is returned
 * unchanged when oEmbed is unreachable, so a link that works today keeps
 * working if this endpoint ever goes away. It degrades to the behaviour that
 * existed before it.
 */

/**
 * Anything a person might paste, made into a URL we can ask about.
 *
 * ⭐⭐ THE SHARE SHEET GIVES A SENTENCE, NOT A LINK. SoundCloud's copy button
 * hands out the whole thing:
 *
 *   Listen to Cosmatik @ Sub Terra 2023 by Cosmatik on #SoundCloud https://on.soundcloud.com/RiYs…
 *
 * and that is exactly what one profile has stored. This function used to
 * prepend `https://` to whatever it was given, so the sentence became
 * `https://Listen to Cosmatik @ …` — a URL-shaped string that is not a URL.
 * The widget was then handed the encoded sentence and played nothing, which is
 * feedback #10's "then it didn't play".
 *
 * ⭐ AN EMBEDDED ABSOLUTE URL WINS. Extracting it is the whole fix, and it is
 * done here rather than at the call sites because this function already exists
 * to answer "what did this person mean" — ⛔ a second parser elsewhere is how
 * the two would drift apart.
 *
 * ⛔⛔ PROSE IS NOT AN ADDRESS. "I love soundcloud.com" contains the domain and
 * must NOT become `https://I love soundcloud.com`. Anything with whitespace
 * and no extractable URL returns '' — unaddressable, and the caller decides
 * what to do about it. Guessing produces a broken player that looks like a
 * broken app.
 */
export function normaliseSoundcloudInput(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';

  // 1 · An absolute URL anywhere in the text is the address, wherever it sits.
  //     ⚠ Trailing punctuation is excluded so "…/track." does not keep the dot.
  const embedded = /https?:\/\/[^\s<>"']+/i.exec(v);
  if (embedded) return embedded[0].replace(/[.,;:)\]]+$/, '');

  // 2 · Nothing further can be rescued from prose. ⛔ Never prefix a scheme
  //     onto something containing spaces.
  if (/\s/.test(v)) return '';

  // 3 · A bare handle, the same courtesy the social fields already extend.
  if (!v.includes('/') && /^[a-z0-9_-]+$/i.test(v)) {
    return `https://soundcloud.com/${v}`;
  }

  // 4 · A schemeless address — soundcloud.com/someone/a-set.
  return `https://${v}`;
}

/** Is this a SoundCloud address at all — including the share domain? */
export function isSoundcloud(url) {
  const v = String(url || '').toLowerCase();
  return v.includes('soundcloud.com') || v.includes('snd.sc');
}

/**
 * ⚠ A SHARE LINK IS THE DEFAULT THING SOMEBODY PASTES. SoundCloud's own share
 * sheet hands out `on.soundcloud.com`, so this is not an edge case — it is what
 * the copy button gives almost everyone, and it was the one shape that could
 * not play.
 */
export function isShareLink(url) {
  const v = String(url || '').toLowerCase();
  return v.includes('on.soundcloud.com') || v.includes('snd.sc');
}

/** Pull the `url=` parameter out of the iframe oEmbed hands back. */
export function canonicalFromOEmbedHtml(html) {
  const m = /[?&]url=([^&"']+)/.exec(String(html || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

/**
 * Ask SoundCloud what a link means, and get back something the widget plays.
 *
 * @returns {Promise<{url: string, title: string, thumbnail: string, resolved: boolean}>}
 *          `resolved: false` means oEmbed could not answer and `url` is the
 *          input unchanged — the caller carries on regardless.
 */
export async function resolveSoundcloud(raw, { fetchImpl = fetch } = {}) {
  const url = normaliseSoundcloudInput(raw);
  const miss = { url, title: '', thumbnail: '', resolved: false };
  if (!url || !isSoundcloud(url)) return miss;

  try {
    const r = await fetchImpl(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!r.ok) return miss;
    const d = await r.json();
    const canonical = canonicalFromOEmbedHtml(d?.html);
    return {
      // ⭐ The canonical resource when there is one, the original otherwise. A
      // profile URL already plays; only the share domain genuinely needs this.
      url: canonical || url,
      title: d?.title || '',
      thumbnail: d?.thumbnail_url || '',
      resolved: Boolean(canonical),
    };
  } catch {
    return miss;
  }
}
