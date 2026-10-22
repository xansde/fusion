/**
 * ownPasswordForm.test.ts — the pure rules of the "change my password" form
 * (spec 37 REQ-CFG-090, spec 05 REQ-USR-040).
 */

import { describe, expect, it } from "vitest";
import {
  MIN_NEW_PASSWORD_LENGTH,
  ownPasswordFailureKey,
  validateOwnPasswordForm,
} from "../ownPasswordForm.js";
import { UsersApiError } from "../usersApi.js";

describe("validateOwnPasswordForm", () => {
  it("accepts a new password that is long enough and confirmed", () => {
    expect(
      validateOwnPasswordForm({ current: "old", next: "long-enough-1", confirm: "long-enough-1" }),
    ).toBeNull();
  });

  it("accepts an empty current password (a user with no password yet has none to give)", () => {
    expect(
      validateOwnPasswordForm({ current: "", next: "long-enough-1", confirm: "long-enough-1" }),
    ).toBeNull();
  });

  it("refuses a new password shorter than the floor the server also enforces", () => {
    const short = "x".repeat(MIN_NEW_PASSWORD_LENGTH - 1);
    expect(validateOwnPasswordForm({ current: "old", next: short, confirm: short })).toBe(
      "FUSION.Settings.Preferences.Password.TooShort",
    );
  });

  it("refuses a confirmation that differs", () => {
    expect(
      validateOwnPasswordForm({ current: "old", next: "long-enough-1", confirm: "long-enough-2" }),
    ).toBe("FUSION.Settings.Preferences.Password.Mismatch");
  });

  it("the floor is 8, the same as the server's schema", () => {
    expect(MIN_NEW_PASSWORD_LENGTH).toBe(8);
  });
});

describe("ownPasswordFailureKey", () => {
  it("maps a wrong current password to its own message", () => {
    expect(ownPasswordFailureKey(new UsersApiError("INVALID_CREDENTIALS", "x"))).toBe(
      "FUSION.Settings.Preferences.Password.WrongCurrent",
    );
  });

  it("maps the lockout to a wait-and-retry message", () => {
    expect(ownPasswordFailureKey(new UsersApiError("LOCKED_OUT", "x"))).toBe(
      "FUSION.Settings.Preferences.Password.LockedOut",
    );
  });

  it("anything else is the generic failure", () => {
    expect(ownPasswordFailureKey(new UsersApiError("VALIDATION_FAILED", "x"))).toBe(
      "FUSION.Settings.Preferences.Password.Failed",
    );
    expect(ownPasswordFailureKey(new TypeError("fetch failed"))).toBe(
      "FUSION.Settings.Preferences.Password.Failed",
    );
  });
});
