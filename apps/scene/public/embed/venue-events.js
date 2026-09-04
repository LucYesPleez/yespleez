/**
 * THE YESPLEEZ VENUE EVENTS WIDGET — a venue's gig guide, on the venue's own
 * website.
 *
 *     <div data-yespleez-venue="<profile uuid>"></div>
 *     <script src="https://yespleez.com/embed/venue-events.js" async></script>
 *
 * ── THE EMBED'S OPTIONS ─────────────────────────────────────────────
 * All on the div, all optional, all falling back to a default when absent OR
 * unrecognised. ⭐ A snippet is pasted into a CMS ONCE and never revisited, so
 * a typo must render the default look, ⛔ never an error and ⛔ never nothing.
 *
 *   data-yespleez-venue    the venue profile id. The only required one.
 *   data-yespleez-theme    light (default) · dark · plain
 *   data-yespleez-layout   grid (default) · posters · list
 *   data-yespleez-columns  auto (default) · 1 · 2 · 3 · 4
 *   data-yespleez-accent   #rrggbb — colours the date line
 *   data-yespleez-limit    how many events, 1–50
 *
 * ── ⭐⭐ WHY PRESETS RATHER THAN "STYLE IT YOURSELF" ─────────────────
 * This script is served from yespleez.com, so its look can be improved for
 * EVERY venue at once by editing this file — nobody re-pastes anything. That
 * property is worth protecting: the moment venues hand-write CSS overrides
 * against these class names, the class names are a public API and the look can
 * never be changed again without breaking somebody's homepage.
 *
 * ⛔ So the answer to "can it look different" is a WORD, not a stylesheet. A
 * venue picks a preset; what that preset looks like stays ours.
 *
 * ⚠ `theme` defaults to `light`, ⛔ NOT to the transparent inherit-everything
 * behaviour this widget shipped with. In an iframe embed — which is what Wix,
 * Squarespace and most builders give you — the host page's CSS never reaches
 * the widget, so "inherit" inherited nothing and meant black text on whatever
 * photograph happened to be behind it. `plain` still exists for a page that
 * genuinely wants the widget to disappear into it; it is a choice now, not the
 * accident everyone got.
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
 * one `innerHTML` in this file and it is the stylesheet, which is a CONSTANT.
 * ⚠ The two attributes that take remote strings — an image `src` and a link
 * `href` — are scheme-checked, because `javascript:` in an href is the same
 * bug wearing a different hat.
 *
 * ── ⛔⛔ AND NO OPTION IS EVER INTERPOLATED INTO CSS ──────────────────
 * The presets are CLASS NAMES chosen from a fixed table, and the accent colour
 * is a CUSTOM PROPERTY set with `style.setProperty` — which the browser parses
 * and discards if it is not a colour. ⛔ Nothing an author typed is ever
 * concatenated into the stylesheet string, so the stylesheet stays a constant
 * and an embed cannot smuggle CSS into it.
 *
 * ── HOST-PAGE SAFETY ────────────────────────────────────────────────
 * Class names are prefixed and the stylesheet only ever names those classes, so
 * it cannot restyle the page it lands on. Nothing global is written except one
 * `<style>` element, added once however many widgets are on the page. The
 * accent is set on the MOUNT, so two widgets on one page can differ.
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

  /* ⛔ THE ALLOWED VALUES, AS TABLES. An option is looked UP, never trusted —
     anything not listed becomes the default, so a typo in a pasted snippet
     renders the standard look rather than an unstyled pile. */
  var THEMES = { light: 1, dark: 1, plain: 1 };
  var LAYOUTS = { grid: 1, posters: 1, list: 1 };
  var COLUMNS = { auto: 1, '1': 1, '2': 1, '3': 1, '4': 1 };

  /** #rgb · #rgba · #rrggbb · #rrggbbaa. ⛔ Nothing else reaches setProperty. */
  var HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  var CSS = [
    /* ── base ───────────────────────────────────────────────────── */
    '.ypz-ve{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.4}',
    '.ypz-ve *{box-sizing:border-box}',
    '.ypz-ve-list{display:grid;gap:14px;grid-template-columns:1fr;margin:0;padding:0;list-style:none}',
    '.ypz-ve-card{display:flex;flex-direction:column;border:1px solid transparent;border-radius:10px;overflow:hidden;text-decoration:none;color:inherit}',
    '.ypz-ve-card:hover,.ypz-ve-card:focus-visible{border-color:currentColor}',
    '.ypz-ve-img{display:block;width:100%;object-fit:cover;background:rgba(128,128,128,.15)}',
    '.ypz-ve-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px}',
    /* ⭐ The accent is a CUSTOM PROPERTY with a fallback, so the sheet stays a
       constant and an unset accent is simply the text colour. */
    '.ypz-ve-when{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ypz-ve-accent,currentColor);opacity:var(--ypz-ve-when-opacity,.75)}',
    '.ypz-ve-name{font-size:16px;font-weight:600;margin:0}',
    '.ypz-ve-desc{font-size:13px;opacity:.8;margin:0}',
    '.ypz-ve-note{font-size:14px;opacity:.75;margin:0;padding:8px 0}',
    '.ypz-ve-foot{font-size:11px;opacity:.6;margin:12px 0 0}',
    '.ypz-ve-foot a{color:inherit}',

    /* ── themes ─────────────────────────────────────────────────── */
    /* ⚠ A theme states BOTH a text colour and a card background. Stating only
       one is how the old default became illegible: transparent cards over a
       photograph, with the text colour left to whatever the document defaulted
       to. A preset that can be half-applied is not a preset. */
    '.ypz-ve--theme-light{color:#14110e}',
    '.ypz-ve--theme-light .ypz-ve-card{background:#fff;border-color:rgba(0,0,0,.14)}',
    '.ypz-ve--theme-dark{color:#f4f1ec}',
    '.ypz-ve--theme-dark .ypz-ve-card{background:rgba(12,10,9,.82);border-color:rgba(255,255,255,.16)}',
    /* `plain` is the original behaviour, kept deliberately: a page that wants
       the widget to vanish into it, or one styling the classes itself. */
    '.ypz-ve--theme-plain{color:inherit}',
    '.ypz-ve--theme-plain .ypz-ve-card{background:transparent;border-color:rgba(128,128,128,.35)}',

    /* ── columns ────────────────────────────────────────────────── */
    /* ⚠ A PINNED COUNT IS A MAXIMUM, NOT A PROMISE. Below 560px every layout is
       one column whatever was asked for — three cards across a phone is not a
       gig guide, and the venue pasting `columns="3"` is looking at a desktop. */
    '@media (min-width:560px){.ypz-ve--cols-auto .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-auto .ypz-ve-list{grid-template-columns:repeat(3,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-2 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-3 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-3 .ypz-ve-list{grid-template-columns:repeat(3,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-4 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-4 .ypz-ve-list{grid-template-columns:repeat(4,1fr)}}',

    /* ── layouts ────────────────────────────────────────────────── */
    /* GRID — the cover image, 3:2, the shape covers are uploaded at. */
    '.ypz-ve--layout-grid .ypz-ve-img{aspect-ratio:3/2}',

    /* POSTERS — portrait artwork, no blurb. A poster carries the bill and the
       date in the artwork itself, so a paragraph under it repeats the picture. */
    '.ypz-ve--layout-posters .ypz-ve-img{aspect-ratio:2/3}',
    '.ypz-ve--layout-posters .ypz-ve-desc{display:none}',

    /* LIST — a thumbnail beside the name. For a sidebar or a narrow column.
       ⚠ Three classes deep so it beats the column rules above, which are two:
       a list is one column by definition and must not be overridden into a
       grid by a `columns` attribute left in the snippet. */
    '.ypz-ve.ypz-ve--layout-list .ypz-ve-list{grid-template-columns:1fr;gap:10px}',
    '.ypz-ve--layout-list .ypz-ve-card{flex-direction:row;align-items:stretch}',
    '.ypz-ve--layout-list .ypz-ve-img{width:84px;flex:0 0 84px;aspect-ratio:1/1}',
    '.ypz-ve--layout-list .ypz-ve-body{justify-content:center}',
    '.ypz-ve--layout-list .ypz-ve-desc{display:none}',
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.innerHTML = CSS;              // a constant, defined above. ⛔ Nothing remote.
    document.head.appendChild(el);
  }

  /** An option, looked up in its table. Absent or unrecognised → the default. */
  function pick(mount, name, allowed, fallback) {
    var v = (mount.getAttribute('data-yespleez-' + name) || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(allowed, v) ? v : fallback;
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

    /* ⛔ CLASS NAMES FROM A FIXED TABLE — never a class built from raw input. */
    mount.classList.add('ypz-ve');
    mount.classList.add('ypz-ve--theme-' + pick(mount, 'theme', THEMES, 'light'));
    mount.classList.add('ypz-ve--layout-' + pick(mount, 'layout', LAYOUTS, 'grid'));
    mount.classList.add('ypz-ve--cols-' + pick(mount, 'columns', COLUMNS, 'auto'));

    /* ⭐ The accent goes in as a CUSTOM PROPERTY, on the mount, after a hex
       test — so it is scoped to this widget and can never be CSS. A value the
       regex somehow let through would still be discarded by the parser. */
    var accent = (mount.getAttribute('data-yespleez-accent') || '').trim();
    if (HEX.test(accent)) {
      mount.style.setProperty('--ypz-ve-accent', accent);
      /* Full strength: a venue that named a brand colour did not ask for 75% of it. */
      mount.style.setProperty('--ypz-ve-when-opacity', '1');
    }

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
