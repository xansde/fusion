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
 *   4. redactAckResultForNonPrivileged (the ack echoed to the requester)
 *
 * This module is the single source of truth so the four paths can never
 * drift out of parity.
 *
 * A second, ownership-scoped invariant lives here too (REQ-NET-096):
 *   - An `Actor` must NEVER reach a user whose effective level on it is below
 *     LIMITED — by ANY of the four paths. See {@link canViewOwnedDocument}.
 *   - ...and the op it travelled in must reach them anyway, with `documents`
 *     empty. Suppressing the whole envelope tears a hole in the socket's `seq`
 *     stream, which the client reads as a gap it can never close. See
 *     {@link gateEnvelopeForViewer}.
 */

import { OwnershipLevel, resolveOwnership, isRolePrivileged } from "../documents/ownership.js";
import type { Envelope, Ownership } from "@fusion/shared";
import { isActorDeltaEmpty } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Ownership-gated emission (REQ-NET-024, REQ-NET-096, DEC-CNV-15)
// ---------------------------------------------------------------------------

/**
 * The slice of a socket.io `Socket` this module needs. Declared structurally so
 * the redaction rules stay free of the socket.io types (and so a test can hand
 * in a recording double instead of a real server). The real `Socket` satisfies
 * it; `data` is `unknown` because socket.io types it as `any`.
 */
export interface EmittingSocket {
  readonly data: unknown;
  emit(event: string, envelope: Envelope): void;
}

/** The slice of a socket.io `Namespace` this module needs. */
export interface EmittingNamespace {
  readonly sockets: ReadonlyMap<string, EmittingSocket>;
  emit(event: string, envelope: Envelope): void;
}

/**
 * Document types whose live broadcast / delta replay is gated by the viewer's
 * effective ownership level, mirroring what `buildSnapshot` already does.
 *
 * Only `Actor` for now, deliberately. The Actor is the document that carries
 * `system.attributes.hp` and `system.derived`, so it is the one whose leak the
 * token HP indicator would inherit: hiding the bar in the client while the
 * server still ships every actor to every socket produces a privacy feature
 * that is one devtools panel deep. `Scene` and `Combat` are shared world state
 * and are gated by content redaction (hidden tokens/tiles/combatants), not by
 * ownership — see buildSnapshot for the same split.
 *
 * The other ownership-gated types (Item, JournalEntry, Macro, RollTable,
 * Playlist, Folder) are already filtered in the join snapshot but still ride
 * the namespace-wide broadcast. Adding them here is a one-line change; it is
 * out of scope of the HP indicator and each one needs its own check for
 * collateral damage (a Playlist a player does not own still drives their audio).
 */
export const OWNERSHIP_GATED_BROADCAST_TYPES: ReadonlySet<string> = new Set(["Actor"]);

/** Minimum effective level at which an ownership-gated document may be EMITTED. */
export const MIN_EMIT_LEVEL: OwnershipLevel = OwnershipLevel.LIMITED;

/** Read a document's ownership map, defaulting to "nobody" when absent/malformed. */
function ownershipOf(doc: Record<string, unknown>): Ownership {
  const raw = doc["ownership"];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Ownership;
  }
  return { default: OwnershipLevel.NONE };
}

/**
 * May this viewer receive this document at all?
 *
 * The single predicate behind every emission path — never re-derive it inline
 * in a handler, or the paths drift and only one of them stays closed (which is
 * exactly how the Actor broadcast stayed open while the snapshot was gated).
 *
 * Privileged roles (GM / Assistant) always pass, via `resolveOwnership`'s GM
 * branch plus the explicit `isRolePrivileged` check — Assistant GM is not
 * `UserRole.GAMEMASTER` but must still see everything.
 */
export function canViewOwnedDocument(
  doc: unknown,
  userId: string | null | undefined,
  role: number,
): boolean {
  if (isRolePrivileged(role)) return true;
  if (!doc || typeof doc !== "object") return false;
  const level = resolveOwnership(ownershipOf(doc as Record<string, unknown>), userId, role);
  return level >= MIN_EMIT_LEVEL;
}

/**
 * Keep only the documents this viewer may receive.
 *
 * Returns the SAME array reference when nothing was removed, so callers can
 * detect "nothing to redact" by referential equality and reuse the shared
 * envelope instead of cloning it per socket.
 */
export function filterDocumentsForViewer(
  documents: Record<string, unknown>[],
  userId: string | null | undefined,
  role: number,
): Record<string, unknown>[] {
  if (isRolePrivileged(role)) return documents;
  const visible = documents.filter((doc) => canViewOwnedDocument(doc, userId, role));
  return visible.length === documents.length ? documents : visible;
}

