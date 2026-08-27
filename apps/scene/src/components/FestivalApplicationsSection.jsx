/**
 * APPLICATIONS — what this person has applied for, on My Scene.
 *
 * ⚠⚠ THE DEFECT THIS EXISTS FOR: a volunteer could apply to a festival and then
 * had NOWHERE to see it. `ArtistDashboard` and My Scene both read Scene's own
 * `applications` table; a festival application lands in `festival_applications`
 * and is readable only through a SECURITY DEFINER RPC. The D2 notification is
 * deliberately non-navigable. So the applicant's one route back was re-finding
 * the event by hand. ⭐ Applying into apparent silence is the difference between
 * a system that works and one that feels like it worked.
 *
 * ⭐⭐ MY SCENE ANSWERS "WHAT AM I DOING". Industry answers "what roles do I
 * have" and is the sole canonical home for CREATING and MAINTAINING a profile
 * — Vollys included. ⛔ Nothing here edits a profile, and ⛔ there is no
 * "My Vollys" surface. See project_progressive_role_activation.
 *
 * ⭐ THE SECTIONS ARE ROLE-SHAPED FROM DAY ONE (Artist · Vollys · Markets ·
 * Workshops · Other) even though only two can be filled today — see
 * `groupApplications`. ⛔ Empty ones do not render: My Scene is attention,
 * never a directory.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  myFestivalApplicationsAll,
  groupApplications,
  applicationOutcome,
  categoryLabel,
} from '../lib/festivalApplications';
import s from '../screens/MySceneScreen.module.css';

/* Same three tones the event page uses for the same four states. ⛔ Two colour
   scales for one status is how "APPLIED" ends up meaning different things on
   two screens of one app. */
const OUTCOME_COLOUR = { good: '#00e676', pending: '#00e676', closed: 'rgba(255,255,255,.45)' };
const OUTCOME_MARK   = { good: '★ ', pending: '✓ ', closed: '' };

/**
 * ⚠ `config->>date` IS A LOCAL DATE STRING, not a timestamp. Parsing it at T12
 * keeps it on its own day in every Australian timezone; ⛔ `new Date('...')`
 * alone parses bare ISO dates as UTC and reads as the day before all morning.
 */
function eventDateLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ApplicationRow({ application, onOpen }) {
  const outcome = applicationOutcome(application.status);
  const date = eventDateLabel(application.eventDate);

  return (
    <button
      type="button"
      onClick={onOpen}
      /* ⚠ THE ROW CAME BACK NAMELESS from the accessibility tree — `button`
         with no label, while every neighbouring control ("Remove Bass Heavy
         from your scene") announced itself. The visible text lives in nested
         divs the tree did not fold into a name, so a screen reader reached two
         identical unlabelled buttons. ⭐ Measured, not assumed: read_page listed
         them as bare refs. */
      aria-label={`${application.eventName || 'Festival no longer listed'}, ${categoryLabel(application.categoryKey)}, ${outcome.label}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '12px 14px', marginBottom: 8, textAlign: 'left', cursor: 'pointer',
        color: 'var(--text)', boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ⚠ A null event name is rendered HONESTLY. An application outlives a
            deleted event, and "Unknown festival" would be an invention — the
            rendering contract distinguishes Absent from Unknown. */}
        <div style={{
          fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: application.eventName ? 'var(--text)' : 'var(--muted)',
        }}>
          {application.eventName || 'Festival no longer listed'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
          {categoryLabel(application.categoryKey)}{date ? ` · ${date}` : ''}
        </div>
      </div>

      <span style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.4,
        color: OUTCOME_COLOUR[outcome.tone], whiteSpace: 'nowrap',
      }}>
        {OUTCOME_MARK[outcome.tone]}{outcome.label}
      </span>
    </button>
  );
}

export default function FestivalApplicationsSection() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['myFestivalApplications'],
    staleTime: 5 * 60 * 1000,
    queryFn: myFestivalApplicationsAll,
  });

  const sections = groupApplications(data || []);

  /* ⭐ NOTHING RENDERS WHEN THERE IS NOTHING — not a heading, not an empty
     state, not a skeleton. Most people on My Scene have never applied to a
     festival, and a permanent APPLICATIONS heading over "You haven't applied
     to anything" is a directory entry, which this screen does not do. The
     section appears the moment they have a reason for it to exist. */
  if (isLoading || sections.length === 0) return null;

  return (
    <div className={s.v1Section}>
      <div className={s.v1Head}>
        <div className={s.sectionHead}>APPLICATIONS</div>
        <div className={s.gradientLine} />
      </div>

      <div style={{ marginTop: 10 }}>
        {sections.map(section => (
          <div key={section.key} style={{ marginBottom: 14 }}>
            {/* ⚠ The sub-heading renders even for a single section. It is what
                teaches that this list will hold markets and workshops too — a
                bare list of volunteer rows today becomes a confusing mixed list
                the first time a second kind arrives. */}
            <div style={{
              fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2,
              color: 'var(--muted)', marginBottom: 6,
            }}>
              {section.label}
            </div>
            {section.applications.map(a => (
              <ApplicationRow
                key={`${a.eventId}:${a.categoryKey}`}
                application={a}
                /* ⭐ THE EVENT PAGE IS THE DESTINATION — it already renders the
                   applied panel with the days and departments they chose, and
                   the outcome when released. ⛔ Do not build a second detail
                   view of one application; there would then be two places that
                   must agree about what a person applied with. */
                onOpen={() => a.eventId && navigate(`/event/${a.eventId}`)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
