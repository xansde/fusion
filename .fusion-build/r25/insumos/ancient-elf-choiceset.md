# r25 · insumo — conversão do ChoiceSet do Ancient Elf

> Lacuna da catraca: `regra:ancient-elf-choiceset-inerte`.
> Escrito em 2026-08-08. **Nada aqui foi aplicado ao pipeline.** Dois arquivos
> novos foram criados (§7) e estão DESLIGADOS: ligá-los é ato do integrador.

---

## 1. Onde está o portão de `unsupported` (evidência)

**`tools/importer-pf2e/src/transform.mjs:113-156`** — uma tabela única decide
tudo. A linha exata:

```js
// tools/importer-pf2e/src/transform.mjs:131-132
  // Unsupported — preserved verbatim in flags.fusion.unconvertedRules
  ChoiceSet: "unsupported",
```

O despachante que a lê:

```js
// tools/importer-pf2e/src/transform.mjs:501-505
function convertRuleElement(re) {
  const key = re?.key;
  if (!key) return { descriptor: null, state: "unsupported" };

  const coverage = RE_COVERAGE[key] ?? "unsupported";
```

`ChoiceSet` não tem `case` no `switch` (510-555), então cai no
`default: return { descriptor: null, state: "unsupported" }` (553-554). O
chamador então preserva o RE cru:

```js
// tools/importer-pf2e/src/transform.mjs:622-628
    } else {
      // Unsupported — preserve verbatim
      unconvertedRules.push({ ...re, _conversionState: "unsupported" });
```

**Detalhe que decide o desenho do patch:** `convertRuleElement(re)` recebe **só o
rule element**. Não vê os rules irmãos (necessários para testar o par com o
`GrantItem`) nem o nome do documento. Qualquer conversão de ChoiceSet precisa de
um segundo argumento.

### O documento hoje, no pack

`systems/pf2e/packs/heritages-core/documents.json` — `Ancient Elf`
(`_id: W5S2RLn2VuFTNwEX`, `flags.fusion.sourceId: Nd9hdX8rdYyRozw8`):

```json
"system": { "rules": [ {
    "kind": "grant-item",
    "uuid": "{item|flags.system.rulesSelections.ancientElf}",
    "inMemoryOnly": false,
    "raw": { "key": "GrantItem", "uuid": "{item|flags.system.rulesSelections.ancientElf}" }
} ] },
"flags": { "fusion": { "conversion": "partial", "unconvertedRules": [ {
    "choices": { "filter": ["item:category:class","item:trait:dedication","item:trait:multiclass"],
                 "itemType": "feat" },
    "flag": "ancientElf",
    "key": "ChoiceSet",
    "prompt": "PF2E.SpecificRule.AncientElf.Prompt",
    "_conversionState": "unsupported"
} ] } }
```

E a entrada do vendor que o pipeline consome
(`tools/importer-pf2e/out/heritages/normalized.json`) tem os DOIS rules crus,
`ChoiceSet` seguido de `GrantItem` — o par está inteiro na entrada.

### O efeito colateral do `inMemoryOnly: false`

`grantMaterializer.parseGrantItems` (`packages/client/src/lib/sheets/pf2e/grantMaterializer.ts:136-163`)
só ignora um grant placeholder quando ele está marcado `inMemoryOnly: true`
(linha 150). Com `false`, o uuid `{item|…}` chega em `parseGrantUuid`, que devolve
`null` (linha 250, `name.includes("{")`), e o grant é reportado como
`unresolved-placeholder` (linha 536). Medido nos packs: **47 grant-items
placeholder, todos com `inMemoryOnly: false`** — 47 diagnósticos de falha por
build, um deles o do Ancient Elf.

---

## 2. O formato que o cliente JÁ consome

Não é o `mechanics.json`. É uma tabela escrita à mão dentro do `planVM.ts`.

```ts
// packages/client/src/lib/sheets/pf2e/planVM.ts:847-857
export type GrantedFeatPredicate =
  | { kind: "category"; value: string }
  | { kind: "trait"; value: string }
  | { kind: "levelAtMost"; value: number };

export interface GrantedFeatFilter {
  labelKey: string;
  predicates: GrantedFeatPredicate[];
}
```

- **A tabela**: `GRANTED_FEAT_CHOICES` (planVM.ts:865) — **uma entrada só hoje**,
  `"basic concoction"`. Chaveada por `nameToSlug(nome do talento)`.
