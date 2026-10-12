/**
 * FilePicker.test.ts — the "Ícones da barra" mode of the asset picker (BAR-F3-05, REQ-BAR-074).
 *
 * The client runs Vitest in node (tasks.md §2.10): this looks at the server-rendered markup, which
 * is where "this mode offers no external URL" and "the default mode is unchanged" are observable.
 * The gallery's data path (list, grants, upload with the icon purpose, the GM's delete) is pinned in
 * `lib/assets/__tests__/assetApi.test.ts`; the server side in `assets.test.ts` and
 * `asset-grant.test.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import "../../../i18n/index.js";
import FilePicker from "../FilePicker.svelte";

const noop = (): void => {};

describe("FilePicker — icon mode", () => {
  it("is titled for the bar's icons and offers the upload, in pt-BR", () => {
    const { body } = render(FilePicker, {
      props: { token: "t", onSelect: noop, onClose: noop, mode: "actionbar-icons" },
    });
    expect(body).toContain("Ícones da barra");
    expect(body).toContain("Solte uma imagem aqui");
    expect(body).toContain('accept=".png,.jpg,.jpeg,.webp,.svg"');
  });

  it("warns that whatever is uploaded joins the gallery every player sees (D-BA03)", () => {
    const icon = render(FilePicker, {
      props: { token: "t", onSelect: noop, onClose: noop, mode: "actionbar-icons" },
    }).body;
    expect(icon).toContain("fica visível para todos os jogadores");
    const plain = render(FilePicker, { props: { token: "t", onSelect: noop, onClose: noop } }).body;
    expect(plain).not.toContain("fica visível para todos os jogadores");
  });

  it("offers NO external URL: an icon is always an image of the world's icon area (REQ-BAR-068)", () => {
    const { body } = render(FilePicker, {
      props: { token: "t", onSelect: noop, onClose: noop, mode: "actionbar-icons" },
    });
    expect(body).not.toContain('type="url"');
    expect(body).not.toContain("external URL");
  });

  it("leaves the default mode exactly as it was (scene background, portrait)", () => {
    const { body } = render(FilePicker, { props: { token: "t", onSelect: noop, onClose: noop } });
    expect(body).toContain("Asset Browser");
    expect(body).toContain('type="url"');
    expect(body).not.toContain("Ícones da barra");
  });
});

describe("FilePicker — the icon mode's two decisions are the pure ones (lib/assets/iconPicker.ts)", () => {
  // The decisions are tested in iconPicker.test.ts; this pins that the component still calls them —
  // dropping the purpose would make every player's "Trocar ícone…" upload answer 403.
  const source = readFileSync(
    fileURLToPath(new URL("../FilePicker.svelte", import.meta.url)),
    "utf8",
  );

  it("every upload goes out with pickerUploadOptions(mode)", () => {
    expect(source).toMatch(/assetStore\.startUpload\([\s\S]*?pickerUploadOptions\(mode\),?\s*\)/);
  });

  it("the delete button is offered through canDeleteGalleryIcons", () => {
    expect(source).toContain("canDeleteGalleryIcons(session.user?.role)");
    expect(source).toMatch(/\{#if canDeleteIcons\}/);
  });
});
