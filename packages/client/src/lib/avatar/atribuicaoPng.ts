/**
 * atribuicaoPng.ts — stamps the art attribution inside the avatar PNG.
 *
 * The avatar is assembled from Liberated Pixel Cup (LPC) pieces under per-piece
 * licenses. Provisional decision of 2026-10-21 (spec 35 §6.1): every PNG the creator
 * generates is treated as a derivative work under CC-BY-SA 3.0 — the most
 * restrictive non-GPL license among the pieces — and carries its attribution in
 * `tEXt` chunks (`Source`, `License`, `Credits-URL`, `Credits`), so the notice
 * travels with the file when it is copied out of the library.
 *
 * Pure byte manipulation (no canvas, no DOM): a chunk is inserted right after IHDR,
 * and the CRC is computed here because the browser has no `zlib.crc32`.
 */

/** Attribution written into every generated avatar PNG. Latin-1 only (tEXt). */
export const ATRIBUICAO_DO_AVATAR: Readonly<Record<string, string>> = {
  Source:
    "Liberated Pixel Cup - Universal LPC Spritesheet Character Generator (via waybuilder-avatar)",
  License:
    "CC-BY-SA 3.0 (derivative work; each piece has its own license, see Credits and Credits-URL)",
  "Credits-URL":
    "https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator",
  Credits: "Fusion VTT: /avatar/creditos.json (authors and license of every piece)",
};

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TAMANHO_ASSINATURA = ASSINATURA_PNG.length;

let tabelaCrc: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (tabelaCrc === null) {
    tabelaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = (tabelaCrc[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function latin1(texto: string): Uint8Array {
  const out = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const code = texto.charCodeAt(i);
    if (code > 0xff) throw new Error(`tEXt is Latin-1 only (character U+${code.toString(16)})`);
    out[i] = code;
  }
  return out;
}

function ehPng(bytes: Uint8Array): boolean {
  return bytes.length >= TAMANHO_ASSINATURA + 12 && ASSINATURA_PNG.every((b, i) => bytes[i] === b);
}

function chunkTexto(chave: string, valor: string): Uint8Array {
  if (chave.length < 1 || chave.length > 79) {
    throw new Error("tEXt keyword must have 1-79 characters");
  }
  const k = latin1(chave);
  const v = latin1(valor);
  const corpo = new Uint8Array(4 + k.length + 1 + v.length);
  corpo.set([0x74, 0x45, 0x58, 0x74], 0); // "tEXt"
  corpo.set(k, 4);
  corpo[4 + k.length] = 0;
  corpo.set(v, 5 + k.length);
  const out = new Uint8Array(corpo.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, corpo.length - 4);
  out.set(corpo, 4);
  view.setUint32(corpo.length + 4, crc32(corpo));
  return out;
}

interface InfoDoChunk {
  tipo: string;
  inicioDosDados: number;
  tamanho: number;
  fim: number;
}

function percorrer(bytes: Uint8Array): InfoDoChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lista: InfoDoChunk[] = [];
  let off = TAMANHO_ASSINATURA;
  while (off + 12 <= bytes.length) {
    const tamanho = view.getUint32(off);
    const tipo = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const fim = off + 12 + tamanho;
    if (fim > bytes.length) break;
    lista.push({ tipo, inicioDosDados: off + 8, tamanho, fim });
    off = fim;
  }
  return lista;
}

/** The `tEXt` entries of a PNG, keyword -> text. */
export function lerTextosDoPng(bytes: Uint8Array): Record<string, string> {
  if (!ehPng(bytes)) throw new Error("Not a PNG");
  const textos: Record<string, string> = {};
  for (const info of percorrer(bytes)) {
    if (info.tipo !== "tEXt") continue;
    const dados = bytes.subarray(info.inicioDosDados, info.inicioDosDados + info.tamanho);
    const nul = dados.indexOf(0);
    if (nul <= 0) continue;
    textos[String.fromCharCode(...dados.subarray(0, nul))] = String.fromCharCode(
      ...dados.subarray(nul + 1),
    );
  }
  return textos;
}

/**
 * Insert one `tEXt` chunk per entry right after IHDR. A keyword the file already
 * has is left alone, so stamping twice does not grow the file.
 */
export function inserirTextosNoPng(bytes: Uint8Array, textos: Record<string, string>): Uint8Array {
  if (!ehPng(bytes)) throw new Error("Not a PNG (bad signature)");
  // Build every chunk first so an invalid keyword fails even if it already exists.
  const todos = Object.entries(textos).map(
    ([chave, valor]) => [chave, chunkTexto(chave, valor)] as const,
  );
  const existentes = lerTextosDoPng(bytes);
  const novos = todos.filter(([chave]) => !(chave in existentes)).map(([, c]) => c);
  if (novos.length === 0) return bytes;

  const ihdr = percorrer(bytes).find((info) => info.tipo === "IHDR");
  if (ihdr === undefined) throw new Error("Not a PNG (no IHDR)");
  const corte = ihdr.fim;
  const extra = novos.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, corte), 0);
  let off = corte;
  for (const c of novos) {
    out.set(c, off);
    off += c.length;
  }
  out.set(bytes.subarray(corte), off);
  return out;
}

/** The generated avatar PNG, with the LPC attribution inside it. */
export async function comAtribuicao(png: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const marcado = inserirTextosNoPng(bytes, { ...ATRIBUICAO_DO_AVATAR });
  return new Blob([marcado as BlobPart], { type: "image/png" });
}
