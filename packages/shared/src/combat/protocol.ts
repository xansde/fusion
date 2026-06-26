/**
 * Combat — protocol payload Zod schemas and envelope type literals.
 *
 * Defines all socket.io message payloads for the combat subsystem:
 *
 * Envelope-type literals follow spec 10 §API e Eventos (socket.io table) verbatim
 * for the events listed there; combat:create / combat:addCombatant /
 * combat:removeCombatant are additional socket ops the socket-first server needs
 * (the spec exposes those as REST, but Fusion is socket-authoritative).
 *
 * Client → Server (requests):
 *   combat:create          — GM creates a new encounter (socket-first analogue of POST /combats)
 *   combat:beginCombat     — GM starts the encounter (REQ-CBT-004, REQ-CBT-020)
 *   combat:addCombatant    — GM adds a token as a combatant (REQ-CBT-002)
 *   combat:removeCombatant — GM removes a combatant (REQ-CBT-003)
 *   combat:rollInitiative  — Roll initiative for combatant(s) [server-side RNG]
 *   combat:setInitiative   — GM sets initiative manually
 *   combat:resetInitiative — GM zeros all initiatives
 *   combat:nextTurn        — Advance turn
 *   combat:previousTurn    — Go back one turn
 *   combat:setDefeated     — Mark/unmark defeated flag
 *   combat:setHidden       — Hide/reveal a combatant
 *   combat:reorder         — Drag-and-drop reorder
 *   combat:endCombat       — End the encounter
 *   combat:target          — Mark/unmark a token as a target (REQ-CBT-053)
 *
 * Server → Clients (broadcasts):
 *   combat:created         — New encounter created
 *   combat:updated         — State changed (turnIndex, round, combatant fields…)
 *   combat:deleted         — Encounter ended/deleted
 *   combat:turnChange      — Convenience broadcast for UI turn indicator
 *   combat:initiativeSet   — A single combatant's initiative changed
 *   token:targeted         — Targeting update for a token (REQ-CBT-053..054)
 *
 * Design note (broadcast strategy):
 *   Combat state changes are broadcast via the existing doc:update pipeline
 *   (CombatDocument as a diff) for persistence + client mirror sync.
 *   Additionally, combat:turnChange is emitted as a dedicated event to give
 *   the client's canvas a low-latency signal to move the turn marker without
 *   needing to diff the full document. Both paths carry the same logical state.
 *
 * Spec: 10-combate-e-iniciativa.md §API e Eventos
 * REQ-CBT-001..015, REQ-CBT-020..025, REQ-CBT-031..035
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

import { z } from "zod";
import {
  CombatDocumentSchema,
  CombatantDocumentSchema,
  CombatTurnSnapshotSchema,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Envelope type literals
// ---------------------------------------------------------------------------
// These literals must be added to EnvelopeTypeSchema in protocol.ts
// by the M2-C integration step. Exported here so the server and client can
// import them without duplicating strings.

export const COMBAT_ENVELOPE_TYPES = [
  // client → server
  "combat:create",
  "combat:beginCombat",
  "combat:addCombatant",
  "combat:removeCombatant",
  "combat:rollInitiative",
  "combat:setInitiative",
  "combat:resetInitiative",
  "combat:nextTurn",
  "combat:previousTurn",
  "combat:setDefeated",
  "combat:setHidden",
  "combat:reorder",
  "combat:endCombat",
  "combat:target",
  // server → clients
  "combat:created",
  "combat:updated",
  "combat:deleted",
  "combat:turnChange",
  "combat:initiativeSet",
  "token:targeted",
] as const;

export type CombatEnvelopeType = (typeof COMBAT_ENVELOPE_TYPES)[number];

// ---------------------------------------------------------------------------
// Client → Server payloads
// ---------------------------------------------------------------------------

/**
 * combat:create — GM creates a new encounter in the given scene.
 *
 * The server MUST reject if another non-ended combat already exists for this
 * scene (DEC-CBT-06: one active combat per scene in MVP).
 *
 * REQ-CBT-001.
 */
export const CombatCreatePayloadSchema = z
  .object({
    /** Scene to associate the combat with. */
    sceneId: z.string().min(1).max(64),
    /** Combat type; defaults to "standard" on the server if omitted. */
    combatType: z.string().optional(),
  })
  .strict();

export type CombatCreatePayload = z.infer<typeof CombatCreatePayloadSchema>;

/**
 * combat:beginCombat — GM begins the encounter.
 *
 * The server sets round=1, turnIndex=0, started=true, emits combatStart
 * lifecycle event, then turnStart for the first combatant.
 *
 * REQ-CBT-004, REQ-CBT-020.
 */
export const CombatBeginPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
  })
  .strict();

export type CombatBeginPayload = z.infer<typeof CombatBeginPayloadSchema>;

/**
 * combat:addCombatant — GM adds a token to the encounter as a Combatant.
 *
 * REQ-CBT-002: each Combatant references tokenId and actorId.
 */
