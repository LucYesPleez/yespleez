/**
 * The days an applicant can offer, built from the organiser's dates.
 *
 * ⭐ NOT A QUESTION THE ORGANISER WRITES. Every real volunteer form lists its
 * own dates by hand — Dragon Dreaming's runs "Wed Sept 23 (Setup)" through
 * "Thurs Oct 1 (Pack Down)" — which is thirteen chances to typo a date that
 * already exists as festival configuration. Derive it instead: set the build,
 * festival and pack-down ranges once and the list writes itself.
 *
 * Returns [] when no dates are set. An empty list is a real state — a festival
 * that has not chosen dates cannot ask anyone which of them they can work —
 * and the caller renders nothing rather than an empty dropdown.
 */
const PHASES = [
  ['buildStartsOn', 'buildEndsOn', 'build'],
  ['startsOn', 'endsOn', 'festival'],
  ['packdownStartsOn', 'packdownEndsOn', 'pack-down'],
];

function eachDay(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  // Guard against a reversed or absurd range rather than looping forever: the
  // organiser can type an end date before the start, and a UI that hangs is a
  // worse answer than one that shows nothing.
  let guard = 0;
  while (d <= end && guard++ < 400) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function dayOptions(settings) {
  if (!settings) return [];
  const out = [];
  for (const [fromKey, toKey, phase] of PHASES) {
    const from = settings[fromKey];
    const to = settings[toKey] || settings[fromKey];
    if (!from) continue;
    for (const day of eachDay(from, to)) {
      const iso = day.toISOString().slice(0, 10);
      const label = day.toLocaleDateString('en-AU', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      // Deduplicate: pack-down starting the day the festival ends is normal,
      // and the same date twice in one list reads as a bug.
      if (out.some(o => o.value === iso)) continue;
      out.push({ value: iso, label: `${label} (${phase})` });
    }
  }
  return out;
}
