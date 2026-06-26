/**
 * Canonical redaction for non-GM clients.
 *
 * Invariants (specs 04/05/07):
 *   - Hidden tokens must NEVER reach a non-GM socket — by ANY emission path.
 *   - Secret doors must appear as plain walls for non-GM clients (CA-16, REQ-VIS-005).
 *
 * There are three emission paths that carry Scene bodies to clients, and all
 * three MUST funnel non-GM Scene documents through both:
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
 */

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

/**
 * Return true when any Scene doc in the batch carries at least one hidden
 * token.  Used as a fast-path guard so callers can skip per-socket iteration
 * when there is nothing to redact.
 */
export function scenePayloadHasHiddenTokens(documents: Record<string, unknown>[]): boolean {
  for (const doc of documents) {
    if (sceneDocHasHiddenTokens(doc)) return true;
  }
  return false;
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
 * Return true when any Scene doc in the batch carries at least one secret door.
 */
export function scenePayloadHasSecretDoors(documents: Record<string, unknown>[]): boolean {
  return documents.some((d) => sceneHasSecretDoors(d));
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

  if (!documentsNeedsRedaction && !parentNeedsRedaction && !combatNeedsRedaction) {
    // Nothing to redact — return the original ack untouched.
    return result;
  }

  // Build a redacted clone, never mutating the shared original.
  const newBody: Record<string, unknown> = { ...bodyObj };

  if (documentsNeedsRedaction) {
    newBody["documents"] = (documents as Record<string, unknown>[]).map((d) => {
      let redacted = d;
      if (Array.isArray(d["tokens"])) redacted = stripHiddenTokens(redacted);
      if (Array.isArray(redacted["walls"])) redacted = redactSecretDoors(redacted);
      return redacted;
    });
  }

  if (parentNeedsRedaction) {
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
