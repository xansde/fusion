/**
 * Minimal self-contained QR Code encoder + ASCII renderer for console output
 * (M6/B4 — "log com QR ASCII/URL no console do serve").
 *
 * No external dependency: the project has no qrcode/terminal-QR package, and
 * adding one purely to print a URL to the console at boot is not justified
 * (CLAUDE.md: no new dep without justification) when the QR spec is a fixed,
 * well-documented algorithm. This implements just enough of ISO/IEC 18004 to
 * encode a URL in Byte mode at error-correction level L, versions 1–10
 * (up to 122 bytes in Byte mode at level L) — comfortably covers a
 * `https://<slug>.trycloudflare.com` URL (~40–55 chars) or a LAN
 * `http://192.168.x.x:33000` URL.
 *
 * Not a general-purpose QR library: no Kanji/alphanumeric mode, no versions
 * beyond 10, no mask-penalty scoring (mask 0 is used unconditionally, which
 * is always a *valid* — if not maximally-optimal — encoding; scanners do not
 * care about mask "quality", only correctness). Sufficient and correct for
 * "print an invite URL as a scannable code in a terminal".
 *
 * Test coverage: __tests__/qr-ascii.test.ts (golden module-hash snapshots +
 * independent structural assertions re-derived from ISO/IEC 18004 — no QR
 * decoder dependency exists in this monorepo to verify against, see that
 * file's doc comment for the verification strategy).
 *
 * KNOWN DEBT: this monorepo has TWO independent QR *encoders* — this
 * hand-rolled one (server-side, console output for `fusion serve --tunnel`)
 * and `qrcode-generator` (packages/client, browser QR rendering for the
 * setup wizard's connectivity step, see packages/client/package.json). They
 * were built independently for different runtime constraints (this one has
 * no DOM/canvas; the client one has no console/ASCII renderer) and have
 * never been consolidated into @fusion/shared. TODO: if a third QR need
 * ever appears (or one of these two needs a feature the other already has),
 * extract a shared encoder into @fusion/shared instead of adding a third
 * implementation.
 */

// ---------------------------------------------------------------------------
// Galois Field GF(256) arithmetic for Reed-Solomon error correction
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255] ?? 0;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}

/** Generator polynomial for `degree` EC codewords, coefficients high-to-low. */
function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j] ?? 0, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, GF_EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  // Generator has degree `ecCount`, i.e. `ecCount + 1` coefficients with a
  // leading 1 (generator[0] === 1 always, since it's a product of monic
  // (x - a^i) terms). Standard LFSR-style polynomial division: `remainder`
  // holds exactly `ecCount` coefficients throughout — the leading generator
  // coefficient is never written into `remainder` (it only participates via
  // `factor`, matching the classic "each data byte XORed with the current
  // leading remainder coefficient, generator[1..] applied to the rest").
  const generator = rsGeneratorPoly(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);
  for (const dataByte of data) {
    const factor = dataByte ^ (remainder[0] ?? 0);
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        remainder[i] = (remainder[i] ?? 0) ^ gfMul(generator[i + 1] ?? 0, factor);
      }
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Version capacity table (Byte mode, EC level L) — versions 1..10
// [totalCodewords, ecCodewordsPerBlock, dataCodewords] (single block; QR
// versions 1-10 at level L never need multiple blocks per group except v5+,
// simplified here to single-group since our payloads are short).
// Source: ISO/IEC 18004 Table 9 / Table 7 (level L rows only).
// ---------------------------------------------------------------------------

interface VersionInfo {
  version: number;
  size: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks: number;
}

const VERSIONS: VersionInfo[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1 },
  { version: 2, size: 25, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1 },
  { version: 3, size: 29, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1 },
  { version: 4, size: 33, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1 },
  { version: 5, size: 37, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1 },
  { version: 6, size: 41, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2 },
  { version: 7, size: 45, totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks: 2 },
  { version: 8, size: 49, totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks: 2 },
  { version: 9, size: 53, totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks: 2 },
  { version: 10, size: 57, totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks: 4 },
];

export class QrTooLargeError extends Error {
  constructor(byteLength: number) {
    super(
      `Text is too long to encode as a QR code with this minimal encoder ` +
        `(${String(byteLength)} bytes; max supported ~122 bytes at EC level L, versions 1-10).`,
    );
    this.name = "QrTooLargeError";
  }
}

