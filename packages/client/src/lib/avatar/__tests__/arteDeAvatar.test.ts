import { describe, expect, it } from "vitest";
import { ehArteDeAvatar } from "../arteDeAvatar.js";

describe("ehArteDeAvatar", () => {
  it("recognises the names the avatar upload produces", () => {
    expect(ehArteDeAvatar("/assets/avatar-token-1a2b3c4d.png")).toBe(true);
    expect(ehArteDeAvatar("/assets/avatar-retrato-1a2b3c4d5e6f7a8b.png")).toBe(true);
  });

  it("ignores anything else", () => {
    expect(ehArteDeAvatar("/assets/goblin-1a2b3c4d.png")).toBe(false);
    expect(ehArteDeAvatar("/assets/meu-avatar-token-1a2b3c4d.png")).toBe(false);
    expect(ehArteDeAvatar(null)).toBe(false);
  });
});
