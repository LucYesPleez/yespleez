/**
 * THE YESPLEEZ VENUE EVENTS WIDGET — a venue's gig guide, on the venue's own
 * website.
 *
 *     <div data-yespleez-venue="<profile uuid>"></div>
 *     <script src="https://yespleez.com/embed/venue-events.js" async></script>
 *
 * ── ⛔ WHAT THIS FILE IS NOT ─────────────────────────────────────────
 * It is NOT part of the app bundle, imports nothing, and is served as a plain
 * static asset from `public/`. It must keep working on a site that loads it
 * once and never updates the snippet again, so:
 *
 *   ⛔ no Supabase client and NO KEY OF ANY KIND — it talks to
 *      `/api/venue-events`, which is public and anonymous. A key pasted into a
 *      third-party CMS is a key you cannot rotate.
 *   ⛔ no dependency on a YesPleez session, cookie or login. The request is
 *      identical for a signed-in reader and a stranger, which is what makes the
 *      response cacheable and the widget embeddable anywhere.
 *   ⛔ no framework, no build step, no CSS file. One `<script>` tag is the
 *      entire integration surface.
 *
 * ── ⛔⛔ EVERY VALUE IS SET WITH textContent, NEVER innerHTML ─────────
 * Event names and blurbs are typed by organisers and imported from posters.
 * This script runs INSIDE SOMEBODY ELSE'S SITE, so a `<script>` in an event
 * name would execute in their origin, against their visitors. There is exactly
 * one `innerHTML` in this file and it is the stylesheet, which is a constant.
 * ⚠ The two attributes that take remote strings — an image `src` and a link
 * `href` — are scheme-checked, because `javascript:` in an href is the same
 * bug wearing a different hat.
 *
 * ── HOST-PAGE SAFETY ────────────────────────────────────────────────
 * Class names are prefixed and the stylesheet only ever names those classes, so
 * it cannot restyle the page it lands on. Nothing global is written except one
 * `<style>` element, added once however many widgets are on the page.
 */
