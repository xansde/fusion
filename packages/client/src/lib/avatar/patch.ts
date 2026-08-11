/**
 * Building the `doc:update` diff that saves an avatar.
 *
 * Writing the new flag as-is does NOT work, and the failure is silent. The
 * server expands dot paths into nested objects and then DEEP MERGES them
 * (documents/merge.ts): a key the patch omits is preserved, never removed. So a
 * naive `{"flags.fusion.avatar": novoFlag}` would:
 *
 *   - keep a slot the player just unequipped (the old slot key survives), and
 *   - keep the previous piece's colours on the piece that replaced it (the old
 *     `cores` key survives under the new `id`),
 *
 * which reads as "the hat came back" and "the colour did not change" — the exact
 * class of bug that kept a dropped Lore skill alive in `system.derived` (see
 * docs/lessons.md).
 *
 * The fix is the same one the server uses internally (`prunedPatch`): make the
 * PATCH honest. Every key that existed before and is gone now comes back as an
 * explicit `null`, which inside a `flags` namespace already means deleteKey
 * (REQ-DOC-037). One patch, one write, one broadcast.
 *
 * This lives here rather than being imported from the server because the client
 * must not depend on @fusion/server (REQ-ARQ-003), and it is deliberately narrow:
 * it prunes the avatar's two nested levels (`selecao` and each piece's `cores`),
 * not arbitrary documents.
 */

import { AVATAR_FLAG_PATH, type AvatarFlag } from "@fusion/shared";

/** A patch value: the stored shape, with `null` where a key must be dropped. */
type EscolhaPodada = { id: string; cores?: Record<string, string | null> };

/**
 * The diff for a `doc:update` that stores `novo` over `anterior`.
 *
 * @param anterior The avatar currently on the document (null when there is none).
 * @param novo     The avatar to store, or null to remove it entirely.
 */
export function diffDoAvatar(
  anterior: AvatarFlag | null,
  novo: AvatarFlag | null,
): Record<string, unknown> {
  // Removing the avatar: one null at the flag root drops the whole subtree.
  if (novo === null) return { [AVATAR_FLAG_PATH]: null };

  const selecao: Record<string, EscolhaPodada | null> = {};

  for (const [slot, escolha] of Object.entries(novo.selecao)) {
    const antes = anterior?.selecao[slot];
    const cores = escolha.cores ?? {};
    const coresAntes = antes?.cores ?? {};

    const podadas: Record<string, string | null> = { ...cores };
    for (const canal of Object.keys(coresAntes)) {
      if (!(canal in cores)) podadas[canal] = null;
    }

    selecao[slot] =
      Object.keys(podadas).length === 0 ? { id: escolha.id } : { id: escolha.id, cores: podadas };
  }

  for (const slot of Object.keys(anterior?.selecao ?? {})) {
    if (!(slot in novo.selecao)) selecao[slot] = null;
  }

  const valor: Record<string, unknown> = {
    versao: novo.versao,
    corpo: novo.corpo,
    selecao,
  };
  // Omit rather than write undefined: socket.io's encoder and Zod treat a
  // missing key and an explicit undefined differently enough to be worth avoiding.
  if (novo.pin !== undefined) valor["pin"] = novo.pin;

  return { [AVATAR_FLAG_PATH]: valor };
}
