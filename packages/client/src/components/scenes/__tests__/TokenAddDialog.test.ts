/**
 * TokenAddDialog.test.ts — the first paint of the "Adicionar peça" dialog
 * (TK022-client, DEC-TOK-04).
 *
 * `tokenAddDialogVM.test.ts` already proves the pure rule (CA-TOK-003 / REQ-TOK-002: no
 * actor picked, no token) against the VM functions in isolation. That is not the same
 * claim as "the template actually wires the rule": the submit button's `disabled`
 * expression and the actor picker's list are markup, and a VM test cannot see them —
 * `validateTokenAddForm` could be deleted from the template entirely and every VM test
 * would stay green. This file renders the real component with `render()` from
 * `svelte/server` (no jsdom/testing-library in this project — see the client
 * `vitest.config.ts`) and asserts on the first-paint string, the same instrument used
 * by `ChatMessage.test.ts`/`NpcsPanel.test.ts`.
 *
 * Covers CA-TOK-003 (no actor selected → create stays disabled, with a legible reason)
 * and REQ-TOK-002 (the picker only offers real world actors, never a hand-typed id).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import TokenAddDialog from "../TokenAddDialog.svelte";
import { worldMirror } from "../../../lib/docs/worldSync.js";
import { t } from "../../../lib/i18n/i18n.js";
import "../../../lib/i18n/index.js";

const SCENE_ID = "scn-clareira0001";

const ACTORS = [
  { _id: "act-lobo00000001", name: "Lobo", img: "worlds/img/lobo.webp" },
  { _id: "act-goblin000001", name: "Goblin Guerreiro", img: null },
];

function seedMirror(): void {
  worldMirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: ACTORS },
  });
}

function renderDialog(): string {
  return render(TokenAddDialog, {
    props: {
      sceneId: SCENE_ID,
      onClose: () => {},
      onSuccess: () => {},
      socket: {} as never,
    },
  }).body;
}

/** The `<button type="submit" ...>` tag, up to its closing `>`. */
function submitButtonTag(body: string): string {
  const match = /<button[^>]*type="submit"[^>]*>/.exec(body);
  if (!match) throw new Error("submit button not found in rendered markup");
  return match[0];
}

describe("CA-TOK-003 / REQ-TOK-002: TokenAddDialog first paint", () => {
  it("with no actor selected, the create button renders disabled and the reason is legible", () => {
    seedMirror();

    const body = renderDialog();

    expect(submitButtonTag(body)).toMatch(/\bdisabled\b/);
    expect(body).toContain(t("FUSION.Scenes.TokenAdd.Error.ActorRequired"));
  });

  it("offers the world's real actors, never a hand-typed id field", () => {
    seedMirror();

    const body = renderDialog();

    expect(body).toContain("Lobo");
    expect(body).toContain("Goblin Guerreiro");
    // REQ-TOK-002/DEC-TOK-04: no free-text actor id input anywhere in the form.
    expect(body).not.toContain('id="token-actor-id"');
  });

  it("with no world actors at all, the picker says so instead of rendering empty", () => {
    worldMirror.applySnapshot({ seq: 1, activeSceneId: null, documents: { Actor: [] } });

    const body = renderDialog();

    expect(body).toContain(t("FUSION.Scenes.TokenAdd.ActorNoResults"));
    expect(submitButtonTag(body)).toMatch(/\bdisabled\b/);
  });
});
