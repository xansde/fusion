# Insumo r25 — Bloco 4: armas de fogo em `weapons-core`

> **Status: INSUMO. Nada foi aplicado.** Nenhum arquivo do repo foi editado, o build de
> packs não foi rodado, nada foi commitado. Este documento é para **um único integrador**
> aplicar — `build-mvp-subset.mjs` é superfície compartilhada de quatro trabalhos desta
> rodada e edição concorrente nele faz rollback silencioso, não merge.
>
> Escrito em 2026-08-08 na worktree `wt-ficha-fofurinha` (branch `feat/ficha-alvo-fofurinha`,
> base `origin/build/app`).

**Veredito em uma linha:** o conteúdo está pronto e cruzado contra uma segunda fonte com
**zero divergência**, mas **nenhuma arma de fogo entra no pack sem uma mudança de código
antes** — `WEAPON_GROUPS` não tem `"firearm"`, e as 14 candidatas reprovam **100%** no
schema de arma do Fusion hoje. É uma linha. Sem ela, publicar firearm deixa
`packs-validation` vermelho.

---

## 1. A entrada obrigatória: o `sourceId` da Slide Pistol

**`sourceId` = `gO5dOlPBk57bg2x5`** (o `_id` Fusion é `e9lIuOi9OGJzVw3X` — não confundir;
a lista `MVP_WEAPON_PF2E_IDS` é indexada por `flags.fusion.sourceId`, conforme
`filterToMvpSubset` em `build-mvp-subset.mjs:1187`).

Comando rodado:

```bash
node -e "
const fs=require('fs');
const docs=JSON.parse(fs.readFileSync('tools/importer-pf2e/out/equipment/transformed.json','utf8'));
console.log(JSON.stringify(docs.filter(d=>/slide pistol/i.test(d.name||'')),null,2));
"
```

Saída (recortada nos campos que importam — dois documentos casam com o nome, e **só um é
`type: "weapon"`**):

```
{
  "_id": "e9lIuOi9OGJzVw3X",
  "name": "Slide Pistol",
  "type": "weapon",
  "system": {
    "category": "martial",
    "damage": { "damageType": "piercing", "dice": 1, "die": "d6" },
    "group": "firearm",
    "weaponGroup": "firearm",
    "level": 1,
    "price": { "gp": 16 },
    "range": 30,
    "reload": "1",
    "bulk": 2,
    "usage": "held-in-one-hand",
    "ammo": "rounds-slide-pistol",
    "expend": 1,
    "traits": { "rarity": "uncommon", "value": ["capacity-5","concussive","fatal-d10"] },
    "publication": { "license": "ORC", "remaster": true, "title": "Pathfinder Guns & Gears" }
  },
  "flags": { "fusion": { "conversion": "full", "sourceId": "gO5dOlPBk57bg2x5", "packName": "equipment" } }
}
```

O outro é `Rounds (Slide Pistol)` (`sourceId` `L2df9pyWLFNgjfNh`, `type: "ammo"`) — **fora
do escopo**, ver §6.

### Cruzamento com o waybuilder: zero divergência

`wb:weapon/slide-pistol` em `C:/Users/xansd/pessoal/Wayfinder/pipeline/base/index.json`
(pipeline independente: foundryvtt/pf2e + Pf2eTools + AoN) bate campo a campo:
`level 1` · `weapon_category martial` · `group firearm` · `1d6 piercing` · `range 30` ·
`reload "1"` · `bulk 2` · `price_cp 1600` (= 16 gp) · `usage held-in-one-hand` ·
`rarity uncommon` · traits `capacity-5, concussive, fatal-d10` · ORC/G&G remaster.

Rodei o cruzamento nas **14 candidatas**, em 12 campos mecânicos cada:

```
IGUAL Slide Pistol / Flintlock Pistol / Flintlock Musket / Arquebus / Blunderbuss /
      Air Repeater / Coat Pistol / Dueling Pistol / Fire Lance / Pepperbox /
      Double-Barreled Pistol / Hand Cannon / Dwarven Scattergun / Axe Musket

divergencias: 0 de 14
```

