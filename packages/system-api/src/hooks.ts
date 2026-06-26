/**
 * Typed hook bus for the Fusion engine↔system event system.
 *
 * Provides a typed `HookBus` where every hook name maps to a statically-known
 * payload type. Systems register listeners with `on(name, listener)` and the
 * engine emits with `emit(name, payload)`.
 *
 * Key design decisions (spec 15 §D7):
 *   - `pre*` hooks are synchronous; return `false` to cancel the operation.
 *   - Post hooks are notification-only and cannot cancel.
 *   - Listener errors are isolated: caught, logged, and the cycle continues.
 *     REQ-SYS-066 / REQ-SYS-132.
 *   - `on()` returns a stable reference token that `off()` uses. This avoids
 *     the "anonymous function cannot be unregistered" footgun in Foundry.
 *   - The canonical hook name list is documented here and versioned with the
 *     engine; any change to a hook name is a semver-major breaking change.
 *     REQ-SYS-067.
 *
 * REQ-SYS-060: on/once/off typed by HookName.
 * REQ-SYS-061: document lifecycle hooks.
 * REQ-SYS-062: combat hooks.
 * REQ-SYS-063: roll hooks.
 * REQ-SYS-064: render hooks.
 * REQ-SYS-065: applyEffect hook.
 * REQ-SYS-066: error isolation.
 * REQ-SYS-067: documented and versioned.
 *
 * REQ-ARQ-005: must NOT import from server or client.
 */
import type { EffectRule } from "./effects.js";

// ---------------------------------------------------------------------------
// Hook payload types
// ---------------------------------------------------------------------------

/**
 * Generic document-shaped type for hook payloads.
 * Avoids importing concrete document schemas (would create circular deps).
 */
export type HookDocument = Record<string, unknown>;
export type HookOperation = Record<string, unknown>;

/**
 * Combat and combatant shapes for hook payloads.
 * Concrete types live in @fusion/shared; we reference them loosely here
 * to avoid a compile-time import cycle. Consumers cast if needed.
 */
export type HookCombat = Record<string, unknown>;
export type HookCombatant = Record<string, unknown>;

/**
 * Roll context/result shapes.
 * Concrete types defined in spec 08 (motor-de-rolagens).
 */
export type RollContext = Record<string, unknown>;
export type RollResult = Record<string, unknown>;

// ---------------------------------------------------------------------------
// HookMap — canonical hook names and their payload types
// REQ-SYS-061..065 / REQ-SYS-067
// ---------------------------------------------------------------------------

/**
 * The canonical hook map: name → listener signature.
 *
 * Document lifecycle hooks use generic names:
 *   - `preCreate` / `create` / `preUpdate` / `update` / `preDelete` / `delete`
 *   These are typed with `HookDocument` payloads. The engine dispatches
 *   type-specific variants (e.g., `preCreateActor`) through the same bus;
 *   for MVP the generic names suffice. Type-specific variants are additive
 *   and non-breaking.
 *
 * Pre hooks (cancel):  listener returns `false` to cancel. Sync.
 * Post hooks (notify): listener return value ignored. May be async.
 *
 * REQ-SYS-061..065.
 */
export interface HookMap {
  // ── Document lifecycle (REQ-SYS-061) ─────────────────────────────────────

  /**
   * Fires synchronously on the server before a Document is created.
   * Return `false` to cancel creation.
   * Payload: (doc, data, operation, userId)
   */
  preCreate: (
    doc: HookDocument,
    data: Record<string, unknown>,
    op: HookOperation,
    userId: string,
  ) => boolean | undefined;

  /**
   * Fires on all clients after a Document is created.
   * Payload: (doc, operation, userId)
   */
  create: (doc: HookDocument, op: HookOperation, userId: string) => void | Promise<void>;

  /**
   * Fires synchronously on the server before a Document is updated.
   * Return `false` to cancel the update.
   * Payload: (doc, changes, operation, userId)
   */
  preUpdate: (
    doc: HookDocument,
    changes: Record<string, unknown>,
    op: HookOperation,
    userId: string,
  ) => boolean | undefined;

