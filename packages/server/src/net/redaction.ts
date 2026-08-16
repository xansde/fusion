/**
 * Canonical redaction for non-GM clients.
 *
 * Invariants (specs 04/05/07/39/44):
 *   - Hidden tokens must NEVER reach a non-GM socket — by ANY emission path.
 *   - Secret doors must appear as plain walls for non-GM clients (CA-16, REQ-VIS-005).
 *   - The scene LIST itself is privileged: only the scene on air may reach a
 *     non-GM socket, by ANY emission path (REQ-CEN-071, REQ-CEN-073).
 *   - A contact the viewer only GLIMPSED carries no name, title, portrait or
 *     system data, a contact that is HIDDEN is not delivered at all, and the
 *     knowledge map itself never reaches a non-privileged socket
 *     (REQ-CTT-081..084).
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
 *
 * Emission paths:
 *   1. buildSnapshot      (full snapshot on join / seq-out-of-buffer resync)
 *   2. broadcastToWorld   (live per-socket emit of doc:create / doc:update)
 *   3. filterOpsForRole   (delta resync — replay of buffered ops)
 * plus the dispatcher-level ack net, {@link redactAckResultForNonPrivileged}.
 *
 * This module is the single source of truth so the paths can never drift out
 * of parity.
 */

import {
  KnowledgeState,
  resolveUserKnowledge,
  KNOWLEDGE_FLAG_NAMESPACE,
  KNOWLEDGE_FLAG_KEY,
} from "@fusion/shared";
import type { Ownership } from "@fusion/shared";
import { OwnershipLevel, resolveOwnership } from "../documents/ownership.js";
import {
  PLAYER_CHARACTER_SUBTYPES,
  isCharacterActor,
  isNonPlayableActor,
} from "../documents/knowledge.js";
import type { DocumentStore } from "../documents/store.js";

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
 * The payload of a contact the viewer has only GLIMPSED (REQ-CTT-081).
 *
 * An ALLOW-list, deliberately: a deny-list would leak every field a future
 * milestone adds to Actor, and "no name, no title, no portrait, no system data"
 * is a promise about the whole document, not about four keys. What survives
 * identifies nothing:
 *   - `_id`    — the client mirror is keyed by it, and it is already the key
 *                the GM's ops travel under;
 *   - `type`   — "an unidentified someone", not who;
 *   - `_stats` — the mirror gates upserts on `_stats.version`; without it the
 *                document would look permanently stale and never settle.
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
      result.push(stripKnowledgeMap(doc));
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
    result.push(stripKnowledgeMap(doc));
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

  const documents = bodyObj["documents"];
  const parent = bodyObj["parent"];
  const combat = bodyObj["combat"];

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
      : (documents as Record<string, unknown>[]).map((d) => stripKnowledgeMap(d));
    const changed =
      redactedActors.length !== documents.length ||
      redactedActors.some((doc, i) => doc !== documents[i]);
    if (changed) {
      return { ...ack, result: { ...bodyObj, documents: redactedActors } };
    }
    return result;
  }

  // An embedded ack (Item under Actor) carries the parent Actor whole — the
  // knowledge map has to come off it too (REQ-CTT-084). The parent can never be
  // a contact the viewer merely glimpsed: writing an embedded document requires
  // OWNER, and OWNER escapes the knowledge filter by construction.
  if (isPlainObject(parent)) {
    const strippedParent = stripKnowledgeMap(parent);
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