/**
 * The authenticated identity behind a socket, for per-socket ownership checks.
 *
 * A socket with no auth data (should not exist past the auth middleware) reads
 * as an anonymous role-0 viewer, which `canViewOwnedDocument` rejects for every
 * ownership-gated document — fail closed, not open.
 */
export function socketViewer(socket: EmittingSocket): { userId: string | null; role: number } {
  const data = socket.data as Record<string, unknown> | null | undefined;
  const userId = data && typeof data["userId"] === "string" ? data["userId"] : null;
  const role = data && typeof data["role"] === "number" ? data["role"] : 0;
  return { userId, role };
}

/**
 * Rebuild an ownership-gated envelope for one viewer, or return the original
 * when nothing had to be removed (no allocation, shared object reused).
 *
 * The redacted form keeps the ENVELOPE and empties `documents` — it is never a
 * dropped op. `seq` is a single world-wide counter and the client's
 * `DocumentMirror` applies an op only when `seq === current + 1`, treating
 * anything higher as a gap: it discards the op and asks for a resync, which
 * replays the same window with the same op filtered out. A viewer skipped once
 * therefore stalls at that seq forever. Every other redaction here strips
 * CONTENT and keeps the envelope, which is why the problem is new with
 * ownership gating and not with hidden tokens.
 *
 * An empty envelope tells the viewer "op N happened" — which the shared counter
 * tells them regardless — and nothing about which document, whose, or what
 * changed.
 */
function gateEnvelopeForViewer(
  envelope: Envelope,
  payload: Record<string, unknown>,
  documents: Record<string, unknown>[],
  userId: string | null,
  role: number,
): Envelope {
  const visible = filterDocumentsForViewer(documents, userId, role);
  if (visible === documents) return envelope;
  return { ...envelope, payload: { ...payload, documents: visible } };
}

/**
 * Read the ownership-gated `documents` array out of an envelope, or `null` when
 * the envelope is not one this gate applies to.
 */
function ownershipGatedDocumentsOf(
  envelope: Envelope,
): { payload: Record<string, unknown>; documents: Record<string, unknown>[] } | null {
  if (envelope.type !== "doc:create" && envelope.type !== "doc:update") return null;

  const payload = envelope.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return null;

  const documentType = payload["documentType"];
  if (typeof documentType !== "string" || !OWNERSHIP_GATED_BROADCAST_TYPES.has(documentType)) {
    return null;
  }
  const documents = payload["documents"];
  if (!Array.isArray(documents)) return null;

  return { payload, documents: documents as Record<string, unknown>[] };
}

/**
 * Emit an envelope per socket when it carries ownership-gated documents,
 * emptying it for viewers who may not receive any of them.
 *
 * Returns `false` when the envelope is NOT ownership-gated, so the caller can
 * fall through to whatever emission it would otherwise have done (a Scene
 * redaction pass, or a plain namespace emit). Returns `true` once it has
 * emitted — the caller must then stop.
 *
 * Every handler that puts an Actor on the wire has to go through here or
 * through {@link emitDocumentOp}; there are more producers than `doc-handlers`
 * (the Etmos conjuração and progressão handlers each build their own Actor
 * `doc:update`), and a producer that emits namespace-wide makes REQ-NET-096
 * false for the whole world, not just for its own feature.
 */
export function emitOwnershipGatedOp(ns: EmittingNamespace, envelope: Envelope): boolean {
  const gated = ownershipGatedDocumentsOf(envelope);
  if (!gated) return false;

  for (const [, socket] of ns.sockets) {
    const { userId, role } = socketViewer(socket);
    socket.emit(
      "op",
      gateEnvelopeForViewer(envelope, gated.payload, gated.documents, userId, role),
    );
  }
  return true;
}

/**
 * Redact an ownership-gated envelope for ONE viewer — the delta-replay form of
 * {@link emitOwnershipGatedOp}. Returns the original envelope untouched when it
 * is not gated, or when this viewer may see everything in it.
 */
export function redactOpForViewer(
  envelope: Envelope,
  userId: string | null,
  role: number,
): Envelope {
  const gated = ownershipGatedDocumentsOf(envelope);
  if (!gated) return envelope;
  return gateEnvelopeForViewer(envelope, gated.payload, gated.documents, userId, role);
}

/**
 * Emit a document envelope, ownership-gated when its type demands it and
 * namespace-wide otherwise. The one-call form of {@link emitOwnershipGatedOp}
 * for producers that have no second redaction pass to fall through to.
 */
