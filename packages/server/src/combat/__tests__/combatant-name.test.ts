import { describe, expect, it } from "vitest";
import { inheritedCombatantName } from "../combatant-name.js";

const imported = { name: "Eagle", flags: { fusion: { i18n: { "pt-BR": { name: "Águia" } } } } };

describe("inheritedCombatantName", () => {
  it("uses the pt-BR label the import snapshotted, like every other surface", () => {
    expect(inheritedCombatantName(imported, undefined)).toBe("Águia");
  });

  it("falls back to the stored name when the actor has no translation", () => {
    expect(inheritedCombatantName({ name: "Goblin" }, undefined)).toBe("Goblin");
    expect(inheritedCombatantName({ name: "Goblin", flags: { fusion: { i18n: {} } } }, "")).toBe(
      "Goblin",
    );
  });

  it("lets an actorDelta rename win over both", () => {
    expect(inheritedCombatantName(imported, "Sentinela")).toBe("Sentinela");
  });
});
