/**
 * Compendium socket handlers.
 *
 * Spec: 16-compendiums-e-importacao.md §API e eventos
 * REQ-CMP-010..024
 *
 * Handlers:
 *   compendium:list             — list available packs (all roles)
 *   compendium:index            — get pack index (all roles)
 *   compendium:search           — search/filter pack index (all roles)
 *   compendium:get              — load full document (all roles)
 *   compendium:i18nBySourceRef  — resolve pt-BR overlay by origin ref (all roles)
 *   compendium:import           — import doc(s) to world (GM/ASSISTANT only)
 *
 * PACK AUDIENCE (REQ-CMP-004a/010a, REQ-CPD-070/071/074): "all roles" above
 * means "every role, over the packs that role can see". Each read handler
 * forwards `ctx.role` — the role the socket authenticated with, NEVER a field
 * of the payload — to the service, which drops packs declaring
 * `audience: "gm"` for viewers failing `isRolePrivileged`. The refusal is not
 * a distinct branch here on purpose: the service returns the same `null` it
 * returns for an unknown packId/uuid, so the ack a player gets for a hidden
 * pack is byte-identical to the ack for a pack that was never published
 * (REQ-SEC-020). Filtering only in the UI would NOT satisfy REQ-CPD-074.
 *
 * `compendium:i18nBySourceRef` (issue #43) is the read-side counterpart to
 * `importToWorld` stripping `uuid`/`i18n` from the world copy: a world document
 * has no uuid to call `compendium:get` with, but its `flags.fusion.{packName,
 * sourceId}` survive, and those resolve back to the pt-BR overlay.
 */

import type { HandlerFn } from "../net/handler-registry.js";
import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import type { Logger } from "pino";
import {
  CompendiumListPayloadSchema,
  CompendiumIndexPayloadSchema,
  CompendiumSearchPayloadSchema,
  CompendiumGetPayloadSchema,
  CompendiumI18nBySourceRefPayloadSchema,
  CompendiumImportPayloadSchema,
} from "@fusion/shared";
import type { Ack } from "@fusion/shared";
import type { SystemModule } from "@fusion/system-api";
import type { CompendiumService } from "./service.js";
import type { WriteMetricsCollector } from "../documents/write-metrics.js";
import { PermissionDeniedError } from "./service.js";
import { isRolePrivileged } from "../documents/ownership.js";

// ---------------------------------------------------------------------------
// Handler deps
// ---------------------------------------------------------------------------

export interface CompendiumHandlerDeps {
  compendium: CompendiumService;
  db: Db;
  ns: Namespace;
  /**
   * The world's resolved SystemModule, when available. Forwarded to
   * CompendiumService.importToWorld so imported Actor documents are derived
   * before being persisted (audit issue 3) — see service.ts docstring.
   * Optional — undefined skips derivation on import (stub system, or no
   * system package loaded).
   */
  systemModule?: SystemModule;
  logger?: Logger;
  /**
   * The world's write-metrics collector (T016), forwarded to
   * `importToWorld` so the rows an import writes are accounted for like any
   * other session write. Optional — undefined leaves the import unobserved,
   * which is what the service-level tests rely on.
   */
  metrics?: WriteMetricsCollector;
}

// ---------------------------------------------------------------------------
// compendium:list
// REQ-CMP-012
// ---------------------------------------------------------------------------

export function buildCompendiumListHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, ctx): Ack => {
    const parsed = CompendiumListPayloadSchema.safeParse(payload);
    const rawFilter = parsed.success ? parsed.data : {};
    // Strip undefined values to satisfy exactOptionalPropertyTypes
    const filter: { systemId?: string; documentType?: string } = {};
    if (rawFilter.systemId !== undefined) filter.systemId = rawFilter.systemId;
    if (rawFilter.documentType !== undefined) filter.documentType = rawFilter.documentType;

    // Audience gate: role from the authenticated socket context (REQ-CPD-071).
    const packs = deps.compendium.listPacks(
      ctx.role,
      Object.keys(filter).length > 0 ? filter : undefined,
    );

    return { ok: true, result: { packs } };
  };
}

// ---------------------------------------------------------------------------
// compendium:index
// REQ-CMP-007
// ---------------------------------------------------------------------------

export function buildCompendiumIndexHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, ctx): Ack => {
    const parsed = CompendiumIndexPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:index payload",
      };
    }

    // Audience gate: a pack hidden from this role returns null here, taking the
    // very same NOT_FOUND branch an unknown packId takes (REQ-SEC-020).
    const packIndex = deps.compendium.getPackIndex(ctx.role, parsed.data.packId);
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
  return (payload, ctx): Ack => {
    const parsed = CompendiumSearchPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:search payload",
      };
    }

    // Audience gate (REQ-CPD-071): searching a hidden pack looks like searching
    // a pack that does not exist.
    const entries = deps.compendium.searchPack(ctx.role, parsed.data.packId, parsed.data);
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
  return (payload, ctx): Ack => {
    const parsed = CompendiumGetPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:get payload",
      };
    }

    // Audience gate (REQ-CPD-071): a uuid inside a hidden pack answers exactly
    // like a uuid that names nothing — knowing the uuid proves nothing.
    const doc = deps.compendium.getDocument(ctx.role, parsed.data.uuid);
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
// compendium:i18nBySourceRef — resolve pt-BR overlay by origin ref (issue #43)
// ---------------------------------------------------------------------------

/**
 * Registered in `../net/socket-manager.ts` alongside the other `compendium:*`
 * handlers. Readable by every role — over the packs that role can see: a
 * translation overlay carries no privileged data of its own, but it names the
 * document, so it obeys the pack audience exactly like `compendium:get`
 * (REQ-CPD-071). A ref into a hidden pack resolves to the ordinary
 * `{ i18n: null }` answer, which is also what an unknown ref returns.
 */
export function buildCompendiumI18nBySourceRefHandler(deps: CompendiumHandlerDeps): HandlerFn {
  return (payload, ctx): Ack => {
    const parsed = CompendiumI18nBySourceRefPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Invalid compendium:i18nBySourceRef payload",
      };
    }

    // `null` is a normal, expected outcome (no translation / stale / unknown
    // origin ref) — NOT an error. The caller falls back to EN.
    const i18n = deps.compendium.getI18nBySourceRef(ctx.role, parsed.data);

    return { ok: true, result: { i18n } };
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
        systemModule?: SystemModule;
        logger?: Logger;
        metrics?: WriteMetricsCollector;
      } = {
        db: deps.db,
        worldId: ctx.worldId,
        userId: ctx.userId,
        role: ctx.role,
      };
      if (parsed.data.folderId !== undefined) {
        importOpts.folderId = parsed.data.folderId;
      }
      if (deps.systemModule !== undefined) {
        importOpts.systemModule = deps.systemModule;
      }
      if (deps.logger !== undefined) {
        importOpts.logger = deps.logger;
      }
      if (deps.metrics !== undefined) {
        importOpts.metrics = deps.metrics;
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
