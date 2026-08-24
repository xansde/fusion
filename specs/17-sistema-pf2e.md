# 17 — Sistema Pathfinder 2e

- **Título:** Sistema Pathfinder 2e (Remaster)
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/10-pf2e-sistema-internals.md` — internals do sistema `foundryvtt/pf2e` (Apache-2.0): tipos de actor/item, Rule Elements, synthetics, ciclo de preparação de dados, checks/degrees of success, ConditionManager, IWR, spellcasting, packs.
  - `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — mecânicas centrais do PF2e Remaster: economia de ações, MAP, degrees of success, TEML, DCs, skills, dano/defesas, condições completas, morte/recuperação, magia, runas, mapa de automação VTT.

> **Emenda (F4, DEC-SEP-09, 2026-08-24) — onde vive.** Este sistema (`systems/pf2e`, packs, `tools/importer-pf2e`/`tools/translate-packs`, e a ficha PF2e) vive no repo satélite `xansde/fusion-systems-2e`, consumido pelo core como git submodule pinado por tag em `external/fusion-systems-2e/`. Ver `docs/design/separacao-repos/design.md`.

> **Aviso clean-room.** Esta spec descreve o sistema de jogo PF2e do Fusion,
> reimplementado do zero sobre a system API própria (`ver 15-api-de-sistemas.md`).
> A lógica de regras (algoritmos de cálculo, estruturas de dados, motor de
> modifiers) é conhecimento de domínio das regras PF2e Remaster (publicadas sob
> ORC/OGL), não código proprietário do Foundry. O código TypeScript do
> repositório `foundryvtt/pf2e` (Apache-2.0) pode ser estudado como referência,
> mas a implementação do Fusion é original. Nenhum código do Foundry core
> (proprietário) é reproduzido. Os **dados** de compendium (regras mecânicas sob
> ORC/OGL) são importados via conversor (`ver 16-compendiums-e-importacao.md`).

---

## Objetivo

Especificar o **game system PF2e** do Fusion: o pacote `systems/pf2e` que se
registra na system API (`ver 15-api-de-sistemas.md`) e implementa os schemas de
`system` dos Documents (`ver 02-modelo-de-dados.md`), a automação mecânica do
PF2e Remaster (atributos/perícias derivados, strikes com MAP, degrees of success,
saves, AC, HP/dying/wounded, condições com efeitos automáticos, IWR no apply
damage, spellcasting básico, iniciativa) e as fichas (sheets) de personagem e NPC
em Svelte 5.

Esta spec define ainda o conceito de um **núcleo "engine 2e" compartilhável** —
`systems/engine-2e` — que concentra as mecânicas comuns ao PF2e e ao SF2e
(degrees of success, modifier stacking, TEML, condições base, dying/wounded), de
modo que `systems/sf2e` (`ver 18-sistema-sf2e.md`) reaproveite o núcleo sem
fork.

O foco é o **MVP jogável**: o grupo consegue rodar uma sessão de PF2e com fichas
funcionais, strikes automatizados, saves, condições mecânicas, apply damage com
IWR, spellcasting por slots e iniciativa por Perception. Automação avançada
(motor completo de rule-elements-like, exploração/downtime, crafting, party) é
explicitamente **[V2]**.

---

## Escopo

### O que inclui

- O **pacote `systems/pf2e`**: manifest, registro na system API, schemas Zod de
  `system` por `(documentType, subtype)`, fichas Svelte, hooks de automação.
- O **núcleo `systems/engine-2e`**: mecânicas 2e compartilhadas entre PF2e
  e SF2e (degrees of success, modifier stacking de 7 tipos, TEML, condições base,
  dying/wounded, apply damage/IWR, MAP).
- **Actor types**: `character`, `npc`, `hazard`, `loot`, `familiar` [MVP]. Schemas
  resumidos de cada um, cada um com as suas facetas (`ver 45-atores.md`, DEC-ATR-04).
  `party` e `vehicle` **não existem** e saíram do plano (DEC-ATR-10).
- **Item types**: lista completa da pesquisa 10 com schemas resumidos; subconjunto
  que entra no MVP marcado.
- **Automação MVP**: cálculo de atributos/perícias derivados (TEML+nível), strikes
  com MAP e dano, degrees of success, saves, AC, HP/temp HP, dying/wounded/doomed,
  condições aplicáveis com efeitos mecânicos automáticos (lista priorizada), IWR
  na aplicação de dano, spellcasting básico (slots, focus points), Hero Points,
  iniciativa por Perception/skill.
- **Motor de modifiers** (versão MVP): aplicação declarativa de bônus/penalidades
  tipados às estatísticas via "effects" simples; equivalente reduzido dos Rule
  Elements do pf2e.
- **Fichas**: character sheet por abas (referência: ficha oficial PF2e), NPC sheet
  enxuta para o GM, sheets mínimas de hazard/loot.
- **Mapa de cobertura** mecânica→(automatizado MVP / V2 / manual).
- **Fontes de dados**: o que vem do importer e o que é definido por nós.

### O que NÃO inclui

- A **superfície da system API** (como sistemas registram models/sheets/hooks) —
  `ver 15-api-de-sistemas.md` (esta spec é um _consumidor_ dela).
- O **contrato de dados dos Documents** (campos comuns, UUID, ownership, CRUD) —
  `ver 02-modelo-de-dados.md`.
- O **motor de rolagens** (parsing de fórmulas, RNG autoritativo, `RollResult`) —
  `ver 08-motor-de-rolagens.md` (esta spec _registra fórmulas e interpreta
  resultados_, não executa RNG).
- O **subsistema de combate/iniciativa** (documento `Combat`, tracker, ciclo de
  turno) — `ver 10-combate-e-iniciativa.md` (esta spec fornece a `InitiativeFormula`
  e os handlers de ciclo de vida).
- O **framework de UI e o contrato de sheets** (window manager, autosave, tabs) —
  `ver 11-ui-framework-e-fichas.md` (esta spec fornece os _componentes_ de sheet).
- O **pipeline de importação/conversão** dos JSON do `foundryvtt/pf2e` —
  `ver 16-compendiums-e-importacao.md` (esta spec define o _formato-alvo_ que o
  importer deve produzir).
- **SF2e** (classes, armas tech, gravidade, naves) — `ver 18-sistema-sf2e.md`.
- **Motor completo de rule-elements-like** (GrantItem/ChoiceSet/Aura/BattleForm
  equivalentes), **exploração/downtime/crafting/kingmaker** — todos **[V2]**.
- A **regra variante de multiclasse por níveis de classe** (níveis divididos ao
  estilo 5e, com o par `class_level`/`character_level`) —
  `ver 30-multiclasse-por-niveis.md`. Esta spec descreve o PF2e **RAW**, em que os
  dois números são sempre iguais e multiclasse se faz por arquétipo de dedicação.
- A **ampliação da base de conteúdo** (as 27 classes, ABC completo, eixos de
  sub-escolha como dado) — `ver 31-base-canonica-de-conteudo.md`. Esta spec define
  os _schemas_; aquela define de onde vem o _conteúdo_ que os preenche.

---

## Conceitos e terminologia

| Termo                    | Definição                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **engine 2e core**       | Pacote `systems/engine-2e` com a lógica de regras compartilhada entre PF2e e SF2e (não depende de nenhum dos dois).                                                                                                                                                                                                                                    |
| **system pf2e**          | Pacote `systems/pf2e` que registra schemas, fichas e automação específicos do PF2e Remaster, consumindo o engine 2e core.                                                                                                                                                                                                                              |
| **TEML**                 | Ranks de proficiência: **T**rained, **E**xpert, **M**aster, **L**egendary (mais Untrained). Codificados como `ProficiencyRank = 0..4`.                                                                                                                                                                                                                 |
| **Proficiência (bônus)** | `rank > 0 ? rank*2 + level : 0`. Untrained não soma nível (variante "no level" é [V2]).                                                                                                                                                                                                                                                                |
| **Modifier**             | Bônus/penalidade tipado (`circumstance`/`item`/`status`/`untyped`/`ability`/`proficiency`/`potency`) aplicado a uma estatística por um seletor.                                                                                                                                                                                                        |
| **Seletor (selector)**   | String que identifica a estatística que um modifier afeta: `"ac"`, `"reflex"`, `"attack"`, `"skill:athletics"`, `"damage"`, `"fortitude-dc"` etc.                                                                                                                                                                                                      |
| **Statistic**            | Estatística rolável agregada: base + stack de modifiers resolvido → `total`, com `dc` derivada quando aplicável.                                                                                                                                                                                                                                       |
| **DegreeOfSuccess**      | Conjunto qualitativo de 4 graus (`CriticalSuccess`/`Success`/`Failure`/`CriticalFailure`) calculado a partir de `(total - dc)` com ajustes nat20/nat1. O tipo na system-api é genérico (`ver 08-motor-de-rolagens.md`); o conjunto de 4 graus e seu helper de cálculo (±10, nat 1/20) vivem em `systems/engine-2e` e são reutilizados por PF2e e SF2e. |
| **Strike**               | Ação de ataque derivada de uma arma equipada (ou ataque de NPC/`melee`); produz attack roll + damage roll com MAP.                                                                                                                                                                                                                                     |
| **MAP**                  | Multiple Attack Penalty: 0 / −5 / −10 (ou 0 / −4 / −8 com trait `agile`), por turno.                                                                                                                                                                                                                                                                   |
| **Condition**            | Estado mecânico aplicado a um ator (item embedded de subtype `condition`), com `slug` canônico e `value` opcional para condições numeradas.                                                                                                                                                                                                            |
| **Effect**               | Item embedded de subtype `effect` que carrega `modifiers` declarativos e/ou aplica condições, com duração opcional.                                                                                                                                                                                                                                    |
| **IWR**                  | Immunities / Weaknesses / Resistances: regras de imunidade, fraqueza e resistência a tipos de dano (e a condições), aplicadas no pipeline de dano.                                                                                                                                                                                                     |
| **Spellcasting entry**   | Item embedded de subtype `spellcastingEntry`: container de magia com tradição, atributo, proficiência e slots.                                                                                                                                                                                                                                         |
| **Slug**                 | Identificador kebab-case canônico de uma condição, trait, skill ou efeito (ex.: `off-guard`, `frightened`).                                                                                                                                                                                                                                            |
| **Roll option**          | Flag booleana (string) no conjunto de opções de um roll, usada por predicados de modifiers (ex.: `target:condition:off-guard`). [V2 para predicados complexos]                                                                                                                                                                                         |

