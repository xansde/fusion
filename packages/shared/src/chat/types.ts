/**
 * Chat and roll types for the Fusion chat subsystem.
 *
 * REQ-CHT-007: five MessageType discriminators.
 * REQ-ROL-028..030: RollResultData with structured terms.
 * 09-chat-e-mensagens.md: ChatMessage Document schema, CardData, ChatSpeaker.
 * 08-motor-de-rolagens.md: RollMode, DiceResult, RollTermResult.
 */

import { z } from "zod";
import { BaseDocumentSchema } from "../document.js";

// ---------------------------------------------------------------------------
// RollMode
// ---------------------------------------------------------------------------

/**
 * Visibility mode for a roll.
 * D5 (spec 08): maps to whisper[] and blind fields on ChatMessage.
 * | Mode        | whisper           | blind |
 * | public      | []                | false |
 * | gmroll      | [...gmUserIds]    | false |
 * | blindroll   | [...gmUserIds]    | true  |
 * | selfroll    | [authorId]        | false |
 */
export const RollModeSchema = z.enum(["public", "gmroll", "blindroll", "selfroll"]);
export type RollMode = z.infer<typeof RollModeSchema>;

// ---------------------------------------------------------------------------
// RollTarget — REQ-ACH-070..074 (spec 38 §5.8, DEC-ACH-09)
// ---------------------------------------------------------------------------

/**
 * A PORTRAIT of the target a roll was graded against — never a live reference
 * to a token (REQ-ACH-072). The log has to keep telling the truth after the
 * token dies, leaves the scene or is renamed, so only the values that were true
 * at the instant of the roll are stored: the name shown, and the AC used.
 *
 * `ac` is PRIVILEGED data (REQ-ACH-073 / REQ-ACH-092 / REQ-SEC-020): the payload
 * delivered to a user without a privileged role carries the name and the degree
 * of success, and NOT the number. That is why the field is optional — a redacted
 * message must still parse as a valid message on the client.
 *
 * The server never accepts an AC from the wire: `chat:send` takes a reference to
 * a token/actor and resolves the number itself (see `ChatTargetRefSchema`).
 */
export const RollTargetSchema = z.object({
  /** Display name at the instant of the roll (token name, or the actor's). */
  name: z.string().min(1).max(200),
  /** AC used to grade the roll. Absent in every non-privileged payload. */
  ac: z.number().int().min(-50).max(100).optional(),
});

export type RollTarget = z.infer<typeof RollTargetSchema>;

// ---------------------------------------------------------------------------
// RollResultData — REQ-ROL-028..030
// ---------------------------------------------------------------------------

/**
 * Result of a single die.
 * REQ-ROL-029: result, active, discarded, rerolled, exploded, success, failure.
 */
export const DiceResultSchema = z.object({
  /** The value rolled. */
  result: z.number(),
  /** Whether this die contributes to the total. */
  active: z.boolean(),
  discarded: z.boolean().optional(),
  rerolled: z.boolean().optional(),
  exploded: z.boolean().optional(),
  /** Marked by cs modifier. */
  success: z.boolean().optional(),
  /** Marked by cf modifier. */
  failure: z.boolean().optional(),
});

export type DiceResult = z.infer<typeof DiceResultSchema>;

/**
 * Result of a single AST term after evaluation.
 * REQ-ROL-028: sufficient to reconstruct full breakdown client-side.
 */
export const RollTermResultSchema = z.object({
  type: z.enum(["dice", "numeric", "operator", "parenthetical", "pool", "function"]),
  /** String representation of the term (e.g. "4d6k3", "+", "5"). */
  expression: z.string(),
  total: z.number(),
  /** Flavor label from [...] annotation. */
  flavor: z.string().optional(),
  // dice-specific
  number: z.number().optional(),
  faces: z.number().optional(),
  modifiers: z.array(z.string()).optional(),
  results: z.array(DiceResultSchema).optional(),
  // pool-specific (array of roll results per expression in pool)
  rolls: z.array(z.array(DiceResultSchema)).optional(),
});

