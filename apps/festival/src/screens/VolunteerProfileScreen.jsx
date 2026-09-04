import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system';
import VolunteerProfileEditor from '../festival/VolunteerProfileEditor';
import s from './screens.module.css';

/**
 * YOUR VOLUNTEER PROFILE — the one screen in this portal that belongs to the
 * person rather than to the festival.
 *
 * ⭐ NOT A SEVENTH SIDEBAR DESTINATION. The navigation law holds at six rooms,
 * and this is a route inside the shell reached from Settings — the same shape
 * `/festival/event/:eventId` already takes. Adding a room is an architecture
 * decision, not a consequence of building a screen.
 *
 * ⚠⚠ WHO CAN ACTUALLY REACH THIS, TODAY: only an organiser. This whole app is
 * behind `VITE_ORGANISER_ALLOWLIST`, which is fail-closed, so a member of the
 * public cannot load it at all — and `project_progressive_role_activation`
 * places the maintenance of a volunteer profile in Scene's Industry surface.
 * The owner chose to build the editor here regardless, and that is a live
 * decision rather than an oversight: ⛔ do not "fix" it by opening the gate.
 * Where a volunteer edits this is the next question, not this screen's.
 */
export default function VolunteerProfileScreen() {
  const navigate = useNavigate();

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <Button variant="ghost" size="sm" icon="chevron" onClick={() => navigate('/settings')}>
            Settings
          </Button>
          <h1 className={s.pageTitle}>Your volunteer profile</h1>
          <p className={s.pageSubtitle}>
            What kind of volunteer you are, answered once and reused at every festival you
            apply to. Which days you can work and which department you want belong to each
            application, not to this.
          </p>
        </div>
      </header>

      <VolunteerProfileEditor />
    </div>
  );
}
