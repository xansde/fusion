/**
 * sceneLoadGeneration.test.ts — unit tests for the TableScreen scene-load
 * teardown-race gate (issue #81).
 *
 * BUG FIX (race): guards against a superseded scene load's post-await
 * continuation publishing its content into `cleanupScene`/`sceneOrchestrator`
 * after a newer scene switch has already started — see isCurrentGeneration's
 * doc comment in canvasReadyGate.ts for full root-cause context.
 *
 * The expected values below come from the invariant the issue names
 * ("the teardown for load N must never run against load N+1's content"),
 * not from re-reading TableScreen.svelte's own generation counter — a load
 * started when the counter read N is current only while the counter still
 * reads N.
 */

import { describe, it, expect } from "vitest";
import { isCurrentGeneration } from "../canvasReadyGate.js";

describe("isCurrentGeneration", () => {
  it("is false once a newer load has started (counter moved past this load's generation)", () => {
    // Load 1 started when the counter was 1; by the time its await resolves,
    // a newer scene switch bumped the counter to 2 — load 1 is stale.
    expect(isCurrentGeneration(1, 2)).toBe(false);
  });

  it("is true when no newer load has started since this one began", () => {
    // Load 2 started when the counter was 2, and it still reads 2 at the
    // checkpoint — nothing superseded it, safe to publish.
    expect(isCurrentGeneration(2, 2)).toBe(true);
  });

  it("is false for any generation older than the current one, not just off-by-one", () => {
    expect(isCurrentGeneration(1, 5)).toBe(false);
  });

  it("is false if somehow asked about a generation newer than the counter (defensive — should not occur)", () => {
    expect(isCurrentGeneration(3, 2)).toBe(false);
  });
});
