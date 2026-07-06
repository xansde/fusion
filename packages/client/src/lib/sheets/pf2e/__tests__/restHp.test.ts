/**
 * restHp.test.ts — Descansar recovers HP (r16 verificação viva).
 *
 * Remaster night's rest heals CON mod × level, min 1 × level, clamped to max.
 * These tests pin the recovery math and the resulting rest ops (HP doc:update
 * + chat summary).
 */

import { describe, it, expect } from "vitest";
import { CharacterSheetVM } from "../characterSheetVM.js";

/**
 * A minimal owned character with a chosen CON mod, level, and HP. Scores are
 * placed in derived.abilityScores (r11 build-driven) so the VM's derived CON
 * mod path is exercised; hp is derived too.
 */
function makeCaster(opts: {
  level: number;
  conScore: number;
  hpValue: number;
  hpMax: number;
}): CharacterSheetVM {
  const doc: Record<string, unknown> = {
    _id: "hero",
    name: "Tobias",
    type: "character",
    ownership: { default: 0, "user-gm": 3 },
    system: {
      level: { value: opts.level },
      abilities: { con: { value: opts.conScore } },
      attributes: { hp: { value: opts.hpValue, max: opts.hpMax } },
      derived: {
        abilityScores: { con: opts.conScore },
        abilityMods: { con: Math.floor((opts.conScore - 10) / 2) },
        hp: { value: opts.hpValue, max: opts.hpMax, temp: 0 },
      },
    },
    items: [],
  };
  return new CharacterSheetVM({
    doc,
    actorId: "hero",
    ownership: 3,
    userId: "user-gm",
    isGm: true,
    worldId: "world-1",
  });
}

describe("restHpRecovery", () => {
  it("Tobias: CON +2, level 3 → +6 HP", () => {
    // CON 14 → mod +2; missing plenty of HP.
    const vm = makeCaster({ level: 3, conScore: 14, hpValue: 10, hpMax: 36 });
    expect(vm.restHpRecovery()).toBe(6);
  });

  it("negative CON mod still heals level HP (min 1 × level)", () => {
    // CON 8 → mod -1; min per-level is 1, so level 4 → +4.
    const vm = makeCaster({ level: 4, conScore: 8, hpValue: 1, hpMax: 40 });
    expect(vm.restHpRecovery()).toBe(4);
  });

  it("clamps to the HP actually missing", () => {
    // CON +2, level 3 → potential 6, but only 2 HP missing → +2.
    const vm = makeCaster({ level: 3, conScore: 14, hpValue: 34, hpMax: 36 });
    expect(vm.restHpRecovery()).toBe(2);
  });

  it("no recovery when already at full HP", () => {
    const vm = makeCaster({ level: 3, conScore: 14, hpValue: 36, hpMax: 36 });
    expect(vm.restHpRecovery()).toBe(0);
  });
});

describe("restAll — HP op + summary card", () => {
  it("emits an HP doc:update to the healed value + a chat summary", () => {
    const vm = makeCaster({ level: 3, conScore: 14, hpValue: 10, hpMax: 36 });
    const ops = vm.restAll();
    const hpOp = ops.find(
      (o) => o.type === "doc:update" && "diff" in o && (o.diff as Record<string, unknown>)["system.attributes.hp.value"] !== undefined,
    ) as { diff: Record<string, unknown> } | undefined;
    expect(hpOp).toBeDefined();
    expect(hpOp!.diff["system.attributes.hp.value"]).toBe(16); // 10 + 6

    const summary = ops.find((o) => o.type === "chat:send") as { content: string; speakerActorId: string } | undefined;
    expect(summary).toBeDefined();
    expect(summary!.speakerActorId).toBe("hero");
    expect(summary!.content).toContain("+6 PV");
  });

  it("full-HP actor with nothing to recover emits no ops (no summary)", () => {
    const vm = makeCaster({ level: 3, conScore: 14, hpValue: 36, hpMax: 36 });
    const ops = vm.restAll();
    // No spell slots, focus already full, HP full → nothing to do.
    expect(ops).toHaveLength(0);
  });
});
