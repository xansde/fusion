/**
 * tokenConfigForm.test.ts — what the token config dialog's Save actually sends.
 *
 * REQ-DOC-031 (spec 02) / REQ-CNV-093 (spec 06): the dialog's link control is
 * the only way a GM can say "this skeleton keeps its own sheet". A control that
 * renders but whose value never reaches the patch is worse than no control: it
 * reports a decision the server never heard.
 * REQ-CNV-089/090 (spec 06): the bars fields ride the same Save, and blank means
 * "no bar" (`null`), not the empty string.
 *
 * The dialog is a `.svelte` component and this repo has no jsdom, so the patch
 * builder lives in a `.ts` module precisely so this question is answerable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTokenConfigPatch } from "../tokenConfigForm.js";
import type { TokenConfigFormValues } from "../tokenConfigForm.js";

const sendOpMock = vi.fn(async (_socket: unknown, _envelope: unknown) => ({}));
vi.mock("../../docs/sendOp.js", () => ({
  sendOp: (socket: unknown, envelope: unknown) => sendOpMock(socket, envelope) as unknown,
  OpError: class extends Error {},
}));

const { updateToken } = await import("../tokenController.js");

const SCENE = "scn0000000000001";
const TOKEN = "tok0000000000001";

function form(over: Partial<TokenConfigFormValues> = {}): TokenConfigFormValues {
  return {
    name: "Esqueleto",
    texture: null,
    actorLink: true,
    visionEnabled: false,
    visionRange: "",
    visionAngle: 360,
    visionMode: "basic",
    lightEnabled: false,
    lightBright: "0",
    lightDim: "0",
    lightColor: "#ffcc88",
    lightIntensity: 1,
    bar1Attribute: "attributes.hp",
    bar2Attribute: "",
    displayBars: "observer",
    ...over,
  };
}

beforeEach(() => {
  sendOpMock.mockClear();
});

describe("buildTokenConfigPatch — the actor link control (REQ-DOC-031)", () => {
  it("carries `actorLink: false` when the GM asks for a private sheet", () => {
    expect(buildTokenConfigPatch(form({ actorLink: false }))["actorLink"]).toBe(false);
  });

  it("carries `actorLink: true` when the GM links the token back", () => {
    expect(buildTokenConfigPatch(form({ actorLink: true }))["actorLink"]).toBe(true);
  });

  it("never touches `actorDelta` — re-linking must not destroy the token's HP", () => {
    // Re-linking is a reversible display decision. Clearing the delta here
    // would make it irreversible, and silently so.
    expect("actorDelta" in buildTokenConfigPatch(form({ actorLink: true }))).toBe(false);
    expect("actorDelta" in buildTokenConfigPatch(form({ actorLink: false }))).toBe(false);
  });
});

describe("buildTokenConfigPatch — the rest of the Save", () => {
  it("turns a blank bar attribute into null, not into an empty string", () => {
    const patch = buildTokenConfigPatch(form({ bar1Attribute: "  ", bar2Attribute: " focus " }));

    expect(patch["bar1"]).toEqual({ attribute: null });
    expect(patch["bar2"]).toEqual({ attribute: "focus" });
  });

  it("treats a blank vision range as unlimited (null), not as zero", () => {
    const vision = buildTokenConfigPatch(form({ visionEnabled: true, visionRange: "" }))[
      "vision"
    ] as Record<string, unknown>;

    expect(vision["range"]).toBeNull();
  });

  it("falls back to 0 for an unparseable light radius instead of NaN", () => {
    const light = buildTokenConfigPatch(form({ lightBright: "abc", lightDim: "12" }))[
      "light"
    ] as Record<string, unknown>;

    expect(light["bright"]).toBe(0);
    expect(light["dim"]).toBe(12);
  });

  it("emits plain token fields only — a dot-path here is rejected by the server", () => {
    for (const key of Object.keys(buildTokenConfigPatch(form()))) {
      expect(key.includes(".")).toBe(false);
      expect(key.startsWith("tokens")).toBe(false);
    }
  });
});

describe("the link control reaches the wire", () => {
  it("rides the embedded Token doc:update, like every other field of the dialog", async () => {
    await updateToken({} as never, SCENE, TOKEN, buildTokenConfigPatch(form({ actorLink: false })));

    const env = sendOpMock.mock.calls[0]?.[1] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(env.type).toBe("doc:update");
    expect(env.payload["documentType"]).toBe("Token");

    const updates = env.payload["updates"] as Record<string, unknown>[];
    expect(updates[0]?.["embedded"]).toEqual({ type: "Token", id: SCENE });
    expect((updates[0]?.["diff"] as Record<string, unknown>)["actorLink"]).toBe(false);
  });
});
