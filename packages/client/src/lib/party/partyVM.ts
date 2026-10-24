/**
 * partyVM.ts — what the Mestre's party table lists, and the generic fallback it draws.
 *
 * Pure: no store, no DOM. The panel owns the mirror subscription; this owns the two decisions that
 * are testable on their own — which actors are "the party", and the hit points a card can show when
 * no game system registered a summary.
 */

import { isPlayerCharacter, ownerUserIdsOf, type ContactActorDoc } from "../contacts/contactsVM.js";

/**
 * The player characters, sorted by name: an Actor of a player-character subtype that at least one
 * user other than the viewer owns. The viewer is excluded because the Mestre owns whatever he
 * created; a character only he owns is not a player's.
 */
export function selectPartyActors<T extends ContactActorDoc>(
  actors: readonly T[],
  viewerUserId: string,
): T[] {
  return actors
    .filter(
      (doc) =>
        isPlayerCharacter(doc) && ownerUserIdsOf(doc).some((owner) => owner !== viewerUserId),
    )
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pt-BR"));
}

function readHp(source: unknown): { value: number; max: number } | null {
  if (typeof source !== "object" || source === null) return null;
  const hp = (source as Record<string, unknown>)["hp"];
  if (typeof hp !== "object" || hp === null) return null;
  const { value, max } = hp as Record<string, unknown>;
  if (typeof value !== "number" || typeof max !== "number") return null;
  return { value, max };
}

/**
 * Hit points as a document carries them, for a card with no system summary: `system.derived.hp`
 * first (what the server computes), then `system.attributes.hp`, else `null`.
 */
export function genericHp(doc: {
  readonly system?: Record<string, unknown> | undefined;
}): { value: number; max: number } | null {
  const system = doc.system;
  if (!system) return null;
  return readHp(system["derived"]) ?? readHp(system["attributes"]);
}

/**
 * Whether the Mestre's party strip is drawn: only for the Mestre, and only while the action bar is
 * not (the bar publishes its height, 0 when it draws nothing) — they share the centre-bottom.
 */
export function shouldShowPartyStrip(isGm: boolean, actionBarHeight: number): boolean {
  return isGm && !(actionBarHeight > 0);
}

/** Air kept between the summary popover and the strip, and from the window edges. */
const POPOVER_GAP = 6;
const POPOVER_EDGE = 8;

/**
 * Where the summary popover of a chip goes: centred on the chip, above the strip, inside the window.
 * `bottom` is measured from the bottom edge of the window (the popover is `position: fixed`).
 */
export function placePartyPopover(
  chip: { left: number; width: number },
  strip: { top: number },
  popoverWidth: number,
  view: { width: number; height: number },
): { left: number; bottom: number; maxHeight: number } {
  const centred = chip.left + chip.width / 2 - popoverWidth / 2;
  const left = Math.max(POPOVER_EDGE, Math.min(centred, view.width - popoverWidth - POPOVER_EDGE));
  return {
    left,
    bottom: view.height - strip.top + POPOVER_GAP,
    maxHeight: Math.max(0, strip.top - POPOVER_EDGE),
  };
}
