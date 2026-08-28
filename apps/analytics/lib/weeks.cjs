/**
 * YesPleez Studio — REPORTING WEEKS (pure).
 * ---------------------------------------------------------------------------
 * One canonical definition of "a week" for every YesPleez figure, and the
 * conversion between that and the UTC instants `usage_events.created_at` is
 * stored in.
 *
 * ⭐⭐ THE CANONICAL ZONE IS Australia/Sydney. Not UTC, and not the operator's
 * machine. A week that shifts when someone opens the dashboard from another
 * timezone is not a reporting period, it is a coincidence — and UTC weeks put
 * Sunday night's gigs, the busiest hours this platform has, in the following
 * week for every Australian reading them.
 *
 * ⭐ WEEK = MONDAY 00:00:00.000 → SUNDAY 23:59:59.999, Sydney local.
 * ISO-8601's boundary, and the one every Australian venue already uses when it
 * says "this week". `week_start` and `week_end` are stored as LOCAL DATES, so a
 * snapshot names the days a human would name.
 *
 * ⚠⚠ A REPORTING WEEK IS NOT ALWAYS 168 HOURS. Sydney observes daylight saving,
 * so the week containing a transition is 167 or 169 hours long. Every boundary
 * here is therefore computed in LOCAL time and then converted to a UTC instant.
 * ⛔ NEVER derive the end of a week by adding 7 * 86400000 to its start: on the
 * two transition weeks each year that is off by an hour, which silently moves
 * every event in that hour into the neighbouring week, in both directions, and
 * the totals still add up so nothing looks wrong.
 *
 * No network, no filesystem, no Supabase knowledge — same contract as
 * analytics-rollup.js.
 *
 * Public API (CommonJS; also attaches to window if loaded in a page):
 *   ZONE, WEEK_STARTS_ON
 *   sydneyParts(date)         -> {y,m,d,H,M,S,weekday}
 *   localDate(date)           -> 'YYYY-MM-DD', the Sydney calendar day
 *   startOfLocalDay(date, n)  -> Date, Sydney midnight n days from that day
 *   weekOf(date)              -> {weekStart, weekEnd, startUTC, endUTC, ...}
 *   previousWeek(week)        -> the week before it
 *   recentWeeks(date, n)      -> n completed weeks, newest first
 *   isoWeekLabel(week)        -> 'W33'
 *   formatRange(week)         -> '10–16 Aug 2026'
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YPAnalyticsWeeks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ZONE = 'Australia/Sydney';
  var WEEK_STARTS_ON = 1;              // Monday, ISO-8601

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * What the wall clock in Sydney reads at a given instant.
   *
   * ⚠ Intl, not an offset constant. Sydney is +10 or +11 depending on the date,
   * and the changeover dates move every year — a hard-coded offset is wrong for
   * roughly half the calendar and wrong in a way that only shows up as events
   * landing in the wrong day near midnight.
   */
  var FMT = new Intl.DateTimeFormat('en-AU', {
    timeZone: ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });

  function sydneyParts(date) {
    var parts = {};
    FMT.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    return {
      y: Number(parts.year),
      m: Number(parts.month),
      d: Number(parts.day),
      // ⚠ en-AU renders midnight as hour "24", not "00". Left unmapped this
      // reads as hour 24 of the correct day, which is one hour past the end of
      // it — and midnight is exactly where week boundaries live.
      H: Number(parts.hour) % 24,
      M: Number(parts.minute),
      S: Number(parts.second),
      weekday: WEEKDAYS.indexOf(parts.weekday),
    };
  }

  /** 'YYYY-MM-DD' from local parts. ⛔ Never toISOString: that is UTC. */
  function ymd(p) {
    return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }

  /**
   * The UTC instant at which a given Sydney wall-clock time occurs.
   *
   * ⚠ TWO PASSES, AND THE SECOND ONE IS NOT OPTIONAL. Guessing the offset from
   * the naive UTC value is wrong whenever the guess lands on the other side of
   * a daylight-saving change: re-reading the clock at the candidate instant and
   * correcting by the residual error converges, because the offset is locally
   * constant either side of the jump.
   *
   * ⚠ On the spring-forward night 02:00–02:59 does not exist. This resolves
   * such a time to the instant the clock jumps to, which is the only answer
   * that keeps a week contiguous. Week boundaries are at midnight, so this
   * never bites in practice — it is here so it cannot bite later.
   */
  function utcForSydney(y, m, d, H, M, S, ms) {
    var guess = Date.UTC(y, m - 1, d, H, M, S, ms || 0);
    for (var i = 0; i < 3; i++) {
      var p = sydneyParts(new Date(guess));
      var actual = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S, 0);
      var wanted = Date.UTC(y, m - 1, d, H, M, S, 0);
      var drift = wanted - actual;
      if (drift === 0) break;
      guess += drift;
    }
    return new Date(guess);
  }

  function addDaysLocal(p, n) {
    // Calendar arithmetic on the LOCAL date, then re-resolved to an instant.
    // Date.UTC here is a pure calendar helper — no timezone meaning is implied
    // and none is used; only y/m/d come back out.
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /**
   * The Sydney calendar day an instant falls on, as 'YYYY-MM-DD'.
   *
   * ⭐⭐ THIS IS WHAT "TODAY" MEANS IN EVERY YESPLEEZ FIGURE, and it is the only
   * function allowed to answer that question. `created_at.slice(0, 10)` looks
   * like the same answer and is not: the column is a UTC instant, so between
   * Sydney midnight and 10am (11am in daylight saving) it names YESTERDAY. Every
   * morning, the entire day's traffic so far is filed under the previous date
   * and the chart's last bar reads as an empty day rather than an early one.
   *
   * ⛔ Never `String(created_at).slice(0, 10)`, never `toISOString().slice(0,10)`,
   * never `getDate()` — the last one is the operator's machine, which is Sydney
   * today and something else the moment anyone travels or a server runs this.
   */
  function localDate(date) {
    return ymd(sydneyParts(date instanceof Date ? date : new Date(date)));
  }

  /**
   * Sydney midnight, `offsetDays` from the day `date` falls on, as a UTC instant.
   * Negative offsets go back: `startOfLocalDay(now, -6)` is the start of a 7-day
   * window whose last day is today.
   *
   * ⚠ Calendar arithmetic on the LOCAL date, then resolved to an instant — the
   * same two-step every boundary in this file uses, and for the same reason:
   * subtracting `n * 86400000` is off by an hour across a daylight-saving change
   * and lands the window on 23:00 or 01:00 instead of midnight.
   */
  function startOfLocalDay(date, offsetDays) {
    var p = sydneyParts(date instanceof Date ? date : new Date(date));
    var d = addDaysLocal(p, offsetDays || 0);
    return utcForSydney(d.y, d.m, d.d, 0, 0, 0, 0);
  }

  /**
   * The reporting week containing `date`.
   *
   * Returns local dates for humans and UTC instants for querying:
   *   weekStart 'YYYY-MM-DD'  Monday, Sydney
   *   weekEnd   'YYYY-MM-DD'  Sunday, Sydney
   *   startUTC  Date          Monday 00:00:00.000 Sydney, as an instant
   *   endUTC    Date          the instant the NEXT week begins — see below
   *
   * ⚠ `endUTC` IS EXCLUSIVE, and every query against it must use `<`, never
   * `<=`. An inclusive end would need 23:59:59.999 and would drop any event
   * recorded in the final millisecond; a half-open interval cannot double-count
   * or skip, which is the only property that matters when weeks are laid end to
   * end.
   */
  function weekOf(date) {
    var p = sydneyParts(date instanceof Date ? date : new Date(date));
    var back = (p.weekday - WEEK_STARTS_ON + 7) % 7;
    var mon = addDaysLocal(p, -back);
    var sun = addDaysLocal(mon, 6);
    var nextMon = addDaysLocal(mon, 7);
    return {
      weekStart: ymd(mon),
      weekEnd: ymd(sun),
      startUTC: utcForSydney(mon.y, mon.m, mon.d, 0, 0, 0, 0),
      endUTC: utcForSydney(nextMon.y, nextMon.m, nextMon.d, 0, 0, 0, 0),
      zone: ZONE,
    };
  }

  function previousWeek(week) {
    return weekOf(new Date(week.startUTC.getTime() - 86400000));
  }

  /**
   * The `n` most recently COMPLETED weeks, newest first.
   * ⛔ Excludes the week `date` falls in — a week in progress is not history,
   * and putting it in the same list invites comparing four days against seven.
   */
  function recentWeeks(date, n) {
    var out = [];
    var w = previousWeek(weekOf(date));
    for (var i = 0; i < n; i++) { out.push(w); w = previousWeek(w); }
    return out;
  }

  /**
   * ISO-8601 week number. Thursday rule: the week belongs to the year that its
   * Thursday falls in, which is why W01 can start in December.
   */
  function isoWeekLabel(week) {
    var s = week.weekStart.split('-').map(Number);
    var thu = new Date(Date.UTC(s[0], s[1] - 1, s[2] + 3));
    var jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    var n = Math.floor((thu - jan1) / 86400000);
    return 'W' + String(Math.floor(n / 7) + 1).padStart(2, '0');
  }

  /** '10–16 Aug 2026', collapsing the month and year when they are shared. */
  function formatRange(week) {
    var a = week.weekStart.split('-').map(Number);
    var b = week.weekEnd.split('-').map(Number);
    var left = a[2] + (a[1] === b[1] && a[0] === b[0] ? '' : ' ' + MONTHS[a[1] - 1]) +
               (a[0] === b[0] ? '' : ' ' + a[0]);
    return left + '–' + b[2] + ' ' + MONTHS[b[1] - 1] + ' ' + b[0];
  }

  return {
    ZONE: ZONE,
    WEEK_STARTS_ON: WEEK_STARTS_ON,
    sydneyParts: sydneyParts,
    localDate: localDate,
    startOfLocalDay: startOfLocalDay,
    weekOf: weekOf,
    previousWeek: previousWeek,
    recentWeeks: recentWeeks,
    isoWeekLabel: isoWeekLabel,
    formatRange: formatRange,
  };
});
