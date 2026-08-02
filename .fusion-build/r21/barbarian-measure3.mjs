import fs from 'node:fs';
import path from 'node:path';

const VENDOR = 'tools/importer-pf2e/vendor/pf2e/packs/pf2e';
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}
function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

const classDoc = readJson(path.join(VENDOR, 'classes/barbarian.json'));
const itemsMap = classDoc.system.items;
const featuresByLevel = Object.entries(itemsMap).map(([key, v]) => ({
  level: v.level, canonicalName: v.uuid.split('.').pop(),
})).sort((a, b) => a.level - b.level);

const bFeatFiles = walk(path.join(VENDOR, 'feats/class/barbarian'));
const bFeats = bFeatFiles.map(readJson);
const sharedFiles = walk(path.join(VENDOR, 'feats/class/shared-class-feats'));
const sharedBarb = sharedFiles.map(readJson).filter(d => (d.system.traits?.value ?? []).includes('barbarian'));

const instinctNames = ['Animal Instinct','Decay Instinct','Dragon Instinct','Elemental Instinct','Fury Instinct','Giant Instinct','Ligneous Instinct','Spirit Instinct','Superstition Instinct'];

const knownNames = new Set([
  ...featuresByLevel.map(f => norm(f.canonicalName)),
  ...bFeats.map(f => norm(f.name)),
  ...sharedBarb.map(f => norm(f.name)),
  ...instinctNames.map(norm),
]);

let internalChains = 0;
let nonMechanizable = 0;
const externalRefs = [];
const examples = [];
const allFeats = [...bFeats, ...sharedBarb];
for (const d of allFeats) {
  const prereqs = d.system.prerequisites?.value ?? [];
  if (prereqs.length === 0) continue;
  const texts = prereqs.map(pr => pr.value);
  let hasInternal = false, hasExternal = false, hasNonMech = false;
  for (const t of texts) {
    const nt = norm(t);
    if (knownNames.has(nt)) { hasInternal = true; continue; }
    if (/trained|expert|master|legendary in|proficiency|acute scent|scent|low-light|darkvision|rage\b/i.test(t) && !/instinct/i.test(t)) {
      hasNonMech = true; continue;
    }
    hasExternal = true;
    externalRefs.push({ feat: d.name, text: t });
  }
  if (hasInternal) internalChains++;
  if (hasNonMech && !hasInternal) nonMechanizable++;
  if (examples.length < 6 && prereqs.length > 0) examples.push({ name: d.name, level: d.system.level.value, prerequisites: prereqs, sourceId: d._id, traits: d.system.traits.value });
}

console.log('internalChains (at least one prereq resolves to a barbarian feat/feature/instinct):', internalChains);
console.log('nonMechanizable (skill/sense-trained text, no internal match):', nonMechanizable);
console.log('externalRefs (unresolved):', JSON.stringify(externalRefs, null, 2));
console.log('examples:', JSON.stringify(examples, null, 2));

// how many feats have ANY prerequisites at all
const withPrereq = allFeats.filter(d => (d.system.prerequisites?.value ?? []).length > 0);
console.log('\ntotal feats(barbarian+shared) with any prerequisite text:', withPrereq.length, '/', allFeats.length);