O waybuilder acrescenta dois dados que o vendor não tem e que valem para a UI: `page: 153`
e a nota de acesso — *"The following regions have access to firearms: Alkenstar, Dongun
Hold, Tian Xia, Vudra, Arcadia, Ustalav, the Shackles"*. **É essa nota que explica por que
não existe arma de fogo comum** (ver §2).

---

## 2. O conjunto proposto: 12 armas — e um critério que precisou ser corrigido

### O critério do briefing não é satisfazível como escrito

Foi pedido "nível 0, **comum**, sem runas". Medi: das **104** armas de fogo do vendor,
**zero** são `rarity: "common"`. Firearm é uncommon por design no PF2e — é o traço de
acesso regional acima. Exigir "comum" produziria um conjunto vazio.

Precedente já no pack: `weapons-core` tem **2 uncommon** hoje (Gnome Flickmace, Kukri).
Publicar uncommon não é novidade.

### O critério que usei

1. **Nível 0–1** — é o que um personagem de nível 1 pode comprar; corta as 66 armas de
   nível ≥ 3.
2. **`rarity` ≤ uncommon** — corta rare/unique (Shobhad Longrifle, Boastful Hunter…).
3. **Sem magia** — nenhum traço `magical`/`arcane`/`occult`/`cursed`; nenhuma runa
   (`runes: {potency:0, striking:0, property:[]}` em todas as 12).
4. **Item-base, não variante** — nada de "(Greater)/(Major)/(True)".
5. **`conversion: "full"`** — nenhuma regra caiu na conversão.
6. **Cobertura, não catálogo** — cada arma entra porque é a mais barata/baixa a cobrir um
   eixo mecânico que nenhuma outra cobre: as 3 categorias de proficiência, os 3 valores de
   `reload` (0/1/2), a faixa de alcance de 10 a 150 pés e 8 traços distintos de arma de
   fogo. Nada entra "para completar a lista".

**12 armas, não 106.** As 92 restantes não somam eixo nenhum: são variantes de nível alto,
mágicas ou repetição do mesmo par (recarga 1 + fatal + concussivo).

### A tabela — o que cada uma paga

| # | Arma | Cat. | Nv | Dano | Alc. | Rec. | Preço | Eixo que ela é a única (ou a mais barata) a cobrir |
|---|---|---|---|---|---|---|---|---|
| 1 | **Slide Pistol** | martial | 1 | 1d6 P | 30 | 1 | 16 gp | **OBRIGATÓRIA — a arma da ficha.** `capacity-5` |
| 2 | Flintlock Pistol | simple | 0 | 1d4 P | 40 | 1 | 4 gp | a pistola-linha-de-base; `simple` |
| 3 | Flintlock Musket | simple | 0 | 1d6 P | 70 | 1 | 5 gp | a arma-longa-linha-de-base; alcance médio |
| 4 | Arquebus | martial | 0 | 1d8 P | 150 | 1 | 8 gp | `kickback`; maior alcance de nível 0; `fatal-d12` |
| 5 | Blunderbuss | martial | 0 | 1d8 P | 40 | 1 | 6 gp | `scatter-10` (área de cone) |
| 6 | Air Repeater | simple | 0 | 1d4 P | 30 | **0** | 4 gp | `reload: "0"` + `repeating` + `agile` |
| 7 | Coat Pistol | simple | 0 | 1d4 P | 30 | 1 | 5 gp | `concealable` (esconder arma) |
| 8 | Fire Lance | simple | 0 | 1d6 P | **10** | **2** | 3 gp | `reload: "2"` — único caminho para exercer recarga longa |
| 9 | Pepperbox | martial | 0 | 1d4 P | 60 | 1 | 9 gp | `capacity-3` em nível 0 (a Slide Pistol é L1/16 gp) |
| 10 | Double-Barreled Pistol | martial | 0 | 1d4 P | 30 | 1 | 6 gp | `double-barrel` |
| 11 | Hand Cannon | simple | 0 | 1d6 P | 30 | 1 | **3 gp** | `modular` (troca tipo de dano); a mais barata |
| 12 | **Dwarven Scattergun** | **advanced** | 1 | 1d8 P | 50 | 1 | 10 gp | única `advanced` — sem ela a proficiência avançada não tem alvo |