- **A busca**: `grantedFeatChoiceFor(featName)` (planVM.ts:876-879).
- **O avaliador**: `matchesGrantedFeatFilter(featDoc, filter)` (planVM.ts:887-904)
  — casa `system.category`, `system.traits.value`, `system.level`.
- **O slot**: `pushGrantedFeatSubSlot` (planVM.ts:1649-1671) cria um sub-slot
  `grantedFeat` com id `<parentSlotId>:granted`, `parentSlotId` (indentação) e
  `grantFilter` (filtro do picker).
- **O picker**: `packages/client/src/components/sheets/pf2e/plan/PlanColumn.svelte:873-886`

```ts
    if (slot.type === "grantedFeat" && slot.grantFilter) {
      const grant = slot.grantFilter;
      return {
        packSlug: "feats-core",
        title: t(grant.labelKey),
        filterFn: (e) => matchesGrantedFeatFilter(featDocFromIndex(e), grant),
      };
    }
```

**Consequência decisiva:** o picker do `grantedFeat` **não** passa por
`isFeatEligible` — logo **não** aplica `level > charLevel` nem a rejeição de
`archetype`. O caminho `grantedFeat` **já fura o pré-requisito de nível por
construção.** É a rota limpa para a concessão do Ancient Elf, e é por isso que
esta lacuna é independente da outra (`regra:dedicacao-nao-cabe-em-slot-de-classe`,
que é sobre o slot `classFeat` e o `isFeatEligible`).

### O que o `mechanics.json` é, e por que não serve como alvo

`packages/shared/src/mechanics.ts` define `FeatChoiceGrantSchema`
(`{kind:"feat-choice", category, count, filters:{traits,maxLevel,…}, source,
confidence}`) e `tools/translate-packs/src/normalize-rules.mjs:119-206` **já
implementa** a conversão determinística ChoiceSet→feat-choice. Três razões para
não ser o alvo desta lacuna:

1. **A catraca não lê o overlay.** Ela lê `flags.fusion.unconvertedRules`
   (`pathbuilder-fofurinha.test.ts:152-157`). Enquanto o ChoiceSet estiver lá, a
   lacuna existe, tenha overlay ou não.
2. **O cliente não consome o overlay.** O próprio comentário do planVM diz:
   *"The client does not consume mechanics.json anywhere yet (only
   GRANTED_FEAT_CHOICES's hand-authored table pattern is wired up)"*
   (planVM.ts:919-920).
3. **Heritages-core nem tem overlay.** Só dois packs têm `mechanics.json`
   (`class-features-core`, `feats-core`) — o Ancient Elf não está em nenhum
   deles, e `feats-core/mechanics.json` tem **5 grants** no total.

O `normalize-rules.mjs` continua útil e correto — mas como **fonte cruzada de
conferência** (ver §5), não como o lugar do conserto.

---

## 3. Dimensionamento — quantos documentos estão bloqueados pelo mesmo motivo

Medido em 2026-08-08 sobre `systems/pf2e/packs/*/documents.json` (14 packs):

| | |
|---|---|
| documentos com ChoiceSet em `unconvertedRules` | **104** |
| ChoiceSets no total | **133** |
| ChoiceSets com `choices` ARRAY (escolha estática de valor: perícia, terreno) | 69 |
| ChoiceSets sem `itemType` / `choices` ausente | 40 |
| **ChoiceSets com `itemType: "feat"`** | **16** |
| desses, com `GrantItem` irmão consumindo a flag | **16 de 16** (nenhum solto) |
| outros `itemType`: `deity` 4, `spell` 2, `heritage` 1, `ancestry` 1 | 8 |

Por pack: `class-features-core` 43 docs/62 CS · `feats-core` 41/49 ·
`familiar-abilities-core` 5/6 · `ancestry-features-core` 5/5 ·
`backgrounds-core` 4/4 · `heritages-core` 3/3 · `actions-core` 1/2 ·
`ancestries-core` 1/1 · `classes-core` 1/1.

**Não são centenas: são 16 escolhas de talento.** Das 16, quantas o conversor
consegue traduzir com 100% de fidelidade (filtro inteiramente literal nas três
formas de `GrantedFeatPredicate`)? Medido rodando o módulo do §7 sobre os packs:

| escopo | docs publicados convertidos |
|---|---|
| `level-free-feat-choice` (**recomendado**) | **1** — `heritages-core/Ancient Elf` |
| `all-literal-feat-choice` | 4 — + `feats-core/{Basic Concoction, Basic Trickery, Advanced General Training}` |