function pickVersion(byteLength: number): VersionInfo {
  for (const v of VERSIONS) {
    // Byte-mode overhead per version: mode(4 bits) + length field (8 bits for
    // v1-9, 16 bits for v10+) = 12 or 20 bits = 1.5 or 2.5 bytes, rounded up.
    const lengthFieldBits = v.version <= 9 ? 8 : 16;
    const overheadBits = 4 + lengthFieldBits;
    const dataCodewords = v.totalCodewords - v.ecCodewordsPerBlock * v.numBlocks;
    const capacityBits = dataCodewords * 8;
    const availableForPayload = Math.floor((capacityBits - overheadBits) / 8);
    if (byteLength <= availableForPayload) return v;
  }
  throw new QrTooLargeError(byteLength);
}

// ---------------------------------------------------------------------------
// Bit buffer
// ---------------------------------------------------------------------------

class BitBuffer {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | (this.bits[i + j] ?? 0);
      }
      bytes.push(byte);
    }
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// Data codeword construction (Byte mode)
// ---------------------------------------------------------------------------

function buildDataCodewords(text: string, v: VersionInfo): number[] {
  const bytes = Array.from(Buffer.from(text, "utf8"));
  const lengthFieldBits = v.version <= 9 ? 8 : 16;
  const dataCodewords = v.totalCodewords - v.ecCodewordsPerBlock * v.numBlocks;

  const buf = new BitBuffer();
  buf.put(0b0100, 4); // Byte mode indicator
  buf.put(bytes.length, lengthFieldBits);
  for (const b of bytes) buf.put(b, 8);

  // Terminator (up to 4 bits of zero padding).
  const capacityBits = dataCodewords * 8;
  const terminatorLen = Math.min(4, capacityBits - buf.length);
  if (terminatorLen > 0) buf.put(0, terminatorLen);

  // Pad to a byte boundary.
  while (buf.length % 8 !== 0) buf.put(0, 1);

  const codewords = buf.toBytes();
  // Pad with alternating 0xEC/0x11 until dataCodewords is reached.
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < dataCodewords) {
    codewords.push(padBytes[padIdx % 2] ?? 0xec);
    padIdx++;
  }
  return codewords;
}

// ---------------------------------------------------------------------------
// Interleave data + EC codewords across blocks (needed for v6+)
// ---------------------------------------------------------------------------

function interleave(dataCodewords: number[], v: VersionInfo): number[] {
  const dataPerBlock = Math.floor(dataCodewords.length / v.numBlocks);
  const blocks: { data: number[]; ec: number[] }[] = [];

  let offset = 0;
  for (let i = 0; i < v.numBlocks; i++) {
    // Distribute any remainder data codewords to the last block(s); for our
    // version table numBlocks*dataPerBlock always equals dataCodewords.length
    // exactly (verified against the table), so this stays simple.
    const blockData = dataCodewords.slice(offset, offset + dataPerBlock);
    offset += dataPerBlock;
    const blockEc = rsEncode(blockData, v.ecCodewordsPerBlock);
    blocks.push({ data: blockData, ec: blockEc });
  }

  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i] ?? 0);
    }
  }
  for (let i = 0; i < v.ecCodewordsPerBlock; i++) {
    for (const block of blocks) {
      result.push(block.ec[i] ?? 0);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

type Module = 0 | 1;
type Grid = (Module | null)[][];

function makeEmptyGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<Module | null>(size).fill(null));
}

/**
 * Bounds-checked cell accessors for the (always-square, size x size) QR
 * grid. All row/col arguments passed by this module's placement functions
 * are derived from the fixed matrix geometry (finder/timing/alignment/
 * format-info coordinates from ISO/IEC 18004), so they are always in range
 * by construction — these helpers exist only to avoid non-null assertions
 * (`grid[r]![c]`) while keeping that invariant enforced at runtime rather
 * than asserted away.
 */
function cellAt(grid: Grid, row: number, col: number): Module | null {
  const value = grid[row]?.[col];
  if (value === undefined) {
    throw new Error(`QR grid cell out of bounds: (${String(row)}, ${String(col)})`);
  }
  return value;
}

function setCellAt(grid: Grid, row: number, col: number, value: Module): void {
  const gridRow = grid[row];
  if (gridRow === undefined || col < 0 || col >= gridRow.length) {
    throw new Error(`QR grid cell out of bounds: (${String(row)}, ${String(col)})`);
  }
  gridRow[col] = value;
}

function placeFinderPattern(grid: Grid, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const gr = row + r;
      const gc = col + c;
      if (gr < 0 || gc < 0 || gr >= grid.length || gc >= grid.length) continue;
      const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
      const isOuterRing =
        r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const isInnerBox = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (isBorder) {
        setCellAt(grid, gr, gc, 0);
      } else if (isOuterRing || isInnerBox) {
        setCellAt(grid, gr, gc, 1);
      } else {
        setCellAt(grid, gr, gc, 0);
      }
    }
  }
}

