import s from './SectionCard.module.css';

/**
 * The portal's one raised surface.
 *
 * Every panel in the product is a SectionCard — stats, table, widgets,
 * inspector sections, settings groups. One component means one place decides
 * what a raised surface looks like, and a new screen cannot accidentally
 * invent a slightly different card.
 *
 * `flush` is for children that own their edges (a table's sticky header has to
 * reach the card's border, so padding would leave a visible gutter above it).
 */
export default function SectionCard({
  title,
  count,
  subtitle,
  actions,
  children,
  flush = false,
  bordered = false,
  className = '',
  ...rest
}) {
  const hasHeader = title || actions;

  return (
    <section className={`fp-panel ${s.card} ${className}`} {...rest}>
      {hasHeader && (
        <header className={`${s.header} ${bordered ? s.headerBordered : ''}`}>
          <div>
            <div className={s.titleGroup}>
              {title && <span className={s.title}>{title}</span>}
              {/* A count of zero is still a fact worth stating in a header —
                  unlike a badge, where zero means "nothing awaits you". */}
              {count != null && <span className={s.count}>{count}</span>}
            </div>
            {subtitle && <div className={s.subtitle}>{subtitle}</div>}
          </div>
          {actions && <div className={s.actions}>{actions}</div>}
        </header>
      )}

      <div className={`${s.body} ${flush ? '' : s.bodyPadded}`}>
        {children}
      </div>
    </section>
  );
}
