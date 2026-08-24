/**
 * openActorSheet.ts — open a sheet for an actor document via the windowManager.
 *
 * Centralises the "open actor sheet" logic so that double-clicking a token,
 * clicking an actor in the sidebar, etc., all use the same code path. Moved
 * here (F3, DEC-SEP-02) from the PF2e territory it used to live in: the
 * function itself is fully system-agnostic — it only reads the actor's
 * `subtype`, resolves the component through `sheetRegistry` (populated by
 * whichever system registered a sheet for that subtype), and opens a window.
 * It never imports a system package, so it belongs to the core framework.
 *
 * REQ-UIF-018..019: registerSheet by (documentType, subtype); engine provides
 * defaults.
 */

import type { Socket } from "socket.io-client";
import { sheetRegistry } from "./sheetRegistry.js";
import { displayName } from "../docs/displayName.js";

/**
 * Open a sheet for an actor document using the windowManager.
 *
 * @param actorId   The actor._id.
 * @param actorDoc  The full actor document (reactive, from DocumentMirror).
 * @param opts      Window context: userId, ownership, isGm, sendOpFn, socket
 *                  (DEC-R10-04 — CharacterSheet's Spells tab needs a live
 *                  Socket for the compendium spell picker; optional so
 *                  callers that don't have one yet keep compiling).
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
     * Window identity, when the caller needs one other than the actor's.
     * A sheet opened FROM an unlinked token must be keyed by the TOKEN
     * (REQ-CNV-094): six skeletons sharing one `Actor` would otherwise
     * collapse into a single window. Never forwarded to the sheet component
     * — it is about the window, not about the actor.
     */
    singletonKey?: string;
  },
): void {
  // Lazy import to avoid circular imports when this module is loaded server-side.
  // In browser context these are synchronous after the first load.
  void import("$lib/windows/window-manager.js").then(({ windowManager }) => {
    const systemDoc = actorDoc["system"] as Record<string, unknown> | undefined;
    const rawSubtype = systemDoc?.["subtype"] ?? actorDoc["type"] ?? "character";
    const subtype = typeof rawSubtype === "string" ? rawSubtype : "character";
    // REQ-CMP-055: the window title is a display surface for the actor's
    // name, so it MUST resolve through the same single mechanism
    // (displayName) as the NPCs tab / Contatos / sheet header — never a
    // second, ad-hoc read of the raw (EN-pure) doc.name.
    const resolvedName = displayName(actorDoc);
    const name = resolvedName.length > 0 ? resolvedName : "Actor";
    const { singletonKey: requestedKey, ...sheetProps } = _opts;
    const singletonKey = requestedKey ?? `sheet:Actor:${actorId}`;

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
        ...sheetProps,
      },
    });
  });
}