function placeTimingPatterns(grid: Grid): void {
  const size = grid.length;
  for (let i = 8; i < size - 8; i++) {
    const value: Module = i % 2 === 0 ? 1 : 0;
    if (cellAt(grid, 6, i) === null) setCellAt(grid, 6, i, value);
    if (cellAt(grid, i, 6) === null) setCellAt(grid, i, 6, value);
  }
}

function placeDarkModule(grid: Grid, version: number): void {
  // Dark module is always at (4*version + 9, 8).
  setCellAt(grid, 4 * version + 9, 8, 1);
}

/** Alignment pattern center coordinates by version (versions 2-10 have exactly one, besides finders). */
const ALIGNMENT_CENTERS: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function placeAlignmentPatterns(grid: Grid, version: number): void {
  const centers = ALIGNMENT_CENTERS[version];
  if (centers === undefined) return;
  const size = grid.length;

  for (const row of centers) {
    for (const col of centers) {
      // Skip positions overlapping the three finder patterns (top-left,
      // top-right, bottom-left corners).
      const nearTopLeft = row <= 8 && col <= 8;
      const nearTopRight = row <= 8 && col >= size - 9;
      const nearBottomLeft = row >= size - 9 && col <= 8;
      if (nearTopLeft || nearTopRight || nearBottomLeft) continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isRing = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          setCellAt(grid, row + r, col + c, isRing ? 1 : 0);
        }
      }
    }
  }
}

function reserveFormatAreas(grid: Grid): void {
  const size = grid.length;
  for (let i = 0; i < 9; i++) {
    if (cellAt(grid, 8, i) === null) setCellAt(grid, 8, i, 0);
    if (cellAt(grid, i, 8) === null) setCellAt(grid, i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (cellAt(grid, 8, size - 1 - i) === null) setCellAt(grid, 8, size - 1 - i, 0);
    if (cellAt(grid, size - 1 - i, 8) === null) setCellAt(grid, size - 1 - i, 8, 0);
  }
}

function reserveVersionAreas(grid: Grid, version: number): void {
  if (version < 7) return;
  const size = grid.length;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      setCellAt(grid, r, size - 11 + c, 0);
      setCellAt(grid, size - 11 + c, r, 0);
    }
  }
}

/**
 * Compute the 15-bit format-info codeword (ISO/IEC 18004 Annex C / 8.9):
 * 5 data bits (2-bit EC level + 3-bit mask pattern) protected by a (15,5)
 * BCH code, then XORed with the fixed mask 0b101010000010010 so the format
 * bits are never all-zero for the most common configuration. Computed at
 * runtime via polynomial division over GF(2) rather than a hardcoded
 * constant, so it is provably correct for whichever (ecLevel, maskPattern)
 * this encoder actually uses (currently always level L / mask 0).
 */
function computeFormatInfo(ecLevelBits: number, maskPattern: number): number[] {
  const data = (ecLevelBits << 3) | maskPattern; // 5 bits
  const GENERATOR = 0b10100110111; // g(x) for QR format BCH(15,5), degree 10

  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >>> i) & 1) {
      value ^= GENERATOR << (i - 10);
    }
  }
  const bch = (data << 10) | value; // 15-bit codeword (5 data + 10 EC)
  const masked = bch ^ 0b101010000010010;
  return Array.from({ length: 15 }, (_, i) => (masked >>> (14 - i)) & 1);
}

/** EC level L = 0b01 per ISO/IEC 18004 Table 25; this encoder always uses mask pattern 0. */
function formatInfoBits(): number[] {
  return computeFormatInfo(0b01, 0);
}

/**
 * Place the 15 format-info bits in their two redundant locations around the
 * finder patterns (ISO/IEC 18004 Figure 25 / 8.9). Coordinates below are the
 * standard's fixed (row, col) sequence for bits[0..14], verified against a
 * reference encoder module-by-module:
 *
 *   Primary copy (split across the top-left finder's two arms):
 *     bits[0..5]  -> row 8, col 0..5
 *     bits[6]     -> row 8, col 7        (col 6 is the timing column, skipped)
 *     bits[7]     -> row 8, col 8
 *     bits[8]     -> row 7, col 8
 *     bits[9..14] -> row 5..0, col 8     (row 6 is the timing row, skipped)
 *
 *   Redundant copy (top-right + bottom-left finders):
 *     bits[0..6]  -> row size-1..size-7, col 8      (bottom-left, top to bottom)
 *     bits[7..14] -> row 8, col size-8..size-1       (top-right, left to right)
 */
