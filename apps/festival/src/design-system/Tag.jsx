import s from './Tag.module.css';

/**
 * A non-interactive labelled pill — a genre, a role, a category.
 *
 * ⚠ THIS EXISTS BECAUSE StatusBadge WAS BEING ABUSED FOR IT. The Settings
 * screen rendered team roles as `<StatusBadge status="reviewing" />` to get a
 * purple pill, which meant a role was expressed in the vocabulary of an
 * application's workflow. It broke the moment that vocabulary changed — Admin
 * would have rendered the raw word "reviewing" in a neutral tone.
 *
 * StatusBadge owns exactly one meaning: where an application is in its
 * workflow. Anything else that wants a pill wants this instead.
 */
export default function Tag({ children, tone = 'neutral' }) {
  return <span className={`${s.tag} ${s[tone] || s.neutral}`}>{children}</span>;
}
