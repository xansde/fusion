/**
 * actionBarIcons.test.ts — the custom image of a bar entry on the client (BAR-F3-05).
 *
 * REQ-BAR-029: the slot draws the chosen image or, without one, the generic icon.
 * REQ-BAR-072/073: only an owner or a privileged role is OFFERED the change (the server is the
 * gate; `action-bar-flags-socket.test.ts` proves the refusal).
 * REQ-BAR-074: what "Trocar ícone…" and "Restaurar ícone padrão" do (the items themselves are the
 * slot menu's, `slotMenu.test.ts`).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ACTION_BAR_ICON_AREA, OwnershipLevel } from "@fusion/shared";

import "../../i18n/index.js";
import { clearAssetGrantCache } from "../../assets/assetGrants.svelte.js";
import {
  customIconOf,
  customIconCount,
  canEditActorIcons,
  iconMenuActions,
  iconChoiceOp,
  iconWriteOp,
  createSlotIconSource,
  resolveSlotIconUrl,
} from "../actionBarIcons.js";

const ICON = `/assets/${ACTION_BAR_ICON_AREA}/hanabi-1a2b3c4d.png`;

function actorWith(icons: Record<string, unknown>, ownership: Record<string, number> = {}) {
  return { _id: "a1", ownership, flags: { fusion: { actionBar: { icons } } } };
}

describe("customIconOf — what the slot draws (REQ-BAR-029)", () => {
  it("returns the chosen image of the entry", () => {
    expect(customIconOf(actorWith({ "strike:katana": ICON }), "strike:katana")).toBe(ICON);
  });

  it("is null without one: the generic icon", () => {
    expect(customIconOf(actorWith({ "strike:katana": ICON }), "spell:heal")).toBeNull();
    expect(customIconOf({ _id: "a1" }, "strike:katana")).toBeNull();
    expect(customIconOf(null, "strike:katana")).toBeNull();
  });

  it("never hands an arbitrary stored string to an <img>: a forged value is the generic icon", () => {
    for (const forged of [
      "https://evil.example/x.png",
      "/assets/mapa-secreto.png",
      `/assets/${ACTION_BAR_ICON_AREA}/../segredo.png`,
      "javascript:alert(1)",
      42,
      { nested: ICON },
    ]) {
      expect(
        customIconOf(actorWith({ "strike:a": forged }), "strike:a"),
        String(forged),
      ).toBeNull();
    }
  });

  it("counts the custom images of the actor", () => {
    expect(customIconCount(actorWith({ "strike:a": ICON, "spell:b": ICON }))).toBe(2);
    expect(customIconCount({})).toBe(0);
  });
});

describe("canEditActorIcons — who is offered the change (REQ-BAR-072/073)", () => {
  it("the owner of the actor", () => {
    expect(canEditActorIcons(actorWith({}, { u1: OwnershipLevel.OWNER }), "u1", false)).toBe(true);
  });

  it("not a player who only observes it, nor one without a user id", () => {
    const actor = actorWith({}, { u1: OwnershipLevel.OWNER, default: OwnershipLevel.OBSERVER });
    expect(canEditActorIcons(actor, "u2", false)).toBe(false);
    expect(canEditActorIcons(actor, null, false)).toBe(false);
  });

  it("the Mestre (a privileged role), on any actor", () => {
    expect(canEditActorIcons(actorWith({}, {}), "gm", true)).toBe(true);
  });
});

describe("iconWriteOp — what the change sends", () => {
  it("one flat doc:update on the actor (the sheets' shape), the map nested under the dot-path key", () => {
    expect(iconWriteOp("a1", "strike:long.sword", ICON)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "a1",
      diff: { "flags.fusion.actionBar.icons": { "strike:long.sword": ICON } },
    });
  });

  it("null restores the generic icon", () => {
    expect(iconWriteOp("a1", "strike:x", null).diff).toEqual({
      "flags.fusion.actionBar.icons": { "strike:x": null },
    });
  });
});

describe("iconMenuActions — what the two menu items do", () => {
  it("'Trocar ícone…' opens the picker for THIS entry of THIS actor", () => {
    const openPicker = vi.fn();
    const sendOp = vi.fn();
    iconMenuActions({ actorId: "a1", entryId: "spell:arco", openPicker, sendOp }).pick();
    expect(openPicker).toHaveBeenCalledExactlyOnceWith({ actorId: "a1", entryId: "spell:arco" });
    expect(sendOp).not.toHaveBeenCalled();
  });

  it("'Restaurar ícone padrão' writes null for the entry, and opens nothing", () => {
    const openPicker = vi.fn();
    const sendOp = vi.fn();
    iconMenuActions({ actorId: "a1", entryId: "spell:arco", openPicker, sendOp }).restore();
    expect(sendOp).toHaveBeenCalledExactlyOnceWith(iconWriteOp("a1", "spell:arco", null));
    expect(openPicker).not.toHaveBeenCalled();
  });
});

describe("iconChoiceOp — what the picker's choice writes", () => {
  it("an icon of the gallery becomes the entry's image", () => {
    expect(iconChoiceOp("a1", "strike:katana", ICON)).toEqual(
      iconWriteOp("a1", "strike:katana", ICON),
    );
  });

  it("anything else is not written at all (the server would refuse it anyway)", () => {
    for (const path of [
      "https://evil.example/x.png",
      "/assets/mapa-secreto-1a2b3c4d.png",
      `/assets/${ACTION_BAR_ICON_AREA}/../segredo.png`,
      "",
    ]) {
      expect(iconChoiceOp("a1", "strike:katana", path), path).toBeNull();
    }
  });
});

describe("createSlotIconSource — what each slot reads from its bar", () => {
  it("follows the bar's actor: its id and the image of each entry", () => {
    let current: Record<string, unknown> | undefined = {
      ...actorWith({ "strike:a": ICON }),
      _id: "a1",
    };
    const source = createSlotIconSource(() => current);
    expect(source.actorId).toBe("a1");
    expect(source.iconOf("strike:a")).toBe(ICON);
    expect(source.iconOf("strike:b")).toBeNull();

    current = { ...actorWith({}), _id: "a2" };
    expect(source.actorId).toBe("a2");
    expect(source.iconOf("strike:a")).toBeNull();

    current = undefined;
    expect(source.actorId).toBeNull();
    expect(source.iconOf("strike:a")).toBeNull();
  });
});

describe("resolveSlotIconUrl — never a bare /assets/ URL (it would answer 401)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    clearAssetGrantCache();
    vi.restoreAllMocks();
  });

  it("asks the grant for the ACTOR the image belongs to, and paints with that grant", async () => {
    const name = `${ACTION_BAR_ICON_AREA}/hanabi-1a2b3c4d.png`;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/assets/grant") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            exp: Date.now() + 300_000,
            grants: { [name]: "sig-icon" },
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = await resolveSlotIconUrl(ICON, "actor-9", { token: "tok", userId: "u1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/grant",
      expect.objectContaining({ body: JSON.stringify({ table: "actors", id: "actor-9" }) }),
    );
    const parsed = new URL(url ?? "", "http://localhost");
    expect(parsed.pathname).toBe(`/assets/${name}`);
    expect(parsed.searchParams.get("at")).toBe("sig-icon");
    expect(parsed.searchParams.get("au")).toBe("u1");
  });

  it("without a session there is nothing to ask a grant with: null, and the generic icon stays", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveSlotIconUrl(ICON, "actor-9", { token: null, userId: "u1" })).toBeNull();
    expect(await resolveSlotIconUrl(ICON, "actor-9", { token: "tok", userId: null })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a value that is not an icon path is never resolved", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await resolveSlotIconUrl("https://evil.example/x.png", "actor-9", {
        token: "tok",
        userId: "u1",
      }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
