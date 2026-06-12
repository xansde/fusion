/**
 * Canonical hidden-token redaction for non-GM clients.
 *
 * Invariant (specs 04/05): the position or even the existence of a hidden
 * token must NEVER reach a non-GM socket — by ANY emission path.
 *
 * There are three emission paths that carry Scene bodies to clients, and all
 * three MUST funnel non-GM Scene documents through {@link stripHiddenTokens}:
 *
 *   1. buildSnapshot      (full snapshot on join / seq-out-of-buffer resync)
 *   2. broadcastToWorld   (live per-socket emit of doc:create / doc:update)
 *   3. filterOpsForRole   (delta resync — replay of buffered ops)
 *
 * This module is the single source of truth for that redaction logic so the
 * three paths can never drift out of parity (the delta path previously did,
 * leaking hidden tokens — see the M1-C fix).
 */

/**
 * Strip hidden tokens from a single Scene document for non-GM players.
 *
 * Returns a shallow copy of the scene with the `tokens` array filtered to
 * exclude any token whose `hidden` field is `true`.  When the scene has no
 * `tokens` array, or no token is hidden, the original object is returned
 * unchanged (no allocation) so callers can cheaply detect "nothing redacted"
 * via referential equality.
 *
 * Fine-grained per-actor ownership visibility (e.g. tokens whose actor the
 * player does not own) is deferred to a later milestone; only the `hidden`
 * flag is honoured here.
 */
export function stripHiddenTokens(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const filtered = (rawTokens as Record<string, unknown>[]).filter(
    (token) => token["hidden"] !== true,
  );

  // Only allocate a new object when something was actually removed.
  if (filtered.length === rawTokens.length) return scene;
  return { ...scene, tokens: filtered };
}

/**
 * Return true when any Scene doc in the batch carries at least one hidden
 * token.  Used as a fast-path guard so callers can skip per-socket iteration
 * when there is nothing to redact.
 */
export function scenePayloadHasHiddenTokens(documents: Record<string, unknown>[]): boolean {
  for (const doc of documents) {
    if (sceneDocHasHiddenTokens(doc)) return true;
  }
  return false;
}

/**
 * Return true when a single Scene-shaped doc carries at least one hidden token.
 * A "Scene-shaped doc" is any object with a `tokens` array; non-Scene docs (no
 * `tokens` array) trivially have nothing to redact.
 */
function sceneDocHasHiddenTokens(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const tokens = (doc as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokens)) return false;
  for (const t of tokens as Record<string, unknown>[]) {
    if (t["hidden"] === true) return true;
  }
  return false;
}

/**
 * Redact hidden tokens from an op ACK *result* destined for a non-privileged
 * (role < ASSISTANT) socket.  This is the dispatcher-level safety net: it is
 * applied centrally in socket-manager.ts so EVERY handler — present or future —
 * that echoes a Scene body back to the requester is covered, without each
 * handler having to remember to redact its own ack.
 *
 * Covered ack `result` shapes (the object under `ack.result`), as produced by
 * the doc handlers in doc-handlers.ts:
 *
 *   1. Primary Scene doc:create / doc:update
 *        { documentType: "Scene", documents: FullScene[] }
 *      → each entry in `documents[]` is a full Scene carrying `tokens[]`.
 *
 *   2. Embedded token create (handleEmbeddedCreate)
 *        { documentType: "Token", documents: Token[], parent: FullScene }
 *      → `documents[]` here are the *created tokens* (not scenes); the leak
 *        vector is `parent`, the full Scene carrying `tokens[]`.
 *
 *   3. Embedded token update (handleEmbeddedUpdate)
 *        { documentType: "Scene", documents: FullScene[] }
 *      → same as shape 1: full Scenes under `documents[]`.
 *
 *   4. Embedded token delete (handleEmbeddedDelete)
 *        { documentType: "Token", ids: string[], parent: FullScene }
 *      → leak vector is `parent`, the full Scene carrying `tokens[]`.
 *
 * The detector is therefore STRUCTURAL, not name-based: it walks `documents[]`
 * and `parent` and strips hidden tokens from any element that is Scene-shaped
 * (has a `tokens` array).  Entries without a `tokens` array (e.g. the created
 * Token docs in shape 2, or any non-Scene primary doc) are passed through
 * untouched.  Relying on `documentType === "Scene"` would MISS shapes 2 and 4,
 * where the Scene is carried under `parent` while `documentType` is "Token".
 *
 * Cloning discipline: the input `result` (and the docs/parent it references) may
 * be shared with other emission paths (the live broadcast envelope, the op
 * buffer).  We therefore NEVER mutate in place — when redaction actually removes
 * a token we return a fresh clone and leave the original object graph intact.
 * When nothing is hidden we return the original reference unchanged (no alloc).
 *
 * Non-object / non-matching results are returned unchanged.
 */
export function redactAckResultForNonPrivileged(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const ack = result as Record<string, unknown>;

  // Only success acks carry a `result` body; error acks have no document payload.
  if (ack["ok"] !== true) return result;

  const body = ack["result"];
  if (!body || typeof body !== "object") return result;
  const bodyObj = body as Record<string, unknown>;

  const documents = bodyObj["documents"];
  const parent = bodyObj["parent"];

  const documentsNeedsRedaction =
    Array.isArray(documents) && (documents as unknown[]).some((d) => sceneDocHasHiddenTokens(d));
  const parentNeedsRedaction = sceneDocHasHiddenTokens(parent);

  if (!documentsNeedsRedaction && !parentNeedsRedaction) {
    // Nothing hidden anywhere — return the original ack untouched.
    return result;
  }

  // Build a redacted clone, never mutating the shared original.
  const newBody: Record<string, unknown> = { ...bodyObj };

  if (documentsNeedsRedaction) {
    newBody["documents"] = (documents as Record<string, unknown>[]).map((d) =>
      Array.isArray(d["tokens"]) ? stripHiddenTokens(d) : d,
    );
  }

  if (parentNeedsRedaction) {
    newBody["parent"] = stripHiddenTokens(parent as Record<string, unknown>);
  }

  return { ...ack, result: newBody };
}
