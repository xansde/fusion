/**
 * registerPf2eSheets.ts — PF2e client-side sheet registration.
 *
 * Called once during client boot (after Svelte app mounts) to register the
 * PF2e sheet components into the client sheetRegistry so they can be resolved
 * when opening an Actor document.
 *
 * The WindowHost integration calls sheetRegistry.resolve("Actor", "character")
 * and passes the result component to windowManager.open().
 *
 * REQ-UIF-018..019: registerSheet by (documentType, subtype); engine provides
 * defaults.
 * REQ-PF2-110..112: character, npc, hazard, loot sheets.
 * Spec: 17-sistema-pf2e.md §Fichas, 11-ui-framework-e-fichas.md §Sistema de Sheets.
 *
 * Clean-room.
 */

import type { Socket } from "socket.io-client";
import { sheetRegistry } from "../sheetRegistry.js";

// Lazy import to avoid pulling Svelte heavy import graph until needed.
// In tests this file is never loaded (tests target the VMs, not the registry).

/**
 * Register all PF2e sheet components with the client sheet registry.
 *
 * Call this once during app boot (e.g., in App.svelte onMount, after the
 * Svelte runtime is ready).
 */
export async function registerPf2eSheets(): Promise<void> {
  // Dynamic imports keep the sheet code in separate bundles (code-split) and
  // avoid requiring Svelte at module-init time (which breaks Node tests).
  const [{ default: CharacterSheet }, { default: NpcSheet }, { default: FamiliarSheet }] =
    await Promise.all([
      import("../../../components/sheets/pf2e/CharacterSheet.svelte"),
      import("../../../components/sheets/pf2e/NpcSheet.svelte"),
      import("../../../components/sheets/pf2e/pets/FamiliarSheet.svelte"),
    ]);

  // Character sheet — primary PC sheet (REQ-PF2-110)
  sheetRegistry.register("Actor", "character", CharacterSheet, {
    defaultSize: { width: 760, height: 600 },
    makeDefault: true,
  });

  // NPC sheet — compact GM statblock (REQ-PF2-111)
  sheetRegistry.register("Actor", "npc", NpcSheet, {
    defaultSize: { width: 480, height: 520 },
    makeDefault: true,
  });

  // Hazard sheet — reuse NPC sheet (compact statblock fits hazards too)
  // REQ-PF2-112: hazard sheet = statblock of trap: AC/saves/HP/Hardness + routine
  sheetRegistry.register("Actor", "hazard", NpcSheet, {
    defaultSize: { width: 460, height: 440 },
    makeDefault: true,
  });

  // Loot sheet — reuse NPC sheet (only inventory is relevant for loot)
  // REQ-PF2-112: loot sheet = inventory only
  sheetRegistry.register("Actor", "loot", NpcSheet, {
    defaultSize: { width: 440, height: 400 },
    makeDefault: true,
  });

  // Familiar / companion sheet — lean statblock with a link back to the master
  // (spec 29 REQ-PET-055). Creation + ability budget are driven from the
  // master's Pets tab; this window is the standalone view.
  sheetRegistry.register("Actor", "familiar", FamiliarSheet, {
    defaultSize: { width: 420, height: 460 },
    makeDefault: true,
  });
}

/**
 * Open a sheet for an actor document using the windowManager.
 *
 * Centralises the "open actor sheet" logic so that double-clicking a token,
 * clicking an actor in the sidebar, etc., all use the same code path.
 *
 * @param actorId   The actor._id.
 * @param actorDoc  The full actor document (reactive, from DocumentMirror).
 * @param opts      Window context: userId, ownership, isGm, sendOpFn, socket
 *                  (DEC-R10-04 — CharacterSheet's Spells tab needs a live
 *                  Socket for the compendium spell picker; optional so
 *                  callers that don't have one yet keep compiling), plus an
 *                  optional `tokenBinding` when the sheet is opened FROM a
 *                  token (REQ-DOC-033).
 */
export function openActorSheet(
  actorId: string,
  actorDoc: Record<string, unknown>,
  _opts: {
    userId: string;
    ownership: number;
    isGm: boolean;
    worldId?: string;
    socket?: Socket;
    sendOpFn?: (op: unknown) => void;
    /**
     * Set when this sheet belongs to ONE token rather than to the world Actor.
     * Six unlinked skeletons share an `actorId`, so keying the window by the
     * actor would collapse all six sheets into one — the first click would
     * "open" a window already showing another skeleton's hit points.
     */
    tokenBinding?: { sceneId: string; tokenId: string; actorId: string; linked: boolean };
  },
): void {
  // Lazy import to avoid circular imports when this module is loaded server-side.
  // In browser context these are synchronous after the first load.
  void import("$lib/windows/window-manager.js").then(({ windowManager }) => {
    const systemDoc = actorDoc["system"] as Record<string, unknown> | undefined;
    const rawSubtype = systemDoc?.["subtype"] ?? actorDoc["type"] ?? "character";
    const subtype = typeof rawSubtype === "string" ? rawSubtype : "character";
    const rawName = actorDoc["name"];
    const name = typeof rawName === "string" ? rawName : "Actor";
    const binding = _opts.tokenBinding;
    const singletonKey =
      binding && !binding.linked ? `sheet:Token:${binding.tokenId}` : `sheet:Actor:${actorId}`;

    const reg = sheetRegistry.resolve("Actor", subtype);
    if (!reg) {
      console.warn(`[openActorSheet] No sheet registered for Actor:${subtype}`);
      return;
    }

    // Open a window carrying the resolved Svelte sheet component.
    // WindowHost mounts it dynamically via Svelte 5 <svelte:component> when
    // WindowEntry.component is set (REQ-UIF-019).
    windowManager.open({
      singletonKey,
      title: `${name} (${subtype})`,
      icon: "📋",
      resizable: true,
      minimizable: true,
      position: {
        width: reg.defaultSize?.width ?? 640,
        height: reg.defaultSize?.height ?? 480,
      },
      component: reg.component,
      componentProps: {
        actorId,
        doc: actorDoc,
        ..._opts,
      },
    });
  });
}