As outras 12 têm filtro que **não** cabe no modelo de hoje e devem continuar em
`unconvertedRules` (dívida declarada, não conversão de meia-verdade):
`item:level:<N>` exato (Multitalented, Versatile Human, General Training,
Multifarious Muse, Fury Instinct, Natural Ambition, Ancestral Paragon),
`{lte:["item:level","self:level"]}` (Rogue Dedication), placeholder
`{actor|…}` (Natural Ambition, Ancestral Paragon) e árvore `or/not/xor` +
`item:rarity` (os 4 `Gate's Threshold`).

### O achado que define o escopo recomendado

De todos os 16, **o Ancient Elf é o único cujo filtro não declara predicado de
nível nenhum**. Não é coincidência: é a mecânica. A prosa do próprio documento
diz *"You gain the multiclass dedication feat for that class, **even though you
don't meet its level prerequisite**"* — o vendor omitiu o predicado de nível
porque a concessão dispensa o nível. Todos os outros 15 declaram teto ou nível
exato.

Isso dá um gate **derivado de dado, não de nome**: converter apenas o
ChoiceSet(feat) que **não declara nível**. Efeito medido: exatamente 1 documento
publicado hoje. É geral na forma, local no efeito — sem allowlist de nome nem
`sourceId` cravado.

> **Risco a registrar:** se um pack futuro publicar outro ChoiceSet(feat) sem
> predicado de nível, ele será convertido em silêncio. No vendor inteiro
> (`out/`, 633 ChoiceSets) há **3** nesse estado: `Ancient Elf`,
> `feats/Skill Mastery` e `feats/Social Purview` — os dois últimos **não estão
> publicados** em `feats-core` (conferido). O `choice-sets.test.ts` NÃO pega
> isso, porque ele lê `unconvertedRules`. Ver a mitigação no §6, item 3.

---

## 4. O patch proposto (pronto para aplicar)

Arquivo: **`tools/importer-pf2e/src/transform.mjs`**. Quatro edições, nenhuma em
`build-mvp-subset.mjs` nem em `planVM.ts`.

### 4.1 Importar o conversor (junto dos imports de curation, linha 49-50)

```js
// r25/bloco 2: ChoiceSet(feat) com filtro literal vira o descritor `feat-choice`
// que o planVM já consome (GrantedFeatFilter). Ver o insumo em
// .fusion-build/r25/insumos/ancient-elf-choiceset.md.
import { convertChoiceSet } from "./choice-set.mjs";
```

### 4.2 O despachante passa a receber os rules irmãos e trata `ChoiceSet`

`RE_COVERAGE.ChoiceSet` **fica** `"unsupported"` — de propósito. Assim os 132
ChoiceSets que NÃO convertem mantêm `_conversionState: "unsupported"`
byte-a-byte, em vez de virarem `"partial"` (que é o que aconteceria se a tabela
dissesse `"supported"` e o conversor devolvesse `null`, pelo caminho da linha
557-560). Nenhum documento além do convertido muda.

```diff
--- a/tools/importer-pf2e/src/transform.mjs
+++ b/tools/importer-pf2e/src/transform.mjs
-function convertRuleElement(re) {
+function convertRuleElement(re, siblingRules = []) {
   const key = re?.key;
   if (!key) return { descriptor: null, state: "unsupported" };

   const coverage = RE_COVERAGE[key] ?? "unsupported";

   try {
     let descriptor = null;

     switch (key) {
+      case "ChoiceSet": {
+        // ChoiceSet é "unsupported" na tabela por DEFAULT (a maioria é escolha
+        // de valor, sem consumidor no builder). O subconjunto que o cliente
+        // sabe consumir — escolha de TALENTO com filtro literal e sem
+        // predicado de nível — converte; o resto segue para unconvertedRules
+        // com o MESMO estado de hoje.
+        const choice = convertChoiceSet(re, siblingRules);
+        if (choice === null) return { descriptor: null, state: "unsupported" };
+        return { descriptor: choice, state: "supported" };
+      }
       case "FlatModifier":
```

### 4.3 Os dois chamadores passam os irmãos

```diff
@@ transform.mjs:609 (rules do documento)
-    const { descriptor, state } = convertRuleElement(re);
+    const { descriptor, state } = convertRuleElement(re, rawRules);

@@ transform.mjs:675 (rules dos items[] embutidos)
-      const { descriptor, state } = convertRuleElement(re);
+      const { descriptor, state } = convertRuleElement(re, itemRaws);
```

