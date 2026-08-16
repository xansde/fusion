/**
 * `folder:delete` — the one operation that removes a folder (REQ-NPC-022).
 *
 * Spec 42 §5.3. Deleting a folder must not delete a single actor: the actors it
 * held go back to "Sem pasta" and its subfolders rise one level, to where the
 * deleted folder used to sit. The generic `doc:delete` path cannot do that — it
 * removes the row and stops, leaving every actor of the folder pointing at an id
 * that no longer exists and every subfolder orphaned in a tree nobody can draw.
 * So this is a COMPOSED operation, and it is the only door: the client never
 * emits `doc:delete` for a Folder.
 *
 * Three things happen, in this order, and the order is the point:
 *
 *  1. subfolders are lifted to the deleted folder's own parent (REQ-NPC-022);
 *  2. the documents inside are released to "Sem pasta" (`folder: null`, which
 *     REQ-DOC-037 preserves as a null instead of deleting the key);
 *  3. only then is the row deleted.
 *
 * Reversing 3 with 1/2 would leave a window in which the folder is gone and its
 * contents still name it — a crash between the two writes and the world keeps a
 * dangling reference for good. The three writes run inside one
 * `DocumentStore.transaction()` call (see there), so a failure on any step — a
 * legacy document that no longer validates, most concretely — rolls all of
 * them back instead of committing a prefix of the triad with no broadcast.
 *
 * Each step broadcasts its own delta through `broadcastToWorld`, ONLY once the
 * whole triad has committed, on the same `seq`/`OpBuffer`/redaction pipe every
 * other document change travels, so every client redraws the tree without
 * reloading (RNF-NPC-04).
 *
 * The gate is `isRolePrivileged` and nothing else (REQ-NPC-080, REQ-GAV-034):
 * the tab is not rendered for a player, and hiding is not protection.
 */

import type { Ack, Envelope, FolderDeleteResult } from "@fusion/shared";
import { FolderDeletePayloadSchema } from "@fusion/shared";
import type { HandlerFn } from "../handler-registry.js";
import { isRolePrivileged } from "../../documents/ownership.js";
import { DocumentNotFoundError, DocumentValidationError } from "../../documents/store.js";
import type { DocHandlerDeps } from "./doc-handlers.js";
import { broadcastToWorld } from "./doc-handlers.js";

/** documentType → table, for the types a Folder is allowed to organize. */
const CONTENT_TABLE_OF: Record<string, string> = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal_entries",
  Macro: "macros",
  RollTable: "roll_tables",
  Playlist: "playlists",
};

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

function idOf(doc: Record<string, unknown>): string {
  const id = doc["_id"];
  return typeof id === "string" ? id : "";
}

/** Emit one delta for one document type, keeping the shared `seq`/buffer pipe. */
function emit(
  deps: DocHandlerDeps,
  type: "doc:update" | "doc:delete",
  documentType: string,
  payload: Record<string, unknown>,
): void {
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type,
    seq,
    ts: Date.now(),
    payload: { documentType, ...payload },
  };
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, documentType);
}

export function buildFolderDeleteHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    // REQ-NPC-080: the client not drawing the button is not the check.
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can delete a folder");
    }

    const parsed = FolderDeletePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { folderId } = parsed.data;

    let folder: Record<string, unknown>;
    try {
      folder = deps.store.get("folders", folderId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Document not found: Folder/${folderId}`);
      }
      throw err;
    }

    const rawParent = folder["parentId"];
    // The grandparent, which is where the children go. A folder at the root has
    // `null` here, and null is exactly what a lifted child needs.
    const grandParentId = typeof rawParent === "string" && rawParent.length > 0 ? rawParent : null;

    const contentType = typeof folder["type"] === "string" ? folder["type"] : "";
    const contentTable = CONTENT_TABLE_OF[contentType];
    if (contentTable === undefined) {
      return ackError(
        "VALIDATION_FAILED",
        `Folder/${folderId} organizes an unknown document type: ${contentType || "(empty)"}`,
      );
    }

    const author = { userId: ctx.userId };

    // The three steps below run inside ONE transaction (REQ-NPC-022): the old
    // shape opened one IMMEDIATE transaction PER `store.update`/`store.delete`
    // call, so a `DocumentValidationError` raised while releasing a document
    // (e.g. a legacy row a prior pack/migration wrote that no longer matches
    // the current schema) would leave step 1's reparenting already committed
    // — with no broadcast to tell any client — while the ack still came back
    // ok:false. `DocumentStore.transaction()` makes the triad atomic: any
    // throw here rolls back every write this call made, so the ack describes
    // a world that is provably untouched.
    let reparented: Record<string, unknown>[];
    let released: Record<string, unknown>[];
    try {
      ({ reparented, released } = deps.store.transaction((txn) => {
        // 1. Subfolders rise one level (REQ-NPC-022). Read every folder rather
        //    than querying by `parent_id`: `store.query` filters `folder_id`,
        //    which the folders table does not have — a filter that would
        //    silently match nothing.
        const liftedFolders: Record<string, unknown>[] = [];
        for (const candidate of deps.store.getAll("folders")) {
          if (candidate["parentId"] !== folderId) continue;
          const childId = idOf(candidate);
          if (childId === "") continue;
          const updated = txn.update("folders", childId, { parentId: grandParentId }, author);
          if (updated !== null) liftedFolders.push(updated);
        }

        // 2. The documents inside go to "Sem pasta" — moved, never deleted.
        const releasedDocs: Record<string, unknown>[] = [];
        for (const doc of deps.store.query(contentTable as never, { folderId })) {
          const docId = idOf(doc);
          if (docId === "") continue;
          const updated = txn.update(contentTable as never, docId, { folder: null }, author);
          if (updated !== null) releasedDocs.push(updated);
        }

        // 3. Only now is the folder gone.
        txn.delete("folders", folderId);

        return { reparented: liftedFolders, released: releasedDocs };
      }));
    } catch (err) {
      if (err instanceof DocumentValidationError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", err.message);
      }
      throw err;
    }

    if (reparented.length > 0) {
      emit(deps, "doc:update", "Folder", { documents: reparented });
    }
    if (released.length > 0) {
      emit(deps, "doc:update", contentType, { documents: released });
    }

    const seq = deps.seqStore.next();
    const envelope: Envelope = {
      type: "doc:delete",
      seq,
      ts: Date.now(),
      payload: { documentType: "Folder", ids: [folderId] },
    };
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Folder");

    const result: FolderDeleteResult = {
      folderId,
      reparentedFolderIds: reparented.map(idOf),
      releasedDocumentIds: released.map(idOf),
      releasedDocumentType: contentType,
    };
    return ackOk(result, seq);
  };
}
