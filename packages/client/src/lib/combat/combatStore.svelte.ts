/**
 * combatStore.svelte.ts — Svelte 5 runes reactive store for the combat tracker.
 *
 * Responsibilities:
 *   - Subscribe to the DocumentMirror for "Combat" documents.
 *   - Expose the active combat (one per active scene in MVP).
 *   - React to combat:turnChange socket events for fast canvas updates.
 *   - Provide sendOp helpers for all combat operations (GM and player).
 *
 * REQ-CBT-001..006: Combat lifecycle.
 * REQ-CBT-031..035: Visibility — the server already redacts hidden combatants
 *   from player snapshots, so the mirror only contains what the user can see.
 *   We do NOT filter here; render what the mirror provides.
 *
 * Spec: 10-combate-e-iniciativa.md
 */

import type { Socket } from "socket.io-client";
import type { CombatDocument, CombatantDocument, CombatTurnSnapshot } from "@fusion/shared";
import { sortCombatants } from "@fusion/shared";
import { worldMirror } from "../docs/worldSync.js";
import { activeSceneState } from "../docs/activeScene.svelte.js";
import { sendOp, OpError } from "../docs/sendOp.js";
import { createTargetingState, applyTargeted, type TargetingState } from "./targeting.js";
import { resolveActiveCombat, extractConflictingCombatId } from "./combatTracker.js";

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const combatStore: {
  /** Active combat for the current scene, or null if none. */
  combat: CombatDocument | null;
  /** Whether an async combat op is in flight. */
  busy: boolean;
  /** Last error from a combat op, or null. */
  error: string | null;
  /** Latest turn-change snapshot received from combat:turnChange (for canvas). */
  lastTurnChange: {
    combatId: string;
    current: CombatTurnSnapshot;
    previous: CombatTurnSnapshot;
  } | null;
} = $state({
  combat: null,
  busy: false,
  error: null,
  lastTurnChange: null,
});

// ---------------------------------------------------------------------------
// Targeting state
// ---------------------------------------------------------------------------

/**
 * Cross-user targeting state, fed by token:targeted broadcasts.
 *
 * The Map inside TargetingState is mutated in place by the reducer; a separate
 * reactive `version` counter is bumped on every change so Svelte $derived /
 * $effect consumers (and the canvas controller) can observe updates without us
 * having to reassign a deep-cloned Map every time.
 *
 * REQ-CBT-053..055.
 */
const _targeting: TargetingState = createTargetingState();

export const targetingStore: { version: number } = $state({ version: 0 });

/** Read the (mutable) targeting state. Treat as read-only outside this module. */
export function getTargetingState(): TargetingState {
  return _targeting;
}

// ---------------------------------------------------------------------------
// Mirror subscription — Combat documents
// ---------------------------------------------------------------------------

// Latest raw Combat list from the mirror, cached so we can re-derive
// combatStore.combat whenever the active scene changes too (see effect
// below) — not just when the "Combat" collection itself changes.
let _latestCombats: CombatDocument[] = [];

/**
 * Recompute combatStore.combat from the latest known Combat list, scoped to
 * the currently active scene.
 *
 * BUG FIX (combat panel deadlock, #6 / GRUPO 4): the mirror can hold more
 * than one non-ended Combat at a time (e.g. a stale orphan left over from a
 * previous scene that was never explicitly ended — reproduced against the
 * real "argiburgo" world DB, which had 5 Combat rows with one non-ended
 * orphan). Previously this picked "the first non-ended Combat across the
 * whole world" with no sceneId filter, so it could latch onto a Combat that
 * does not belong to the active scene (or fail to surface the active
 * scene's own Combat). The GM would then see the wrong encounter — or the
 * add-combatants/tracker UI gated behind `{#if !combat}` would never open —
 * and combatActions.create() for the real active scene would be rejected by
 * the server (DEC-CBT-06: one active combat per scene) pointing at a combat
 * unrelated to what the GM sees, with no way out. See resolveActiveCombat()
 * in combatTracker.ts for the scoped selection logic.
 */
