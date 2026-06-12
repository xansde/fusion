/**
 * Result type — a typed alternative to throwing for expected error cases.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Unwrap a Result, throwing the error if it is an Err.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(
    `Attempted to unwrap an Err result: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
  );
}

// ---------------------------------------------------------------------------
// Common error shapes
// ---------------------------------------------------------------------------

export type ValidationErrorDetail = {
  path: string[];
  message: string;
};

export type FusionErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "PERMISSION_DENIED"
  | "DUPLICATE_ID"
  | "INTERNAL_ERROR";

export type FusionError = {
  code: FusionErrorCode;
  message: string;
  details?: ValidationErrorDetail[];
};

export function fusionError(
  code: FusionErrorCode,
  message: string,
  details?: ValidationErrorDetail[],
): FusionError {
  if (details !== undefined) {
    return { code, message, details };
  }
  return { code, message };
}
