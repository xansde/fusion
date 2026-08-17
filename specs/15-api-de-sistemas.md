# 15 — API de Sistemas

- **Título:** API de Sistemas (contrato engine ↔ game systems)
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/07-foundry-api-sistemas-modulos.md`
  - `docs/research/02-foundry-documentos-persistencia.md`
  - `docs/research/10-pf2e-sistema-internals.md`
  - `docs/research/12b-etmos-fontes-locais.md`

> **Aviso clean-room.** Esta spec descreve uma API própria do Fusion. Onde
> menciona o Foundry VTT ou o sistema `foundryvtt/pf2e`, refere-se apenas a
> comportamento e conceitos observáveis publicamente (Foundry) ou a conhecimento
> de domínio das regras (PF2e/SF2e/Etmos), usados como referência de design.
> Nenhum código proprietário do Foundry é reproduzido. O código TypeScript do
> `foundryvtt/pf2e` é Apache-2.0 e pode ser estudado; aqui reimplementamos
> conceitos sem copiar código palavra por palavra.

---

## Objetivo

Definir o **contrato entre a engine do Fusion e os game systems** — a superfície
de API através da qual um sistema de jogo (PF2e, SF2e, Etmos) declara seus dados,
seus comportamentos e seus componentes de UI, e recebe da engine os pontos de
extensão tipados de que precisa.

Esta é a spec **central** do projeto: tudo que torna o Fusion "configurável
conforme necessidade" passa por aqui. Aprendemos com as dores da API do Foundry
(research 07 §14): duas gerações de UI coexistindo, `template.json` legado,
monkey-patching como mecanismo de extensão, flags sem schema, ausência de
tipagem forte, `prepareData` hell sem ordem de dependência explícita. O objetivo
é uma API **TypeScript-first, declarativa, tipada e com ordem de derivação
explícita**, mais simples e mais segura que a do Foundry.

A API se materializa no pacote `packages/system-api`, consumido pelos pacotes
`systems/pf2e`, `systems/sf2e` e `systems/etmos`, que são **compilados junto**
com o app no monorepo (não há carregamento dinâmico de plugins de terceiros no
MVP — `ver 01-arquitetura-geral.md`).

## Escopo

### O que inclui

- O **manifest do sistema** (`SystemManifest`): identidade, versão, ranges de
  compatibilidade com a engine, subtypes declarados, packs, idiomas, grid,
  iniciativa, atributos de barra de token.
- O **registro de document subtypes** com schemas Zod (actor types, item types e
  demais documents com `system`), e a relação com o contrato de dados de
  `02-modelo-de-dados.md`.
- O motor de **dados derivados** (`prepareData`) com **ordem de dependência
  explícita** — a solução para o "prepareData hell" do Foundry.
- O registro de **sheets** (componentes Svelte), **fórmulas de iniciativa**,
  **condições/status effects**, **chat cards** e **ações declarativas**,
  **settings**, **compendium packs** e **i18n**.
- O **sistema de eventos/hooks tipados** da engine (document lifecycle, combate,
  rolagens, render): lista nomeada, assinatura, quando dispara, cancelabilidade.
- O **motor de modifiers/effects data-driven** — equivalente clean-room e
  generalizado dos Rule Elements do PF2e (research 10 §5): efeitos que alteram
  atributos e rolagens via seletores e predicados.
- **Versionamento e migrações** de dados do sistema, e **testes de contrato**.

### O que NÃO inclui

- O **catálogo e o contrato de dados dos Documents** (campos comuns, embedding,
  UUID, ownership, ciclo CRUD físico) — `ver 02-modelo-de-dados.md`. Esta spec
  define apenas _como o sistema registra_ schemas `system` e _consome_ o ciclo.
- O **conteúdo concreto** dos schemas de cada jogo — `ver 17-sistema-pf2e.md`,
  `18-sistema-sf2e.md`, `19-sistema-etmos.md`. Aqui só damos exemplos ilustrativos.
- O **motor de parsing/avaliação de fórmulas de dados** (sintaxe `NdX`, inline
  rolls, RNG autoritativo) — `ver 08-motor-de-rolagens.md`. Esta spec apenas
  declara como o sistema **registra hooks de roll** e **fórmulas nomeadas**.
- O **framework de UI e o ciclo de vida de janelas/aplicações** — `ver
11-ui-framework-e-fichas.md`. Aqui só definimos o **contrato de registro** de
  uma sheet e o **shape do contexto** passado ao componente.
- A **persistência física** de settings e migrações — `ver
03-persistencia-e-mundos.md`.
- O **pipeline de importação** de packs do `foundryvtt/pf2e` — `ver
16-compendiums-e-importacao.md`. Aqui só declaramos como o sistema **anuncia**
  seus packs.
- Carregamento dinâmico de **plugins/módulos de terceiros** — é [V2] explícito.

## Conceitos e terminologia

| Termo                           | Definição no Fusion                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System (game system)**        | Pacote TS/Svelte que implementa as regras de um RPG: schemas de `system`, dados derivados, sheets, condições, fórmulas e automações. Identificado por um `id` único (ex.: `"pf2e"`).                       |
| **Engine**                      | O app Fusion (server + client + shared + system-api), versionado com um único semver. Expõe a system API a sistemas.                                                                                       |
| **`SystemManifest`**            | Objeto declarativo (validado por Zod) que descreve um sistema: id, versão, compat, subtypes, packs, idiomas, etc. Análogo ao `system.json` do Foundry, porém TypeScript tipado e não um arquivo JSON cego. |
| **`SystemModule`**              | O artefato de runtime de um sistema: manifest + tabelas de registro (models, sheets, hooks, effects, settings...). O que `defineSystem()` produz.                                                          |
| **Subtype** (`type`)            | Discriminador do conteúdo de `system` de um Document (`Actor` subtype `"character"`). Cada par `(documentType, subtype)` mapeia para um `SystemDataModel`.                                                 |
| **`SystemDataModel`**           | Definição de schema `system` de um subtype: um schema Zod + (opcional) hooks de migração + (opcional) funções de derivação. Equivalente tipado ao `TypeDataModel` do Foundry (research 07 §2.2).           |
| **Dado derivado**               | Valor calculado em memória durante `prepareData`, sobre uma cópia do `_source`, nunca persistido (`ver 02-modelo-de-dados.md`).                                                                            |
| **`DeriveStep`**                | Unidade nomeada de derivação registrada por um sistema, com dependências declaradas; a engine as ordena topologicamente.                                                                                   |
| **Effect (effect data-driven)** | Regra declarativa, anexada a um Item/efeito, que altera atributos ou rolagens de um Actor via seletores e predicados. Generalização clean-room dos Rule Elements do PF2e.                                  |
| **`EffectRule`**                | Uma entrada de effect: `{ type, ...campos }` discriminada por `type` (ex.: `"flatModifier"`, `"setProperty"`).                                                                                             |
| **Selector (seletor)**          | String que identifica o domínio que um effect/modifier afeta: um caminho de atributo (`"system.attributes.ac"`) ou um domínio de roll (`"attack-roll"`, `"fortitude"`, `"skill:acrobatics"`).              |
| **Predicate (predicado)**       | Expressão lógica booleana avaliada contra um conjunto de **roll options** (flags string). Operadores `and`/`or`/`not` e comparações.                                                                       |
| **Roll option**                 | Flag string num `Set<string>` que descreve o estado de um actor/item/alvo/contexto, consumida por predicados.                                                                                              |
| **Synthetics**                  | Estrutura acumuladora, populada pelos effects durante `prepareData`, que carrega modificadores deferidos, notas, ajustes etc. por seletor.                                                                 |
| **Hook**                        | Ponto de extensão nomeado e tipado disparado pela engine em momentos do ciclo (lifecycle, combate, roll, render). Sistemas registram listeners.                                                            |
| **`SystemSheet`**               | Componente Svelte registrado para renderizar a ficha de um `(documentType, subtype)`, recebendo um contexto tipado.                                                                                        |
| **Contrato (contract test)**    | Teste automatizado que verifica que um `SystemModule` satisfaz a API (schemas válidos, derivação sem ciclos, sheets registradas, migrações monotônicas).                                                   |

---

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### DEC-SYS-01 — Sistema definido em TypeScript via `defineSystem()`, não um `system.json` cego

Um sistema é declarado por uma função `defineSystem(manifest, registrar)` que
retorna um `SystemModule`. O manifest é um **objeto TypeScript validado por Zod**,
não um arquivo JSON lido às cegas. Como os sistemas são compilados junto
(`ver 01-`), o registro acontece em código tipado.

- **Rejeitado: `system.json` + entry point `.mjs` com side-effects no hook
  `init`** (modelo Foundry, research 07 §3). O registro via mutação de
  `CONFIG.*` em hook é não-tipado, ordem-dependente e difícil de testar
  isoladamente. O Fusion não tem carregamento dinâmico no MVP, então não há
  motivo para um manifest-arquivo.
- **Rejeitado: decorators/classes mágicas.** Aumentam acoplamento ao framework e
  pioram a inspeção estática. Preferimos um objeto de registro explícito.
- **Racional:** um `SystemModule` é um valor puro e testável; a engine o consome
  num ponto único do boot. Tipagem forte de ponta a ponta (research 07 §14.2.5:
  Foundry é JS puro, comunidade depende de types não-oficiais). Mantemos a
  _forma_ declarativa do manifest do Foundry (campos de research 07 §1.2), mas
  como interface TS.

### DEC-SYS-02 — Schemas `system` em Zod, registrados por `(documentType, subtype)`

Cada subtype de Document declara seu `system` com um schema **Zod**, alinhado a
`02-modelo-de-dados.md` (DEC-DOC-01 daquela spec). O `SystemDataModel` agrupa o schema,
suas migrações e suas funções de derivação.

- **Rejeitado: portar `DataModel`/`DataField` do Foundry** (research 07 §2.2). É
  reimplementar um runtime de validação que já temos em Zod, melhor tipado. A
  spec 02 já fixou Zod como runtime de schema.
- **Rejeitado: `template.json` legado** (research 07 §2.1) — o Foundry o está
  depreciando (research 07 §13.2, v14). Nasce morto; não emular.
- **Racional:** Zod entrega validação, coerção, defaults e inferência num só
  artefato. O servidor é autoritativo e valida `system` em runtime
  (`ver 21-seguranca.md`). Um único mecanismo de schema para engine e sistema.

### DEC-SYS-03 — Derivação com ordem de dependência explícita (fim do "prepareData hell")

A principal dor do Foundry: `prepareBaseData`/`prepareDerivedData` rodam em ordem
fixa e implícita; quando um cálculo depende de outro, o autor recorre a truques
de ordenação e `priority` numérico mágico (research 10 §5.2 usa `priority`
inteiro). O Fusion substitui isto por **`DeriveStep`s nomeados com dependências
declaradas**, ordenados por **sort topológico** pela engine.

```ts
registrar.derive({
  id: "pf2e.hp.max",
  documentType: "Actor",
  subtypes: ["character"],
  reads: ["system.abilities.con.mod", "system.classhp", "system.level"],
  writes: ["system.attributes.hp.max"],
  phase: "derived",
  run(actor, ctx) {
    /* ... */
  },
});
```

- **Rejeitado: prioridade numérica** (modelo Foundry/PF2e). Frágil: dois autores
  escolhem o mesmo número; a dependência real fica implícita.
- **Rejeitado: ordem de declaração.** Acopla corretude à ordem do código.
- **Racional:** dependências explícitas (`reads`/`writes`) permitem ordenação
  determinística e **detecção de ciclos em build/contract test** (REQ-SYS-031).
  Substitui o `priority` por uma garantia verificável. Mantemos duas **fases**
  (`base` antes de effects, `derived` após) por serem semanticamente necessárias
  (research 02 §15.1).

### DEC-SYS-04 — Motor de effects data-driven unificado, discriminado por `type`

Um único motor de effects, com regras discriminadas por `type`, generaliza os
Rule Elements do PF2e (research 10 §5). O conjunto de tipos no MVP é **fechado e
implementado pela engine** (não há `type` definido por sistema no MVP); sistemas
**usam** os tipos via dados.

- **Rejeitado: `ActiveEffect` com modos numéricos** (Foundry, research 07 §10) —
  expressividade limitada (só add/multiply/override...), o modo `Custom` empurra
  lógica para o sistema. Os Rule Elements do PF2e existem justamente para superar
  isso.
- **Rejeitado: deixar cada sistema implementar seu próprio motor.** Triplicaria o
  esforço (PF2e, SF2e, Etmos) e impediria reuso. SF2e compartilha a base do PF2e
  (research 10 §11); o Etmos se beneficia de um motor pronto.
- **Rejeitado: permitir `EffectRule.type` plugável por sistema no MVP.** Abre a
  superfície a código arbitrário não verificado. Fica [V2] com `type` plugável.
- **Racional:** um motor único, com tipos canônicos (`flatModifier`,
  `damageDice` estático, `setProperty`, `note`, `iwr` no MVP; `rollOption`,
  `adjustDegreeOfSuccess`, `grantItem`, `damageDice` condicional em [V2]),
  cobre PF2e/SF2e e dá automação ao Etmos sem código. Os tipos MVP cobrem
  exatamente o subconjunto usado pelo PF2e na sessão inicial jogável (DEC-PF2-04);
  os [V2] são introduzidos junto com o motor completo de rule-elements-like.
  Modificadores são **factory functions deferidas** avaliadas no momento
  do roll (research 10 §5.1) — automação condicional sem reavaliar tudo.

### DEC-SYS-05 — Predicados sobre roll options (Set de strings), avaliados tarde

A ativação condicional de effects e a aplicação de modificadores em rolls usam
**predicados** avaliados contra um `Set<string>` de **roll options** (research 10
§7.4). Predicados são avaliados o mais tarde possível (no roll), não na
preparação.

- **Rejeitado: condições via JS arbitrário em strings (`eval`).** Inseguro
  (`ver 21-`) e não serializável para importação a partir do JSON do PF2e.
- **Racional:** predicados declarativos são serializáveis (vêm prontos no JSON do
  PF2e — research 10 §5.2), testáveis e seguros. Avaliar tarde permite considerar
  o alvo e o contexto do roll (`target:*`, domínios do check).

### DEC-SYS-06 — Sheets são componentes Svelte registrados, com contexto tipado

Uma sheet é um **componente Svelte 5 (Runes)** registrado para um
`(documentType, subtype)` com um `SystemSheetContext` tipado. Reatividade vem do
Svelte; não há `render()` manual.

- **Rejeitado: ApplicationV1/V2 + Handlebars** (Foundry, research 07 §4). Duas
  gerações coexistindo é dívida técnica que o Foundry carrega; re-render manual é
  fonte de bugs (research 07 §14.2.9). A stack do Fusion já fixou Svelte 5.
- **Rejeitado: sistema definir o ciclo de janela.** O lifecycle de aplicações é
  da engine (`ver 11-`); o sistema só fornece o **conteúdo** (componente) e
  declara qual `(documentType, subtype)` atende.
- **Racional:** Svelte Runes dá reatividade nativa sobre os dados derivados;
  uma única arquitetura de UI. O sistema registra `{ component, types,
makeDefault, label }` (forma de research 07 §4.1, modernizada).

### DEC-SYS-07 — Hooks tipados, síncronos para cancelar, com payload nomeado

A engine expõe um **barramento de hooks tipado**: cada hook tem um nome e um tipo
de payload. Hooks `pre*` (cancelar/mutar) rodam **no servidor**, são **síncronos**
e retornam `false` para cancelar; hooks pós são notificação e rodam em todos os
clientes. Alinhado a `02-modelo-de-dados.md` (tabela de hooks de ciclo de vida).

- **Rejeitado: monkey-patching / libWrapper** (research 07 §12.4). É workaround
  para limites de API. O Fusion oferece pontos de extensão formais, eliminando
  patching no MVP.
- **Rejeitado: hooks async que cancelam.** Foundry documenta que async não pode
  cancelar (research 02 §13.5). Mantemos `pre*` síncronos para cancelamento
  determinístico; trabalho async vai em hooks pós (que não cancelam).
- **Racional:** tipagem por nome de hook (`HookMap`) dá autocomplete e checagem
  de payload. Cancelamento síncrono no servidor preserva a autoridade
  (`ver 04-`, `ver 21-`).

### DEC-SYS-08 — Settings declaradas com schema Zod e escopo, sem menu mágico

Settings são declaradas com `{ key, scope, schema (Zod), default, ... }`. Escopos
`world` | `user` | `client` (research 07 §6.2). O valor é validado pelo schema.

- **Rejeitado: `type: Boolean | Number | String | DataField`** (Foundry,
  research 07 §6.1). Zod cobre todos os casos com validação real e tipo inferido.
- **Racional:** consistência com DEC-SYS-02; o tipo TS de cada setting é inferido do
  schema. Persistência em `ver 03-`; sincronização world-scope em `ver 04-`.

### DEC-SYS-09 — Versão da engine como contrato semver; migrações de system monotônicas

O manifest declara `engineCompat` (range semver da engine) e o sistema tem sua
própria `version`. Migrações de dados de `system` são **funções monotônicas
versionadas** registradas no `SystemDataModel`, executadas pelo motor de migração
da engine (`ver 02-`/`ver 03-`).

- **Rejeitado: versões numéricas estilo Foundry (`v13`, `v14`)** (research 07
  §13.1). Semver é o padrão do ecossistema TS e já é a escolha da engine
  (`ver 01-`).
- **Racional:** ranges semver dão checagem clara de compat na abertura do mundo.
  Migrações por (documentType, subtype, fromVersion→toVersion) são testáveis e
  encadeáveis (research 02 §7.3: `migrateData` encadeado por herança).

### DEC-SYS-10 — Condições/status como dados de sistema registrados, com automação opcional

Condições (PF2e: research 10 §8.1; Etmos: Fadiga, Inconsciente — research 12b
§12) são registradas como `ConditionDefinition` (slug, label, ícone, valued?,
effects inline). A engine fornece a infra (aplicar/remover, badge no token); o
sistema fornece os dados e, opcionalmente, effects.

- **Rejeitado: condições hardcoded na engine.** Cada sistema tem seu conjunto
  (PF2e ~40; Etmos punhado).
- **Racional:** registro declarativo reusa o motor de effects (DEC-SYS-04); condições
  numeradas (frightened N, Fadiga) viram `value` + effect parametrizado.
- **A exibição também é dado declarado, não julgamento da UI.** Além da mecânica, a
  `ConditionDefinition` carrega tom, ajuda e criticidade (REQ-SYS-043) — o mesmo
  princípio da DEC-CTT-11 (`39-contatos.md`): a aba não conhece condição nenhuma,
  pinta o que o sistema declarou. Os três campos são opcionais e degradam abertos,
  porque a engine não pode invalidar sistema já registrado nem esconder uma condição
  ativa por falta de metadado.

---

## Requisitos funcionais

Prefixo `REQ-SYS`. Cada requisito é testável. Tag `[MVP]`/`[V2]` alinhada à
definição de MVP global (sessão PF2e jogável).

### Manifest e definição do sistema

- **REQ-SYS-001** [MVP] A engine DEVE expor `defineSystem(manifest: SystemManifest,
build: (r: SystemRegistrar) => void): SystemModule`. O sistema chama-a uma vez
  e exporta o `SystemModule` resultante.
- **REQ-SYS-002** [MVP] O `SystemManifest` DEVE ser validado por um schema Zod no
  carregamento; manifest inválido DEVE abortar o boot do sistema com erro
  legível identificando o campo.
- **REQ-SYS-003** [MVP] O manifest DEVE conter, no mínimo: `id` (string, kebab/
  lowercase, único), `title`, `version` (semver), `engineCompat` (range semver),
  `authors[]`, `documentTypes` (subtypes declarados por documentType),
  `languages[]`.
- **REQ-SYS-004** [MVP] O manifest DEVE poder declarar `grid` (`{ distance:
number, units: string }`), `initiative` (id de uma `InitiativeFormula`
  registrada) e `primaryBarAttribute`/`secondaryBarAttribute` (caminhos de
  atributo para as barras do token). Campos opcionais, default ausente.
  (`ver 02-`, `ver 06-`, `ver 10-`.)
- **REQ-SYS-005** [MVP] O manifest DEVE declarar `packs[]`, cada um com `{ name,
label, documentType, system, path }` (o sistema apenas **anuncia** seus packs;
  carregamento e importação em `ver 16-compendiums-e-importacao.md`).
- **REQ-SYS-006** [MVP] A engine DEVE expor `game.system` em runtime com o
  `SystemModule` do mundo atual e DEVE garantir que **exatamente um** sistema
  esteja ativo por mundo (`ver 01-`, `ver 03-`).
- **REQ-SYS-007** [MVP] Na abertura de um mundo, a engine DEVE verificar que a
  versão da engine satisfaz `engineCompat` do sistema e que a `version` do sistema
  satisfaz o range gravado no `world` (`ver 03-`); incompatibilidade DEVE
  bloquear a abertura com mensagem clara e oferta de migração quando aplicável.
- **REQ-SYS-008** [V2] A engine DEVE suportar carregamento dinâmico de sistemas/
  módulos de terceiros (fora do monorepo), com sandbox e verificação de
  integridade. (Fora do MVP por DEC-SYS-01 e `ver 01-`/`ver 21-`.)

### Registro de document subtypes e schemas `system`

- **REQ-SYS-010** [MVP] O `SystemRegistrar` DEVE expor `defineModel(spec:
SystemDataModelSpec)` que registra um `SystemDataModel` para um
  `(documentType, subtype)`, contendo: `schema` (Zod), `migrations?`,
  `defaults?` e — **obrigatoriamente quando `documentType === "Actor"`, e proibido
  nos demais** — `facets`, uma lista **não-vazia** com valores em
  `{ player, creature, hazard, container }` (`ver 45-atores.md`, REQ-ATR-010; um ator
  exerce mais de um papel ao mesmo tempo, e a semântica de cada faceta é de lá, não
  desta spec).
- **REQ-SYS-011** [MVP] Todo subtype declarado em `manifest.documentTypes` DEVE
  ter um `SystemDataModel` correspondente registrado; subtype sem model OU model
  sem subtype declarado DEVE falhar no contract test (REQ-SYS-030).
- **REQ-SYS-012** [MVP] O `schema` Zod de um model DEVE validar **apenas** o
  conteúdo do campo `system`; os campos comuns do Document são da engine
  (`ver 02-`). A engine compõe o schema completo do Document a partir do schema
  de engine + o `system` do subtype selecionado por `type`.
- **REQ-SYS-013** [MVP] A engine DEVE derivar o tipo TypeScript de `system` de
  cada subtype via `z.infer` e expô-lo aos componentes de sheet e às funções de
  derivação, tipado.
- **REQ-SYS-014** [MVP] A engine DEVE rejeitar (no servidor, autoritativamente)
  qualquer create/update cujo `system` não valide contra o schema do subtype,
  emitindo `RollError`-equivalente de validação (`ver 04-`, `ver 21-`).
- **REQ-SYS-015** [MVP] Documents que suportam `system` (`Actor`, `Item`,
  `ActiveEffect`, `JournalPage`, `ChatMessage`, `Combatant` — conforme `ver 02-`)
  DEVEM aceitar registro de subtypes pela mesma API `defineModel`.

### Dados derivados (`prepareData` com ordem explícita)

- **REQ-SYS-020** [MVP] O `SystemRegistrar` DEVE expor `derive(step: DeriveStep)`,
  onde `DeriveStep` declara `id` único, `documentType`, `subtypes`,
  `phase: "base" | "derived"`, `reads: string[]`, `writes: string[]` e
  `run(doc, ctx)`.
- **REQ-SYS-021** [MVP] A engine DEVE executar `prepareData` de um Document na
  ordem: (1) reset para cópia de `_source`; (2) steps `phase: "base"`;
  (3) preparação de embedded; (4) **aplicação dos effects** (DEC-SYS-04) populando
  synthetics; (5) steps `phase: "derived"`. Nunca mutando `_source`
  (`ver 02-` §prepareData).
- **REQ-SYS-022** [MVP] Dentro de cada fase, a engine DEVE ordenar os `DeriveStep`
  por **sort topológico** das dependências derivadas de `reads`/`writes`
  (um step que lê `X` roda após o step que escreve `X`).
- **REQ-SYS-023** [MVP] A engine DEVE detectar **ciclos** de dependência entre
  `DeriveStep`s e DEVE falhá-los no contract test (REQ-SYS-031); em runtime, um
  ciclo não detectado em build DEVE produzir erro determinístico, não ordem
  silenciosamente incorreta.
- **REQ-SYS-024** [MVP] As funções `run` de derivação DEVEM ser **síncronas e
  puras** em relação a I/O (sem rede/disco): leem `doc` e `ctx`, escrevem em
  caminhos `writes` da cópia derivada.
- **REQ-SYS-025** [MVP] O `ctx` passado a `run` DEVE expor: `system` (o
  `SystemModule`), `synthetics` (modificadores/notas acumulados), `rollOptions`
  (Set atual do Document) e utilitários de stacking de modificadores
  (`ver Motor de modifiers`).

### Registros declarativos (sheets, iniciativa, condições, ações, chat, settings, i18n)

- **REQ-SYS-040** [MVP] `registrar.sheet(spec: SystemSheetSpec)` DEVE registrar um
  componente Svelte para um `(documentType, subtypes[])`, com `makeDefault?` e
  `label`. Mais de uma sheet por subtype é permitida; uma é default
  (`ver 11-`).
- **REQ-SYS-041** [MVP] A engine DEVE passar ao componente de sheet um
  `SystemSheetContext` tipado contendo o Document, seu `system` derivado, o nível
  de ownership do usuário e callbacks de update (`ver 11-`, `ver 05-`).
- **REQ-SYS-042** [MVP] `registrar.initiativeFormula(spec)` DEVE registrar uma
  `InitiativeFormula` nomeada `{ id, label, build(combatant, ctx): string }` que
  produz a fórmula de dados a ser avaliada pelo motor de rolagens (`ver 08-`,
  `ver 10-`). Ex.: PF2e `1d20 + @perception.mod`; Etmos `2d6 + @abilities.corpo`.
  A `InitiativeFormula` PODE fornecer desempate via `tiebreaker(combatant, ctx)`
  (valor numérico secundário) **ou** via `compare(a, b)` (comparador total entre duas
  `InitiativeEntry` já roladas, para desempates não-monotônicos como "jogadores vencem
  NPCs" do Etmos); quando ambos existem, `compare` tem precedência. O núcleo de combate
  ordena a fila usando esse desempate (`ver 10-` REQ-CBT-013).
- **REQ-SYS-043** [MVP] `registrar.condition(def: ConditionDefinition)` DEVE
  registrar uma condição `{ slug, label, img, valued?: boolean, effects?:
EffectRule[], overrides?: string[], tone?: "benefit" | "harm" | "special", help?:
string, critical?: boolean }`. A engine DEVE fornecer aplicação/remoção e exibição
  de badge no token (`ver 06-`, `ver 10-`). Os três últimos campos formam o
  **contrato de exibição** da condição, são todos opcionais e NÃO DEVEM ser
  condição de aceitação do registro — sistema já registrado continua válido sem
  declarar nenhum deles:
  - `tone` DEVE declarar o efeito da condição **sobre quem a carrega**, e não sua
    gravidade: `"benefit"` ajuda, `"harm"` atrapalha, `"special"` é situação
    (detecção, atitude, controle). A UI que consome o registro DEVE derivar a cor da
    etiqueta desse campo, e NÃO DEVE inferir tom a partir de `effects`.
  - `help` DEVE ser um texto curto de ajuda, já traduzido pelo sistema
    (REQ-SYS-048/049), destinado à ajuda sob demanda da UI.
  - `critical` DEVE marcar a condição que tira o personagem da cena. É **ênfase**
    sobre o `tone` declarado, nunca um quarto tom, e NÃO DEVE alterar a cor da
    etiqueta.

  A degradação DEVE falhar aberta, nos termos de `39-contatos.md` (REQ-CTT-035):
  condição sem `tone` DEVE ser tratada como `"special"`; condição sem `help` DEVE
  ser exibida sem ajuda; declaração incompleta NUNCA DEVE ocultar a condição nem
  abortar o carregamento do sistema.

  > **Emenda obrigada pela spec 39** (`39-contatos.md`, DEC-CTT-11 e §12,
  > 2026-08-16): `tone`, `help` e `critical` existem para dar contrato declarado às
  > etiquetas de condição consumidas por REQ-CTT-030..038 (`39-contatos.md`),
  > REQ-CBA-050 (`40-aba-combate.md`) e REQ-NPC-033 (`42-aba-npcs.md`), que não
  > conhecem condição nenhuma e só pintam o que o sistema declarou. _(Esta redação
  > acrescenta os três campos opcionais; nenhum campo anterior de
  > `ConditionDefinition` mudou de forma ou de obrigatoriedade.)_

- **REQ-SYS-044** [MVP] A engine DEVE expor à API do sistema operações de
  condição em um Actor: `increaseCondition(slug)`, `decreaseCondition(slug)`,
  `toggleCondition(slug)`, `setCondition(slug, value)` (semântica de research 10
  §8.1), respeitando `valued` e imunidades declaradas por effect `iwr`.
- **REQ-SYS-045** [MVP] `registrar.action(def: ActionDefinition)` DEVE registrar
  uma **ação declarativa** `{ slug, label, img?, run(ctx): Promise<void> | void,
rollOptions?: string[] }` invocável a partir de sheets, macros e chat (ex.:
  PF2e "Trip", "Demoralize"; Etmos "Conjurar"). A `run` PODE solicitar rolls via
  o motor (`ver 08-`) e postar chat cards.
- **REQ-SYS-046** [MVP] `registrar.chatCard(def: ChatCardDefinition)` DEVE
  registrar um template/renderer de chat card por `cardType`, recebendo um
  payload tipado e produzindo o conteúdo da `ChatMessage` (componente Svelte ou
  função → HTML sanitizado), com **ações declarativas** embutidas (`data-action`)
  resolvidas via REQ-SYS-045 (`ver 09-`).
- **REQ-SYS-047** [MVP] `registrar.setting(def: SettingDefinition)` DEVE registrar
  uma setting `{ key, scope: "world"|"user"|"client", schema: ZodType, default,
label, hint?, requiresReload?, requiresConfirmOnDisable?, countAffectedActors?,
  onChange? }`. A engine DEVE validar o valor pelo `schema` em get/set e expor
  `game.settings.get/set(systemId, key)` tipado (`ver 03-`).
  `requiresConfirmOnDisable` e `countAffectedActors(actors)` servem REQ-CFG-082/
  DEC-CFG-09 (spec 37): quando `requiresConfirmOnDisable` é `true` e a setting é
  desligada, a UI pede confirmação mostrando a contagem que `countAffectedActors`
  devolve. `countAffectedActors` é **server-only** — como `onChange`, nunca cruza
  o wire (`ver` `settings-handlers.ts`).
- **REQ-SYS-048** [MVP] `manifest.languages[]` DEVE listar `{ lang, name, path }`
  e a engine DEVE carregar e mesclar as strings; a ordem de precedência DEVE ser
  Engine → System (sistema sobrescreve engine apenas em chaves namespaced do
  sistema). i18n primário `pt-BR`, secundário `en` (stack fixada).
- **REQ-SYS-049** [MVP] A engine DEVE expor `i18n.localize(key)` e
  `i18n.format(key, data)` ao sistema, com namespacing por `id` do sistema, e
  DEVE avisar (em dev) sobre chaves ausentes no idioma ativo.
- **REQ-SYS-050** [V2] `registrar.keybinding(def)` DEVE registrar atalhos de
  teclado do sistema (research 07 §7). Fora do MVP.

### Eventos / hooks tipados

- **REQ-SYS-060** [MVP] A engine DEVE expor `hooks.on(name, listener)`,
  `hooks.once(name, listener)` e `hooks.off(name, ref)`, com `name` restrito ao
  union de nomes de hook (`HookName`) e `listener` tipado pelo payload do hook
  (`HookMap[name]`).
- **REQ-SYS-061** [MVP] A engine DEVE disparar os hooks de **ciclo de vida de
  Document** alinhados a `02-modelo-de-dados.md`: `preCreate<Type>`,
  `create<Type>`, `preUpdate<Type>`, `update<Type>`, `preDelete<Type>`,
  `delete<Type>` e os genéricos `*Document`. Hooks `pre*` são síncronos no
  servidor e retornam `false` para cancelar.
- **REQ-SYS-062** [MVP] A engine DEVE disparar hooks de **combate**:
  `combatStart`, `roundStart`, `roundEnd`, `turnStart`, `turnEnd`, `combatEnd` (`ver 10-`).
- **REQ-SYS-063** [MVP] A engine DEVE disparar hooks de **rolagem**: `preRoll` e
  `postRoll` com `RollContext`/`RollResult` (alinhados a
  `08-motor-de-rolagens.md`, que define o shape; aqui a API só os **expõe** ao
  sistema para registro).
- **REQ-SYS-064** [MVP] A engine DEVE disparar hooks de **render** de aplicações:
  `renderSheet` (pós-render, para anotações tardias do sistema), e o de chat
  `renderChatMessage` (`ver 09-`, `ver 11-`).
- **REQ-SYS-065** [MVP] A engine DEVE disparar `applyEffect` durante `prepareData`
  para cada `EffectRule` aplicada, permitindo ao sistema observar/anotar (não
  cancelável; local).
- **REQ-SYS-066** [MVP] A engine DEVE garantir que listeners de hook não-tratados
  que lancem erro **não** corrompam o ciclo: o erro é capturado, logado e
  isolado; o ciclo prossegue (exceto cancelamento explícito por `false` em
  `pre*`).
- **REQ-SYS-067** [MVP] A lista canônica de hooks (nome, payload, fase,
  cancelável, onde dispara) DEVE estar documentada e versionada com a engine; a
  remoção/renomeação de um hook é breaking change semver-major.

### Motor de modifiers/effects data-driven

- **REQ-SYS-080** [MVP] A engine DEVE implementar um motor de effects que processa
  arrays `EffectRule[]` provenientes do `system.rules` de Items/efeitos de um
  Actor durante `prepareData` (fase de aplicação de effects da REQ-SYS-021).
- **REQ-SYS-081** [MVP] Cada `EffectRule` DEVE ter os campos base: `type`
  (discriminador), `slug?`, `label?`, `predicate?` (predicado), `priority?`
  (desempate dentro do mesmo seletor), `ignored?`, `requiresEquipped?`,
  `requiresInvested?` (research 10 §5.2).
- **REQ-SYS-082** [MVP] O motor DEVE suportar, no MVP, os seguintes `type`
  canônicos (implementados pela engine):
  - `flatModifier` — bônus/penalidade numérica tipada a um `selector`
    (research 10 §5.3 FlatModifier).
  - `setProperty` — escreve/ajusta um caminho do Actor com `mode`
    (`add`/`multiply`/`override`/`upgrade`/`downgrade`), equivalente generalizado
    do AELike (research 10 §5.3) e dos modos de ActiveEffect (research 07 §10.2).
  - `damageDice` (estático) — adiciona dados de dano fixos por seletor, sem
    predicação condicional no apply (research 10 §5.3). `damageDice` condicional
    (valor dependente de roll options em runtime) é [V2].
  - `note` — anexa texto explicativo ao resultado de um roll (RollNote).
  - `iwr` — imunidade/fraqueza/resistência a tipo de dano ou condição
    (research 10 §8.2), com `exceptions?`/`doubleVs?`.

  Os tipos abaixo são canônicos na engine mas não têm consumidor no sistema PF2e
  durante o MVP; DEVEM ser implementados em [V2], junto com o motor completo de
  rule-elements-like (spec 17, DEC-PF2-04):
  - **[V2]** `rollOption` — injeta uma flag string nos roll options de um domínio
    (research 10 §5.3 RollOption); predicados complexos associados são [V2]
    (ver REQ-SYS-086).
  - **[V2]** `adjustDegreeOfSuccess` — ajusta o grau de sucesso condicionalmente
    (research 10 §5.3, §7.3); equivalente a Evasion/Juggernaut no PF2e.
  - **[V2]** `grantItem` — concede outro Item via UUID (research 10 §5.3
    GrantItem); materialização de itens concedidos coordenada com spec 02 (Q4).

- **REQ-SYS-083** [MVP] `flatModifier` e demais modificadores DEVEM ser
  armazenados como **factory functions deferidas** nos `synthetics`, avaliadas no
  momento do roll (não na preparação) — viabilizando predicados que dependem do
  alvo/contexto (research 10 §5.1).
- **REQ-SYS-084** [MVP] O motor DEVE expor `selector`s como o domínio afetado:
  caminhos de atributo (`"system.attributes.ac"`) e domínios de roll
  (`"attack-roll"`, `"damage"`, `"fortitude"`, `"will"`, `"skill:<slug>"`,
  `"<saveType>-dc"`, tipos de dano) — research 10 §5.4. O conjunto exato de
  domínios de roll é definido pelo sistema, não fixado pela engine.
- **REQ-SYS-085** [MVP] O motor DEVE empilhar modificadores conforme **regras de
  stacking declaradas pelo sistema**: a engine fornece um agregador
  (`StatisticModifier`-equivalente) que recebe a tabela de tipos e regras
  (ex.: PF2e: circumstance/item/status só maior bônus + menor penalidade; untyped
  empilha — research 10 §7.2). A engine **não** hardcoda as regras do PF2e.
- **REQ-SYS-086** [MVP] O motor DEVE avaliar **predicados simples** contra o
  `Set<string>` de roll options vigente: string literal (presença de flag),
  operadores `and`, `or`, `not` e comparações numéricas (`gte`/`lte`/`gt`/`lt`/
  `eq`) — research 10 §5.2/§7.4. A avaliação é pura e serializável. Este
  subconjunto é necessário para os tipos `flatModifier` e `iwr` do MVP (ex.:
  `predicate: ["target:condition:off-guard"]`). A injeção de roll options por
  predicado (`rollOption` type, REQ-SYS-082 [V2]) é [V2].
- **REQ-SYS-087** [MVP] O motor DEVE suportar **expressões de valor** em campos
  numéricos de `EffectRule` resolvidas via roll data (`@actor.level`,
  `floor(@actor.level / 2)`, `ternary(...)`) usando o avaliador do motor de
  rolagens (`ver 08-`) — research 10 §5.5.
- **REQ-SYS-088** [MVP] O motor DEVE produzir uma estrutura `synthetics`
  acumuladora por seletor (modificadores, damageDice, notas,
  degreeOfSuccessAdjustments, rollOptions, iwr) consumível pelos `DeriveStep`s da
  fase `derived` e pelo motor de rolagens (research 10 §6).
- **REQ-SYS-089** [V2] O motor DEVE permitir `EffectRule.type` adicionais
  registrados pelo sistema (effects plugáveis), com sandbox. Fora do MVP (DEC-SYS-04).
- **REQ-SYS-090** [MVP] Effects com `predicate` que não satisfaça os roll options
  no momento da aplicação DEVEM ser ignorados sem erro (no-op), e a desativação
  via `ignored` DEVE removê-los do processamento.

### Versionamento e migrações

- **REQ-SYS-100** [MVP] Um `SystemDataModel` PODE declarar `migrations:
MigrationDefinition[]`, cada uma `{ from: semver, to: semver, migrate(source):
source }`, aplicadas em cadeia da versão de origem dos dados até a `version`
  atual do sistema (research 02 §7.3).
- **REQ-SYS-101** [MVP] As migrações DEVEM rodar **antes** da validação Zod do
  `system` (na leitura e na importação), por `(documentType, subtype)`, e DEVEM
  ser **idempotentes** quando reaplicadas a dados já migrados.
- **REQ-SYS-102** [MVP] A engine DEVE registrar a versão do sistema sob a qual
  cada Document foi escrito (em `_stats`/metadados — `ver 02-`/`ver 03-`) e
  acioná-las quando essa versão for menor que a `version` ativa.
- **REQ-SYS-103** [MVP] O motor de migração DEVE produzir um relatório
  (documentos migrados, falhas isoladas) e DEVE fazer backup do mundo antes do
  write-back de migração (`ver 24-operacao-backups-telemetria.md`).
- **REQ-SYS-104** [MVP] Migrações cujo `to` exceda a `version` do sistema OU não
  formem cadeia contígua a partir dos dados DEVEM falhar no contract test
  (monotonicidade — REQ-SYS-032).

### Testes de contrato

- **REQ-SYS-110** [MVP] A engine DEVE fornecer um **harness de contract test**
  (`validateSystemModule(module): ContractReport`) executável em CI que verifica
  todos os invariantes da API (REQ-SYS-030..034).
- **REQ-SYS-111** [MVP] Cada sistema do monorepo (PF2e, SF2e, Etmos) DEVE passar
  no harness como gate de build; falha de contrato DEVE quebrar o CI
  (`ver 25-testes-e-qualidade.md`).

## Requisitos não-funcionais

- **REQ-SYS-130** [MVP] **Tipagem forte ponta a ponta:** nenhum ponto da API
  exige `any`; tipos de `system`, contexto de derivação, payloads de hook e
  contexto de sheet são inferidos/derivados. (Resolve research 07 §14.2.5.)
- **REQ-SYS-131** [MVP] **Determinismo:** dado o mesmo `_source` e o mesmo conjunto
  de effects/options, `prepareData` produz o mesmo resultado derivado (sem
  dependência de ordem de declaração nem de relógio/RNG na derivação).
- **REQ-SYS-132** [MVP] **Isolamento de falhas:** erro em um `DeriveStep`,
  `EffectRule` ou listener de hook DEVE ser capturado, logado com `id`/`slug` e
  isolado, sem abortar a preparação inteira do Document (degradação graciosa).
- **REQ-SYS-133** [MVP] **Performance de preparação:** `prepareData` de um Actor
  típico (PF2e nível médio, dezenas de items com effects) DEVE completar em
  orçamento compatível com UI responsiva no host do GM; modificadores deferidos
  evitam recomputar tudo a cada roll (research 10 §5.1).
- **REQ-SYS-134** [MVP] **Segurança:** predicados, expressões de valor e migrações
  são **declarativos/serializáveis**; nenhum `eval` de string arbitrária no MVP
  (`ver 21-`). Conteúdo HTML de chat cards e campos é sanitizado (`ver 21-`).
- **REQ-SYS-135** [MVP] **Estabilidade de API:** a superfície pública da system
  API segue semver; breaking changes só em major, com período de depreciação e
  aviso (`@deprecated`) — espelhando a política do Foundry (research 07 §12.7),
  porém com tipos.
- **REQ-SYS-136** [MVP] **Independência de jogo:** a engine NÃO hardcoda regras de
  PF2e/SF2e/Etmos; toda regra específica vem por dados/registro do sistema (o
  motor de effects e o agregador de stacking são genéricos — DEC-SYS-04/REQ-SYS-085).
- **REQ-SYS-137** [MVP] **Testabilidade:** um `SystemModule` é um valor puro
  construível e inspecionável em teste de unidade sem subir servidor nem canvas.

## Modelo de dados

Interfaces TypeScript ilustrativas (não-normativas em detalhes de campo; o
contrato normativo são os REQ). Tipos de Document e campos comuns em `ver 02-`.

```ts
// ─── Manifest ────────────────────────────────────────────────────────────────
interface SystemManifest {
  id: string; // "pf2e" | "sf2e" | "etmos"
  title: string;
  version: string; // semver do sistema
  engineCompat: string; // range semver da engine (ex.: ">=0.1 <0.2")
  authors: Array<{ name: string; url?: string }>;
  documentTypes: Partial<Record<DocumentType, string[]>>; // subtypes por doc
  languages: Array<{ lang: string; name: string; path: string }>;
  packs?: Array<{
    name: string;
    label: string;
    documentType: DocumentType;
    system: string;
    path: string;
  }>;
  grid?: { distance: number; units: string };
  initiative?: string; // id de InitiativeFormula registrada
  primaryBarAttribute?: string; // caminho (ex.: "attributes.hp")
  secondaryBarAttribute?: string;
}

