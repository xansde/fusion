import { describe, expect, it } from "vitest";
import { deflateSync, crc32 } from "node:zlib";
import {
  ATRIBUICAO_DO_AVATAR,
  comAtribuicao,
  inserirTextosNoPng,
  lerTextosDoPng,
} from "../atribuicaoPng.js";

const ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(tipo: string, dados: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + dados.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, dados.length);
  const corpo = new Uint8Array(4 + dados.length);
  for (let i = 0; i < 4; i++) corpo[i] = tipo.charCodeAt(i);
  corpo.set(dados, 4);
  out.set(corpo, 4);
  view.setUint32(8 + dados.length, crc32(corpo) >>> 0);
  return out;
}

/** A valid 1x1 RGBA PNG. */
function pngMinimo(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = new Uint8Array(deflateSync(Buffer.from([0, 255, 0, 0, 255])));
  const partes = [
    Uint8Array.from(ASSINATURA),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of partes) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function tiposDeChunk(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const tipos: string[] = [];
  let off = 8;
  while (off < png.length) {
    const len = view.getUint32(off);
    tipos.push(String.fromCharCode(...png.subarray(off + 4, off + 8)));
    off += 12 + len;
  }
  return tipos;
}

describe("inserirTextosNoPng", () => {
  it("puts tEXt chunks between IHDR and IDAT, keeping the file a valid PNG", () => {
    const saida = inserirTextosNoPng(pngMinimo(), { Source: "x", License: "y" });
    expect(Array.from(saida.subarray(0, 8))).toEqual(ASSINATURA);
    expect(tiposDeChunk(saida)).toEqual(["IHDR", "tEXt", "tEXt", "IDAT", "IEND"]);
  });

  it("writes a correct CRC for every chunk", () => {
    const saida = inserirTextosNoPng(pngMinimo(), { Source: "origem" });
    const view = new DataView(saida.buffer, saida.byteOffset, saida.byteLength);
    let off = 8;
    while (off < saida.length) {
      const len = view.getUint32(off);
      const corpo = saida.subarray(off + 4, off + 8 + len);
      expect(view.getUint32(off + 8 + len)).toBe(crc32(corpo) >>> 0);
      off += 12 + len;
    }
  });

  it("round-trips the keywords and text (Latin-1 safe)", () => {
    const saida = inserirTextosNoPng(pngMinimo(), {
      Source: "Liberated Pixel Cup",
      Credits: "ação",
    });
    expect(lerTextosDoPng(saida)).toEqual({
      Source: "Liberated Pixel Cup",
      Credits: "ação",
    });
  });

  it("does not duplicate a keyword that is already there", () => {
    const uma = inserirTextosNoPng(pngMinimo(), { Source: "a" });
    const duas = inserirTextosNoPng(uma, { Source: "a", License: "b" });
    expect(tiposDeChunk(duas)).toEqual(["IHDR", "tEXt", "tEXt", "IDAT", "IEND"]);
    expect(lerTextosDoPng(duas)).toEqual({ Source: "a", License: "b" });
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => inserirTextosNoPng(new Uint8Array([1, 2, 3]), { Source: "x" })).toThrow(/PNG/);
  });

  it("refuses a keyword outside 1-79 characters", () => {
    expect(() => inserirTextosNoPng(pngMinimo(), { "": "x" })).toThrow(/keyword/i);
    expect(() => inserirTextosNoPng(pngMinimo(), { ["k".repeat(80)]: "x" })).toThrow(/keyword/i);
  });
});

describe("comAtribuicao (REQ-AVT-068, DEC-AVT-08)", () => {
  it("stamps the CC-BY-SA attribution on a PNG blob", async () => {
    const blob = new Blob([pngMinimo() as BlobPart], { type: "image/png" });
    const marcado = await comAtribuicao(blob);
    expect(marcado.type).toBe("image/png");
    const textos = lerTextosDoPng(new Uint8Array(await marcado.arrayBuffer()));
    expect(textos["Source"]).toBe(ATRIBUICAO_DO_AVATAR["Source"]);
    expect(textos["License"]).toMatch(/CC-BY-SA 3\.0/);
    expect(textos["Credits-URL"]).toMatch(/^https:\/\//);
  });
});