Cobertura resultante: 3 categorias · `reload` 0/1/2 · alcances 10/30/40/50/60/70/150 ·
traços `capacity-N`, `concussive`, `fatal-d8/d10/d12`, `kickback`, `scatter-10`,
`repeating`, `agile`, `concealable`, `double-barrel`, `modular`, `dwarf`.
Todas ORC, todas remaster, 12/12 de *Guns & Gears*.

### Duas que eu tirei de propósito (e por quê)

- **Axe Musket** (`oUaeLZLK7WfolqBb`) — cobriria `combination` (arma que é corpo-a-corpo
  **e** de fogo). Fora porque o vendor carrega o perfil corpo-a-corpo em
  `system.meleeUsage` (`{damage:{die:"d8",type:"slashing"}, group:"axe", traits:["critical-fusion","forceful","sweep"]}`),
  o dado **sobrevive** ao transform e ao schema (via `.passthrough()`), mas **não existe
  mecânica nenhuma que o leia** — publicar agora entrega uma arma cuja metade é
  silenciosamente inerte. Entra na hora que a mecânica de `combination` existir; o dado já
  está lá esperando.
- **Dueling Pistol** (`ogv5nwwrc3sU8DnP`) — `concealable` já é coberto pela Coat Pistol,
  que é nível 0 e mais barata. É upgrade, não fundação.

Se o dono quiser tema em vez de cobertura, os dois candidatos elfos existem e passam no
mesmo critério: **Dawnsilver Tree** (`qRqGIxcadjjxcij3`, L0, `elf`+`parry`) e
**Three-peaked Tree** (`6mgB6Wv8X65pFMRL`, L1, `elf`+`combination`+`parry`) — a Fofurinha é
Elfo. Não incluí porque não somam eixo mecânico; é escolha de curadoria, não de correção.

---

## 3. O bloco exato para colar

Em `tools/importer-pf2e/src/build-mvp-subset.mjs`, dentro de `MVP_WEAPON_PF2E_IDS`
(começa na linha ~679), **depois** do bloco `// Ranged` e **antes** de
`// Unarmed / natural`. Estilo idêntico ao que já está lá (`sourceId`, vírgula, comentário
com o nome):

```js
  // Firearms — 12 curadas (r25, bloco 4). Todas nível 0–1, uncommon (NÃO existe
  // arma de fogo comum no PF2e: o acesso é regional), sem runas, sem magia,
  // item-base. Escolhidas por cobertura: 3 categorias, reload 0/1/2, alcance
  // 10–150 pés e os traços próprios do grupo (capacity/scatter/kickback/
  // repeating/modular/double-barrel/concealable).
  "gO5dOlPBk57bg2x5", // Slide Pistol (a arma da ficha-alvo — capacity-5)
  "N3nNqO5Nw2DIFhrv", // Flintlock Pistol
  "hqMtsTwmOShdAdQW", // Flintlock Musket
  "ChTaE7jhvCjcS6jI", // Arquebus (kickback, fatal-d12, alcance 150)
  "csXSDzgZASX4RWr4", // Blunderbuss (scatter-10)
  "SzUynRs4HVtnpnel", // Air Repeater (reload 0, repeating, agile)
  "LLYD2GEhzhdxoCAx", // Coat Pistol (concealable)
  "WUA40bb01pSWv88I", // Fire Lance (reload 2)
  "tk4cfktEnMrp4K6m", // Pepperbox (capacity-3)
  "MvzR9nTnvKTeNjvQ", // Double-Barreled Pistol (double-barrel)
  "4LJEpZ2HkCu9BvHI", // Hand Cannon (modular)
  "jcIabnkJgjwzK6Og", // Dwarven Scattergun (advanced, scatter-10)
```

Nada mais precisa mudar em `build-mvp-subset.mjs`: `filterToMvpSubset` já filtra por
`flags.fusion.sourceId` e a seção `weapons-core` (linha ~1341) já consome a constante.

---

## 4. O que quebra — e o campo exato que se perde

