/**
 * Server-side validation of an Item that is about to be spliced into an
 * Actor's `items[]` array.
 *
 * WHY THIS MODULE EXISTS (and why it is not a copy of anything): embedded
 * Items are never written through DocumentStore.create/update — they live
 * inside the parent Actor's JSON — so nothing downstream ever validates
 * them. For a long time `handleEmbeddedCreate` (net/handlers/doc-handlers.ts)
 * was the ONLY code path that embedded an Item, and both rules below lived
 * inside it. `compendium:importToActor` (spec 43 §5.7, DEC-CPD-05) opened a
 * SECOND door to the very same array — one a plain PLAYER may walk through,
 * because the predicate there is OWNER of the destination actor, not the
 * caller's role. DEC-CPD-05 is explicit that this must not become a second
 * rulebook for the same gesture ("proibir na aba criaria duas regras para o
 * mesmo gesto"), so the two rules were lifted here and BOTH doors call them.
 *
 * Duplicating either predicate instead of importing it is what this module
 * exists to prevent.
 *
 * Spec: 43-aba-compendio.md §5.7 (REQ-CPD-061), 18-sistema-sf2e.md
 * (REQ-SF2-024, CA-SF2-05), 15-api-de-sistemas.md (REQ-SYS-011).
 */

import {
  validateAugmentationSlotLimit,
  AUGMENTATION_SLOT_LIMIT,
  AUGMENTATION_SLOT_LIMIT_I18N_KEY,
  type AugmentationLikeItem,
} from "@fusion/system-sf2e";
import type { SystemModule } from "@fusion/system-api";

/**
 * Successful validation of an embedded Item's `type` + `system` subtree
 * against the active system's registered data models (see
 * {@link validateEmbeddedItemForSystem}).
 */
export interface ItemSystemValidation {
  ok: true;
  /** The item with its `system` subtree replaced by the schema-parsed value
   *  (defaults applied, unknown keys stripped per the model's own schema). */
  doc: Record<string, unknown>;
}

export interface ItemSystemValidationError {
  ok: false;
  message: string;
}

/**
 * Validate an embedded Item document's `type` + `system` subtree against the
 * active system's registered data models (SystemModule.models, keyed
 * "Item:<subtype>" — see packages/system-api/src/system-module.ts).
 *
 * REQ-DOC (R10-C): closes the gap where embedded Item create/update
 * accepted arbitrary `system` payloads with zero schema validation. Rules:
 *   - `manifest.documentTypes.Item` is a CLOSED list: an item `type` not
 *     declared there is rejected (unknown subtype).
 *   - A declared subtype MUST have a registered SystemDataModel (guaranteed
 *     by validateSystemModule/REQ-SYS-011 as a CI gate on every system
 *     package, but we still guard defensively here rather than throw).
 *   - Only `system` is validated against the model's Zod schema — engine
 *     fields (name, ownership, ...) are already covered by DocumentStore's
 *     own schema on the primary Item path, and embedded Items are never
 *     written through DocumentStore.create/update directly (they're spliced
 *     into the parent Actor's `items[]` array), so this function is the only
 *     validation they ever get — on EVERY door into `items[]`.
 *
 * No systemModule available (systemId unset, stub system, or test deps that
 * don't wire one) → validation is skipped entirely (returns ok:true
 * unchanged), preserving the pre-R10-C behavior for callers that don't care.
 */
export function validateEmbeddedItemForSystem(
  systemModule: SystemModule | undefined,
  raw: Record<string, unknown>,
): ItemSystemValidation | ItemSystemValidationError {
  if (!systemModule) {
    return { ok: true, doc: raw };
  }

  const itemTypes = systemModule.manifest.documentTypes["Item"];
  if (!itemTypes) {
    // System doesn't declare any Item subtypes at all — nothing to validate
    // against; skip (defense-in-depth, should not happen for pf2e/sf2e).
    return { ok: true, doc: raw };
  }

  const subtype = typeof raw["type"] === "string" ? raw["type"] : undefined;
  if (!subtype || !itemTypes.includes(subtype)) {
    return {
      ok: false,
      message: `Unknown Item type "${String(raw["type"])}" for system "${systemModule.manifest.id}" (known types: ${itemTypes.join(", ")})`,
    };
  }

  const model = systemModule.models.get(`Item:${subtype}`);
  if (!model) {
    return {
      ok: false,
      message: `Item type "${subtype}" is declared by system "${systemModule.manifest.id}" but has no registered data model`,
    };
  }

  const systemData = raw["system"] ?? {};
  const result = model.schema.safeParse(systemData);
  if (!result.success) {
    return {
      ok: false,
      message: `Invalid system data for Item type "${subtype}": ${result.error.message}`,
    };
  }

  return { ok: true, doc: { ...raw, system: result.data } };
}

/**
 * SF2e augmentation slot-limit gate (REQ-SF2-024, CA-SF2-05) for one Item
 * about to join `existingItems`.
 *
 * Gated on the WORLD's systemId being "sf2e" (a world runs a single system
 * for all its actors — there is no per-Actor systemId field), so pf2e/other
 * worlds are entirely unaffected. `existingItems` must already include any
 * item accepted earlier in the SAME batch, so a single call that brings
 * several augmentations at once is capped too.
 *
 * @returns the message to report (ack message on the doc:create path, per-uuid
 *   `failed` reason on the compendium path), or `null` when the item passes.
 */
export function augmentationSlotLimitViolation(
  systemId: string | undefined,
  existingItems: readonly AugmentationLikeItem[],
  incoming: Record<string, unknown>,
): string | null {
  if (systemId !== "sf2e") return null;

  const check = validateAugmentationSlotLimit(existingItems, incoming);
  if (check.ok) return null;

  const i18nKey = check.i18nKey ?? AUGMENTATION_SLOT_LIMIT_I18N_KEY;
  return `${i18nKey}: actor already has ${String(check.currentNonApexCount)} non-apex augmentations installed (limit ${String(AUGMENTATION_SLOT_LIMIT)})`;
}