### 4.4 Pós-passe: o `grant-item` par vira `inMemoryOnly`

Inserir **depois** do laço de rules do documento (após a linha 629) e **antes**
de `buildSystem` (linha 665):

```js
  // r25/bloco 2: um `grant-item` cujo uuid é o placeholder
  // `{item|flags.system.rulesSelections.<flag>}` de um ChoiceSet que ACABAMOS de
  // converter é, por definição, adiado para o picker — é exatamente o que
  // `inMemoryOnly: true` significa para o grantMaterializer
  // (packages/client/src/lib/sheets/pf2e/grantMaterializer.ts:127-131 e :150).
  // Sem esta marca ele é reportado como "unresolved-placeholder" (issue #35) —
  // um falso positivo, porque agora alguém É dono da escolha.
  // Só os placeholders das flags CONVERTIDAS são marcados: os outros 46
  // continuam corretamente reportados, porque de fato ninguém os resolve.
  const convertedChoiceFlags = new Set(
    convertedRules.filter((r) => r.kind === "feat-choice" && r.flag).map((r) => r.flag),
  );
  if (convertedChoiceFlags.size > 0) {
    for (const rule of convertedRules) {
      if (rule.kind !== "grant-item" || typeof rule.uuid !== "string") continue;
      const flag = /^\{item\|flags\.system\.rulesSelections\.([^}]+)\}$/.exec(rule.uuid)?.[1];
      if (flag && convertedChoiceFlags.has(flag)) rule.inMemoryOnly = true;
    }
  }
```

### 4.5 O patch foi RODADO (não só escrito)

O patch inteiro foi aplicado a uma **cópia** de `transform.mjs` no scratchpad
(`transform-patched.mjs`, com o `main()` removido e `transformDoc` exportado) e
executado contra o `out/` normalizado real — sem escrever nada, sem tocar no
pipeline. Comparação documento a documento, **patch vs. base**, sobre todo o
corpo do vendor:

```
documentos comparados: 16396
documentos que MUDAM: 3
  feats/Skill Mastery      (não publicado em feats-core)
  feats/Social Purview     (não publicado em feats-core)
  heritages/Ancient Elf    ← o único publicado
```

Saída real do `Ancient Elf` pelo pipeline patchado: `conversion: "full"`,
`unconvertedRules: []`, `system.rules` = a regra `feat-choice` do §5 + o
`grant-item` com `inMemoryOnly: true`. E o vizinho `Versatile Human` sai
**idêntico** ao de hoje (`partial`, ChoiceSet preservado com
`_conversionState: "unsupported"`, `inMemoryOnly: false`) — a prova de que os
132 ChoiceSets restantes não mudam nem de estado.

### 4.6 O que NÃO muda

- `RE_COVERAGE` não ganha entrada nova; `ChoiceSet` continua `"unsupported"`.
- `EffectRuleSchema` (`systems/pf2e/src/schema-primitives.ts:169-178`) é
  `.passthrough()` e só exige `kind` ou `type` string → `kind: "feat-choice"`
  valida sem tocar em schema. Conferido.
- O `i18nSourceHash` é `sha1(name + NUL + description)`
  (`tools/translate-packs/src/hash.mjs:47-49`) — **não** inclui rules. O overlay
  pt-BR do Ancient Elf **não** fica defasado. Conferido.

---

## 5. O que muda no pack depois do rebuild

Documento `heritages-core/Ancient Elf` (`_id W5S2RLn2VuFTNwEX`):

| campo | antes | depois |
|---|---|---|
| `flags.fusion.unconvertedRules` | 1 entrada (`key: "ChoiceSet"`) | **`[]`** |
| `flags.fusion.conversion` | `"partial"` | **`"full"`** |
| `system.rules` | 1 regra (`grant-item`) | **2** regras |
| `system.rules[].inMemoryOnly` do grant-item | `false` | **`true`** |

A regra nova, exatamente como o módulo emite (saída real do teste do §7):

```json
{
  "kind": "feat-choice",
  "flag": "ancientElf",
  "labelKey": null,
  "count": 1,
  "predicates": [
    { "kind": "category", "value": "class" },
    { "kind": "trait",    "value": "dedication" },
    { "kind": "trait",    "value": "multiclass" }
  ],
  "levelPredicateDeclared": false,
  "raw": { "…": "o ChoiceSet original, preservado" }
}
```

