/**
 * `flags.fusion.actionBar` — the schema the server validates every write against
 * (tasks.md §2.5, spec 53 §7.2; BAR-F3-05 for `icons`, BAR-F3-01 for `favorites`/`seeded`).
 *
 * Every "refuses" below is a write the server must turn into VALIDATION_FAILED. The icon cases are
 * the forged spellings the adversarial review of BAR-F3-05 tries first: an external URL, a `..`,
 * a partial path, the area in another case, percent-encoding, two paths in one value, a file
 * outside the reserved area.
 */

import { describe, it, expect } from "vitest";
import {
  ACTION_BAR_SLOT_COUNT,
  ACTION_BAR_ICON_CAP,
  ACTION_BAR_ICON_AREA,
  ACTION_BAR_FLAG_PATH,
  ACTION_BAR_ICONS_FLAG_PATH,
  ActionBarEntryIdSchema,
  ActionBarAssetPathSchema,
  ActionBarFlagsSchema,
  isActionBarIconFileName,
  isActionBarIconPath,
  readActionBarFlags,
  actionBarIconPatch,
} from "../actionbar.js";

const ICON = `/assets/${ACTION_BAR_ICON_AREA}/hanabi-1a2b3c4d.png`;

function icons(count: number): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < count; i++) map[`strike:golpe-${String(i)}`] = ICON;
  return map;
}

describe("the constants", () => {
  it("12 favourite slots, 64 icons, one reserved area", () => {
    expect(ACTION_BAR_SLOT_COUNT).toBe(12);
    expect(ACTION_BAR_ICON_CAP).toBe(64);
    expect(ACTION_BAR_ICON_AREA).toBe("actionbar-icons");
    expect(ACTION_BAR_FLAG_PATH).toBe("flags.fusion.actionBar");
    expect(ACTION_BAR_ICONS_FLAG_PATH).toBe("flags.fusion.actionBar.icons");
  });
});

