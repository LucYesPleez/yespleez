import SidebarItem from './SidebarItem';
import { NAVIGATION } from '../config/navigation';
import s from './Sidebar.module.css';

/**
 * Portal navigation — six destinations, rendered from configuration.
 *
 * Deliberately short. When categories lived here the sidebar was fifteen rows
 * and became the place you chose your work; now the workspace is, and this is
 * just how you get between rooms.
 */
export default function Sidebar() {
  return (
    <aside className={s.sidebar} aria-label="Portal navigation">
      <div className={s.brand}>
        <div className={s.wordmark}>
          YESPLEEZ
          <span className={s.subMark}>FESTIVAL PORTAL</span>
        </div>
      </div>

      <nav className={s.nav}>
        {NAVIGATION.map(({ key, ...item }) => (
          <SidebarItem key={key} {...item} />
        ))}
      </nav>

      <div className={s.footer}>
        <SidebarItem to="/help" label="Help & Support" icon="help" />
      </div>
    </aside>
  );
}