// ─── Registrar (passado ao build do defineSystem) ────────────────────────────
interface SystemRegistrar {
  defineModel(spec: SystemDataModelSpec): void;
  derive(step: DeriveStep): void;
  sheet(spec: SystemSheetSpec): void;
  initiativeFormula(spec: InitiativeFormula): void;
  condition(def: ConditionDefinition): void;
  action(def: ActionDefinition): void;
  chatCard(def: ChatCardDefinition): void;
  setting(def: SettingDefinition): void;
  // [V2] keybinding(def): void;
}

// ─── Schemas system ──────────────────────────────────────────────────────────
interface SystemDataModelSpec<S extends ZodType = ZodType> {
  documentType: DocumentType; // "Actor" | "Item" | ...
  subtype: string; // "character" | "npc" | "weapon" | ...
  schema: S; // valida APENAS o campo `system`
  defaults?: Partial<z.infer<S>>;
  migrations?: MigrationDefinition[];
  // obrigatório e não-vazio se documentType === "Actor", proibido nos demais (REQ-ATR-010)
  facets?: readonly ("player" | "creature" | "hazard" | "container")[];
}

interface MigrationDefinition {
  from: string;
  to: string; // semver; cadeia contígua e monotônica
  migrate(source: Record<string, unknown>): Record<string, unknown>;
}

