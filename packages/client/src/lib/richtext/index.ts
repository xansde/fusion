/**
 * Rich text barrel — public API for the Fusion rich text subsystem.
 */

export {
  sanitiseHtml,
  parseDocLinks,
  parseInlineRolls,
  parseSecretBlocks,
  serialiseDocLink,
  serialiseInlineRoll,
  serialiseSecretBlock,
  enrichHtml,
  DOC_LINK_EXTENSION,
  SECRET_BLOCK_EXTENSION,
  INLINE_ROLL_EXTENSION,
  FUSION_EXTENSIONS,
} from "./richtext.js";

export type {
  DocLink,
  InlineRoll,
  SecretBlock,
  EnrichOptions,
  ExtensionDescriptor,
} from "./richtext.js";
