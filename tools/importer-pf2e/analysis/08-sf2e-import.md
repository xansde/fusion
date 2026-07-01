# 08 — Import SF2e: extensão do importer e subset MVP commitável

> Gerado em: 2026-07-01
> Agente: SF2E-IMPORTER (batch M4)
> Escopo: `tools/importer-pf2e` estendido para `--system pf2e|sf2e` + subset MVP
> em `systems/sf2e/packs/`. Consome o pacote `systems/sf2e` (schemas Zod) sem
> alterá-lo — apenas produz dados no formato que ele espera.

---

## 1. Resumo

O pipeline `extract.mjs` → `normalize.mjs` → `transform.mjs` →
`build-mvp-subset.mjs` (já existente para PF2e, batch M3-D) foi estendido com
um parâmetro `--system pf2e|sf2e` em todas as quatro fases. Ambos os sistemas
compartilham o mesmo clone vendor (`vendor/pf2e/`), apenas apontando para
`packs/pf2e/` ou `packs/sf2e/` — confirmando a previsão de
`analysis/04-sf2e-disponibilidade.md` §6 ("M4 NÃO precisa deslizar").

**pf2e**: nenhuma regressão. As 4 fases foram re-executadas de ponta a ponta e
os 4 packs commitados em `systems/pf2e/packs/` permanecem **semanticamente
idênticos** byte-a-byte (verificado por comparação de JSON canonicalizado,
não apenas diff textual) ao estado pré-existente. 58 testes de regressão
pf2e (`transform.test.mjs`) continuam verdes.

**sf2e**: gerado um subset MVP commitável em `systems/sf2e/packs/` com **63
documentos** em 6 packs, cobrindo armas (tech + analog), armaduras,
augmentações, as 3 condições SF-exclusivas, bestiário (incl. robots/aliens) e
magias. 57 novos testes de guarda (`sf2e-import.test.mjs`) verdes — total
**115 testes** na suíte do importer.

---

## 2. Extensão do importer — `--system pf2e|sf2e`

### 2.1 Seleção de sistema

Todos os 4 scripts (`extract.mjs`, `normalize.mjs`, `transform.mjs`,
`build-mvp-subset.mjs`) aceitam `--system pf2e|sf2e` (default `pf2e`, path
legado preservado — `out/<pack>/` sem prefixo). Quando `sf2e`:

| Fase             | Entrada                                 | Saída                                                               |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------- |
| extract          | `vendor/pf2e/packs/sf2e/<pack>/**.json` | `out/sf2e/<pack>/raw.json`                                          |
| normalize        | `out/sf2e/<pack>/raw.json`              | `out/sf2e/<pack>/normalized.json`, `samples/sf2e/<pack>/`           |
| transform        | `out/sf2e/<pack>/normalized.json`       | `out/sf2e/<pack>/transformed.json`, `out/sf2e/fusion-uuid-map.json` |
| build-mvp-subset | `out/sf2e/<pack>/transformed.json`      | `systems/sf2e/packs/<slug>/{pack.json,documents.json,index.json}`   |

Relatórios de análise seguem o mesmo padrão de sufixo `-sf2e`:
`analysis/05-id-compat-sf2e.md`, `analysis/07-relatorio-normalize-sf2e.md`,
`analysis/08-transform-report-sf2e.{md,json}` (este arquivo é o `08-sf2e-import.md`,
o relatório-síntese pedido pela tarefa, distinto do `08-transform-report-sf2e.md`
que é o relatório técnico de cobertura de Rule Elements gerado por `transform.mjs`).

### 2.2 fusionId — namespace sf2e isolado do pf2e (REQ-SF2-048)

A fórmula original (`fusionId = base62_16(sha1(packName + ":" + sourceId))`,
`analysis/05-id-compat.md §5`) usa `packName` como parte do hash — mas pf2e e
sf2e têm packs com **o mesmo nome** (`equipment`, `spells`, `conditions`).
Sem namespacing, um documento pf2e e um sf2e com o mesmo `_id` de origem
produziriam colisão de `fusionId`. `transformDoc()` agora recebe um
`fusionIdPackKey` opcional (default = `packName`); `processPack()` passa
`"sf2e:<pack>"` quando `system === 'sf2e'`. `flags.fusion.packName` continua
reportando o slug puro (`"equipment"`) para não quebrar leitura humana dos
relatórios. Teste de guarda: `sf2e-import.test.mjs` §1 prova que o mesmo
`sourceId` hipotético produz `fusionId` diferente nos dois namespaces.

