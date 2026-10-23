/**
 * The canonical spelling of an asset name — ONE definition, used by BOTH ends
 * of the grant (T025).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 *
 * A grant is an HMAC over a name. The mint derives that name from a document
 * field; the serve route derives it from the URL the browser asked for. If the
 * two derivations are not the SAME expression, there exists a pair of spellings
 * that the two ends disagree about — and every such pair is either a file the
 * legitimate client can no longer open, or a file an attacker can open with a
 * grant that was never issued for it. Three earlier designs on this task died
 * on exactly that: `basename()` (two different files collapse into one key),
 * `toLowerCase()` (fail-OPEN on a case-sensitive filesystem), and a Windows
 * `\`-separated relative path (never matches a POSIX-stored name).
 *
 * So: one exported function, imported by the mint and by the serve route. Do
 * not inline an "equivalent" expression at either call site.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO decodeURIComponent HERE
 * ---------------------------------------------------------------------------
 *
 * `find-my-way` (Fastify's router) already percent-decodes the wildcard exactly
 * once before the handler sees it. Verified by execution against this repo's
 * own Fastify version:
 *
 *   GET /assets/a%20b.png          -> wildcard "a b.png"
 *   GET /assets/%252e%252e/x       -> wildcard "%2e%2e/x"      (ONE decode)
 *   GET /assets/..%2f..%2fworld.db -> wildcard "../../world.db"
 *   GET /assets/a%00b.jpg          -> wildcard carrying a real 0x00 byte
 *
 * Decoding a second time here is precisely how `%252e%252e` turns back into
 * `..` after the router already handed us the harmless literal — the classic
 * double-decode traversal. The mint side reaches the same string by a different
 * road: `assetRefToStorageName()` (assets/reconcile.ts) performs the single
 * per-segment `decodeURIComponent` that undoes what the client's `assetUrl()`
 * encoded. Both roads arrive percent-DECODED, and this function is applied to
 * both.
 *
 * What it does do is collapse the one spelling difference the two roads can
 * still carry: empty path segments. `a//b.png` and `a/b.png` name the same file
 * on disk, so they must produce the same key. Leading and trailing `/` go the
 * same way.
 *
 * What it deliberately does NOT do:
 *   - lowercase anything (fail-open: `mapa.png` would open `MAPA.PNG`);
 *   - strip a directory (a `basename` key merges `segredo.jpg` with
 *     `maps/segredo.jpg` — two different files, one grant);
 *   - resolve `.` / `..` segments. Those are REFUSED, not repaired, and the
 *     refusal lives in the mint's hygiene check (assets/routes.ts) so a name
 *     that needs repairing never gets signed in the first place. On the serve
 *     side a `..` name simply fails to match any signed name and falls into the
 *     uniform 404, with `guardPath` still behind it.
 */

/**
 * The canonical key for `raw`, which must already be percent-DECODED (see the
 * module doc). Empty segments are dropped; everything else — case, Unicode,
 * punctuation, directory structure — is preserved byte for byte.
 */
export function canonicalizeAssetName(raw: string): string {
  return raw
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/");
}
