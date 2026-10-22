/**
 * Which avatar belongs to the person looking at the screen.
 *
 * The corner overlay shows ONE avatar: the viewer's own character. Deciding
 * whose that is cannot use `resolveOwnedActorIds`, which is about permission and
 * hands a GM every actor in the world — the corner would then pick an arbitrary
 * NPC and call it "you".
 *
 * The rule is EXPLICIT ownership: the actor's ownership map names this user as
 * OWNER. That is the closest thing the data model has to "this is my character",
 * and it reads the same for a player and for a GM who happens to own a PC. A GM
 * who owns nothing explicitly simply gets no corner avatar, which is correct —
 * the GM does not have a character.
 *
 * Pure, so the rule is testable without a socket or a canvas.
 */

import { OwnershipLevel, readAvatarFlag, type AvatarFlag, type Ownership } from "@fusion/shared";

/** The slice of an Actor document this module needs. */
export interface AtorComAvatar {
  _id: string;
  name?: string;
  type?: string;
  ownership?: Ownership;
  flags?: unknown;
}

export interface AvatarDoUsuario {
  actorId: string;
  nome: string;
  avatar: AvatarFlag;
}

/** True when the ownership map names this user (not a default, not a role). */
export function possuiExplicitamente(ator: AtorComAvatar, userId: string): boolean {
  const nivel = ator.ownership?.[userId];
  return typeof nivel === "number" && nivel >= OwnershipLevel.OWNER;
}

/**
 * The avatar to show in the corner, or null.
 *
 * Ties break deterministically — characters before other actor types, then by
 * name, then by id — so two clients of the same user never disagree about which
 * avatar is "theirs".
 */
export function escolherAvatarDoUsuario(
  atores: readonly AtorComAvatar[],
  userId: string | null | undefined,
): AvatarDoUsuario | null {
  if (userId === null || userId === undefined || userId === "") return null;

  const candidatos = atores
    .filter((a) => possuiExplicitamente(a, userId))
    .map((a) => ({ ator: a, avatar: readAvatarFlag(a) }))
    .filter((c): c is { ator: AtorComAvatar; avatar: AvatarFlag } => c.avatar !== null);

  if (candidatos.length === 0) return null;

  candidatos.sort((a, b) => {
    const tipoA = a.ator.type === "character" ? 0 : 1;
    const tipoB = b.ator.type === "character" ? 0 : 1;
    if (tipoA !== tipoB) return tipoA - tipoB;
    const nomeA = a.ator.name ?? "";
    const nomeB = b.ator.name ?? "";
    return nomeA.localeCompare(nomeB, "pt-BR") || a.ator._id.localeCompare(b.ator._id);
  });

  const escolhido = candidatos[0];
  if (escolhido === undefined) return null;
  return {
    actorId: escolhido.ator._id,
    nome: escolhido.ator.name ?? "",
    avatar: escolhido.avatar,
  };
}