export function emitDocumentOp(ns: EmittingNamespace, envelope: Envelope): void {
  if (emitOwnershipGatedOp(ns, envelope)) return;
  ns.emit("op", envelope);
}

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
// Hidden-tile redaction (scene composed of several images)
// ---------------------------------------------------------------------------

/**
 * Strip hidden tiles from a single Scene document for non-GM players.
 *
 * A hidden tile is the GM's "not yet": the flooded lower level, the map of
 * the room past the door, the after-the-explosion version of the courtyard.
 * Sending it to the player's client and merely not drawing it would put the
 * reveal one devtools panel away, so the tile is removed from the payload
 * entirely — the same treatment, for the same reason, as a hidden token.
 *
 * Returns the original object reference when nothing was removed, so callers
 * can detect "nothing redacted" by referential equality.
 */
export function stripHiddenTiles(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTiles = scene["tiles"];
  if (!Array.isArray(rawTiles)) return scene;

  const filtered = (rawTiles as Record<string, unknown>[]).filter(
    (tile) => tile["hidden"] !== true,
  );

  if (filtered.length === rawTiles.length) return scene;
  return { ...scene, tiles: filtered };
}

// ---------------------------------------------------------------------------
// Map pins — the first PER-VIEWER redaction in a Scene (REQ-DOC-056/057/058)
// ---------------------------------------------------------------------------

/**
 * Fields a `limited` pin keeps. Everything else is stripped.
 *
 * Declared as a keep-list, not a strip-list, on purpose: a strip-list leaks by
 * omission the day someone adds a field to the note schema and forgets this
 * module. With a keep-list the new field is absent from a rumour until somebody
 * decides otherwise, which is the direction we want to fail in.
 */
const RUMOUR_KEEP_FIELDS = ["_id", "x", "y", "elevation", "iconSize", "textAnchor"] as const;

/**
 * Reduce one authored note to what a viewer at `limited` may receive.
 *
 * REQ-DOC-057: position and a generic "something is here" marker — no name, no
 * themed icon, no tooltip, no `entryId`/`pageId`, no content flags. The client
 * draws a "?" at the position; everything it would need to draw more is gone
 * from the payload, not merely unused by the renderer.
 */
function redactNoteToRumour(note: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of RUMOUR_KEEP_FIELDS) {
    if (field in note) out[field] = note[field];
  }
  // Explicit nulls rather than absent keys: the client parses notes against the
  // shared schema, and a rumour must be a valid NoteDocument, not a fragment.
  out["entryId"] = null;
  out["pageId"] = null;
  out["icon"] = null;
  out["text"] = null;
  out["textColor"] = null;
  out["global"] = false;
  out["flags"] = {};
  // The viewer's own level is all they may learn about who else sees it.
  out["ownership"] = { default: OwnershipLevel.LIMITED };
  return out;
}

/**
 * Apply per-user pin visibility to a Scene bound for one viewer.
 *
 * This is the first redaction in this module that is **per user** rather than
 * per role, and that difference is structural: hidden tokens, hidden tiles and
 * secret doors are binary (GM yes, every player no), so a single player payload
 * can be built once and shared across every player socket. Pins cannot be —
 * the same broadcast means three different things to three players. Callers on
 * the broadcast path must therefore build one payload PER SOCKET when
 * {@link scenePayloadHasNotes} says the scene carries pins.
 *
 * Returns the SAME reference when nothing changed (privileged viewer, no notes,
 * or every note already fully visible), so the "nothing to redact" fast paths
 * keep working and the shared envelope is reused.
 */
export function redactNotesForViewer(
  scene: Record<string, unknown>,
  userId: string | null | undefined,
  role: number,
): Record<string, unknown> {
  if (isRolePrivileged(role)) return scene;

  const rawNotes = scene["notes"];
  if (!Array.isArray(rawNotes) || rawNotes.length === 0) return scene;

  const notes = rawNotes as Record<string, unknown>[];
  const visible: Record<string, unknown>[] = [];
  let changed = false;

  for (const note of notes) {
    // REQ-DOC-056: `global` reads as observer for everyone.
    if (note["global"] === true) {
      visible.push(note);
      continue;
    }

    const level = resolveOwnership(ownershipOf(note), userId, role);

    if (level >= OwnershipLevel.OBSERVER) {
      visible.push(note);
      continue;
    }

    if (level === OwnershipLevel.LIMITED) {
      visible.push(redactNoteToRumour(note));
      changed = true;
      continue;
    }

    // NONE — the note does not exist for this user (REQ-DOC-057).
    changed = true;
  }

  if (!changed) return scene;
  return { ...scene, notes: visible };
}

