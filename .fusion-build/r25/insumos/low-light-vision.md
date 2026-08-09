# Insumo — documento autoral `Low-Light Vision` (ancestry-features-core)

> Escrito em 2026-08-08 na worktree `wt-ficha-fofurinha` (branch
> `feat/ficha-alvo-fofurinha`). **É insumo, não aplicação**: nada em
> `build-mvp-subset.mjs` foi editado, nenhum pack foi reconstruído, nada foi
> commitado — três outros agentes têm insumo para o mesmo arquivo e a edição
> concorrente causa rollback silencioso (§5.3 do handoff).
>
> Lacuna da catraca que este insumo fecha:
> `conteudo:ancestry-features-core/Low-Light Vision`.

---

## 1. A prova de ausência (rodada, não deduzida)

### 1.1 Não existe em pack nenhum — nem nosso, nem do vendor normalizado

Varredura por **nome exato** nos 14 packs de `tools/importer-pf2e/out/`
(16.423 documentos) e nos 14 packs publicados em `systems/pf2e/packs/`
(4.237 documentos):

```bash
cd tools/importer-pf2e && node -e "
const fs=require('fs'),path=require('path');
const targets=['Low-Light Vision','Darkvision','Greater Darkvision'];
for(const t of targets){
  const found=[];
  for(const r of fs.readdirSync('out',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)){
    const f=path.join('out',r,'normalized.json'); if(!fs.existsSync(f))continue;
    let arr; try{arr=JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){continue;}
    if(!Array.isArray(arr))continue;
    for(const d of arr) if(String(d.name).trim()===t) found.push(r+'/'+d.type+'/'+d._id);
  }
  console.log(t+' -> vendor out/: '+(found.length?found.join(', '):'ABSENT'));
}
const P='../../systems/pf2e/packs';
for(const t of targets){
  const found=[];
  for(const pack of fs.readdirSync(P)){
    const p=path.join(P,pack,'documents.json'); if(!fs.existsSync(p))continue;
    for(const d of JSON.parse(fs.readFileSync(p,'utf8'))) if(String(d.name).trim()===t) found.push(pack+'/'+d.type);
  }
  console.log(t+' -> published: '+(found.length?found.join(', '):'ABSENT'));
}
"
```

Saída observada:

```
Low-Light Vision    -> vendor out/: ABSENT
Darkvision          -> vendor out/: familiar-abilities/action/0Xrkk46IM43iI1Fv, spells/spell/pZTqGY1MLRjgKasV
Greater Darkvision  -> vendor out/: ancestry-features/feat/vPhPgzpRjYDMT9Kq

Low-Light Vision    -> published: ABSENT
Darkvision          -> published: familiar-abilities-core/action, spells-core/spell
Greater Darkvision  -> published: ancestry-features-core/feat
```

