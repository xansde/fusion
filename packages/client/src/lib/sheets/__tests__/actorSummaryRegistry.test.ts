/**
 * actorSummaryRegistry.test.ts — a game system plugs its one-screen actor summary in by subtype.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  registerActorChip,
  registerActorSummary,
  resetActorSummaries,
  resolveActorChip,
  resolveActorSummary,
  type ActorSummaryComponent,
} from "../actorSummaryRegistry.svelte.js";

/** A stand-in component: the registry only stores and returns it. */
const stub = (): ActorSummaryComponent => (() => ({})) as unknown as ActorSummaryComponent;
const SummaryA = stub();
const SummaryB = stub();

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

describe("actor chip registry", () => {
  it("resolves the small chip by subtype, independent of the full summary", () => {
    const Chip = stub();
    registerActorChip("character", Chip);
    expect(resolveActorChip("character")).toBe(Chip);
    expect(resolveActorChip("npc")).toBeNull();
    expect(resolveActorSummary("character")).toBeNull();
  });

  it("reset forgets the chips too", () => {
    registerActorChip("character", stub());
    resetActorSummaries();
    expect(resolveActorChip("character")).toBeNull();
  });
});