**Nenhum outro dos 14 packs muda** (fora dos 24 `generatedAt` que o rebuild
sempre suja e que o `.prettierignore` já cobre).

### O `grant-item` passa a resolver? **Não — e não deve.**

O `grant-item` do Ancient Elf é um placeholder por desenho: ele aponta para *o
que o jogador escolher*. `materializeGrants` nunca vai resolvê-lo. O que muda:

- **antes**: `parseGrantItems` tenta resolver, falha, reporta
  `unresolved-placeholder` — a herança não concede nada e o motivo é um
  diagnóstico de erro.
- **depois**: `inMemoryOnly: true` faz `parseGrantItems` pular o grant (linha
  150) sem reportar, e a concessão passa a existir como uma **escolha** que o
  builder tem que oferecer. Quem materializa o item é `chooseFeat` no sub-slot
  `grantedFeat`, não o materializador de grants fixos.

### Conferência cruzada com o waybuilder (não é cópia)

`C:/Users/xansd/pessoal/Wayfinder/pipeline/base/index.json`,
`wb:heritage/ancient-elf`:

```json
"grants": [
  { "choice": { "flag": "ancientElf",
                "filtro": ["item:category:class","item:trait:dedication","item:trait:multiclass"],
                "tipo": "feat" } },
  { "requires_ancestry": "wb:ancestry/elf" }
],
"grants_completos": false
```

Três leituras úteis:

1. **A forma dele é o filtro do vendor renomeado** (`filtro`/`tipo`), sem
   normalizar em predicados. Nossa conversão é mais adiantada — ela traduz para
   os predicados que o avaliador do cliente já sabe casar. **Nada a
   transplantar**; a confirmação é que a fonte de verdade (o filtro) é a mesma
   nos dois pipelines, construídos de bases diferentes.
2. **Ele mesmo marca `grants_completos: false`** — a dispensa do nível não está
   representada no dado dele. Nosso `levelPredicateDeclared: false` é
   estritamente mais informativo.
3. **A bancada dele confirma o comportamento-alvo**, e vale como especificação
   de aceitação. `motor/teste_motor.py:1427-1470`:
   - `Ancient Elf` abre um slot que sem ele não existe, identificado **pela flag
     do ChoiceSet** (`ancientElf`);
   - o filtro recorta o slot nas **27 dedicações multiclasse**, e talento geral
     (`Fleet`) não entra;
   - *"dedicação de nível 2 ATENDE num personagem de nível 1"* — nível dispensado;
   - *"mas o pré-requisito de ATRIBUTO continua valendo"* (Alchemist Dedication
     reprova por INT, e **não** por nível);
   - a cadeia continua: a dedicação escolhida abre o slot DELA (`skillFeat` do
     Rogue Dedication).

O `wb:feat/psychic-dedication` dele traz `gate_de_nivel: "archetype"` e
`grant_spellcasting` mecanizado — isso é insumo do **bloco 1 / bloco 3**, não
desta lacuna.

---

## 6. Colaterais — o que vai ficar vermelho, e o conserto de cada um

### 1. `packages/client/src/lib/sheets/pf2e/__tests__/choice-sets.test.ts` — VERMELHO

O segundo teste (*"o inventário não guarda entrada morta"*) reprova: a escolha
sai de `unconvertedRules`, logo `collectChoiceSets()` (linhas 41-57, que filtra
`r.key === "ChoiceSet"` **só** dentro de `unconvertedRules`) não a produz mais, e
a chave do inventário fica órfã.

**Conserto (escolha uma, no MESMO commit do rebuild):**

- **(a) mínimo — apagar a linha.** `packages/client/src/lib/sheets/pf2e/choiceSetInventory.ts:255`:
  ```ts
  "heritages-core/Ancient Elf/ancientElf": "pendente",
  ```
  Custo: perde-se o registro de que essa escolha existe. Se o builder ainda não
  oferecer o sub-slot (§7 do planVM), a dívida deixa de estar declarada em algum
  lugar — exatamente o defeito silencioso que o arquivo foi criado para impedir.
- **(b) recomendado — ensinar `collectChoiceSets()` a ver a escolha convertida
  também**, mantendo a chave e trocando o estado para `"sub-slot"` quando o
  builder passar a oferecer:
  ```ts
  // dentro do laço de docs, junto do laço de unconvertedRules:
  for (const rule of (doc.system?.rules ?? []) as Array<{ kind?: string; flag?: string }>) {
    if (rule.kind !== "feat-choice") continue;
    keys.push(`${entry.name}/${doc.name}/${rule.flag ?? "-"}`);
  }
  ```
  (exige adicionar `system?: { rules?: unknown[] }` à interface `PackDoc`, linha
  35-38). Bônus: cobre o risco do §3 — um ChoiceSet(feat) sem nível publicado no
  futuro continua obrigado a ter classificação no inventário.

