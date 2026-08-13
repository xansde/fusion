/**
 * heritageFilter.ts — which heritages the ABC picker offers for an ancestry.
 *
 * Pure TS, no Svelte, for the same reason `tokenConfigForm.ts` is: the picker
 * dialog cannot be mounted in this repo's test setup, so an inline filter is
 * a predicate nothing can test — and it had already been wrong once (see
 * below) without anything failing.
 *
 * A heritage names its ancestry at `system.ancestry.slug` (mirrored in the
 * pack index). A VERSATILE heritage — Aiuvarin, Changeling, Dhampir,
 * Dragonblood, Dromaar, Duskwalker, Nephilim in the Remaster core — carries
 * `ancestry: null` and may be taken by ANY ancestry (Player Core, "Versatile
 * Heritages"). The previous inline filter required a string equality, which
 * offered the versatile seven to nobody.
 */

/**
 * `indexSlug` is the raw `system.ancestry.slug` value from the pack index:
 * a string for an ancestry-specific heritage, null/absent for a versatile
 * one. Anything else is malformed data and matches nothing.
 */
export function heritageMatchesAncestry(indexSlug: unknown, ancestrySlug: string): boolean {
  if (indexSlug === null || indexSlug === undefined) return true;
  return typeof indexSlug === "string" && indexSlug === ancestrySlug;
}
