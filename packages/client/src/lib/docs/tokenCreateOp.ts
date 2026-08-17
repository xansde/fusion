/**
 * tokenCreateOp.ts — the one `doc:create` envelope every token-creation gesture sends
 * (TK022-client, spec 41 §7.2: "cena vem do embedding, não do payload" — REQ-TOK-001,
 * REQ-TOK-020).
 *
 * `Scene.tokens` is an embedded collection (REQ-DOC-025). `doc-handlers.ts`'s
 * `rejectUnwritableField` refuses `diff.tokens` as a whole array through `doc:update`
 * on purpose — that generic merge path skips the ownership check, the role floor and
 * the schema validation the embedded-create path provides
 * (`DocHandlerDeps`/`handleEmbeddedCreate`, doc-handlers.ts). The one door in is
 * `doc:create` with `documentType: "Token"` and `parent: { type: "Scene", id }` — the
 * scene comes from `parent`, never from a field inside the token payload itself.
 *
 * Before this module existed, three call sites each built this envelope by hand and
 * two of them built it WRONG: `TokenAddDialog.svelte` and `npcsFooter.ts`'s chest sent
 * `doc:update` with a `{ tokens: { $push: {...} } }` diff — `$push` is not an operator
 * this codebase implements (`packages/server/src/documents/merge.ts` only knows
 * object-merge and array-replace), so the patch silently replaced `Scene.tokens` with a
 * plain object instead of appending, and `rejectUnwritableField` would refuse an actual
 * array the same way. `TableScreen.svelte`'s canvas drop sent `documentType: "Token"`
 * with an `embedded: { type, sceneId }` key and a `documents` array — neither of which
 * `DocCreatePayloadSchema` (`packages/shared/src/protocol.ts`) recognises (it wants
 * `data` and `parent: { type, id }`), so `doc:create` failed `VALIDATION_FAILED` before
 * ever reaching `handleEmbeddedCreate`, unnoticed because the drop handler emits with
 * `sock.emit` and never inspects the ack. None of the three gestures could ever have
 * created a token. This module is now the single place the shape is written, so the
 * three call sites (`TokenAddDialog.svelte` via `lib/scenes/tokenAddDialogVM.ts`,
 * `npcsFooter.ts`'s `buildPlaceChestTokenOp`, `TableScreen.svelte`'s canvas drop) send
 * the exact same, correct envelope.
 */

export interface TokenCreateOp {
  readonly type: "doc:create";
  readonly payload: {
    readonly documentType: "Token";
    readonly data: readonly Record<string, unknown>[];
    readonly parent: { readonly type: "Scene"; readonly id: string };
  };
}

/**
 * Build the `doc:create` op that lands one Token on `sceneId`.
 *
 * `fields` carries only content the caller actually wants to set — `actorId`/`x`/`y`
 * (REQ-TOK-020) plus whatever of §7.2's overridable set the caller supplies (`name`,
 * `hidden`, ...). Nothing derived (footprint, art, ownership) or forbidden
 * (`actorDelta`, REQ-TOK-022) belongs in it — the server computes or refuses those, this
 * module does not filter for it (each caller is responsible for what it puts in
 * `fields`, the same way `handleEmbeddedCreate` is responsible for validating it against
 * `TokenDocumentSchema`).
 */
export function buildTokenCreateOp(
  sceneId: string,
  fields: Record<string, unknown>,
): TokenCreateOp {
  return {
    type: "doc:create",
    payload: {
      documentType: "Token",
      data: [fields],
      parent: { type: "Scene", id: sceneId },
    },
  };
}
