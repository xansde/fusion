/**
 * tokenController.ts — patching a token that already lives in a scene.
 *
 * Pure TS, no Svelte, no PIXI — safe for Vitest.
 *
 * The wire shape here is the whole point. A token is an EMBEDDED document, and
 * the server addresses embedded documents by the pair
 * `{ documentType: "Token", embedded: { type: "Token", id: sceneId } }` —
 * the same form `tileController.updateTile` uses for tiles and
 * `TokenInteractionManager` uses for drag and hidden-toggle.
 *
 * The alternative shape — a SCENE `doc:update` carrying a
 * `tokens.<tokenId>.<field>` dot-path (what `tokenDiffPath` builds) — is NOT
 * accepted by the server: its deep-merge engine turns `tokens` into an object
 * keyed by id, and `SceneSchema` then rejects the whole op with
 * `VALIDATION_FAILED: tokens: Expected array, received object`. That is not a
 * theory — `token-display-bars-e2e.test.ts` in the server package sends both
 * and asserts which one the server takes. `tokenDiffPath` remains valid for the
 * client's own OPTIMISTIC local merge; it is not a wire format.
 */

import type { Socket } from "socket.io-client";
import type { TokenDocument } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

/** A partial patch over a token's own fields. */
export type TokenPatch = Partial<Record<keyof TokenDocument, unknown>>;

/**
 * Patch any subset of a token's fields inside `sceneId`.
 *
 * Permission is the server's call (OWNER on the parent scene, or a privileged
 * role); this only builds the op.
 */
export async function updateToken(
  socket: Socket,
  sceneId: string,
  tokenId: string,
  diff: TokenPatch,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:update",
    payload: {
      documentType: "Token",
      updates: [{ _id: tokenId, diff, embedded: { type: "Token", id: sceneId } }],
    },
  });
}