function placeFormatInfo(grid: Grid): void {
  const size = grid.length;
  const bits = formatInfoBits();

  const primaryRow: [number, number][] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  primaryRow.forEach(([r, c], i) => {
    setCellAt(grid, r, c, (bits[i] ?? 0) as Module);
  });

  // Redundant copy: bits[0..6] down the bottom-left finder's column.
  for (let i = 0; i < 7; i++) {
    setCellAt(grid, size - 1 - i, 8, (bits[i] ?? 0) as Module);
  }
  // Redundant copy: bits[7..14] along the top-right finder's row.
  for (let i = 0; i < 8; i++) {
    setCellAt(grid, 8, size - 8 + i, (bits[7 + i] ?? 0) as Module);
  }
}

function placeDataBits(grid: Grid, codewords: number[]): void {
  const size = grid.length;
  const bits: Module[] = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push(((byte >>> i) & 1) as Module);
    }
  }

  let bitIndex = 0;
  let col = size - 1;
  let upward = true;

  while (col > 0) {
    if (col === 6) col--; // skip timing column

    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (cellAt(grid, row, c) !== null) continue; // reserved (finder/timing/alignment/format)
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex++;
        // Mask pattern 0: (row + col) % 2 === 0 flips the bit.
        const masked = ((row + c) % 2 === 0 ? (bit ?? 0) ^ 1 : (bit ?? 0)) as Module;
        setCellAt(grid, row, c, masked);
      }
    }

    upward = !upward;
    col -= 2;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QrMatrix {
  size: number;
  modules: Module[][];
}

/**
 * Encode `text` as a QR Code matrix (Byte mode, EC level L, mask 0).
 * Throws {@link QrTooLargeError} if the text exceeds the max capacity this
 * minimal encoder supports (versions 1-10).
 */
export function encodeQr(text: string): QrMatrix {
  const byteLength = Buffer.byteLength(text, "utf8");
  const v = pickVersion(byteLength);

  const dataCodewords = buildDataCodewords(text, v);
  const allCodewords =
    v.numBlocks > 1
      ? interleave(dataCodewords, v)
      : [...dataCodewords, ...rsEncode(dataCodewords, v.ecCodewordsPerBlock)];

  const grid = makeEmptyGrid(v.size);
  placeFinderPattern(grid, 0, 0);
  placeFinderPattern(grid, 0, v.size - 7);
  placeFinderPattern(grid, v.size - 7, 0);
  placeAlignmentPatterns(grid, v.version);
  placeTimingPatterns(grid);
  placeDarkModule(grid, v.version);
  reserveFormatAreas(grid);
  reserveVersionAreas(grid, v.version);
  placeDataBits(grid, allCodewords);
  placeFormatInfo(grid);

  const modules: Module[][] = grid.map((row) => row.map((cell) => cell ?? 0));
  return { size: v.size, modules };
}

/**
 * Render a QR matrix as a string using half-block Unicode characters so each
 * terminal character row represents two module rows — the standard trick for
 * compact, correctly-proportioned ASCII/Unicode QR codes in a terminal.
 * Falls back cleanly to plain block characters; includes a quiet-zone border
 * (required for real-world scanners to lock on).
 */
export function renderQrAscii(matrix: QrMatrix): string {
  const quiet = 2;
  const size = matrix.size;
  const padded: Module[][] = [];
  const paddedSize = size + quiet * 2;
  for (let r = 0; r < paddedSize; r++) {
    const row: Module[] = [];
    for (let c = 0; c < paddedSize; c++) {
      const inBounds = r >= quiet && r < quiet + size && c >= quiet && c < quiet + size;
      row.push(inBounds ? (matrix.modules[r - quiet]?.[c - quiet] ?? 0) : 0);
    }
    padded.push(row);
  }

  const lines: string[] = [];
  for (let r = 0; r < paddedSize; r += 2) {
    let line = "";
    for (let c = 0; c < paddedSize; c++) {
      const top = padded[r]?.[c] ?? 0;
      const bottom = padded[r + 1]?.[c] ?? 0;
      if (top === 1 && bottom === 1)
        line += "█"; // full block
      else if (top === 1 && bottom === 0)
        line += "▀"; // upper half
      else if (top === 0 && bottom === 1)
        line += "▄"; // lower half
      else line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Convenience: encode + render in one call. */
export function qrAsciiFor(text: string): string {
  return renderQrAscii(encodeQr(text));
}
