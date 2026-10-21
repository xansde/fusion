/**
 * ownPasswordForm.ts — the pure rules of the "change my password" form in "Minhas preferências"
 * (spec 37 REQ-CFG-090, spec 05 REQ-USR-040..042). The request is `usersApi.changeOwnPassword`; the
 * server (`POST /api/users/me/password`) is the authority and enforces the same floor, so this only
 * saves the player a round trip and gives the failure a human sentence.
 */

import { UsersApiError } from "./usersApi.js";

/** Same floor as the server's `ChangeOwnPasswordBodySchema` (provisional decision of 2026-10-21). */
export const MIN_NEW_PASSWORD_LENGTH = 8;

const KEY = "FUSION.Settings.Preferences.Password";

export interface OwnPasswordFormValues {
  /** Empty for a user who has no password yet (the server only demands it when one exists). */
  current: string;
  next: string;
  confirm: string;
}

/** The i18n key of the first problem with the form, or `null` when it can be sent. */
export function validateOwnPasswordForm(values: OwnPasswordFormValues): string | null {
  if (values.next.length < MIN_NEW_PASSWORD_LENGTH) return `${KEY}.TooShort`;
  if (values.next !== values.confirm) return `${KEY}.Mismatch`;
  return null;
}

/** The i18n key that explains a failed request. */
export function ownPasswordFailureKey(err: unknown): string {
  if (err instanceof UsersApiError) {
    if (err.code === "INVALID_CREDENTIALS") return `${KEY}.WrongCurrent`;
    if (err.code === "LOCKED_OUT") return `${KEY}.LockedOut`;
  }
  return `${KEY}.Failed`;
}