Rodei o **schema de arma real do Fusion** (`systems/pf2e/src/schemas/item-weapon.ts`,
`parseWeaponSystem`) sobre as 14 candidatas. Bundle feito com o esbuild do próprio repo
para não precisar tocar em arquivo do projeto:

```bash
node_modules/.bin/esbuild <entry importando systems/pf2e/src/schemas/item-weapon.ts> \
  --bundle --format=esm --platform=node --outfile=<scratch>/schema.mjs
node <scratch>/check.mjs   # parseWeaponSystem(doc.system) nas 14
```

### Resultado: 0 de 14 passaram

```
FAIL  Slide Pistol             _id=e9lIuOi9OGJzVw3X
      weaponGroup: invalid_enum_value Invalid enum value. Expected 'axe' | 'bomb' |
      'bow' | 'brawling' | 'club' | 'crossbow' | 'dart' | 'flail' | 'hammer' | 'knife' |
      'pick' | 'polearm' | 'shield' | 'sling' | 'spear' | 'sword', received 'firearm'
... (idêntico nas 14) ...
0 passaram, 14 falharam.
```

### O campo, o arquivo, a linha

| | |
|---|---|
| campo | `system.weaponGroup` com valor `"firearm"` |
| onde se declara | **`systems/pf2e/src/types.ts:81` — `WEAPON_GROUPS`** (16 grupos; `"firearm"` não está lá) |
| como chega ao schema | `systems/pf2e/src/schema-primitives.ts:48` → `WeaponGroupSchema = z.enum(WEAPON_GROUPS)`, usado em `item-weapon.ts:54` |
| quem reprova | `systems/pf2e/src/__tests__/packs-validation.test.ts` — "every document validates against its type schema" |
| risco se ignorar | `packs-validation` sai de **1 falha em 114** (a do Champion, pré-existente) para **2** — o teste de `weapons-core` passa a falhar listando as 12 armas de uma vez. O doc é gravado no `documents.json` de qualquer jeito: **o build não reclama**, só o teste. Publicar sem a linha é entregar pack inválido — silencioso na geração, ruidoso no CI. |

### A correção — uma linha

```diff
--- a/systems/pf2e/src/types.ts
+++ b/systems/pf2e/src/types.ts
@@ export const WEAPON_GROUPS = [
   "dart",
+  "firearm",
   "flail",
```

Repeti a checagem com o enum estendido: **14 de 14 passam**, `weaponGroup=firearm` e
`reload` preservados (`"0"` no Air Repeater, `"2"` no Fire Lance, `"1"` no resto).

```
PASS  Slide Pistol      _id=e9lIuOi9OGJzVw3X weaponGroup=firearm reload="1" lost=[]
PASS  Air Repeater      _id=hXrH1AzbLUU02FB1 weaponGroup=firearm reload="0" lost=[]
PASS  Fire Lance        _id=CocSCZ6gUPbAKzmz weaponGroup=firearm reload="2" lost=[]
... 14 passaram, 0 falharam.
```

A mudança é **só alargamento de enum**: nenhum `switch`/mapa é indexado por
`weaponGroup`. Varri o repo — as referências são o enum, o schema,
`transform.mjs:1116` (que só copia `src.group` para `weaponGroup`),
`derivations/character.ts:839` (que passa `""` dentro de um
`as unknown as WeaponSystem`), dois testes que usam valores concretos (`"bow"`) sem
enumerar a lista, os packs e um doc de análise. Especialização crítica por grupo está
marcada `[V2]` em `item-weapon.ts:54` — não existe mecânica a atualizar. **Nenhum teste
enumera `WEAPON_GROUPS`**, então alargar não quebra asserção nenhuma.

`systems/sf2e/src/types.ts:106` tem a **própria** lista (com `projectile`/`sniper`, sem
`firearm` e sem `bow`) — **não mexer**; sf2e não é afetado.

### Segundo item que quebra: uma asserção de contagem

`tools/importer-pf2e/src/__tests__/transform.test.mjs:534`

