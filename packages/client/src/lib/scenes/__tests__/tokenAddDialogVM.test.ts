/**
 * tokenAddDialogVM.test.ts — the actor picker, form validation and op builder behind
 * `TokenAddDialog.svelte` (TK022-client, DEC-TOK-04).
 *
 * Covers REQ-TOK-002 (a token must reference exactly one actor), CA-TOK-003 (no actor
 * selected → create disabled, with a legible reason), REQ-TOK-010/012 (no
 * texture/width/height ever written), REQ-TOK-020 (creation requires actorId/x/y),
 * REQ-TOK-022 (the client never writes a field the server would refuse as derived —
 * footprint, art, ownership, actorDelta), REQ-TOK-024 (hidden is overridable at
 * creation), REQ-TOK-060 (a blank name override inherits the actor's own).
 *
 * Also covers REQ-NPC-060 (A004, ajustes r1 item 22 — absorbed from
 * `tokenAddDialogOp.test.ts` when the two implementations of this op were merged
 * into one): the write that lands a token on a scene is an EMBEDDED `doc:create`
 * (`documentType: "Token"` + `parent: { type: "Scene", id }`), never the
 * `doc:update` + `{ tokens: { $push: {...} } }` pseudo-operator this dialog used to
 * send (rejected by the server's `tokens: z.array(...)` with "Expected array,
 * received object"), and never a whole-array `doc:update` either (refused on purpose
 * by `rejectUnwritableField`: "Scene.tokens is not writable as a whole through
 * doc:update — use embedded operations"). The wire-level twin of these assertions is
 * `packages/server/src/__tests__/scene-tokens-embedded-create.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  buildCreateTokenOp,
  defaultTokenPosition,
  filterTokenActorOptions,
  isTokenAddFormValid,
  toTokenActorOptions,
  validateTokenAddForm,
  type TokenActorOption,
  type TokenAddFormData,
} from "../tokenAddDialogVM.js";
import { buildActorDropTokenOp, type ActorDragPayload } from "../../actors/actorDirectory.js";

const ACTORS: TokenActorOption[] = [
  { id: "act-lobo00000001", name: "Lobo", img: "img/lobo.png" },
  { id: "act-goblin000001", name: "Goblin Guerreiro", img: null },
  { id: "act-goblin000002", name: "Goblin Arqueiro", img: null },
];

function form(overrides: Partial<TokenAddFormData> = {}): TokenAddFormData {
  return { actorId: "", name: "", x: 0, y: 0, hidden: false, ...overrides };
}

// ---------------------------------------------------------------------------
// The actor picker
// ---------------------------------------------------------------------------

describe("toTokenActorOptions", () => {
  it("projects a mirror Actor doc into {id, name, img}, defaulting a missing img to null", () => {
    const options = toTokenActorOptions([
      { _id: "act-lobo00000001", name: "Lobo", img: "img/lobo.png" },
      { _id: "act-fofurinha01x", name: "Fofurinha" },
    ]);

    expect(options).toEqual([
      { id: "act-lobo00000001", name: "Lobo", img: "img/lobo.png" },
      { id: "act-fofurinha01x", name: "Fofurinha", img: null },
    ]);
  });
});

describe("filterTokenActorOptions", () => {
  it("with an empty query, returns every actor sorted by name", () => {
    const found = filterTokenActorOptions(ACTORS, "");
    expect(found.map((a) => a.name)).toEqual(["Goblin Arqueiro", "Goblin Guerreiro", "Lobo"]);
  });

  it("filters by name, case-insensitively", () => {
    const found = filterTokenActorOptions(ACTORS, "gob");
    expect(found.map((a) => a.id)).toEqual(["act-goblin000002", "act-goblin000001"]);
  });

  it("returns nothing when no name matches", () => {
    expect(filterTokenActorOptions(ACTORS, "dragão")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CA-TOK-003 / REQ-TOK-002: no actor, no create
// ---------------------------------------------------------------------------

describe("CA-TOK-003 / REQ-TOK-002: validateTokenAddForm requires an actor", () => {
  it("with no actor selected, create is invalid — with a legible (i18n-keyed) reason", () => {
    const errs = validateTokenAddForm(form());

    expect(isTokenAddFormValid(errs)).toBe(false);
    expect(errs.actorId).toBe("FUSION.Scenes.TokenAdd.Error.ActorRequired");
  });

  it("with an actor selected and a valid name, the form is valid", () => {
    const errs = validateTokenAddForm(form({ actorId: "act-lobo00000001" }));

    expect(isTokenAddFormValid(errs)).toBe(true);
    expect(errs.actorId).toBeUndefined();
  });

  it("a name over 128 chars is rejected even with an actor selected", () => {
    const errs = validateTokenAddForm(form({ actorId: "act-lobo00000001", name: "x".repeat(129) }));

    expect(isTokenAddFormValid(errs)).toBe(false);
    expect(errs.name).toBe("FUSION.Scenes.TokenAdd.Error.NameTooLong");
  });

  it("whitespace-only actorId is treated as no actor", () => {
    const errs = validateTokenAddForm(form({ actorId: "   " }));
    expect(errs.actorId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// REQ-TOK-020/022: the op the dialog sends
// ---------------------------------------------------------------------------

describe("REQ-TOK-020: buildCreateTokenOp", () => {
  it("sends only actorId, x and y when no override is set", () => {
    const op = buildCreateTokenOp(
      "scn-clareira001",
      form({ actorId: "act-lobo00000001", x: 5, y: 7 }),
    );

    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.parent).toEqual({ type: "Scene", id: "scn-clareira001" });
    expect(op.payload.data).toEqual([{ actorId: "act-lobo00000001", x: 5, y: 7 }]);
  });

  it("REQ-TOK-060: a blank name is never sent — the token inherits the actor's own", () => {
    const op = buildCreateTokenOp(
      "scn-clareira001",
      form({ actorId: "act-lobo00000001", name: "   " }),
    );

    expect(op.payload.data[0]).not.toHaveProperty("name");
  });

  it("REQ-TOK-024: a set name and a checked hidden are sent as overrides", () => {
    const op = buildCreateTokenOp(
      "scn-clareira001",
      form({ actorId: "act-lobo00000001", name: "Lobo Alfa", hidden: true }),
    );

    expect(op.payload.data[0]).toMatchObject({ name: "Lobo Alfa", hidden: true });
  });

  it("REQ-TOK-024: hidden is omitted (not sent as false) when the checkbox is unmarked", () => {
    const op = buildCreateTokenOp("scn-clareira001", form({ actorId: "act-lobo00000001" }));

    expect(op.payload.data[0]).not.toHaveProperty("hidden");
  });

  it("REQ-NPC-060 (A004): never a `$push` pseudo-operator and never a `tokens` array — the two shapes the server refuses", () => {
    const op = buildCreateTokenOp(
      "scn-clareira001",
      form({ actorId: "act-lobo00000001", x: 10, y: 20 }),
    );

    expect(JSON.stringify(op)).not.toContain("$push");
    expect(op.payload).not.toHaveProperty("updates");
    expect(op.payload.data[0]).not.toHaveProperty("tokens");
  });

  it("REQ-NPC-060 (A004): no client-supplied `_id` — `handleEmbeddedCreate` mints it server-side", () => {
    const op = buildCreateTokenOp("scn-clareira001", form({ actorId: "act-lobo00000001" }));

    expect(op.payload.data[0]).not.toHaveProperty("_id");
  });

  it("REQ-TOK-010/012/022: the payload never carries texture, width, height, disposition, footprint, ownership or actorDelta", () => {
    const op = buildCreateTokenOp(
      "scn-clareira001",
      form({ actorId: "act-lobo00000001", name: "Lobo Alfa", hidden: true }),
    );
    const fields = op.payload.data[0] as Record<string, unknown>;

    for (const forbidden of [
      "texture",
      "width",
      "height",
      "disposition",
      "footprint",
      "ownership",
      "actorDelta",
      "img",
    ]) {
      expect(fields).not.toHaveProperty(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Defect 1 (Fase 1 e2e): the piece born via the dialog nasce fora da cena
// ---------------------------------------------------------------------------
//
// Root cause (confirmed against specs/06-canvas-e-renderizacao.md §REQ-CNV-011/
// REQ-CNV-066): `Token.x`/`y` are already plain "scene coordinates" — origin at
// the corner of the PADDED area — the exact same system `TokenSprite` renders
// with (no offset of its own) and `TableScreen.handleCanvasDrop`'s `worldX`/
// `worldY` already land in. There never was a unit mismatch between the two
// creation paths to convert away — `buildCreateTokenOp` and
// `buildActorDropTokenOp` both send `x`/`y` straight through, unconverted, and
// therefore ALREADY agree for the same numeric point (first test below). The
// actual bug was the dialog's STARTING value: a hardcoded `(0, 0)` sits inside
// the scene's padding margin (REQ-CNV-066: staging space around the map, not
// the map), so a token created without the GM touching "X"/"Y" landed off to
// the side, invisibly, for any scene with nonzero padding — every scene in the
// Fase 1 e2e fixture (`padding: 0.25`).

describe("REQ-TOK-020 / REQ-CNV-011: dialog and drop already agree on the same point", () => {
  const SCENE = { _id: "scn-clareira001", width: 4000, height: 2400, padding: 0.25 };

  it("buildCreateTokenOp and buildActorDropTokenOp send the identical x/y for the same coordinate — no per-path conversion", () => {
    const dialogOp = buildCreateTokenOp(
      SCENE._id,
      form({ actorId: "act-lobo00000001", x: 1900, y: 1100 }),
    );

    const payload: ActorDragPayload = {
      kind: "actor",
      _id: "act-lobo00000001",
      documentType: "Actor",
      subtype: "npc",
      name: "Lobo",
      img: null,
      origin: "sidebar",
    };
    const dropOp = buildActorDropTokenOp({
      payload,
      sceneId: SCENE._id,
      x: 1900,
      y: 1100,
      gridSize: 100,
      snapToGrid: false,
    });

    expect(dialogOp.payload.data[0]).toMatchObject({ x: 1900, y: 1100 });
    expect(dropOp.payload.data[0]).toMatchObject({ x: 1900, y: 1100 });
  });
});

describe("REQ-CNV-011/REQ-CNV-066: defaultTokenPosition", () => {
  it("starts a new token at the middle of the visible map, not (0, 0) — a corner of the padding margin", () => {
    const scene = { width: 4000, height: 2400, padding: 0.25 };

    // padX = round(4000*0.25) = 1000, padY = round(2400*0.25) = 600;
    // center = padX + width/2, padY + height/2.
    expect(defaultTokenPosition(scene)).toEqual({ x: 3000, y: 1800 });
  });

  it("is (width/2, height/2) for a scene with no padding", () => {
    const scene = { width: 4000, height: 4000, padding: 0 };

    expect(defaultTokenPosition(scene)).toEqual({ x: 2000, y: 2000 });
  });

  it("the default position is a legitimate, resend-able x/y through buildCreateTokenOp", () => {
    const scene = { width: 4000, height: 2400, padding: 0.25 };
    const pos = defaultTokenPosition(scene);

    const op = buildCreateTokenOp("scn-clareira001", form({ actorId: "act-lobo00000001", ...pos }));

    expect(op.payload.data[0]).toMatchObject(pos);
  });
});
