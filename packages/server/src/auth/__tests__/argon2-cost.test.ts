/**
 * REQ-SEC-010 / DEC-USR-02 — the Argon2id cost a real install hashes with.
 *
 * The server test config sets FUSION_TEST_FAST_ARGON2=1 so the suite does not
 * spend most of its time inside Argon2 (every test file bootstraps users).
 * These tests pin the other side of that switch: outside vitest, or without the
 * opt-in, the production cost is the one used — and a hash made at the test
 * cost still verifies (the PHC string carries its own parameters).
 */
import { describe, it, expect } from "vitest";
import { argon2Options, hashPassword, verifyPassword } from "../crypto.js";

describe("REQ-SEC-010 — Argon2id cost", () => {
  it("a real install (no vitest) hashes at memory 64 MiB, 3 passes, parallelism 4 — even with the opt-in set", () => {
    for (const env of [{}, { FUSION_TEST_FAST_ARGON2: "1" }, { VITEST: "true" }]) {
      expect(argon2Options(env)).toMatchObject({ memoryCost: 65536, timeCost: 3, parallelism: 4 });
    }
  });

  it("only vitest plus the explicit opt-in lowers the cost", () => {
    const fast = argon2Options({ VITEST: "true", FUSION_TEST_FAST_ARGON2: "1" });
    expect(fast.memoryCost).toBeLessThan(65536);
  });

  it("the suite runs with the opt-in, and its hashes are still Argon2id and verify", async () => {
    expect(process.env["FUSION_TEST_FAST_ARGON2"]).toBe("1");
    const hash = await hashPassword("s3cret");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("s3cret", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