O mapa de UUIDs (`fusion-uuid-map.json`) também é separado por sistema —
`out/fusion-uuid-map.json` (pf2e, path legado) vs `out/sf2e/fusion-uuid-map.json`.

### 2.3 Allowlist de traits SF-exclusivos (REQ-SF2-044/047)

O importer **nunca rejeitou** traits desconhecidos — `traits.value` sempre foi
passthrough livre desde o pf2e (confirmado: nenhum ponto do pipeline filtra ou
valida a allowlist de traits contra uma lista fechada). A tarefa pedia para
"adicionar a allowlist" no sentido documentado por
`analysis/04-sf2e-disponibilidade.md §6 item 2` ("o importer só precisa não
rejeitá-los"), então a allowlist foi adicionada como **constante documentada +
relatório de cobertura**, não como filtro:

- `SF2E_EXCLUSIVE_TRAIT_ALLOWLIST` em `normalize.mjs`: `tech`, `analog`,
  `automatic`, `area`, `tracking`, `unwieldy`, `seeking`, `injection`, `line`,
  `radioactive`, `powered`, `reload-holster`, `robot`, `alien`, `android`,
  `cyborg`, `technological`, `construct`, `void-adapted`, `starship`.
- `scanSf2eTraits()` varre os documentos normalizados de cada run e produz
  uma tabela de cobertura (✅ observado / — não observado) em
  `analysis/07-relatorio-normalize-sf2e.md §0`.
- Confirmado nos dados reais e nos packs MVP commitados: `tech`, `analog`,
  `automatic`, `area-cone` (variante prefixada de `area`), `robot`,
  `construct` aparecem no subset curado (ver §4 abaixo).

### 2.4 Extensão do transform: tipo `equipment` genérico (achado durante o M4)

O `transform.mjs` pf2e original só tinha normalizadores tipados para
`weapon`/`armor`/`spell`/`feat`/`condition`/`npc`/`effect`/`melee` — o tipo
`equipment` genérico caía no `default:` passthrough, que **não** flatten os
wrappers `{value: ...}` do Foundry nem chama `stripFlavorProse()`. Isso nunca
foi um problema para o pf2e porque o `build-mvp-subset.mjs` original só
seleciona documentos `type === 'weapon'` e `type === 'npc'` para os packs
commitados (nunca `equipment` genérico) — então a prosa nunca vazava para os
packs pf2e commitados apesar de estar presente em `out/equipment/transformed.json`
(intermediário, não commitado).

O SF2e MVP **precisa** de `type === 'equipment'` para dois packs novos:
armaduras (`armor` já tinha normalizador) e **augmentações**, que a spec 18
(D-SF2-03) documenta como tipo dedicado mas que o dado real do compendium
modela como `type: "equipment"` com `usage.value: "implanted"` — exatamente
como `systems/sf2e/src/schemas/item-augmentation.ts` já documentava
antecipadamente no seu próprio docstring. Foi adicionado um normalizador
`normalizeEquipmentSystem()` (case `equipment`/`consumable`/`treasure`/
`container` em `buildSystem()`) que:

1. Flatten os mesmos campos `{value}` que weapon/armor já flattenam
   (`bulk`, `level`, `price`, `quantity`, `usage`, `hp`, `hardness`).
2. Aplica `stripFlavorProse()` (mesma política de clean-room).
3. Para itens com `usage === 'implanted'`, deriva `augType` a partir do
   trait de categoria presente em `traits.value` (`apex`/`biotech`/
   `magitech`/`necrograft`/`tech` — os 5 valores reais de
   `AUGMENTATION_TYPES`, confirmados em todo arquivo de
   `vendor/pf2e/packs/sf2e/equipment/augmentations/**`). O dado real **não**
   carrega um campo `augType` explícito — só existe implicitamente como uma
   das 5 pastas/traits. 61 das 62 augmentações do pack sf2e têm exatamente
   um trait de categoria; a exceção (`Armplates`, um item de ancestria com
   `usage:"implanted"` mas sem trait de categoria) foi excluída da curadoria
   MVP.

**Regressão verificada**: re-rodar o pipeline pf2e completo após essa mudança
produziu os mesmos 4 packs commitados byte-a-byte idênticos (nenhum documento
`type === 'equipment'` pf2e é selecionado pelo `build-mvp-subset.mjs` pf2e,
então o novo normalizador nunca é exercitado no caminho pf2e commitado) — 58
testes `transform.test.mjs` verdes.

---

## 3. Política de clean-room (idêntica ao pf2e, espelhada para sf2e)

- `stripFlavorProse()` já era system-agnostic (opera em `system.description`/
  `gmNotes`/`publicNotes`/`privateNotes` independente do sistema) — nenhuma
  mudança necessária, apenas confirmação de cobertura via testes novos.
- `isProprietaryImg`/substituição de arte: **corrigido** para reconhecer
  `systems/sf2e/` além de `systems/pf2e/` como paths proprietários
  (`isSystemProprietaryPath()` em `normalize.mjs`) — antes, todo path sf2e
  caía silenciosamente na contagem "FoundryCore" nas estatísticas (a
  substituição por placeholder já acontecia de qualquer forma, política
  conservadora "substituir TODOS" — isso era um bug cosmético de relatório,
  não uma falha de política).
- Todos os campos `img` nos 63 documentos MVP sf2e apontam para
  `icons/placeholder/*.svg`; nenhum path `systems/sf2e/` ou `systems/pf2e/`
  sobrevive (verificado por scan de string bruto no JSON serializado).
- Nomes, traits, campos mecânicos (`damage`, `grade`, `ammo`, `charges`,
  `expend`, `augType`, `level`, `price`, `bulk`) são ORC e permanecem.

### Guarda de regressão (REQ-LEG-010, espelha o guard pf2e)

`tools/importer-pf2e/src/__tests__/sf2e-import.test.mjs §4` — falha se:

1. Qualquer `system.description`/`gmNotes`/`publicNotes`/`privateNotes` tiver
   mais de 0 caracteres em qualquer documento OU item embarcado dos 5 packs
   de item (`conditions`, `weapons-core`, `armor-core`,
   `augmentations-core`, `spells-core`) ou no bestiário
   (`details.publicNotes`/`blurb`/`privateNotes` + itens embarcados).
2. Qualquer fragmento de prosa conhecida da Paizo/sf2e reaparecer (ex.: a
   frase completa de `Untethered` sobre zero-g, a descrição do Arc Rifle, a
   descrição do Autorecognition Lens — os 3 exemplos que apareceram durante a
   inspeção manual deste batch).

---

## 4. Subset MVP commitável — `systems/sf2e/packs/`

63 documentos em 6 packs, ordem de grandeza igual ao MVP pf2e (105 docs em 4
packs) mas cobrindo mais categorias de conteúdo por causa dos deltas
mecânicos exclusivos do SF2e (armor/augmentations não têm equivalente
separado no MVP pf2e, que soma armas+condições+bestiário+magias).

| Pack                 | `pack.json id`            | Docs | Fonte (`out/sf2e/<pack>`)                                       | Conteúdo                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------- | ---- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conditions`         | `sf2e.conditions`         | 3    | `conditions`                                                    | Glitching, Suppressed, Untethered — as 3 únicas condições SF-exclusivas no dado real (todas `type: "effect"`, não `"condition"` — delta confirmado vs. pf2e)                                                                                                                                                                  |
| `weapons-core`       | `sf2e.weapons-core`       | 20   | `equipment` (filtro `type==='weapon'`, nível 0)                 | Spread analog/tech: Arc Pistol/Rifle, Laser Pistol/Rifle, Zero Pistol, Plasma Sword, Shock Truncheon (powered), Flamethrower (`area-cone`), Machine Gun/Autotarget Rifle (`automatic`), Knife/Baton/Hammer/Dueling Sword/Semi-Auto Pistol/Crossbolter (analog), Shock Pad, Pulsecaster Pistol, Coil Rifle, Shooting Starknife |
| `armor-core`         | `sf2e.armor-core`         | 10   | `equipment` (filtro `type==='armor'`, nível 0)                  | Light/medium/heavy spread: Abadarcorp Travel Suit, Armored Coat, Carbon Skin, Estex Suit, Hardlight Series, Quilted Armor (light); Freebooter Armor, Shotalashu Armor (medium); Aegis Series, Hidden Soldier Armor (heavy)                                                                                                    |
| `augmentations-core` | `sf2e.augmentations-core` | 10   | `equipment` (filtro `usage==='implanted'`)                      | Spread pelas 5 categorias reais: tech (5), biotech (2), magitech (2), necrograft (1)                                                                                                                                                                                                                                          |
| `bestiary-core`      | `sf2e.bestiary-core`      | 10   | `alien-core-bestiary` (filtro `type==='npc'`, nível -1..3, ORC) | Inclui 2 robots (Repair-Class Security Robot, Ordinance-Class Civil Robot — traits `robot`+`construct`+`tech`), Cybernetic Zombie (`tech`+`undead`), Botnib/Clangit (`fey`+`gremlin`+`tech`), Akata (`aberration`), Cyanoscum (`elemental`+`plant`), Diatha/Empathnid/Khefak (`animal`)                                       |
| `spells-core`        | `sf2e.spells-core`        | 10   | `spells` (filtro nível 1, curado)                               | Eldritch Lance, Chill Gaze, Delete, Elemental Weapon, Enhance Weapon, Implant Data, Mind Skewer, Overheat, Akashic Fount, Anthem                                                                                                                                                                                              |

**Traits SF-exclusivos confirmados nos packs commitados** (query sobre os
próprios `documents.json`, não apenas o vendor):

- Bestiário: `robot`, `tech`, `construct`, `alien`-adjacentes (`aberration`,
  `fey`, `gremlin`), `undead`, `zombie`, `mindless`, `animal`, `elemental`,
  `plant`.
- Armas: `tech`, `analog`, `arc`, `automatic`, `area-cone`, `powered`,
  `unwieldy`, `kickback`, `modular`, `finesse`, `agile`, entre outros.

**Deltas mecânicos SF2e verificados na íntegra no subset** (não apenas no
schema — nos dados reais transformados):

- **Grade em vez de runas** (D-SF2-02): `Arc Rifle.system.grade === "commercial"`,
  com `runes: {potency:0, striking:0, property:[]}` também presente (armas
  analog do subset usam runas normalmente, tech usam grade).
- **Ammo/charges/expend** (REQ-SF2-018/020): `Arc Rifle.system.ammo = {baseType:"battery", builtIn:false, capacity:1}`,
  `expend: 2`.
- **augType derivado** (D-SF2-03): todas as 10 augmentações do pack têm
  `augType` preenchido (`tech`/`biotech`/`magitech`/`necrograft`) mesmo o
  dado real não carregando esse campo explicitamente.
- **Condições como `effect`, não `condition`** (delta vs. pf2e, confirmado em
  `conditions.ts` do pacote sf2e): os 3 documentos do pack `conditions` têm
  `type: "effect"`; `Suppressed` produz 2 `FlatModifier` convertidos
  (`attack -1 circumstance`, `all-speeds -10 status`); `Untethered` produz um
  `GrantItem` (`Push Off`); `Glitching` produz `FlatModifier` com valor
  dinâmico (`-@item.badge.value`) + `RollOption`s — todos convertidos sem
  erro pelo mesmo dispatcher de Rule Elements do pf2e (`RE_COVERAGE`), zero
  extensão necessária no conversor de rules.

---

## 5. Cobertura de Rule Elements (sf2e)

Do relatório técnico `analysis/08-transform-report-sf2e.json` (5 packs
extraídos para a fase transform: `conditions`, `equipment`, `spells`,
`alien-core-bestiary`, `rulebook-bestiaries` — mais amplo que o subset MVP
final, usado para ter opções de curadoria):

| Métrica                                                         | Valor       |
| --------------------------------------------------------------- | ----------- |
| Total de Rule Elements processadas                              | 703         |
| Suportadas (conversão completa)                                 | 420 (59.7%) |
| Parciais                                                        | 81          |
| Não suportadas (preservadas em `flags.fusion.unconvertedRules`) | 202         |

Cobertura menor que o pf2e (74.9%) porque o bestiário SF2e (`alien-core-bestiary`)
usa mais Rule Elements de criatura (auras, ataques especiais, resistências
compostas) que já eram parcialmente suportadas no pf2e também — nenhuma Rule
Element nova exclusiva do SF2e foi encontrada; o dispatcher `RE_COVERAGE`
(`FlatModifier`, `ActiveEffectLike`, `RollOption`, `GrantItem`, `Note`,
`DamageDice`, `Resistance`, `Sense`, `BaseSpeed`, `TempHP`,
`MartialProficiency`, mais os parciais `ItemAlteration`/`AdjustModifier`/
`Immunity`) é 100% reutilizado do pf2e sem extensão — confirma
D-SF2-01 ("motor 2e unificado").

---

## 6. Não escopo deste batch (explicitamente fora)

- `rulebook-bestiaries` (hazards/vehicles do GM Core) foi extraído mas **não**
  usado no subset MVP — são `type: "hazard"`/`"vehicle"`, não criaturas
  jogáveis em combate padrão; ficam disponíveis em `out/sf2e/rulebook-bestiaries/`
  para curadoria futura (starship combat é [V2], D-SF2-04).
- Nenhuma classe (`classes/`), ancestralidade (`ancestries/`), feat ou spell
  de rank >1 foi incluída no MVP — mesma filosofia do pf2e MVP (subset
  "modesto" para uma primeira sessão, não o catálogo completo).
- `systems/sf2e` (pacote de schemas Zod TS) **não foi alterado** — apenas
  consumido como referência de forma (campos esperados por
  `WeaponSystemSchema`/`AugmentationSystemSchema`/etc., confirmados por
  leitura estática do código-fonte, já que o build do pacote requer o
  workspace completo compilado, fora do escopo desta tarefa de importer).
- Nenhuma alteração nos packs pf2e existentes (`systems/pf2e/packs/`) —
  verificado byte-a-byte idêntico após reexecução completa do pipeline.

---

## 7. Arquivos gerados/alterados neste batch

**Scripts estendidos** (`tools/importer-pf2e/src/`):

- `extract.mjs` — `--system pf2e|sf2e`, `vendorBaseFor()`, relatório sufixado.
- `normalize.mjs` — `--system pf2e|sf2e`, allowlist de traits SF-exclusivos +
  relatório de cobertura, fix de detecção de art path proprietário sf2e.
- `transform.mjs` — `--system pf2e|sf2e`, fusionId namespaced
  (`fusionIdPackKey`), novo normalizador `equipment`/`augType` backfill.
- `build-mvp-subset.mjs` — `--system pf2e|sf2e`, `buildPf2eSubset()` (lógica
  original preservada verbatim) + `buildSf2eSubset()` (novo).

**Testes**: `tools/importer-pf2e/src/__tests__/sf2e-import.test.mjs` (57 testes).

**Dados commitáveis**: `systems/sf2e/packs/{conditions,weapons-core,armor-core,
augmentations-core,bestiary-core,spells-core}/{pack.json,documents.json,index.json}`

- `systems/sf2e/packs/build-report.json`.

**Relatórios de análise**: `analysis/05-id-compat-sf2e.md`,
`analysis/07-relatorio-normalize-sf2e.md`,
`analysis/08-transform-report-sf2e.{md,json}`, este arquivo
(`analysis/08-sf2e-import.md`).

**Samples**: `tools/importer-pf2e/samples/sf2e/<pack>/sample-{1,2,3}.json`
(intermediários, para debugging — não fazem parte do pack final).
