/**
 * DocumentMirror — reactive client-side mirror of all world documents.
 *
 * REQ-NET-062..063: maintains local seq, detects gaps, triggers resync.
 * REQ-NET-064 / REQ-ARQ-014: boot buffer — ops that arrive between the
 *   snapshot request and its application are queued and applied after
 *   the snapshot is installed (classic "loading window" protection).
 *
 * Responsibilities:
 *   - Apply a WorldSnapshotPayload (replaces all local state).
 *   - Apply individual Envelope ops in strict seq order:
 *       · op.seq <= currentSeq  → discard (duplicate / already applied)
 *       · op.seq == currentSeq + 1 → apply immediately
 *       · op.seq >  currentSeq + 1 → gap detected, emit "gap" event (caller
 *           should trigger resync); op is discarded (not buffered after boot)
 *   - Boot buffering: while `_booting === true`, incoming ops are queued in
 *       seq order and applied atomically once applySnapshot() is called.
 *   - Expose getDoc<T>(type, id), getByType<T>(type), subscribe(type, cb).
 *
 * Design notes:
 *   - No PIXI dependency — pure TS module, safe for Node/Vitest.
 *   - Uses a plain Map for the document store (no Svelte runes here).
 *     The Svelte reactive layer wraps this in activeSceneStore.svelte.ts.
 *   - "type" strings match the server convention: "Scene", "Actor", etc.
 */

