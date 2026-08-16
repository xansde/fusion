/**
 * createCharacterScaffolding.ts — SCAFFOLDING. Delete with G105.
 *
 * ============================ SCAFFOLDING ==================================
 * This module exists for ONE reason: G078 buried the legacy Actors directory, and
 * that panel's "+Novo" button was the last gesture in the whole client able to
 * create a **player's character**. Spec 42 refuses to grow one (DEC-NPC-02,
 * REQ-NPC-044: this tab authors `npc` and `hazard` and nothing else), and the
 * real address is spec 37's Usuários section — creating a user creates a blank
 * character owned by them (REQ-CFG-051, REQ-USR-025), which is task G105 of
 * phase 9.
 *
 * Between G078 and G105 the table would otherwise have NO way to create a
 * character at all. The project rule is that every UI needs a trigger on the
 * screen, so the trigger stays — clearly fenced off, in its own module, with its
 * own vocabulary, so G105 removes this file and the one block in
 * `NpcCreateDialog.svelte` that renders it, and nothing else moves.
 *
 * What this module deliberately does NOT do, so it cannot rot into the tab:
 *   - it does not touch `NPC_CREATABLE_SUBTYPES` nor `buildCreateNpcOp`; the two
 *     doors of REQ-NPC-041 keep refusing `character` exactly as before;
 *   - it offers no folder, no attitude and no preset — a character is not a
 *     non-playable and must not inherit the tab's authoring vocabulary;
 *   - it never becomes a row: the panel lists `npc`/`hazard` only, so what it
 *     creates is invisible here, which is the point.
 * ===========================================================================
 */

import type { Socket } from "socket.io-client";

import { sendOp } from "../docs/sendOp.js";
import type { CreateNpcOp } from "./createNpc.js";

/**
 * The "default playable" Actor subtype of each target system, taken from the
 * FIRST entry of `documentTypes.Actor` in each system's manifest
 * (`systems/<id>/src/index.ts`): pf2e/sf2e declare `character`, etmos declares
 * `orador`. The manifest is a build-time module and is not shipped to the
 * browser, so the mapping is mirrored here — the same mirror the buried
 * directory carried, moved rather than reinvented.
 */
const DEFAULT_PLAYABLE_SUBTYPE: Readonly<Record<string, string>> = {
  pf2e: "character",
  sf2e: "character",
  etmos: "orador",
};

/**
 * The subtype a character is created with for this world's system. Falls back to
 * `character` for an unknown or not-yet-loaded system, so the control never
 * throws before `worldInfo` has arrived.
 */
export function defaultPlayableSubtype(systemId: string | null | undefined): string {
  if (typeof systemId !== "string") return "character";
  return DEFAULT_PLAYABLE_SUBTYPE[systemId] ?? "character";
}

export interface CharacterScaffoldingInput {
  /** Free text typed by the Mestre; trimmed here. */
  readonly name: string;
  /** `session.worldInfo?.systemId` — decides the subtype. */
  readonly systemId?: string | null | undefined;
}

/**
 * The `doc:create` of a blank character, or null when the form is not fillable
 * yet (empty name).
 *
 * The document is the minimal one the server accepts — name, subtype, ownership
 * and flags, with no `system` blob (the server fills the system defaults). The
 * ownership is the default-NONE map: the character is born with no player
 * attached, which is precisely the hole G105 closes by creating it WITH the user
 * as OWNER (REQ-USR-025a).
 */
export function buildCreateCharacterOp(input: CharacterScaffoldingInput): CreateNpcOp | null {
  const name = input.name.trim();
  if (name.length === 0) return null;

  return {
    type: "doc:create",
    payload: {
      documentType: "Actor",
      data: [
        {
          name,
          type: defaultPlayableSubtype(input.systemId),
          ownership: { default: 0 },
          flags: {},
        },
      ],
    },
  };
}

/** Create the blank character. Resolves false when the form refused it. */
export async function createCharacterScaffolding(
  socket: Socket,
  input: CharacterScaffoldingInput,
): Promise<boolean> {
  const op = buildCreateCharacterOp(input);
  if (op === null) return false;
  await sendOp(socket, op);
  return true;
}
