/**
 * Prey seal reconciliation in CombatCanvasController (BHR-F3-07).
 * Fakes: TokenLayer (getSprite), FusionCanvas (unused here) and a mirror slice.
 */

import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { CombatCanvasController, type PreyMirrorLike } from "../combatCanvasController.js";
import { i18n } from "../../../i18n/i18n.js";
import ptBR from "../../../i18n/pt-BR.json";

i18n.setLocale("pt-BR");
i18n.registerBundle("pt-BR", "", ptBR as unknown as Record<string, string>);

const mark = (tokenId: string) => ({
  slug: "hunted-prey",
  targetTokenId: tokenId,
  targetActorId: "actor-ogre",
  sceneId: "scene-1",
  createdAt: 1,
  exclusive: true,
});

function setup(opts: {
  isGm: boolean;
  tokens?: Array<Record<string, unknown>>;
  marks?: unknown[];
}) {
  const controls = new Container();
  const docs: Record<string, unknown[]> = {
    actors: [
      {
        _id: "actor-bhrotto",
        name: "Bhrotto",
        flags: { fusion: { tokenMarks: opts.marks ?? [mark("tok-ogre")] } },
      },
    ],
    scenes: [
      { _id: "scene-1", tokens: opts.tokens ?? [{ _id: "tok-ogre", actorId: "actor-ogre" }] },
    ],
  };
  const mirror: PreyMirrorLike = {
    getByType: <T>(type: string) => (docs[type] ?? []) as T[],
  };
  const tokenLayer = {
    getSprite: (id: string) => (id === "tok-ogre" ? { container: { x: 200, y: 300 } } : undefined),
  };
  const ctrl = new CombatCanvasController(
    {} as never,
    tokenLayer as never,
    controls,
    100,
    opts.isGm,
    "user-p1",
    mirror,
  );
  const seals = () =>
    controls.children.filter((c) => (c.label ?? "").startsWith("preySeal:")).map((c) => c.label);
  return { ctrl, controls, docs, seals };
}

describe("CombatCanvasController — Prey seal", () => {
  it("draws the seal on the marked token with 'Presa de <ator que marcou>'", () => {
    const { ctrl, seals, controls } = setup({ isGm: false });
    ctrl.tick(16);
    expect(seals()).toEqual(["preySeal:tok-ogre"]);
    expect(ctrl.preyTooltipOf("tok-ogre")).toBe("Presa de Bhrotto");
    const seal = controls.children.find((c) => c.label === "preySeal:tok-ogre")!;
    expect([seal.x, seal.y]).toEqual([200, 300]);
  });

  it("removes the seal when the mark leaves (mark:clear rewrites the actor)", () => {
    const { ctrl, seals, docs } = setup({ isGm: false });
    ctrl.tick(16);
    (docs["actors"]![0] as { flags: unknown }).flags = { fusion: { tokenMarks: [] } };
    ctrl.tick(16);
    expect(seals()).toEqual([]);
  });

  it("draws nothing on a hidden token for a non-privileged viewer", () => {
    const { ctrl, seals } = setup({
      isGm: false,
      tokens: [{ _id: "tok-ogre", actorId: "actor-ogre", hidden: true }],
    });
    ctrl.tick(16);
    expect(seals()).toEqual([]);
  });

  it("draws on a hidden token for the GM", () => {
    const { ctrl, seals } = setup({
      isGm: true,
      tokens: [{ _id: "tok-ogre", actorId: "actor-ogre", hidden: true }],
    });
    ctrl.tick(16);
    expect(seals()).toEqual(["preySeal:tok-ogre"]);
  });

  it("skips a mark whose token has no sprite here (other scene)", () => {
    const { ctrl, seals } = setup({
      isGm: false,
      marks: [mark("tok-elsewhere")],
      tokens: [{ _id: "tok-elsewhere" }],
    });
    ctrl.tick(16);
    expect(seals()).toEqual([]);
  });

  it("destroy removes the seals", () => {
    const { ctrl, seals } = setup({ isGm: false });
    ctrl.tick(16);
    ctrl.destroy();
    expect(seals()).toEqual([]);
  });
});