import type { Envelope, WorldSnapshotPayload, DocDeletePayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GapListener = (expectedSeq: number, gotSeq: number) => void;
export type ChangeListener<T> = (docs: T[]) => void;

/** Internal storage: Map<docType, Map<_id, document>> */
type DocStore = Map<string, Map<string, unknown>>;

// ---------------------------------------------------------------------------
// DocumentMirror
// ---------------------------------------------------------------------------

export class DocumentMirror {
  private _store: DocStore = new Map();
  private _seq = -1; // -1 = no snapshot applied yet

  /** While true, incoming ops are buffered (boot phase). */
  private _booting = true;

  /** Boot buffer: ops received before the snapshot is applied, ordered by seq. */
  private _bootBuffer: Envelope[] = [];

  /** Gap event listeners */
  private _gapListeners: Set<GapListener> = new Set();

  /** Change listeners keyed by docType ("*" = all types) */
  private _changeListeners: Map<string, Set<ChangeListener<unknown>>> = new Map();

  // --------------------------------------------------------------------------
  // Public — seq / boot state
  // --------------------------------------------------------------------------

  /** The last canonical seq this mirror has applied. -1 if no snapshot yet. */
  get seq(): number {
    return this._seq;
  }

  /** True while in boot phase (before first snapshot is applied). */
  get booting(): boolean {
    return this._booting;
  }

  // --------------------------------------------------------------------------
  // Public — snapshot
  // --------------------------------------------------------------------------

  /**
   * Apply a full world snapshot.
   * Replaces all local document state.
   * After this call, any buffered boot ops are applied in seq order.
   */
  applySnapshot(snapshot: WorldSnapshotPayload): void {
    // Replace store
    this._store = new Map();
    for (const [type, docs] of Object.entries(snapshot.documents)) {
      const byId = new Map<string, unknown>();
      for (const doc of docs) {
        const d = doc as Record<string, unknown>;
        if (typeof d["_id"] === "string") {
          byId.set(d["_id"], d);
        }
      }
      this._store.set(type, byId);
    }

    this._seq = snapshot.seq;
    this._booting = false;

    // Drain boot buffer in seq order
    const sorted = this._bootBuffer.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this._bootBuffer = [];

    for (const op of sorted) {
      this._applyOp(op);
    }

    // Notify all types that changed
    this._notifyAll();
  }

  // --------------------------------------------------------------------------
  // Public — incremental ops
  // --------------------------------------------------------------------------

  /**
   * Feed a single op envelope from the server.
   * During boot, ops are buffered until applySnapshot() is called.
   * After boot, ops are applied immediately with strict ordering.
   */
  feedOp(op: Envelope): void {
    if (this._booting) {
      // Queue for after snapshot (REQ-ARQ-014 / REQ-NET-064)
      this._enqueueBootOp(op);
      return;
    }
    this._applyOp(op);
  }

  // --------------------------------------------------------------------------
  // Public — query API
  // --------------------------------------------------------------------------

  /** Retrieve a single document by type and _id. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  getDoc<T>(type: string, id: string): T | undefined {
    return this._store.get(type)?.get(id) as T | undefined;
  }

  /** Retrieve all documents of a given type. */

  getByType<T>(type: string): T[] {
    const byId = this._store.get(type);
    if (!byId) return [];
    return Array.from(byId.values()) as T[];
  }

  // --------------------------------------------------------------------------
  // Public — subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to changes for a specific document type.
   * Callback is called with the full updated list whenever any document of
   * that type is added, updated, or removed.
   * Pass "*" to subscribe to changes of any type.
   * Returns an unsubscribe function.
   */
  subscribe<T>(type: string, cb: ChangeListener<T>): () => void {
    let listeners = this._changeListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this._changeListeners.set(type, listeners);
    }
    listeners.add(cb as ChangeListener<unknown>);
    return () => {
      this._changeListeners.get(type)?.delete(cb as ChangeListener<unknown>);
    };
  }

  /** Subscribe to gap detection events (seq jump > 1). */
  onGap(cb: GapListener): () => void {
    this._gapListeners.add(cb);
    return () => this._gapListeners.delete(cb);
  }

  // --------------------------------------------------------------------------
  // Private — boot buffer
  // --------------------------------------------------------------------------

  private _enqueueBootOp(op: Envelope): void {
    if (op.seq === undefined) return; // ephemeral, no seq
    // Insert in sorted position to keep buffer ordered
    const idx = this._bootBuffer.findIndex((b) => (b.seq ?? 0) > (op.seq ?? 0));
    if (idx === -1) {
      this._bootBuffer.push(op);
    } else {
      this._bootBuffer.splice(idx, 0, op);
    }
  }

  // --------------------------------------------------------------------------
  // Private — op application
  // --------------------------------------------------------------------------

  private _applyOp(op: Envelope): void {
    const opSeq = op.seq;

    // Ops without seq (ephemeral) are ignored by the mirror
    if (opSeq === undefined) return;

    // Discard: already applied or older
    if (opSeq <= this._seq) return;

    // Gap detected: expected seq+1 but got something higher
    if (opSeq > this._seq + 1) {
      const expected = this._seq + 1;
      for (const cb of this._gapListeners) {
        cb(expected, opSeq);
      }
      // Discard — caller must trigger resync
      return;
    }

    // Apply the op (opSeq === this._seq + 1)
    const affectedTypes = new Set<string>();

    switch (op.type) {
      case "doc:create":
      case "doc:update":
        // Server broadcasts { documentType, documents: [...] } for both
        // create and update (complete post-merge documents).
        this._handleUpsert(
          op.payload as { documentType: string; documents: unknown[]; removedIds?: unknown },
          affectedTypes,
        );
        break;
      case "doc:delete":
        this._handleDelete(op.payload as DocDeletePayload, affectedTypes);
        break;
      // BUG FIX: combat:created/updated/deleted are broadcast on their own
      // dedicated envelope types (see combat-handlers.ts buildEnvelope calls) —
      // they never went through doc:create/update/delete, so a mid-session
      // "Criar Combate" never reached the mirror and combatStore.combat (which
      // is derived purely from worldMirror.subscribe("Combat", ...)) stayed
      // null. Treating them here — in the same seq-gated switch as doc:* —
      // gives them the same dedup-against-snapshot and gap-detection guarantees
      // as every other canonical op, instead of a parallel ad-hoc path.
      case "combat:created":
        this._handleCombatCreated(op.payload as { combat: Record<string, unknown> }, affectedTypes);
        break;
      case "combat:updated":
        this._handleCombatUpdated(
          op.payload as { combatId: string; diff: Record<string, unknown> },
          affectedTypes,
        );
        break;
      case "combat:deleted":
        this._handleCombatDeleted(op.payload as { combatId: string }, affectedTypes);
        break;
      default:
        // Other op types (token:move etc.) — advance seq but no doc changes
        break;
    }

    this._seq = opSeq;

    for (const type of affectedTypes) {
      this._notify(type);
    }
  }

  /**
   * Handle doc:create and doc:update broadcasts.
   *
   * Both ops use the same broadcast shape: { documentType, documents: [...] }
   * where each element is the complete post-merge document state.
   * For create: inserts new docs. For update: replaces existing docs by _id
   * (server sends the full post-merge state, so no diff application needed).
   *
   * `removedIds` is the delta's other half: ids the SERVER's redaction dropped
   * from this viewer's copy of the batch (spec 39, REQ-CTT-075 — a contact
   * lowered to `oculto`). An upsert-only mirror would keep showing them until
   * the next reload, so they are forgotten here, before the upsert, on the very
   * same op — no extra envelope, so the seq stays contiguous. It is NOT a
   * deletion of the document in the world: only this client stops holding it.
   */
  private _handleUpsert(
    payload: { documentType: string; documents: unknown[]; removedIds?: unknown },
    affected: Set<string>,
  ): void {
    const { documentType, documents, removedIds } = payload;
    if (!this._store.has(documentType)) {
      this._store.set(documentType, new Map());
    }
    const byId = this._store.get(documentType) ?? new Map<string, unknown>();
    this._store.set(documentType, byId);
    if (Array.isArray(removedIds)) {
      for (const id of removedIds) {
        if (typeof id === "string" && byId.delete(id)) {
          affected.add(documentType);
        }
      }
    }
    for (const item of documents) {
      const d = item as Record<string, unknown>;
      if (typeof d["_id"] === "string") {
        byId.set(d["_id"], d);
        affected.add(documentType);
      }
    }
  }

  private _handleDelete(payload: DocDeletePayload, affected: Set<string>): void {
    const { documentType, ids } = payload;
    const byId = this._store.get(documentType);
    if (!byId) return;
    for (const id of ids) {
      if (byId.delete(id)) {
        affected.add(documentType);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Private — Combat lifecycle broadcasts (combat:created/updated/deleted)
  // --------------------------------------------------------------------------

  /**
   * combat:created — { combat: CombatDocument }.
   * Insert the full combat document into the "Combat" collection, mirroring
   * doc:create semantics (see CombatCreatedPayloadSchema doc comment: "All
   * clients receive this and add the Combat to their local collection").
   */
  private _handleCombatCreated(
    payload: { combat: Record<string, unknown> },
    affected: Set<string>,
  ): void {
    const combat = payload.combat;
    if (typeof combat["_id"] !== "string") return;
    let byId = this._store.get("Combat");
    if (!byId) {
      byId = new Map<string, unknown>();
      this._store.set("Combat", byId);
    }
    byId.set(combat["_id"], combat);
    affected.add("Combat");
  }

  /**
   * combat:updated — { combatId, diff }. The diff is a partial CombatDocument
   * (dot-path fields; `combatants` when present is the full replacement array
   * per REQ-DOC-037 — see CombatUpdatedPayloadSchema doc comment). Shallow-
   * merge onto the existing local copy, mirroring how persistCombat() merges
   * server-side. If we don't have the combat locally yet (e.g. this update
   * raced ahead of the combat:created broadcast, or arrived after a resync
   * gap), the diff alone isn't a valid document — skip rather than store a
   * partial/broken Combat.
   */
  private _handleCombatUpdated(
    payload: { combatId: string; diff: Record<string, unknown> },
    affected: Set<string>,
  ): void {
    const { combatId, diff } = payload;
    const byId = this._store.get("Combat");
    const existing = byId?.get(combatId) as Record<string, unknown> | undefined;
    if (!byId || !existing) return;
    byId.set(combatId, { ...existing, ...diff });
    affected.add("Combat");
  }

  /**
   * combat:deleted — { combatId }. Broadcast when combat ends (REQ-CBT-006);
   * remove it from the local collection so combatStore.combat (derived from
   * this mirror) goes back to null and the tracker UI disappears.
   */
  private _handleCombatDeleted(payload: { combatId: string }, affected: Set<string>): void {
    const byId = this._store.get("Combat");
    if (!byId) return;
    if (byId.delete(payload.combatId)) {
      affected.add("Combat");
    }
  }

  // --------------------------------------------------------------------------
  // Private — notifications
  // --------------------------------------------------------------------------

  private _notify(type: string): void {
    const docs = this.getByType(type);
    for (const cb of this._changeListeners.get(type) ?? []) {
      cb(docs);
    }
    for (const cb of this._changeListeners.get("*") ?? []) {
      cb(docs);
    }
  }

  private _notifyAll(): void {
    // _notify already fires both type-specific and wildcard listeners.
    // Iterate each unique type once.
    const seen = new Set<string>();
    for (const type of this._store.keys()) {
      if (!seen.has(type)) {
        seen.add(type);
        this._notify(type);
      }
    }
  }
}
