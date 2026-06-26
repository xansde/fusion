/**
 * CombatEventBus — typed Node.js EventEmitter for combat lifecycle events.
 *
 * The server emits these events on turn/round transitions so that system API
 * handlers (M3+) can process automations (expire conditions, recovery checks, etc.)
 * without touching the combat logic core.
 *
 * DEC-CBT-05: events are emitted on the server (EventEmitter), NOT forwarded
 * directly to clients as socket events. Clients receive the updated CombatDocument
 * state via the normal broadcast pipeline.
 *
 * Lifecycle order for nextTurn:
 *   1. turnEnd(current)
 *   2. [if round changes] roundEnd(prev round)
 *   3. [if round changes] roundStart(new round)
 *   4. turnStart(next)
 *
 * Lifecycle for startCombat:
 *   1. combatStart
 *   2. turnStart(combatant at turn 0)
 *
 * Lifecycle for endCombat:
 *   1. turnEnd(current) — if combat was started
 *   2. combatEnd
 *
 * REQ-CBT-026..029.
 */

import { EventEmitter } from "node:events";
import type { CombatLifecycleEvent, CombatLifecycleEventName } from "@fusion/shared";

/**
 * Typed wrapper around Node.js EventEmitter.
 *
 * Provides extension points for M3+ system API hooks — systems call
 * `on(eventName, handler)` to receive lifecycle events.
 */
export class CombatEventBus extends EventEmitter {
  /**
   * Emit a typed lifecycle event.
   *
   * @param event - The lifecycle event (discriminated union).
   * @returns true if the event had listeners.
   */
  emitLifecycle(event: CombatLifecycleEvent): boolean {
    return this.emit(event.type, event);
  }

  /**
   * Register a handler for a specific lifecycle event name.
   * Called by the system API in M3+.
   *
   * @param eventName - The event to listen to.
   * @param handler   - Async or sync handler; errors are caught and logged.
   */
  onLifecycle(
    eventName: CombatLifecycleEventName,
    handler: (event: CombatLifecycleEvent) => void | Promise<void>,
  ): this {
    return this.on(eventName, (event: CombatLifecycleEvent) => {
      void Promise.resolve(handler(event)).catch((err: unknown) => {
        // System-API lifecycle handlers must not crash the combat pipeline.
        console.error(`[combat] lifecycle handler for "${eventName}" failed:`, err);
      });
    });
  }
}
