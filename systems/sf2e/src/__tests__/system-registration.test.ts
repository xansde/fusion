/**
 * @fusion/system-sf2e — System registration tests (manifest slice).
 *
 * REQ-SYS-009 (spec 15, TK041/DEC-TOK-03): the sf2e manifest declares the
 * same size→footprint table as pf2e (both actor schemas share the
 * `traits.size` enum — see systems/sf2e/src/schemas/actor-*.ts).
 */

import { describe, it, expect } from "vitest";
import { sf2eSystem } from "../index.js";

describe("sf2eSystem manifest", () => {
  it("has id 'sf2e'", () => {
    expect(sf2eSystem.manifest.id).toBe("sf2e");
  });

  it("declares sizeToFootprint with Médio 1x1 and Grande 2x2 (REQ-SYS-009)", () => {
    expect(sf2eSystem.manifest.sizeToFootprint).toEqual({
      tiny: { width: 1, height: 1 },
      sm: { width: 1, height: 1 },
      med: { width: 1, height: 1 },
      lg: { width: 2, height: 2 },
      huge: { width: 3, height: 3 },
      grg: { width: 4, height: 4 },
    });
  });
});
