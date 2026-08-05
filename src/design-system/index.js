/**
 * THE FESTIVAL PORTAL DESIGN SYSTEM
 *
 * Every visual primitive in the product comes from here. Screens and feature
 * components import from `design-system`, never from each other's modules —
 * that one rule is what stops a second card style, a second button, or a
 * seventh shade of grey appearing six months from now.
 *
 * Visually this is YesPleez: the tokens are the Scene app's tokens, the type
 * is DM Sans over Bebas Neue, and the raised surface is the same glass panel.
 * What is portal-specific is the SHAPE of things — a docked inspector, a
 * dense table, a persistent sidebar — none of which the Scene app has.
 *
 * ⚠ Candidates for a future `@yespleez/ui` package: Icon, StatusBadge,
 * Skeleton, EmptyState, and the Form family. They contain nothing
 * festival-specific. Until that package exists they live here; see README
 * "Shared packages".
 */

export { default as Icon }         from './Icon';
export { default as Button }       from './Button';
export { default as SectionCard }  from './SectionCard';
export { default as StatusBadge }  from './StatusBadge';
export { default as EmptyState }   from './EmptyState';
export { default as LoadingState } from './LoadingState';
export { default as Skeleton }     from './Skeleton';
export { default as ListRow }      from './ListRow';

export { Field, TextInput, Textarea, Select, Toggle, Row } from './Form';
