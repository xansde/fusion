/**
 * Canonical redaction for non-GM clients.
 *
 * Invariants (specs 04/05/07/44):
 *   - Hidden tokens must NEVER reach a non-GM socket — by ANY emission path.
 *   - Secret doors must appear as plain walls for non-GM clients (CA-16, REQ-VIS-005).
 *   - The scene LIST itself is privileged: only the scene on air may reach a
 *     non-GM socket, by ANY emission path (REQ-CEN-071, REQ-CEN-073).
 *
 * There are three emission paths that carry Scene bodies to clients, and all
 * three MUST funnel non-GM Scene documents through
 *   {@link redactSceneDocsForNonPrivileged}
 * which composes the whole rule:
 *   {@link sceneIsOnAir}        — drops every scene that is not on air
 *   {@link stripHiddenTokens}   — removes hidden tokens
 *   {@link redactSecretDoors}   — masks secret doors as plain walls
 *
 * Emission paths:
 *   1. buildSnapshot      (full snapshot on join / seq-out-of-buffer resync)
 *   2. broadcastToWorld   (live per-socket emit of doc:create / doc:update)
 *   3. filterOpsForRole   (delta resync — replay of buffered ops)
 *
 * This module is the single source of truth so the three paths can never
 * drift out of parity.
 *
 * The same rule also governs the INBOUND direction: an op that names a scene id
 * must not confirm that the scene exists to someone who could never have been
 * told about it. That predicate is {@link sceneIsInvisibleToRole}.
 */

import { isRolePrivileged } from "../documents/ownership.js";

/**
 * Strip hidden tokens from a single Scene document for non-GM players.
 *
 * Returns a shallow copy of the scene with the `tokens` array filtered to
 * exclude any token whose `hidden` field is `true`.  When the scene has no
 * `tokens` array, or no token is hidden, the original object is returned
 * unchanged (no allocation) so callers can cheaply detect "nothing redacted"
 * via referential equality.
 *
 * Fine-grained per-actor ownership visibility (e.g. tokens whose actor the
 * player does not own) is deferred to a later milestone; only the `hidden`
 * flag is honoured here.
 */
export function stripHiddenTokens(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const filtered = (rawTokens as Record<string, unknown>[]).filter(
    (token) => token["hidden"] !== true,
  );

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
 */
export function redactSceneDocsForNonPrivileged(
  documents: Record<string, unknown>[],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const doc of documents) {
    if (!sceneIsOnAir(doc)) continue;
    result.push(redactSecretDoors(stripHiddenTokens(doc)));
  }
  return result;
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
 *
 * The detector is STRUCTURAL: walks `documents[]`, `parent`, and `combat`
 * and applies redactions to any element that is Scene-shaped (has `tokens` or
 * `walls` array) or Combat-shaped (has `combatants` array).
 *
 * Cloning discipline: never mutates in place — returns fresh clones only when
 * something actually needs redacting.
 */
export function redactAckResultForNonPrivileged(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const ack = result as Record<string, unknown>;

  // Only success acks carry a `result` body; error acks have no document payload.
  if (ack["ok"] !== true) return result;

  const body = ack["result"];
  if (!body || typeof body !== "object") return result;
  const bodyObj = body as Record<string, unknown>;

  const documents = bodyObj["documents"];
  const parent = bodyObj["parent"];
  const combat = bodyObj["combat"];

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

  const documentsNeedHiddenTokenRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneDocHasHiddenTokens(d));
  const parentNeedsHiddenTokenRedaction = sceneDocHasHiddenTokens(parent);

  const documentsNeedSecretDoorRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneHasSecretDoors(d));
  const parentNeedsSecretDoorRedaction = sceneHasSecretDoors(parent);

  // M2-C: redact hidden combatants in combat payloads
  const combatNeedsRedaction = combatDocHasHiddenCombatants(combat);

  const documentsNeedsRedaction =
    documentsNeedHiddenTokenRedaction || documentsNeedSecretDoorRedaction;
  const parentNeedsRedaction = parentNeedsHiddenTokenRedaction || parentNeedsSecretDoorRedaction;

  if (
    !documentsNeedsRedaction &&
    !parentNeedsRedaction &&
    !combatNeedsRedaction &&
    !documentsCarryOffAirScene &&
    !parentIsOffAirScene
  ) {
    // Nothing to redact — return the original ack untouched.
    return result;
  }

  // Build a redacted clone, never mutating the shared original.
  const newBody: Record<string, unknown> = { ...bodyObj };

  if (documentsNeedsRedaction || documentsCarryOffAirScene) {
    newBody["documents"] = (documents as Record<string, unknown>[])
      .filter((d) => !isSceneShaped(d) || sceneIsOnAir(d))
      .map((d) => {
        let redacted = d;
        if (Array.isArray(d["tokens"])) redacted = stripHiddenTokens(redacted);
        if (Array.isArray(redacted["walls"])) redacted = redactSecretDoors(redacted);
        return redacted;
      });
  }

  if (parentIsOffAirScene) {
    // Dropped outright, not blanked: the shape a caller sees for a scene it may
    // not know about is the shape of "there is nothing here".
    newBody["parent"] = null;
  } else if (parentNeedsRedaction) {
    let redactedParent = parent as Record<string, unknown>;
    if (parentNeedsHiddenTokenRedaction) redactedParent = stripHiddenTokens(redactedParent);
    if (parentNeedsSecretDoorRedaction) redactedParent = redactSecretDoors(redactedParent);
    newBody["parent"] = redactedParent;
  }

  // M2-C: strip hidden combatants from combat ack payload
  if (combatNeedsRedaction) {
    newBody["combat"] = stripHiddenCombatantsFromCombat(combat as Record<string, unknown>);
  }

  return { ...ack, result: newBody };
}
