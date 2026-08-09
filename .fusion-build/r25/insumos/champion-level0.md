# Insumo — `packs-validation.test.ts` vermelho: Champion `level: 0` (Blessed Armament / Blessed Shield)

> Escrito em 2026-08-08 na worktree `wt-ficha-fofurinha` (branch
> `feat/ficha-alvo-fofurinha`). **É insumo, não aplicação**: a correção cai em
> `tools/importer-pf2e/src/transform.mjs` + exige rerodar o pipeline do
> importer para regenerar `systems/pf2e/packs/class-features-core/documents.json`
> — esse arquivo e o rebuild de packs têm dono único nesta rodada
> (`build-mvp-subset.mjs`/pipeline), e edição concorrente causa rollback
> silencioso. Nada foi editado nem commitado por este agente.

Esta falha é **pré-existente à linha de trabalho da ficha-alvo** (provada
pré-existente com um HEAD limpo, sem o stash de mudanças de pack) e reprova
1 de 114 testes em `systems/pf2e/src/__tests__/packs-validation.test.ts`.

---

## 1. Reprodução (saída real)

O ambiente da worktree tinha `node_modules` corrompido/parcial (vitest
instalado só com o shim `.bin`, sem o pacote real —
`node_modules/.pnpm/vitest@3.2.6.../node_modules/vitest/` só continha uma
subpasta `node_modules`, sem `vitest.mjs`/`package.json`). `pnpm install`
normal reportava "Already up to date" sem corrigir nada (cache de
"modules state" não verificado contra o disco). Corrigido com:

```bash
rm -rf node_modules systems/pf2e/node_modules systems/sf2e/node_modules packages/*/node_modules tools/*/node_modules
pnpm install   # 486 pacotes reinstalados do zero, 28s
```

`systems/pf2e` e `systems/sf2e` **não fazem parte** de
`vitest.workspace.ts` (só shared/system-api/stub/server/client/boundary-test/
release-tools) — a suite roda direto dentro do pacote:

```bash
cd systems/pf2e && pnpm vitest run src/__tests__/packs-validation.test.ts
```

Saída real (114 testes, 1 falha, 113 passando):

```
 ❯ system-pf2e src/__tests__/packs-validation.test.ts (114 tests | 1 failed) 6316ms
   ...
   × packs-validation: every document validates against its Zod schema > pack: class-features-core > every document validates against its type schema 352ms
     → [class-features-core] "Blessed Armament" (IDQ2uKdJvhXxK0zv, type=classFeature): level: Number must be greater than or equal to 1
[class-features-core] "Blessed Shield" (w1bsPZkn0DgZIxop, type=classFeature): level: Number must be greater than or equal to 1: expected [ …(2) ] to deeply equal []
   ...
 Test Files  1 failed (1)
      Tests  1 failed | 113 passed (114)
```

Confirma exatamente a descrição do handoff: só esses 2 documentos, mesma
mensagem.

---

## 2. Causa raiz (com evidência, não deduzida)

### 2.1 O vendor traz `level: 0` de propósito — e é legítimo (hipótese a confirmada)

`Blessed Armament` e `Blessed Shield` **não são class features gated a um
nível de personagem por si só**. São opções de escolha (leaf choices)
concedidas por outra feature via `ChoiceSet` + `GrantItem` — o mesmo padrão
que o Magus usa para Hybrid Study (Starlit Span / Inexorable Iron), que o
próprio docstring do schema já reconhece como categoria especial
(`"hybridStudy"`).

Vendor (`tools/importer-pf2e/vendor/pf2e/packs/pf2e/class-features/blessed-armament.json`):

```json
"level": { "value": 0 },
"traits": { "otherTags": ["blessing-of-the-devoted"], "value": ["champion"] }
```

A feature que **de fato** é gated a um nível e concede essas duas via
`ChoiceSet` é `Blessing of the Devoted`
(`.../class-features/blessing-of-the-devoted.json`):

```json
"level": { "value": 3 },
"rules": [
  { "key": "ChoiceSet", "flag": "blessing",
    "choices": { "filter": ["item:type:feature", "item:tag:blessing-of-the-devoted"] } },
  { "key": "GrantItem", "uuid": "{item|flags.system.rulesSelections.blessing}" }
]
```

