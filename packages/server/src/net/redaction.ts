/**
 * Canonical redaction for non-GM clients.
 *
 * Invariants (specs 04/05/07/39/41/44):
 *   - Hidden tokens must NEVER reach a non-GM socket — by ANY emission path,
 *     UNLESS the viewer is in that token's `seenBy` exception list
 *     (spec 41-token.md REQ-TOK-050/051/052, DEC-TOK-08 — TK070).
 *   - Secret doors must appear as plain walls for non-GM clients (CA-16, REQ-VIS-005).
 *   - The scene LIST itself is privileged: only the scene on air may reach a
 *     non-GM socket, by ANY emission path (REQ-CEN-071, REQ-CEN-073).
 *   - A contact the viewer only GLIMPSED carries no name, title, portrait or
 *     system data, a contact that is HIDDEN is not delivered at all, and the
 *     knowledge map itself never reaches a non-privileged socket
 *     (REQ-CTT-081..084). A token inherits this for free (REQ-TOK-060/061/063,
 *     TK073): it carries no name field of its own, only the effective actor's
 *     `name` — which is simply absent from a GLIMPSED actor's payload — so
 *     "the token shows no name" is a consequence of the Actor redaction
 *     above, never a second rule written against the Token document.
 *   - The ATTITUDE of an actor towards the party never reaches a socket without
 *     a privileged role (REQ-NPC-082): learning that the smith is hostile
 *     before the scene says so is metagame.
 *   - The HIT POINTS of an actor never reach a socket that is neither
 *     privileged nor OWNER (3) of it (spec 41-token.md REQ-TOK-070/071/072,
 *     DEC-TOK-10 — TK072, `stripActorHp`), on every surface that shows vida,
 *     which today means every Actor emission (the bar a token draws reads the
 *     mirror's copy of the effective actor, so a stripped `system.attributes.hp`
 *     is what makes `TokenSprite`'s bar omit itself for a non-owner, without a
 *     token-specific rule). An UNLINKED token's own `actorDelta` is a SEPARATE
 *     cut (REQ-DOC-062, `stripTokenActorDeltaHp`/`redactTokenActorDeltaHp`):
 *     a delta's `system.attributes.hp` override travels inside the Scene
 *     document, a different emission funnel from the Actor one the cut above
 *     lives on. This second cut is fail-closed and BY ROLE, not by ownership
 *     of the base Actor — tasks.md's Fase 6 header flagged DEC-DOC-12
 *     (specs/02:292-301, a role-only cut) against DEC-TOK-10 (an
 *     ownership-only cut) as unreconciled; the resolution recorded there is
 *     "papel primeiro": REQ-DOC-062's own text already says so ("o corte é
 *     por papel, não por ownership do Actor base"), and the known cost is
 *     that even the OWNER of the base Actor (an unlinked familiar posted on
 *     the map) reads the base actor's hp, never the token's own delta —
 *     refining that is V2 work, not this cut's job.
 *   - Ocultar (`hidden`, this module, SERVER) is not the same guarantee as not
 *     estar enxergando (fog/vision, CLIENT, a future spec — REQ-TOK-053,
 *     DEC-TOK-08): a hidden token never leaves the server for a socket outside
 *     `seenBy`, so a leak here is a real information leak; a token outside a
 *     viewer's vision radius (when vision exists) still arrives on the wire
 *     and is merely not drawn — the fog protects the screen, never the
 *     network. Nothing in `docs/design/spec-41-token/` should be read as fog
 *     "protecting" a position the way this module's redaction does.
 *   - The result of a blind roll must never reach a non-privileged socket — not
 *     in `rolls[]`, not in the message text (REQ-ROL-032, REQ-ACH-092).
 *
 * There are three emission paths that carry document bodies to clients, and all
 * three MUST funnel non-GM documents through this module:
 *   - Scene → {@link redactSceneDocsForNonPrivileged}, which composes
 *       {@link sceneIsOnAir}        — drops every scene that is not on air
 *       {@link stripHiddenTokens}   — removes hidden tokens
 *       {@link redactSecretDoors}   — masks secret doors as plain walls
 *   - Actor → {@link redactActorDocsForViewer}, which composes
 *       {@link actorIsSubjectToKnowledge} — contacts only, never what you own
 *       {@link glimpsedContactView}       — the allow-listed glimpsed payload
 *       {@link stripKnowledgeMap}         — REQ-CTT-084, on EVERY actor
 *       {@link stripAttitude}             — REQ-NPC-082, on EVERY actor
 *
 * Emission paths:
 *   1. buildSnapshot      (full snapshot on join / seq-out-of-buffer resync)
 *   2. broadcastToWorld   (live per-socket emit of doc:create / doc:update)
 *   3. filterOpsForRole   (delta resync — replay of buffered ops)
 * plus the dispatcher-level ack net, {@link redactAckResultForNonPrivileged}.
 *
 * This module is the single source of truth so the three paths can never
 * drift out of parity.
 *
 * Combat bodies answer to the same discipline (REQ-CBA-082, REQ-CBT-031): a
 * combatant with `hidden: true` must not reach a non-privileged user by ANY of
 * the three paths. Two families of envelope carry a Combat:
 *   - the dedicated `combat:*` ops, redacted by the combat handlers, which call
 *     {@link stripHiddenCombatantsFromCombat} from here; and
 *   - the GENERIC document path — a `doc:update` on a Combat, and every
 *     embedded Combatant create/update/delete, which broadcast the whole parent
 *     as `{ documentType: "Combat", documents: [combat] }`. Those funnel through
 *     {@link redactCombatDocsForNonPrivileged}, the Combat counterpart of
 *     {@link redactSceneDocsForNonPrivileged}.
 * The ack echoed back to the requester is covered on top of both by
 * {@link redactAckResultForNonPrivileged}.
 *
 * The same rule also governs the INBOUND direction: an op that names a scene id
 * must not confirm that the scene exists to someone who could never have been
 * told about it. That predicate is {@link sceneIsInvisibleToRole}.
 */