export type RollTermResult = z.infer<typeof RollTermResultSchema>;

/**
 * Complete roll result — serialized by the server and sent to clients.
 * REQ-ROL-028: rollId, formula, expandedFormula, total, terms, flavor, rollMode,
 *              timestamp, warnings, rerollOf, degreeOfSuccess.
 * The seed is NEVER included here (REQ-ROL-049).
 */
export const RollResultDataSchema = z.object({
  rollId: z.string(),
  /** Original formula string, may contain @attr references. */
  formula: z.string(),
  /** Formula after @attr substitution (ready for display). */
  expandedFormula: z.string(),
  total: z.number(),
  terms: z.array(RollTermResultSchema),
  flavor: z.string().optional(),
  rollMode: RollModeSchema,
  /** Unix ms timestamp of the roll. */
  timestamp: z.number().int().nonnegative(),
  /** Warnings (e.g. unresolved @attr). */
  warnings: z.array(z.string()),
  /** If this is a reroll, the rollId of the original roll. */
  rerollOf: z.string().optional(),
  /**
   * Optional degree of success, filled by a system's RollHook postRoll.
   * D7 (spec 08): this is a generic string, not a fixed enum.
   */
  degreeOfSuccess: z.string().optional(),
  /**
   * Portrait of the target this attack roll was graded against (REQ-ACH-070 /
   * REQ-ACH-072). Present ONLY when the server could both resolve the target's
   * AC and grade the roll: without a target there is no degree of success
   * (REQ-ACH-071), and a degree without an AC would be a guess presented as a
   * rule. The `ac` inside is stripped for non-privileged viewers (REQ-ACH-073).
   */
  target: RollTargetSchema.optional(),
});

export type RollResultData = z.infer<typeof RollResultDataSchema>;

// ---------------------------------------------------------------------------
// CardData — REQ-CHT-024..028 (spec 09)
// ---------------------------------------------------------------------------

/**
 * Key-value field displayed in the body of a chat card.
 */
export const CardFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** Display the value in highlight style (e.g. total damage). */
  highlight: z.boolean().optional(),
});

export type CardField = z.infer<typeof CardFieldSchema>;

/**
 * Typed action associated with a card button.
 * REQ-CHT-026: serialized as actionType + actionPayload.
 */
export const CardButtonSchema = z.object({
  /** Unique id within the card (e.g. "apply-damage"). */
  id: z.string(),
  label: z.string(),
  /** Action type registered via SystemAPI.registerCardAction(). */
  actionType: z.string(),
  /** Arbitrary payload passed to the handler on click. */
  actionPayload: z.record(z.string(), z.unknown()),
  icon: z.string().optional(),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  /** Disabled after use (REQ-CHT-028). */
  disabled: z.boolean().optional(),
});

export type CardButton = z.infer<typeof CardButtonSchema>;

/**
 * Declarative chat card schema — no arbitrary HTML allowed.
 * D-CHT-03 (spec 09): rendered by <ChatCard> Svelte component, never innerHTML.
 */
export const CardDataSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  fields: z.array(CardFieldSchema).optional(),
  /** Light markdown, max 500 chars. */
  description: z.string().max(500).optional(),
  buttons: z.array(CardButtonSchema).optional(),
  /** System namespace that created this card (e.g. "pf2e"). */
  systemId: z.string(),
  /**
   * Opaque system context not displayed in UI.
   * REQ-CHT-024: validated but not rendered.
   */
  systemContext: z.record(z.string(), z.unknown()).optional(),
});

export type CardData = z.infer<typeof CardDataSchema>;

// ---------------------------------------------------------------------------
// SpellCastCard — interactive spell-cast card (r17-P2)
// ---------------------------------------------------------------------------

/**
 * The three PF2e basic-save statistics a spell can call for.
 */