---

## Decisões

### DEC-PF2-01 — Núcleo "engine 2e" separado, compartilhado com SF2e

**Decisão:** As mecânicas comuns ao PF2e e ao SF2e residem em
`systems/engine-2e` (TypeScript puro, sem dependência de Svelte nem de
nenhum dos dois sistemas). `systems/pf2e` e `systems/sf2e` dependem desse núcleo
e adicionam apenas o que é específico.

**O que vai para o núcleo:** algoritmo de degree of success, modifier stacking (7
tipos), cálculo TEML de proficiência, simple/level-based DCs, mecânicas de
condições base (incluindo numeradas e dying/wounded/doomed), pipeline de apply
damage com IWR, cálculo de MAP, fórmulas genéricas de check/save/AC/spell DC.

**O que fica em `systems/pf2e`:** schemas concretos de actor/item, lista canônica
de skills (16) e suas associações de atributo, lista de condições PF2e, runas,
traditions de magia, traits de arma, fichas Svelte, registro na system API.

**Alternativas rejeitadas:**

- _Tudo dentro de `systems/pf2e` e SF2e importa de lá_: cria dependência
  `sf2e → pf2e`, acopla a evolução dos dois e mistura conteúdo PF2e-específico
  (skills, runas) com mecânica genérica.
- _Duplicar a mecânica em cada sistema_: viola DRY; degree of success e modifier
  stacking são idênticos e mudanças teriam de ser feitas em dois lugares.

**Racional:** A pesquisa 13 §15.1 confirma que SF2e "usa o mesmo motor do PF2e
remaster como base" (3 ações, TEML, degrees of success idênticos, lista base de
condições igual). Isolar esse motor é a forma natural de evitar fork.

### DEC-PF2-02 — Schemas de `system` em Zod, derivados em TS

**Decisão:** Cada par `(documentType, subtype)` (ex.: `(Actor, "character")`,
`(Item, "weapon")`) tem um schema Zod registrado na system API. O `_source.system`
é validado por esse schema; os tipos TS são derivados via `z.infer`.

**Racional:** Alinha com a decisão DEC-DOC-01 da spec 02 (Zod runtime + tipos derivados).
Os dados vêm de importação externa (JSON do `pf2e`) e precisam de validação
autoritativa no servidor.

**Alternativas rejeitadas:**

- _Espelhar o sistema `DataModel`/`DataField` do Foundry_: a spec 02 já rejeitou
  isso para a engine; manter coerência.

### DEC-PF2-03 — Dados derivados via `prepareData`, nunca persistidos

**Decisão:** Todo cálculo de PF2e (proficiências, AC, HP, saves, strikes, spell
DC) ocorre numa função de preparação `prepareDerived(actor)` executada sobre uma
**cópia** do `_source`, populando um objeto `derived` em memória. O `_source`
nunca é mutado por dados derivados (consistente com spec 02).

**Pipeline de preparação (espelha o ciclo do pf2e, pesquisa 10 §6):**

1. `prepareBaseData` — abilities (scores → mods), proficiency ranks declarados,
   HP base por classe/ancestry, traits.
2. `prepareItems` — agrega contribuições de ancestry/background/class (ABC),
   feats que concedem proficiência ou modifiers simples, itens equipados.
3. `collectModifiers` — varre `effects`/condições/itens e coleta os `Modifier`
   por seletor num registro `ModifierRegistry` (análogo ao `synthetics` do pf2e,
   mas reduzido para o MVP).
4. `prepareDerived` — resolve cada `Statistic` (base + stack) → `total`/`dc`;
   monta strikes, skills, saves, perception, spell DCs.

**Racional:** Determinismo e auditabilidade. O servidor é autoritativo: recalcula
ao receber updates; o cliente recalcula localmente para feedback imediato, mas o
servidor é a fonte da verdade.

### DEC-PF2-04 — Motor de modifiers reduzido no MVP; Rule-Elements-like completo é [V2]

**Decisão:** O MVP implementa um **motor de modifiers declarativo reduzido**: um
`Effect`/`Feat`/`Condition` pode carregar um array `modifiers` (cada um com
`selector`, `type`, `value`, `slug`, `predicate?` simples) e/ou um array de
`grantedConditions`. Isso cobre o caso dominante (bônus/penalidade tipado a uma
estatística + aplicar condição). O motor **completo** de Rule-Elements-like
(GrantItem, ChoiceSet, Aura, BattleForm, DamageDice condicional, AdjustModifier,
ItemAlteration, predicados ricos) é **[V2]**.

**Subconjunto de "rule-element-like" no MVP** (mapeado dos REs do pf2e, pesquisa
10 §5.3):

- `FlatModifier` → `Modifier { selector, type, value }`.
- `DamageDice` (apenas estático, não condicional) → entrada em `extraDamage`.
- `IWR` → entradas em `system.attributes.iwr`.
- `Note` (RollNote estático) → texto anexado ao resultado.
- `BaseSpeed` / `Sense` (estáticos) → campos diretos.

**Fora do MVP (V2):** `GrantItem`, `ChoiceSet`, `Aura`, `BattleForm`,
`AdjustModifier`, `AdjustDegreeOfSuccess` dinâmico, `EphemeralEffect`,
`RollOption` com predicados complexos, `ItemAlteration`, `MartialProficiency`
dinâmica, `TokenLight`/`TokenImage` condicionais.

**Alternativas rejeitadas:**

- _Implementar o motor de REs completo já no MVP_: a pesquisa 10 §5.3 lista 40+
  tipos de RE; reimplementá-los todos com predicação rica antes de uma sessão
  jogável é desproporcional. A maioria das fichas de MVP funciona com modifiers
  estáticos + condições.
- _Hardcode por feat/magia sem motor declarativo_: inviabiliza importar centenas
  de feats/effects dos packs; o formato de dados do pf2e é data-driven e o
  importer produz `rules[]` que mapeamos para `modifiers[]`.

**Nota de importação:** O importer (`ver 16-compendiums-e-importacao.md`) traduz
o array `system.rules` de cada item: REs suportados no MVP viram `modifiers[]`;
REs não suportados são preservados em `flags.fusion.unsupportedRules[]` (para
[V2]) e o item é marcado `automation: "partial"`.

### DEC-PF2-05 — Degree of success no servidor, a partir do `RollResult`

**Decisão:** O cálculo do `DegreeOfSuccess` ocorre no servidor, sobre o `total`
do `RollResult` (`ver 08-motor-de-rolagens.md`) e a DC alvo, usando o algoritmo
do engine 2e core. A detecção de nat20/nat1 usa o resultado do **primeiro d20**
do roll (campo `dieResults` do termo de d20 no `RollResult`).

**Algoritmo (pesquisa 13 §2):**

```
margin = total - dc
degree = margin >= 10 ? Crit : margin >= 0 ? Success : margin > -10 ? Failure : CritFailure
if natural20: degree = clampUp(degree)      // sobe um grau
if natural1:  degree = clampDown(degree)    // desce um grau
// ajustes de effects (AdjustDegreeOfSuccess) aplicados depois — [V2]
```

**Racional:** Manter a determinação canônica no servidor (anti-cheat) e coerente
com a execução autoritativa de rolagens.

### DEC-PF2-06 — Strikes derivados de itens equipados; ataque e dano em duas rolagens

**Decisão:** A lista de strikes de um ator é **derivada** das armas equipadas
(actor character) ou dos itens `melee`/armas (NPC), mais strikes concedidos por
feats. Cada strike expõe três variantes de attack (MAP 0 / MAP 1 / MAP 2) e um
botão de dano. O attack roll e o damage roll são **rolagens separadas** (o dano
só é rolado após o ataque acertar/critar), seguindo a UX do PF2e.

