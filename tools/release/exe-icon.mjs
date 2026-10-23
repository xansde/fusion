/**
 * Windows executable icon for the SEA release (Node single-executable).
 *
 * - packIco: packs PNG images into a multi-size .ico (PNG-compressed entries).
 * - applyIcon: stamps the .ico on a PE file with `resedit` (pure JS).
 *
 * ORDER MATTERS: applyIcon must run on the copied node.exe BEFORE postject
 * injects NODE_SEA_BLOB. resedit rewrites the resource section; running it after
 * the blob is in place risks dropping the injected resource.
 *
 * The committed assets/fusion.ico is derived from the Fusion mark
 * (packages/client/public/favicon.svg / icon-512.png) — see assets/regen-ico.ps1.
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as ResEdit from "resedit";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICON_GROUP_ID = 1;
const LANG_NEUTRAL = 0;

/** @param {Buffer[]} pngs @returns {Buffer} */
export function packIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`packIco: entry ${i} is not a PNG`);
    }
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const e = 6 + 16 * i;
    header[e] = w >= 256 ? 0 : w;
    header[e + 1] = h >= 256 ? 0 : h;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bit count
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** @param {Buffer} ico @returns {number[]} */
export function readIcoSizes(ico) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => ico[6 + 16 * i] || 256);
}

/**
 * Stamps `icoPath` on the PE at `exePath` (in place). node.exe ships Authenticode-signed;
 * `ignoreCert` drops that signature (already invalidated by the SEA injection, DA-02).
 */
export function applyIcon(exePath, icoPath) {
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(readFileSync(icoPath));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    ICON_GROUP_ID,
    LANG_NEUTRAL,
    iconFile.icons.map((item) => item.data),
  );
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
}

/** Sizes of the icons in the exe's first icon group (for verification). */
export function readExeIconSizes(exePath) {
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length === 0) return [];
  const group = groups[0];
  return group.icons.map((icon) => icon.width || 256).sort((a, b) => a - b);
}
