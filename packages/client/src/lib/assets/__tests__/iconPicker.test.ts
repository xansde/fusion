/**
 * iconPicker.test.ts — the two decisions of the FilePicker's icon mode, as pure functions
 * (BAR-F3-05; the component only calls them).
 *
 * REQ-BAR-075/103: every upload of the icon mode declares the "icon" purpose — without it the server
 * refuses a player (403), so losing it would silently break "Trocar ícone…" for every player.
 * REQ-BAR-081: only the Mestre is offered "Apagar" in the gallery (the server refuses anyone else).
 */

import { describe, expect, it } from "vitest";

import { canDeleteGalleryIcons, pickerUploadOptions } from "../iconPicker.js";

describe("pickerUploadOptions", () => {
  it("the icon mode uploads with the icon purpose", () => {
    expect(pickerUploadOptions("actionbar-icons")).toEqual({ purpose: "icon" });
  });

  it("the default mode uploads as before, with no purpose", () => {
    expect(pickerUploadOptions("assets")).toEqual({});
  });
});

describe("canDeleteGalleryIcons", () => {
  it("only the Mestre (role 4, STORAGE_DELETE)", () => {
    expect(canDeleteGalleryIcons(4)).toBe(true);
    for (const role of [undefined, 0, 1, 2, 3]) {
      expect(canDeleteGalleryIcons(role), String(role)).toBe(false);
    }
  });
});