export const SpellSaveTypeSchema = z.enum(["fortitude", "reflex", "will"]);
export type SpellSaveType = z.infer<typeof SpellSaveTypeSchema>;

/**
 * Structured payload for an interactive spell-cast chat card (r17-P2).
 *
 * Stored under `flags.pf2e.spellCast` of a ChatMessage (mirroring the Etmos
 * ConjuracaoCard's `flags.etmos.conjuracao` pattern — NOT a declarative
 * `message.card`/CardData). Rendered by <SpellCastCard>, which shows:
 *   - "Fazer teste de resistência" when {saveType + dcValue} are present — any
 *     player may click; the TARGET rolls the save with THEIR actor.
 *   - "Rolar dano" when {damageFormula} is present — visible only to the caster's
 *     owner / GM; rolls the (already-heightened) formula with the caster as
 *     speaker.
 *
 * SECURITY: the server (chat-handler) re-validates this shape with Zod on
 * chat:send and NEVER trusts the client for the DC — `dcValue` is coherence-
 * checked against the caster's derived spellcasting DC when possible. The
 * damage button's caster-ownership gate is enforced client-side (hide) AND, when
 * the button rolls via chat:send with `speakerActorId = casterActorId`, by the
 * server's existing speaker-ownership check (REQ-CHT-022).
 */
export const SpellCastCardSchema = z.object({
  /** Actor id of the caster (speaker + damage-roll ownership gate). */
  casterActorId: z.string().min(1),
  /** Display name of the spell (pt-BR or EN as shown on the sheet). */
  spellName: z.string().min(1).max(200),
  /** Raw EN name (pack join key), when known — display uses `spellName`. */
  spellNameEn: z.string().max(200).optional(),
  /** Effective casting rank (>= base). */
  rank: z.number().int().min(0).max(10),
  /** Action-cost glyphs for display (e.g. "◆◆", "⟳", "◇"), when applicable. */
  actionCost: z.string().max(8).optional(),
  /** Save DC (from the caster's derived spellcasting DC). */
  dcValue: z.number().int().min(1).max(60).optional(),
  /** Save statistic the spell calls for. */
  saveType: SpellSaveTypeSchema.optional(),
  /** True when the save is a basic save. */
  basicSave: z.boolean().optional(),
  /** Damage formula, ALREADY HEIGHTENED to `rank` (r16-G3). */
  damageFormula: z.string().max(200).optional(),
  /** Damage type (e.g. "fire", "electricity"). */
  damageType: z.string().max(40).optional(),
  /** Spell traits (display only). */
  traits: z.array(z.string().max(40)).max(30).optional(),
});

export type SpellCastCard = z.infer<typeof SpellCastCardSchema>;

// ---------------------------------------------------------------------------
// AbilityCard — generalized interactive ability card (r20-X1)
// ---------------------------------------------------------------------------

/**
 * The three kinds of interactive ability card. All render through the SAME
 * <AbilityCard> component + abilityCardVM, differing only in the header
 * icon/label and the flavor prefixes:
 *   - `spell`   — a cast spell (the r17-P2 SpellCastCard, generalized): save
 *     and/or spell-attack + damage. DC comes from the caster's derived
 *     spellcasting DC.
 *   - `impulse` — a Kineticist impulse (r20-X1): a save impulse (Four Winds →
 *     save + damage) OR an attack impulse (Elemental Blast → attack + damage).
 *     DC comes from the caster's derived class DC.
 *   - `strike`  — a weapon strike (r20-X1): attack + damage (+ crit). No DC.
 */
export const AbilityKindSchema = z.enum(["spell", "impulse", "strike"]);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