/** Return true when a Scene-shaped doc carries at least one map pin. */
export function sceneHasNotes(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const notes = (doc as Record<string, unknown>)["notes"];
  return Array.isArray(notes) && notes.length > 0;
}

/**
 * Return true when any document in a payload carries map pins.
 *
 * The gate for the expensive path: pins force per-socket payload construction,
 * so a broadcast that carries none must never pay for it.
 */
export function scenePayloadHasNotes(documents: Record<string, unknown>[]): boolean {
  return documents.some((doc) => sceneHasNotes(doc));
}

/** Return true when a Scene-shaped doc carries at least one hidden tile. */
/**
 * Empty every token's `actorDelta` in a Scene bound for a non-privileged
 * socket — REQ-DOC-062, protecting the invariant REQ-NET-096 states.
 *
 * Why this exists at all: REQ-NET-096 keeps an `Actor` away from anyone below
 * LIMITED on it, because the Actor is what carries `system.attributes.hp`.
 * An unlinked token's hit points do NOT live on that Actor — they live in
 * `Token.actorDelta`, inside a Scene, and Scenes are shared world state that
 * every player receives. Shipping the delta as authored would hand every
 * player the current hit points of every monster on the map, which is exactly
 * the leak the Actor gate was built to close, re-opened one document over.
 *
 * The cut is by ROLE, not by ownership of the base Actor, and that is a
 * deliberate MVP simplification with a known cost: a player who owns an
 * unlinked token's Actor (a familiar the GM placed unlinked) receives no delta
 * either and reads the base Actor's numbers. Resolving it per viewer needs the
 * base Actor's ownership map, which means threading an Actor lookup through
 * all five Scene emitters; the fail-closed version ships first because the
 * failure mode of the other order is a leak, not a stale number.
 *
 * Returns the SAME reference when no token carried a delta, so the callers'
 * "nothing to redact" fast path keeps working.
 */
export function stripTokenActorDeltas(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const tokens = rawTokens as Record<string, unknown>[];
  if (!tokens.some((t) => !isActorDeltaEmpty(t["actorDelta"]))) return scene;

  return {
    ...scene,
    tokens: tokens.map((t) => (isActorDeltaEmpty(t["actorDelta"]) ? t : { ...t, actorDelta: {} })),
  };
}

/** Does this Scene-shaped document carry at least one non-empty `actorDelta`? */
export function sceneHasTokenActorDeltas(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const tokens = (doc as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokens)) return false;
  return (tokens as Record<string, unknown>[]).some((t) => !isActorDeltaEmpty(t["actorDelta"]));
}

/** Does any Scene in this broadcast payload carry a non-empty `actorDelta`? */
export function scenePayloadHasTokenActorDeltas(documents: Record<string, unknown>[]): boolean {
  return documents.some((doc) => sceneHasTokenActorDeltas(doc));
}

export function sceneHasHiddenTiles(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const tiles = (doc as Record<string, unknown>)["tiles"];
  if (!Array.isArray(tiles)) return false;
  return (tiles as Record<string, unknown>[]).some((t) => t["hidden"] === true);
}

/**
 * Return true when any Scene doc in the batch carries at least one hidden
 * tile. Fast-path guard so callers can skip per-socket iteration.
 */
export function scenePayloadHasHiddenTiles(documents: Record<string, unknown>[]): boolean {
  return documents.some((d) => sceneHasHiddenTiles(d));
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

  const documentsNeedHiddenTileRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneHasHiddenTiles(d));
  const parentNeedsHiddenTileRedaction = sceneHasHiddenTiles(parent);

  const documentsNeedActorDeltaRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneHasTokenActorDeltas(d));
  const parentNeedsActorDeltaRedaction = sceneHasTokenActorDeltas(parent);

  // M2-C: redact hidden combatants in combat payloads
  const combatNeedsRedaction = combatDocHasHiddenCombatants(combat);

  const documentsNeedsRedaction =
    documentsNeedHiddenTokenRedaction ||
    documentsNeedSecretDoorRedaction ||
    documentsNeedHiddenTileRedaction ||
    documentsNeedActorDeltaRedaction;
  const parentNeedsRedaction =
    parentNeedsHiddenTokenRedaction ||
    parentNeedsSecretDoorRedaction ||
    parentNeedsHiddenTileRedaction ||
    parentNeedsActorDeltaRedaction;

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
      if (Array.isArray(redacted["tokens"])) redacted = stripTokenActorDeltas(redacted);
      if (Array.isArray(redacted["walls"])) redacted = redactSecretDoors(redacted);
      if (Array.isArray(redacted["tiles"])) redacted = stripHiddenTiles(redacted);
      return redacted;
    });
  }

  if (parentNeedsRedaction) {
    let redactedParent = parent as Record<string, unknown>;
    if (parentNeedsHiddenTokenRedaction) redactedParent = stripHiddenTokens(redactedParent);
    if (parentNeedsActorDeltaRedaction) redactedParent = stripTokenActorDeltas(redactedParent);
    if (parentNeedsSecretDoorRedaction) redactedParent = redactSecretDoors(redactedParent);
    if (parentNeedsHiddenTileRedaction) redactedParent = stripHiddenTiles(redactedParent);
    newBody["parent"] = redactedParent;
  }

  // M2-C: strip hidden combatants from combat ack payload
  if (combatNeedsRedaction) {
    newBody["combat"] = stripHiddenCombatantsFromCombat(combat as Record<string, unknown>);
  }

  return { ...ack, result: newBody };
}