```js
it("weapons-core has ~30 weapons", () => {
  const docs = loadJson(join(PACKS_DIR, "weapons-core", "documents.json"));
  assert.ok(docs.length >= 25 && docs.length <= 35, `Expected ~30 weapons, got ${docs.length}`);
});
```

30 + 12 = **42** → estoura o teto de 35. É guarda de aproximação, não contrato; o
integrador precisa mexer no mesmo commit:

```diff
-  it("weapons-core has ~30 weapons", () => {
+  it("weapons-core has ~42 weapons (30 base + 12 firearms, r25)", () => {
     const docs = loadJson(join(PACKS_DIR, "weapons-core", "documents.json"));
-    assert.ok(docs.length >= 25 && docs.length <= 35, `Expected ~30 weapons, got ${docs.length}`);
+    assert.ok(docs.length >= 38 && docs.length <= 48, `Expected ~42 weapons, got ${docs.length}`);
   });
```

Também é o comentário do cabeçalho de `build-mvp-subset.mjs:9` (`~30 armas básicas`) e o
`documentCount` de `systems/pf2e/packs/weapons-core/pack.json` — este último é regenerado
pelo build, não editar à mão.

**Se o integrador não quiser tocar em teste nenhum**, cabem no máximo **5** armas
(30 + 5 = 35, no teto). O mínimo viável seria Slide Pistol + Flintlock Pistol +
Flintlock Musket + Air Repeater + Dwarven Scattergun (a ficha, as duas linhas-de-base,
`reload 0` e a categoria advanced) — perde scatter, kickback, capacity barato, reload 2,
modular, double-barrel e concealable. Recomendo os 12 + a linha de teste.

### O que NÃO quebra (verificado, não suposto)

- **`.passthrough()` salva o resto.** `WeaponSystemSchema` termina em `.passthrough()`
  (`item-weapon.ts:97`), então `group`, `expend`, `grade`, `containerId`, `meleeUsage` e
  `splashDamage` atravessam intactos: `lost=[]` nas 14. **A armadilha do
  `.extend()`-sem-`.passthrough()` do CLAUDE.md não se aplica aqui.**
- **Nem no servidor.** `packages/server/src/documents/types.ts:96` — `ItemSchema` declara
  `system: z.record(z.string(), z.unknown())`, e `ActorSchema` declara `items:` explícito.
  Nenhum campo de arma de fogo é descartado na persistência.
- **`reload` já existe** no schema como `z.string().default("-")` (`item-weapon.ts:60`) —
  sem mecânica, mas sem perda de dado.
- **`fatal-dN` já é mecanizado**: `systems/pf2e/src/actions/strikes.ts:312`
  (`extractTraitDie(traits, "fatal")`) e o crítico em `strikes.ts:426`. Nenhuma das 12
  usa `fatal-aim-dN`, que o extractor provavelmente casaria errado — **excluí Jezail e
  Piercing Wind justamente por isso**.
- **Traços novos não reprovam schema**: `TraitsBlockSchema.value` é
  `z.array(z.string())` (`schema-primitives.ts:124`) — string livre.
- **Sem colisão de nome.** Varri os 14 nomes contra os `documents.json` de **todos** os
  packs pf2e: zero ocorrências. O portão de duplicata semântica (nome + tipo + descrição,
  `build-mvp-subset.mjs:1244`) não dispara.

---

## 5. i18n — os `_id` a traduzir, e o que dá para reaproveitar

O overlay é `systems/pf2e/packs/weapons-core/i18n.pt-BR.json`, chaveado pelo **`_id` do
documento** (não pelo `sourceId`). Confirmei que o `_id` é estável entre `transformed.json`
e o pack (Whip = `0DVfmP59PKldTNdZ` nos dois) e que o build copia o `system` **verbatim**
(0 diferenças em 30 docs) — então os hashes abaixo valem para o pack já construído.

### Nada de nome de arma de fogo existe hoje

