/**
 * preyMarks.test.ts — the Prey (TokenMark `hunted-prey`) as the canvas sees it (BHR-F3-07).
 *
 * The server already redacts a mark on a token hidden from a player (BHR-F3-06);
 * the client mirrors that as a second line so a late `hidden` flip never draws a seal.
 */

import { describe, it, expect } from "vitest";
import { collectPreyMarks, type PreyMarkSources } from "../preyMarks.js";

function mark(tokenId: string, slug = "hunted-prey") {
  return {
    slug,
    targetTokenId: tokenId,
    targetActorId: "actor-ogre",
    sceneId: "scene-1",
    createdAt: 1,
    exclusive: true,
  };
}

function sources(over: Partial<PreyMarkSources> = {}): PreyMarkSources {
  return {
    actors: [
      {
        _id: "actor-bhrotto",
        name: "Bhrotto",
        flags: { fusion: { tokenMarks: [mark("tok-ogre")] } },
      },
    ],
    scenes: [
      {
        _id: "scene-1",
        tokens: [
          { _id: "tok-ogre", actorId: "actor-ogre" },
          { _id: "tok-other", actorId: "actor-x" },
        ],
      },
    ],
    viewerIsPrivileged: false,
    viewerUserId: "user-p1",
    ...over,
  };
}

describe("collectPreyMarks", () => {
  it("returns the marked token with the marking actor's name", () => {
    const out = collectPreyMarks(sources());
    expect(out).toEqual([
      {
        tokenId: "tok-ogre",
        slug: "hunted-prey",
        sourceActorId: "actor-bhrotto",
        sourceName: "Bhrotto",
      },
    ]);
  });

  it("uses the translated actor label, never a hardcoded name", () => {
    const out = collectPreyMarks(
      sources({
        actors: [
          {
            _id: "a2",
            name: "Someone Else",
            flags: {
              fusion: {
                tokenMarks: [mark("tok-ogre")],
                i18n: { "pt-BR": { name: "Outra Pessoa" } },
              },
            },
          },
        ],
      }),
    );
    expect(out[0]?.sourceName).toBe("Outra Pessoa");
  });

  it("ignores marks of other slugs", () => {
    const out = collectPreyMarks(
      sources({
        actors: [
          {
            _id: "a",
            name: "A",
            flags: { fusion: { tokenMarks: [mark("tok-ogre", "monster-hunter")] } },
          },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("returns nothing when no actor has marks", () => {
    expect(collectPreyMarks(sources({ actors: [{ _id: "a", name: "A" }] }))).toEqual([]);
  });

  it("hides the seal on a hidden token from a non-privileged viewer", () => {
    const hidden = sources({
      scenes: [{ _id: "scene-1", tokens: [{ _id: "tok-ogre", actorId: "x", hidden: true }] }],
    });
    expect(collectPreyMarks(hidden)).toEqual([]);
  });

  it("shows a hidden token's seal to the GM", () => {
    const hidden = sources({
      viewerIsPrivileged: true,
      scenes: [{ _id: "scene-1", tokens: [{ _id: "tok-ogre", actorId: "x", hidden: true }] }],
    });
    expect(collectPreyMarks(hidden)).toHaveLength(1);
  });

  it("shows a hidden token's seal to a viewer listed in seenBy", () => {
    const seen = sources({
      scenes: [
        {
          _id: "scene-1",
          tokens: [{ _id: "tok-ogre", actorId: "x", hidden: true, seenBy: ["user-p1"] }],
        },
      ],
    });
    expect(collectPreyMarks(seen)).toHaveLength(1);
  });

  it("drops a mark whose token is not in any scene (stale mark)", () => {
    expect(collectPreyMarks(sources({ scenes: [{ _id: "scene-1", tokens: [] }] }))).toEqual([]);
  });

  it("keeps one entry per marking actor on the same token", () => {
    const out = collectPreyMarks(
      sources({
        actors: [
          { _id: "a1", name: "A", flags: { fusion: { tokenMarks: [mark("tok-ogre")] } } },
          { _id: "a2", name: "B", flags: { fusion: { tokenMarks: [mark("tok-ogre")] } } },
        ],
      }),
    );
    expect(out.map((m) => m.sourceActorId)).toEqual(["a1", "a2"]);
  });
});