  /**
   * Fires on all clients after a Document is updated.
   * Payload: (doc, changes, operation, userId)
   */
  update: (
    doc: HookDocument,
    changes: Record<string, unknown>,
    op: HookOperation,
    userId: string,
  ) => void | Promise<void>;

  /**
   * Fires synchronously on the server before a Document is deleted.
   * Return `false` to cancel deletion.
   * Payload: (doc, operation, userId)
   */
  preDelete: (doc: HookDocument, op: HookOperation, userId: string) => boolean | undefined;

  /**
   * Fires on all clients after a Document is deleted.
   * Payload: (doc, operation, userId)
   */
  delete: (doc: HookDocument, op: HookOperation, userId: string) => void | Promise<void>;

  // ── Combat (REQ-SYS-062) ─────────────────────────────────────────────────

  /**
   * Fires on all clients when combat begins (initiative is rolled).
   * Payload: (combat)
   */
  combatStart: (combat: HookCombat) => void | Promise<void>;

  /**
   * Fires on all clients at the start of each round.
   * Payload: (combat, round)
   */
  roundStart: (combat: HookCombat, round: number) => void | Promise<void>;

  /**
   * Fires on all clients at the end of each round.
   * Payload: (combat, round)
   */
  roundEnd: (combat: HookCombat, round: number) => void | Promise<void>;

  /**
   * Fires on all clients at the start of a combatant's turn.
   * Payload: (combat, combatant, previous)
   */
  turnStart: (
    combat: HookCombat,
    combatant: HookCombatant,
    previous: { round: number; turn: number } | null,
  ) => void | Promise<void>;

  /**
   * Fires on all clients at the end of a combatant's turn.
   * Payload: (combat, combatant)
   */
  turnEnd: (combat: HookCombat, combatant: HookCombatant) => void | Promise<void>;

  /**
   * Fires on all clients when combat ends.
   * Payload: (combat)
   */
  combatEnd: (combat: HookCombat) => void | Promise<void>;

  // ── Roll (REQ-SYS-063) ────────────────────────────────────────────────────

  /**
   * Fires synchronously on the server before a roll is evaluated.
   * Return `false` to cancel the roll.
   * Payload: (context)
   */
  preRoll: (context: RollContext) => boolean | undefined;

  /**
   * Fires on the roll author and relevant recipients after a roll completes.
   * Payload: (result, context)
   */
  postRoll: (result: RollResult, context: RollContext) => void | Promise<void>;

  // ── Effects / prepareData (REQ-SYS-065) ──────────────────────────────────

  /**
   * Fires locally during prepareData for each EffectRule applied.
   * Not cancelable. Used for system observation/annotation.
   * Payload: (actor, rule, change)
   */
  applyEffect: (actor: HookDocument, rule: EffectRule, change: Record<string, unknown>) => void;

  // ── Render (REQ-SYS-064) ─────────────────────────────────────────────────

  /**
   * Fires locally on the client after a sheet application renders.
   * Payload: (app, element, context)
   */
  renderSheet: (
    app: Record<string, unknown>,
    element: unknown,
    ctx: Record<string, unknown>,
  ) => void | Promise<void>;

  /**
   * Fires locally on the client after a ChatMessage renders.
   * Payload: (message, element)
   */
  renderChatMessage: (message: HookDocument, element: unknown) => void | Promise<void>;
}

export type HookName = keyof HookMap;
export type HookListener<N extends HookName> = HookMap[N];

// ---------------------------------------------------------------------------
// HookRef — opaque listener registration token
// ---------------------------------------------------------------------------

/** Opaque token returned by `on()`/`once()` and consumed by `off()`. */
export interface HookRef<N extends HookName = HookName> {
  readonly name: N;
  /** @internal — internal identifier, do not rely on shape. */
  readonly _id: number;
}

// ---------------------------------------------------------------------------
// HookBus
// ---------------------------------------------------------------------------

/**
 * Internal registration entry.
 * @internal
 */
interface ListenerEntry<N extends HookName> {
  id: number;
  listener: HookListener<N>;
  once: boolean;
}

