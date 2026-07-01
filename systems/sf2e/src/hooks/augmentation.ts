/**
 * @fusion/system-sf2e — Augmentation slot-limit validation.
 *
 * REQ-SF2-024 [MVP], CA-SF2-05: an actor may not have more than 4 non-apex
 * augmentations installed. Apex augmentations (`system.isApex === true`) do
 * NOT count toward this limit — an actor can freely stack apex augmentations
 * alongside up to 4 regular ones.
 *
 * This module is PURE (no I/O, no server/store imports) so it can be unit
 * tested in isolation and reused from any call site that needs to validate
 * an augmentation-add before persisting it.
 *
 * IMPORTANT — wiring note (audit fix, M4 batch):
 * The system-api "hook bus" (`packages/system-api/src/hooks.ts`, `HookBus`
 * with `preCreate`/`preUpdate`/`preDelete`) is NOT invoked anywhere in the
 * real server request path. `SystemModule` (system-module.ts) has no `hooks`
 * field, and `doc-handlers.ts` never imports `@fusion/system-api` — it is
 * the exact same "well-designed but disconnected" gap already known for the
 * derive pipeline. Wiring this validation through the dead hook bus would
 * make it dead code too (proven by 4 non-apex augmentations passing +
 * unbounded creation succeeding in a real doc:create round-trip).
 *
 * Instead, `validateAugmentationSlotLimit` below is called directly from
 * `packages/server/src/net/handlers/doc-handlers.ts` inside
 * `handleEmbeddedCreate`, the ONLY place embedded Item creation on an Actor
 * actually happens in production — see the call site there for the system-id
 * gate (only applied when the parent Actor's system is "sf2e") and the
 * VALIDATION_FAILED ack shape.
 *
 * Clean-room: spec 18 REQ-SF2-023..024, CA-SF2-05.
 */

/** Maximum number of non-apex augmentations an actor may have installed. */
export const AUGMENTATION_SLOT_LIMIT = 4;

/** i18n key returned to the client when the slot limit is exceeded. */
export const AUGMENTATION_SLOT_LIMIT_I18N_KEY = "sf2e.augmentation.slotLimit";

/**
 * Minimal shape of an embedded Item needed to evaluate the augmentation
 * slot limit. Matches the subset of the ItemSchema / AugmentationSystemSchema
 * relevant here — callers pass in whatever embedded items already exist on
 * the parent Actor (e.g. `actorDoc.items`).
 */
export interface AugmentationLikeItem {
  type?: string;
  system?: {
    isApex?: boolean;
    [key: string]: unknown;
  } | null;
}

export interface AugmentationSlotCheckResult {
  ok: boolean;
  /** Count of non-apex augmentations already installed (before the new one). */
  currentNonApexCount: number;
  /** Present only when ok === false. */
  i18nKey?: string;
}

/**
 * Count non-apex augmentation items in a collection of embedded items.
 * `isApex` defaults to false (matches AugmentationSystemSchema's default),
 * so an augmentation item missing the field counts as regular/non-apex.
 */
export function countNonApexAugmentations(items: readonly AugmentationLikeItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type !== "augmentation") continue;
    const isApex = item.system?.isApex === true;
    if (!isApex) count++;
  }
  return count;
}

/**
 * Validate whether a new augmentation item can be added to an actor given
 * its currently-installed embedded items.
 *
 * Apex augmentations never trigger rejection — the limit only applies when
 * the incoming item is a non-apex augmentation AND the actor already has
 * AUGMENTATION_SLOT_LIMIT non-apex augmentations installed.
 */
export function validateAugmentationSlotLimit(
  existingItems: readonly AugmentationLikeItem[],
  incoming: AugmentationLikeItem,
): AugmentationSlotCheckResult {
  const currentNonApexCount = countNonApexAugmentations(existingItems);

  if (incoming.type !== "augmentation") {
    return { ok: true, currentNonApexCount };
  }

  const incomingIsApex = incoming.system?.isApex === true;
  if (incomingIsApex) {
    return { ok: true, currentNonApexCount };
  }

  if (currentNonApexCount >= AUGMENTATION_SLOT_LIMIT) {
    return { ok: false, currentNonApexCount, i18nKey: AUGMENTATION_SLOT_LIMIT_I18N_KEY };
  }

  return { ok: true, currentNonApexCount };
}