**Cálculo (pesquisa 13 §3.2, §6):**

```
attackBonus = abilityMod(strike) + proficiencyBonus(weaponCategory) + itemBonus(potency rune) + Σ otherModifiers
damage      = weaponDice(die,faces) + strikingDice + abilityMod(damage) + Σ damageModifiers
```

- `abilityMod(strike)`: STR para melee; DEX com trait `finesse`; DEX para ranged.
- `abilityMod(damage)`: STR para melee; ranged sem STR salvo `propulsive` (½ STR
  positivo) ou `thrown` (STR completo).
- `strikingDice`: striking +1 / greater +2 / major +3 dados extras.
- Critical hit: dobra o total de dano (`deadly`/`fatal` adicionam dados — `deadly`
  no MVP; `fatal` substitui o die e adiciona um die, [MVP] básico).

**Alternativas rejeitadas:**

- _Dano e ataque numa única rolagem_: não permite aplicar o degree of success para
  decidir crítico/dobra antes de rolar dano; quebra a UX e a regra de "dobra no
  crit".
- _Strikes manuais digitados no statblock_: aceitável só para NPCs importados sem
  arma estruturada; o character usa strikes derivados.

### DEC-PF2-07 — Condições como itens embedded com efeito mecânico no core

**Decisão:** Condições são itens embedded (subtype `condition`) com `slug`
canônico e `value` opcional. O engine 2e core conhece o **efeito mecânico** de
cada condição priorizada e o aplica automaticamente via modifiers gerados na fase
`collectModifiers`. A API do ator expõe `increaseCondition`/`decreaseCondition`/
`toggleCondition`/`setCondition` (espelha o ConditionManager do pf2e, pesquisa 10
§8.1).

**Racional:** Tratar condições como dados (itens) + lógica central evita hardcode
espalhado e permite que o GM aplique/remova condições pela ficha ou pelo token. A
imunidade a uma condição (via IWR) bloqueia a aplicação automaticamente.

### DEC-PF2-08 — Apply damage com IWR no servidor, com prompt de mitigação

**Decisão:** A aplicação de dano a um alvo passa por um pipeline central no
servidor: recebe `{ amount, types[], traits[] }`, consulta o IWR do alvo e aplica
**Immunity → Weakness → Resistance** (ordem da pesquisa 13 §6.4), produzindo o HP
final e um breakdown auditável exibido no chat. O usuário pode aplicar
dano/metade/dobro/cura por botões no card de dano.

**Racional:** Centralizar a aritmética de IWR no servidor garante consistência e
auditabilidade; o breakdown explica ao jogador por que o número final difere do
rolado.

### DEC-PF2-09 — Ficha de personagem por abas (referência ficha oficial); NPC enxuta

**Decisão:** A character sheet é organizada em abas — **Character** (resumo/skills/
saves), **Actions** (strikes/ações/atividades), **Inventory**, **Spells**,
**Feats/Features**, **Biography/Effects**. Componentes Svelte 5 registrados pela
system API por `(Actor, "character")`. A NPC sheet é **enxuta**, voltada ao GM:
statblock compacto (AC, saves, HP, perception, skills), lista de strikes/ações e
spellcasting, com edição rápida.

**Racional:** A ficha oficial do PF2e organiza a complexidade por abas; replicar
essa divisão reduz a curva de aprendizado. A NPC precisa de leitura rápida durante
o combate, não de um formulário completo.

### DEC-PF2-10 — Iniciativa por Perception (padrão), skill configurável

**Decisão:** `systems/pf2e` registra a `InitiativeFormula`
(`ver 10-combate-e-iniciativa.md`) como `1d20 + @perception.mod` por padrão, com
opção de trocar a skill por combatant (Stealth em Avoid Notice, etc.). O
desempate usa o `tiebreaker` numérico (modificador de Perception) do contrato da
`InitiativeFormula` — o caso monotônico simples, sem precisar de `compare`
(DEC-CBT-04 da spec 10; REQ-SYS-042 da spec 15).

**Racional:** Pesquisa 13 §12.2: iniciativa padrão é Perception, mas atividades de
exploração permitem outra skill. O modelo de fórmula delegada da spec 10 acomoda
isso sem alterar o núcleo de combate.

---

## Requisitos funcionais

> Tags: **[MVP]** = necessário para a sessão jogável de PF2e (definição de MVP
> global). **[V2]** = pós-MVP.

### Registro e schemas

- **REQ-PF2-001** [MVP] O pacote `systems/pf2e` DEVE registrar-se na system API
  (`ver 15-api-de-sistemas.md`) declarando `id: "pf2e"`, versão, e a lista de
  `(documentType, subtype)` que provê, com seus schemas Zod e fichas.
- **REQ-PF2-002** [MVP] Para cada Actor subtype suportado (`character`, `npc`,
  `hazard`, `loot`), o sistema DEVE registrar um schema Zod de `system` validável
  no servidor.
- **REQ-PF2-003** [MVP] Para cada Item subtype do MVP (ver Modelo de Dados), o
  sistema DEVE registrar um schema Zod de `system`.
- **REQ-PF2-004** [MVP] O pacote DEVE consumir `systems/engine-2e` para
  degree of success, modifier stacking, TEML, condições base e apply damage,
  sem reimplementá-los localmente.
- **REQ-PF2-005** [MVP] O sistema DEVE expor metadados de localização (pt-BR
  primário, en secundário) para labels de skills, condições, traits e tipos de
  dano (`ver 11-ui-framework-e-fichas.md` §i18n).

### Cálculo de proficiência e atributos derivados

- **REQ-PF2-010** [MVP] O sistema DEVE calcular o modificador de cada ability a
  partir do score: `mod = floor((score - 10) / 2)`.
- **REQ-PF2-011** [MVP] O sistema DEVE calcular o bônus de proficiência por rank
  TEML: Untrained `+0` (sem nível), Trained/Expert/Master/Legendary
  `+rank*2 + level` (rank 1..4).
- **REQ-PF2-012** [MVP] O sistema DEVE derivar cada uma das 16 perícias como
  `Statistic` = `d20 + abilityMod(skill) + proficiencyBonus(rank) + Σ modifiers`,
  com a associação skill→atributo da pesquisa 13 §5.1.
- **REQ-PF2-013** [MVP] O sistema DEVE suportar perícias **Lore** customizadas
  (subtype `lore`), cada uma com rank próprio e atributo INT.
- **REQ-PF2-014** [MVP] O sistema DEVE derivar **Perception** = `d20 + WIS mod +
proficiencyBonus(perception rank) + Σ modifiers`.
- **REQ-PF2-015** [MVP] O sistema DEVE derivar os três **saves** (Fortitude=CON,
  Reflex=DEX, Will=WIS) como `Statistic`, e suas DCs quando exigidas como defesa
  passiva (`fortitude-dc` = 10 + save total − d20, i.e. 10 + bônus do save).
- **REQ-PF2-016** [MVP] O sistema DEVE derivar a **Class DC** =
  `10 + keyAbilityMod + proficiencyBonus(classDC rank)`.
- **REQ-PF2-017** [MVP] O sistema DEVE derivar a **Spell DC** e o **Spell Attack**
  por spellcasting entry: `10 + abilityMod + proficiencyBonus` e
  `d20 + abilityMod + proficiencyBonus` respectivamente.

### AC, HP e defesas

- **REQ-PF2-020** [MVP] O sistema DEVE derivar a **AC** = `10 + dexMod (limitado
pelo dex cap da armadura) + proficiencyBonus(armor category) + itemBonus(armor
potency rune) + Σ modifiers`, aplicando a penalidade de armadura `broken` quando
  presente.
- **REQ-PF2-021** [MVP] O sistema DEVE calcular o **HP máximo** do character como
  `ancestryHP + (classHP + conMod) * level + Σ bônus`, e o do NPC a partir do
  `system.attributes.hp.max` declarado no statblock.
- **REQ-PF2-022** [MVP] O sistema DEVE rastrear `hp.value`, `hp.max`, `hp.temp`
  (HP temporário, não cumulativo: maior vence) e aplicar dano primeiro ao temp HP.
- **REQ-PF2-023** [MVP] O sistema DEVE aplicar **Hardness** (escudo/objeto) antes
  do HP quando o dano for direcionado a um item com hardness.
- **REQ-PF2-024** [V2] O sistema DEVE suportar a variante **Stamina Points** (SP)
  no HP do character.

### Strikes, MAP e dano

- **REQ-PF2-030** [MVP] O sistema DEVE derivar a lista de **strikes** de um
  character a partir das armas equipadas e dos strikes concedidos por feats, e a
  de um NPC a partir dos itens `melee`/armas.
- **REQ-PF2-031** [MVP] Cada strike DEVE expor três variantes de attack roll com
  MAP `0 / −5 / −10`, ou `0 / −4 / −8` quando a arma tem trait `agile`
  (pesquisa 13 §1.4).
