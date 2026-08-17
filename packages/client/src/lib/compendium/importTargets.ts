/**
 * importTargets.ts — where an entry can be brought, and by whom.
 *
 * Spec 43 §5.7, DEC-CPD-05 (REQ-CPD-060, REQ-CPD-061, REQ-CPD-073): there are
 * TWO destinations, not one action with two permissions. Bringing to the
 * **world** is the privileged act `compendium:import` has always been; bringing
 * to a **sheet** is `compendium:importToActor`, and what protects it is `OWNER`
 * of the DESTINATION actor, never the caller's role.
 *
 * Everything here is a HINT for drawing the panel. The server decides — it
 * re-reads the destination's ownership on every call, so a stale mirror can
 * only produce a refused call, never an unauthorized write (REQ-CPD-074). We
 * still compute it on the client for one reason: offering an action that will
 * certainly be refused is worse than not offering it.
 *
 * Also here: what happens when something is dropped on the SCENE. Only an actor
 * has a destination there (REQ-CPD-062); anything else is refused BEFORE any
 * import runs (REQ-CPD-063) — the refusal has to be a decision taken over the
 * payload, not a silent `return` that leaves the user wondering.
 */

import { OwnershipLevel, getUserLevel, isSheetImportableDocumentType } from "@fusion/shared";
import type { Ownership } from "@fusion/shared";
import { displayName } from "../docs/displayName.js";
import type { CompendiumDragPayload } from "./compendiumBrowser.js";

// ---------------------------------------------------------------------------
// Sheets the seat may write to
// ---------------------------------------------------------------------------

/** One destination sheet, as the panel needs to name it. */
export interface SheetTarget {
  readonly actorId: string;
  readonly name: string;
  /** `character`, `npc`, … — lets the panel prefer the seat's own character. */
  readonly subtype: string | null;
}

/** Who is asking. `isPrivileged` mirrors the server's `isRolePrivileged`. */
export interface ImportViewer {
  readonly userId: string;
  readonly isPrivileged: boolean;
}

function readOwnership(doc: Record<string, unknown>): Ownership {
  const raw = doc["ownership"];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Ownership;
  return { default: OwnershipLevel.NONE };
}

function readString(doc: Record<string, unknown>, key: string): string | null {
  const value = doc[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The actors this seat could bring something into, newest ordering untouched
 * (the caller's mirror order is the world's order).
 *
 * A privileged seat owns every actor — the same answer the server's
 * `resolveOwnership` gives it — so the Game Master sees every sheet as a
 * possible destination and does not need a second, role-shaped rule.
 *
 * Tolerant of junk in the mirror: an entry without a string `_id` is skipped
 * rather than drawn as a destination with no name.
 */
export function buildSheetTargets(actors: readonly unknown[], viewer: ImportViewer): SheetTarget[] {
  const targets: SheetTarget[] = [];
  for (const raw of actors) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const doc = raw as Record<string, unknown>;
    const actorId = readString(doc, "_id");
    if (!actorId) continue;

    const owns =
      viewer.isPrivileged ||
      getUserLevel(readOwnership(doc), viewer.userId) >= OwnershipLevel.OWNER;
    if (!owns) continue;

    // REQ-CMP-055 (A041): the "Destino" select is a name-display surface like any
    // other — it MUST resolve through the single displayName() mechanism, never
    // a raw doc.name read, or a pt-BR-imported actor would show its EN-pure name
    // here while every other surface (NPCs tab, Contatos, sheet) shows the label.
    const resolved = displayName(doc);
    targets.push({
      actorId,
      name: resolved.length > 0 ? resolved : actorId,
      subtype: readString(doc, "type"),
    });
  }
  return targets;
}

/** REQ-CPD-060: only a privileged seat brings an entry into the world. */
export function canBringToWorld(viewer: ImportViewer): boolean {
  return viewer.isPrivileged;
}

/**
 * REQ-CPD-061: a sheet receives an entry of a COMPATIBLE type, and only if the
 * seat owns at least one sheet. The type list is the server's
 * (`isSheetImportableDocumentType`), not a second list kept in step by hand.
 */
export function canBringToSheet(documentType: string, targets: readonly SheetTarget[]): boolean {
  return isSheetImportableDocumentType(documentType) && targets.length > 0;
}

// ---------------------------------------------------------------------------
// Dropping on the scene (REQ-CPD-062, REQ-CPD-063)
// ---------------------------------------------------------------------------

/**
 * What a drop over the scene means. `accepted` carries the uuid to bring to the
 * world FIRST — the presence on the map is created from the world copy, never
 * from the pack entry (REQ-CPD-062) — and the refusal carries an i18n key,
 * because "nothing happened" is not a message.
 */
export type SceneDropDecision =
  | { readonly accepted: true; readonly payload: CompendiumDragPayload }
  | { readonly accepted: false; readonly reasonKey: string };

/** The refusal key for a payload the scene has no place for (REQ-CPD-063). */
export const SCENE_DROP_NOT_AN_ACTOR_KEY = "FUSION.Compendium.Drop.NotAnActor";

/**
 * Decide a drop over the scene WITHOUT importing anything.
 *
 * This function exists so the refusal of REQ-CPD-063 is a value the caller has
 * to handle, instead of a `return` buried in a drop handler: a non-actor payload
 * must not be brought to the world and then discarded — the import must never
 * run at all. The caller therefore reads the decision before touching the
 * socket.
 *
 * A payload that is not a compendium drag at all yields `null`, not a refusal:
 * dragging a world actor, a file or a text selection is somebody else's gesture
 * and this panel has no opinion on it.
 */
export function decideSceneDrop(payload: CompendiumDragPayload | null): SceneDropDecision | null {
  if (!payload) return null;
  if (payload.kind === "compendium-actor" && payload.documentType === "Actor") {
    return { accepted: true, payload };
  }
  return { accepted: false, reasonKey: SCENE_DROP_NOT_AN_ACTOR_KEY };
}
