/**
 * combatPortraits.test.ts — the tracker's portraits go through the asset grant (fechamento 22/10/2026).
 *
 * Live: every portrait of the Combate panel was a broken image — the queue and the turn head put the stored
 * `/assets/<name>` straight into `<img src>`, and the asset route answers 401 to a request without its query grant.
 */
import { describe, expect, it } from "vitest";
import { resolveCombatPortraits } from "../combatPortraits.js";

describe("resolveCombatPortraits", () => {
  it("signs each stored image through the resolver and keys it by combatant", async () => {
    const urls = await resolveCombatPortraits(
      [
        { id: "c-ilse", img: "/assets/ilse.png" },
        { id: "c-bhrotto", img: "/assets/bhrotto.png" },
      ],
      async (img) => `${img}?at=signed`,
    );
    expect(Object.fromEntries(urls)).toEqual({
      "c-ilse": "/assets/ilse.png?at=signed",
      "c-bhrotto": "/assets/bhrotto.png?at=signed",
    });
  });

  it("leaves out what has no real image (none, a pack placeholder) and what the grant refused", async () => {
    const urls = await resolveCombatPortraits(
      [
        { id: "c-none", img: null },
        { id: "c-stub", img: "icons/placeholder/npc.svg" },
        { id: "c-refused", img: "/assets/secret.png" },
      ],
      async (img) => {
        if (img.includes("secret")) throw new Error("401");
        return img;
      },
    );
    expect(urls.size).toBe(0);
  });

  it("asks the resolver once per distinct image", async () => {
    const asked: string[] = [];
    await resolveCombatPortraits(
      [
        { id: "c-1", img: "/assets/zombie.png" },
        { id: "c-2", img: "/assets/zombie.png" },
      ],
      async (img) => {
        asked.push(img);
        return img;
      },
    );
    expect(asked).toEqual(["/assets/zombie.png"]);
  });
});