- **REQ-PF2-032** [MVP] O attack roll DEVE usar `abilityMod` correto: STR (melee),
  DEX (melee com `finesse`), DEX (ranged); mais proficiência por categoria de arma
  e bônus de runa de potência.
- **REQ-PF2-033** [MVP] O damage roll DEVE compor `weaponDice + strikingDice +
abilityMod(damage) + Σ damageModifiers`, com `abilityMod(damage)` = STR (melee),
  nenhum (ranged), ½ STR positivo (`propulsive`), STR completo (`thrown`).
- **REQ-PF2-034** [MVP] Num **critical hit** (degree CriticalSuccess no attack), o
  sistema DEVE dobrar o total do dano; traits `deadly d#` DEVEM adicionar `d#` ao
  dano dobrado; `fatal d#` DEVE substituir o die da arma por `d#` e adicionar um
  die extra.
- **REQ-PF2-035** [MVP] O MAP DEVE ser resetado no início de cada turno do ator
  (integração com `onTurnStart`, `ver 10-combate-e-iniciativa.md`).
- **REQ-PF2-036** [V2] O sistema DEVE aplicar **critical specialization effects**
  por grupo de arma.
- **REQ-PF2-037** [V2] O sistema DEVE aplicar **range increments** (penalidade
  cumulativa por incremento de alcance em ataques à distância).

### Degrees of success e checks

- **REQ-PF2-040** [MVP] Para todo check contra DC, o sistema DEVE calcular o
  `DegreeOfSuccess` pelo algoritmo `margin ≥10/≥0/>−10/≤−10` com ajuste nat20
  (sobe um grau) / nat1 (desce um grau), nessa ordem (pesquisa 13 §2).
- **REQ-PF2-041** [MVP] Para **basic saving throws**, o sistema DEVE aplicar o
  dano padronizado por grau: CritSuccess 0, Success metade, Failure completo,
  CritFailure dobro (pesquisa 13 §2.3).
- **REQ-PF2-042** [MVP] O sistema DEVE expor **simple DCs** (Untrained 10 …
  Legendary 40) e **level-based DCs** (tabela pesquisa 13 §4.2) e os ajustes de
  raridade (Uncommon +2, Rare +5, Unique +10) para uso em ações e Recall Knowledge.
- **REQ-PF2-043** [V2] O sistema DEVE suportar `AdjustDegreeOfSuccess` dinâmico via
  effects (ex.: Evasion, Juggernaut).
- **REQ-PF2-044** [MVP] O sistema DEVE suportar **Hero Points**: pool (máx 3),
  gasto de 1 para reroll (fortune: toma o novo resultado) e gasto de todos
  (Heroic Recovery: remove Dying e estabiliza com 0 HP).

### Condições

- **REQ-PF2-050** [MVP] O sistema DEVE registrar a lista canônica de condições
  PF2e (slugs) e permitir aplicá-las/removê-las como itens embedded via
  `increaseCondition`/`decreaseCondition`/`toggleCondition`/`setCondition`.
- **REQ-PF2-051** [MVP] As condições do **conjunto priorizado MVP** DEVEM ter
  efeito mecânico automático aplicado via modifiers:
  - `off-guard` → −2 circumstance na AC.
  - `frightened X` → −X status em **todas** as jogadas e DCs; decrementa 1 ao fim
    do turno do ator.
  - `clumsy X` → −X status em jogadas/DCs baseadas em DEX (AC, Reflex, ranged
    attack, Acrobatics, Stealth, Thievery).
  - `enfeebled X` → −X status em jogadas/DCs baseadas em STR (melee attack, melee
    damage, Athletics).
  - `drained X` → −X status em jogadas/DCs de CON (Fortitude); reduz o HP máximo
    e o HP atual em `nível × X` (pesquisa 13 §7.1); decrementa 1 por descanso
    noturno completo. **Critério verificável:** aplicar Drained 2 a um personagem
    de nível 5 deve reduzir HP máximo e HP atual em 10 pontos.
  - `stupefied X` → −X status em jogadas/DCs de INT/WIS/CHA; flat check DC 5+X ao
    conjurar.
  - `sickened X` → −X status em todas as jogadas e DCs.
  - `slowed X` → reduz em X as ações recuperadas no início do turno.
  - `stunned X` → consome X ações no início do turno (sobrepõe slowed).
  - `quickened` → +1 ação por turno.
  - `prone` → off-guard + −2 em ataques; restringe ações de movimento.
  - `fatigued` → −1 status em AC e saves.
  - `unconscious` → −4 status em AC/Perception/Reflex; off-guard; blinded.
  - `doomed X` → reduz o máximo de Dying (Dying chega a `4 − X` = morte).
  - `wounded X` → soma X ao valor inicial de Dying ao ganhar a condição Dying.
- **REQ-PF2-052** [MVP] As condições de **detecção** (`blinded`, `concealed`,
  `dazzled`, `deafened`, `hidden`, `invisible`, `observed`, `undetected`,
  `unnoticed`) DEVEM existir como condições aplicáveis com seus flat checks
  documentados; o **efeito de posição/visão no canvas** é parcial/manual no MVP
  (`ver 07-visao-iluminacao-fog.md`), mas o flat check (ex.: DC 5 concealed, DC 11
  hidden/undetected) DEVE estar disponível como ação rolável.
- **REQ-PF2-053** [MVP] A imunidade a uma condição (via IWR) DEVE impedir a
  aplicação automática dela.
- **REQ-PF2-054** [MVP] Condições com **value** DEVEM empilhar pelo maior valor
  (não somar) ao serem aplicadas múltiplas vezes.
- **REQ-PF2-055** [V2] Decremento/expiração automática orientada a regras
  complexas (ex.: `persistent damage` ao fim do turno com flat check DC 15
  automatizado) — ver REQ-PF2-061.

### IWR e apply damage

- **REQ-PF2-060** [MVP] O pipeline de **apply damage** DEVE aplicar, nesta ordem,
  **Immunity → Weakness → Resistance** sobre o dano por tipo, considerando
  `exceptions` e `doubleVs`, e produzir um breakdown auditável (pesquisa 13 §6.4,
  pesquisa 10 §8.2).
- **REQ-PF2-061** [MVP] O sistema DEVE suportar **persistent damage** como
  condição/efeito: ao fim do turno do alvo, aplica o dano e oferece o flat check
  DC 15 (DC 10 com assistência) para encerrá-lo. A aplicação do dano é automática;
  o flat check é rolável pelo jogador.
- **REQ-PF2-062** [MVP] Fraquezas e resistências DEVEM ser aplicadas **após** a
  multiplicação de crítico.
- **REQ-PF2-063** [MVP] O sistema DEVE derivar imunidades a partir de traits do
  ator quando declarado (ex.: criatura com trait elemental fire → imune a fire),
  via dados do statblock importado.

### HP, morte e recuperação

- **REQ-PF2-070** [MVP] Ao chegar a 0 HP, um character DEVE ganhar `dying 1`
  (ou `dying 2` se causado por crit/critical failure), somando o valor de
  `wounded` ao valor inicial de Dying.
- **REQ-PF2-071** [MVP] No início de cada turno enquanto Dying, o sistema DEVE
  oferecer o **recovery check** (flat check DC `10 + dyingValue`): CritSuccess
  −2, Success −1, Failure +1, CritFailure +2; chegar a `dying = maxDying` =
  morte.
- **REQ-PF2-072** [MVP] Receber dano enquanto Dying DEVE somar +1 ao Dying (+2 se
  crit).
- **REQ-PF2-073** [MVP] Ao perder a condição Dying, o ator DEVE ganhar
  `wounded 1` (ou +1 se já tiver Wounded).
- **REQ-PF2-074** [MVP] `doomed X` DEVE reduzir o `maxDying` (Doomed 1 → morre em
  Dying 3; Doomed 4 = morte imediata).

### Spellcasting

- **REQ-PF2-080** [MVP] O sistema DEVE suportar **spellcasting entries** dos tipos
  `prepared`, `spontaneous` e `innate`, cada um com tradição (arcane/divine/occult/
  primal), atributo-chave e proficiência.
- **REQ-PF2-081** [MVP] O sistema DEVE rastrear **slots** por rank (1..10) com
  `value`/`max`; conjurar uma magia DEVE consumir um slot do rank usado (prepared:
  do slot preparado; spontaneous: de qualquer slot do rank).
- **REQ-PF2-082** [MVP] **Cantrips** DEVEM ser ilimitados e automaticamente
  heightened para `ceil(level/2)`.
- **REQ-PF2-083** [MVP] O sistema DEVE suportar **Focus Points** (pool máx 3),
  consumo ao lançar focus spell e recuperação via Refocus; focus spells são
  heightened automaticamente para `ceil(level/2)`.
- **REQ-PF2-084** [MVP] Uma magia com `defense.save` DEVE gerar o card com a save
  apropriada e, se `basic`, aplicar o dano por grau (REQ-PF2-041); uma magia com
  spell attack DEVE rolar `spell-attack-roll`.
