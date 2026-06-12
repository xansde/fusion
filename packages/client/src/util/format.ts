/**
 * Pure formatting utilities for the Fusion client UI.
 *
 * These functions have no DOM/Svelte dependencies so they can be unit-tested
 * in a plain Node environment (Vitest, no browser).
 */

/**
 * Format a semver string + protocol version into a human-readable label.
 *
 * @example
 * formatVersion("0.1.0", 1) // => "v0.1.0 (protocol 1)"
 */
export function formatVersion(engineVersion: string, protocolVersion: number): string {
  return `v${engineVersion} (protocol ${String(protocolVersion)})`;
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Truncate a string to at most `maxLength` characters, appending an ellipsis
 * when truncation occurs.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
