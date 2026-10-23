/**
 * actorSummaryRegistry.test.ts — a game system plugs its one-screen actor summary in by subtype.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  registerActorSummary,
  resetActorSummaries,
  resolveActorSummary,
} from "../actorSummaryRegistry.svelte.js";

const SummaryA = {};
const SummaryB = {};

beforeEach(() => {
  resetActorSummaries();
});

describe("actorSummaryRegistry", () => {
  it("resolves nothing before a system registers", () => {
    expect(resolveActorSummary("character")).toBeNull();
  });

  it("resolves the component registered for a subtype, and only that subtype", () => {
    registerActorSummary("character", SummaryA);
    expect(resolveActorSummary("character")).toBe(SummaryA);
    expect(resolveActorSummary("npc")).toBeNull();
  });

  it("a later registration for the same subtype replaces the earlier one", () => {
    registerActorSummary("character", SummaryA);
    registerActorSummary("character", SummaryB);
    expect(resolveActorSummary("character")).toBe(SummaryB);
  });

  it("reset forgets every registration", () => {
    registerActorSummary("character", SummaryA);
    resetActorSummaries();
    expect(resolveActorSummary("character")).toBeNull();
  });
});