- **REQ-PF2-085** [V2] Heightening manual completo (prepared em rank superior /
  spontaneous signature spells) e fórmulas de heightened `(+X)` aplicadas
  automaticamente. _(No MVP, heightening é parcial: cantrips e focus automáticos;
  slots de rank superior consumidos manualmente sem recálculo automático de dano.)_
- **REQ-PF2-086** [V2] Counteract/Counterspell automatizado (comparação de ranks,
  pesquisa 13 §9.6).
- **REQ-PF2-087** [V2] Spellcasting `focus`, `items` (scroll/wand), `staff` e
  `ritual` como tipos de entry.

### Iniciativa e combate

- **REQ-PF2-090** [MVP] O sistema DEVE registrar a `InitiativeFormula`
  (`ver 10-combate-e-iniciativa.md`) como `1d20 + perception.mod` por padrão, com
  o tiebreaker = modificador de Perception.
- **REQ-PF2-091** [MVP] O sistema DEVE permitir trocar a skill de iniciativa por
  combatant (ex.: Stealth para Avoid Notice).
- **REQ-PF2-092** [MVP] O sistema DEVE registrar handlers de ciclo de vida
  (`onTurnStart`/`onTurnEnd`) para: resetar MAP, decrementar `frightened`,
  processar `slowed`/`stunned` na contagem de ações, oferecer recovery check de
  Dying e aplicar persistent damage.

### Ações de skill e inline

- **REQ-PF2-100** [MVP] O sistema DEVE prover as **ações básicas de skill** mais
  comuns como botões roláveis na ficha: Strike, Seek, Recall Knowledge, Demoralize,
  Trip, Grapple, Shove, Disarm, Treat Wounds, Escape, Stride (sem rolagem). A lista
  completa de action macros é incremental.
- **REQ-PF2-101** [MVP] **Recall Knowledge** DEVE rolar como secret check (GM-only)
  contra o level-based DC da criatura (ajustado por raridade), mapeando o trait da
  criatura para a skill (pesquisa 13 §13.2).
- **REQ-PF2-102** [MVP] O sistema DEVE interpretar os **inline enrichers** dos
  textos importados — `@Check[type:reflex dc:18 basic:true]`, `@Damage[2d6 fire]`,
  `@Template[type:burst distance:20]`, `@UUID[...]` — renderizando-os como botões
  clicáveis (`ver 09-chat-e-mensagens.md`, `ver 11-ui-framework-e-fichas.md`).
- **REQ-PF2-103** [V2] Exploration/downtime activities (Avoid Notice, Scout,
  Search, Investigate, Craft, Earn Income) com automação.

### Fichas (sheets)

- **REQ-PF2-110** [MVP] O sistema DEVE registrar uma **character sheet** Svelte 5
  por abas (Character, Actions, Inventory, Spells, Feats/Features, Bio/Effects),
  com binding/autosave conforme `ver 11-ui-framework-e-fichas.md`.
- **REQ-PF2-111** [MVP] O sistema DEVE registrar uma **NPC sheet** enxuta (statblock
  compacto + strikes/ações + spellcasting + skills), otimizada para o GM em combate.
- **REQ-PF2-112** [MVP] O sistema DEVE registrar sheets mínimas para **hazard**
  (statblock de armadilha: AC/saves/HP/Hardness, rotina de ações de disparo) e
  **loot** (apenas inventário).
- **REQ-PF2-113** [MVP] As sheets DEVEM permitir rolar checks/strikes/saves
  clicando no respectivo elemento, abrindo o motor de rolagens com a fórmula
  derivada e produzindo um chat card com o `DegreeOfSuccess`.
- **REQ-PF2-114** [MVP] As sheets DEVEM exibir e permitir editar condições ativas
  e seus valores.
- **REQ-PF2-115** [V2] Sheet de `familiar` (`ver 29-pets-companions-familiars.md`).
  `party` e `vehicle` foram removidos deste requisito: não são actor types do Fusion
  (`ver 45-atores.md`, DEC-ATR-08), e o agrupamento de personagens é o painel de
  Comitiva do Hub (REQ-HUB-044), não um ator.

### Bulk e inventário

- **REQ-PF2-120** [MVP] O sistema DEVE calcular o **Bulk** carregado (1 Bulk;
  10 L = 1 Bulk; negligível = 0) e os limiares por STR: encumbered acima de
  `5 + strMod`, máximo `10 + strMod`.
- **REQ-PF2-121** [MVP] Ultrapassar o limiar de encumbered DEVE aplicar a condição
  `encumbered` (clumsy 1, −10 ft Speed).
- **REQ-PF2-122** [V2] Capacidade de containers, bulk reduction e bulk por tamanho
  de criatura na carga.

### Equipamento mágico

- **REQ-PF2-130** [MVP] O sistema DEVE aplicar o efeito mecânico das **runas
  fundamentais**: weapon potency (+1/+2/+3 item bonus no ataque), striking
  (+1/+2/+3 dados de dano), armor potency (+1/+2/+3 AC), resilient (+1/+2/+3 saves).
- **REQ-PF2-131** [V2] Runas de **propriedade** com efeitos automatizados
  (flaming, frost, etc.) e seus limites por potência; transferência de runas.

### Plateia dos packs publicados

> **Emenda de 2026-08-16**, obrigada pela `43` §12 (DEC-CPD-04, REQ-CPD-072). É
> mudança de **publicação**, não de conteúdo: nenhum documento dos packs muda, só o
> manifesto que os acompanha. A plateia declarada aqui é _declaração_; quem a
> **impõe** é o servidor (`ver 16-compendiums-e-importacao.md`, REQ-CMP-010a).

- **REQ-PF2-140** [MVP] Todo pack publicado por `systems/pf2e` DEVE declarar
  `audience` no seu manifesto, ao lado de `license` (REQ-CMP-004a). A ausência do
  campo DEVE ser lida como `"all"` e NÃO DEVE impedir o carregamento de um pack já
  publicado.
- **REQ-PF2-141** [MVP] Os packs de **criaturas** (bestiário) DEVEM ser publicados
  com `audience: "gm"` (REQ-CPD-072) — hoje `pf2e.bestiary-core`, e qualquer pack de
  criaturas que o sistema venha a publicar depois.
- **REQ-PF2-142** [MVP] Os packs de **perigos** (Actor subtype `hazard`) DEVEM ser
  publicados com `audience: "gm"`. O sistema ainda não publica nenhum: o requisito é
  prospectivo e DEVE ser satisfeito no momento em que o primeiro pack de perigos for
  gerado; a plateia NÃO DEVE ser decidida caso a caso na geração.
- **REQ-PF2-143** [MVP] Os demais packs do sistema — equipamento, armas, magias,
  feats, ancestralidades, heranças, antecedentes, classes, características de classe,
  ações e condições — DEVEM ser publicados com `audience: "all"`: são as regras que o
  jogador precisa consultar para jogar.
- **REQ-PF2-144** [MVP] O sistema NÃO DEVE compensar a plateia mexendo no conteúdo:
  é proibido omitir, truncar ou redigir documento de um pack `gm` na geração — o
  bestiário publicado permanece íntegro para quem satisfaz `isRolePrivileged`
  (REQ-CPD-071, REQ-CPD-074).
- **REQ-PF2-145** [MVP] Alterar a plateia de um pack NÃO DEVE exigir regerar seus
  documentos: é edição de manifesto. A reabertura de um pack `gm` para os jogadores
  por configuração de mundo (REQ-CPD-075 [V2], `ver 37-configuracoes.md`) NÃO DEVE
  alterar o manifesto publicado.

---

## Requisitos não-funcionais

- **REQ-PF2-200** [MVP] A preparação derivada de um ator (`prepareDerived`) DEVE
  ser **determinística** e **pura** (mesmo `_source` + mesmos itens → mesmo
  `derived`), sem efeitos colaterais nem RNG.
- **REQ-PF2-201** [MVP] O recálculo de um character completo (com ~50 itens) DEVE
  concluir em **< 16 ms** em hardware de referência (um frame), para permitir
  recálculo reativo na ficha sem travamento perceptível.
- **REQ-PF2-202** [MVP] O engine 2e core NÃO DEVE depender de Svelte, PIXI nem de
  APIs de browser, permitindo execução idêntica no servidor (Node 22+) e no
  cliente.
- **REQ-PF2-203** [MVP] Toda determinação canônica de resultado (degree of success,
  IWR aplicado, slot consumido, HP final) DEVE ocorrer no **servidor**; o cliente
  pode prever para UX mas não é autoritativo (`ver 04-rede-e-sincronizacao.md`,
  `ver 21-seguranca.md`).
- **REQ-PF2-204** [MVP] Os schemas Zod DEVEM tolerar **campos extras** vindos do
  importer (pass-through em `flags.fusion` ou `system` permissivo) para não
  rejeitar itens com REs não suportados; a validação rejeita apenas dados
  malformados nos campos conhecidos.
- **REQ-PF2-205** [MVP] O sistema DEVE versionar seu schema (`systemVersion`) e
  declarar migrações (`ver 02-modelo-de-dados.md` §migrações) para evoluir o
  formato de `system` sem quebrar mundos existentes.