- `documentNamesPt.ts`: **12 de 12 ausentes** (é gerado dos overlays, então é consequência).
- Glossário (`tools/translate-packs/glossary.pt-BR.json`, 217 traços): `concussive`,
  `kickback`, `capacity-N`, `fatal-dN`, `scatter-N`, `double-barrel`, `modular`,
  `repeating`, `combination`, `concealable` — **todos ausentes**. Existem `deadly-d10` →
  `letal-d10`, `reload-1` → `recarga-1`, `agile` → `ágil`, `parry` → `aparar`,
  `dwarf` → `anão`. Traço ausente **não quebra nada**: `traitNames.ts` cai no slug
  humanizado (cabeçalho do arquivo). É lacuna cosmética.

### O que dá para reaproveitar (terminologia, não string pronta)

Já há vocabulário assentado em `actions-core`/`feats-core`, e ele deve ser respeitado:
**"arma de fogo"** (20 ações do Gunslinger), **"pólvora negra"**, **"Pistoleiro"** =
Gunslinger, e o feat `Clan Pistol` = **"Pistola de Clã"** (`feats-core`,
`AC9xkieBTvW3LdZb`). O padrão de ancestralidade em nome de arma é "de <povo>":
`Gnome Flickmace` → **"Mangual Cintilante de Gnomo"**.

### A tabela para o integrador

`sourceHash` = `i18nSourceHash(doc.name, doc.system.description)` importado de
`tools/translate-packs/src/hash.mjs` (o separador é **NUL literal**, U+0000 — confirmei
`codePointAt(0) === 0`; nunca reimplementar). Validei a fórmula contra as **30** entradas
existentes do overlay: **30 conferem, 0 divergem**. Os valores abaixo estão calculados:

| `_id` (chave do overlay) | `sourceId` | EN | pt-BR proposto | `sourceHash` |
|---|---|---|---|---|
| `e9lIuOi9OGJzVw3X` | `gO5dOlPBk57bg2x5` | Slide Pistol | **Pistola Deslizante** | `155f7e5ca4a76c2c276cb7bab8b03d770e494377` |
| `vsNpLjRVRAq0B59N` | `N3nNqO5Nw2DIFhrv` | Flintlock Pistol | **Pistola de Pederneira** | `3b3a9887e122749c90c4f8b83c286b05928618f1` |
| `FaLoH1XHzDsyzGAZ` | `hqMtsTwmOShdAdQW` | Flintlock Musket | **Mosquete de Pederneira** | `9dbf698aea805b0347f4616522e8cf3d86d44cf9` |
| `NNDoejzhhWKar6Dc` | `ChTaE7jhvCjcS6jI` | Arquebus | **Arcabuz** | `17ca169f6a888dea515a6bbc7f91ae1bd6450360` |
| `LiSC3YqSUlFSyNky` | `csXSDzgZASX4RWr4` | Blunderbuss | **Bacamarte** | `21e9420e6fc5b0444fede44fd49d1495a17fe8ff` |
| `hXrH1AzbLUU02FB1` | `SzUynRs4HVtnpnel` | Air Repeater | **Repetidor de Ar** | `4eae2f1c7671c3d6f20e86d30e13925a0e74d472` |
| `yY5waDlzvTdxo4Hx` | `LLYD2GEhzhdxoCAx` | Coat Pistol | **Pistola de Casaco** | `b7757fca1028a3f4d20e5791a63ee4f9f1661d65` |
| `CocSCZ6gUPbAKzmz` | `WUA40bb01pSWv88I` | Fire Lance | **Lança de Fogo** | `84aec776a8f8aad076b09d7b29156d2c419ec044` |
| `WXcwO9CkNvFU3aXu` | `tk4cfktEnMrp4K6m` | Pepperbox | **Pimenteira** | `a5e59627d92b2cb1410fe7eb2994fc483007dd9e` |
| `iwSQS7fuWt4Zd1St` | `MvzR9nTnvKTeNjvQ` | Double-Barreled Pistol | **Pistola de Cano Duplo** | `41095a409069b8489df934b23c62bbc50b6f15a3` |
| `MFuoIF0gLsUhujDb` | `4LJEpZ2HkCu9BvHI` | Hand Cannon | **Canhão de Mão** | `263304fee9fc4d1dfd19e770ac48f88f37f238e0` |
| `BSTNNs7HFL9KbFX1` | `jcIabnkJgjwzK6Og` | Dwarven Scattergun | **Espingarda de Anão** | `4448c8a36cc413b3b5a942a91043f6eb0a6479dd` |

