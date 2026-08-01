/**
 * portrait.ts — pure helpers for the circular actor portrait fallback
 * (r19-W4). Kept framework-free so the fallback logic (initials, deterministic
 * color, placeholder detection) is unit-testable without a DOM or Svelte —
 * ActorPortrait.svelte is a thin shell over these (repo convention: logic in
 * .ts, rendering in .svelte).
 *
 * The fallback exists because imported actors frequently carry a proprietary
 * art stub as `img` (e.g. "icons/placeholder/npc.svg" — Paizo art is stripped
 * clean-room, see CLAUDE.md), which is NOT served by our /assets/ route and
 * would render as a broken-image icon. Rather than show that, we paint a
 * colored circle with the actor's initials.
 */

/**
 * Curated fallback palette — deep, saturated jewel tones that read well on the
 * dark theme (--fusion-bg #0e0e12) with white initials. The first entry is the
 * design-system accent so an unnamed/empty actor still lands on brand.
 */
export const PORTRAIT_PALETTE: readonly string[] = [
  "#7c5cfc", // violet (design-system accent)
  "#4c84e0", // blue
  "#2fa968", // green
  "#b8862a", // bronze / gold
  "#d0574e", // coral red
  "#9b59c4", // purple
  "#2a9d9d", // teal
  "#c56a2e", // orange
];

/**
 * Up to two UPPERCASE initials for a display name:
 *   - empty / whitespace-only → "?"
 *   - single word            → its first two letters ("Finn" → "FI")
 *   - two or more words       → first letter of the first + first of the last
 *     ("Tobias Grimwald" → "TG", "Ana Maria Braz" → "AB")
 */
export function portraitInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    return (words[0] ?? "").slice(0, 2).toUpperCase();
  }
  const first = words[0]?.[0] ?? "";
  const last = words[words.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

/**
 * Deterministic name → palette color. The same name always maps to the same
 * color (so an actor keeps its identity across renders), and different names
 * spread across the palette. Empty/absent names get the first (accent) color.
 */
export function portraitColor(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (key === "") return PORTRAIT_PALETTE[0] ?? "";
  // Simple, stable string hash (djb2-ish, kept in 32-bit range).
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PORTRAIT_PALETTE.length;
  return PORTRAIT_PALETTE[idx] ?? "";
}

/**
 * True when a stored `img` path can never resolve to a real portrait and the
 * caller should skip straight to the initials fallback (no network attempt):
 *   - empty / null / whitespace
 *   - any path containing "placeholder"
 *   - a bare relative art stub ("icons/…", "systems/…", "modules/…") — these
 *     are proprietary/compendium icons, never served by our /assets/ route,
 *     so an <img> would 404 (this is the "Finn portrait broken" bug).
 *
 * Real portraits are either our own "/assets/<name>" uploads, external
 * http(s) URLs, or data: URIs — none of which match here, so they attempt to
 * load and only fall back on an actual load error (onerror).
 */
export function isPortraitPlaceholder(img: string | null | undefined): boolean {
  if (!img) return true;
  const p = img.trim().toLowerCase();
  if (p === "") return true;
  if (p.includes("placeholder")) return true;
  if (p.startsWith("icons/")) return true;
  if (p.startsWith("systems/")) return true;
  if (p.startsWith("modules/")) return true;
  return false;
}
