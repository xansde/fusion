/**
 * assetGrants.svelte.ts — ONE asset grant per DOCUMENT, cached and shared (T025).
 *
 * WHY THIS EXISTS
 * ---------------
 * `GET /assets/*` no longer opens a file just because the caller holds a valid
 * Bearer token: the server hands out bytes only against a credential IT signed,
 * for exactly one canonical name and one user, after reading the document from
 * its own database and confirming the user can see it. The client therefore has
 * to name the DOCUMENT an image came from before it can paint the image.
 *
 * `POST /api/assets/grant` takes `{ table, id }` — a lookup key, never content —
 * and answers with every asset name that document legitimately carries:
 *
 *   200 { ok: true, exp: <epoch ms>, grants: { "<canonical name>": "<64 hex>" } }
 *   400 VALIDATION_FAILED | INVALID_ASSET_NAME
 *   401 UNAUTHORIZED
 *   404 NOT_FOUND        — missing OR not visible, byte-for-byte the same answer
 *
 * A scene answers with its background AND every visible token texture in ONE
 * round-trip. That is the whole point of caching by document rather than by
 * image: a scene with a background and forty tokens mints once, not forty-one
 * times. `sceneLoader` fills the cache; every `TokenSprite` of that scene then
 * reads it without touching the network.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * -----------------------------------------
 *  - It never caches a REFUSED mint. A 404 today (document not yet synced, or
 *    ownership granted a second later) must not pin an empty answer over a
 *    document for the next five minutes.
 *  - It holds no rune state. The file carries the `.svelte.ts` extension for the
 *    layout the design named, but a reactive cache here would be a trap: every
 *    consumer reads it from inside an `$effect`, so a `$state` map would re-run
 *    those effects on every write and mint in a loop.
 *
 * Spec refs: 20-assets-e-midia.md REQ-AST-019; 21-seguranca.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The tables `POST /api/assets/grant` will read a document from.
 *
 * Mirrors the server's own allowlist (`GRANTABLE_TABLES` in
 * `packages/server/src/assets/routes.ts`) — kept as a literal union rather than
 * `string` so a typo is a compile error here instead of a 400 at the table.
 */
export const GRANTABLE_ASSET_TABLES = [
  "actors",
  "items",
  "scenes",
  "journal_entries",
  "macros",
  "roll_tables",
  "playlists",
  "folders",
  "combats",
  "region_maps",
] as const;

export type AssetDocTable = (typeof GRANTABLE_ASSET_TABLES)[number];

/**
 * Which document an image came from.
 *
 * `id` is the document's `_id` — the same value the server looks up in its `id`
 * column. Every render-time consumer of a stored asset path must be able to name
 * one of these; a caller that cannot is a caller that does not know what it is
 * painting, which is precisely the confusion the grant closes.
 */
export interface AssetDocRef {
  readonly table: AssetDocTable;
  readonly id: string;
}