function _recomputeActiveCombat(): void {
  combatStore.combat = resolveActiveCombat(_latestCombats, activeSceneState.id);
}

// Subscribe to Combat documents in the world mirror.
// "Combat" is the documentType used by the server.
worldMirror.subscribe<CombatDocument>("Combat", (combats) => {
  _latestCombats = combats;
  _recomputeActiveCombat();
});

// Re-derive combatStore.combat whenever the active scene changes (e.g. the
// GM switches scenes) even if the Combat collection itself didn't change.
// $effect.root is used because this is module-level (non-component) reactive
// code — see Svelte 5 docs on effects outside components.
$effect.root(() => {
  $effect(() => {
    // Read activeSceneState.id to establish the reactive dependency.
    void activeSceneState.id;
    _recomputeActiveCombat();
  });
});

// ---------------------------------------------------------------------------
// Socket event listeners (attached lazily when socket is available)
// ---------------------------------------------------------------------------

/**
 * Attach combat socket event listeners.
 * Returns a cleanup function.
 * Call from session setup (after worldSync is attached).
 */
export function attachCombatSync(socket: Socket): () => void {
  const onOp = (envelope: { type: string; payload: unknown }) => {
    if (envelope.type === "combat:turnChange") {
      const payload = envelope.payload as {
        combatId: string;
        current: CombatTurnSnapshot;
        previous: CombatTurnSnapshot;
      };
      combatStore.lastTurnChange = payload;
    } else if (envelope.type === "token:targeted") {
      // REQ-CBT-053/054: a user marked/cleared a token as a target.
      const payload = envelope.payload as {
        tokenId: string;
        targeted: boolean;
        userId: string;
      };
      const changed = applyTargeted(_targeting, payload.tokenId, payload.targeted, payload.userId);
      if (changed) targetingStore.version += 1;
    }
  };

  socket.on("op", onOp);
  return () => {
    socket.off("op", onOp);
  };
}

// ---------------------------------------------------------------------------
// Derived helpers (pure functions used by Svelte components)
// ---------------------------------------------------------------------------

/**
 * Get the sorted combatant list from the current combat.
 * Combatants are already sorted server-side; this re-sorts client-side using
 * the default comparator to guarantee correct display order even if the server
 * sends them in insertion order after a manual reorder.
 */
export function getSortedCombatants(combat: CombatDocument) {
  return sortCombatants(combat.combatants);
}

/**
 * Get the active combatant (turno atual) from the current combat.
 *
 * Resolved by combat.activeCombatantId (matched by _id), NOT by turnIndex:
 * turnIndex is positional against the GM's full array, so for a player whose
 * combatants array is redacted it would point at the wrong combatant. When the
 * active combatant is hidden, the server masks activeCombatantId to null for
 * players, so this returns null (no active combatant shown), which is correct.
 */
export function getActiveCombatant(combat: CombatDocument): CombatantDocument | null {
  if (!combat.started || combat.activeCombatantId === null) return null;
  return combat.combatants.find((c) => c._id === combat.activeCombatantId) ?? null;
}

// ---------------------------------------------------------------------------
// Combat ops — emit via sendOp
// ---------------------------------------------------------------------------

async function _runOp(socket: Socket, fn: () => Promise<void>): Promise<void> {
  if (combatStore.busy) return;
  combatStore.busy = true;
  combatStore.error = null;
  try {
    await fn();
  } catch (err) {
    combatStore.error = err instanceof OpError ? err.message : "An unexpected error occurred.";
  } finally {
    combatStore.busy = false;
  }
}

