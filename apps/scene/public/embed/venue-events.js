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
 *   data-yespleez-accent   #rrggbb — colours the genre line under each title
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
    '.ypz-ve{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.45}',
    '.ypz-ve *{box-sizing:border-box}',
    '.ypz-ve-list{display:grid;gap:20px;grid-template-columns:1fr;margin:0;padding:0;list-style:none}',
    '.ypz-ve-card{display:flex;flex-direction:column;border:1px solid transparent;border-radius:3px;overflow:hidden;text-decoration:none;color:inherit}',
    '.ypz-ve-img{display:block;width:100%;object-fit:cover;background:rgba(128,128,128,.15)}',
    '.ypz-ve-body{padding:18px 18px 20px;display:flex;flex-direction:column;gap:14px;flex:1}',

    /* ── the head: a date BLOCK beside the title ─────────────────── */
    /* ⭐ The day is the thing a reader scans for, so it is a numeral at the
       edge of the card rather than a word buried in a sentence. */
    /* ⚠ `flex-start`, so the divider is the DATE STACK'S own height — a little
       rule beside FRI/12/SEP. ⛔ Not `stretch`: the description now lives in the
       title column, so stretching would draw a full-height bar down the card
       instead of the small mark between the date and the heading. */
    '.ypz-ve-head{display:flex;align-items:flex-start}',
    '.ypz-ve-date{flex:0 0 auto;text-align:center;line-height:1.02;padding:3px 13px 0 0;min-width:30px;border-right:1px solid}',
    '.ypz-ve-titles{min-width:0;padding-left:14px}',
    '.ypz-ve-dow,.ypz-ve-mon{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.55}',
    '.ypz-ve-day{display:block;font-size:26px;font-weight:700;letter-spacing:-.03em;margin:1px 0}',
    /* ⚠⚠ CLAMPED TO TWO LINES, and this is the mockup meeting real data. A
       designed comp says "MADSPIN BABY"; the row is actually called "The Friday
       Mix Up feat MADSPiN BABY 8:30pm", which sets four lines at 17px in a
       quarter-width card and wrecks the rhythm of the grid. ⛔ The widget does
       NOT trim the name itself — inventing a short title is the organiser's
       decision, not ours — it just stops drawing after two lines, and the whole
       name is on the event page one click away. */
    '.ypz-ve-name{font-size:17px;font-weight:700;letter-spacing:.01em;line-height:1.2;text-transform:uppercase;margin:0;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    /* The genre line. ⚠ Absent on a row with no genre — ⛔ never a placeholder. */
    '.ypz-ve-tag{font-size:13px;font-style:italic;color:var(--ypz-ve-accent,currentColor);opacity:var(--ypz-ve-tag-opacity,.65);margin-top:3px}',

    /* ⭐ MINIMAL BY CLAMP, ⛔ not by a shorter cap in the feed. How much of a
       blurb to show is a DISPLAY decision; what may be published is the feed's.
       Three lines here keeps every card the same shape whatever the organiser
       wrote, and the full text is one click away on the event page. */
    '.ypz-ve-desc{font-size:12.5px;opacity:.72;margin:0;display:-webkit-box;-webkit-line-clamp:4;line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px}',

    /* ── the meta rows: time and place, each with its own mark ───── */
    /* ⭐⭐ min-height IS THE RESERVATION. A row with no time renders EMPTY —
       no clock, no words — but still occupies its line, so the venue row and
       the button land on the same y on every card in the grid. ⚠ Reserving
       space asserts nothing; printing "TBA" would. That is the whole
       distinction, and it is why this is not a retreat from absent-stays-absent. */
    '.ypz-ve-meta{display:flex;align-items:center;gap:8px;font-size:12px;opacity:.7;min-height:17px}',
    '.ypz-ve-icon{flex:0 0 auto;width:13px;height:13px;opacity:.8}',
    '.ypz-ve-metas{display:flex;flex-direction:column;gap:7px;margin-top:auto;padding-top:4px}',

    /* ── the button ─────────────────────────────────────────────── */
    /* ⚠ A SPAN, not a link: the whole card is already an anchor and an anchor
       inside an anchor is invalid and unclickable in places. */
    '.ypz-ve-cta{display:block;text-align:center;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:12px 8px;border-radius:2px;margin-top:6px}',

    /* ── the footer ─────────────────────────────────────────────── */
    /* ⭐ THREE COLUMNS so the button is centred on the WIDGET, not shoved off
       centre by the credit beside it. The empty first column is load bearing. */
    '.ypz-ve-foot{margin:26px 0 0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}',
    '.ypz-ve-more{grid-column:2;display:inline-block;text-align:center;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:13px 30px;border:1px solid;border-radius:2px;text-decoration:none;color:inherit}',
    '.ypz-ve-credit{grid-column:3;justify-self:end;font-size:10.5px;opacity:.6;margin:0}',
    '.ypz-ve-credit a{color:inherit;font-weight:700;text-decoration:none}',
    '.ypz-ve-note{font-size:14px;opacity:.75;margin:0;padding:8px 0}',

    /* ── themes ─────────────────────────────────────────────────── */
    /* ⚠ A theme states BOTH a text colour and a card background. Stating only
       one is how the old default became illegible: transparent cards over a
       photograph, with the text colour left to whatever the document defaulted
       to. A preset that can be half-applied is not a preset. */

    /* ⭐ LIGHT PAINTS ITS OWN GROUND — a cream panel with white cards on it,
       and real padding around the lot. ⚠ That is a deliberate departure from
       "blend in": the whitespace IS the design, and a widget that inherited a
       cramped container would lose it. `plain` remains for a page that wants
       no panel at all. */
    '.ypz-ve--theme-light{color:#1a1714;background:#f4f2ed;padding:22px}',
    '.ypz-ve--theme-light .ypz-ve-card{background:#fff;border-color:rgba(0,0,0,.08);box-shadow:0 1px 2px rgba(0,0,0,.04)}',
    '.ypz-ve--theme-light .ypz-ve-date{border-right-color:rgba(0,0,0,.13)}',
    '.ypz-ve--theme-light .ypz-ve-cta{background:#1c1917;color:#fff}',
    '.ypz-ve--theme-light .ypz-ve-card:hover .ypz-ve-cta{background:#000}',
    '.ypz-ve--theme-light .ypz-ve-more{border-color:rgba(0,0,0,.25)}',
    '.ypz-ve--theme-light .ypz-ve-more:hover{border-color:#1c1917}',

    /* ⚠ DARK PAINTS NO GROUND, on purpose. A venue choosing the dark theme has
       a dark site, and a flat panel over the photograph they chose would hide
       the design rather than sit in it. The cards are translucent instead. */
    '.ypz-ve--theme-dark{color:#f4f1ec}',
    '.ypz-ve--theme-dark .ypz-ve-card{background:rgba(12,10,9,.82);border-color:rgba(255,255,255,.14)}',
    '.ypz-ve--theme-dark .ypz-ve-date{border-right-color:rgba(255,255,255,.18)}',
    '.ypz-ve--theme-dark .ypz-ve-cta{background:#f4f1ec;color:#14110e}',
    '.ypz-ve--theme-dark .ypz-ve-card:hover .ypz-ve-cta{background:#fff}',
    '.ypz-ve--theme-dark .ypz-ve-more{border-color:rgba(255,255,255,.3)}',
    '.ypz-ve--theme-dark .ypz-ve-more:hover{border-color:#f4f1ec}',

    /* `plain` is the original behaviour, kept deliberately: a page that wants
       the widget to vanish into it, or one styling the classes itself. */
    '.ypz-ve--theme-plain{color:inherit}',
    '.ypz-ve--theme-plain .ypz-ve-card{background:transparent;border-color:rgba(128,128,128,.35)}',
    '.ypz-ve--theme-plain .ypz-ve-date{border-right-color:rgba(128,128,128,.35)}',
    '.ypz-ve--theme-plain .ypz-ve-cta{border:1px solid;border-color:inherit}',
    '.ypz-ve--theme-plain .ypz-ve-more{border-color:inherit}',

    /* ── columns ────────────────────────────────────────────────── */
    /* ⚠ A PINNED COUNT IS A MAXIMUM, NOT A PROMISE. Below 560px every layout is
       one column whatever was asked for — three cards across a phone is not a
       gig guide, and the venue pasting `columns="3"` is looking at a desktop. */
    '@media (min-width:560px){.ypz-ve--cols-auto .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-auto .ypz-ve-list{grid-template-columns:repeat(4,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-2 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-3 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-3 .ypz-ve-list{grid-template-columns:repeat(3,1fr)}}',
    '@media (min-width:560px){.ypz-ve--cols-4 .ypz-ve-list{grid-template-columns:repeat(2,1fr)}}',
    '@media (min-width:900px){.ypz-ve--cols-4 .ypz-ve-list{grid-template-columns:repeat(4,1fr)}}',

    /* ── layouts ────────────────────────────────────────────────── */
    /* GRID — the full card: cover, date block, genre, blurb, meta, button. */
    '.ypz-ve--layout-grid .ypz-ve-img{aspect-ratio:3/2}',
    /* ⭐⭐ EVERY ZONE HAS A FLOOR, so the cards agree line for line: a one-line
       title does not pull the blurb up, and a missing genre does not lift the
       button. The floors are the CLAMP ceilings — two lines of title, one of
       genre, three of blurb — so a zone is reserved at exactly the size it can
       ever grow to, and no card is taller than its neighbour. */
    '.ypz-ve--layout-grid .ypz-ve-name{min-height:2.4em}',
    '.ypz-ve--layout-grid .ypz-ve-tag{min-height:1.45em}',
    '.ypz-ve--layout-grid .ypz-ve-desc{min-height:5.8em}',

    /* POSTERS — portrait artwork and the essentials. A poster already carries
       the bill and the date in the artwork, so the blurb repeats the picture. */
    '.ypz-ve--layout-posters .ypz-ve-img{aspect-ratio:2/3}',
    '.ypz-ve--layout-posters .ypz-ve-desc{display:none}',
    /* ⚠ The reservation is a GRID promise. A poster wall and a sidebar list are
       compact by definition, so an empty row there is dead space, not alignment. */
    '.ypz-ve--layout-posters .ypz-ve-meta:empty{display:none}',

    /* LIST — a thumbnail beside the name, for a sidebar or a narrow column.
       ⚠ Three classes deep so it beats the column rules above, which are two:
       a list is one column by definition and must not be overridden into a
       grid by a `columns` attribute left in the snippet. */
    '.ypz-ve.ypz-ve--layout-list .ypz-ve-list{grid-template-columns:1fr;gap:10px}',
    '.ypz-ve--layout-list .ypz-ve-card{flex-direction:row;align-items:stretch}',
    '.ypz-ve--layout-list .ypz-ve-img{width:92px;flex:0 0 92px;aspect-ratio:1/1}',
    '.ypz-ve--layout-list .ypz-ve-body{padding:10px 12px;gap:6px;justify-content:center}',
    '.ypz-ve--layout-list .ypz-ve-desc{display:none}',
    '.ypz-ve--layout-list .ypz-ve-cta{display:none}',
    '.ypz-ve--layout-list .ypz-ve-metas{margin-top:0}',
    '.ypz-ve--layout-list .ypz-ve-meta:empty{display:none}',
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
   * A YYYY-MM-DD split into the three pieces the date block stacks.
   *
   * ⚠ Parsed at LOCAL NOON, never midnight. `new Date('2026-09-11')` is UTC
   * midnight, which is the 10th in the Americas — either way the widget would
   * print a day the poster does not.
   */
  function dateParts(iso) {
    if (typeof iso !== 'string' || iso.length < 10) return null;
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    return { dow: DOW[d.getDay()], day: String(d.getDate()), mon: MON[d.getMonth()] };
  }

  /** "13 – 15 SEP" for the date block's day slot when an event runs on. */
  function daySpan(ev, parts) {
    var end = dateParts(ev.end_date);
    return end ? parts.day + '–' + end.day : parts.day;
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

  /**
   * The two little marks beside the time and the place.
   *
   * ⛔ BUILT WITH createElementNS, ⛔ NOT an innerHTML string of SVG. The one
   * innerHTML in this file is the stylesheet and it stays that way — an icon is
   * not worth reopening that door. The path data is a constant.
   */
  var ICONS = {
    clock: 'M8 3.4v4.9l3.2 1.9M14.2 8A6.2 6.2 0 1 1 1.8 8a6.2 6.2 0 0 1 12.4 0Z',
    pin: 'M8 1.8a4.6 4.6 0 0 0-4.6 4.6c0 3.4 4.6 7.8 4.6 7.8s4.6-4.4 4.6-7.8A4.6 4.6 0 0 0 8 1.8Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z',
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ypz-ve-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  /** One `icon + text` row, or nothing at all when there is no text. */
  function metaRow(iconName, text) {
    if (!text) return null;
    var row = el('div', 'ypz-ve-meta');
    row.appendChild(icon(iconName));
    row.appendChild(el('span', null, text));
    return row;
  }

  /**
   * ⚠⚠ EVERY ROW ON THIS CARD IS CONDITIONAL, and that is the whole distance
   * between a mockup and real data. Of the Federal Hotel's seven upcoming
   * events, TWO carry a start time and five do not. A card that printed "TBA",
   * or an empty clock row, for the other five would be stating a fact nobody
   * recorded. Absent stays absent and the card simply gets shorter.
   */
  function card(ev, venueLabel) {
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

    /* ── the head: the date as a BLOCK, beside the title ── */
    var head = el('div', 'ypz-ve-head');
    var parts = dateParts(ev.date);
    if (parts) {
      var date = el('div', 'ypz-ve-date');
      date.appendChild(el('span', 'ypz-ve-dow', parts.dow));
      date.appendChild(el('span', 'ypz-ve-day', daySpan(ev, parts)));
      date.appendChild(el('span', 'ypz-ve-mon', parts.mon));
      head.appendChild(date);
    }
    var titles = el('div', 'ypz-ve-titles');
    titles.appendChild(el('h3', 'ypz-ve-name', ev.name || 'Untitled event'));
    /* The genre line. An ARRAY from the feed, joined HERE — the separator is a
       display choice, and the feed deciding it would be the feed deciding a
       venue's typography. */
    var genres = Array.isArray(ev.genres) ? ev.genres.join(' · ') : '';
    /* ⚠ Emitted even when EMPTY, for the same reason as the meta rows below: a
       min-height reserves nothing if the element was never created, and a card
       with no genre would then pull its blurb up a line out of step with the
       rest of the row. Empty means empty — ⛔ no "Live music" stand-in. */
    titles.appendChild(el('div', 'ypz-ve-tag', genres));

    /* ⭐ THE BLURB LIVES IN THE TITLE COLUMN, ⛔ not across the card. It reads
       as belonging to the heading it sits under, and its left edge lines up
       with the title rather than with the date numeral. The time and place rows
       below DO run the full width — they describe the event, not the heading. */
    titles.appendChild(el('p', 'ypz-ve-desc', ev.description || ''));

    head.appendChild(titles);
    body.appendChild(head);

    /* ⭐⭐ THE ROWS ARE ALWAYS EMITTED, FILLED OR NOT. Five of the Federal
       Hotel's seven upcoming events have no start time, and a card that simply
       omitted the row would sit its venue line and its button a row higher than
       its neighbours — the grid would read as broken rather than as sparse.
       ⛔ An empty row carries NO icon and NO words: nothing is claimed, only
       reserved. `metaRow` returns null when there is nothing to say, and an
       empty `.ypz-ve-meta` holds the line by min-height alone. */
    var metas = el('div', 'ypz-ve-metas');
    metas.appendChild(metaRow('clock', ev.start_time || ev.doors) || el('div', 'ypz-ve-meta'));
    metas.appendChild(metaRow('pin', venueLabel) || el('div', 'ypz-ve-meta'));
    body.appendChild(metas);

    if (href) body.appendChild(el('span', 'ypz-ve-cta', 'View event'));

    a.appendChild(body);
    return a;
  }

  /** "The Federal Hotel, Bellingen" — whichever of the two the feed named. */
  function venueLabelOf(venue) {
    if (!venue) return '';
    return [venue.name, venue.town].filter(Boolean).join(', ');
  }

  function render(mount, data) {
    var events = (data && data.events) || [];
    if (!events.length) {
      note(mount, 'No upcoming events listed right now.');
      return;
    }
    mount.textContent = '';

    var venueLabel = venueLabelOf(data.venue);
    var list = el('ul', 'ypz-ve-list');
    for (var i = 0; i < events.length; i++) {
      var li = document.createElement('li');
      li.appendChild(card(events[i], venueLabel));
      list.appendChild(li);
    }
    mount.appendChild(list);

    var foot = el('div', 'ypz-ve-foot');

    /* ⭐ THE WAY BACK IN. Each card goes to one event; this goes to the venue's
       whole page on YesPleez, which is the thing the widget exists to feed.
       ⚠ Only when the feed actually named a venue url — ⛔ never a dead button. */
    var venueUrl = data.venue && safeUrl(data.venue.url);
    if (venueUrl) {
      var label = data.venue.name ? 'See all upcoming at ' + data.venue.name : 'See all upcoming events';
      var more = el('a', 'ypz-ve-more', label);
      more.href = venueUrl;
      more.target = '_blank';
      more.rel = 'noopener noreferrer';
      foot.appendChild(more);
    }

    var credit = el('p', 'ypz-ve-credit', 'Events powered by ');
    var brand = el('a', null, 'YesPleez');
    brand.href = origin;
    brand.target = '_blank';
    brand.rel = 'noopener noreferrer';
    credit.appendChild(brand);
    foot.appendChild(credit);

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
      mount.style.setProperty('--ypz-ve-tag-opacity', '1');
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