let _nextId = 1;

/**
 * Typed hook event bus.
 *
 * - `on(name, fn)` — register a persistent listener; returns a HookRef.
 * - `once(name, fn)` — register a one-shot listener; auto-removed after first emit.
 * - `off(ref)` — unregister a listener by its HookRef token.
 * - `emit(name, ...args)` — call all listeners for a hook; for pre* hooks
 *   that return `false`, stop early and return `false`. Otherwise `true`.
 *
 * Listener errors are caught and logged (REQ-SYS-066/132). Errors in one
 * listener do NOT prevent subsequent listeners from running or the cycle from
 * completing (except explicit `false` cancellation).
 *
 * REQ-SYS-060.
 */
export class HookBus {
  private readonly _registry = new Map<HookName, ListenerEntry<HookName>[]>();

  /**
   * Register a persistent listener for a hook.
   * Returns a HookRef token for later `off()`.
   *
   * REQ-SYS-060.
   */
  on<N extends HookName>(name: N, listener: HookListener<N>): HookRef<N> {
    return this._register(name, listener, false);
  }

  /**
   * Register a one-shot listener. Auto-removed after the first emit.
   *
   * REQ-SYS-060.
   */
  once<N extends HookName>(name: N, listener: HookListener<N>): HookRef<N> {
    return this._register(name, listener, true);
  }

  /**
   * Unregister a listener by its HookRef token.
   *
   * REQ-SYS-060.
   */
  off<N extends HookName>(ref: HookRef<N>): void {
    const entries = this._registry.get(ref.name);
    if (!entries) return;
    const idx = entries.findIndex((e) => e.id === ref._id);
    if (idx !== -1) entries.splice(idx, 1);
  }

  /**
   * Emit a hook, calling all registered listeners in registration order.
   *
   * For `pre*` hooks: if any listener returns `false` (synchronously), emission
   * stops and this method returns `false` (indicating cancellation).
   *
   * For other hooks: all listeners are called; errors are caught and logged.
   * Returns `true`.
   *
   * REQ-SYS-060 / REQ-SYS-066.
   */
  emit<N extends HookName>(name: N, ...args: Parameters<HookListener<N>>): boolean {
    const entries = this._registry.get(name);
    if (!entries || entries.length === 0) return true;

    // Snapshot to allow safe removal of `once` listeners during iteration
    const snapshot = [...entries];
    const toRemove: number[] = [];
    let cancelled = false;

    for (const entry of snapshot) {
      if (entry.once) toRemove.push(entry.id);

      let result: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = (entry.listener as (...a: any[]) => unknown)(...args);
      } catch (err) {
        // REQ-SYS-066: isolate listener errors — log without crashing the emit cycle.
        // console exists in Node.js/browsers but is not in ES2022 lib typings.
        // We access it via a typed declaration to avoid unsafe `any` cast.
        const c = (
          globalThis as typeof globalThis & { console?: { error: (...a: unknown[]) => void } }
        ).console;
        c?.error(
          `[HookBus] Uncaught error in listener for hook "${name}" (id ${String(entry.id)}):`,
          err,
        );
        continue;
      }

      // Pre hooks: synchronous false = cancel
      if (result === false) {
        cancelled = true;
        break;
      }
    }

    // Remove one-shot listeners
    if (toRemove.length > 0) {
      const remaining = entries.filter((e) => !toRemove.includes(e.id));
      this._registry.set(name, remaining);
    }

    return !cancelled;
  }

  /** Return the number of registered listeners for a hook. Useful in tests. */
  listenerCount(name: HookName): number {
    return this._registry.get(name)?.length ?? 0;
  }

  private _register<N extends HookName>(
    name: N,
    listener: HookListener<N>,
    once: boolean,
  ): HookRef<N> {
    const id = _nextId++;
    if (!this._registry.has(name)) {
      this._registry.set(name, []);
    }
    (this._registry.get(name) as ListenerEntry<N>[]).push({
      id,
      listener,
      once,
    });
    return { name, _id: id };
  }
}