// ─── Derivação ───────────────────────────────────────────────────────────────
interface DeriveStep<D = AnyDocument> {
  id: string; // único; usado em logs e no grafo
  documentType: DocumentType;
  subtypes: string[]; // a quais subtypes se aplica
  phase: "base" | "derived";
  reads: string[]; // caminhos lidos  → arestas do grafo
  writes: string[]; // caminhos escritos
  run(doc: D, ctx: DeriveContext): void; // síncrono, puro de I/O
}

interface DeriveContext {
  system: SystemModule;
  synthetics: Synthetics; // populado pela fase de effects
  rollOptions: Set<string>;
  modifiers: ModifierAggregator; // stacking conforme regras do sistema
}

// ─── Effects data-driven (Rule-Element clean-room generalizado) ──────────────
// MVP: FlatModifierRule | SetPropertyRule | DamageDiceRule (estático) | NoteRule | IwrRule
// [V2]: RollOptionRule | AdjustDegreeOfSuccessRule | GrantItemRule | DamageDiceRule (condicional)
type EffectRule =
  | FlatModifierRule
  | SetPropertyRule
  | DamageDiceRule
  | RollOptionRule
  | NoteRule
  | AdjustDegreeOfSuccessRule
  | IwrRule
  | GrantItemRule;

interface EffectRuleBase {
  type: string;
  slug?: string;
  label?: string;
  predicate?: Predicate;
  priority?: number; // desempate dentro do mesmo seletor
  ignored?: boolean;
  requiresEquipped?: boolean;
  requiresInvested?: boolean;
}
interface FlatModifierRule extends EffectRuleBase {
  type: "flatModifier";
  selector: string | string[];
  value: number | string; // string = expressão de valor (@actor.level)
  modifierType?: string; // tipo de stacking (circumstance/item/...)
}
interface SetPropertyRule extends EffectRuleBase {
  type: "setProperty";
  path: string;
  mode: "add" | "multiply" | "override" | "upgrade" | "downgrade";
  value: number | string | boolean;
}
interface RollOptionRule extends EffectRuleBase {
  type: "rollOption";
  domain: string;
  option: string;
  toggleable?: boolean;
}
interface IwrRule extends EffectRuleBase {
  type: "iwr";
  category: "immunity" | "weakness" | "resistance";
  target: string; // damage type ou condition slug
  value?: number;
  exceptions?: string[];
  doubleVs?: string[];
}
// DamageDiceRule e NoteRule: análogos a FlatModifierRule (MVP).
// AdjustDegreeOfSuccessRule e GrantItemRule: análogos, implementados em [V2].

