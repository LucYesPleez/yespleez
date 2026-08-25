import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { resolveHeroMedia, heroMediaInputsFromConfig } from '@yespleez/event-presentation';
import { Icon } from '../design-system';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { sceneEventUrl, SCENE_URL } from '../config/scene';
import { buildLanding } from './landingModel';
import s from './FestivalLandingScreen.module.css';

/**
 * THE FESTIVAL LANDING PAGE — this app's ONE public surface.
 *
 * ⭐ OWNER'S DECISION, 2026-08-26, revising the 2026-08-06 "no public face"
 * ruling: a festival needs a front door its own website can link to. What
 * SURVIVES from that ruling is the part that mattered: there is still exactly
 * ONE public apply surface, and it is Scene's event page. This page writes
 * nothing and asks nothing. Every APPLY on it hands the visitor to Scene,
 * where `FestivalApply` writes `festival_applications` — the one table the
 * organiser's dashboard reads.
 *
 * ⛔ Do not add a form, an apply button that writes, or a sign-in to this
 * page. The moment it writes, it is the second public apply surface the
 * 2026-08-06 ruling deleted.
 *
 * ⭐ DATA-DRIVEN, NEVER A FESTIVAL'S NAME IN THE CODE. The page renders any
 * live festival-owned event from its rows: profile identity, event settings
 * dates, open categories, departments. A second festival gets this page by
 * existing, not by an engineer copying a component.
 *
 * ⭐ ABSENT RENDERS AS NOTHING (FESTIVAL_UX_v1 §2.8). No tagline means no
 * tagline line; no dates means no dates row; no poster means the typographic
 * hero. Never a placeholder apologising for itself, never "Coming soon".
 *
 * ⚠ Anonymous by design — see publicLandingRepository. Anon only sees a LIVE
 * event, so a draft renders the not-available state for the world while the
 * organiser's own preview works. Always verify this page signed out.
 */
