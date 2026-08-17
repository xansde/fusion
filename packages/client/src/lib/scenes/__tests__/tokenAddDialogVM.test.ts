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
 */

import { describe, expect, it } from "vitest";
import {
  buildCreateTokenOp,
  filterTokenActorOptions,
  isTokenAddFormValid,
  toTokenActorOptions,
  validateTokenAddForm,
  type TokenActorOption,
  type TokenAddFormData,
} from "../tokenAddDialogVM.js";

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