export const combatActions = {
  /**
   * GM creates a new combat for the given scene.
   *
   * Self-heal (GRUPO 4, combat panel deadlock #6): if the server rejects the
   * create with DEC-CBT-06 (a non-ended Combat already exists for this
   * scene) because the client's local mirror was out of sync, the server
   * embeds the conflicting combatId in the error message. Rather than
   * leaving combatStore.error as the only feedback (a dead end — the "Create
   * Combat" button would just fail again the same way), check whether the
   * mirror already has that Combat and, if so, re-derive combatStore.combat
   * from it so the panel recovers on the spot. If the mirror does NOT have
   * it yet (the create raced ahead of the combat:created broadcast reaching
   * this client), there is nothing to reconcile from locally — the next
   * combat:created/updated broadcast or resync will populate it, same as any
   * other document.
   */
  async create(socket: Socket, sceneId: string): Promise<void> {
    await _runOp(socket, async () => {
      try {
        await sendOp(socket, { type: "combat:create", payload: { sceneId } });
      } catch (err) {
        if (err instanceof OpError) {
          const conflictingId = extractConflictingCombatId(err.message);
          if (conflictingId !== null) {
            const existing = worldMirror.getDoc<CombatDocument>("Combat", conflictingId);
            if (existing) {
              _recomputeActiveCombat();
            }
          }
        }
        throw err;
      }
    });
  },

  /** GM starts the combat (begins round 1). */
  async start(socket: Socket, combatId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, { type: "combat:beginCombat", payload: { combatId } });
    });
  },

  /** GM adds a combatant by tokenId. */
  async addCombatant(
    socket: Socket,
    combatId: string,
    tokenId: string,
    actorId?: string,
  ): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:addCombatant",
        payload: { combatId, tokenId, actorId },
      });
    });
  },

  /** GM removes a combatant. */
  async removeCombatant(socket: Socket, combatId: string, combatantId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:removeCombatant",
        payload: { combatId, combatantId },
      });
    });
  },

  /**
   * Roll initiative for combatants.
   * If combatantIds is omitted, the server rolls all with null initiative.
   */
  async rollInitiative(socket: Socket, combatId: string, combatantIds?: string[]): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:rollInitiative",
        payload: { combatId, combatantIds },
      });
    });
  },

  /** Set initiative manually for a single combatant. */
  async setInitiative(
    socket: Socket,
    combatId: string,
    combatantId: string,
    value: number | null,
  ): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:setInitiative",
        payload: { combatId, combatantId, value },
      });
    });
  },

  /** GM resets all initiative values to null. */
  async resetInitiative(socket: Socket, combatId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:resetInitiative",
        payload: { combatId },
      });
    });
  },

  /** GM advances to the next turn. */
  async nextTurn(socket: Socket, combatId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:nextTurn",
        payload: { combatId },
      });
    });
  },

  /** GM goes back to the previous turn. */
  async previousTurn(socket: Socket, combatId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:previousTurn",
        payload: { combatId },
      });
    });
  },

  /** Toggle defeated for a combatant. */
  async toggleDefeated(
    socket: Socket,
    combatId: string,
    combatantId: string,
    defeated: boolean,
  ): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:setDefeated",
        payload: { combatId, combatantId, defeated },
      });
    });
  },

  /** GM toggles hidden for a combatant. */
  async setHidden(
    socket: Socket,
    combatId: string,
    combatantId: string,
    hidden: boolean,
  ): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:setHidden",
        payload: { combatId, combatantId, hidden },
      });
    });
  },

  /** GM reorders combatants (drag-and-drop sends full ordered id array). */
  async reorder(socket: Socket, combatId: string, order: string[]): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:reorder",
        payload: { combatId, order },
      });
    });
  },

  /** GM ends the combat. */
  async end(socket: Socket, combatId: string): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:endCombat",
        payload: { combatId },
      });
    });
  },

  /**
   * Mark or clear a token as a target for the current user.
   *
   * The server resolves the acting userId from the authenticated socket and
   * ignores any client-supplied userId (CombatTargetPayloadSchema is
   * { tokenId, targeted }). The server echoes the resolved userId back via the
   * token:targeted broadcast, which attachCombatSync feeds into the targeting
   * store. We do NOT optimistically mutate local targeting state here — we wait
   * for the authoritative broadcast so all clients stay consistent.
   *
   * REQ-CBT-053.
   */
  async target(socket: Socket, tokenId: string, targeted: boolean): Promise<void> {
    await _runOp(socket, async () => {
      await sendOp(socket, {
        type: "combat:target",
        payload: { tokenId, targeted },
      });
    });
  },
};
