import {
  SectionCard, Button, ListRow, Skeleton,
  TextInput, Textarea, Row,
} from '../design-system';
import { CATEGORIES } from '../config/categories';
import { FESTIVAL } from '../config/navigation';
import s from './screens.module.css';

/**
 * FESTIVAL — the public face, and what it is asking for.
 *
 * ⭐ Identity comes from the shared profile system; only the application
 * windows are portal-specific. The card headers say which is which, because
 * the most expensive mistake here would be someone building a second festival
 * profile store inside this repo.
 *
 * The categories list is rendered from `config/categories.js` — the same
 * source as the workspace tabs and the sidebar count. One registry, so a
 * category cannot exist in one place and not another.
 */

const WINDOWS = {
  music:              { opens: '1 Sep',  closes: '14 Oct', state: 'open' },
  volunteer:          { opens: '1 Sep',  closes: '1 Dec',  state: 'open' },
  market_stall:       { opens: '1 Sep',  closes: '1 Nov',  state: 'open' },
  food_vendor:        { opens: '1 Sep',  closes: '1 Oct',  state: 'open' },
  workshop:           { opens: '1 Sep',  closes: null,     state: 'scheduled' },
  performance_artist: { opens: '1 Sep',  closes: '14 Oct', state: 'open' },
  decor:              { opens: '1 Sep',  closes: '1 Oct',  state: 'open' },
  media:              { opens: '1 Oct',  closes: '1 Dec',  state: 'scheduled' },
  theme_camp:         { opens: '1 Sep',  closes: '1 Nov',  state: 'closed' },
};

/**
 * R1 — open, scheduled and closed are three different facts and each says so.
 * A closed category is never hidden: a category someone was told about that
 * silently vanishes reads as a fault, not as a deadline.
 */
function windowMeta(w) {
  if (!w) return 'No window set';
  if (w.state === 'scheduled') return `Opens ${w.opens}${w.closes ? ` · closes ${w.closes}` : ' · no closing date'}`;
  if (w.state === 'closed')    return `Closed ${w.closes}`;
  return `Open now · closes ${w.closes}`;
}

export default function FestivalScreen() {
  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Festival</h1>
          <p className={s.pageSubtitle}>
            What applicants see, and what you are accepting. Identity and dates live on the shared
            profile system; the application windows below belong to this portal.
          </p>
        </div>
        <Button variant="secondary" iconRight="external">View public profile</Button>
      </header>

      <div className={s.settingsGrid}>
        <div className={s.formStack}>
          <SectionCard title="Identity" subtitle="Shared with every YesPleez surface — changing it here changes it everywhere.">
            <TextInput label="Festival name" defaultValue={FESTIVAL.name} />
            <TextInput label="Tagline" optional maxLength={80} placeholder="Eighty characters at most" />
            <Textarea label="Description" rows={5} placeholder="What the festival is, in the words an applicant should read first." />
          </SectionCard>

          <SectionCard title="Dates & location" subtitle="Drives the public page and every deadline shown in this portal.">
            <Row>
              <TextInput label="Starts" defaultValue="16 January 2027" />
              <TextInput label="Ends" defaultValue="19 January 2027" />
            </Row>
            <TextInput label="Location" defaultValue={FESTIVAL.location} />
            <TextInput label="Website" optional placeholder="https://" />
          </SectionCard>
        </div>

        <SectionCard
          title="Media"
          subtitle="A poster is an opaque artefact — it is shown whole, never cropped to fit a layout."
        >
          <Skeleton shape="block" height={140} />
          <Row>
            <Skeleton shape="block" height={64} />
            <Skeleton shape="block" height={64} />
          </Row>
          <Button variant="secondary" size="sm" icon="plus" block>Add artwork</Button>
        </SectionCard>
      </div>

      <SectionCard
        title="Application categories"
        count={CATEGORIES.length}
        subtitle="The same registry the workspace tabs read from. A category cannot exist in one place and not the other."
        actions={<Button variant="secondary" size="sm" icon="plus">Add category</Button>}
      >
        {CATEGORIES.map(cat => {
          const w = WINDOWS[cat.key];
          return (
            <ListRow
              key={cat.key}
              icon={cat.icon}
              title={cat.label}
              meta={windowMeta(w)}
              trail={
                <>
                  <span className={s.pageSubtitle} style={{ marginTop: 0 }}>{cat.count}</span>
                  <Button variant="ghost" size="sm" icon="dots" aria-label={`Edit ${cat.label}`} />
                </>
              }
            />
          );
        })}
      </SectionCard>
    </div>
  );
}
