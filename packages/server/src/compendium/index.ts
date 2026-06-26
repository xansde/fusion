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
} from "./service.js";
export {
  buildCompendiumListHandler,
  buildCompendiumIndexHandler,
  buildCompendiumSearchHandler,
  buildCompendiumGetHandler,
  buildCompendiumImportHandler,
} from "./handlers.js";
export type { CompendiumHandlerDeps } from "./handlers.js";