describe("ActionBarEntryIdSchema", () => {
  it("accepts <kind>:<origin> for the seven kinds", () => {
    for (const id of [
      "strike:longsword",
      "spell:force-barrage.r1",
      "action:grapple",
      "item:potion:abc123",
      "reaction:shield-block",
      "toggle:rage",
      "check:skill-athletics",
    ]) {
      expect(ActionBarEntryIdSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it("refuses an unknown kind, an empty origin, a space and an over-long origin", () => {
    for (const id of ["macro:x", "strike:", "strike:a b", `strike:${"a".repeat(121)}`, "x"]) {
      expect(ActionBarEntryIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe("isActionBarIconFileName", () => {
  it("accepts what the server's slug produces, in any case of extension", () => {
    for (const name of ["hanabi-1a2b3c4d.png", "arco_eletrico-0f0f0f0f.webp", "x.JPG", "a.svg"]) {
      expect(isActionBarIconFileName(name), name).toBe(true);
    }
  });

  it("refuses the names Windows reserves for devices, in any case (the GM's server runs on Windows)", () => {
    for (const name of [
      "CON.png",
      "con.png",
      "Nul.webp",
      "PRN.jpg",
      "aux.svg",
      "COM1.png",
      "lpt9.png",
    ]) {
      expect(isActionBarIconFileName(name), name).toBe(false);
    }
    // …but a name merely starting with those letters is an ordinary file.
    for (const name of ["console-1a2b3c4d.png", "com-1a2b3c4d.png", "nulo-00000000.webp"]) {
      expect(isActionBarIconFileName(name), name).toBe(true);
    }
  });

  it("refuses separators, dot segments, percent escapes, spaces and non-images", () => {
    for (const name of [
      "",
      ".",
      "..",
      "../segredo.png",
      "a/b.png",
      "a\\b.png",
      "a..b.png",
      "%2e%2e.png",
      "a%2Fb.png",
      "a b.png",
      ".oculto.png",
      "notas.txt",
      "mapa.png?x=1",
      "mapa.png#y",
      `${"a".repeat(260)}.png`,
    ]) {
      expect(isActionBarIconFileName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe("ActionBarAssetPathSchema — one whole /assets/ path, inside the icon area", () => {
  it("accepts a file directly inside the reserved area", () => {
    expect(ActionBarAssetPathSchema.safeParse(ICON).success).toBe(true);
    expect(isActionBarIconPath(ICON)).toBe(true);
  });

  it("refuses every forged spelling (REQ-BAR-068, CA-BAR-09)", () => {
    const forged = [
      // external URL and protocol-relative URL
      "https://evil.example/x.png",
      "http://127.0.0.1:33000/assets/actionbar-icons/x.png",
      "//evil.example/assets/actionbar-icons/x.png",
      "data:image/png;base64,AAAA",
      // partial paths
      "actionbar-icons/x.png",
      "assets/actionbar-icons/x.png",
      "/assets/",
      "/assets/actionbar-icons/",
      // traversal, literal and percent-encoded, either case
      "/assets/actionbar-icons/../segredo.png",
      "/assets/actionbar-icons/..%2fsegredo.png",
      "/assets/actionbar-icons/%2e%2e/segredo.png",
      "/assets/actionbar-icons/%2E%2E%2Fsegredo.png",
      "/assets/actionbar-icons/%252e%252e.png",
      "/assets/actionbar-icons\\..\\world.db",
      // outside the area: a GM map, a portrait, a nested folder
      "/assets/mapa-secreto-1a2b3c4d.png",
      "/assets/maps/actionbar-icons/x.png",
      "/assets/actionbar-icons/sub/x.png",
      // the area in another case or encoded
      "/ASSETS/actionbar-icons/x.png",
      "/Assets/actionbar-icons/x.png",
      "/assets/ActionBar-Icons/x.png",
      "/assets/actionbar%2Dicons/x.png",
      // two paths in one value, whitespace, query, fragment
      `${ICON} ${ICON}`,
      `${ICON}\n${ICON}`,
      `${ICON}?at=1`,
      `${ICON}#x`,
      // not an image
      "/assets/actionbar-icons/notas.txt",
    ];
    for (const value of forged) {
      expect(ActionBarAssetPathSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
      expect(isActionBarIconPath(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses a value longer than 512", () => {
    const long = `/assets/${ACTION_BAR_ICON_AREA}/${"a".repeat(600)}.png`;
    expect(ActionBarAssetPathSchema.safeParse(long).success).toBe(false);
  });
});

describe("ActionBarFlagsSchema — favourites (BAR-F3-01)", () => {
  const twelve = (fill: string | null): Array<string | null> =>
    Array.from({ length: ACTION_BAR_SLOT_COUNT }, () => fill);

  it("accepts exactly 12 positions, ids or null", () => {
    const favorites = twelve(null);
    favorites[0] = "strike:longsword";
    favorites[11] = "spell:heal";
    expect(ActionBarFlagsSchema.safeParse({ favorites, seeded: true }).success).toBe(true);
  });

  it("refuses 11 or 13 positions and a malformed id", () => {
    expect(ActionBarFlagsSchema.safeParse({ favorites: twelve(null).slice(1) }).success).toBe(
      false,
    );
    expect(ActionBarFlagsSchema.safeParse({ favorites: [...twelve(null), null] }).success).toBe(
      false,
    );
    const bad = twelve(null);
    bad[3] = "not an id";
    expect(ActionBarFlagsSchema.safeParse({ favorites: bad }).success).toBe(false);
  });

  it("refuses a non-boolean seeded and an unknown field (.strict())", () => {
    expect(ActionBarFlagsSchema.safeParse({ seeded: "yes" }).success).toBe(false);
    expect(ActionBarFlagsSchema.safeParse({ outra: 1 }).success).toBe(false);
  });

  it("accepts the empty object (nothing chosen yet)", () => {
    expect(ActionBarFlagsSchema.safeParse({}).success).toBe(true);
  });
});

describe("ActionBarFlagsSchema — icons (BAR-F3-05)", () => {
  it("accepts a map of entry id to an icon path", () => {
    expect(ActionBarFlagsSchema.safeParse({ icons: { "strike:longsword": ICON } }).success).toBe(
      true,
    );
  });

  it("confirms the cap with a border test (Q-BAR-03): 64 pass, 65 do not", () => {
    expect(ActionBarFlagsSchema.safeParse({ icons: icons(ACTION_BAR_ICON_CAP) }).success).toBe(
      true,
    );
    expect(ActionBarFlagsSchema.safeParse({ icons: icons(ACTION_BAR_ICON_CAP + 1) }).success).toBe(
      false,
    );
    expect(ActionBarFlagsSchema.safeParse({ icons: icons(5000) }).success).toBe(false);
  });

  it("refuses a key that is not an entry id, and a value that is not one icon path", () => {
    expect(ActionBarFlagsSchema.safeParse({ icons: { __proto__x: ICON } }).success).toBe(false);
    expect(
      ActionBarFlagsSchema.safeParse({ icons: { "strike:a": "https://evil.example/x.png" } })
        .success,
    ).toBe(false);
    expect(ActionBarFlagsSchema.safeParse({ icons: { "strike:a": null } }).success).toBe(false);
    expect(ActionBarFlagsSchema.safeParse({ icons: { "strike:a": [ICON] } }).success).toBe(false);
  });
});

describe("readActionBarFlags", () => {
  it("reads flags.fusion.actionBar off a document, and nothing else", () => {
    const actionBar = { icons: { "strike:a": ICON } };
    expect(readActionBarFlags({ flags: { fusion: { actionBar } } })).toEqual(actionBar);
    expect(readActionBarFlags({ flags: { fusion: {} } })).toBeUndefined();
    expect(readActionBarFlags({ flags: null })).toBeUndefined();
    expect(readActionBarFlags({})).toBeUndefined();
    expect(readActionBarFlags(null)).toBeUndefined();
  });
});

describe("actionBarIconPatch — the diff the client sends", () => {
  it("sets one entry without touching its siblings, and null restores the generic icon", () => {
    expect(actionBarIconPatch("strike:a.b", ICON)).toEqual({
      [ACTION_BAR_ICONS_FLAG_PATH]: { "strike:a.b": ICON },
    });
    expect(actionBarIconPatch("strike:a.b", null)).toEqual({
      [ACTION_BAR_ICONS_FLAG_PATH]: { "strike:a.b": null },
    });
  });
});