(function () {
  'use strict';

  var STYLE_ID = 'yespleez-venue-events-style';
  var SELECTOR = '[data-yespleez-venue]';

  /**
   * Where the API lives — read off THIS SCRIPT'S OWN URL.
   *
   * ⭐ So one snippet works against production, a Pages preview and a local
   * `vite preview` with no edit. `document.currentScript` is only readable
   * while the script is executing, hence the capture at load time.
   * ⛔ Not `window.location.origin` — that is the VENUE'S website.
   */
  var origin = (function () {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL(src).origin;
    } catch { /* fall through */ }
    return 'https://yespleez.com';
  })();

  var CSS = [
    '.ypz-ve{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.4;color:inherit}',
    '.ypz-ve *{box-sizing:border-box}',
    '.ypz-ve-list{display:grid;gap:14px;grid-template-columns:1fr;margin:0;padding:0;list-style:none}',
    '@media (min-width:560px){.ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve-list{grid-template-columns:repeat(3,1fr)}}',
    '.ypz-ve-card{display:flex;flex-direction:column;border:1px solid rgba(128,128,128,.35);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;background:transparent}',
    '.ypz-ve-card:hover,.ypz-ve-card:focus-visible{border-color:currentColor}',
    '.ypz-ve-img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;background:rgba(128,128,128,.15)}',
    '.ypz-ve-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px}',
    '.ypz-ve-when{font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.75}',
    '.ypz-ve-name{font-size:16px;font-weight:600;margin:0}',
    '.ypz-ve-desc{font-size:13px;opacity:.8;margin:0}',
    '.ypz-ve-note{font-size:14px;opacity:.75;margin:0;padding:8px 0}',
    '.ypz-ve-foot{font-size:11px;opacity:.6;margin:12px 0 0}',
    '.ypz-ve-foot a{color:inherit}',
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.innerHTML = CSS;              // a constant, defined above. ⛔ Nothing remote.
    document.head.appendChild(el);
  }

  /** ⛔ http/https only. A remote string in an href or src is a scheme away
   *  from being script that runs in the host site's origin. */
  function safeUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var u = new URL(value, origin);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch {
      return null;
    }
  }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * "Fri 11 Sep · 8:30pm" — built from the YYYY-MM-DD the feed sends.
   *
   * ⚠ Parsed at LOCAL NOON, never midnight. `new Date('2026-09-11')` is UTC
   * midnight, which is the 10th in the Americas and can be the 12th nowhere —
   * either way the widget would print a day the poster does not.
   */
  function whenLabel(ev) {
    var out = '';
    if (typeof ev.date === 'string' && ev.date.length >= 10) {
      var d = new Date(ev.date + 'T12:00:00');
      if (!isNaN(d.getTime())) out = DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
      if (out && typeof ev.end_date === 'string' && ev.end_date.length >= 10) {
        var e = new Date(ev.end_date + 'T12:00:00');
        if (!isNaN(e.getTime())) out += ' – ' + e.getDate() + ' ' + MON[e.getMonth()];
      }
    }
    var clock = ev.start_time || ev.doors;
    if (clock) out = out ? out + ' · ' + clock : String(clock);
    return out;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null && text !== '') node.textContent = String(text);   // ⛔ never innerHTML
    return node;
  }

  function note(mount, text) {
    mount.textContent = '';
    mount.appendChild(el('p', 'ypz-ve-note', text));
  }

  function card(ev) {
    var href = safeUrl(ev.url);
    var a = document.createElement(href ? 'a' : 'div');
    a.className = 'ypz-ve-card';
    if (href) {
      a.href = href;
      a.target = '_blank';
      /* ⛔ `noopener` is not optional in an embed: without it the YesPleez tab
         gets a handle on the venue's own window and can navigate it away. */
      a.rel = 'noopener noreferrer';
    }

    var img = safeUrl(ev.image);
    if (img) {
      var picture = el('img', 'ypz-ve-img');
      picture.src = img;
      picture.loading = 'lazy';
      picture.alt = '';                       // decorative; the name is right below it
      a.appendChild(picture);
    }

    var body = el('div', 'ypz-ve-body');
    var when = whenLabel(ev);
    if (when) body.appendChild(el('div', 'ypz-ve-when', when));
    body.appendChild(el('h3', 'ypz-ve-name', ev.name || 'Untitled event'));
    if (ev.description) body.appendChild(el('p', 'ypz-ve-desc', ev.description));
    a.appendChild(body);
    return a;
  }

  function render(mount, data) {
    var events = (data && data.events) || [];
    if (!events.length) {
      note(mount, 'No upcoming events listed right now.');
      return;
    }
    mount.textContent = '';
    var list = el('ul', 'ypz-ve-list');
    for (var i = 0; i < events.length; i++) {
      var li = document.createElement('li');
      li.appendChild(card(events[i]));
      list.appendChild(li);
    }
    mount.appendChild(list);

    var foot = el('p', 'ypz-ve-foot');
    var link = el('a', null, 'Listings by YesPleez');
    var venueUrl = data.venue && safeUrl(data.venue.url);
    link.href = venueUrl || origin;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.appendChild(link);
    mount.appendChild(foot);
  }

  function mountOne(mount) {
    if (mount.getAttribute('data-yespleez-mounted') === '1') return;
    mount.setAttribute('data-yespleez-mounted', '1');
    mount.classList.add('ypz-ve');

    var venue = (mount.getAttribute('data-yespleez-venue') || '').trim();
    if (!venue) { note(mount, 'YesPleez: no venue id set on this embed.'); return; }

    var url = origin + '/api/venue-events?venue=' + encodeURIComponent(venue);
    var limit = (mount.getAttribute('data-yespleez-limit') || '').trim();
    if (limit) url += '&limit=' + encodeURIComponent(limit);

    note(mount, 'Loading events…');

    /* ⛔ NO CREDENTIALS. Stated rather than defaulted: this request must be
       identical whoever makes it, or the shared cache in front of it is wrong. */
    fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (data) { render(mount, data); })
      .catch(function () {
        /* ⛔ The reader is told nothing technical. This renders on somebody
           else's homepage, where a stack trace is worse than a quiet line. */
        note(mount, 'Events are unavailable right now.');
      });
  }

  function start() {
    ensureStyle();
    var mounts = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < mounts.length; i++) mountOne(mounts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
