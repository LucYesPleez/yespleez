// § 8 · Event Details
//
// Spec: docs/event-page-layout-spec.md § 8
//
// A lookup table, not a narrative — visually lighter than the Lineup above it.
//
// ⛔ NO DATE AND NO TICKETS. The date is stated in Identity; tickets are
// consolidated into the Decision block and the sticky bar. The reference
// concept had both here, which made tickets the third place on one page where
// tickets were mentioned and none of them primary. Do not add them back.
//
// Rows are independent: the card renders at one or more, and hides at zero.
//
// ⚠ ABSENCE NEVER IMPLIES A DEFAULT. No age row shown must not read as "all
// ages" — that is a licensing claim made on the organiser's behalf. Every row
// here says only what was actually recorded.

import {
  ClockIcon, StageIcon, IdIcon, AccessIcon, BagIcon, CarIcon, InfoIcon,
} from './eventIcons';
import s from './EventSections.module.css';

const ICONS = {
  doors:         ClockIcon,
  stages:        StageIcon,
  age:           IdIcon,
  accessibility: AccessIcon,
  bring:         BagIcon,
  parking:       CarIcon,
  camping:       BagIcon,
  refunds:       InfoIcon,
};

export default function EventDetails({ rows = [] }) {
  const usable = (rows || []).filter(r => r && r.label && r.value);
  if (!usable.length) return null;   // R1 · absent

  return (
    <section className={s.card}>
      <div className={s.headRow}><h2 className={s.heading}>EVENT DETAILS</h2></div>
      {/* Two columns on desktop, one on phone — the split lives in the
          stylesheet so the row markup does not care which it is in. */}
      <div className={s.detailGrid}>
        {usable.map(row => {
          const Icon = ICONS[row.key] || InfoIcon;
          return (
            <div className={s.detailRow} key={row.key || row.label}>
              <Icon size={16} className={s.detailIcon} />
              <div style={{ minWidth: 0 }}>
                <div className={s.detailLabel}>{row.label}</div>
                <div className={s.detailValue}>{row.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
