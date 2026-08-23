/**
 * Combat — Zod schemas for CombatDocument and CombatantDocument.
 *
 * All TypeScript types for the combat subsystem are derived via z.infer<>
 * from these schemas so the schema and type are never out of sync.
 *
 * Spec: 10-combate-e-iniciativa.md §Modelo de Dados
 * Spec: 02-modelo-de-dados.md §CombatDocument / CombatantData
 * REQ-DOC-012: Zod schemas with derived TypeScript types.
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

import { z } from "zod";
import { FlagsSchema } from "../document.js";

// ---------------------------------------------------------------------------
// CombatantDocument schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for an embedded Combatant document.
 *
 * Spec: 10-combate-e-iniciativa.md §CombatantDocument
 * REQ-DOC-019: Combatant is embedded in Combat.
 */
export const CombatantDocumentSchema = z.object({
  /** 16-char nanoid, unique within the parent CombatDocument. REQ-DOC-001. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /** Soft reference to the Token in the scene. REQ-DOC-011 (D11). */
  tokenId: z.string().nullable(),

  /** Soft reference to the Actor document. Nullable. REQ-DOC-011. */
  actorId: z.string().nullable(),

  /**
   * Display name snapshot for the tracker.
   * Non-empty string; taken from token/actor at add-combatant time.
   */
  name: z.string().min(1).max(256),

  /** Token image URL or path. null when token has no image. */
  img: z.string().nullable(),

  /**
   * Initiative value. null = not yet rolled / not yet set.
   * REQ-CBT-010, REQ-CBT-014.
   */
  initiative: z.number().nullable(),

  /**
   * Identifier of the statistic used for initiative.
   * E.g. "perception", "stealth", "body".
   * null when not set by the system / player.
   * REQ-CBT-018.
   */
  initiativeStatistic: z.string().nullable(),

  /**
   * Hidden from players in the tracker.
   * REQ-CBT-031: hidden combatants are invisible to players.
   *
   * SECURITY NOTE: the server's redaction layer must strip hidden combatants
   * from all payloads sent to non-GM sockets (snapshot, broadcast, ack).
   * See packages/server/src/net/redaction.ts.
   */
  hidden: z.boolean().default(false),

  /**
   * Marked as defeated.
   * REQ-CBT-024, REQ-CBT-025.
   */
  defeated: z.boolean().default(false),

  /**
   * Whether this combatant's actor is owned by at least one player.
   * Server refreshes this cache when actor ownership changes.
   */
  hasPlayerOwner: z.boolean().default(false),

  /** Namespaced arbitrary data. REQ-DOC-009. */
  flags: FlagsSchema.default(() => ({})),
});

export type CombatantDocumentData = z.infer<typeof CombatantDocumentSchema>;

// ---------------------------------------------------------------------------
// CombatDocument schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for the primary Combat document.
 *
 * Spec: 10-combate-e-iniciativa.md §DEC-CBT-01, §DEC-CBT-06
 * Spec: 02-modelo-de-dados.md §CombatDocument
 * REQ-DOC-018: Combat is a primary Document.
 * REQ-CBT-001: persisted in world.db.
 */
export const CombatDocumentSchema = z.object({
  /** 16-char nanoid. REQ-DOC-001. */
  _id: z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]"),

  /**
   * Soft reference to the Scene this encounter belongs to.
   * REQ-CBT-001.
   */
  sceneId: z.string(),

  /**
   * Current round. Starts at 1 when the encounter begins.
   * REQ-CBT-020.
   */
  round: z.number().int().min(0).default(0),

  /**
   * Index of the active combatant in the ordered turns array.
   * 0-based. Default 0.
   *
   * Canonical field name per spec 10 §Modelo de Dados (CombatDocument.turnIndex).
   * REQ-CBT-020..022.
   *
   * NOTE: turnIndex is positional against the GM's FULL (unredacted) combatants
   * array. It is NOT safe for a player to index into their own (redacted)
   * combatants array with it, because hidden combatants are stripped before the
   * array reaches a player — the positions shift. Players MUST resolve the
   * active combatant by `activeCombatantId` (matched by `_id`), never by index.
   */
  turnIndex: z.number().int().min(0).default(0),

  /**
   * _id of the combatant whose turn it currently is, or null when the combat
   * has not started / has no eligible combatant.
   *
   * This is the AUTHORITATIVE pointer to the active combatant. Unlike
   * `turnIndex` (which is positional against the GM's full array), this id is
   * stable across redaction: a player's redacted combatants array still
   * contains the matching `_id` when the active combatant is visible.
   *
   * REDACTION (REQ-CBT-031): when the active combatant is itself hidden, the
   * server masks this field to null for non-GM viewers so a player cannot learn
   * the id/existence of a hidden active combatant. The client therefore renders
   * no highlight / no turn marker in that case, which is the correct behaviour.
   *
   * REQ-CBT-042 (active-turn highlight) and REQ-CBT-050/052 (canvas turn marker)
   * are derived from this id on the client, never from turnIndex.
   */
  activeCombatantId: z.string().nullable().default(null),

  /**
   * Whether beginCombat has been called.
   * REQ-CBT-020.
   */
  started: z.boolean().default(false),

  /**
   * Whether endCombat has been called.
   * REQ-CBT-006.
   */
  ended: z.boolean().default(false),

  /**
   * When true (default), nextTurn skips defeated combatants.
   * DEC-CBT-07, REQ-CBT-023.
   */
  skipDefeated: z.boolean().default(true),

  /**
   * Canvas auto-pans to the active token on turn change when true.
   * REQ-CBT-045.
   */
  autoPan: z.boolean().default(false),

  /**
   * Combat type discriminator.
   * "standard" = normal encounter (PF2e).
   * "starship" = SF2e cinematic scene [V2].
   * Systems may register additional types via the system API.
   * REQ-CBT-012.
   */
  combatType: z.string().default("standard"),

  /**
   * Actor attribute path for the secondary resource in the tracker.
   * E.g. "attributes.hp". null = none.
   * REQ-CBT-047.
   */
  trackedResource: z.string().nullable().default(null),

  /**
   * Embedded combatants array. Ordered by the initiative comparator.
   * REQ-DOC-019: Combatant is embedded in Combat.
   * REQ-CBT-016: sorted by comparator; nulls at the end.
   */
  combatants: z.array(CombatantDocumentSchema).default(() => []),

  /** Namespaced arbitrary data. REQ-DOC-009. */
  flags: FlagsSchema.default(() => ({})),

  /** Sort order. Default 0. REQ-DOC-007. */
  sort: z.number().int().default(0),
});

export type CombatDocumentData = z.infer<typeof CombatDocumentSchema>;

// ---------------------------------------------------------------------------
// CombatTurnSnapshot schema
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of combat state at a specific turn boundary.
 * Carried in lifecycle events and the combat:turnChange broadcast.
 *
 * Spec: 10-combate-e-iniciativa.md §CombatTurnSnapshot
 */
export const CombatTurnSnapshotSchema = z.object({
  round: z.number().int().min(0),
  turnIndex: z.number().int().min(0),
  /** _id of the active combatant, null if combat has not started. */
  combatantId: z.string().nullable(),
  /** tokenId of the active combatant, null if none. */
  tokenId: z.string().nullable(),
});

export type CombatTurnSnapshotData = z.infer<typeof CombatTurnSnapshotSchema>;