type Predicate = Array<string | PredicateCompound | PredicateComparison>;
type PredicateCompound = { and: Predicate } | { or: Predicate } | { not: Predicate };
type PredicateComparison =
  | { gte: [string, number] }
  | { lte: [string, number] }
  | { gt: [string, number] }
  | { lt: [string, number] }
  | { eq: [string, number | string] };

// ─── Synthetics (acumulador da fase de effects) ──────────────────────────────
interface Synthetics {
  modifiers: Record<string, DeferredModifier[]>; // por selector
  damageDice: Record<string, DamageDiceSynthetic[]>;
  rollNotes: Record<string, RollNote[]>;
  degreeOfSuccessAdjustments: Record<string, DegreeAdjustment[]>;
  rollOptions: Record<string, Set<string>>; // por domínio
  iwr: { immunities: Iwr[]; weaknesses: Iwr[]; resistances: Iwr[] };
}
type DeferredModifier = (options: Set<string>) => ResolvedModifier | null;

// ─── Sheets, condições, ações, chat, settings ────────────────────────────────
interface SystemSheetSpec {
  documentType: DocumentType;
  subtypes: string[];
  component: SvelteComponent; // Svelte 5 (Runes)
  makeDefault?: boolean;
  label: string;
}
interface SystemSheetContext<S = unknown> {
  document: AnyDocument;
  system: S; // `system` derivado (pós-prepareData)
  ownership: OwnershipLevel; // ver 05-
  update(changes: Record<string, unknown>): Promise<void>;
}
interface ConditionDefinition {
  slug: string;
  label: string;
  img: string;
  valued?: boolean;
  effects?: EffectRule[];
  overrides?: string[];
  // Contrato de exibição (REQ-SYS-043) — opcionais; ausência degrada, não invalida
  tone?: "benefit" | "harm" | "special"; // efeito sobre quem carrega; ausente ⇒ "special"
  help?: string; // ajuda curta, já traduzida pelo sistema; ausente ⇒ sem ajuda
  critical?: boolean; // tira o personagem da cena; ênfase, não um quarto tom
}
interface ActionDefinition {
  slug: string;
  label: string;
  img?: string;
  rollOptions?: string[];
  run(ctx: ActionContext): Promise<void> | void;
}
interface ChatCardDefinition {
  cardType: string;
  render(payload: unknown): SvelteComponent | string; // HTML sanitizado
}
interface SettingDefinition<S extends ZodType = ZodType> {
  key: string;
  scope: "world" | "user" | "client";
  schema: S;
  default: z.infer<S>;
  label: string;
  hint?: string;
  requiresReload?: boolean;
  onChange?(value: z.infer<S>): void;
}