---

## Modelo de dados

> Schemas **resumidos** (campos centrais). Tipos finais são derivados de Zod
> (`ver 02-modelo-de-dados.md`). `ProficiencyRank = 0|1|2|3|4` (Untrained..Legendary).
> Apenas o subtype, não os campos comuns (`_id`, `name`, `flags`, etc.).

### Tipos de Actor

A coluna **Facetas de nascença** é a lista declarada em `defineModel` (`ver 45-atores.md`,
REQ-ATR-010); é o que engine e cliente consultam, nunca o nome do subtype. Um ator pode
**ganhar** facetas em jogo (DEC-ATR-05) — a coluna diz com o que ele nasce, não o teto.

| Subtype     | MVP?   | Facetas de nascença | Descrição                                                                 |
| ----------- | ------ | ------------------- | ------------------------------------------------------------------------- |
| `character` | ✅ MVP | `player`            | Personagem jogador (PC) com ABC, feats, skills, spellcasting, inventário. |
| `npc`       | ✅ MVP | `creature`          | Criatura/NPC com statblock completo (AC, saves, HP, strikes, skills).     |
| `hazard`    | ✅ MVP | `hazard`            | Armadilha/perigo: subset do NPC, geralmente sem ações ativas.             |
| `loot`      | ✅ MVP | `container`         | Container de itens sem statblock. É o baú da `42` (DEC-ATR-09).           |
| `familiar`  | ✅ MVP | `creature`          | Familiar; habilidades derivadas do mestre (`ver 29-...md`).               |

Um `npc` que morre e passa a ser saqueável ganha `container` sem trocar de subtype nem de
ficha (DEC-ATR-05); um mercador PODE ser declarado com `["creature", "container"]`.

`party` e `vehicle` saíram desta tabela: não são actor types do Fusion e não estão no
plano (`ver 45-atores.md`, DEC-ATR-10).

### Tipos de Item

> Lista da pesquisa 10 §4.1. Coluna MVP indica o que o MVP precisa entender
> mecanicamente; itens [V2] podem existir como dados importados mas sem automação.

| Subtype              | MVP?       | Categoria   | Campos centrais                                                                                                                                     |
| -------------------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weapon`             | ✅         | Equipamento | `damage{dice,die,damageType,modifier,persistent?}`, `category`, `group`, `runes{potency,striking,property[]}`, `range`, `reload`, `traits`, `usage` |
| `armor`              | ✅         | Equipamento | `category`, `group`, `acBonus`, `dexCap`, `checkPenalty`, `speedPenalty`, `strength`, `runes{potency,resilient,property[]}`                         |
| `shield`             | ✅         | Equipamento | `acBonus`, `hardness`, `hp`, `brokenThreshold`                                                                                                      |
| `equipment`          | ✅         | Equipamento | `bulk`, `price`, `usage`, `traits`                                                                                                                  |
| `consumable`         | ✅         | Equipamento | `category` (scroll/wand/potion…), `charges`, `spell?`                                                                                               |
| `treasure`           | ✅         | Equipamento | `value` (gp/sp/cp)                                                                                                                                  |
| `container`          | ✅         | Equipamento | `capacity`, `bulkReduction`                                                                                                                         |
| `condition`          | ✅         | Estado      | `slug`, `value?`, `modifiers[]`, `overrides[]`                                                                                                      |
| `effect`             | ✅         | Estado      | `duration`, `badge?`, `modifiers[]`, `grantedConditions[]`, `iwr?`                                                                                  |
| `spell`              | ✅         | Magia       | `level`, `traits{value[],traditions[]}`, `area?`, `range`, `time`, `duration`, `defense?{save{statistic,basic}}`, `damage`, `rules?`                |
| `spellcastingEntry`  | ✅         | Magia       | `tradition`, `ability`, `proficiency{value}`, `slots{slot0..10{value,max,prepared[]}}`, `prepared{value}` (prepared/spontaneous/innate)             |
| `feat`               | ✅         | Mecânica    | `level`, `category`, `actionType`, `actions`, `frequency?`, `modifiers[]`, `grantedConditions[]`                                                    |
| `action` / `ability` | ✅         | Mecânica    | ação/atividade rolável (NPC abilities, basic actions)                                                                                               |
| `lore`               | ✅         | Perícia     | `rank`, atributo INT                                                                                                                                |
| `melee`              | ✅         | NPC-only    | ataque de NPC: `bonus`, `damage[]`, `traits`                                                                                                        |
| `ancestry`           | ⚙️ parcial | Construção  | `hp`, `speed`, `size`, `boosts`, `flaws`, `languages`, `vision`                                                                                     |
| `heritage`           | ⚙️ parcial | Construção  | herda de ancestry; `modifiers[]`                                                                                                                    |
| `background`         | ⚙️ parcial | Construção  | `boosts`, skill proficiency                                                                                                                         |
| `class`              | ⚙️ parcial | Construção  | `hp`/nível, proficiências iniciais, key ability, save progressions                                                                                  |
| `affliction`         | ⏳ V2      | Estado      | venenos/doenças com `stages[]`                                                                                                                      |
| `book`               | ⏳ V2      | Equipamento | habilidades contidas                                                                                                                                |
| `kit`                | ⏳ V2      | Equipamento | bundle de itens                                                                                                                                     |
| `deity`              | ⏳ V2      | Referência  | domains, edicts, anathemas, spell list                                                                                                              |
| `campaignFeature`    | ⏳ V2      | Campanha    | feature de AP (kingmaker etc.)                                                                                                                      |

> **⚙️ parcial (MVP)**: ancestry/heritage/background/class são importáveis e
> contribuem com HP, proficiências e modifiers **estáticos** declarados; a
> automação plena de seleção/ChoiceSet do character builder é [V2]. No MVP é
> possível montar a ficha manualmente ou importar um personagem pré-montado.

### Interfaces TypeScript (núcleo)

```typescript
// systems/engine-2e — tipos compartilhados PF2e/SF2e

type ProficiencyRank = 0 | 1 | 2 | 3 | 4; // Untrained..Legendary

type ModifierType =
  | "circumstance"
  | "item"
  | "status"
  | "untyped"
  | "ability"
  | "proficiency"
  | "potency";

interface Modifier {
  slug: string;
  label: string;
  type: ModifierType;
  value: number;
  selector: string; // "ac" | "reflex" | "attack" | "skill:athletics" | "damage" | "fortitude-dc" | ...
  enabled: boolean;
  predicate?: Predicate; // MVP: subconjunto simples; predicados ricos são [V2]
}

interface Statistic {
  slug: string;
  base: number; // d20-independent base (ability + proficiency)
  modifiers: Modifier[]; // pós-stacking aplicado em `total`
  total: number; // bônus total para o roll (sem o d20)
  dc?: number; // 10 + total, quando a estatística é também uma DC
  rollSelector: string; // domínio de roll para hooks (ver 08)
}

enum DegreeOfSuccess {
  CriticalFailure = 0,
  Failure = 1,
  Success = 2,
  CriticalSuccess = 3,
}

interface DamagePacket {
  amount: number;
  types: DamageType[]; // bludgeoning, piercing, fire, force, void, vitality, ...
  traits: string[]; // para IWR exceptions (ex.: "magical", "ghost-touch")
  isCritical: boolean; // dano já dobrado quando true
}

interface IWREntry {
  kind: "immunity" | "weakness" | "resistance";
  target: string; // damage type ou condition slug
  value?: number; // weakness/resistance
  exceptions?: string[];
  doubleVs?: string[];
}

interface ApplyDamageResult {
  finalDamage: number;
  newHp: number;
  newTempHp: number;
  breakdown: Array<{ step: string; amount: number; note: string }>;
}
```

```typescript
// systems/pf2e — schema resumido do character (system)

interface CharacterSystem {
  level: { value: number }; // 1..20 (20+ é [V2])
  abilities: Record<AbilitySlug, { value: number; mod: number }>; // str..cha
  attributes: {
    hp: { value: number; max: number; temp: number };
    ac: { value: number }; // derivado
    speed: { value: number; otherSpeeds: { type: string; value: number }[] };
    dying: { value: number; max: number };
    wounded: { value: number };
    doomed: { value: number };
    iwr: { immunities: IWREntry[]; weaknesses: IWREntry[]; resistances: IWREntry[] };
  };
  saves: Record<"fortitude" | "reflex" | "will", { rank: ProficiencyRank }>;
  perception: { rank: ProficiencyRank; senses: SenseData[] };
  skills: Record<SkillSlug, { rank: ProficiencyRank; lore?: boolean }>;
  proficiencies: {
    classDC: { rank: ProficiencyRank };
    weapons: Record<WeaponCategory, ProficiencyRank>;
    armor: Record<ArmorCategory, ProficiencyRank>;
  };
  resources: {
    heroPoints: { value: number; max: number };
    focusPoints: { value: number; max: number };
  };
  details: { keyAbility: AbilitySlug; ancestry?: string; class?: string };
}
```

```typescript
// systems/pf2e — schema resumido do NPC (system)