import {
  KnowledgeState,
  resolveUserKnowledge,
  KNOWLEDGE_FLAG_NAMESPACE,
  KNOWLEDGE_FLAG_KEY,
  ATTITUDE_FLAG_NAMESPACE,
  ATTITUDE_FLAG_KEY,
} from "@fusion/shared";
import type { ChatMessage, Ownership, RollTarget } from "@fusion/shared";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
import {
  PLAYER_CHARACTER_SUBTYPES,
  isCharacterActor,
  isNonPlayableActor,
} from "../documents/knowledge.js";
import type { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Chat target redaction (spec 38 — DEC-ACH-09, REQ-ACH-073 / REQ-ACH-092)
// ---------------------------------------------------------------------------

/**
 * Return true when this chat message carries an AC anywhere in its target
 * portraits — either on the message itself (`targets[]`) or on the target a
 * roll was graded against (`rolls[].target`). Fast-path guard: when it is false
 * the message can be forwarded as-is, with no allocation.
 */
export function chatMessageHasTargetAc(msg: ChatMessage): boolean {
  if (msg.targets?.some((t) => t.ac !== undefined)) return true;
  return msg.rolls?.some((r) => r.target?.ac !== undefined) ?? false;
}

/** Drop the AC from one portrait, keeping the name (REQ-ACH-073). */
function targetWithoutAc(target: RollTarget): RollTarget {
  if (target.ac === undefined) return target;
  const { ac: _ac, ...rest } = target;
  return rest;
}

/**
 * The chat message a NON-PRIVILEGED viewer may receive: same message, with the
 * target's AC removed from every portrait it carries.
 *
 * REQ-ACH-073 / REQ-ACH-092 / REQ-SEC-020: the degree of success — already
 * computed on the server — goes to the player; the monster's AC is the Mestre's
 * to give or withhold. Hiding the number on screen would hide nothing: whoever
 * reads the socket reads the number.
 *
 * Returns the SAME reference when there is nothing to redact, so callers can
 * cheaply detect "unchanged", and never mutates the original (the broadcast and
 * op-buffer paths share it).
 */
export function redactChatTargetsForNonPrivileged(msg: ChatMessage): ChatMessage {
  if (!chatMessageHasTargetAc(msg)) return msg;

  const redacted: ChatMessage = { ...msg };
  if (msg.targets) {
    redacted.targets = msg.targets.map(targetWithoutAc);
  }
  if (msg.rolls) {
    redacted.rolls = msg.rolls.map((roll) =>
      roll.target === undefined ? roll : { ...roll, target: targetWithoutAc(roll.target) },
    );
  }
  return redacted;
}

/**
 * The text that stands in for a blind roll's result on a non-privileged screen
 * (REQ-ROL-032). It is the WHOLE body such a viewer gets: the total lives in
 * `content` as much as in `rolls[]`, so hiding only the dice would hide nothing.
 */
export const BLIND_ROLL_CONFIRMATION_CONTENT =
  "(Você realizou uma rolagem cega — somente o GM pode ver o resultado.)";

/**
 * The blind-roll body a NON-PRIVILEGED viewer may receive: no roll terms, and no
 * total in the text either.
 *
 * REQ-ROL-032 / REQ-ACH-092: `buildRollMessage` writes the result into
 * `content` (`"<rótulo>: <total>"`), so a redaction that only dropped `rolls`
 * would keep handing the number over — in the live broadcast, in the ack of
 * `chat:send`, in `chat:history`, in `chat:search` and in `chat:context` alike.
 * Every one of those paths funnels through here, so they cannot drift.
 *
 * The caller decides WHO is non-privileged and WHEN the message is blind; this
 * function only builds the body.
 */
export function redactBlindRollForNonPrivileged(msg: ChatMessage): ChatMessage {
  return { ...msg, rolls: undefined, content: BLIND_ROLL_CONFIRMATION_CONTENT };
}

/**
 * Structural counterpart of {@link redactChatTargetsForNonPrivileged}, used by
 * the dispatcher-level ack safety net where the body is untyped. Applies to
 * anything shaped like a chat message (a `targets` array and/or a `rolls` array
 * whose entries carry a `target`).
 */
function stripTargetAcStructural(doc: Record<string, unknown>): Record<string, unknown> {
  if (!docHasTargetAc(doc)) return doc;
  const result: Record<string, unknown> = { ...doc };

  const targets = doc["targets"];
  if (Array.isArray(targets)) {
    result["targets"] = (targets as Record<string, unknown>[]).map(stripAcKey);
  }

  const rolls = doc["rolls"];
  if (Array.isArray(rolls)) {
    result["rolls"] = (rolls as Record<string, unknown>[]).map((roll) => {
      const target = roll["target"];
      if (!target || typeof target !== "object") return roll;
      return { ...roll, target: stripAcKey(target as Record<string, unknown>) };
    });
  }

  return result;
}

function stripAcKey(target: Record<string, unknown>): Record<string, unknown> {
  if (!("ac" in target)) return target;
  const { ac: _ac, ...rest } = target;
  return rest;
}

/**
 * Keys of an ack body that carry ChatMessage(s): `chat:send`/`chat:invalidate`
 * answer with `message`; `chat:history`/`chat:search` with `messages`;
 * `chat:context` with `target` plus `before`/`after`.
 */
const CHAT_ACK_MESSAGE_KEYS = ["message", "target"] as const;
const CHAT_ACK_MESSAGE_LIST_KEYS = ["messages", "before", "after"] as const;

/**
 * Strip the target AC out of every ChatMessage an ack body carries. Returns the
 * SAME body reference when nothing needed redacting, so the caller can tell
 * "unchanged" without comparing contents.
 */
function redactChatBodies(body: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;

  for (const key of CHAT_ACK_MESSAGE_KEYS) {
    const value = body[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const redacted = stripTargetAcStructural(value as Record<string, unknown>);
    if (redacted !== value) {
      out ??= { ...body };
      out[key] = redacted;
    }
  }

  for (const key of CHAT_ACK_MESSAGE_LIST_KEYS) {
    const value = body[key];
    if (!Array.isArray(value)) continue;
    const list = value as unknown[];
    if (!list.some((entry) => docHasTargetAc(entry))) continue;
    out ??= { ...body };
    out[key] = list.map((entry) =>
      entry && typeof entry === "object"
        ? stripTargetAcStructural(entry as Record<string, unknown>)
        : entry,
    );
  }

  return out ?? body;
}

/** True when the value is an object carrying an `ac` key. */
function hasAcKey(value: unknown): boolean {
  return !!value && typeof value === "object" && "ac" in value;
}

/** Structural "does this doc carry a target AC anywhere?" guard. */
function docHasTargetAc(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const obj = doc as Record<string, unknown>;

  const targets = obj["targets"];
  if (Array.isArray(targets)) {
    for (const entry of targets as unknown[]) {
      if (hasAcKey(entry)) return true;
    }
  }

  const rolls = obj["rolls"];
  if (Array.isArray(rolls)) {
    for (const entry of rolls as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      if (hasAcKey((entry as Record<string, unknown>)["target"])) return true;
    }
  }

  return false;
}

/**
 * Strip hidden tokens from a single Scene document for non-GM players.
 *
 * Returns a shallow copy of the scene with the `tokens` array filtered to
 * exclude any token whose `hidden` field is `true` — UNLESS `userId` is in
 * that token's `seenBy` exception list (REQ-TOK-050/051/052, spec
 * 41-token.md, DEC-TOK-08). When the scene has no `tokens` array, or nothing
 * would be removed for this viewer, the original object is returned
 * unchanged (no allocation) so callers can cheaply detect "nothing redacted"
 * via referential equality.
 *
 * `userId` is optional so a caller with no per-user identity available (a
 * defensive/test-only path) still gets the historical, more conservative
 * behaviour: EVERY hidden token is stripped, `seenBy` or not. Every real
 * production caller has a userId — see the per-socket loop in
 * `broadcastToWorld`'s Scene branch (doc-handlers.ts), which mirrors the
 * Actor branch right below it (REQ-CTT-071's "per user, not per role").
 *
 * Fine-grained per-actor ownership visibility (e.g. tokens whose actor the
 * player does not own) is deferred to a later milestone; only `hidden` +
 * `seenBy` are honoured here.
 */
export function stripHiddenTokens(
  scene: Record<string, unknown>,
  userId?: string,
): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const filtered = (rawTokens as Record<string, unknown>[]).filter((token) => {
    if (token["hidden"] !== true) return true;
    if (userId === undefined) return false;
    const seenBy = token["seenBy"];
    return Array.isArray(seenBy) && (seenBy as unknown[]).includes(userId);
  });

  // Only allocate a new object when something was actually removed.
  if (filtered.length === rawTokens.length) return scene;
  return { ...scene, tokens: filtered };
}

// ---------------------------------------------------------------------------
// Secret-door redaction (M2-A, REQ-VIS-005)
// ---------------------------------------------------------------------------

/**
 * Strip secret-door information from a scene document for non-GM clients.
 *
 * Secret doors (walls with doorType:"secret") are redacted to appear as
 * plain walls to players:
 *   - doorType set to "none"
 *   - doorState set to "closed"
 *
 * This prevents players from knowing a secret passage exists.
 * Returns the original object reference when no secret doors are present
 * (zero allocation on the fast path).
 *
 * REQ-VIS-005: secret doors must not be distinguishable from plain walls
 * for non-GM users.
 */
export function redactSecretDoors(scene: Record<string, unknown>): Record<string, unknown> {
  const walls = scene["walls"];
  if (!Array.isArray(walls)) return scene;

  const hasSecret = (walls as Record<string, unknown>[]).some((w) => w["doorType"] === "secret");
  if (!hasSecret) return scene;

  const redactedWalls = (walls as Record<string, unknown>[]).map((w) => {
    if (w["doorType"] !== "secret") return w;
    return { ...w, doorType: "none", doorState: "closed" };
  });

  return { ...scene, walls: redactedWalls };
}

/**
 * Return true when a scene document contains at least one secret door.
 * Used as a fast-path guard.
 */
export function sceneHasSecretDoors(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const walls = (doc as Record<string, unknown>)["walls"];
  if (!Array.isArray(walls)) return false;
  return (walls as Record<string, unknown>[]).some((w) => w["doorType"] === "secret");
}

/**
 * Return true when a single Scene-shaped doc carries at least one hidden token.
 * A "Scene-shaped doc" is any object with a `tokens` array; non-Scene docs (no
 * `tokens` array) trivially have nothing to redact.
 */
function sceneDocHasHiddenTokens(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const tokens = (doc as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokens)) return false;
  for (const t of tokens as Record<string, unknown>[]) {
    if (t["hidden"] === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scene-list visibility (spec 44 — REQ-CEN-071 / REQ-CEN-072 / REQ-CEN-073)
// ---------------------------------------------------------------------------

/**
 * Return true when a Scene document is the one currently on air.
 *
 * The `active` field is a mirror of `settings["_meta:activeScene"]` written in
 * exactly ONE place — the `world:activeScene` handler, which reconciles every
 * scene against the setting. A client can never write it: `doc:update` refuses
 * the field outright (`rejectUnwritableField`). So reading it here is reading
 * server state, not a client-supplied claim.
 */
export function sceneIsOnAir(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  return (doc as Record<string, unknown>)["active"] === true;
}

/**
 * True when this requester must be answered as if the scene did not exist.
 *
 * REQ-CEN-070 / REQ-CEN-071: a non-privileged user may only ever act inside the
 * scene that is ON AIR (REQ-CEN-072) — it is the only one they can see, so it is
 * the only one whose id they can legitimately hold. Every inbound op that takes
 * a scene id from the client (`doc:*` on an embedded document, `token:move`,
 * `scene:doorState`) must run this BEFORE it looks at the scene body, and answer
 * with the same "scene not found" wording it would give for a made-up id.
 * Anything more specific — a token/wall-level NOT_FOUND, a PERMISSION_DENIED, or
 * an `ok:true` ack — confirms the scene exists and leaks the off-air roster
 * (REQ-CEN-073).
 *
 * `isRolePrivileged` and {@link sceneIsOnAir} are the only predicates in play:
 * exactly the pair the outbound emission paths above use.
 */
export function sceneIsInvisibleToRole(role: number, sceneDoc: unknown): boolean {
  if (isRolePrivileged(role)) return false;
  return !sceneIsOnAir(sceneDoc);
}

/**
 * The only Scene bodies a non-privileged viewer may ever receive.
 *
 * REQ-CEN-071 / REQ-CEN-073: the scene list is privileged data — the name of a
 * scene that is not on air must not appear in ANY payload destined to a
 * non-privileged user, and the refusal must be indistinguishable from the scene
 * not existing. Hence: silently dropped from the batch, never an error and
 * never a placeholder.
 * REQ-CEN-072: the scene that IS on air keeps flowing, carrying the
 * hidden-token and secret-door redactions this module already owns, so the
 * player can still render the map.
 *
 * May return an EMPTY array. Callers on a live/replay path must still emit the
 * envelope with those empty `documents` instead of skipping it: the client
 * mirror gates ops on a contiguous seq and fires its gap detector on a jump,
 * so a swallowed envelope would trigger a resync loop for every player whenever
 * the GM edits a scene that is off air.
 *
 * `userId` is threaded through to {@link stripHiddenTokens} so a token's
 * `seenBy` exception (REQ-TOK-050/051) is honoured — omit it only from a
 * caller with no per-user identity (see that function's own doc comment).
 */
export function redactSceneDocsForNonPrivileged(
  documents: Record<string, unknown>[],
  userId?: string,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const doc of documents) {
    if (!sceneIsOnAir(doc)) continue;
    result.push(redactTokenActorDeltaHp(redactSecretDoors(stripHiddenTokens(doc, userId))));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Unlinked token actorDelta hp redaction (REQ-DOC-062, REQ-TOK-072 — TK072)
// ---------------------------------------------------------------------------

/**
 * Remove `system.attributes.hp` from a single Token's OWN `actorDelta`, when
 * present (REQ-DOC-062, REQ-TOK-072).
 *
 * This is a DIFFERENT cut from {@link stripActorHp}: that one strips the base
 * Actor's own hp, gated by OWNER-or-privileged (TK072's per-viewer rule); this
 * one strips the Token's `actorDelta` override, unconditionally, for every
 * caller — the caller (this module's own {@link redactSceneDocsForNonPrivileged}
 * and the ack path below) only ever invokes it once role has already been
 * established as non-privileged, so there is no viewer-specific branch here to
 * get wrong.
 *
 * Returns the original reference when there is nothing to strip (no delta, or
 * a delta whose `system.attributes` carries no `hp`), so callers can cheaply
 * detect "unchanged".
 */
export function stripTokenActorDeltaHp(token: Record<string, unknown>): Record<string, unknown> {
  const delta = token["actorDelta"];
  if (!isPlainObject(delta)) return token;
  const system = delta["system"];
  if (!isPlainObject(system)) return token;
  const attributes = system["attributes"];
  if (!isPlainObject(attributes) || !("hp" in attributes)) return token;

  const nextAttributes: Record<string, unknown> = { ...attributes };
  Reflect.deleteProperty(nextAttributes, "hp");
  const nextSystem = { ...system, attributes: nextAttributes };
  return { ...token, actorDelta: { ...delta, system: nextSystem } };
}

/**
 * Scene-level counterpart of {@link stripTokenActorDeltaHp}: apply it to every
 * token in the scene's `tokens` array.
 *
 * Mirrors {@link stripHiddenTokens}'s shape (a Scene-in, Scene-out function
 * composed inside {@link redactSceneDocsForNonPrivileged} and the ack path) so
 * the two cuts — hidden tokens and an unlinked token's delta hp — read as
 * siblings, not as a bolt-on. Returns the original scene reference when no
 * token needed stripping (zero allocation on the fast path — most scenes have
 * no unlinked token carrying a delta hp at all).
 */
export function redactTokenActorDeltaHp(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const tokens = rawTokens as Record<string, unknown>[];
  if (!tokens.some((token) => stripTokenActorDeltaHp(token) !== token)) return scene;

  return { ...scene, tokens: tokens.map((token) => stripTokenActorDeltaHp(token)) };
}

/**
 * Return true when a scene document contains at least one token whose
 * `actorDelta.system.attributes` carries an `hp` key. Structural fast-path
 * guard for the ack path, mirroring {@link sceneDocHasHiddenTokens}.
 */
function sceneDocHasTokenActorDeltaHp(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const tokens = (doc as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokens)) return false;
  return (tokens as Record<string, unknown>[]).some((t) => {
    const delta = t["actorDelta"];
    if (!isPlainObject(delta)) return false;
    const system = delta["system"];
    if (!isPlainObject(system)) return false;
    const attributes = system["attributes"];
    return isPlainObject(attributes) && "hp" in attributes;
  });
}

/**
 * Return true when a value looks like a whole Scene document.
 *
 * Structural, like every other detector in this module: a Scene is the only
 * document that carries an `active` flag alongside a `tokens` collection
 * (Actors carry `items`, Combats carry `combatants`). Used by the ack path,
 * which sees a bare body with no `documentType` to trust.
 */
function isSceneShaped(doc: unknown): doc is Record<string, unknown> {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return typeof d["active"] === "boolean" && Array.isArray(d["tokens"]);
}

// ---------------------------------------------------------------------------
// Combat hidden-combatant redaction (M2-C, REQ-CBT-031)
// ---------------------------------------------------------------------------

/**
 * Strip hidden combatants from a CombatDocument-shaped object.
 *
 * Returns the original object unchanged when nothing needs redacting
 * (zero allocation on fast path).
 *
 * Two redactions are applied for non-GM viewers:
 *   1. Remove combatants whose `hidden === true` from the `combatants` array.
 *   2. Mask `activeCombatantId` to null when it points at a hidden combatant —
 *      otherwise a player would learn the id/existence of a hidden combatant
 *      whose turn it currently is (REQ-CBT-031, audit issue M2-C #4). The client
 *      then renders no active highlight / no turn marker, which is correct.
 *
 * REQ-CBT-031: hidden combatants are invisible to players in tracker.
 * REQ-CBT-032: GM always sees all combatants.
 */
export function stripHiddenCombatantsFromCombat(
  combat: Record<string, unknown>,
): Record<string, unknown> {
  const combatants = combat["combatants"];
  if (!Array.isArray(combatants)) return combat;

  const combatantList = combatants as Record<string, unknown>[];
  const filtered = combatantList.filter((c) => c["hidden"] !== true);

  // Determine whether the active combatant pointer must be masked.
  const activeId = combat["activeCombatantId"];
  const activeIsHidden =
    typeof activeId === "string" &&
    combatantList.some((c) => c["_id"] === activeId && c["hidden"] === true);

  const nothingRemoved = filtered.length === combatantList.length;
  if (nothingRemoved && !activeIsHidden) return combat;

  const result: Record<string, unknown> = { ...combat };
  if (!nothingRemoved) result["combatants"] = filtered;
  if (activeIsHidden) result["activeCombatantId"] = null;
  return result;
}

/**
 * The only Combat bodies a non-privileged viewer may ever receive, for a
 * `documents[]` batch travelling the GENERIC document path.
 *
 * REQ-CBA-082 / REQ-CBT-031: a `doc:update` on a Combat — and every embedded
 * Combatant create/update/delete, which republishes the whole parent Combat —
 * carries the full combatant roster. Before this, those envelopes took the
 * cheap namespace-wide emit, so a hidden combatant reached every player the
 * moment the GM touched the encounter through anything other than a `combat:*`
 * op. The dedicated handlers were redacted; the generic door beside them was
 * not, and an unlocked door beside a locked one is an unlocked door.
 *
 * Unlike scenes, the Combat document itself is NOT privileged: the encounter is
 * shared world state that every player must see (REQ-CBT-031..033). Only the
 * hidden combatants inside it are stripped, and the active pointer masked when
 * it names one — exactly what {@link stripHiddenCombatantsFromCombat} does.
 *
 * Element references are preserved when nothing needed redacting, so callers
 * can detect "nothing changed" and keep the cheap namespace-wide emit.
 */
export function redactCombatDocsForNonPrivileged(
  documents: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return documents.map((doc) => stripHiddenCombatantsFromCombat(doc));
}

/**
 * Return true if the value appears to be a CombatDocument-shaped object
 * (has a `combatants` array).
 */
function isCombatShaped(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") return false;
  return Array.isArray((obj as Record<string, unknown>)["combatants"]);
}

/**
 * Return true if the CombatDocument has at least one hidden combatant.
 */
function combatDocHasHiddenCombatants(obj: unknown): boolean {
  if (!isCombatShaped(obj)) return false;
  return (obj["combatants"] as Record<string, unknown>[]).some((c) => c["hidden"] === true);
}

// ---------------------------------------------------------------------------
// Contact knowledge redaction (spec 39 §5.9 — REQ-CTT-080..085)
// ---------------------------------------------------------------------------

/**
 * Everything the funnel needs to know about who is receiving a payload.
 *
 * `ownedCharacterIds` is the set of player-character Actors this user OWNS —
 * knowledge is a property of the CHARACTER, never of the user (DEC-CTT-03), so
 * the user's effective state is the maximum over their characters
 * (REQ-CTT-071, `resolveUserKnowledge`).
 */
export interface ContactViewer {
  userId: string;
  role: number;
  ownedCharacterIds: readonly string[];
}

/** One player character, reduced to what deciding ownership needs. */
export interface CharacterOwnershipRow {
  id: string;
  ownership: unknown;
}

/**
 * Where the funnel reads the world's player characters from.
 *
 * An interface rather than a store handle so the redaction rule stays testable
 * on its own, and so every emission path can share ONE read per broadcast
 * instead of one read per socket.
 */
export interface ContactKnowledgeSource {
  listCharacterOwnership(): readonly CharacterOwnershipRow[];
}

/** The canonical source: the world's own Actor table. */
export function contactKnowledgeSourceFromStore(store: DocumentStore): ContactKnowledgeSource {
  return {
    listCharacterOwnership(): readonly CharacterOwnershipRow[] {
      const rows: CharacterOwnershipRow[] = [];
      // One indexed read per playable subtype: which subtype is playable is the
      // system's word, not the engine's (`PLAYER_CHARACTER_SUBTYPES`), so an
      // Etmos world answers with its `orador`s exactly as a pf2e world answers
      // with its `character`s.
      for (const subtype of PLAYER_CHARACTER_SUBTYPES) {
        for (const doc of store.getAll("actors", { type: subtype })) {
          const id = doc["_id"];
          if (typeof id === "string") rows.push({ id, ownership: doc["ownership"] });
        }
      }
      return rows;
    },
  };
}

/**
 * Per-namespace registry of the knowledge source.
 *
 * `broadcastToWorld` receives a namespace and an envelope and nothing else, and
 * it is called from a dozen sites across four modules. Threading a store handle
 * through every one of them would mean a future call site could forget it and
 * silently open a hole — exactly what REQ-CTT-083 forbids. Registering the
 * source once per world namespace keeps the rule where the emission is.
 */
const contactSources = new WeakMap<object, ContactKnowledgeSource>();

/** Bind a world namespace to the Actor table its sockets read contacts from. */
export function registerContactKnowledgeSource(
  namespace: object,
  source: ContactKnowledgeSource,
): void {
  contactSources.set(namespace, source);
}

/** The source bound to a namespace, when one was registered. */
export function getContactKnowledgeSource(namespace: object): ContactKnowledgeSource | undefined {
  return contactSources.get(namespace);
}

/**
 * Resolve a viewer.
 *
 * With no source the viewer owns no character, and no character means `hidden`
 * for every contact (`resolveUserKnowledge` on an empty list, REQ-CTT-071) —
 * the conservative side: a missing source delivers nothing, it never delivers
 * more than the viewer's characters had earned.
 */
export function buildContactViewer(
  source: ContactKnowledgeSource | undefined,
  userId: string,
  role: number,
): ContactViewer {
  const ownedCharacterIds: string[] = [];
  for (const row of source?.listCharacterOwnership() ?? []) {
    const ownership = isPlainObject(row.ownership)
      ? (row.ownership as Ownership)
      : ({ default: OwnershipLevel.NONE } as Ownership);
    if (resolveOwnership(ownership, userId, role) >= OwnershipLevel.OWNER) {
      ownedCharacterIds.push(row.id);
    }
  }
  return { userId, role, ownedCharacterIds };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the knowledge filter has anything to say about this Actor.
 *
 * Two carve-outs, both of them required by the model rather than convenient:
 *
 *   1. Only a NON-PLAYABLE actor is a contact. Spec 39 splits the panel in two:
 *      "Na mesa" lists the characters (gated by `ownership`, REQ-CTT-014/020)
 *      and "Conhecidos" lists the non-players (REQ-CTT-040). The window that
 *      edits knowledge is contacts × characters — two disjoint sets. Running
 *      the filter over characters would hide the whole table from every player,
 *      since a fresh map reads `hidden`; running it over everything ELSE the
 *      manifests declare would do the same to the chest (`loot`, DEC-NPC-08)
 *      and to a companion (`familiar`, DEC-CTT-06), neither of which knowledge
 *      is about. Hence {@link isNonPlayableActor}, an allow-list, rather than
 *      the complement of "is a character".
 *   2. Nobody is a stranger to a document they OWN. A player's companion is an
 *      Actor of type "familiar" whose ownership is forced to the master's
 *      (r17-P1); knowledge must not take it away from its owner.
 *
 * Both are restrictions on the FILTER, never grants: an actor that escapes the
 * filter is still gated by `ownership` exactly as before (REQ-CTT-074).
 */
export function actorIsSubjectToKnowledge(
  doc: Record<string, unknown>,
  viewer: ContactViewer,
): boolean {
  if (!isNonPlayableActor(doc)) return false;
  return ownershipLevelFor(doc, viewer) < OwnershipLevel.OWNER;
}

function ownershipLevelFor(doc: Record<string, unknown>, viewer: ContactViewer): OwnershipLevel {
  const ownership = isPlainObject(doc["ownership"])
    ? (doc["ownership"] as Ownership)
    : ({ default: OwnershipLevel.NONE } as Ownership);
  return resolveOwnership(ownership, viewer.userId, viewer.role);
}

/**
 * Whether an Actor the knowledge filter has nothing to say about may still reach
 * this viewer (REQ-CTT-074).
 *
 * The knowledge filter is a restriction, never a grant, so escaping it cannot be
 * what makes a document visible. Two populations escape it:
 *
 *   - a player CHARACTER, which every player is meant to see: "Na mesa" lists the
 *     whole table, the viewer's own first (REQ-CTT-014, REQ-CTT-020);
 *   - everything the manifests declare that is neither playable nor a contact —
 *     the chest (`loot`, DEC-NPC-08), a companion (`familiar`, DEC-CTT-06), and
 *     whatever a future system adds. Those answer to `ownership` and to nothing
 *     else, at the same LIMITED threshold the join snapshot uses (REQ-NET-024),
 *     so the live broadcast and the replay cannot hand over a chest the snapshot
 *     would have withheld.
 */
function actorEscapingKnowledgeIsVisible(
  doc: Record<string, unknown>,
  viewer: ContactViewer,
): boolean {
  if (isCharacterActor(doc)) return true;
  return ownershipLevelFor(doc, viewer) >= OwnershipLevel.LIMITED;
}

/**
 * Remove the knowledge map from a document (REQ-CTT-084).
 *
 * The map says which characters know this contact and which merely glimpsed it
 * — i.e. what the OTHER players' characters have learned. It is privileged
 * data, and it rides on the very document a player is allowed to see, so it has
 * to come off every Actor a non-privileged socket receives, not only off the
 * contacts. Returns the original reference when there is nothing to strip.
 */
export function stripKnowledgeMap(doc: Record<string, unknown>): Record<string, unknown> {
  const flags = doc["flags"];
  if (!isPlainObject(flags)) return doc;
  const namespace = flags[KNOWLEDGE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return doc;
  if (!(KNOWLEDGE_FLAG_KEY in namespace)) return doc;

  const nextNamespace: Record<string, unknown> = { ...namespace };
  Reflect.deleteProperty(nextNamespace, KNOWLEDGE_FLAG_KEY);
  return { ...doc, flags: { ...flags, [KNOWLEDGE_FLAG_NAMESPACE]: nextNamespace } };
}

/**
 * Remove the attitude from a document (spec 42 §5.10 — REQ-NPC-082).
 *
 * The attitude says whether this actor is `enemy`, `neutral` or `ally` towards
 * the party (REQ-NPC-037). It is the GM's note about a stance the fiction has
 * not revealed yet, and it rides on the very Actor document a player is allowed
 * to see — so it comes off EVERY Actor a non-privileged socket receives, not
 * only off the contacts: a player who owns a companion, or reaches a chest
 * through `ownership`, travels the same emission paths.
 *
 * Returns the original reference when there is nothing to strip, so callers can
 * cheaply detect "unchanged".
 */
export function stripAttitude(doc: Record<string, unknown>): Record<string, unknown> {
  const flags = doc["flags"];
  if (!isPlainObject(flags)) return doc;
  const namespace = flags[ATTITUDE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return doc;
  if (!(ATTITUDE_FLAG_KEY in namespace)) return doc;

  const nextNamespace: Record<string, unknown> = { ...namespace };
  Reflect.deleteProperty(nextNamespace, ATTITUDE_FLAG_KEY);
  return { ...doc, flags: { ...flags, [ATTITUDE_FLAG_NAMESPACE]: nextNamespace } };
}

/**
 * Remove `system.attributes.hp` from a document (spec 41-token.md
 * REQ-TOK-070..072, DEC-TOK-10 — "vida é do dono").
 *
 * `system.attributes.hp` is the canonical path every engine-2e-based system
 * (pf2e, sf2e — `systems/pf2e/src/derivations/build.ts`,
 * `systems/pf2e/src/derivations/character.ts`) writes and reads hit points
 * through; this is the field REQ-TOK-070 means by "pontos de vida". Returns
 * the original reference when there is nothing to strip, so callers can
 * cheaply detect "unchanged".
 */
export function stripActorHp(doc: Record<string, unknown>): Record<string, unknown> {
  const system = doc["system"];
  if (!isPlainObject(system)) return doc;
  const attributes = system["attributes"];
  if (!isPlainObject(attributes) || !("hp" in attributes)) return doc;

  const nextAttributes: Record<string, unknown> = { ...attributes };
  Reflect.deleteProperty(nextAttributes, "hp");
  return { ...doc, system: { ...system, attributes: nextAttributes } };
}

/**
 * Whether `viewer` may see `doc`'s hit points (REQ-TOK-070/071, DEC-TOK-10).
 *
 * OWNER (3) of the Actor, or a privileged role — the SAME cut on EVERY
 * surface that shows vida (REQ-TOK-071: "não deve existir régua diferente
 * por tela"), because this predicate is the only place that decides it.
 * `ownershipLevelFor` reads the document's OWN `ownership` map — the same
 * one every other per-viewer Actor rule in this module reads — so an
 * unlinked token's `actorDelta` never enters the decision (REQ-TOK-072: the
 * cut is read from the base `Actor`, never from what the token/delta says).
 */
function viewerOwnsActorHp(doc: Record<string, unknown>, viewer: ContactViewer): boolean {
  if (isRolePrivileged(viewer.role)) return true;
  return ownershipLevelFor(doc, viewer) >= OwnershipLevel.OWNER;
}

/**
 * Everything an Actor document loses on its way to a NON-PRIVILEGED socket,
 * whatever the emission path and whatever the viewer's knowledge of it:
 * the knowledge map (REQ-CTT-084), the attitude (REQ-NPC-082) and — when
 * `viewer` is supplied and is not OWNER — the hit points (REQ-TOK-070..072).
 *
 * One function rather than several calls at each site, so a future privileged
 * field is added in ONE place and cannot reach a path someone forgot to
 * update. Returns the original reference when nothing was stripped.
 *
 * `viewer` is optional so the knowledge-map/attitude behaviour stays callable
 * without one (a handful of call sites in this module echo an ack whose
 * writer's identity the caller does not thread through — see
 * `redactAckResultForNonPrivileged`'s embedded-Item branch, where writing to
 * the parent Actor already required OWNER, so there is no viewer who could
 * fail the hp check on that path in the first place). Every real production
 * caller has a viewer — see `redactActorDocsForViewer` below, the single
 * funnel REQ-NET-096's four emission paths share.
 */
export function stripPrivilegedActorFields(
  doc: Record<string, unknown>,
  viewer?: ContactViewer,
): Record<string, unknown> {
  const stripped = stripAttitude(stripKnowledgeMap(doc));
  if (!viewer || viewerOwnsActorHp(stripped, viewer)) return stripped;
  return stripActorHp(stripped);
}

/**
 * The payload of a contact the viewer has only GLIMPSED (REQ-CTT-081).
 *
 * An ALLOW-list, deliberately: a deny-list would leak every field a future
 * milestone adds to Actor, and "no name, no title, no system data — but the
 * PORTRAIT does travel" is a promise about the whole document, not about four
 * keys. What survives:
 *   - `_id`    — the client mirror is keyed by it, and it is already the key
 *                the GM's ops travel under;
 *   - `type`   — "an unidentified someone", not who;
 *   - `_stats` — the mirror gates upserts on `_stats.version`; without it the
 *                document would look permanently stale and never settle;
 *   - `img`    — spec 39 DEC-CTT-04 §"Consequência dura", AMENDED by spec
 *                41-token.md DEC-TOK-09/§12 (2026-08-17, TK003): "o retrato
 *                (AssetRef) não é redigido: ele sempre viaja no payload do
 *                contato, porque uma peça no mapa precisa da arte para ser
 *                desenhada." Before this the token of a glimpsed NPC had no
 *                art to draw at all — REQ-TOK-010/011/060 and CA-TOK-008
 *                ("recebe o token e a arte dele, e não recebe o nome")
 *                require exactly the split this view now makes: identity
 *                redacted, appearance not. The silhouette a contact CARD
 *                shows instead of the portrait is that screen's own
 *                presentation choice, never a second server-side redaction.
 * `ownership` is dropped on purpose: a glimpsed contact offers no sheet
 * (REQ-CTT-042), and an absent map resolves to NONE on the client too.
 *
 * REQ-CTT-013 falls out of this and is not separate code: a contact with no
 * name in the payload cannot be found by name in the client's search.
 */
export function glimpsedContactView(doc: Record<string, unknown>): Record<string, unknown> {
  const view: Record<string, unknown> = { _id: doc["_id"] };
  if (typeof doc["type"] === "string") view["type"] = doc["type"];
  if (isPlainObject(doc["_stats"])) view["_stats"] = doc["_stats"];
  // TK003 (spec 41-token.md DEC-TOK-09/§12): the portrait is not redacted —
  // only `undefined`/absent stays absent, `null` (explicitly "no art") still
  // travels as `null` rather than being dropped, so the client cannot
  // mistake "the field was never sent" for "this actor has no art".
  if ("img" in doc) view["img"] = doc["img"];
  // An explicit marker so the panel can draw "não identificado" without having
  // to infer it from an absence (REQ-CTT-041).
  view["flags"] = { [KNOWLEDGE_FLAG_NAMESPACE]: { glimpsed: true } };
  return view;
}

/**
 * What a non-privileged viewer is owed for a batch of Actor documents.
 *
 * Two halves, because dropping a document is only half of the delta:
 *   - `documents` — the bodies that may be delivered;
 *   - `removedIds` — the ids that were dropped BY THE KNOWLEDGE RULE for this
 *     viewer, i.e. what the viewer must now forget.
 *
 * REQ-CTT-075 is why `removedIds` exists at all: lowering a contact to `hidden`
 * has to reach the affected user as a removal "sem depender de recarregar a
 * página". The client mirror is an upsert store — a document simply missing
 * from a `doc:update` batch leaves the previous copy on screen forever, so
 * "absent" (REQ-CTT-082) has to travel as an explicit id, on the very same
 * envelope, or the redaction only holds until the next reload.
 */
export interface RedactedActorBatch {
  documents: Record<string, unknown>[];
  removedIds: string[];
}

/**
 * The only Actor bodies a non-privileged viewer may ever receive.
 *
 * REQ-CTT-082: a contact whose effective state is `hidden` is dropped from the
 * batch — not blanked, not flagged: absent, in snapshot, broadcast and replay
 * alike.
 * REQ-CTT-081: a contact that was `glimpsed` is reduced to
 * {@link glimpsedContactView}.
 * REQ-CTT-084: every surviving Actor loses its knowledge map.
 * REQ-NPC-082: every surviving Actor loses its attitude.
 * REQ-CTT-074: an Actor the knowledge filter says nothing about — a character, a
 *              chest, a companion — is gated by `ownership` alone, so escaping
 *              the filter never turns into a grant.
 * REQ-CTT-075: every id dropped by the rule above comes back in `removedIds`,
 * so a live/replay caller can carry the removal in the same envelope.
 *
 * `documents` may be EMPTY. Callers on a live/replay path must still emit the
 * envelope with those empty `documents`: the client mirror gates ops on a
 * contiguous seq and fires its gap detector on a jump, so a swallowed envelope
 * would put the player into a resync loop.
 */
export function redactActorDocsForViewer(
  documents: readonly Record<string, unknown>[],
  viewer: ContactViewer,
): RedactedActorBatch {
  const result: Record<string, unknown>[] = [];
  const removedIds: string[] = [];
  for (const doc of documents) {
    if (!actorIsSubjectToKnowledge(doc, viewer)) {
      // REQ-CTT-074: escaping the knowledge filter is not a grant. What escapes
      // it answers to `ownership`, at the snapshot's own threshold.
      if (!actorEscapingKnowledgeIsVisible(doc, viewer)) {
        const id = doc["_id"];
        if (typeof id === "string") removedIds.push(id);
        continue;
      }
      result.push(stripPrivilegedActorFields(doc, viewer));
      continue;
    }
    const state = resolveUserKnowledge(doc, viewer.ownedCharacterIds);
    if (state === KnowledgeState.Hidden) {
      const id = doc["_id"];
      if (typeof id === "string") removedIds.push(id);
      continue;
    }
    if (state === KnowledgeState.Glimpsed) {
      result.push(glimpsedContactView(doc));
      continue;
    }
    result.push(stripPrivilegedActorFields(doc, viewer));
  }
  return { documents: result, removedIds };
}

// ---------------------------------------------------------------------------

/**
 * Redact sensitive data from an op ACK *result* destined for a non-privileged
 * (role < ASSISTANT) socket.  This is the dispatcher-level safety net: it is
 * applied centrally in socket-manager.ts so EVERY handler — present or future —
 * that echoes a Scene body back to the requester is covered, without each
 * handler having to remember to redact its own ack.
 *
 * Applies two redactions to Scene-shaped documents:
 *   1. {@link stripHiddenTokens} — remove hidden tokens (M1-C)
 *   2. {@link redactSecretDoors} — mask secret doors as plain walls (M2-A)
 *
 * Additionally applies combat redaction:
 *   3. {@link stripHiddenCombatantsFromCombat} — remove hidden combatants (M2-C)
 *
 * …and the scene-list rule of spec 44:
 *   4. {@link sceneIsOnAir} — a Scene body that is not on air is dropped from
 *      `documents[]` and `parent` (REQ-CEN-072 / REQ-CEN-073)
 *
 * Covered ack `result` shapes (the object under `ack.result`):
 *
 *   1. Primary Scene doc:create / doc:update
 *        { documentType: "Scene", documents: FullScene[] }
 *   2. Embedded embedded create: { documentType, documents, parent: FullScene }
 *   3. Embedded embedded update: { documentType: "Scene", documents: FullScene[] }
 *   4. Embedded embedded delete: { documentType, ids, parent: FullScene }
 *   5. Combat create/update ack: { combat: CombatDocument }
 *   6. Generic doc path on a Combat (REQ-CBA-082)
 *        { documentType: "Combat", documents: FullCombat[] }
 *        { documentType: "Combatant", ids, parent: FullCombat }
 *
 * The detector is STRUCTURAL: walks `documents[]`, `parent`, and `combat`
 * and applies redactions to any element that is Scene-shaped (has `tokens` or
 * `walls` array) or Combat-shaped (has `combatants` array).
 *
 * Cloning discipline: never mutates in place — returns fresh clones only when
 * something actually needs redacting.
 *
 * `contactCtx` carries the viewer for the contact-knowledge rule (spec 39). It
 * is optional so the pure Scene/Combat behaviour stays testable on its own;
 * when it is absent the Actor branch degrades to stripping the knowledge map
 * (REQ-CTT-084), which needs no viewer.
 */
export interface AckContactContext {
  source?: ContactKnowledgeSource | undefined;
  userId: string;
  role: number;
}

export function redactAckResultForNonPrivileged(
  result: unknown,
  contactCtx?: AckContactContext,
): unknown {
  if (!result || typeof result !== "object") return result;
  const ack = result as Record<string, unknown>;

  // Only success acks carry a `result` body; error acks have no document payload.
  if (ack["ok"] !== true) return result;

  const body = ack["result"];
  if (!body || typeof body !== "object") return result;
  const bodyObj = body as Record<string, unknown>;

  // Chat acks (chat:send, chat:invalidate, chat:history, chat:search,
  // chat:context) carry ChatMessages under their own keys. The target's AC must
  // not ride out on ANY of them (REQ-ACH-073 / REQ-ACH-092) — the chat handler
  // already redacts each message it emits, and this is the dispatcher-level net
  // that covers a handler which forgets to.
  const chatRedactedBody = redactChatBodies(bodyObj);

  const documents = chatRedactedBody["documents"];
  const parent = chatRedactedBody["parent"];
  const combat = chatRedactedBody["combat"];

  // REQ-CEN-073: an off-air Scene body must not come back in the ack either —
  // the ack is a payload destined to a non-privileged user like any other. The
  // handlers already refuse the ops that could produce one (a scene that is not
  // on air answers as if it did not exist), so this is the dispatcher-level net
  // that covers any handler, present or future, that echoes a Scene it loaded.
  //
  // REQ-CEN-072: the scene ON AIR is exactly what survives — it is the body the
  // player's canvas renders.
  const documentsCarryOffAirScene =
    Array.isArray(documents) &&
    (documents as unknown[]).some((d) => isSceneShaped(d) && !sceneIsOnAir(d));
  const parentIsOffAirScene = isSceneShaped(parent) && !sceneIsOnAir(parent);

  // Spec 39 §5.9: an ack echoes documents straight back to the requester, so it
  // is an emission path like any other and answers to the same funnel
  // (REQ-CTT-081..084). Handled before the Scene/Combat branches because the
  // Actor batch may vanish entirely, and the viewer is resolved lazily so an
  // ordinary Scene ack never touches the Actor table.
  if (bodyObj["documentType"] === "Actor" && Array.isArray(documents)) {
    const viewer = contactCtx
      ? buildContactViewer(contactCtx.source, contactCtx.userId, contactCtx.role)
      : { userId: "", role: 0, ownedCharacterIds: [] as readonly string[] };
    // The ack goes back to the WRITER, who is looking at a result rather than
    // at a mirror, so only the bodies matter here — `removedIds` is a delta
    // concept and belongs to the broadcast/replay paths (REQ-CTT-075).
    const redactedActors = contactCtx
      ? redactActorDocsForViewer(documents as Record<string, unknown>[], viewer).documents
      : (documents as Record<string, unknown>[]).map((d) => stripPrivilegedActorFields(d));
    const changed =
      redactedActors.length !== documents.length ||
      redactedActors.some((doc, i) => doc !== documents[i]);
    // The early return has to carry whatever the chat pass already removed, or an
    // Actor-shaped ack body that also held messages would leave here unredacted.
    if (changed || chatRedactedBody !== bodyObj) {
      return {
        ...ack,
        result: { ...chatRedactedBody, documents: changed ? redactedActors : documents },
      };
    }
    return result;
  }

  // An embedded ack (Item under Actor) carries the parent Actor whole — the
  // knowledge map (REQ-CTT-084) and the attitude (REQ-NPC-082) have to come off
  // it too. The parent can never be a contact the viewer merely glimpsed:
  // writing an embedded document requires OWNER, and OWNER escapes the
  // knowledge filter by construction.
  if (isPlainObject(parent)) {
    const strippedParent = stripPrivilegedActorFields(parent);
    if (strippedParent !== parent) {
      return redactAckResultForNonPrivileged(
        { ...ack, result: { ...bodyObj, parent: strippedParent } },
        contactCtx,
      );
    }
  }

  const documentsNeedHiddenTokenRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneDocHasHiddenTokens(d));
  const parentNeedsHiddenTokenRedaction = sceneDocHasHiddenTokens(parent);

  // REQ-DOC-062: an unlinked token's own actorDelta hp rides the ack echo
  // exactly like the other Scene-shaped cuts above — same structural
  // detector-then-strip shape as the hidden-token pair right above it.
  const documentsNeedTokenDeltaHpRedaction =
    Array.isArray(documents) &&
    (documents as unknown[]).some((d) => sceneDocHasTokenActorDeltaHp(d));
  const parentNeedsTokenDeltaHpRedaction = sceneDocHasTokenActorDeltaHp(parent);

  const documentsNeedSecretDoorRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneHasSecretDoors(d));
  const parentNeedsSecretDoorRedaction = sceneHasSecretDoors(parent);

  // M2-C: redact hidden combatants in combat payloads
  const combatNeedsRedaction = combatDocHasHiddenCombatants(combat);

  // REQ-CBA-082: a Combat body also travels the GENERIC document path, where it
  // lands in `documents[]` (doc:update on a Combat, embedded Combatant update)
  // or in `parent` (embedded Combatant create/delete) instead of under `combat`.
  // The detector is structural precisely so those shapes are covered too.
  const documentsNeedCombatRedaction =
    Array.isArray(documents) &&
    (documents as unknown[]).some((d) => combatDocHasHiddenCombatants(d));
  const parentNeedsCombatRedaction = combatDocHasHiddenCombatants(parent);

  const documentsNeedsRedaction =
    documentsNeedHiddenTokenRedaction ||
    documentsNeedTokenDeltaHpRedaction ||
    documentsNeedSecretDoorRedaction ||
    documentsNeedCombatRedaction;
  const parentNeedsRedaction =
    parentNeedsHiddenTokenRedaction ||
    parentNeedsTokenDeltaHpRedaction ||
    parentNeedsSecretDoorRedaction ||
    parentNeedsCombatRedaction;

  if (
    !documentsNeedsRedaction &&
    !parentNeedsRedaction &&
    !combatNeedsRedaction &&
    !documentsCarryOffAirScene &&
    !parentIsOffAirScene &&
    chatRedactedBody === bodyObj
  ) {
    // Nothing to redact — return the original ack untouched.
    return result;
  }

  // Build a redacted clone, never mutating the shared original.
  const newBody: Record<string, unknown> = { ...chatRedactedBody };

  if (documentsNeedsRedaction || documentsCarryOffAirScene) {
    newBody["documents"] = (documents as Record<string, unknown>[])
      .filter((d) => !isSceneShaped(d) || sceneIsOnAir(d))
      .map((d) => {
        let redacted = d;
        if (Array.isArray(d["tokens"])) {
          redacted = redactTokenActorDeltaHp(stripHiddenTokens(redacted, contactCtx?.userId));
        }
        if (Array.isArray(redacted["walls"])) redacted = redactSecretDoors(redacted);
        if (Array.isArray(redacted["combatants"])) {
          redacted = stripHiddenCombatantsFromCombat(redacted);
        }
        return redacted;
      });
  }

  if (parentIsOffAirScene) {
    // Dropped outright, not blanked: the shape a caller sees for a scene it may
    // not know about is the shape of "there is nothing here".
    newBody["parent"] = null;
  } else if (parentNeedsRedaction) {
    let redactedParent = parent as Record<string, unknown>;
    if (parentNeedsHiddenTokenRedaction) {
      redactedParent = stripHiddenTokens(redactedParent, contactCtx?.userId);
    }
    if (parentNeedsTokenDeltaHpRedaction) {
      redactedParent = redactTokenActorDeltaHp(redactedParent);
    }
    if (parentNeedsSecretDoorRedaction) redactedParent = redactSecretDoors(redactedParent);
    if (parentNeedsCombatRedaction) {
      redactedParent = stripHiddenCombatantsFromCombat(redactedParent);
    }
    newBody["parent"] = redactedParent;
  }

  // M2-C: strip hidden combatants from combat ack payload
  if (combatNeedsRedaction) {
    newBody["combat"] = stripHiddenCombatantsFromCombat(combat as Record<string, unknown>);
  }

  return { ...ack, result: newBody };
}
