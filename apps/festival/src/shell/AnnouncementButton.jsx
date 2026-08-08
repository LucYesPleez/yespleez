import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system';

/**
 * The portal's one primary action.
 *
 * Its own component rather than a `<Button variant="primary">` inline in the
 * top bar, for two reasons: it is the only gradient button in the shell and
 * should stay countable, and when composing an announcement becomes a real
 * flow (audience, recipient count, an irreversible send) the behaviour lands
 * here without the top bar learning about any of it.
 */
export default function AnnouncementButton({ size = 'md' }) {
  const navigate = useNavigate();

  return (
    <Button
      variant="primary"
      size={size}
      icon="plus"
      onClick={() => navigate('/announcements')}
    >
      New Announcement
    </Button>
  );
}
