import fs from 'node:fs';
import path from 'node:path';

const VENDOR = 'tools/importer-pf2e/vendor/pf2e/packs/pf2e';
const CLASS_SLUG = 'barbarian';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

// 1. class doc
const classDoc = readJson(path.join(VENDOR, 'classes', `${CLASS_SLUG}.json`));
const itemsMap = classDoc.system.items;

console.log('=== CLASS ITEMS MAP (canonical name = uuid final segment) ===');
const featuresByLevel = Object.entries(itemsMap).map(([key, v]) => {
  const canonicalName = v.uuid.split('.').pop();
  return { key, level: v.level, entryName: v.name, canonicalName };
}).sort((a, b) => a.level - b.level);
featuresByLevel.forEach(f => console.log(`L${f.level}\t${f.canonicalName}${f.entryName !== f.canonicalName ? `  [entry.name MISMATCH: "${f.entryName}"]` : ''}`));
console.log('total items:', featuresByLevel.length);

// 2. all 27 classes items maps, for shared-count
const classFiles = fs.readdirSync(path.join(VENDOR, 'classes')).filter(f => f.endsWith('.json'));
console.log('\n=== TOTAL CLASSES IN VENDOR ===', classFiles.length);
const allClassItems = {}; // canonicalName -> [classSlug,...]
for (const cf of classFiles) {
  const slug = cf.replace('.json', '');
  const doc = readJson(path.join(VENDOR, 'classes', cf));
  for (const v of Object.values(doc.system.items)) {
    const canonicalName = v.uuid.split('.').pop();
    if (!allClassItems[canonicalName]) allClassItems[canonicalName] = [];
    allClassItems[canonicalName].push({ slug, level: v.level });
  }
}

console.log('\n=== SHARED STATUS FOR EACH BARBARIAN FEATURE ===');
for (const f of featuresByLevel) {
  const refs = allClassItems[f.canonicalName];
  const otherClasses = refs.filter(r => r.slug !== CLASS_SLUG);
  console.log(`${f.canonicalName}: referenced by ${refs.length} classes total (${otherClasses.length} other) -> ${otherClasses.map(r => `${r.slug}@${r.level}`).join(', ')}`);
}

// 3. class-features directory: find file for each canonical name
console.log('\n=== CLASS-FEATURE FILES (slug match) ===');
const cfFiles = walk(path.join(VENDOR, 'class-features'));
const cfBySlug = new Map();
for (const p of cfFiles) {
  const doc = readJson(p);
  if (!doc.system) continue;
  cfBySlug.set(doc.name, { path: p, doc });
}
console.log('total class-features files:', cfFiles.length);

for (const f of featuresByLevel) {
  const hit = cfBySlug.get(f.canonicalName);
  if (!hit) {
    console.log(`MISSING FILE for canonical name "${f.canonicalName}"`);
    continue;
  }
  const sys = hit.doc.system;
  const otherTags = sys.traits?.otherTags ?? [];
  const genericLevel = sys.level?.value;
  const subProf = sys.subfeatures?.proficiencies ?? null;
  const rulesLen = (sys.rules ?? []).length;
  console.log(`${f.canonicalName} | file=${path.basename(hit.path)} | genericLevel=${genericLevel} classLevel=${f.level} ${genericLevel !== f.level ? 'DIVERGE' : ''} | otherTags=${JSON.stringify(otherTags)} | proficiencies=${JSON.stringify(subProf)} | rules[]len=${rulesLen}`);
}

// 4. otherTag axis: barbarian-instinct options
console.log('\n=== barbarian-instinct axis ===');
const instinctFiles = cfFiles.filter(p => {
  const doc = readJson(p);
  if (!doc.system) return false;
  return (doc.system.traits?.otherTags ?? []).includes('barbarian-instinct');
});
console.log('count:', instinctFiles.length);
for (const p of instinctFiles) {
  const doc = readJson(p);
  console.log(`- ${doc.name} (file=${path.basename(p)}) level=${doc.system.level?.value} rules[]len=${(doc.system.rules ?? []).length} traits=${JSON.stringify(doc.system.traits)}`);
}

fs.writeFileSync('.fusion-build/r21/barbarian-instinct-full.json', JSON.stringify(instinctFiles.map(p => readJson(p)), null, 2));

console.log('\ndone');
