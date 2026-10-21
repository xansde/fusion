/**
 * escrita.ts — an AWAITABLE primary `doc:update` of one Actor, with `expectedVersion`.
 *
 * The server refuses a player's primary write that does not carry
 * `expectedVersion` ("expectedVersion is required for Actor/<id>"). The avatar
 * code came from a line without that gate and sent the diff bare, so the save
 * died with "o servidor recusou salvar". `makeSendOpFn` fills the version but is
 * fire-and-forget; the creator needs to know the write landed (it reports it and
 * chains a second write after it), so this helper fills the version itself and
 * resolves on the ack.
 *
 * Two writes in a row (save the avatar, then "Usar como token") would race the
 * broadcast that updates the mirror, so the version the previous ack confirmed is
 * remembered and the higher of it and the mirror's wins. One STALE_WRITE is
 * retried with the freshest version.
 */

import type { Socket } from "socket.io-client";
import type { DocumentMirror } from "../docs/DocumentMirror.js";
import { OpError, sendOp } from "../docs/sendOp.js";
import { worldMirror } from "../docs/worldSync.js";

/** Versions this client's own acks confirmed, by actor id. */
const versoesConfirmadas = new Map<string, number>();

/** TEST-ONLY. */
export function _resetEscritaParaTestes(): void {
  versoesConfirmadas.clear();
}

function versaoConhecida(actorId: string, mirror: DocumentMirror): number | undefined {
  const doc = mirror.getDoc<Record<string, unknown>>("Actor", actorId);
  const stats = doc?.["_stats"] as Record<string, unknown> | undefined;
  const doEspelho = typeof stats?.["version"] === "number" ? stats["version"] : undefined;
  const confirmada = versoesConfirmadas.get(actorId);
  if (doEspelho === undefined) return confirmada;
  return confirmada === undefined ? doEspelho : Math.max(doEspelho, confirmada);
}

function lembrar(actorId: string, result: unknown): void {
  const docs = (result as { documents?: Array<Record<string, unknown>> } | undefined)?.documents;
  const doc = docs?.find((d) => d["_id"] === actorId);
  const stats = doc?.["_stats"] as Record<string, unknown> | undefined;
  if (typeof stats?.["version"] === "number") versoesConfirmadas.set(actorId, stats["version"]);
}

export async function atualizarAtor(
  socket: Socket,
  actorId: string,
  diff: Record<string, unknown>,
  mirror: DocumentMirror = worldMirror,
): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    const expectedVersion = versaoConhecida(actorId, mirror);
    try {
      const result = await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Actor",
          updates: [
            { _id: actorId, diff, ...(expectedVersion === undefined ? {} : { expectedVersion }) },
          ],
        },
      });
      lembrar(actorId, result);
      return;
    } catch (erro) {
      const obsoleta = erro instanceof OpError && erro.code === "STALE_WRITE";
      if (!obsoleta || tentativa >= 1) throw erro;
      // The confirmed version we remembered is what went stale: drop it so the
      // retry reads whatever the mirror caught up to.
      versoesConfirmadas.delete(actorId);
    }
  }
}