/**
 * Structured payload for an interactive ability chat card (r20-X1) — the
 * GENERALIZATION of {@link SpellCastCard} that unifies spells, Kineticist
 * impulses and weapon strikes under one schema + one renderer.
 *
 * Stored under `flags.pf2e.abilityCard` of a ChatMessage (mirroring the older
 * `flags.pf2e.spellCast`). Rendered by <AbilityCard>, which shows, driven by
 * which fields are present (NOT rigidly by `kind`):
 *   - "Fazer teste de resistência" when {saveType + dcValue} are present — any
 *     player may click; the TARGET rolls the save with THEIR actor;
 *   - "Rolar dano" when {damageFormula} is present — visible only to the user's
 *     owner / GM; rolls the (already-resolved) formula with the caster as
 *     speaker;
 *   - "Rolar dano crítico" when {critDamageFormula} is present (strikes) — same
 *     ownership gate.
 * An attack roll (spell-attack / strike / blast attack) is NOT a card button:
 * it is fired at announce time and nested under the card, exactly like the
 * spell-attack path (r18-N1).
 *
 * READ COMPAT: messages persisted before r20-X1 carry `flags.pf2e.spellCast`
 * (a SpellCastCard). The client adapts them on read via
 * {@link adaptSpellCastToAbilityCard} — no migration of stored data is needed.
 *
 * SECURITY: the server (chat-handler) re-validates this shape with Zod on
 * chat:send, enforces caster=speaker, and DC-coherence-checks `dcValue` against
 * the caster's derived DC by kind (spellcasting DC for `spell`, class DC for
 * `impulse`). Strikes never carry a DC.
 */
export const AbilityCardSchema = z.object({
  /** Discriminates the header/flavor treatment + server DC-coherence source. */
  kind: AbilityKindSchema,
  /** Actor id of the ability's user (speaker + damage-roll ownership gate). */
  casterActorId: z.string().min(1),
  /** Display name (pt-BR or EN as shown on the sheet). */
  name: z.string().min(1).max(200),
  /** Raw EN name (pack join key), when known — display uses `name`. */
  nameEn: z.string().max(200).optional(),
  /** Effective spell rank (spell only; >= base). Absent for impulse/strike. */
  rank: z.number().int().min(0).max(10).optional(),
  /** Action-cost glyphs for display (e.g. "◆◆", "⟳", "◇"), when applicable. */
  actionCost: z.string().max(8).optional(),
  /** Save DC (spell: derived spellcasting DC; impulse: derived class DC). */
  dcValue: z.number().int().min(1).max(60).optional(),
  /** Save statistic the ability calls for. */
  saveType: SpellSaveTypeSchema.optional(),
  /** True when the save is a basic save. */
  basicSave: z.boolean().optional(),
  /** Primary damage formula, ALREADY resolved (spell: heightened; impulse:
   * parsed @Damage; strike/blast: derived rollable formula). */
  damageFormula: z.string().max(200).optional(),
  /** Critical damage formula (strike only) — the "Rolar dano crítico" button. */
  critDamageFormula: z.string().max(200).optional(),
  /** Damage type (e.g. "fire", "electricity"). */
  damageType: z.string().max(40).optional(),
  /** Traits (display only). */
  traits: z.array(z.string().max(40)).max(30).optional(),
});

export type AbilityCard = z.infer<typeof AbilityCardSchema>;

/**
 * Adapt a legacy {@link SpellCastCard} (persisted under `flags.pf2e.spellCast`
 * before r20-X1) to an {@link AbilityCard} of `kind:"spell"`, so old chat
 * messages keep rendering through the unified <AbilityCard> renderer without
 * any stored-data migration. A pure field remap — spells never carry a crit
 * damage formula.
 */
export function adaptSpellCastToAbilityCard(card: SpellCastCard): AbilityCard {
  return {
    kind: "spell",
    casterActorId: card.casterActorId,
    name: card.spellName,
    rank: card.rank,
    ...(card.spellNameEn !== undefined ? { nameEn: card.spellNameEn } : {}),
    ...(card.actionCost !== undefined ? { actionCost: card.actionCost } : {}),
    ...(card.dcValue !== undefined ? { dcValue: card.dcValue } : {}),
    ...(card.saveType !== undefined ? { saveType: card.saveType } : {}),
    ...(card.basicSave !== undefined ? { basicSave: card.basicSave } : {}),
    ...(card.damageFormula !== undefined ? { damageFormula: card.damageFormula } : {}),
    ...(card.damageType !== undefined ? { damageType: card.damageType } : {}),
    ...(card.traits !== undefined ? { traits: card.traits } : {}),
  };
}

