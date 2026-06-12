/**
 * Formula validator — thin wrapper over @dice-roller/rpg-dice-roller.
 *
 * REQ-ROL-021..023: client can validate/preview a formula without executing RNG.
 * D1 (spec 08): parsing in packages/shared; execution exclusively on server.
 *
 * This module MUST NOT generate random numbers.
 * It only validates syntax and provides a preview of the formula structure.
 */

import { Parser } from "@dice-roller/rpg-dice-roller";

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface FormulaValidationResult {
  valid: boolean;
  /** Human-readable error message if invalid. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants — REQ-ROL-052: max 10 000 dice per roll (DoS protection)
// ---------------------------------------------------------------------------

/**
 * Maximum number of individual dice results allowed per formula evaluation.
 * REQ-ROL-052.
 */
export const MAX_DICE_PER_ROLL = 10_000;

// ---------------------------------------------------------------------------
// @attr substitution helper — REQ-ROL-014..015
// ---------------------------------------------------------------------------

/**
 * Resolve `@attr.path` references in a formula using the provided data object.
 * Unresolved references are substituted with `0`.
 *
 * This runs on the SERVER before parsing (REQ-ROL-015).
 * The function is exported from shared so the server can import it directly.
 *
 * @param formula Raw formula string, may contain `@path.to.attr` references.
 * @param data Roll data object (e.g. actor data snapshot).
 * @returns Expanded formula string with all `@...` replaced.
 */
export function replaceFormulaData(
  formula: string,
  data: Record<string, unknown>,
): { expanded: string; warnings: string[] } {
  const warnings: string[] = [];
  const expanded = formula.replace(/@([\w.]+)/g, (_match, path: string) => {
    const value = resolvePath(data, path);
    if (value === undefined || value === null) {
      warnings.push(`Unresolved @${path} — substituted with 0`);
      return "0";
    }
    if (typeof value !== "number" && typeof value !== "string") {
      warnings.push(`@${path} is not a number — substituted with 0`);
      return "0";
    }
    return String(value);
  });
  return { expanded, warnings };
}

/** Resolve a dot-path key against a nested object. */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Strip flavor suffix — REQ-ROL-013
// ---------------------------------------------------------------------------

/**
 * Extract the `# flavor text` from a formula string.
 * Returns the cleaned formula and flavor text separately.
 */
export function extractFlavor(formula: string): { formula: string; flavor?: string } {
  const idx = formula.indexOf("#");
  if (idx === -1) return { formula: formula.trim() };
  const flavorText = formula.slice(idx + 1).trim();
  if (!flavorText) {
    return { formula: formula.slice(0, idx).trim() };
  }
  return {
    formula: formula.slice(0, idx).trim(),
    flavor: flavorText,
  };
}

// ---------------------------------------------------------------------------
// Validation — REQ-ROL-021..023
// ---------------------------------------------------------------------------

/**
 * Validate a dice formula string without rolling.
 * Safe to call on the client.
 *
 * The formula MUST already have `@attr` references resolved before calling
 * this (use `replaceFormulaData` first, or ensure no `@attr` present).
 *
 * REQ-ROL-021: lançar RollParseError with position on invalid formula.
 * REQ-ROL-023: parse on client returns FormulaValidationResult, no RNG.
 */
export function validateFormula(formula: string): FormulaValidationResult {
  // Strip flavor suffix before parsing
  const { formula: cleanFormula } = extractFlavor(formula);

  if (!cleanFormula) {
    return { valid: false, error: "Empty formula" };
  }

  // Check for unresolved @attr references (client can't resolve them)
  if (/@[\w.]+/.test(cleanFormula)) {
    // We allow @attr in the raw formula on client — just mark it as valid
    // since the server will resolve them. Only flag truly malformed ones.
    // A formula that's only @attr with no dice is still valid structurally.
  }

  try {
    Parser.parse(cleanFormula);
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: message,
    };
  }
}

/**
 * Validate a formula and also check the dice count limit.
 * The count estimation is conservative (parses top-level NdX patterns).
 * The server does a more precise check during execution.
 */
export function validateFormulaWithLimits(formula: string): FormulaValidationResult {
  const base = validateFormula(formula);
  if (!base.valid) return base;

  const estimatedDice = estimateDiceCount(formula);
  if (estimatedDice > MAX_DICE_PER_ROLL) {
    return {
      valid: false,
      error: `Formula would produce more than ${String(MAX_DICE_PER_ROLL)} dice results. Got an estimate of ${String(estimatedDice)}.`,
    };
  }

  return { valid: true };
}

/**
 * Conservatively estimate the number of dice in a formula.
 * Looks for NdX patterns and sums N values.
 * Used client-side as a fast pre-check; server does authoritative counting.
 */
export function estimateDiceCount(formula: string): number {
  const { formula: clean } = extractFlavor(formula);
  let total = 0;
  // Match patterns like 4d6, 100d20, 1d(...)
  const pattern = /(\d+)\s*d/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    total += parseInt(match[1] ?? "0", 10);
  }
  return total;
}
