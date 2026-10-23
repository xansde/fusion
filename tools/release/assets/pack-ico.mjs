// Usage: node pack-ico.mjs <out.ico> <png>...   (helper for regen-ico.ps1)
import { readFileSync, writeFileSync } from "node:fs";
import { packIco } from "../exe-icon.mjs";

const [out, ...pngs] = process.argv.slice(2);
writeFileSync(out, packIco(pngs.map((p) => readFileSync(p))));
