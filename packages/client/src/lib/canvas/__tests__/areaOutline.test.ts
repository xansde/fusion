import { describe, it, expect } from "vitest";
import { boundaryEdges } from "../RulerLayer.js";
import { tokenPingLabel } from "../PingLayer.js";

describe("boundaryEdges", () => {
  it("a single square has four edges", () => {
    expect(boundaryEdges([{ i: 0, j: 0 }])).toHaveLength(4);
  });
  it("two adjacent squares share no inner edge (6 outer edges)", () => {
    expect(
      boundaryEdges([
        { i: 0, j: 0 },
        { i: 1, j: 0 },
      ]),
    ).toHaveLength(6);
  });
  it("a ring of 8 around a hole keeps the inner edges of the hole", () => {
    const cells = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) cells.push({ i, j });
    expect(boundaryEdges(cells)).toHaveLength(12 + 4);
  });
});

describe("tokenPingLabel", () => {
  it("names the token after the pinger", () => {
    expect(tokenPingLabel("Mestre", "Huo Jinwu")).toBe("Mestre · Huo Jinwu");
    expect(tokenPingLabel(undefined, "Goblin")).toBe("Goblin");
    expect(tokenPingLabel("Mestre", undefined)).toBe("");
  });
});