export const CombatAddCombatantPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    /** Token to add. The server resolves name/img from the token. */
    tokenId: z.string().min(1).max(64),
    /**
     * Actor id. The server resolves this from the token when omitted.
     * Pass explicitly when the caller already knows it.
     */
    actorId: z.string().nullable().optional(),
    /** Force a specific initiative value (GM manual set on add). */
    initiative: z.number().nullable().optional(),
    /** Whether to add as hidden. */
    hidden: z.boolean().optional(),
  })
  .strict();

export type CombatAddCombatantPayload = z.infer<typeof CombatAddCombatantPayloadSchema>;

/**
 * combat:removeCombatant — GM removes a Combatant from the encounter.
 *
 * REQ-CBT-003.
 */
export const CombatRemoveCombatantPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    combatantId: z.string().min(1).max(64),
  })
  .strict();

export type CombatRemoveCombatantPayload = z.infer<typeof CombatRemoveCombatantPayloadSchema>;

/**
 * combat:rollInitiative — Roll initiative for one or more combatants.
 *
 * The server executes RollService on every target combatant, applying the
 * registered InitiativeFormula for the combat's combatType.
 *
 * REQ-CBT-010: individual roll.
 * REQ-CBT-011: roll all (combatantIds absent = all without initiative).
 * DEC-CBT-03: rolling always on the server (anti-cheat).
 *
 * Security: a player can only roll initiative for their own PC combatants;
 * the server MUST verify ownership before rolling (isRolePrivileged or
 * owner check). GMs can roll for any combatant.
 * REQ-CBT-034: players can roll their own initiative.
 */
export const CombatRollInitiativePayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    /**
     * Specific combatant ids to roll for.
     * When absent or empty array: roll for ALL combatants without initiative.
     * REQ-CBT-011.
     */
    combatantIds: z.array(z.string().min(1).max(64)).optional(),
    /** Extra options forwarded to the formula's roll() context. */
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CombatRollInitiativePayload = z.infer<typeof CombatRollInitiativePayloadSchema>;

/**
 * combat:setInitiative — GM sets a combatant's initiative manually.
 *
 * REQ-CBT-014.
 */
export const CombatSetInitiativePayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    combatantId: z.string().min(1).max(64),
    /** New initiative value. null resets to "not yet rolled". */
    value: z.number().nullable(),
  })
  .strict();

export type CombatSetInitiativePayload = z.infer<typeof CombatSetInitiativePayloadSchema>;

/**
 * combat:resetInitiative — GM resets all initiative values to null.
 *
 * REQ-CBT-015.
 */
export const CombatResetInitiativePayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
  })
  .strict();

export type CombatResetInitiativePayload = z.infer<typeof CombatResetInitiativePayloadSchema>;

/**
 * combat:nextTurn — Advance to the next turn.
 *
 * The server emits turnEnd for the current combatant, advances state,
 * emits roundEnd/roundStart when wrapping, then turnStart for the new combatant.
 *
 * REQ-CBT-004, REQ-CBT-021, REQ-CBT-026..028.
 */
export const CombatNextPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
  })
  .strict();

export type CombatNextPayload = z.infer<typeof CombatNextPayloadSchema>;

/**
 * combat:previousTurn — Go back one turn.
 *
 * REQ-CBT-004, REQ-CBT-022.
 */
export const CombatPreviousPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
  })
  .strict();

export type CombatPreviousPayload = z.infer<typeof CombatPreviousPayloadSchema>;

/**
 * combat:setDefeated — Mark or unmark the defeated flag on a combatant.
 *
 * Matches spec 10 §API e Eventos: payload { combatId, combatantId, defeated }.
 * REQ-CBT-024, REQ-CBT-025.
 */
export const CombatSetDefeatedPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    combatantId: z.string().min(1).max(64),
    /** Target defeated state. */
    defeated: z.boolean(),
  })
  .strict();

export type CombatSetDefeatedPayload = z.infer<typeof CombatSetDefeatedPayloadSchema>;

/**
 * combat:setHidden — Hide or reveal a combatant from players.
 *
 * REQ-CBT-031: only GM can hide combatants.
 */
export const CombatSetHiddenPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    combatantId: z.string().min(1).max(64),
    hidden: z.boolean(),
  })
  .strict();

export type CombatSetHiddenPayload = z.infer<typeof CombatSetHiddenPayloadSchema>;

/**
 * combat:reorder — Manual reorder via drag-and-drop in the tracker.
 *
 * The server updates initiative values of the affected combatants to preserve
 * the new order, then re-sorts and broadcasts the updated Combat.
 *
 * REQ-CBT-017.
 */
export const CombatReorderPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
    /**
     * Full ordered list of combatant _ids in the desired new order.
     * Must include every combatant _id (no partial reorders).
     */
    order: z.array(z.string().min(1).max(64)).min(1),
  })
  .strict();

export type CombatReorderPayload = z.infer<typeof CombatReorderPayloadSchema>;