interface InitiativeFormula {
  id: string;
  label: string;
  build(combatant: Combatant, ctx: DeriveContext): string; // fórmula de dados
  // Desempate fornecido pelo sistema. Opcional:
  //  - `tiebreaker`: valor numérico secundário (ex.: PF2e → mod. de Perception).
  //  - `compare`: comparador total entre dois combatants já rolados, usado quando o
  //    desempate não é monotônico em um único número (ex.: Etmos "jogadores vencem NPCs").
  //    Retorna >0 se `a` vem antes de `b`, <0 se depois, 0 se equivalente.
  //  Se ambos forem fornecidos, `compare` tem precedência. Se nenhum, ordena só por initiative.
  tiebreaker?(combatant: Combatant, ctx: DeriveContext): number;
  compare?(a: InitiativeEntry, b: InitiativeEntry): number;
}

interface InitiativeEntry {
  combatant: Combatant;
  initiative: number; // total rolado da fórmula
  tiebreaker?: number; // valor de `tiebreaker()` se fornecido
}
```

## API e eventos

### Superfície pública (resumo)

| Símbolo                                                 | Tipo   | Descrição                            |
| ------------------------------------------------------- | ------ | ------------------------------------ |
| `defineSystem(manifest, build)`                         | função | Constrói e retorna o `SystemModule`. |
| `game.system`                                           | objeto | `SystemModule` ativo do mundo.       |
| `game.settings.get/set(sysId, key)`                     | função | Get/set tipado de setting.           |
| `hooks.on/once/off(name, listener)`                     | função | Barramento de hooks tipado.          |
| `i18n.localize/format(key, data?)`                      | função | Localização namespaced.              |
| `actor.increase/decrease/toggle/setCondition(slug, v?)` | método | Condições.                           |
| `validateSystemModule(module)`                          | função | Harness de contract test.            |

### Lista canônica de hooks (MVP)

Nomes alinhados a `02-modelo-de-dados.md`. `<Type>` ∈ tipos de Document.

| Hook                | Fase       | Cancelável    | Onde dispara          | Payload                         |
| ------------------- | ---------- | ------------- | --------------------- | ------------------------------- |
| `preCreate<Type>`   | pré        | sim (`false`) | servidor (autor)      | `(doc, data, op, userId)`       |
| `create<Type>`      | pós        | não           | todos os clientes     | `(doc, op, userId)`             |
| `preUpdate<Type>`   | pré        | sim           | servidor (autor)      | `(doc, changes, op, userId)`    |
| `update<Type>`      | pós        | não           | todos os clientes     | `(doc, changes, op, userId)`    |
| `preDelete<Type>`   | pré        | sim           | servidor (autor)      | `(doc, op, userId)`             |
| `delete<Type>`      | pós        | não           | todos os clientes     | `(doc, op, userId)`             |
| `combatStart`       | pós        | não           | todos                 | `(combat)`                      |
| `roundStart`        | pós        | não           | todos                 | `(combat, round)`               |
| `roundEnd`          | pós        | não           | todos                 | `(combat, round)`               |
| `turnStart`         | pós        | não           | todos                 | `(combat, combatant, previous)` |
| `turnEnd`           | pós        | não           | todos                 | `(combat, combatant)`           |
| `combatEnd`         | pós        | não           | todos                 | `(combat)`                      |
| `preRoll`           | pré        | sim           | servidor              | `(context: RollContext)`        |
| `postRoll`          | pós        | não           | autor + destinatários | `(result, context)`             |
| `applyEffect`       | derivação  | não           | local (prepareData)   | `(actor, rule, change)`         |
| `renderSheet`       | pós-render | não           | local (cliente)       | `(app, element, ctx)`           |
| `renderChatMessage` | pós-render | não           | local (cliente)       | `(message, element)`            |

Hooks `pre*` de ciclo de vida são síncronos no servidor (autoridade/anti-cheat —
`ver 04-`, `ver 21-`); `preRoll`/`postRoll` definidos por `08-motor-de-rolagens.md`.

## Dependências (specs irmãs)

- `01-arquitetura-geral.md` — `packages/system-api`, sistemas compilados junto,
  boot, um sistema ativo por mundo, semver da engine.
- `02-modelo-de-dados.md` — contrato de Documents, campos comuns, `system`,
  subtype, `prepareData`, hooks de ciclo de vida, UUID, ownership, migração.
- `03-persistencia-e-mundos.md` — persistência de settings, registro da versão de
  system por Document, execução física de migrações.
- `04-rede-e-sincronizacao.md` — broadcast de hooks pós, validação autoritativa,
  reconciliação; protocolo de `roll:request`.
- `05-usuarios-e-permissoes.md` — `OwnershipLevel`, gating de sheets e ações.
- `06-canvas-e-renderizacao.md` — barras de token (`primaryBarAttribute`),
  badges de condição, grid.
- `08-motor-de-rolagens.md` — `RollContext`/`RollResult`, `RollHook` (`preRoll`/
  `postRoll`), fórmulas nomeadas, avaliador de expressões de valor.
- `09-chat-e-mensagens.md` — `ChatMessage`, chat cards, ações inline.
- `10-combate-e-iniciativa.md` — `Combat`/`Combatant`, fórmula de iniciativa,
  hooks de combate.
- `11-ui-framework-e-fichas.md` — lifecycle de aplicações/janelas, registro e
  contexto de sheets Svelte.
- `16-compendiums-e-importacao.md` — packs anunciados pelo manifest, importação
  do JSON `foundryvtt/pf2e`, remapeamento de UUID.
- `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md` — conteúdo
  concreto que consome esta API (schemas, effects, sheets, condições).
- `21-seguranca.md` — sanitização, ausência de `eval`, descarte de campos do
  cliente, validação autoritativa.
- `39-contatos.md`, `40-aba-combate.md`, `42-aba-npcs.md` — consumidores do
  contrato de exibição de condição (REQ-SYS-043): `tone`, `help` e `critical`
  nasceram da DEC-CTT-11 e são lidos por REQ-CTT-030..038, REQ-CBA-050 e
  REQ-NPC-033.
- `24-operacao-backups-telemetria.md` — backup pré-migração, relatório de
  migração, telemetria.
- `25-testes-e-qualidade.md` — gate de contract test no CI.

## Critérios de aceitação

- **CA-01** `defineSystem` com manifest válido retorna um `SystemModule`
  inspecionável; manifest inválido (ex.: `version` não-semver) aborta com erro
  apontando o campo. (REQ-SYS-001/002/003)
- **CA-02** Um subtype declarado sem `SystemDataModel` (ou vice-versa) falha no
  `validateSystemModule`. (REQ-SYS-011, REQ-SYS-030)
- **CA-03** Um create de `Actor` com `system` que viola o schema Zod do subtype é
  rejeitado pelo servidor, independente do que o cliente envie. (REQ-SYS-014)
- **CA-04** Dois `DeriveStep`s onde A escreve `system.x` e B lê `system.x` rodam
  **sempre** A→B, qualquer que seja a ordem de declaração; um ciclo A↔B falha no
  contract test. (REQ-SYS-022/023)
- **CA-05** Um `flatModifier` com `predicate: ["target:flat-footed"]` só aplica
  quando o roll option `target:flat-footed` está presente no momento do roll, não
  na preparação. (REQ-SYS-083/086/090)
- **CA-06** O agregador de stacking, configurado com a tabela do PF2e, soma dois
  bônus `circumstance` tomando só o maior; configurado de outra forma (ou no
  Etmos), empilha conforme a tabela fornecida — a engine não embute a regra do
  PF2e. (REQ-SYS-085, REQ-SYS-136)
- **CA-07** Uma `InitiativeFormula` registrada (`2d6 + @abilities.corpo` para
  Etmos) é resolvida e passada ao motor de rolagens ao iniciar combate.
  (REQ-SYS-042, `ver 08-`/`ver 10-`)
- **CA-08** Uma condição valued (`frightened`, value 2) aplica uma penalidade de
  status -2 via effect parametrizado; `decreaseCondition` a reduz; imunidade
  declarada por `iwr` impede a aplicação. (REQ-SYS-043/044)
- **CA-09** Uma setting `world` declarada com schema Zod rejeita valor inválido em
  `set` e devolve o tipo inferido em `get`; `onChange` dispara em todos os
  clientes para escopo `world`. (REQ-SYS-047)
- **CA-10** Um Document escrito sob `version` antiga do sistema é migrado em cadeia
  até a `version` ativa antes de validar; reaplicar a migração é no-op
  (idempotência); um backup é gerado antes do write-back. (REQ-SYS-100/101/103)
- **CA-11** Um listener de hook que lança erro é isolado: o ciclo CRUD/preparação
  prossegue e o erro é logado com contexto. (REQ-SYS-066/132)
- **CA-12** Os três sistemas do monorepo (PF2e, SF2e, Etmos) passam no
  `validateSystemModule` como gate de CI. (REQ-SYS-110/111)
- **CA-13** Nenhuma assinatura pública da API exige `any`; o `system` de um Actor
  `character` aparece tipado no componente de sheet e nas funções de derivação.
  (REQ-SYS-130)

## Questões em aberto

- **Q1** Conjunto exato de `selector`s/domínios de roll padronizados pela engine
  vs. livres por sistema: a engine deve oferecer um catálogo base sugerido
  (`attack-roll`, `damage`, saves) para interoperabilidade, ou permanecer
  totalmente agnóstica? Decidir junto de `08-`/`17-`.
- **Q2** Granularidade do grafo de derivação: dependências por caminho exato
  (`system.attributes.hp.max`) vs. por prefixo (`system.attributes.hp.*`).
  Prefixo é mais simples de declarar, mas pode criar arestas espúrias e ciclos
  falsos. Avaliar com casos reais do PF2e.
- **Q3** Onde o motor de effects roda: inteiramente no servidor (autoritativo, mas
  custa derivar tudo server-side) ou também no cliente para UX, com o servidor
  como verdade? Coordenar com `04-` e `06-` (orçamento de performance no host).
- **Q4** Effects `grantItem` que criam Documents embedded durante `prepareData`:
  como reconciliar com o ciclo CRUD sem efeitos colaterais persistidos
  indesejados? O PF2e materializa items concedidos; precisamos definir o ponto de
  materialização (provavelmente em hook pós-create, não na derivação). Coordenar
  com `02-`.
- **Q5** Etmos como cliente do motor de effects: a maior parte do Etmos é
  arbitragem do Narrador (research 12b §19.2). Quais automações merecem effects
  (ex.: penalidade de Fadiga "+1 Ferimento", bloqueio de magia sem Totem) vs.
  controles manuais? Decidir em `19-sistema-etmos.md`.
- **Q6** Licenciamento do Etmos (research 12b §0: "todos os direitos reservados",
  sem licença aberta). O sistema `systems/etmos` pode ser distribuído? Isso é
  legal/negócio (`ver 26-licencas-e-legal.md`), mas afeta se o pack do Etmos é
  empacotado. Não bloqueia a API.
- **Q7** Estabilidade da versão `engineCompat`: enquanto a engine está em `0.x`,
  qualquer minor pode ser breaking (semver pré-1.0). Definir política de compat
  durante o pré-1.0 com `27-roadmap-e-milestones.md`.
- **Q8** Effects plugáveis por sistema ([V2], REQ-SYS-089): qual o modelo de
  sandbox aceitável (subset declarativo estendido vs. WASM vs. JS sandboxed)?
  Fora do MVP, mas a forma do `EffectRule` deve não fechar a porta.

## Referências

> Conhecimento de domínio e comportamento observável; nenhum código proprietário
> reproduzido. Fontes detalhadas nos research docs abaixo.

- `docs/research/07-foundry-api-sistemas-modulos.md` — manifest, DataModels,
  sheets (AppV2), hooks, settings, i18n, packs, lições para o design (§14).
- `docs/research/02-foundry-documentos-persistencia.md` — Documents, schema/
  DataFields, validação/migração, ciclo CRUD/hooks, `prepareData` (§15), flags.
- `docs/research/10-pf2e-sistema-internals.md` — Rule Elements (§5), synthetics
  (§6), checks/degree of success (§7), condições/IWR (§8), lógica pura vs.
  acoplamento ao Foundry (§10), relação SF2e (§11).
- `docs/research/12b-etmos-fontes-locais.md` — data model do Etmos (§6), Grimório/
  partículas (§9), fadiga/estresse (§12), o que precisa de automação (§19).
- Specs irmãs citadas na seção _Dependências_.
