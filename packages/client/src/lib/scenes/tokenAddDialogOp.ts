/**
 * tokenAddDialogOp.ts — the op `TokenAddDialog.svelte` sends when it adds a
 * token to the active scene (A004, ajustes r1 item 22).
 *
 * The server has a dedicated write for landing ONE new token on a scene: a
 * `doc:create` with `documentType: "Token"` and `parent: { type: "Scene", id }`
 * (`handleEmbeddedCreate`, `packages/server/src/net/handlers/doc-handlers.ts`)
 * — `_id` is generated server-side and the token is appended to
 * `Scene.tokens` atomically.
 *
 * Before this fix, this dialog (like `npcsFooter.ts`'s footer before its own
 * fix, REQ-NPC-060) sent a `doc:update` with
 * `diff: { tokens: { $push: {...} } }` — a MongoDB-style pseudo-operator the
 * server does not implement, rejected with
 * `tokens: Expected array, received object` (`Scene.tokens` is
 * `z.array(TokenDocumentSchema)`, and the server's generic diff merge
 * replaces an array key wholesale). Sending the WHOLE array back as a plain
 * `doc:update` diff is not the fix either — the server's
 * `rejectUnwritableField` refuses that too, on purpose: `Scene.tokens is not
 * writable as a whole through doc:update — use embedded operations`. The real
 * fix is the embedded `doc:create` this module builds.
 *
 * Kept out of the component so it can be exercised without a DOM — the
 * client project runs Vitest in a node environment (same pattern as
 * `lib/npcs/npcsFooter.ts`'s `buildPlaceChestTokenOp`, the sibling call site
 * this bug also lived in).
 */

/** The subset of `TokenAddDialog.svelte`'s form state a new token needs. */
export interface TokenAddFormData {
  readonly name: string;
  readonly texture: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AddTokenOp {
  readonly type: "doc:create";
  readonly payload: {
    readonly documentType: "Token";
    readonly data: readonly Record<string, unknown>[];
    readonly parent: { readonly type: "Scene"; readonly id: string };
  };
}

/**
 * REQ-NPC-060: an embedded `doc:create` of a Token under the target scene —
 * never a `$push` pseudo-operator, and never a whole-array `doc:update` diff
 * either (see the module docstring for why both are refused).
 */
export function buildAddTokenOp(sceneId: string, data: TokenAddFormData): AddTokenOp {
  return {
    type: "doc:create",
    payload: {
      documentType: "Token",
      data: [
        {
          name: data.name.trim(),
          texture: data.texture.trim() || null,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
          rotation: 0,
          hidden: false,
          disposition: 0,
          elevation: 0,
          bar1: { attribute: null },
          bar2: { attribute: null },
        },
      ],
      parent: { type: "Scene", id: sceneId },
    },
  };
}
