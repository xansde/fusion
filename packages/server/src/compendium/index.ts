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
  resolvePrivatePacksDir,
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
  buildCompendiumImportToActorHandler,
} from "./handlers.js";
export type { CompendiumHandlerDeps } from "./handlers.js";
export type { ImportToActorOutcome } from "./service.js";