/**
 * Structured, server-validated context for a check roll attached to a
 * `chat:send` (r17.1). When present with `kind:"save"`, the server computes the
 * PF2e degree of success (DoS) against `dcValue` AUTHORITATIVELY — the client
 * never compares totals to the DC; it only supplies the (already coherence-
 * checked) DC + save metadata so the server can grade the roll.
 *
 * SECURITY: the shape is Zod-validated on `chat:send`; a forged/malformed
 * checkContext rejects the send (defense in depth). The `dcValue` itself is a
 * plain number here — coherence against the caster's derived DC is enforced by
 * the SpellCastCard flag pipeline (sanitizeSpellCastCard) that emitted the card
 * this save button belongs to; the save roll simply grades the total the server
 * itself rolled.
 */
export const SaveCheckContextSchema = z.object({
  /** Discriminator — only "save" is supported today (attack/skill are future). */
  kind: z.literal("save"),
  /** DC to grade the total against. Same bounds as the card's `dcValue`. */
  dcValue: z.number().int().min(1).max(60),
  /** Which save statistic was rolled (display + audit). */
  saveType: SpellSaveTypeSchema,
  /** True when the save is a basic save (drives the per-degree damage hint). */
  basicSave: z.boolean().optional(),
});

export type SaveCheckContext = z.infer<typeof SaveCheckContextSchema>;

/**
 * Discriminated union of check contexts a `chat:send` may carry (r17.1). Only
 * `save` exists today; `kind` keeps the shape open for attack/skill checks
 * without a breaking change.
 */
export const CheckContextSchema = z.discriminatedUnion("kind", [SaveCheckContextSchema]);

export type CheckContext = z.infer<typeof CheckContextSchema>;

/**
 * Flags a client may attach to a chat:send payload (r17-P2 / r17.1 / r18-N1).
 * Whitelisted paths:
 *   - `pf2e.spellCast`    — the interactive spell-cast card (r17-P2);
 *   - `checkContext`      — structured save-check metadata the server uses to
 *     grade a roll's degree of success (r17.1);
 *   - `parentMessageId`   — the id of the chat message this roll is a CHILD of
 *     (r18-N1): a spell-cast announcement groups its attack / damage / save
 *     rolls under itself so the chat shows ONE card per conjuration instead of
 *     several loose messages. The server validates it is a plain id string and
 *     that a message with that id exists in the store; a dangling parent is
 *     DROPPED (the message is still delivered as a normal top-level roll).
 * Every other key is ignored: the server reads only these whitelisted paths, so
 * a forged/foreign flag never reaches the stored doc.
 */
export const ChatSendFlagsSchema = z.object({
  pf2e: z
    .object({
      /** Legacy spell-cast card (r17-P2). Still accepted for old clients. */
      spellCast: SpellCastCardSchema.optional(),
      /** Generalized ability card (r20-X1) — spell / impulse / strike. */
      abilityCard: AbilityCardSchema.optional(),
    })
    .optional(),
  /** Structured check context (r17.1) — grades the roll server-side. */
  checkContext: CheckContextSchema.optional(),
  /**
   * Id of the parent chat message this roll nests under (r18-N1). Bounded to a
   * plain, reasonable-length id string; existence is checked server-side (a
   * dangling parent is dropped, never a hard failure).
   */
  parentMessageId: z.string().min(1).max(120).optional(),
});

export type ChatSendFlags = z.infer<typeof ChatSendFlagsSchema>;

