/**
 * Compendium module public API.
 */

export {
  CompendiumService,
  docTypeToTable,
  extractDotPath,
  PermissionDeniedError,
  findMonorepoRoot,
  resolveSystemPacksDir,
  computeI18nSourceHash,
  computeActionCost,
} from "./service.js";
export {
  buildCompendiumListHandler,
  buildCompendiumIndexHandler,
  buildCompendiumSearchHandler,
  buildCompendiumSearchAllHandler,
  buildCompendiumGetHandler,
  buildCompendiumI18nBySourceRefHandler,
  buildCompendiumImportHandler,
} from "./handlers.js";
export type { CompendiumHandlerDeps } from "./handlers.js";
