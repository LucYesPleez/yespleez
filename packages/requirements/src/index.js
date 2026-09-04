/**
 * Requested assets, matched against what a profile can supply.
 *
 * The engine answers four questions and nothing else:
 *
 *   What is this requirement?          requirementLabel · REQUIREMENT_KEYS
 *   Which section does it belong in?   requestableBySection · SECTIONS
 *   Can this profile satisfy it?       evaluate · completionFor
 *   What can a profile supply at all?  PROFILE_ASSET_TYPES · assetLabel
 *
 * ⛔ It knows nothing about who is asking. Not the application, not the
 * surface, not whether the ask is an application, an enquiry, a booking or an
 * accreditation. Those are all the same shape — a set of requested things
 * measured against a set of held things — and the moment this package learns
 * to tell them apart it has stopped being the engine and started being one of
 * its callers.
 */

export {
  evaluate,
  completionFor,
  isSettled,
  firstUnsettled,
  columnsFor,
  snapshotEvaluation,
  requestableBySection,
  requirementLabel,
  COMPLETION_KEYS,
  COMPLETION_COLUMNS,
  REQUIREMENT_KEYS,
  REQUESTABLE_KEYS,
  FESTIVAL_ROLE_REQUESTABLE_KEYS,
  SECTIONS,
} from './requirements.js';

export {
  assetLabel,
  assetPath,
  assetType,
  isDistributable,
  isMulti,
  ASSETS_BUCKET,
  ASSET_MAX_BYTES,
  ASSET_MIME_TYPES,
  ASSET_REQUIREMENT_KEYS,
  ASSET_TYPE_KEYS,
  DISTRIBUTABLE_ASSET_TYPES,
  PROFILE_ASSET_TYPES,
} from './profileAssets.js';
