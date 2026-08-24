/**
 * calibration.mjs — labelKey assignment for known granting feats.
 *
 * `GRANTED_FEAT_CHOICES` in packages/client/src/systems/pf2e/lib/sheets/pf2e/planVM.ts is
 * keyed by `nameToSlug(grantingFeat.name)` (e.g. "basic concoction") and
 * carries a `labelKey` used by the Plan column's i18n for the sub-slot's
 * label. The mechanics overlay must reproduce the SAME labelKey for the
 * calibration set so track C's `grantFromMechanics` adapter can swap the
 * hardcoded table for the overlay without changing the label the player
 * sees.
 *
 * This map is deliberately small and hand-maintained: it only covers docs
 * that ALREADY have a hardcoded entry in planVM.ts (the paritydoc/test
 * subject). Everything else gets no labelKey (client falls back to
 * SLOT_TYPE_LABELS.grantedFeat, same as any newly-discovered grant would
 * until a labelKey is curated for it).
 */

/**
 * nameToSlug — mirrors planVM.ts's own `nameToSlug` EXACTLY:
 *   `name?.trim().toLowerCase() || undefined;`
 * (packages/client/src/systems/pf2e/lib/sheets/pf2e/planVM.ts:526). Kept in sync
 * manually; mechanics-parity.test.mjs asserts this against the live file.
 */
export function nameToSlug(name) {
  const slug = name?.trim().toLowerCase();
  return slug || undefined;
}

/** slug (nameToSlug of the granting feat's name) -> labelKey, matching GRANTED_FEAT_CHOICES in planVM.ts. */
export const LABEL_KEYS_BY_GRANTING_FEAT_SLUG = {
  "basic concoction": "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
};

/**
 * Mutates `entries` (the mechanics overlay's entries map) in place, stamping
 * `labelKey` onto any grant whose owning doc's name matches a calibrated
 * slug. No-op for docs outside the calibration set.
 *
 * @param {Record<string, {grants: object[]}>} entries
 * @param {object[]} docs - the pack's raw docs (for id -> name lookup).
 */
export function applyLabelKeys(entries, docs) {
  const nameById = new Map(docs.map((d) => [d._id, d.name]));

  for (const [docId, entry] of Object.entries(entries)) {
    const slug = nameToSlug(nameById.get(docId));
    const labelKey = slug ? LABEL_KEYS_BY_GRANTING_FEAT_SLUG[slug] : undefined;
    if (!labelKey) continue;
    for (const grant of entry.grants) {
      grant.labelKey = labelKey;
    }
  }
}