// ---------------------------------------------------------------------------
// ChatSpeaker — REQ-CHT-022
// ---------------------------------------------------------------------------

/**
 * Resolved identity of the effective sender.
 * REQ-CHT-022: resolved server-side from token → actor → user fallback.
 */
export const ChatSpeakerSchema = z.object({
  /** Fusion User ID (always present). */
  userId: z.string(),
  actorId: z.string().optional(),
  tokenId: z.string().optional(),
  /** Display alias in the log. */
  alias: z.string(),
});

export type ChatSpeaker = z.infer<typeof ChatSpeakerSchema>;

// ---------------------------------------------------------------------------
// MessageType — REQ-CHT-007
// ---------------------------------------------------------------------------

export const MessageTypeSchema = z.enum(["text", "roll", "emote", "whisper", "system"]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// ---------------------------------------------------------------------------
// ChatMessage Document — D-CHT-01 (spec 09)
// ---------------------------------------------------------------------------

/**
 * ChatMessage as a full Document extending BaseDocument.
 * Persisted in SQLite chat_messages table.
 * REQ-CHT-001..006.
 */
export const ChatMessageSchema = BaseDocumentSchema.extend({
  /** Discriminator — always "ChatMessage" for this type. */
  type: MessageTypeSchema,
  /** World this message belongs to. */
  worldId: z.string(),
  /** Sanitized text content (light markdown, inline roll results embedded). */
  content: z.string().max(4096),
  /** Resolved speaker. */
  speaker: ChatSpeakerSchema,
  /** Unix ms — canonical message time. */
  timestamp: z.number().int().nonnegative(),
  /**
   * Recipient User IDs.
   * Empty = public; populated by server for whisper/gmroll/selfroll.
   * REQ-CHT-004.
   */
  whisper: z.array(z.string()).default(() => []),
  /**
   * If true, roll payload is omitted from non-GM broadcast.
   * REQ-CHT-004 / D-CHT-02 / REQ-ROL-031.
   */
  blind: z.boolean().default(false),
  /**
   * Marked as void, but kept in the log at the same position (REQ-CHT-005,
   * REQ-ACH-081). Absent on every message written before invalidation existed,
   * which reads exactly the same as `false` — nothing was ever deleted.
   */
  invalid: z.boolean().optional(),
  /**
   * User ID of whoever performed the LAST invalidation. It is what decides who
   * may revalidate (REQ-ACH-083: the GM always, the author only what he himself
   * invalidated) and it SURVIVES revalidation as the record of that operation
   * (REQ-ACH-084).
   */
  invalidatedBy: z.string().optional(),
  /** Unix ms of the last invalidation — survives revalidation (REQ-ACH-084). */
  invalidatedAt: z.number().int().nonnegative().optional(),
  /**
   * Portraits of the targets this message names (REQ-ACH-072, spec 38 §7: the
   * target is written on the ChatMessage itself). An attack carries exactly one;
   * a spell with a saving throw MAY carry several (REQ-ACH-074). Absent when the
   * message names no target — and then no degree of success is shown for it
   * (REQ-ACH-071).
   *
   * Same redaction as `rolls[].target`: the `ac` of each portrait is stripped
   * from every payload delivered to a non-privileged viewer (REQ-ACH-073).
   */
  targets: z.array(RollTargetSchema).max(20).optional(),
  /** Roll results for type === 'roll'. REQ-CHT-018. */
  rolls: z.array(RollResultDataSchema).optional(),
  /** Declarative card for type === 'system'. REQ-CHT-024. */
  card: CardDataSchema.optional(),
  /** Sound asset path played with the message. */
  sound: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------------------------------------------------------------------------
// CardActionRequest — REQ-CHT-026
// ---------------------------------------------------------------------------

export const CardActionRequestSchema = z.object({
  messageId: z.string(),
  buttonId: z.string(),
  actorId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
});

export type CardActionRequest = z.infer<typeof CardActionRequestSchema>;
