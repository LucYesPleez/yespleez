import Placeholder from '../components/Placeholder';
import s from './screens.module.css';

/**
 * The shell's honest stand-in for a route that exists but is not built.
 *
 * One component for Messages, Announcements, Festival Profile and Settings.
 * Four separate empty files would each grow their own layout before anyone
 * decided what they should be; one says plainly "this route works, its
 * contents are a later milestone" and is deleted a screen at a time.
 */
export default function StubScreen({ title, note, blocks = [] }) {
  return (
    <section className={`fp-panel ${s.stub}`}>
      <div className={s.stubHead}>
        <span className={s.stubTitle}>{title}</span>
        {note && <span className={s.stubNote}>{note}</span>}
      </div>

      <div className={s.stubGrid}>
        {blocks.map(block => (
          <div key={block} className={`fp-panel ${s.stubBlock}`}>
            <Placeholder title={block} lines={4} />
          </div>
        ))}
      </div>
    </section>
  );
}