Duas notas de tradução:

- **Pederneira** é o termo PT consagrado para *flintlock*; **Arcabuz** e **Bacamarte**
  são palavras portuguesas de verdade (não decalque) — por isso não levam qualificador.
- **Pimenteira** é o nome PT do revólver *pepperbox*, mas é obscuro fora de
  armas-antigas. Se o dono achar hermético, **"Pistola Pimenteira"** desambigua sem
  perder o termo.

Se as duas excluídas entrarem depois: Dueling Pistol → **"Pistola de Duelo"**,
Axe Musket → **"Mosquete-Machado"**.

### Ordem de operação do integrador

1. Colar o bloco de §3 e a linha de `WEAPON_GROUPS` de §4, ajustar a asserção de §4.
2. Rodar `node tools/importer-pf2e/src/build-mvp-subset.mjs` — **uma reconstrução por
   vez**; ela regenera os 14 packs e suja ~24 arquivos só com `generatedAt`. Restaurar o
   que não é seu antes de commitar (`systems/pf2e/packs/**` está no `.prettierignore`).
3. Acrescentar as 12 entradas ao overlay com o `sourceHash` da tabela (`description` em
   pt-BR também — a checagem `missing-description` de `qa-checks.mjs:109` reclama se o EN
   tem prosa e o PT não).
4. Regenerar os mapas do cliente: `node tools/translate-packs/gen-client-maps.mjs` (e
   `gen-prerequisite-names.mjs`, se aplicável).
5. Apagar `"conteudo:weapons-core/Slide Pistol"` de `LACUNAS` na catraca
   (`pathbuilder-fofurinha.test.ts:113`) — **no mesmo commit**; a assertiva é de igualdade
   de conjunto e lacuna resolvida que continua listada reprova.
6. Rodar `packs-validation` + a catraca + `transform.test.mjs`.

Boa notícia para o passo 3: **nenhum teste exige cobertura de overlay**. Se o i18n
atrasar, o pack fica verde e a UI mostra o nome em inglês — não vira teste vermelho.

---

## 6. Fora de escopo, dito na cara

- **Munição.** `Rounds (Slide Pistol)` (`L2df9pyWLFNgjfNh`) é `type: "ammo"`, e `ammo`
  **não está** em `PARSERS_BY_TYPE` de `packs-validation.test.ts:93` — publicar munição
  reprova na asserção "every document's type has a known parser" antes de qualquer coisa.
  Precisaria de schema novo. A catraca não pede munição e a ficha só lista `Kit de Faca`
  (fora de escopo por decisão do dono, §8 do handoff).
- **Mecânica de `reload`.** O campo existe e é preservado; gastar ação para recarregar,
  não. Fora deste insumo.
- **A capacidade real do carregador.** O vendor guarda `ammo` como objeto
  (`{baseType, builtIn, capacity}`) e o lado pf2e achata para a string do `baseType` —
  decisão **deliberada e documentada** em `transform.mjs:1080–1097` (`sf2e` mantém o
  `AmmoSchema` estruturado; pf2e não). `capacity` se perde. Para as 12 é inócuo: quem tem
  carregador carrega a informação no traço (`capacity-3`, `capacity-5`) e as demais são
  `capacity: 1`. Registro porque o Air Repeater tem
  `baseType: "magazine-with-6-pellets"` — os 6 tiros vivem hoje só dentro do nome do
  `baseType`, não num campo.
- **Proficiência de arma nomeada.** A ficha pede "Expert **só** na Slide Pistol" e
  `actor-character.ts` só tem rank por categoria. **Não é este insumo** — este resolve a
  metade "conteúdo" do bloco 4. A metade "proficiência" é o outro trabalho, e o waybuilder
  tem a spec pronta (`specs/2026-07-30-proficiencia-de-arma-nomeada.md`, gramática de
  remap medida: 4 seletores cobrem 83,5% das 91 ocorrências).
- **`combination` / `meleeUsage`.** Ver §2: dado preservado, mecânica ausente.
