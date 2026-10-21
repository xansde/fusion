import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
vi.mock("../../api.js", () => ({ fusionApi: { getFreshToken: async () => "tok" } }));
vi.mock("../../assets/assetApi.js", () => ({ uploadAsset: (...a: unknown[]) => upload(...a) }));

const { publicarMiniatura } = await import("../publicarMiniatura.js");

describe("publicarMiniatura", () => {
  beforeEach(() => upload.mockReset());

  it("returns the /assets/ path of the uploaded PNG", async () => {
    upload.mockResolvedValue({ ok: true, path: "avatar-token-79449d7e.png" });
    await expect(publicarMiniatura(new Blob(["x"]), "token")).resolves.toBe(
      "/assets/avatar-token-79449d7e.png",
    );
  });

  it("throws instead of handing back a path that would blank the actor's art", async () => {
    for (const path of ["", undefined, "../x.png"]) {
      upload.mockResolvedValue({ ok: true, path });
      await expect(publicarMiniatura(new Blob(["x"]), "token")).rejects.toThrow();
    }
  });
});