// ---------------------------------------------------------------------------
// Emission path 4 — the ack echoed to the requester (REQ-NET-096)
// ---------------------------------------------------------------------------

/**
 * Drop from an op ACK any `Actor` the requester may not receive.
 *
 * Why this exists even though it is a no-op today: every CURRENT handler that
 * puts an Actor in an ack body already required OWNER (or a privileged role)
 * on that Actor to get there — doc:create Actor is GM-only, doc:update Actor
 * demands OWNER, and the Actor-parented embedded paths (a player adding a
 * spell to their own sheet, a player creating their familiar) all check OWNER
 * on the parent before touching it. So the ack cannot leak an Actor *as the
 * code stands*. That is an argument about eight call sites, not an invariant,
 * and REQ-NET-096 asks for the invariant: the day a handler echoes back an
 * Actor it merely READ, this is what stops it.
 *
 * Unlike {@link redactAckResultForNonPrivileged}, the check is not structural.
 * An Actor and a Scene both carry an `ownership` map, and Scenes are NOT
 * ownership-gated for emission (every player receives every scene, see
 * buildSnapshot) — so guessing by shape would hide scenes from everyone. The
 * rule reads the DECLARED type instead:
 *   - `body.documentType` is an ownership-gated type → filter `body.documents`
 *   - `body.documentType === "Item"` → `body.parent` is that Item's Actor
 *     (EMBEDDED_PARENT_MAP), so the parent gets the same check.
 *
 * Returns the original object when nothing was removed (no allocation).
 */
export function redactAckOwnedDocumentsForViewer(
  result: unknown,
  userId: string | null | undefined,
  role: number,
): unknown {
  if (isRolePrivileged(role)) return result;
  if (!result || typeof result !== "object") return result;
  const ack = result as Record<string, unknown>;
  if (ack["ok"] !== true) return result;

  const body = ack["result"];
  if (!body || typeof body !== "object") return result;
  const bodyObj = body as Record<string, unknown>;

  const documentType = bodyObj["documentType"];
  if (typeof documentType !== "string") return result;

  const newBody: Record<string, unknown> = { ...bodyObj };
  let changed = false;

  const documents = bodyObj["documents"];
  if (OWNERSHIP_GATED_BROADCAST_TYPES.has(documentType) && Array.isArray(documents)) {
    const visible = filterDocumentsForViewer(documents as Record<string, unknown>[], userId, role);
    if (visible !== documents) {
      newBody["documents"] = visible;
      changed = true;
    }
  }

  // A Scene echoed back to its requester carries map pins, and those are cut
  // per user (REQ-DOC-057/058). The ack is the fourth emission path, and the
  // one easiest to forget: a player who legitimately updated a scene would
  // otherwise read every pin off their own ack.
  if (documentType === "Scene" && Array.isArray(documents)) {
    const scenes = documents as Record<string, unknown>[];
    const redacted = scenes.map((scene) => redactNotesForViewer(scene, userId, role));
    if (redacted.some((scene, i) => scene !== scenes[i])) {
      newBody["documents"] = redacted;
      changed = true;
    }
  }

  // An embedded Item's parent is always its Actor (EMBEDDED_PARENT_MAP).
  const parent = bodyObj["parent"];
  if (documentType === "Item" && parent && typeof parent === "object") {
    if (!canViewOwnedDocument(parent, userId, role)) {
      delete newBody["parent"];
      changed = true;
    }
  }

  if (!changed) return result;
  return { ...ack, result: newBody };
}
