/**
 * Compendium socket handlers.
 *
 * Spec: 16-compendiums-e-importacao.md §API e eventos
 * REQ-CMP-010..024
 *
 * Handlers:
 *   compendium:list   — list available packs (all roles)
 *   compendium:index  — get pack index (all roles)
 *   compendium:search — search/filter pack index (all roles)
 *   compendium:get    — load full document (all roles)
 *   compendium:import — import doc(s) to world (GM/ASSISTANT only)
 */

import type { HandlerFn } from "../net/handler-registry.js";
import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import {
  CompendiumListPayloadSchema,
  CompendiumIndexPayloadSchema,
  CompendiumSearchPayloadSchema,
  CompendiumGetPayloadSchema,
  CompendiumImportPayloadSchema,
} from "@fusion/shared";
import type { Ack } from "@fusion/shared";
import type { CompendiumService } from "./service.js";
import { PermissionDeniedError } from "./service.js";
import { isRolePrivileged } from "../documents/ownership.js";

// ---------------------------------------------------------------------------
// Handler deps
// ---------------------------------------------------------------------------

export interface CompendiumHandlerDeps {
  compendium: CompendiumService;
  db: Db;
  ns: Namespace;
}

// ---------------------------------------------------------------------------
// compendium:list
// REQ-CMP-012
// ---------------------------------------------------------------------------

export function buildCompendiumListHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, _ctx): Ack => {
    const parsed = CompendiumListPayloadSchema.safeParse(payload);
    const rawFilter = parsed.success ? parsed.data : {};
    // Strip undefined values to satisfy exactOptionalPropertyTypes
    const filter: { systemId?: string; documentType?: string } = {};
    if (rawFilter.systemId !== undefined) filter.systemId = rawFilter.systemId;
    if (rawFilter.documentType !== undefined) filter.documentType = rawFilter.documentType;

    const packs = deps.compendium.listPacks(Object.keys(filter).length > 0 ? filter : undefined);

    return { ok: true, result: { packs } };
  };
}

// ---------------------------------------------------------------------------
// compendium:index
// REQ-CMP-007
// ---------------------------------------------------------------------------

export function buildCompendiumIndexHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, _ctx): Ack => {
    const parsed = CompendiumIndexPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:index payload",
      };
    }

    const packIndex = deps.compendium.getPackIndex(parsed.data.packId);
    if (!packIndex) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `Pack "${parsed.data.packId}" not found`,
      };
    }

    return { ok: true, result: packIndex };
  };
}

// ---------------------------------------------------------------------------
// compendium:search
// REQ-CMP-013, REQ-CMP-014
// ---------------------------------------------------------------------------

export function buildCompendiumSearchHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, _ctx): Ack => {
    const parsed = CompendiumSearchPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:search payload",
      };
    }

    const entries = deps.compendium.searchPack(parsed.data.packId, parsed.data);
    if (!entries) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `Pack "${parsed.data.packId}" not found`,
      };
    }

    return { ok: true, result: { packId: parsed.data.packId, entries } };
  };
}

// ---------------------------------------------------------------------------
// compendium:get — full document by UUID
// REQ-CMP-009, REQ-CMP-050
// ---------------------------------------------------------------------------

export function buildCompendiumGetHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, _ctx): Ack => {
    const parsed = CompendiumGetPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:get payload",
      };
    }

    const doc = deps.compendium.getDocument(parsed.data.uuid);
    if (!doc) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `Document not found: ${parsed.data.uuid}`,
      };
    }

    return { ok: true, result: { document: doc } };
  };
}

// ---------------------------------------------------------------------------
// compendium:import — clone pack doc(s) into world (GM only)
// REQ-CMP-021..024
// ---------------------------------------------------------------------------

export function buildCompendiumImportHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, ctx): Ack => {
    if (!isRolePrivileged(ctx.role)) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message: "Only GM/ASSISTANT can import from compendiums",
      };
    }

    const parsed = CompendiumImportPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:import payload",
      };
    }

    try {
      const importOpts: {
        db: typeof deps.db;
        worldId: string;
        userId: string;
        role: number;
        folderId?: string;
      } = {
        db: deps.db,
        worldId: ctx.worldId,
        userId: ctx.userId,
        role: ctx.role,
      };
      if (parsed.data.folderId !== undefined) {
        importOpts.folderId = parsed.data.folderId;
      }
      const result = deps.compendium.importToWorld(parsed.data.uuids, importOpts);

      // Broadcast compendium:imported event.
      // Security: the list of created world _ids must only reach privileged sockets.
      // A hidden Actor's _id would otherwise leak to players via this broadcast even
      // though the document data itself is redacted on the normal sync path.
      // We broadcast a generic notification to all (so clients can refresh packs/UI),
      // but only include the created[] id list in the "gm" room (GM/ASSISTANT).
      // The "gm" room is joined on connect for all isRolePrivileged sockets
      // (see socket-manager.ts REQ-NET-004).
      if (result.created.length > 0) {
        // Notify all clients: import happened (no sensitive ids exposed)
        deps.ns.emit("compendium:imported", {
          worldId: ctx.worldId,
          importedBy: ctx.userId,
          ts: Date.now(),
        });

        // Send id list only to privileged sockets (gm room = GM/ASSISTANT)
        deps.ns.to("gm").emit("compendium:imported:detail", {
          worldId: ctx.worldId,
          created: result.created,
          importedBy: ctx.userId,
          ts: Date.now(),
        });
      }

      return {
        ok: true,
        result,
      };
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return {
          ok: false,
          code: "PERMISSION_DENIED",
          message: err.message,
        };
      }
      throw err;
    }
  };
}