### 2. `tools/translate-packs/src/__tests__/mechanics-parity.test.mjs` — só se o escopo alargar

Esse teste lê o pack **real** (`FEATS_CORE_DOCS_PATH`, linha 55) e chama
`extractMechanicsForPack` → `normalizeDocMechanics`, que lê
`flags.fusion.unconvertedRules` (`normalize-rules.mjs:120-123`). No escopo
recomendado ele **não** é tocado: `Basic Concoction` continua com o ChoiceSet em
`unconvertedRules`. **No escopo `all-literal-feat-choice` ele fica VERMELHO**
(`entries[basicConcoctionDoc._id]` vira `undefined` na linha 118, e a asserção da
linha 119 reprova). É a razão principal para não alargar nesta rodada.

### 3. O que **não** quebra (conferido, não suposto)

- `pathbuilder-fofurinha.test.ts` → fica **verde** com a entrada
  `regra:ancient-elf-choiceset-inerte` **apagada** de `LACUNAS` (linha 110). É
  igualdade de conjunto: apagar é obrigatório, não opcional.
- `packs-validation.test.ts` → `EffectRuleSchema` é `.passthrough()`; segue com
  a mesma **1 falha de 114** que já existe na base (`Blessed Armament` /
  `Blessed Shield`, `system.level: 0`), que não é desta linha de trabalho.
- `tools/importer-pf2e/src/__tests__/transform.test.mjs` → usa os packs
  `conditions` e `equipment`, sem ChoiceSet convertível.
- overlay i18n → hash não inclui rules (§4.5).
- `mechanics.json` de `heritages-core` → não existe; nada a regenerar.

### 4. Aviso: `transform.test.mjs` JÁ está com 3 falhas nesta worktree — não é desta lacuna

`node --test tools/importer-pf2e/src/__tests__/*.test.mjs` dá **247/250** agora
mesmo, com o pipeline intacto. As 3 falhas são da suíte `MVP packs`
(`transform.test.mjs:437`) e vêm do **bloco 1 em voo**: o
`curation/classes/gunslinger.json` foi criado nesta worktree (timestamp 17:36,
contra 16:33 de todos os outros 12) e os packs ainda não foram reconstruídos —
`"gunslinger: feature \"Gunslinger's Way\" (nível 1) fora do pack"`. Não confunda
com dano do patch desta lacuna: `transform.test.mjs` não referencia
`choice-set.mjs` (0 ocorrências) e o rebuild do bloco 1 resolve as 3.

---

## 7. Arquivos criados (DESLIGADOS — ligar é do integrador)

| arquivo | o que é |
|---|---|
| `tools/importer-pf2e/src/choice-set.mjs` | o conversor. `parseFeatChoicePredicates`, `isPairedWithGrantItem`, `convertChoiceSet(re, siblingRules, scope)`. **Ninguém o importa** — o §4.1 é que faz isso. |
| `tools/importer-pf2e/src/__tests__/choice-set.test.mjs` | 13 testes, fixtures copiadas literalmente do vendor, cobrindo cada forma de filtro medida. **13/13 verdes.** |

O teste **roda no CI** (`tools/importer-pf2e` tem `"test": "node --test
src/__tests__/*.test.mjs"`) e não depende de `out/` — as fixtures são inline.
Verde hoje, com o pipeline intacto.

Rodar:

```bash
cd tools/importer-pf2e && node --test src/__tests__/choice-set.test.mjs
```

---

## 8. O que o agente do `planVM.ts` precisa fazer (separado e explícito)

A conversão do pack **não faz a escolha aparecer na ficha.** Fecha a lacuna da
catraca (que mede o pack) e nada mais. Sem os quatro itens abaixo, o Ancient Elf
segue sem conceder nada na tela — progresso medido que a ficha não mostra.
**Recomendação: pack e builder na mesma rodada.**

### 8.1 A herança não é um slot — é um card. Falta um push novo.

