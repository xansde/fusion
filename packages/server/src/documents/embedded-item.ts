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
import { systemIncludes } from "@fusion/system-api";

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
 * Validate an Actor document's `system.currency` subtree against the active
 * system's registered `Actor:<subtype>` data model (I2, revisão adversarial
 * 3 — "a moeda do composto não tem efeito em runtime").
 *
 * SCOPE, deliberately narrow: this does NOT run the full Actor `system`
 * schema (unlike {@link validateEmbeddedItemForSystem} for Item) — the full
 * Actor schema has several fields with no `.default()` (abilities,
 * attributes, saves, perception in `CharacterSystemSchema`), so a full
 * `schema.safeParse` would reject the partial payloads most Actor
 * create/update call sites already send today, which is a much larger
 * change than this fix. Currency is the one field the revision flagged as
 * observably broken at runtime (`{credits:5}`, `{gp:5,...}` and the literal
 * string `"lixo"` were all accepted on a pf2e-sf2e Actor), and the one
 * safest to check in isolation — it has no cross-field dependency on the
 * rest of `system`. The rest of Actor `system` validation is tracked as a
 * follow-up (see `.fusion-build/sf2e-nivel3/mundo-misto/conserto-core.md`).
 *
 * No systemModule / no registered model / no `currency` field on the
 * model's schema / payload doesn't touch `currency` at all → skipped
 * (ok:true, unchanged) — same "degrade open, never invent a rule" posture
 * as the rest of this module.
 */
export function validateActorCurrencyForSystem(
  systemModule: SystemModule | undefined,
  raw: Record<string, unknown>,
): ItemSystemValidation | ItemSystemValidationError {
  if (!systemModule) return { ok: true, doc: raw };

  const system = raw["system"];
  if (!system || typeof system !== "object" || !("currency" in system)) {
    return { ok: true, doc: raw };
  }

  const subtype = typeof raw["type"] === "string" ? raw["type"] : undefined;
  if (!subtype) return { ok: true, doc: raw };

  const model = systemModule.models.get(`Actor:${subtype}`);
  type StrictableZodObject = {
    safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
    strict?: () => StrictableZodObject;
    removeDefault?: () => StrictableZodObject;
  };
  const shape = model?.schema as { shape?: Record<string, StrictableZodObject> } | undefined;
  const currencySchema = shape?.shape?.["currency"];
  if (!currencySchema) return { ok: true, doc: raw };

  // The registered field is `Pf2eCurrencySchema.default({})` /
  // `CreditsSchema.default(...)` — a `ZodDefault` wrapper, not a bare
  // `ZodObject`, so `.strict()` doesn't exist on it directly.
  // `.removeDefault()` unwraps to the underlying ZodObject first (the
  // currency VALUE we are validating is present here, by the `"currency"
  // in system` guard above, so no default needs to apply).
  const innerSchema = currencySchema.removeDefault?.() ?? currencySchema;
  // `.strict()` when available (the currency schemas are plain ZodObjects,
  // never `.passthrough()`): an unknown key (e.g. `credits` sent to the
  // pf2e-shaped pp/gp/sp/cp schema) must be REJECTED, not silently dropped —
  // a lenient `.safeParse` would strip it and "pass" with an all-zero
  // wallet, hiding exactly the bug I2 reported (SF2e-shaped currency
  // accepted on a pf2e/pf2e-sf2e Actor).
  const strictSchema = innerSchema.strict?.() ?? innerSchema;
  const currencyValue = (system as Record<string, unknown>)["currency"];
  const result = strictSchema.safeParse(currencyValue);
  if (!result.success) {
    return {
      ok: false,
      message: `Invalid system.currency for Actor type "${subtype}" on system "${systemModule.manifest.id}": ${result.error?.message ?? "validation failed"}`,
    };
  }

  return {
    ok: true,
    doc: { ...raw, system: { ...(system as Record<string, unknown>), currency: result.data } },
  };
}

/**
 * SF2e augmentation slot-limit gate (REQ-SF2-024, CA-SF2-05) for one Item
 * about to join `existingItems`.
 *
 * Gated on the world's system INCLUDING sf2e (`systemIncludes`, I4) — the
 * literal sf2e system, or the pf2e+sf2e composite (DEC-SYS-06-bis), so
 * pf2e-only worlds are entirely unaffected while the composite keeps the
 * limit. `existingItems` must already include any item accepted earlier in
 * the SAME batch, so a single call that brings several augmentations at once
 * is capped too.
 *
 * @returns the message to report (ack message on the doc:create path, per-uuid
 *   `failed` reason on the compendium path), or `null` when the item passes.
 */
export function augmentationSlotLimitViolation(
  system: { systemId?: string | undefined; sourceSystemIds?: readonly string[] | undefined },
  existingItems: readonly AugmentationLikeItem[],
  incoming: Record<string, unknown>,
): string | null {
  if (!systemIncludes(system, "sf2e")) return null;

  const check = validateAugmentationSlotLimit(existingItems, incoming);
  if (check.ok) return null;

  const i18nKey = check.i18nKey ?? AUGMENTATION_SLOT_LIMIT_I18N_KEY;
  return `${i18nKey}: actor already has ${String(check.currentNonApexCount)} non-apex augmentations installed (limit ${String(AUGMENTATION_SLOT_LIMIT)})`;
}
