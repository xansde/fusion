/**
 * Asset-BEARING FIELDS, per document table (T025).
 *
 * ---------------------------------------------------------------------------
 * WHY A FIELD LIST HERE, WHEN reconcile.ts DELIBERATELY REFUSES ONE
 * ---------------------------------------------------------------------------
 *
 * `assets/reconcile.ts` scans the RAW JSON TEXT of a document and explains at
 * length why it must not carry a field allowlist: it answers "is this file
 * still used?", and a field it forgot would report a live file as an orphan and
 * offer the GM a button to delete it. Its failure mode points at DATA LOSS, so
 * it errs towards finding too much.
 *
 * This module answers a different question — "which names may I SIGN a grant
 * for?" — and its failure mode points the other way:
 *
 *   field forgotten here  -> an image does not load. Loud, fail-closed, fixed
 *                            by adding a line.
 *   free text included    -> the player writes a thousand filenames in his own
 *                            character's biography and receives a thousand
 *                            signed grants. That is the vulnerability this
 *                            whole task exists to close, handed back with a
 *                            server signature on it.
 *
 * Measured on a synthetic actor with 500 names in `system.details.biography`
 * and 500 embedded items (levantamento de campos portadores, §D3):
 *
 *   generic extractor over the raw document : 1001 names
 *   projection including `items[].img`      :  501 names
 *   projection as written below             :    1 name
 *
 * So the two modules disagree on purpose, and neither is the template for the
 * other.
 *
 * ---------------------------------------------------------------------------
 * WHY THE REFS COME OUT OF THE VALUES AND NOT OUT OF THE TEXT
 * ---------------------------------------------------------------------------
 *
 * The "1 name" above is only true because {@link projectedAssetRefs} matches a
 * projected value WHOLE (`^/assets/…$`). Running `reconcile.ts`'s text scan over
 * `JSON.stringify(projection)` instead — which is what this module did until the
 * adversarial review — restores the amplification inside the very field the
 * projection was protecting: `actors.img` is one scalar a player owns and may
 * write, and N space-separated references in it produced N grants. Measured
 * against the real route: 1 ref -> 1 grant / 119 bytes, 100 refs -> 100 grants,
 * 5000 refs -> 5000 grants / 398,932 bytes in ONE request.
 *
 * A bearer field holds ONE path. Anything else in it is not a second asset, it
 * is someone using a text scan as an API — so the value either IS a reference or
 * it carries none, and the cap ("one field, at most one grant") is structural
 * instead of being a limit somebody has to remember to enforce.
 *
 * ---------------------------------------------------------------------------
 * MAINTENANCE RULES
 * ---------------------------------------------------------------------------
 *
 * 1. A nested path is HARDCODED on purpose. The store persists `tokens`,
 *    `items`, `pages`, `results` and `sounds` as `z.array(z.record(...))`
 *    (documents/types.ts), so deriving this list from the registered Zod schema
 *    would produce a silently INCOMPLETE list — the worst outcome, because it
 *    looks derived and is not.
 * 2. NOTHING under `system.*` or `flags.*` ever enters this table. Both are
 *    passthrough records (`documents/types.ts:88/102`, `shared/document.ts`),
 *    and a player is OWNER of his own sheet: every key he invents survives the
 *    write. `flags.fusion.assetSubstitutions[].original` alone holds 4433
 *    filenames after a pack import.
 * 3. A new path enters only with a proven writer OR a proven reader, cited by
 *    `file:line`. "The schema has a field called img" is not evidence that
 *    anything puts a servable path in it.
 *
 * Full evidence per line, including the four disjoint surveys behind it
 * (schemas, client, packs/importer, real world data), lives in the task's
 * `campos-portadores.md`.
 */

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Known asset-bearing field paths, by document table.
 *
 * Path grammar — only two forms, and the unit test pins that:
 *   `field`            a scalar string on the document
 *   `array[].field`    a scalar string on each element of a top-level array
 *
 * A table present here with an empty list is a deliberate statement ("this
 * table is grantable and carries no art today"), not an omission.
 */
export const ASSET_FIELD_PATHS: Readonly<Record<string, readonly string[]>> = {
  // `background` is the only bearer with live data in the real world (3 rows).
  // `thumb` is read with precedence over `background` by the scenes tab
  // (`scenesTabVM.ts:177-179`) but has no writer yet and cannot even persist —
  // the STORE's SceneSchema has no `thumb` (documents/types.ts:111-152) and
  // drops unknown keys. Listed anyway: it costs nothing and it must be here
  // before RNF-CEN-02's thumbnail generator exists, not after.
  //
  // `tiles[].texture` is ABSENT, and unlike the rest of this file that is a
  // decision taken against data rather than against a schema. The pre-merge
  // dry-run over the archived worlds found a real one: the ACTIVE scene of
  // `argiburgo` carries two tiles whose `texture` is a plain string
  // (`/assets/<name>.png`), so the field is populated in the wild today.
  //
  // It stays out for two independent reasons, and BOTH must be answered before
  // it comes in:
  //   1. Nothing renders a tile. `layers.ts` declares a `tiles` layer and
  //      `FusionCanvas.ts` orders it, but no sprite is ever built from the
  //      array and `sceneController.ts:177` writes `tiles: []`. Adding the path
  //      today would make no image appear that does not appear now.
  //   2. THE DANGEROUS HALF: both of those real tiles are `hidden: true`, and
  //      there is no tile counterpart to `stripHiddenTokens` — no redaction in
  //      `net/redaction.ts` touches `tiles` at all. Projecting the field as it
  //      stands would sign the art of a tile the GM hid, which is the same
  //      mistake `combatants[].img` is protected from by running AFTER the
  //      strip. A hidden tile must lose its texture before this projection sees
  //      the scene, and that redaction does not exist yet.
  // Note also that the real shape is `tiles[].texture` as a STRING, while spec
  // 02:905 describes `tiles[].texture.src` as an object — whoever wires the
  // renderer has to reconcile the two before writing a path here.
  //
  // `tokens[].texture` IS THE SECOND FIELD A PLAYER CAN WRITE, and unlike
  // `actors.img` it sits on a document he does NOT own. `handleEmbeddedUpdate`
  // (`net/handlers/doc-handlers.ts:1528-1553`) authorises a Token patch by the
  // ownership of the ACTOR the token references, never by the scene's, and the
  // patched token is stored without schema validation (`collection[idx] =
  // patchedToken`, :1596 — the store keeps `tokens` as a free record). So a
  // player with a token of his own on the scene on air can put any name he
  // already knows into this field and then mint a grant for it against a scene
  // whose ownership is `{"default":0}`.
  //
  // That is the SAME residual `actors.img` carries (a known name, one write, one
  // grant — never a name he did not already have), on a shared document. It is
  // written here because the §4.1 note below used to describe the residual as
  // "one bearer, on a sheet he owns", and the next reader would have believed
  // that. Closing it for real means an allow-list of patchable fields in the
  // embedded-Token update path, where today only `_id` and `actorId` are
  // protected — a change on the document front, not on this one.
  scenes: ["background", "thumb", "tokens[].texture"],

  // Scalar, and the bearer a player can write on a document he owns
  // (CharacterSheet.svelte:344). That is the residual self-reference this
  // design accepts by name: ONE name per mint, not a thousand — and it is one
  // only because {@link projectedAssetRefs} matches the value WHOLE (see the
  // module doc). It is not the only player-writable bearer: `scenes.tokens[]
  // .texture` is the other, and it is documented above.
  //
  // `items[].img` is DELIBERATELY ABSENT. Re-entry condition: only once
  // `CharacterSheet.svelte:1160` stops rendering `<img src={item.img}>` raw and
  // starts going through `resolveAssetUrl` — until then including it saves no
  // image at all and buys 500x amplification (see §D3 above). When it does come
  // back it needs a cap (first `min(N, 64)` items, or only entries whose `img`
  // is not an `icons/placeholder/*` path), because the create path for embedded
  // items has no batch limit (`shared/protocol.ts:215`).
  //
  // `prototypeToken.texture` is also absent, and that is not an oversight: it
  // does not exist anywhere in `packages/`, `systems/`, `tools/` or in the 4414
  // compiled pack documents — only in specs 02/16. Listing a field nothing
  // writes would advertise that default token art is covered when nothing
  // implements it.
  actors: ["img"],

  // Schema-backed (documents/types.ts:98) and universal across the packs, but
  // no reader in the client consults it yet. Included for symmetry at zero
  // cost; do not count it as coverage of anything.
  items: ["img"],

  // `combats` is world state every player sees (REQ-CBT-031 carve-out), so the
  // projection MUST run on the body already passed through
  // `stripHiddenCombatantsFromCombat` — otherwise a player signs the portrait
  // of a hidden combatant and learns it exists. The route does exactly that.
  //
  // Always null in practice today: `combat/combat-handlers.ts:719` reads
  // `token["img"]` while a scene token declares `texture` (`shared/scene.ts:165`).
  // That is a real defect on another front; the field is listed here as
  // future-proofing, not as working coverage.
  combats: ["combatants[].img"],

  macros: ["img"],

  // `results[].img` stays out: `documents/types.ts:192` types results as a free
  // record and no writer in this repo puts a path in one.
  roll_tables: ["img"],

  // No Zod schema exists for this table anywhere (`registerDocumentSchema` never
  // registers it). The field name is proven by DATA: row `JjtMKczslavXdiVR` in
  // the real world carries `image: "/assets/taverna-demo.jpg"` with ownership
  // `{"default":2}` — the ONLY surface in that world that reaches a player.
  // Forgetting this line blanks the map on the table.
  //
  // `pins[].icon` is NOT a path: the real values are emoji.
  region_maps: ["image"],

  // FolderSchema (documents/types.ts:257-264) has name/type/parentId/sort/
  // sorting/color and no art field at all. Grantable, projects nothing.
  folders: [],

  // `pages[]` is a free record and `pages[].src` (spec 02:1009) does not exist
  // yet. When it does, note that a journal page carries its OWN ownership
  // (REQ-DOC-025) — gating on the parent document's ownership, which is what
  // the route does today, will NOT be sufficient for it.
  journal_entries: [],

  // `sounds[]` is a free record and there is no audio player in the client at
  // all (no Howl / no <audio> / no `new Audio`). `sounds[].path` (spec 13:290)
  // does not exist yet.
  playlists: [],
};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Matches the `array[].field` form and captures both halves. */
const ARRAY_PATH_PATTERN = /^([^[\].]+)\[\]\.([^[\].]+)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The sub-object of `doc` that consists of nothing but its asset-bearing
 * fields, ready to be `JSON.stringify`-ed and handed to `extractAssetRefs`.
 *
 * `doc` must ALREADY be the redacted body the viewer is entitled to — this
 * function knows nothing about visibility and applies none. Feeding it an
 * unredacted scene would sign the texture of a hidden token.
 *
 * An unknown table projects to `{}` rather than throwing: the endpoint's own
 * allowlist is the gate that decides which tables may be asked about, and a
 * table that slipped past it must produce no grants, not an exception that a
 * caller might catch and treat as "no art".
 */
export function projectAssetFields(
  table: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const paths = ASSET_FIELD_PATHS[table];
  if (paths === undefined) return {};

  const projection: Record<string, unknown> = {};

  for (const path of paths) {
    const nested = ARRAY_PATH_PATTERN.exec(path);

    if (nested === null) {
      const value = doc[path];
      if (typeof value === "string") projection[path] = value;
      continue;
    }

    const arrayKey = nested[1];
    const leafKey = nested[2];
    // Both groups are guaranteed by the pattern; the guard exists because
    // `noUncheckedIndexedAccess` types them as possibly-undefined.
    if (arrayKey === undefined || leafKey === undefined) continue;

    const rawArray = doc[arrayKey];
    if (!Array.isArray(rawArray)) continue;

    const elements: Array<Record<string, unknown>> = [];
    for (const element of rawArray as unknown[]) {
      if (!isPlainObject(element)) continue;
      const leafValue = element[leafKey];
      if (typeof leafValue === "string") elements.push({ [leafKey]: leafValue });
    }

    if (elements.length === 0) continue;
    const existing = projection[arrayKey];
    projection[arrayKey] = Array.isArray(existing)
      ? [...(existing as unknown[]), ...elements]
      : elements;
  }

  return projection;
}

/**
 * An asset reference is the WHOLE value of a bearer field.
 *
 * Same character class as `reconcile.ts`'s `ASSET_REF_PATTERN` — everything
 * `encodeURIComponent` can emit — but ANCHORED at both ends and not global.
 * The anchors are the entire defence described in the module doc: they turn
 * "how many `/assets/` substrings does this text contain?" into "is this field a
 * path, yes or no?".
 */
const WHOLE_ASSET_REF_PATTERN = /^\/assets\/[^"\\\s<>]+$/;

/**
 * Every asset reference carried by a projection built by
 * {@link projectAssetFields}, in field order, duplicates included.
 *
 * ONE per scalar field and ONE per array element, structurally: a field whose
 * value is not exactly a reference contributes nothing, so no amount of text a
 * writer puts in a bearer field can make the mint sign more names than the
 * document has bearer fields. That bound is why `actors.img` being
 * player-writable is a residual instead of a bulk oracle.
 *
 * Only the two shapes {@link projectAssetFields} produces are walked (scalar
 * string, array of one-key objects). Anything else is ignored rather than
 * recursed into: a projection is not arbitrary JSON, and treating it as such is
 * how the text scan got in.
 */
export function projectedAssetRefs(projection: Record<string, unknown>): string[] {
  const refs: string[] = [];

  const take = (value: unknown): void => {
    if (typeof value !== "string") return;
    if (!WHOLE_ASSET_REF_PATTERN.test(value)) return;
    refs.push(value);
  };

  for (const value of Object.values(projection)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (!isPlainObject(element)) continue;
        for (const leaf of Object.values(element)) take(leaf);
      }
      continue;
    }
    take(value);
  }

  return refs;
}
