/**
 * How an event presents itself.
 *
 * These rules are the same wherever an event is shown — a public listing, an
 * organiser's preview, a companion view. That is why they live outside every
 * application: a crop positioned in one place has to render identically in
 * every other, and a second copy of DEFAULT_CROP_Y is how that quietly stops
 * being true.
 *
 * ⛔ The package must not name its consumers, in code OR in prose. The moment
 * it does, it has started being about them.
 *
 * ⛔ This package knows nothing about who is displaying an event, and nothing
 * about editing one. It answers "what should this event look like", not "who
 * is asking" and not "how do I change it".
 */

export {
  resolveHeroMedia,
  DEFAULT_CROP_Y,
  MIN_CROP_COVERAGE,
  MAX_SLIDES,
} from './heroMedia.js';

export { heroMediaInputsFromConfig } from './configMedia.js';
