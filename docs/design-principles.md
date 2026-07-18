# YesPleez — Design Principles

Cross-cutting product/UX standards that apply across the YesPleez ecosystem
(Scene, Festival, Operations, Budget Builder, Studio, Set Times). Distinct from
the frozen identity/architecture governance in `docs/architecture/` — these are
UX standards, adopted as each surface is touched.

---

## 1. Date & time selection is picker-only

**All dates, times, and date-ranges are chosen through a standardised picker.
Manual free-text entry of dates or times is not permitted.**

Consistent, tappable date/time selection reads as polish; free-text fields
accept nonsense. (Concrete trigger, 2026-07-18: a native date field in the
enquiry form accepted a hand-typed `05/06/0006` — day 05, month 06, year
**0006**.)

Implementation notes:
- New date/time UI must use a picker — or one-tap **presets** — never a bare
  text input.
- **A native `<input type="date">` / `type="time"` is not sufficient on its
  own.** It still allows keyboard entry of the segments (that is exactly how the
  `0006` got in). Fully honouring this means a custom picker component, or a
  constrained native input (min/max + validation/normalisation). Treat that as
  planned work, not a solved problem, whenever a native input is in play.
- Native date/time controls must carry `color-scheme: dark` so their popups
  render on-theme (see the InviteSheet LENGTH-select fix, 2026-07-18).
- Prefer one-tap **presets** for common relative dates (e.g. "1 week from now")
  so the common case needs no picker interaction at all.

**Status:** adopted 2026-07-18. Auditing and converting existing date/time
inputs across every app is deferred to a dedicated platform-wide pass.
