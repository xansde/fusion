/**
 * partyVM.ts — what the Mestre's party table lists, and the generic fallback it draws.
 *
 * Pure: no store, no DOM. The panel owns the mirror subscription; this owns the two decisions that
 * are testable on their own — which actors are "the party", and the hit points a card can show when
 * no game system registered a summary.
 */

import {
  isPlayerCharacter,
  ownerUserIdsOf,
  type ContactActorDoc,
} from "../contacts/contactsVM.js";

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