Confirmado por uma segunda fonte vendor independente — o próprio mapa de
progressão da classe Champion (`items{}` de
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/classes/champion.json`), que é
a fonte de verdade de "em que nível você ganha isso":

```json
"UVWUN": { "name": "Blessing of the Devoted", "level": 3, "uuid": "Compendium.pf2e.classfeatures.Item.Blessing of the Devoted" }
```

Duas fontes vendor independentes concordam: nível 3.

Padrão mais amplo (não é só o Champion): 19 class-features no vendor inteiro
carregam `level.value: 0` — todas são axes de sub-escolha (Champion
`blessing-of-the-devoted`, Cavalier `Order of the X`, e "Deviant
Classification" de outra classe). Só as 2 do Champion aparecem no pack final
porque só 12 classes estão curadas hoje (Cavalier não está) — as outras 17
já são descartadas por `build-mvp-subset.mjs` antes de chegar perto do
schema. Contraste: as 7 opções do axis `champion-cause` (Justice, Liberation,
etc.) **já vêm com `level: 1` no próprio vendor** — não é toda opção de
escolha que zera o level, é uma inconsistência de autoria do próprio time do
PF2e upstream especificamente nesse axis.

### 2.2 O ponto exato do bug: `??` não pega `0`

`tools/importer-pf2e/src/transform.mjs`, função `normalizeClassFeatureSystem`
(linha 1452 no HEAD atual):

```js
level: src.level?.value ?? src.level ?? system.level ?? 1,
```

`src.level.value` é `0` — um número definido, não `null`/`undefined`. O
operador `??` só cai no próximo termo quando o lado esquerdo é nullish;
`0` não é. Resultado: o `0` cru do vendor atravessa direto para
`ClassFeatureSystemSchema` (`systems/pf2e/src/schemas/item-class-feature.ts:22`,
`level: z.number().int().min(1).max(20)`), que reprova.

### 2.3 Por que a curadoria do Champion já tem o valor certo, sem uso

`tools/importer-pf2e/src/curation/classes/champion.json` **já declara** o
axis com o nível correto — e o comentário do próprio autor da curadoria já
sinalizava o buraco (issue #25):

```json
{
  "otherTag": "blessing-of-the-devoted",
  "featureNameInItemsMap": "Blessing of the Devoted",
  "level": 3,
  "choose": 1,
  "optionCount": 3,
  "slotType": "blessing",
  "notes": "issue #25: unlike champion-cause, the vendor's otherTag here has NO 'champion-' prefix ... so the 3 real option docs (Blessed Armament/Shield/Swiftness) were never pulled into class-features-core even though they exist in the vendor exactly like the 7 Cause options do."
}
```

`choiceAxes[].level` existe em **todo** arquivo de curadoria de classe (12
classes, sempre presente) mas **não é consumido em lugar nenhum do código**
hoje — confirmei com grep em `build-mvp-subset.mjs` e `transform.mjs`: só
`axisCategoryByOtherTag()` é usado (para `category`); não existe
`axisLevelByOtherTag()`. O dado certo já está armazenado, só falta ligá-lo.

### 2.4 Cross-check com o waybuilder (fonte externa, mais fraco que o vendor direto)

`C:/Users/xansd/pessoal/Wayfinder/pipeline/base/index.json` também modela o
axis `blessing-of-the-devoted` com `escolhe: 1`, opções
`wb:class-feature/blessed-armament` e `wb:class-feature/blessed-shield` —
mesma estrutura de escolha. Ele grava `"nivel": 1` para esse axis, o que
**diverge** do vendor direto (nível 3, confirmado por duas fontes vendor
independentes na seção 2.1). Como o handoff do projeto já avisa (issue #10
do waybuilder: "eixos tortos em 11 de 27 classes"), esse é provavelmente um
desses eixos tortos — não uso o valor dele; o vendor primário + o próprio
`items{}` map da classe são mais fortes e concordam entre si.

**Conclusão da causa raiz**: é a hipótese (a) do handoff — o vendor traz
`level: 0` legitimamente para essas 2 features (não é erro do vendor, é
convenção de "isto é uma opção de escolha, não um gate de nível") e a nossa
transformação deveria normalizar, preenchendo com o nível do axis que já
concede a escolha (3, para o Champion). Não é a hipótese (b) — o schema não
está estrito demais; `level >= 1` é correto para o significado real de
"em que nível de personagem isto é concedido", e frouxar para `min(0)`
mascararia erros de dados reais nos outros 839 documentos do pack.

---

## 3. Correção mínima (patch pronto para colar)

Dois arquivos, ambos dentro do importer (fora do escopo que esta rodada
pode tocar sozinha — exige rebuild do pack `class-features-core` para
`documents.json`/`index.json`/`mechanics.json` refletirem a mudança).

### 3.1 `tools/importer-pf2e/src/curation/index.mjs` — novo helper, espelha `axisCategoryByOtherTag()`

Adicionar logo depois de `axisCategoryByOtherTag()` (linha ~223-229):

```js
/** otherTag → level (nível de personagem em que a feature que concede a escolha é obtida). */
export function axisLevelByOtherTag() {
  const out = new Map();
  for (const cfg of loadClassCuration().values()) {
    for (const axis of cfg.choiceAxes) out.set(axis.otherTag, axis.level);
  }
  return out;
}
```

### 3.2 `tools/importer-pf2e/src/transform.mjs` — usar o helper como fallback quando o vendor zera

Import (linha 49):

```diff
-import { axisCategoryByOtherTag, classItemsMap, loadClassCuration } from "./curation/index.mjs";
+import { axisCategoryByOtherTag, axisLevelByOtherTag, classItemsMap, loadClassCuration } from "./curation/index.mjs";
```

`normalizeClassFeatureSystem` (linhas 1428-1459):

```diff
 function normalizeClassFeatureSystem(system, src) {
   const otherTags = src.traits?.otherTags ?? system.traits?.otherTags ?? [];
   const axisCategories = axisCategoryByOtherTag();
+  const axisLevels = axisLevelByOtherTag();
   const axisCategory = Array.isArray(otherTags)
     ? otherTags.map((t) => axisCategories.get(t)).find(Boolean)
     : undefined;
+  // r25/issue Champion level-0: choice-option class-features (e.g. Blessed
+  // Armament/Shield, granted via ChoiceSet+GrantItem off "Blessing of the
+  // Devoted") carry vendor system.level.value: 0 — they're leaf options, not
+  // gated to a level on their own (§2.1 do insumo champion-level0.md). `??`
+  // below doesn't catch 0 (it's not nullish), so the raw 0 used to flow
+  // straight through into ClassFeatureSystemSchema (level >= 1). Backfill
+  // from the axis's own curated level (already declared per-class, e.g.
+  // champion.json's "blessing-of-the-devoted": level 3 — matches the
+  // vendor's "Blessing of the Devoted" granting feature AND champion.json's
+  // items{} map) whenever the vendor's own level is falsy/0.
+  const axisLevel = Array.isArray(otherTags)
+    ? otherTags.map((t) => axisLevels.get(t)).find((v) => typeof v === "number")
+    : undefined;
+  const rawLevel = src.level?.value ?? src.level ?? system.level ?? 1;
+  const level = rawLevel === 0 && typeof axisLevel === "number" ? axisLevel : rawLevel;

   return {
     ...system,
-    level: src.level?.value ?? src.level ?? system.level ?? 1,
+    level,
     category: axisCategory ?? src.category ?? system.category ?? "classfeature",
     prerequisites: src.prerequisites?.value ?? src.prerequisites ?? system.prerequisites ?? [],
     description: src.description?.value ?? src.description ?? system.description ?? "",
     publication: src.publication ?? system.publication,
     traits: src.traits ?? system.traits ?? { rarity: "common", value: [] },
   };
 }
```

### 3.3 Blast radius (verificado, não suposto)

- Afeta **só** documentos cujo `otherTags` bate com um `otherTag` de algum
  `choiceAxes` curado E cujo `level` vendor é `0`. Hoje isso é exatamente
  `Blessed Armament` e `Blessed Shield` (os únicos 2, dos 19 candidatos com
  `level:0` no vendor inteiro, que sobrevivem ao filtro de classe curada do
  `build-mvp-subset.mjs`).
- Não regride `champion-cause` (Justice, Liberation, ...) nem `hybridStudy`
  (Starlit Span, ...): ambos já chegam do vendor com `level` não-zero
  (1), então `rawLevel === 0` é falso e o valor original passa incólume.
- Depois do patch, é preciso rerodar o pipeline (`transform` →
  `build-mvp-subset.mjs`) para regenerar
  `systems/pf2e/packs/class-features-core/{documents,index,mechanics}.json`
  com `Blessed Armament`/`Blessed Shield` em `level: 3` — sem isso o patch
  em `transform.mjs` não muda o pack publicado (a suite lê o pack
  publicado, não o `out/` intermediário).

---

## 4. Se eu tivesse aplicado (não apliquei)

Depois do rebuild, a expectativa é `114 tests | 0 failed` em
`packs-validation.test.ts`. Não roda aqui porque o rebuild de packs é dono
único desta rodada (`build-mvp-subset.mjs`) — quem integrar este insumo deve
rodar o pipeline e conferir a suite antes de commitar.