interface NpcSystem {
  level: { value: number }; // pode ser negativo (−1..)
  attributes: {
    hp: { value: number; max: number; temp: number; details?: string };
    ac: { value: number; details?: string };
    speed: { value: number; otherSpeeds: { type: string; value: number }[] };
    perception: { mod: number; senses: SenseData[]; details?: string };
    iwr: { immunities: IWREntry[]; weaknesses: IWREntry[]; resistances: IWREntry[] };
  };
  saves: Record<"fortitude" | "reflex" | "will", { mod: number; saveDetail?: string }>;
  skills: Record<string, { mod: number; lore?: boolean; special?: unknown[] }>;
  abilities: Record<AbilitySlug, { mod: number }>;
  traits: { value: string[]; rarity: "common" | "uncommon" | "rare" | "unique"; size: string };
  spellcasting?: { rituals?: { dc: number } };
  // strikes derivam de itens `melee`/weapon embedded
}
```

### Effects e modifiers declarativos (motor MVP)

```typescript
// systems/pf2e — campo `system.modifiers` (e grantedConditions) de feat/effect/condition

interface EffectSystem {
  duration?: { value: number; unit: "round" | "minute" | "hour" | "day"; sustained: boolean };
  badge?: { type: "counter" | "value"; value: number };
  modifiers: Modifier[]; // FlatModifier-like estático
  grantedConditions?: { slug: string; value?: number }[];
  iwr?: IWREntry[];
  // extraDamage para DamageDice estático
  extraDamage?: { dice: number; die: number; damageType: DamageType }[];
  // rules não suportados preservados para [V2]
}
```

---

## API e eventos

> Esta seção lista os pontos de integração com a system API (`ver 15-...`), o
> motor de rolagens (`ver 08-...`) e o combate (`ver 10-...`). Os nomes são do
> Fusion; a forma final da API é definida na spec 15.

### Registro (na inicialização do sistema)

| Ponto                                                              | Descrição                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `registerActorModel(subtype, zodSchema)`                           | Schemas de `character`/`npc`/`hazard`/`loot`.                                                          |
| `registerItemModel(subtype, zodSchema)`                            | Schemas dos Item subtypes do MVP.                                                                      |
| `registerSheet(documentType, subtype, SvelteComponent, { modes })` | Fichas character/NPC/hazard/loot.                                                                      |
| `registerInitiativeFormula(combatType, fn)`                        | `1d20 + perception.mod` + tiebreaker (REQ-PF2-090).                                                    |
| `registerPrepareData(documentType, prepareFn)`                     | `prepareDerived` por ator.                                                                             |
| `registerRollHook(domain, fn)`                                     | Hooks de MAP, condição (frightened/off-guard), bônus de circunstância (`ver 08-motor-de-rolagens.md`). |
| `registerDegreeOfSuccess(fn)`                                      | Cálculo de grau a partir de `RollResult` + DC (REQ-PF2-040).                                           |
| `registerActionMacros(list)`                                       | Strike, Seek, Recall Knowledge, Demoralize, Trip, etc. (REQ-PF2-100).                                  |
| `registerInlineEnrichers(handlers)`                                | `@Check`, `@Damage`, `@Template`, `@UUID` (REQ-PF2-102).                                               |

### Eventos de ciclo de vida consumidos (`ver 10-combate-e-iniciativa.md`)

| Evento                        | Ação do PF2e                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `onTurnStart(combatant)`      | Resetar MAP; processar `slowed`/`stunned` na contagem de ações; oferecer recovery check de Dying; aplicar persistent damage pendente. |
| `onTurnEnd(combatant)`        | Decrementar `frightened` (e outras que reduzem ao fim do turno); resolver persistent damage do tipo "fim de turno".                   |
| `onRoundStart` / `onRoundEnd` | Reservado para efeitos de duração em rodadas.                                                                                         |
| `onCombatEnd`                 | Limpar efeitos com duração "encounter".                                                                                               |

### Métodos do ator (expostos pela system API ao runtime/macros)

| Método                                                                                                  | Descrição                                                      |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `actor.rollСheck(selector, { dc, options })`                                                            | Rola um check (skill/save/attack/perception) e calcula degree. |
| `actor.rollStrike(strikeId, { mapStep })`                                                               | Rola attack do strike no passo de MAP indicado.                |
| `actor.rollDamage(strikeId, { critical })`                                                              | Rola o dano (dobrando no crit).                                |
| `actor.applyDamage(DamagePacket)`                                                                       | Pipeline IWR → `ApplyDamageResult` (REQ-PF2-060).              |
| `actor.increaseCondition(slug)` / `decreaseCondition` / `toggleCondition` / `setCondition(slug, value)` | Gestão de condições (REQ-PF2-050).                             |
| `actor.castSpell(entryId, spellId, { rank })`                                                           | Consome slot/focus e produz o card (REQ-PF2-081/084).          |
| `actor.spendHeroPoint({ reroll? \| heroicRecovery? })`                                                  | Hero Points (REQ-PF2-044).                                     |

---

## Dependências (specs irmãs)

| Spec                             | Relação                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `02-modelo-de-dados.md`          | Contrato de Documents, campos comuns, UUID, ownership, CRUD, migrações; esta spec preenche `system` por subtype.          |
| `08-motor-de-rolagens.md`        | Execução autoritativa de rolagens, `RollResult`, `RollHook`, definição-base de `DegreeOfSuccess`.                         |
| `10-combate-e-iniciativa.md`     | `Combat`/`Combatant`, `InitiativeFormula`, eventos de ciclo de vida que o PF2e consome.                                   |
| `11-ui-framework-e-fichas.md`    | Window manager, contrato de sheets, autosave, tabs, TipTap, i18n; esta spec fornece os componentes Svelte das fichas.     |
| `15-api-de-sistemas.md`          | Superfície de registro (models, sheets, hooks, prepareData, action macros, enrichers) que esta spec consome.              |
| `16-compendiums-e-importacao.md` | Pipeline que converte JSON do `foundryvtt/pf2e` no formato-alvo desta spec (incl. tradução de `rules[]` → `modifiers[]`). |
| `07-visao-iluminacao-fog.md`     | Condições de detecção (blinded/concealed/hidden/undetected) que afetam visão; automação parcial no MVP.                   |
| `18-sistema-sf2e.md`             | Consome o mesmo `systems/engine-2e` que esta spec define.                                                                 |
| `09-chat-e-mensagens.md`         | Renderização dos chat cards de check/strike/damage e dos inline enrichers.                                                |
| `21-seguranca.md`                | Determinação autoritativa no servidor (anti-cheat).                                                                       |
| `43-aba-compendio.md`            | Consome os packs deste sistema no painel de compêndio e obriga a plateia dos packs de criaturas e perigos (REQ-CPD-072).  |

---

## Critérios de aceitação

1. **Personagem jogável montado** — É possível importar (ou montar) um character
   nível 1–5 com ancestry/class/skills, e a ficha exibe AC, HP, saves, perception,
   16 skills e Class DC corretamente derivados pela fórmula TEML (REQ-PF2-010..017,
   020..021).
2. **Strike completo** — Um character com arma equipada rola um Strike: o sistema
   apresenta 3 variantes de MAP (0/−5/−10, ou agile 0/−4/−8), rola o attack,
   calcula o `DegreeOfSuccess` contra a AC do alvo, e ao acertar/critar rola o
   dano com a dobra de crítico aplicada (REQ-PF2-030..035, 040).
3. **Save básico** — Uma magia com basic Reflex save é lançada num alvo; o alvo
   rola Reflex, o grau é calculado e o dano por grau (0/metade/completo/dobro) é
   aplicado (REQ-PF2-041, 084).
4. **Condições mecânicas** — Aplicar `frightened 2` reduz em −2 todas as jogadas e
   DCs do ator; ao fim do turno decrementa para 1; `off-guard` reduz a AC em −2;
   `clumsy 1` afeta apenas estatísticas de DEX (REQ-PF2-051, 054, 092).
5. **Apply damage com IWR** — Um alvo com resistance 5 fire e weakness 10 cold
   recebe os números finais corretos na ordem Immunity→Weakness→Resistance, com
   breakdown visível, e fraqueza/resistência aplicadas após a dobra de crítico
   (REQ-PF2-060, 062).
6. **Dying/Recovery** — Um character levado a 0 HP ganha Dying 1 (Dying 2 por
   crit); no início do turno faz o recovery check (flat DC 10+dying); ao se
   recuperar ganha Wounded 1; com Doomed 1 a morte ocorre em Dying 3
   (REQ-PF2-070..074).
7. **Spellcasting básico** — Um wizard prepared consome um slot ao lançar; um
   cantrip é ilimitado e heightened para `ceil(level/2)`; focus spell consome
   Focus Point e é recuperado por Refocus (REQ-PF2-081..083).
8. **Iniciativa** — Iniciar um combate rola iniciativa por Perception para todos
   os combatants, com desempate por modificador de Perception; trocar para Stealth
   num combatant produz a fórmula correta (REQ-PF2-090, 091).
9. **Fichas** — A character sheet abre em abas funcionais e a NPC sheet enxuta
   permite ao GM rolar saves/strikes/skills do statblock diretamente (REQ-PF2-110,
   111, 113).
10. **Importação tolerante** — Importar feats/effects do pack `pf2e` com `rules[]`:
    os REs suportados viram `modifiers[]` funcionais; os não suportados não quebram
    a validação e ficam preservados em `flags.fusion.unsupportedRules`
    (REQ-PF2-204, DEC-PF2-04).
11. **Determinismo e localização no servidor** — `prepareDerived` produz o mesmo
    resultado no cliente e no servidor; toda determinação canônica (degree, IWR,
    slot) ocorre no servidor (REQ-PF2-200, 202, 203).
12. **Plateia dos packs** — O manifesto de todo pack publicado declara `audience`; o
    pack de bestiário declara `"gm"` e os packs de regras jogáveis declaram `"all"`,
    sem que nenhum documento tenha sido alterado para isso (REQ-PF2-140..145,
    REQ-CPD-072).

---

## Mapa de cobertura de automação

> **A** = automatizado no MVP · **A(V2)** = automação planejada para V2 · **P** =
> parcial (automação + input manual) · **M** = manual/assistido (sem automação,
> ferramenta de apoio). Baseado na pesquisa 13 §16.

| Mecânica                                        | MVP       | Notas                                            |
| ----------------------------------------------- | --------- | ------------------------------------------------ |
| Modificador de ability (`floor((score−10)/2)`)  | A         | REQ-PF2-010                                      |
| Proficiência TEML (rank\*2+nível)               | A         | REQ-PF2-011                                      |
| Skills/Perception/Saves/Class DC derivados      | A         | REQ-PF2-012..016                                 |
| AC (com dex cap, runa, broken)                  | A         | REQ-PF2-020                                      |
| HP máximo (char e NPC)                          | A         | REQ-PF2-021                                      |
| Degree of success (±10, nat20/nat1)             | A         | REQ-PF2-040                                      |
| MAP acumulado por turno                         | A         | REQ-PF2-031, 035                                 |
| Strike attack + damage (melee/ranged)           | A         | contexto de flanking/cobertura é M               |
| Crítico: dobra de dano; deadly; fatal           | A         | crit specialization é A(V2)                      |
| Basic saving throw (dano por grau)              | A         | REQ-PF2-041                                      |
| Condições numeradas (efeito mecânico)           | A         | conjunto priorizado, REQ-PF2-051                 |
| Decremento de `frightened` por turno            | A         | REQ-PF2-092                                      |
| `slowed`/`stunned` na contagem de ações         | A         | REQ-PF2-092                                      |
| Persistent damage (aplicação + flat check)      | A/P       | dano automático; flat check rolável              |
| IWR no apply damage                             | A         | REQ-PF2-060                                      |
| Dying/Recovery/Wounded/Doomed                   | A         | REQ-PF2-070..074                                 |
| Hero Points (reroll, heroic recovery)           | A         | REQ-PF2-044                                      |
| Spell slot tracking (prepared/spontaneous)      | A         | REQ-PF2-081                                      |
| Cantrip ilimitado + heighten automático         | A         | REQ-PF2-082                                      |
| Focus points + refocus                          | A         | REQ-PF2-083                                      |
| Heightening manual (rank superior)              | A(V2)     | parcial no MVP, REQ-PF2-085                      |
| Counteract/Counterspell                         | A(V2)     | REQ-PF2-086                                      |
| Bulk/encumbrance                                | A         | REQ-PF2-120                                      |
| Runas fundamentais (potency/striking/resilient) | A         | REQ-PF2-130                                      |
| Runas de propriedade (flaming etc.)             | A(V2)     | REQ-PF2-131                                      |
| Iniciativa por skill                            | A         | REQ-PF2-090                                      |
| Recall Knowledge (secret check + DC)            | P         | rola e apresenta; GM escolhe info, REQ-PF2-101   |
| Inline enrichers (@Check/@Damage/@Template)     | A         | REQ-PF2-102                                      |
| Condições de detecção (efeito de visão)         | P/M       | flat check A; posição/visão parcial, REQ-PF2-052 |
| Motor de rule-elements-like completo            | A(V2)     | GrantItem/ChoiceSet/Aura/BattleForm, DEC-PF2-04  |
| Character builder (ABC + ChoiceSet)             | M / A(V2) | montagem manual ou import no MVP                 |
| Exploration/Downtime/Crafting                   | M / A(V2) | REQ-PF2-103                                      |
| Range increments / cover                        | M         | A(V2); cobertura depende do mapa                 |
| Flanking (posição exata)                        | M         | requer grid/julgamento do GM                     |
| Party/Kingmaker                                 | A(V2)     | fora do MVP                                      |

### Fontes de dados

| Fonte                                         | Conteúdo                                                                                                                                        | Como entra                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Importer `tools/importer-pf2e` (`ver 16-...`) | Compendiums de regras mecânicas (feats, spells, equipment, conditions, ancestries, classes, bestiários) — JSON sob ORC/OGL do `foundryvtt/pf2e` | Conversão JSON pf2e → schemas desta spec; `system.rules` → `modifiers[]`; REs não suportados → `flags.fusion.unsupportedRules` |
| Definido por nós (`systems/pf2e`)             | Lista canônica de 16 skills + atributos, slugs de condições e efeitos mecânicos, traits de arma, traditions, fórmulas de derivação              | Código TypeScript do pacote                                                                                                    |
| Definido por nós (`systems/engine-2e`)        | Algoritmo de degree of success, modifier stacking, TEML, dying/wounded, apply damage/IWR                                                        | Código TypeScript do pacote                                                                                                    |
| Arte/imagens da Paizo                         | Tokens, ícones proprietários                                                                                                                    | **NÃO redistribuídos** (pesquisa 10 §2.2); usar placeholders/arte aberta (`ver 26-licencas-e-legal.md`)                        |

---

## Questões em aberto

1. **Granularidade do `selector` de modifiers** — A lista exata de seletores
   canônicos (especialmente para damage por tipo e sub-seletores como
   `melee-attack` vs `ranged-attack`) precisa ser fechada com a spec 08 ao definir
   os domínios de roll. Definir um registry compartilhado.
2. **Predicados no MVP** — Qual é o subconjunto mínimo de `Predicate` necessário
   para as condições e runas priorizadas? Provavelmente comparações simples
   (`hasTrait`, `gte level`); confirmar se algum item de MVP exige `or`/`not`.
3. **Mapeamento exato RE → modifier no importer** — Quais REs além de
   `FlatModifier`/`DamageDice`/`IWR`/`Note` são frequentes o suficiente nos packs
   de nível 1–5 para justificar tradução no MVP? Requer amostragem dos dados pelo
   importer (coordenar com `ver 16-...`).
4. **NPC strikes sem item de arma** — NPCs do bestiário usam itens `melee` com
   bônus/dano já calculados (não derivados de arma). Confirmar que o pipeline de
   strike trata ambos os caminhos (derivado de weapon vs. statblock `melee`).
5. **Nível máximo no MVP** — Confirmar o teto (1–5? 1–20?) que o MVP precisa
   suportar para a primeira sessão; afeta a quantidade de progressões a importar e
   validar.
6. **Variante de proficiência "sem nível"** (Proficiency Without Level) — É uma
   variant rule popular; manter como flag de mundo [V2] ou ignorar no MVP?
7. **Heightening parcial vs. confusão de UX** — No MVP, lançar uma magia em slot
   de rank superior consome o slot mas não recalcula o dano heightened
   automaticamente (REQ-PF2-085). Validar se isso é aceitável ou se um subconjunto
   de heightening (apenas dano `(+X)` linear) deve entrar no MVP.
8. **Sustained spells e durações em rodadas** — O rastreamento automático de
   durações de efeito (em rodadas/minutos) depende da integração com o combate;
   definir se o MVP expira efeitos automaticamente ou apenas avisa o GM.

---

## Referências

- `docs/research/10-pf2e-sistema-internals.md` — internals do `foundryvtt/pf2e`:
  actor/item types, Rule Elements (§5), synthetics (§6), checks e degrees of
  success (§7), condições e IWR (§8), spellcasting (§8.3), packs (§9), lógica pura
  vs. acoplamento ao Foundry (§10).
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — action economy e MAP (§1),
  degrees of success (§2), TEML (§3), DCs (§4), skills (§5), combate/dano/IWR (§6),
  condições completas (§7), morte/recuperação (§8), magia (§9), runas (§10), bulk
  (§11), modos de jogo (§12), Recall Knowledge (§13), Remaster (§14), mapa de
  automação VTT (§16).
- Archives of Nethys (regras sob ORC/OGL) — fonte primária das mecânicas citadas
  na pesquisa 13.
- `foundryvtt/pf2e` (Apache-2.0) — referência conceitual de implementação, citada
  na pesquisa 10; **não copiado**.