/**
 * combat:endCombat — GM ends the encounter.
 *
 * The server emits combatEnd lifecycle event, sets ended=true, broadcasts
 * combat:deleted (tracker clears), and archives the document.
 *
 * REQ-CBT-004, REQ-CBT-006.
 */
export const CombatEndPayloadSchema = z
  .object({
    combatId: z.string().min(1).max(64),
  })
  .strict();

export type CombatEndPayload = z.infer<typeof CombatEndPayloadSchema>;

/**
 * combat:target — Mark or unmark a token as a target for the requesting user.
 *
 * Spec 10 §API e Eventos lists the payload as { tokenId, targeted, userId }, but
 * `userId` is server-authoritative: the server derives the acting user from the
 * authenticated socket context and MUST ignore any client-supplied userId. The
 * client therefore only sends { tokenId, targeted }; the server echoes the
 * resolved userId back via the token:targeted broadcast.
 *
 * REQ-CBT-053: GM/player with permission marks tokens as targets.
 */
export const CombatTargetPayloadSchema = z
  .object({
    tokenId: z.string().min(1).max(64),
    targeted: z.boolean(),
  })
  .strict();

export type CombatTargetPayload = z.infer<typeof CombatTargetPayloadSchema>;

// ---------------------------------------------------------------------------
// Server → Client payloads
// ---------------------------------------------------------------------------

/**
 * combat:created — Broadcast when a new encounter is created.
 *
 * All clients receive this and add the Combat to their local collection.
 */
export const CombatCreatedPayloadSchema = z.object({
  combat: CombatDocumentSchema,
});

export type CombatCreatedPayload = z.infer<typeof CombatCreatedPayloadSchema>;

/**
 * combat:updated — Broadcast when the Combat state changes.
 *
 * Carries a partial CombatDocument (the diff). Clients merge this into their
 * local Combat mirror. The combatants array when present is the FULL array
 * (not a diff), consistent with REQ-DOC-037 (arrays are replaced, not merged).
 */
export const CombatUpdatedPayloadSchema = z.object({
  combatId: z.string(),
  /**
   * Partial Combat state. Only changed fields are present (dot-path diff).
   * If combatants changed, the full sorted combatants array is included.
   */
  diff: z.record(z.string(), z.unknown()),
  /** New canonical sequence number after this update. */
  seq: z.number().int().nonnegative().optional(),
});

export type CombatUpdatedPayload = z.infer<typeof CombatUpdatedPayloadSchema>;

/**
 * combat:deleted — Broadcast when an encounter is ended/deleted.
 *
 * Clients remove the Combat from their local collection and clear the tracker.
 * REQ-CBT-006, REQ-CBT-011 (CA-CBT-011).
 */
export const CombatDeletedPayloadSchema = z.object({
  combatId: z.string(),
});

export type CombatDeletedPayload = z.infer<typeof CombatDeletedPayloadSchema>;

/**
 * combat:turnChange — Low-latency broadcast for UI and canvas turn marker.
 *
 * Emitted after every successful nextTurn / previousTurn / startCombat.
 * The canvas uses `current.tokenId` to reposition the combat turn marker
 * without waiting for the full doc:update pipeline.
 *
 * REQ-CBT-050..052 (canvas turn marker).
 */
export const CombatTurnChangePayloadSchema = z.object({
  combatId: z.string(),
  current: CombatTurnSnapshotSchema,
  previous: CombatTurnSnapshotSchema,
});

export type CombatTurnChangePayload = z.infer<typeof CombatTurnChangePayloadSchema>;

/**
 * combat:initiativeSet — Broadcast when a single combatant's initiative changes.
 *
 * Emitted after combat:rollInitiative (per combatant) and combat:setInitiative.
 * The tracker uses this for a low-latency update of one row without diffing the
 * full combatants array.
 *
 * Spec 10 §API e Eventos: payload { combatId, combatantId, initiative }.
 * REQ-CBT-010, REQ-CBT-014.
 */
export const CombatInitiativeSetPayloadSchema = z.object({
  combatId: z.string(),
  combatantId: z.string(),
  /** New initiative value, or null when reset. */
  initiative: z.number().nullable(),
});

export type CombatInitiativeSetPayload = z.infer<typeof CombatInitiativeSetPayloadSchema>;

/**
 * token:targeted — Broadcast of a targeting update for a token.
 *
 * Spec 10 §API e Eventos: payload { tokenId, targeted, userId }. The server fills
 * `userId` from the authenticated socket that issued combat:target.
 *
 * REQ-CBT-053, REQ-CBT-054.
 */
export const TokenTargetedPayloadSchema = z.object({
  tokenId: z.string(),
  targeted: z.boolean(),
  /** The user who set/cleared the target (server-resolved). */
  userId: z.string(),
});

export type TokenTargetedPayload = z.infer<typeof TokenTargetedPayloadSchema>;

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { CombatDocumentSchema, CombatantDocumentSchema, CombatTurnSnapshotSchema };
