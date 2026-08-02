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

const classDoc = readJson(path.join(VENDOR, 'classes/barbarian.json'));
const itemsMap = classDoc.system.items;
const featuresByLevel = Object.entries(itemsMap).map(([key, v]) => {
  const canonicalName = v.uuid.split('.').pop();
  return { level: v.level, canonicalName };
}).sort((a, b) => a.level - b.level);

const cfFiles = walk(path.join(VENDOR, 'class-features'));
const cfByName = new Map();
for (const p of cfFiles) {
  const doc = readJson(p);
  if (!doc.system) continue;
  cfByName.set(doc.name, { path: p, id: doc._id, doc });
}

// load our packs
function loadPack(name) {
  const p = `systems/pf2e/packs/${name}/documents.json`;
  if (!fs.existsSync(p)) return [];
  const docs = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return Array.isArray(docs) ? docs : docs.documents || Object.values(docs);
}
const cfCore = loadPack('class-features-core');
const cfCoreBySourceId = new Map(cfCore.map(d => [d.flags?.fusion?.sourceId, d]));
const cfCoreByName = new Map(cfCore.map(d => [d.name, d]));

const actionsCore = loadPack('actions-core');
const actionsBySourceId = new Map(actionsCore.map(d => [d.flags?.fusion?.sourceId, d]));

console.log('=== BARBARIAN FEATURES x class-features-core (by sourceId=_id) ===');
for (const f of featuresByLevel) {
  const hit = cfByName.get(f.canonicalName);
  if (!hit) { console.log(`${f.canonicalName}: NO VENDOR FILE`); continue; }
  const inCore = cfCoreBySourceId.get(hit.id);
  const nameCollision = cfCoreByName.get(f.canonicalName);
  console.log(`${f.canonicalName} (L${f.level}) vendorId=${hit.id} -> inPacksBySourceId=${inCore ? 'YES' : 'no'} nameCollisionDiffId=${nameCollision && !inCore ? 'YES(' + JSON.stringify(nameCollision.flags?.fusion?.sourceId) + ')' : 'no'}`);
}

console.log('\n=== Rage action (extra, outside items{}) ===');
const rageFeatureDoc = readJson(path.join(VENDOR, 'class-features/rage.json'));
console.log('Rage class-feature grants uuid:', JSON.stringify(rageFeatureDoc.system.rules));
// find the actionspf2e Rage action file
const actionFiles = walk(path.join(VENDOR, 'actions'));
const rageActionFile = actionFiles.find(p => { const d = readJson(p); return d.name === 'Rage'; });
if (rageActionFile) {
  const d = readJson(rageActionFile);
  console.log('vendor action file:', rageActionFile, 'id=', d._id);
  console.log('in actions-core by sourceId:', actionsBySourceId.has(d._id) ? 'YES' : 'no');
}

console.log('\n=== Instinct axis: check sourceId presence in feats-core (instincts stored as type=feat) ===');
const featsCore = loadPack('feats-core');
const featsCoreBySourceId = new Map(featsCore.map(d => [d.flags?.fusion?.sourceId, d]));
const instinctNames = ['Animal Instinct','Decay Instinct','Dragon Instinct','Elemental Instinct','Fury Instinct','Giant Instinct','Ligneous Instinct','Spirit Instinct','Superstition Instinct','Bloodrager'];
for (const n of instinctNames) {
  const hit = cfByName.get(n);
  if (!hit) { console.log(n, 'NO FILE'); continue; }
  console.log(n, 'id=', hit.id, 'inClassFeaturesCoreBySourceId=', cfCoreBySourceId.has(hit.id), 'inFeatsCoreBySourceId=', featsCoreBySourceId.has(hit.id));
}

// class feats: barbarian trait, category class
console.log('\n=== CLASS FEATS: feats/class/barbarian ===');
const bFeatFiles = walk(path.join(VENDOR, 'feats/class/barbarian'));
console.log('file count:', bFeatFiles.length);
const byLevel = {};
const prereqExamples = [];
let internalChainCount = 0;
let nonMechanizable = 0;
const externalRefs = new Set();
for (const p of bFeatFiles) {
  const d = readJson(p);
  const lvl = d.system.level.value;
  byLevel[lvl] = (byLevel[lvl] || 0) + 1;
  const prereqs = d.system.prerequisites?.value ?? [];
  if (prereqs.length > 0) {
    const texts = prereqs.map(pr => pr.value);
    const isInternal = texts.some(t => bFeatFiles.some(p2 => readJson(p2).name === t) || featuresByLevel.some(f => f.canonicalName === t));
    if (isInternal) internalChainCount++;
    else {
      // check plausible mechanization: simple "trained in X" style
      const looksSkill = texts.some(t => /trained|expert|master|legendary/i.test(t));
      if (looksSkill) nonMechanizable++;
      else externalRefs.add(texts.join(' | '));
    }
    if (prereqExamples.length < 6) prereqExamples.push({ name: d.name, level: lvl, prerequisites: prereqs, sourceId: d._id });
  }
}
console.log('by level:', JSON.stringify(byLevel));
console.log('internalChainCount:', internalChainCount, 'nonMechanizable(skill-trained-text):', nonMechanizable, 'externalRefs:', [...externalRefs]);
console.log('prereq examples:', JSON.stringify(prereqExamples, null, 2));

let inFeatsCore = 0;
for (const p of bFeatFiles) {
  const d = readJson(p);
  if (featsCoreBySourceId.has(d._id)) inFeatsCore++;
}
console.log('barbarian class feats already in feats-core (by sourceId):', inFeatsCore, '/', bFeatFiles.length);

console.log('\n=== shared-class-feats with barbarian trait ===');
const sharedFiles = walk(path.join(VENDOR, 'feats/class/shared-class-feats'));
const sharedBarb = sharedFiles.filter(p => {
  const d = readJson(p);
  return (d.system.traits?.value ?? []).includes('barbarian');
});
console.log('count:', sharedBarb.length);
for (const p of sharedBarb) {
  const d = readJson(p);
  console.log(`- ${d.name} L${d.system.level.value} traits=${JSON.stringify(d.system.traits.value)} inFeatsCore=${featsCoreBySourceId.has(d._id)}`);
}

console.log('\n=== focus spells granted by barbarian? ===');
// check for focus point / focus spell rules in barbarian-tagged files
const focusFiles = walk(path.join(VENDOR, 'spells/focus'));
const barbFocus = focusFiles.filter(p => {
  const d = readJson(p);
  return (d.system?.traits?.value ?? []).includes('barbarian');
});
console.log('focus spells with barbarian trait:', barbFocus.length);

console.log('done');