/** What one mint of `POST /api/assets/grant` returned. */
export interface AssetGrantBundle {
  /** Expiry shared by every signature in `grants`, epoch ms. */
  readonly exp: number;
  /** canonical asset name -> HMAC signature (the `at` query param). */
  readonly grants: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * How much of the grant's life must remain for it to still be worth handing out.
 *
 * The server's TTL is 5 minutes. Serving a URL with two seconds left would put
 * the expiry race inside the image request itself, so a bundle is treated as
 * spent well before the server would reject it.
 */
const GRANT_MIN_REMAINING_MS = 30_000;

/** The answer for "no grant" — never cached, never usable (see `isUsable`). */
const EMPTY_BUNDLE: AssetGrantBundle = { exp: 0, grants: {} };

/**
 * How long a document must wait before a MISSING NAME may force another mint.
 *
 * A cached bundle is a photograph of a document as it was up to five minutes
 * ago, and documents change while the table is playing: the GM drags a new
 * monster onto the scene, swaps a background, changes a portrait. The client
 * gets the `doc:update` and paints — but the cached bundle has no signature for
 * the new texture, so under enforcement the image 404s and the player stares at
 * a placeholder until the TTL runs out. (Proved with a mocked mint: one
 * `POST /api/assets/grant`, then a second name from the same document, and NO
 * second request was ever made.)
 *
 * So a name the bundle does not cover is treated as evidence that the bundle is
 * stale, and one re-mint is allowed. The cooldown is what stops that from
 * becoming a storm: a document that genuinely does not carry the name — a
 * player asking about art he is not entitled to, or a path that no longer
 * exists — would otherwise mint once per repaint, forever.
 */
const GRANT_REMINT_COOLDOWN_MS = 10_000;

const cache = new Map<string, AssetGrantBundle>();
/** Mints already in the air, so N images of one document trigger ONE request. */
const inFlight = new Map<string, Promise<AssetGrantBundle>>();
/** When a document last re-minted because a name was missing from its bundle. */
const lastRemintAt = new Map<string, number>();

function cacheKey(ref: AssetDocRef): string {
  return `${ref.table}:${ref.id}`;
}

function isUsable(bundle: AssetGrantBundle, nowMs: number): boolean {
  return bundle.exp - nowMs > GRANT_MIN_REMAINING_MS;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function mintGrants(ref: AssetDocRef, accessToken: string): Promise<AssetGrantBundle> {
  const response = await fetch("/api/assets/grant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ table: ref.table, id: ref.id }),
  });

  // A refusal is not an exception here: 404 ("you cannot see this document") is
  // an ordinary answer for a player looking at a scene that went off air, and it
  // must not become a thrown error every consumer has to catch.
  if (!response.ok) return EMPTY_BUNDLE;

  // Typed with `| null` deliberately: `typeof null === "object"`, so without it
  // the null guard below would look redundant to the compiler while still being
  // the thing that stops a malformed body from becoming a crash at paint time.
  const data = (await response.json()) as {
    ok?: boolean;
    exp?: number;
    grants?: Record<string, string> | null;
  };
  if (typeof data.exp !== "number" || typeof data.grants !== "object" || data.grants === null) {
    return EMPTY_BUNDLE;
  }
  return { exp: data.exp, grants: data.grants };
}

/**
 * The grants for one document, minting at most once per document per TTL.
 *
 * Concurrent callers for the same document share a single in-flight request —
 * the scene case, where the background and every token ask at the same tick.
 *
 * Never rejects: a refused or failed mint resolves to an empty bundle, and the
 * caller decides what to do with a name it has no signature for.
 */
export function assetGrantsFor(ref: AssetDocRef, accessToken: string): Promise<AssetGrantBundle> {
  const key = cacheKey(ref);

  const cached = cache.get(key);
  if (cached !== undefined && isUsable(cached, Date.now())) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;

  const request = mintGrants(ref, accessToken)
    .catch(() => EMPTY_BUNDLE)
    .then((bundle) => {
      // Only a bundle with real time left is worth keeping. EMPTY_BUNDLE has
      // exp 0, so a refusal is structurally uncacheable rather than
      // conditionally uncached.
      if (isUsable(bundle, Date.now())) cache.set(key, bundle);
      inFlight.delete(key);
      return bundle;
    });

  inFlight.set(key, request);
  return request;
}

/**
 * The grants for one document, guaranteeing an attempt at `name`.
 *
 * Same as {@link assetGrantsFor} when the cached bundle already covers `name`.
 * When it does not, the bundle is treated as STALE — see
 * `GRANT_REMINT_COOLDOWN_MS` — and one fresh mint is made, at most once per
 * cooldown per document.
 *
 * Callers that are resolving a specific image should use this rather than
 * `assetGrantsFor`: "the cache has no signature for this name" and "the server
 * refused this name" look identical to the caller, and they are not the same
 * thing. Only the first is fixable, and only by asking again.
 */
export function assetGrantsCovering(
  ref: AssetDocRef,
  name: string,
  accessToken: string,
): Promise<AssetGrantBundle> {
  const key = cacheKey(ref);
  const cached = cache.get(key);
  const nowMs = Date.now();

  const stale =
    cached !== undefined &&
    isUsable(cached, nowMs) &&
    cached.grants[name] === undefined &&
    inFlight.get(key) === undefined &&
    nowMs - (lastRemintAt.get(key) ?? 0) > GRANT_REMINT_COOLDOWN_MS;

  if (stale) {
    lastRemintAt.set(key, nowMs);
    cache.delete(key);
  }

  return assetGrantsFor(ref, accessToken);
}

/**
 * Forget the cached grants for one document.
 *
 * For the mirror to call when it applies a `doc:create`/`doc:update` that could
 * have changed which art a document carries. Nothing calls it yet — the
 * stale-bundle recovery above is deliberately pull-based, because it needs no
 * agreement with the sync layer about which tables map to which document types —
 * but the hook exists so a mirror-side invalidation can be wired without
 * reaching into this module's internals.
 */
export function invalidateAssetGrants(ref: AssetDocRef): void {
  const key = cacheKey(ref);
  cache.delete(key);
  lastRemintAt.delete(key);
}

/**
 * Drop every cached grant.
 *
 * MUST be called on logout and on world switch: a grant is signed for ONE user
 * id, and the server refuses a grant whose `au` is not the caller (routes.ts),
 * so a surviving cache turns every already-visited image into a broken one for
 * the next user in the same tab. Wired into `sessionActions.logout`.
 */
export function clearAssetGrantCache(): void {
  cache.clear();
  inFlight.clear();
  lastRemintAt.clear();
}

/**
 * The cached bundle for a document, WITHOUT minting. Returns null when there is
 * nothing usable cached. Exists for tests and for callers that want to know
 * whether a paint would cost a round-trip.
 */
export function peekAssetGrants(ref: AssetDocRef): AssetGrantBundle | null {
  const cached = cache.get(cacheKey(ref));
  if (cached === undefined || !isUsable(cached, Date.now())) return null;
  return cached;
}