`buildAbcCards` (planVM.ts:1090-1128) monta a herança como `AbcCardModel`
(linhas 1103-1109) — sem `slotId`, sem picker, só `chips` informativos.
`pushGrantedFeatSubSlot` (planVM.ts:1649-1671) só sabe pendurar sub-slot em
`PlanSlotModel` **preenchido** (`if (!parentSlot.filled) return;`, linha 1656) e
é chamado de dois lugares: 1364 (Free Archetype) e 1538 (`pushFeatSlotWithGrant`).

Precisa de uma função nova, chamada dentro de `buildLevelPlan`
(planVM.ts:1245-1429) **só no nível 1**, que:
- ache a herança embutida (`findFirstItemByType(doc, "heritage")` — mesmo helper
  da linha 1103);
- leia o `system.rules` DELA procurando `kind === "feat-choice"`;
- resolva um sub-slot `grantedFeat` com id estável, ex.
  `heritage:${flag}:granted` (o prefixo `<slotId>:` é o que a cascata de
  `removeChoice` usa — ver o comentário de `pushAdoptedAncestrySubSlot`,
  planVM.ts:1679-1689);
- monte o `grantFilter` a partir dos `predicates` da regra convertida (é o mesmo
  tipo `GrantedFeatPredicate`: nada a traduzir) + um `labelKey` novo do Fusion.

### 8.2 O consumidor de `feat-choice` — a tabela por nome não serve aqui

```ts
// planVM.ts:1657 — o que existe hoje
  const grant = grantedFeatChoiceFor(parentSlot.choiceName);
```

`grantedFeatChoiceFor` (planVM.ts:876-879) consulta `GRANTED_FEAT_CHOICES`
(planVM.ts:865-874, **uma entrada**: `"basic concoction"`) por NOME. O Ancient
Elf não vai entrar nessa tabela — o dado agora está no documento. Precisa de um
leitor novo, algo como `featChoiceGrantsOf(item): GrantedFeatFilter[]`, que lê
`item.system.rules` filtrando `kind === "feat-choice"` e monta
`{ labelKey, predicates }`.

Esse leitor **substitui a tabela por dado** para todo caso convertido, e é o
"consumidor client-side de mecânicas" que o comentário de planVM.ts:919-922
descreve como *"much larger, out-of-scope change"* — mas em versão pequena,
porque a regra vem no próprio `system.rules` do item, não de um overlay de pack
a carregar. Não apague `GRANTED_FEAT_CHOICES`: `Basic Concoction` continua sem
regra convertida (§3) e o `mechanics-parity.test.mjs` lê essa tabela por regex
(linhas 65-68, 94-102).

### 8.3 O pré-requisito de nível — DOIS pontos, e um deles é um bug já documentado

**Ponto A — o picker: já está certo, não mexer.**
`PlanColumn.svelte:873-886` filtra o `grantedFeat` só por
`matchesGrantedFeatFilter` (planVM.ts:887-904), que não olha `charLevel`. Uma
dedicação de nível 2 **já aparece** num personagem de nível 1 nesse caminho.
`isFeatEligible` (planVM.ts:1896) **não está nessa rota** — o `level >
charLevel` da linha 1912 e o `if (traits.includes("archetype")) return false` da
linha **1919** são do slot `classFeat`, ou seja, da OUTRA lacuna
(`regra:dedicacao-nao-cabe-em-slot-de-classe`). Não confundir as duas.

**Ponto B — a MARCAÇÃO: aqui está o defeito.**
`checkSlotRequirement` (planVM.ts:2112-2158) roda o teste de nível **antes de
qualquer ramificação por tipo de slot**:

```ts
// planVM.ts:2118-2124
  const sys = asRecord(item["system"]);
  const level = sys["level"];
  if (typeof level === "number" && level > charLevel) {
    return {
      reasonKey: "FUSION.Sheet.Plan.Requirement.LevelTooHigh",
      params: { required: String(level), current: String(charLevel) },
    };
  }
```

O doc-comment da própria função (planVM.ts:2085-2086) afirma o contrário do que
o código faz:

