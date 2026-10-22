/**
 * actor-image-history.ts — the server keeps an Actor's PREVIOUS `img`.
 *
 * Incident (mesa real, 18/10): seconds after the avatar creator's "Usar como
 * token" set Bhrotto's `img` to the avatar PNG, a second write from the same
 * player set it to "" (the sheet's portrait "remove" button is the only writer
 * of an empty `img`). The original token art was unrecoverable from the UI.
 *
 * The memory lives here, in the doc:update handler, because every writer passes
 * through it — the creator, the sheet's FilePicker and its remove button alike —
 * and the client cannot be trusted to remember on its own behalf.
 *
 * Rules (pinned by __tests__/actor-img-history.test.ts):
 *   - only a REAL change of `img` is remembered (a write that omits img or
 *     rewrites the same value leaves the memory untouched);
 *   - only a NON-BLANK previous image is remembered, so blanking twice in a row
 *     keeps the last real image instead of overwriting it with "";
 *   - the memory is server-owned: a client value for it in the diff is dropped.
 *
 * Restoring is then a plain `{ img: <remembered> }` write, which remembers the
 * image it replaced — restore toggles, it never loses the newer image.
 */

import { AVATAR_FLAG_SCOPE, IMAGEM_ANTERIOR_FLAG_KEY } from "@fusion/shared";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Drop a client-supplied memory value from an EXPANDED diff (returns a new object when it changes). */
function semMemoriaDoCliente(diff: Record<string, unknown>): Record<string, unknown> {
  const flags = diff["flags"];
  if (!isRecord(flags)) return diff;
  const scope = flags[AVATAR_FLAG_SCOPE];
  if (!isRecord(scope) || !(IMAGEM_ANTERIOR_FLAG_KEY in scope)) return diff;
  const novoScope = { ...scope };
  Reflect.deleteProperty(novoScope, IMAGEM_ANTERIOR_FLAG_KEY);
  return { ...diff, flags: { ...flags, [AVATAR_FLAG_SCOPE]: novoScope } };
}

/**
 * The expanded diff to persist, with `flags.fusion.imagemAnterior` set to the
 * image being replaced when this write really changes a non-blank `img`.
 */
export function lembrarImagemAnterior(
  existing: Record<string, unknown>,
  expandedDiff: Record<string, unknown>,
): Record<string, unknown> {
  const diff = semMemoriaDoCliente(expandedDiff);
  if (!("img" in diff)) return diff;
  const anterior = existing["img"];
  if (typeof anterior !== "string" || anterior.trim() === "") return diff;
  if (diff["img"] === anterior) return diff;

  const flags = isRecord(diff["flags"]) ? diff["flags"] : {};
  const scope = isRecord(flags[AVATAR_FLAG_SCOPE]) ? flags[AVATAR_FLAG_SCOPE] : {};
  return {
    ...diff,
    flags: { ...flags, [AVATAR_FLAG_SCOPE]: { ...scope, [IMAGEM_ANTERIOR_FLAG_KEY]: anterior } },
  };
}