Busca por `sourceId` também: não há o que buscar — nenhum documento com esse
nome existe em nenhum dos dois lados, então não há `sourceId` para procurar.
E a busca por conteúdo (`/low.?light/i` sobre o JSON inteiro) nos 55 docs de
`out/ancestry-features/normalized.json` retorna **1 acerto** e ele é só menção
em prosa: `Basic Undead Benefits` ("You gain low-light vision, or you gain
darkvision if your ancestry already has low-light vision").

### 1.2 No clone do vendor inteiro (615 MB) há dois arquivos, e nenhum serve

```bash
cd tools/importer-pf2e && find vendor/pf2e/packs -iname "*low*light*" -print
```

```
vendor/pf2e/packs/pf2e/bestiary-ability-glossary-srd/low-light-vision.json
vendor/pf2e/packs/pf2e/equipment-effects/effect-glowing-lantern-fruit-lantern-light.json
vendor/pf2e/packs/pf2e/kingmaker-features/army-tactics/low-light-vision.json
vendor/pf2e/packs/pf2e/spells/spells/rank-2/swallow-light.json
vendor/pf2e/packs/pf2e/spells/spells/rank-4/dawnflowers-light.json
```

Os dois homônimos reais, lidos na íntegra:

| arquivo | `type` | por que não serve |
|---|---|---|
| `bestiary-ability-glossary-srd/low-light-vision.json` | `action` (`category: "interaction"`) | é a **entrada de glossário de NPC**, e a descrição é só `<p>@Localize[PF2E.NPC.Abilities.Glossary.LowLightVision]</p>` — **não tem texto**. Nosso pin do vendor é um clone parcial (só `packs/`, sem `static/lang/`), então não existe nem a string para transcrever. Além disso `bestiary-ability-glossary-srd` **não é um dos packs importados**. |
| `kingmaker-features/army-tactics/low-light-vision.json` | `campaignFeature` (`campaign: "kingmaker"`, `category: "army-tactic"`) | é **tática de exército** do Kingmaker ("The army includes several spotters and scouts…"). Pack não importado, tipo que nosso schema nem conhece. |

Terceira passada, agora pelo token camelCase que o Foundry usa em chave de
i18n — `grep -rl "LowLightVision" vendor/pf2e/` no clone inteiro devolve
**8 arquivos**, e a natureza de cada um fecha o caso:

| arquivo(s) | forma da menção |
|---|---|
| `bestiary-ability-glossary-srd/low-light-vision.json` + 3 bestiários de Tian Xia | `<p>@Localize[PF2E.NPC.Abilities.Glossary.LowLightVision]</p>` — chave, não texto |
| `feats/ancestry/awakened-animal/…/natural-senses.json`, `feats/…/beastkin/animal-senses.json`, `feats/class/sorcerer/level-20/bloodline-mutation.json`, `spell-effects/spell-effect-humanoid-form.json` | `label: "PF2E.Actor.Creature.Sense.Type.LowLightVision"` dentro de um rule element `Sense` — chave de rótulo, não documento |

Ou seja: no vendor o sentido existe **só como chave de localização**, e o pin do
clone não traz `static/lang/`, então nem a string por trás da chave está no
disco. Não há prosa a transcrever de lugar nenhum.

**Veredito: falta de verdade.** Não é "só selecionar/converter".

### 1.3 Como o vendor EXPRESSA o sentido hoje — não é rule element, é um escalar

Não é `Sense`/`FlatModifier` dentro da ancestralidade, como o handoff supunha.
`vendor/pf2e/packs/pf2e/ancestries/elf.json` (trecho real, `system.rules` está
**vazio**):

```json
{
    "_id": "PgKmsA2aKdbLU6O0",
    "name": "Elf",
    "type": "ancestry",
    "system": {
        "items": {},
        "rules": [],
        "size": "med",
        "speed": 30,
        "vision": "low-light-vision"
    }
}
```

O sentido é um **campo escalar `system.vision`**, e ele sobrevive ao importer:
`systems/pf2e/packs/ancestries-core/documents.json` → `Elf.system.vision ===
"low-light-vision"`. O schema declara o campo
(`systems/pf2e/src/schemas/item-equipment.ts:287`, `vision: z.string().default("normal")`).

E o cliente **já mostra o rótulo**: `packages/client/src/lib/sheets/pf2e/planVM.ts`

```ts
// linha 1143
const VISION_LABELS: Record<string, string> = {
  "low-light-vision": "Low-Light Vision",
  darkvision: "Darkvision",
  "greater-darkvision": "Greater Darkvision",
  normal: "Normal Vision",
};
// linhas 1212-1215, em abcChipsFor(), só para kind === "ancestry"
const vision = sys["vision"];
if (typeof vision === "string" && vision !== "normal") {
  chips.push({ key: "scalar:vision", name: VISION_LABELS[vision] ?? vision });
}
```

Ou seja: **o chip "Low-Light Vision" já aparece na ficha do Elfo**, mas é um chip
*informativo* — sem `detailsPackSlug`, sem `sourceId`, logo **não clicável e sem
documento por trás**. É exatamente esse o formato da lacuna: o rótulo existe, o
documento não.

### 1.4 O vizinho vendor mais próximo é do próprio pack

`Greater Darkvision` (`out/ancestry-features` → `ancestry-features-core`,
`sourceId: vPhPgzpRjYDMT9Kq`, `_id: zhUu9vo5wME7MHXo`) é `type: "feat"`,
`system.category: "ancestryfeature"`, `system.level: 0`, `system.rules: []`,
`img: "icons/placeholder/feat.svg"`, `publication: {license:"ORC", remaster:true,
title:"Pathfinder Player Core"}`. É o sentido **irmão**, no mesmo pack, com a
mesma licença e o mesmo livro — é dele que o documento autoral copia a forma
(nunca o texto).

### 1.5 Achado adjacente: a lacuna é simétrica

`Darkvision` **também não existe** como ancestry-feature (só como habilidade de
familiar e como magia). `Greater Darkvision` existe. Isto é, o vendor publica
documento para o sentido *superior* e não para os dois básicos. Atinge as 3
ancestralidades de `darkvision` do pack (Dwarf, Goblin, Orc) do mesmo jeito.
**Não é escopo desta lacuna da catraca** — mas se o dono quiser fechar os dois
de uma vez, o documento de `Darkvision` sai do mesmo molde (`_id`
`FusionDarkvisio1`, 16 chars) e vale um item de backlog próprio.

---

## 2. Suporte a sentido no Fusion hoje: descritor publicado, motor inerte

Três medições, nesta ordem:

1. **O importer converte e marca como suportado.**
   `tools/importer-pf2e/src/transform.mjs:123` → `Sense: "supported"`;
   `:378` `convertSense(re)` emite `{kind:"sense", slug, label, senseType,
   acuity, range, predicate, priority, raw}`.
2. **O schema aceita.** `EffectRuleSchema`
   (`systems/pf2e/src/schema-primitives.ts:169`) é `.passthrough()` e só exige
   um discriminador `kind` **ou** `type`. E o pack **já publica** descritores de
   sentido: 8 em `heritages-core`, 6 em `feats-core`, 6 em
   `familiar-abilities-core`, 1 em `ancestry-features-core`.
3. **Nada consome.** `systems/engine-2e/src/effectsEngine.ts` trata só
   `rollOption`, `flatModifier`, `note`, `toggleCondition`, `iwr` — não há
   `case "sense"`. E `systems/pf2e/src/derivations/build.ts:358` inicializa
   `perception = { rank: 0, senses: [] }` e nunca preenche `senses` (nem pela
   regra, nem pelo `system.vision` da ancestralidade). O `SenseDataSchema`
   existe (`schema-primitives.ts:99`) e `perception.senses` existe no ator
   (`actor-character.ts:332`), mas ficam vazios.

**Conclusão: emitir o rule element é CERTO e é INERTE.** Certo porque é
exatamente a forma canônica que o importer já publica para o mesmo sentido
(`Twilight Halfling`, `heritages-core`, é byte-a-byte o mesmo descritor com
`selector: "low-light-vision"`), passa o schema, e fica pronto para quando o
motor ganhar o `case`. Inerte porque hoje não confere nada — **a limitação está
marcada no próprio `flags.fusion.authored.mechanicsLimitation`** do documento
abaixo, para não virar promessa silenciosa.

---

## 3. O documento autoral, pronto para colar

`type: "feat"` e `system.category: "ancestryfeature"` — **medido**, não
adivinhado: os 55 documentos de `ancestry-features-core` são 100% `type: "feat"`
(`{"feat":55}`), e o vizinho `Greater Darkvision` usa
`category: "ancestryfeature"` (que é um dos valores lidos por `buildIndex` —
`indexFields` do manifesto inclui `system.category`).

`_id`/`sourceId` = **`FusionLowLight01`** — 16 caracteres, igual ao precedente
`FusionSmuggler01`, e verificado sem colisão contra os 4.237 `_id` e 4.237
`sourceId` dos packs publicados.

Colar em `tools/importer-pf2e/src/build-mvp-subset.mjs`, junto ao
`SMUGGLER_AUTHORED_DOC` (linha 588), **depois** dele — `IMPORTER_VERSION` já
está no escopo do módulo (linha 65).

```js
/**
 * r25 (ficha-alvo Fofurinha) — SECOND authored document of the project.
 *
 * The Elf's own sense has no document in ANY base. Measured on 2026-08-08:
 *
 *   - all 14 vendor `out/` packs (16,423 docs), by exact name: ABSENT;
 *   - all 14 published packs (4,237 docs), by exact name: ABSENT;
 *   - the 615 MB foundryvtt/pf2e clone carries exactly two files named
 *     low-light-vision.json, and neither is an ancestry feature:
 *       * bestiary-ability-glossary-srd/ — an NPC glossary `action` whose whole
 *         description is `@Localize[PF2E.NPC.Abilities.Glossary.LowLightVision]`
 *         (no text at all; our vendor pin has no static/lang/), in a pack we do
 *         not import;
 *       * kingmaker-features/army-tactics/ — a `campaignFeature` army tactic,
 *         also in a pack we do not import.
 *
 * The vendor expresses the sense as a SCALAR on the ancestry
 * (`ancestries/elf.json` → `system.vision: "low-light-vision"`, with
 * `system.rules: []` and `system.items: {}`), never as an item and never as a
 * rule element. So there is nothing to select or convert — the catalogue entry
 * has to be authored. This hits EVERY low-light ancestry (5 of the 10 published:
 * Elf, Fleshwarp, Gnome, Leshy, Ratfolk; 24 of the vendor's 50), plus the 3
 * published documents that GRANT the sense via a Sense rule element
 * (heritages-core: Twilight Halfling, Sylph; feats-core: Bloodline Mutation).
 *
 * Nearest vendor neighbour: `Greater Darkvision` (this very pack,
 * sourceId vPhPgzpRjYDMT9Kq, ORC / Player Core) — the sibling sense. Its SHAPE
 * is the model here (type/category/level/img/publication); its TEXT is not
 * copied. The description below is written from the PF2e rule for the sense and
 * mirrors the neighbour's sentence structure so the pack reads as one voice.
 *
 * The `sense` rule element is the canonical descriptor `convertSense`
 * (transform.mjs:378) already publishes for this exact selector — see
 * heritages-core "Twilight Halfling", which is byte-identical. It is
 * schema-valid and forward-compatible, and it is INERT today: engine-2e's
 * effectsEngine handles only rollOption/flatModifier/note/toggleCondition/iwr,
 * and derivations/build.ts:358 leaves `perception.senses` empty. Recorded in
 * `flags.fusion.authored.mechanicsLimitation` so it is not a silent promise.
 *
 * @see SMUGGLER_AUTHORED_DOC for the precedent this follows.
 */
const LOW_LIGHT_VISION_AUTHORED_DOC = {
  _id: "FusionLowLight01",
  name: "Low-Light Vision",
  type: "feat",
  img: "icons/placeholder/feat.svg",
  system: {
    actionType: "passive",
    actions: null,
    category: "ancestryfeature",
    description:
      "<p>You can see in dim light as though it were bright light, so you ignore the " +
      "@UUID[Compendium.pf2e.conditionitems.Item.Concealed] condition due to dim light.</p>",
    // Ancestry features are auto-conceded and carry level 0 in the vendor data;
    // FeatSystemSchema floors `level` at 0 for exactly this reason.
    level: 0,
    prerequisites: [],
    publication: {
      license: "ORC",
      remaster: true,
      title: "Pathfinder Player Core",
    },
    rules: [
      {
        kind: "sense",
        slug: null,
        label: null,
        senseType: null,
        acuity: "precise",
        range: null,
        predicate: null,
        priority: null,
        raw: { key: "Sense", selector: "low-light-vision" },
      },
    ],
    traits: { rarity: "common", value: [] },
  },
  flags: {
    fusion: {
      conversion: "authored",
      importerVersion: IMPORTER_VERSION,
      sourceVersion: "authored",
      sourceId: "FusionLowLight01",
      packName: "ancestry-features",
      unconvertedRules: [],
      assetSubstitutions: [],
      authored: {
        reason:
          "absent by exact name from all 14 vendor out/ packs (16,423 docs) and all 14 published packs (4,237 docs); the only vendor homonyms are an NPC glossary action with no text (@Localize key, pack not imported) and a Kingmaker army tactic",
        book: "Pathfinder Player Core",
        transcribedFrom:
          "authored from the PF2e rule for the sense; the vendor expresses it only as the ancestry scalar system.vision",
        nearestVendorNeighbour:
          "Greater Darkvision (ancestry-features, sourceId vPhPgzpRjYDMT9Kq) — sibling sense, shape copied, text not",
        mechanicsLimitation:
          "the `sense` rule element is inert: engine-2e effectsEngine has no `sense` case and derivations/build.ts leaves perception.senses empty. Descriptor emitted for schema/forward compatibility only",
      },
    },
  },
};
```

**Verificado contra o schema real** (não conferido a olho): o `system` acima
passa `parseFeatSystem` de `systems/pf2e/src/schemas/item-feat.ts`. Rodado num
teste vitest descartável em `packages/client` (mesmo caminho de resolução do
`classBuildHarness`), `1 passed`, e o arquivo foi **apagado em seguida**
(`git status` limpo).

---

## 4. A injeção idempotente

No bloco `// --- 14. Ancestry features core ---` de `build-mvp-subset.mjs`
(hoje linhas ~1678-1701). O bloco atual é:

```js
    const all = loadTransformed("ancestry-features");
    const docs = all;
    console.log(`[build-mvp] ancestry-features-core: ${docs.length} ancestry features`);
```

Aplicar assim — **duas mudanças**, na ordem:

```js
    const all = loadTransformed("ancestry-features");
    // Copy, not alias: the authored injection below pushes into `docs`, and
    // `all` is used for the count message.
    const docs = [...all];

    // Low-Light Vision (Player Core) is AUTHORED, not selected — the vendor
    // carries the sense only as the ancestry scalar `system.vision`, never as a
    // document. Idempotent: a future vendor snapshot that ships a real
    // "Low-Light Vision" ancestry feature wins, and this becomes a no-op
    // instead of creating a homonym pair.
    if (!docs.some((d) => d.name === LOW_LIGHT_VISION_AUTHORED_DOC.name)) {
      docs.push(structuredClone(LOW_LIGHT_VISION_AUTHORED_DOC));
      console.log(
        "[build-mvp] ancestry-features-core: injected AUTHORED Low-Light Vision (sense has no document in the vendor — only the ancestries' system.vision scalar)",
      );
    }

    console.log(`[build-mvp] ancestry-features-core: ${docs.length} ancestry features`);
```

### Uma divergência deliberada do precedente do Smuggler: NÃO re-ordenar

O Smuggler faz `docs.sort(...)` porque `backgrounds-core` sai do vendor
**ordenado por nome**, e sem o sort o doc autoral cairia na cauda. Já
`ancestry-features-core` **não sai ordenado por nome** — sai na ordem de
diretório do vendor, que é alfabética por *ancestralidade*:

```
Fangs (Anadi) | Constructed (Android) | Emotionally Unaware (Android) |
Automaton Core | Constructed Body | Animal Attack (Awakened Animal) | ...
```

Aplicar `sort` aqui trocaria de lugar todos os 55 documentos e produziria um
diff ilegível em `documents.json` — o oposto do motivo pelo qual o Smuggler
ordena. Então: **push na cauda, sem sort.** O documento é compartilhado (não
pertence a ancestralidade nenhuma), o que combina com ficar fora dos blocos por
ancestralidade.

### Portões que isso atravessa (conferidos)

- **Portão de duplicata semântica** (`writePack` → `registrarParaPortaoDeDuplicata`,
  critério nome+tipo+descrição normalizada): nenhum documento publicado se chama
  "Low-Light Vision", em nenhum pack. Sem colisão.
- **`_id`/`sourceId` únicos**: `FusionLowLight01` não colide com nenhum dos 4.237
  `_id` nem dos 4.237 `sourceId` publicados (verificado).
- **`buildIndex`**: `indexFields` de `ancestry-features-core` são
  `["name","system.category","system.traits.value","flags.fusion.sourceId"]` —
  os quatro estão presentes no documento.
- **Format check**: `systems/pf2e/packs/**` está no `.prettierignore`; o rebuild
  suja ~24 arquivos só com `generatedAt` novo. Restaurar o que não for do commit
  antes de commitar.

---

## 5. A entrada i18n pt-BR

### Terminologia — conferida, não inventada

`tools/translate-packs/glossary.pt-BR.json` **não tem** entrada para
`low-light vision` nem `darkvision` (grep vazio). O termo canônico vem, então,
do uso já consolidado nos overlays publicados:

| EN | pt-BR | ocorrências nos overlays |
|---|---|---|
| low-light vision | **visão na penumbra** | 6 spells-core, 2 heritages-core, 2 ancestry-features-core (+ variações de caixa) |
| darkvision | visão no escuro | 23 spells-core, 15 feats-core, 4 heritages-core, 3 ancestry-features-core |
| bright light | luz brilhante (34) / **luz intensa** no vizinho do pack | — |
| dim light | **luz fraca** | — |

Pares EN→PT reais, medidos:

- `ancestry-features-core / Basic Undead Benefits`
  EN "You gain low-light vision, or you gain darkvision if your ancestry already has low-light vision"
  → PT "Você ganha **visão na penumbra**, ou ganha visão no escuro se sua ancestralidade já tiver visão na penumbra"
- `ancestry-features-core / Greater Darkvision` → **"Visão no Escuro Superior"**
  PT: "Você enxerga na escuridão e na **luz fraca** tão bem quanto enxerga sob
  **luz intensa**, embora sua visão na escuridão seja em preto e branco. […]"

Logo o nome é **"Visão na Penumbra"** (termo já estabelecido, nada novo), e a
descrição segue a construção do irmão do mesmo pack — "luz fraca" / "luz
intensa" — para o pack não falar com duas vozes.

### A entrada, pronta para colar em `systems/pf2e/packs/ancestry-features-core/i18n.pt-BR.json` → `entries`

```json
"FusionLowLight01": {
  "name": "Visão na Penumbra",
  "sourceHash": "302605ced0ce1fc7b5a1de392dadd3b085de3c63",
  "description": "<p>Você enxerga na luz fraca tão bem quanto enxerga sob luz intensa, portanto você ignora a condição @UUID[Compendium.pf2e.conditionitems.Item.Concealed] causada por luz fraca.</p>"
}
```

O `@UUID[...Item.Concealed]` fica **em inglês dentro dos colchetes** de
propósito: é assim em todos os overlays (ex. `Keen Eyes` → "Olhos Aguçados"
mantém `@UUID[Compendium.pf2e.conditionitems.Item.Concealed]`) — o alvo do link
é um id, não texto.

### O `sourceHash` — calculado com o helper, e o helper foi validado antes

O separador é um **NUL literal** (`charCode 0`, verificado; ferramenta de texto
mostra como espaço). Nunca reimplementar. Comando rodado:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { i18nSourceHash } from './tools/translate-packs/src/hash.mjs';
const docs = JSON.parse(readFileSync('systems/pf2e/packs/ancestry-features-core/documents.json','utf8'));
const j = JSON.parse(readFileSync('systems/pf2e/packs/ancestry-features-core/i18n.pt-BR.json','utf8'));
for (const n of ['Greater Darkvision','Keen Eyes']) {
  const d = docs.find(x=>x.name===n);
  const got = i18nSourceHash(d.name, d.system.description);
  console.log(n, got===j.entries[d._id].sourceHash ? 'HASH OK' : 'MISMATCH', got);
}
const NAME='Low-Light Vision';
const DESC='<p>You can see in dim light as though it were bright light, so you ignore the @UUID[Compendium.pf2e.conditionitems.Item.Concealed] condition due to dim light.</p>';
console.log('authored sourceHash =', i18nSourceHash(NAME, DESC));
"
```

```
Greater Darkvision HASH OK 0d1052d53e214410b09ff19c97b4e0ee1ab26ae0
Keen Eyes HASH OK e7847c994dd62a5b0b7ffb16306cbc554ada0967
---
authored sourceHash = 302605ced0ce1fc7b5a1de392dadd3b085de3c63
```

Os dois "HASH OK" são a prova de que a fórmula está sendo usada certo antes de
confiar no terceiro valor. **Se a descrição EN mudar um único byte, recalcular**
— o hash é o que impede o overlay de ficar defasado em silêncio.

---

## 6. Quanto isso vale (dimensionamento para o dono)

Não é uma correção "de uma ficha". O documento é **compartilhado**:

| Superfície | Hoje | Depois |
|---|---|---|
| Ancestralidades publicadas com `vision: "low-light-vision"` | **5 de 10** — Elf, Fleshwarp, Gnome, Leshy, Ratfolk | as 5 passam a ter documento por trás do chip |
| Ancestralidades do vendor com o sentido (se o pack crescer) | **24 de 50** | mesma correção cobre todas |
| Documentos publicados que **concedem** o sentido por rule element | **3** — `heritages-core`/Twilight Halfling, `heritages-core`/Sylph, `feats-core`/Bloodline Mutation | apontam para o mesmo documento |
| Lacuna simétrica de `Darkvision` (também sem documento) | 3 ancestralidades publicadas — Dwarf, Goblin, Orc | **fora desta lacuna**; mesmo molde resolve, item de backlog |

Custo: um objeto de ~55 linhas, 9 linhas de injeção, 5 linhas de i18n. Nenhuma
mudança de motor, nenhuma mudança de schema.

---

## 7. Contrato com a catraca, e o que fica de fora

**A catraca fecha com isto.** `lacunasObservadas()` só pergunta
`nomesDoPack("ancestry-features-core").has("Low-Light Vision")` — nome exato, via
`docName(doc) = doc.name`, sobre `documents.json`. Com o documento injetado, a
entrada

```ts
"conteudo:ancestry-features-core/Low-Light Vision": "achado novo — sentido sem documento",
```

**deixa de ser observada e tem que ser APAGADA de `LACUNAS`** no mesmo commit —
a assertiva é de igualdade de conjunto, então deixá-la listada reprova. Estado
atual medido: catraca **verde**, 5 testes, baseline de 11 lacunas casando.

O que **não** é fechado por este insumo, e nomeadamente não deve ser feito por
quem aplicar (é superfície de outro agente, Lane B serial):

1. **Tornar o chip clicável.** Hoje `abcChipsFor` (planVM.ts:1212) empurra
   `{key:"scalar:vision", name}` sem `detailsPackSlug`/`sourceId`. Para rotear
   ao documento faltaria dar a esse chip `detailsPackSlug:
   "ancestry-features-core"` + `sourceId` do autoral, mapeados pelo escalar.
   **`planVM.ts` é o gargalo do repo** — não tocar aqui.
2. **Conceder de verdade o sentido.** Precisa de um `case "sense"` no
   `effectsEngine` e de `derivations/build.ts` preenchendo `perception.senses`
   (o `SenseDataSchema` e o campo no ator já existem). É item de motor, próprio.
3. **Wire pelo `system.items` da ancestralidade.** Alternativa ao item 1: injetar
   a concessão no `system.items` do Elfo (padrão `AERONAUT_CURATED_ITEMS`), o que
   faria o chip materializar clicável sem tocar em `planVM.ts`. **Mas** aí o
   documento passaria a ser concedido como item embutido em 5 ancestralidades, e
   isso é decisão de curadoria do dono — não é consequência da catraca.