> *"(or when the slot type has no requirement this function understands —
> abilityBoosts/skillTraining/skillIncrease/kineticGate/**grantedFeat** are not
> item-requirement-checkable and **always pass**)"*

`grantedFeat` **não** passa sempre: cai no teste de nível junto com todo mundo.
E `attachRequirementIssues` (planVM.ts:2446-2462, chamada em planVM.ts:1427)
percorre **todo** slot preenchido item-backed, sem excluir sub-slot. Resultado
concreto: `Psychic Dedication` (nível 2) escolhida no nível 1 aparece na ficha
com o selo vermelho `LevelTooHigh` — não bloqueia (a política é *marca, nunca
bloqueia*), mas mente para o jogador.

**O conserto limpo** é usar o fato que o pipeline agora publica em vez de
inventar política nova: pular o teste de nível quando o slot é `grantedFeat`
**e** a regra que o concedeu tem `levelPredicateDeclared === false`. Isso
mantém o teste válido para o `grantedFeat` do `Rogue Dedication`
(`{lte:["item:level","self:level"]}` — teto relativo ao personagem, que o filtro
NÃO expressa e por isso o nível ainda tem que ser checado) e o dispensa só onde
a fonte declarou que o nível não restringe. Onde ancorar o `levelPredicateDeclared`
(um campo novo em `PlanSlotModel`/`GrantedFeatFilter`, ou o slot lendo a regra da
herança) é decisão de quem edita — não vou desenhar sozinho um arquivo que outro
agente está mexendo.

### 8.4 O pré-requisito de ATRIBUTO continua valendo — e não existe hoje

`Psychic Dedication` exige *Intelligence 14 or Charisma 14*. A Fofurinha tem
Int 14 e Cha 14, então **passa** — mas por sorte, não por regra: o Fusion não
resolve `system.prerequisites` de atributo. Está documentado como decisão
consciente em planVM.ts:2103-2110 (*"Free-text `system.prerequisites` … is NOT
resolved here"*), e `checkFeatPrerequisites` (planVM.ts:2406) só cobre a fatia
de prosa de eixo de subclasse. A bancada do waybuilder testa exatamente esse
caso (Alchemist Dedication reprovando por INT). **Fora do escopo desta lacuna** —
mas registrar, porque a rota nova (dedicação por herança) é a primeira do Fusion
em que um pré-requisito de atributo importa de verdade.

---

## 9. Checklist para o integrador

1. Aplicar §4 em `transform.mjs` (4 edições).
2. Rodar o rebuild de packs **sozinho** (regra do handoff §5.2: uma
   reconstrução por vez) e restaurar os `generatedAt` que não são seus.
3. Conferir o doc: `unconvertedRules: []`, `conversion: "full"`,
   `system.rules` com 2 regras, `inMemoryOnly: true` no grant-item.
4. Apagar `"regra:ancient-elf-choiceset-inerte"` de `LACUNAS`
   (`pathbuilder-fofurinha.test.ts:110`) — **no mesmo commit**.
5. Resolver o `choice-sets.test.ts` (§6.1 — preferir a opção (b)).
6. Rodar: a catraca, `choice-sets.test.ts`, `packs-validation.test.ts`,
   `node --test tools/importer-pf2e/src/__tests__/*.test.mjs` e
   `node --test tools/translate-packs/src/__tests__/*.test.mjs`.
7. Só então (ou em paralelo, arquivo diferente) o agente do `planVM.ts` faz §8.

---

## 10. O que foi rodado, e o que ficou sem rodar

**Rodado, com saída observada:**

| comando | saída |
|---|---|
| `pnpm vitest run …/pathbuilder-fofurinha.test.ts …/choice-sets.test.ts` | 2 arquivos, **8 testes verdes** — a linha de base antes de qualquer mudança |
| `node --test tools/importer-pf2e/src/__tests__/choice-set.test.mjs` | **13/13 verdes** |
| medição de ChoiceSets nos 14 packs | 104 docs, 133 CS, 16 com `itemType:"feat"`, 16/16 pareados |
| medição de grant-items placeholder | **47** com `inMemoryOnly:false`, 0 com `true` |
| conversor sobre os packs, escopo estreito | **1** doc (Ancient Elf); escopo largo: 4 |
| `transformDoc` patchado vs. base, todo o `out/` | **16.396** docs comparados, **3** mudam |
| `npx prettier --check` nos 2 arquivos novos | verde (após `--write` no teste) |

**Sem rodar, de propósito:**

- **O build de packs** (`build-mvp-subset.mjs`) — proibido pela tarefa, e o `out/`
  desta worktree é uma *junction* para a árvore principal: rodar o transform de
  verdade escreveria `out/*/transformed.json` na árvore de outra sessão.
- **`packs-validation.test.ts` depois da mudança** — depende do rebuild.
- **A suíte do `planVM.ts`** — não toquei nele, e outra sessão está mexendo
  (`loreSlug.ts`, contrato C3).
- **O sub-slot na tela** — nada de §8 foi implementado; a conversão sozinha não
  faz a escolha aparecer na ficha.
