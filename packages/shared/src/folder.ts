/**
 * folder.ts — the `Folder` document, and the one operation that removes it.
 *
 * Spec 02 (REQ-DOC-018) declares `Folder` as a primary document; spec 42
 * (REQ-NPC-020) is the first client that draws it as a real tree. The shape
 * lived only in the server's private schema registry until now, which meant the
 * client had no name for the thing it was about to create — so it moves here,
 * unchanged, and the server keeps validating against this very object.
 *
 * A folder is hierarchical by `parentId` (never by a path string): a rename of
 * a parent must not have to rewrite its children, and a cycle is then something
 * a reader can detect instead of a corrupt string nobody can parse.
 *
 * `FolderDeletePayloadSchema` belongs here for a reason worth naming: deleting a
 * folder is NOT `doc:delete` (REQ-NPC-022). Deleting the row would leave every
 * actor of the folder pointing at an id that no longer exists and every subfolder
 * orphaned — the generic path has no idea it should lift them. `folder:delete` is
 * the composed operation that empties the folder before removing it, and it is the
 * only door that does.
 */

import { z } from "zod";
import { BaseDocumentSchema } from "./document.js";

/**
 * The document type a folder organizes — the value of `Folder.type`.
 *
 * Kept as a plain string in the schema (worlds already hold folders written
 * before this list existed), but named here so a caller does not have to guess
 * the spelling. Spec 42 uses `Actor` and nothing else.
 */
export const FOLDER_CONTENT_TYPES = [
  "Actor",
  "Item",
  "Scene",
  "JournalEntry",
  "Macro",
  "RollTable",
  "Playlist",
] as const;

export type FolderContentType = (typeof FOLDER_CONTENT_TYPES)[number];

/** The `Folder.type` value of the tree the NPCs tab draws (REQ-NPC-020). */
export const ACTOR_FOLDER_TYPE = "Actor";

/**
 * A `Folder` document (REQ-DOC-018).
 *
 * `parentId` is nullable: `null` is a root folder, and it is a top-level field,
 * so the merge semantics of REQ-DOC-037 preserve an explicit null instead of
 * deleting the key — which is what lifting a subfolder to the root depends on.
 */
export const FolderDocumentSchema = BaseDocumentSchema.extend({
  name: z.string().min(1),
  type: z.string(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  sorting: z.enum(["a", "m"]).default("m"),
  color: z.string().nullable().optional(),
});

export type FolderDocument = z.infer<typeof FolderDocumentSchema>;

/**
 * What a caller sends as one item of `doc:create`'s `data` for a Folder.
 *
 * `_id` and `_stats` are absent on purpose: both are written by the server
 * (REQ-DOC-008), and a client that supplies them is refused there.
 */
export const FolderCreateInputSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  parentId: z.string().nullable().default(null),
  sort: z.number().int().default(0),
  color: z.string().nullable().optional(),
});

export type FolderCreateInput = z.input<typeof FolderCreateInputSchema>;

/**
 * `folder:delete` — remove one folder without removing anything it held
 * (REQ-NPC-022).
 */
export const FolderDeletePayloadSchema = z.object({
  folderId: z.string().min(1),
});

export type FolderDeletePayload = z.infer<typeof FolderDeletePayloadSchema>;

/** What `folder:delete` acks with, so a caller can tell what moved. */
export interface FolderDeleteResult {
  /** The folder that is gone. */
  readonly folderId: string;
  /** Subfolders that were lifted one level (REQ-NPC-022). */
  readonly reparentedFolderIds: readonly string[];
  /** Documents that went back to "Sem pasta" — never deleted (REQ-NPC-022). */
  readonly releasedDocumentIds: readonly string[];
  /** The document type those released ids belong to (`Folder.type`). */
  readonly releasedDocumentType: string;
}
