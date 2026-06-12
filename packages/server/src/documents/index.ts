/**
 * documents module public API.
 *
 * Exports:
 *   - DocumentStore (CRUD over primary document tables)
 *   - Document type schemas and type definitions
 *   - Ownership resolution helpers
 *   - Deep merge utilities
 *   - Error types
 */

export { DocumentStore } from "./store.js";
export type { DocumentStoreOptions, QueryOptions, AuthorContext } from "./store.js";
export {
  DocumentNotFoundError,
  DocumentIdCollisionError,
  DocumentValidationError,
} from "./store.js";

export {
  getDocumentSchema,
  registerDocumentSchema,
  ActorSchema,
  ItemSchema,
  SceneSchema,
  JournalEntrySchema,
  MacroSchema,
  RollTableSchema,
  PlaylistSchema,
  ChatMessageSchema,
  CombatSchema,
  UserSchema,
  FolderSchema,
  SettingSchema,
} from "./types.js";
export type {
  DocumentSchema,
  ActorDocument,
  ItemDocument,
  SceneDocument,
  JournalEntryDocument,
  MacroDocument,
  RollTableDocument,
  PlaylistDocument,
  ChatMessageDocument,
  CombatDocument,
  UserDocument,
  FolderDocument,
  SettingDocument,
} from "./types.js";

export {
  UserRole,
  resolveOwnership,
  resolveOwnershipWithFolder,
  testOwnership,
  ownershipForCreator,
  OwnershipLevel,
  defaultOwnership,
} from "./ownership.js";
export type { FolderOwnership, Ownership } from "./ownership.js";

export { deepMerge, computeDiff } from "./merge.js";
export type { JsonValue } from "./merge.js";
