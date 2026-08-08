import { useNavigate } from 'react-router-dom';
import { ListRow } from '../design-system';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './HomeScreen.module.css';

/**
 * MORE — the two rooms that are configuration rather than decisions.
 *
 * ⭐ Event and Settings live here because the mobile split is by the SIZE of
 * the edit, not the screen: fixing a typo or closing applications early belongs
 * on a phone, setting up thirty departments does not. Putting them one tap away
 * rather than in the bottom bar says which is which without forbidding either.
 *
 * ⛔ This is not a sixth destination sneaking in. The six rooms are unchanged;
 * More is a drawer over two of them.
 */
export default function MoreScreen() {
  const navigate = useNavigate();
  const { festivals } = useRepositories();
  const { data } = useQuery(() => festivals.getCurrent(), []);

  const eventId = data?.event?.id;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>More</h1>
        <p className={s.sub}>{data?.name ?? 'Your festival'}</p>
      </header>

      <div className={s.list}>
        <ListRow
          icon="calendar"
          title={data?.event?.name ?? 'Event'}
          meta="Dates, categories, departments, what’s open"
          onClick={() => navigate(eventId ? `/festival/event/${eventId}` : '/festival')}
        />
        <ListRow
          icon="star"
          title="Festival"
          meta="Identity and every year you’ve run"
          onClick={() => navigate('/festival')}
        />
        <ListRow
          icon="settings"
          title="Settings"
          meta="Team and configuration"
          onClick={() => navigate('/settings')}
        />
      </div>
    </div>
  );
}