export default function FestivalLandingScreen() {
  const { eventId } = useParams();
  const { publicLanding } = useRepositories();
  const applyRef = useRef(null);
  const { data, loading } = useQuery(() => publicLanding.getLanding(eventId), [eventId]);

  // The tab should say where the visitor is. Restored on unmount so the
  // organiser side keeps its own name if navigation ever crosses over.
  useEffect(() => {
    if (!data?.found) return undefined;
    const prev = document.title;
    document.title = data.event.name || data.profile.name || prev;
    return () => { document.title = prev; };
  }, [data]);

  if (loading) return <div className={s.page} aria-busy="true" />;
  if (!data?.found) return <NotAvailable />;

  const vm = buildLanding(data);
  const applyHref = sceneEventUrl(vm.eventId);
  const hero = resolveHeroMedia(heroMediaInputsFromConfig(data.event.config));
  const fallbackImage = data.profile.avatar_hero || data.profile.avatar || null;
  const heroStyle = heroBackground(hero, fallbackImage);

  return (
    <div className={s.page}>
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <header className={s.hero}>
        {heroStyle
          ? <div className={s.heroMedia} style={heroStyle} aria-hidden="true" />
          : <div className={s.heroFallback} aria-hidden="true" />}
        <div className={s.heroScrim} aria-hidden="true" />
        <div className={s.heroContent}>
          <h1 className={s.title}>{vm.title}</h1>
          {vm.tagline && <p className={s.tagline}>{vm.tagline}</p>}
          {(vm.dates || vm.location) && (
            <div className={s.metaRow}>
              {vm.dates && (
                <span className={s.metaItem}><Icon name="calendar" size={16} /> {vm.dates}</span>
              )}
              {vm.location && (
                <span className={s.metaItem}><Icon name="location" size={16} /> {vm.location}</span>
              )}
            </div>
          )}
          {vm.applicationsOpen && (
            /* ⚠ A button scrolling by ref, NOT href="#apply" — this app is a
               HashRouter, so an anchor hash would navigate the router. */
            <button
              type="button"
              className={s.cta}
              onClick={() => applyRef.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              Apply to be part of it
            </button>
          )}
        </div>
      </header>

      <main className={s.body}>
        {/* ── APPLICATIONS ─────────────────────────────────────────── */}
        <section ref={applyRef} className={s.section}>
          <h2 className={s.h2}>Applications</h2>
          {vm.applicationsOpen ? (
            <>
              <p className={s.lede}>
                {vm.festivalName ? `Be part of ${vm.festivalName}.` : 'Be part of it.'} Choose
                what you want to apply for.
              </p>
              <div className={s.catGrid}>
                {vm.apply.map(cat => (
                  <CategoryCard key={cat.key} cat={cat} href={applyHref} />
                ))}
              </div>
              <p className={s.finePrint}>
                Applying happens on YesPleez. You sign in or create a free profile, and your
                profile is your application. No forms to fill out twice.
              </p>
            </>
          ) : (
            /* Closed is stated plainly rather than the section vanishing: the
               whole reason a visitor followed this link is to find out. */
            <p className={s.closedNote}>Applications aren't open right now.</p>
          )}
        </section>

        {/* ── ABOUT ────────────────────────────────────────────────── */}
        {vm.about && (
          <section className={s.section}>
            <h2 className={s.h2}>About</h2>
            {vm.about.split(/\n{2,}/).map((para, i) => (
              <p key={i} className={s.para}>{para}</p>
            ))}
          </section>
        )}

        {/* ── LOCATION ─────────────────────────────────────────────── */}
        {(vm.location || vm.mapsUrl) && (
          <section className={s.section}>
            <h2 className={s.h2}>Location</h2>
            {vm.location && (
              <p className={s.locationLine}>
                <Icon name="location" size={18} /> {vm.location}
              </p>
            )}
            {vm.mapsUrl && (
              <a className={s.mapLink} href={vm.mapsUrl} target="_blank" rel="noopener noreferrer">
                Open in Google Maps <Icon name="external" size={13} />
              </a>
            )}
          </section>
        )}

        {/* ── IMPORTANT DATES ──────────────────────────────────────── */}
        <ImportantDates vm={vm} />
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────
          The festival's identity leads everywhere above; this is the one
          place YesPleez appears, and quietly. */}
      <footer className={s.footer}>
        <div className={s.footerInner}>
          {vm.website
            ? (
              <a className={s.siteLink} href={vm.website} target="_blank" rel="noopener noreferrer">
                {websiteLabel(vm.website)}
              </a>
            )
            : <span />}
          <span className={s.powered}>
            Powered by <a href={SCENE_URL} target="_blank" rel="noopener noreferrer">YesPleez</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function CategoryCard({ cat, href }) {
  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <div className={s.cardIcon}><Icon name={cat.icon} size={22} /></div>
        <h3 className={s.cardTitle}>{cat.label}</h3>
      </div>
      <p className={s.cardLine}>{appliesLine(cat)}</p>
      {cat.departments.length > 0 && (
        <ul className={s.deptList}>
          {cat.departments.map(d => <li key={d} className={s.dept}>{d}</li>)}
        </ul>
      )}
      {cat.closesOn && <p className={s.closes}>Applications close {cat.closesOn}</p>}
      <a className={s.applyBtn} href={href} target="_blank" rel="noopener noreferrer">
        Apply <Icon name="external" size={14} />
      </a>
    </article>
  );
}

/* What this category is open to, stated from the registry rather than
   invented per festival. `punter` means anyone with an account. */
function appliesLine(cat) {
  if (cat.appliesAs.includes('punter')) {
    return 'Anyone can volunteer. Every YesPleez account comes with the profile you need.';
  }
  const types = cat.appliesAs.join(' or ');
  return `Apply with your ${types} profile. The organiser reviews the profile itself.`;
}

function ImportantDates({ vm }) {
  const rows = [
    vm.dates && { label: 'Festival', value: vm.dates },
    ...vm.apply
      .filter(c => c.closesOn)
      .map(c => ({ label: `${c.label} applications close`, value: c.closesOn })),
  ].filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <section className={s.section}>
      <h2 className={s.h2}>Important dates</h2>
      <dl className={s.dates}>
        {rows.map(r => (
          <div key={r.label} className={s.dateRow}>
            <dt className={s.dateLabel}>{r.label}</dt>
            <dd className={s.dateValue}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* One state for every honest miss: wrong link, a draft the world cannot see,
   or an event that is not a festival's. The page cannot tell them apart and
   must not guess at whose fault it is. */
function NotAvailable() {
  return (
    <div className={s.page}>
      <div className={s.missing}>
        <div className={s.missingInner}>
          <p className={s.missingTitle}>This festival page isn't available</p>
          <p className={s.missingNote}>
            The link may be incorrect, or the festival hasn't published this event yet.
          </p>
        </div>
      </div>
    </div>
  );
}

/* The hero takes what exists and no more: the shared ladder's answer first,
   the festival's own image second, the typographic wash last. The crop mode's
   `cropY` maps to a background position — an approximation of the organiser's
   band, not a re-implementation of Scene's crop renderer. */
function heroBackground(hero, fallbackImage) {
  if (hero?.mode === 'images') {
    return { backgroundImage: `url(${hero.slides[0].url})`, backgroundPosition: 'center' };
  }
  if (hero?.mode === 'crop') {
    return { backgroundImage: `url(${hero.slide.url})`, backgroundPosition: `center ${hero.cropY}%` };
  }
  if (hero?.mode === 'blur') {
    return {
      backgroundImage: `url(${hero.slide.url})`,
      backgroundPosition: 'center',
      filter: 'blur(26px)',
      transform: 'scale(1.15)',
    };
  }
  if (fallbackImage) {
    return { backgroundImage: `url(${fallbackImage})`, backgroundPosition: 'center' };
  }
  return null;
}

function websiteLabel(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
