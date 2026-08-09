# 02 — Modelo de Dados (Documents)

- **Título:** Modelo de Dados (Documents)
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/02-foundry-documentos-persistencia.md`
  - `docs/research/07-foundry-api-sistemas-modulos.md`

> Esta spec é clean-room: descreve o modelo de dados do Fusion inspirado no
> _comportamento_ observável do Foundry VTT, sem copiar código proprietário.
> Onde simplificamos ou divergimos do Foundry, a decisão é marcada como decisão
> de design nossa.

---

## Objetivo

Definir o **catálogo de Documents** do Fusion — as unidades persistidas de dados
do mundo — e as regras transversais que governam todos eles: identidade (IDs e
UUIDs), schema tipado e validado em runtime (Zod), o campo `system` controlado
pela API de sistemas, flags por namespace, ownership/permissões, herança
token→actor, o ciclo de vida CRUD (eventos, diffs parciais, hooks de validação)
e a estratégia de migração de schema.

Esta spec é a fundação contratual sobre a qual se apoiam: persistência
(`ver 03-persistencia-e-mundos.md`), sincronização de rede
(`ver 04-rede-e-sincronizacao.md`), permissões de runtime
(`ver 05-usuarios-e-permissoes.md`), a API de sistemas
(`ver 15-api-de-sistemas.md`) e a importação de compendiums
(`ver 16-compendiums-e-importacao.md`).

## Escopo

### O que inclui

- O conjunto fechado de **tipos de Document** do Fusion (primários e embedded),
  com a decisão explícita do que entra no **MVP** e do que fica **[V2]**.
- A **hierarquia de embedding** (quem vive dentro de quem).
- Os **campos comuns** a todo Document (`_id`, `name`, `type`, `flags`,
  `ownership`, `_stats`, etc.) e o formato de cada um.
- O **sistema de schema** baseado em Zod: schemas de engine (fixos) e schemas de
  `system` (registrados pela system API), com derivação de tipos TypeScript.
- **Identidade**: formato de `_id`, formato de **UUID hierárquico** próprio do
  Fusion e **soft references**.
- **Ownership por documento** (níveis `none`/`limited`/`observer`/`owner`),
  herança e a regra de avaliação.
- **Herança token→actor** via modelo de delta simplificado (TokenActor).
- **Ciclo CRUD**: operações, formato de diff parcial, eventos emitidos, hooks de
  validação (pré/pós), pontos de cancelamento.
- **Migrações**: versionamento de schema de engine e de system, e o motor de
  migração.

### O que NÃO inclui

- Mecânica de **persistência física** (tabelas SQLite, WAL, índices,
  serialização) — `ver 03-persistencia-e-mundos.md`.
- **Protocolo de fio** e reconciliação otimista cliente/servidor —
  `ver 04-rede-e-sincronizacao.md`.
- **Avaliação de permissões em runtime** por operação e UI gating —
  `ver 05-usuarios-e-permissoes.md` (esta spec define apenas o _campo_ ownership
  e a função pura de avaliação de nível).
- O **conteúdo** dos schemas `system` de cada jogo (PF2e, SF2e, Etmos) —
  `ver 17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`.
- A **superfície da system API** (como sistemas registram models, sheets, hooks)
  — `ver 15-api-de-sistemas.md` (esta spec define apenas o _contrato de dados_
  que a API consome).
- Pipeline de **importação/conversão** de dados do `foundryvtt/pf2e` —
  `ver 16-compendiums-e-importacao.md`.

## Conceitos e terminologia

- **Document**: unidade de dados persistível e validada, identificada por `_id`,
  com schema fixo de engine mais um campo `system` opcional tipado pelo sistema
  de jogo. Análogo ao `Document` do Foundry, simplificado.
- **Document primário (top-level)**: armazenado em sua própria coleção
  (`World`, `User`, `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`,
  `Playlist`, `Macro`, `ChatMessage`, `Combat`, `Folder`, `Setting`).
- **Document embedded**: vive inteiramente dentro de um documento pai e só existe
  enquanto o pai existir (`Token`, `Wall`, `Light`, `Sound`, `Tile`, `Drawing`,
  `Template`, `Note`, `Combatant`, `ActiveEffect`, `JournalPage`, `TableResult`,
  `PlaylistSound`, `ActorEmbeddedItem`, `ActorEmbeddedEffect`).
- **EmbeddedCollection**: coleção indexada por `_id` de documents embedded de um
  mesmo tipo dentro de um pai.
- **`system`**: subdocumento de dados específicos do sistema de jogo,
  validado por um schema Zod registrado pela system API e selecionado pelo
  par `(documentType, subtype)`.
- **subtype** (`type`): discriminador do conteúdo de `system` (ex.: um `Actor`
  de subtype `"character"` vs `"npc"`). Cada par
  `(documentType, subtype)` mapeia para um schema `system`.
- **flags**: dados arbitrários namespaced por pacote/feature, fora do schema
  validado. Estrutura `flags.<namespace>.<key>`.
- **UUID**: string canônica que localiza qualquer document em qualquer contexto
  (mundo, embedded, compendium), formato hierárquico próprio do Fusion.
- **Soft reference**: referência a outro document por id/UUID _sem_ integridade
  referencial forte no banco — pode apontar para algo inexistente
  (alvo deletado), e o consumidor deve tratar `null`.
- **TokenActor**: ator efetivo de um token desvinculado, reconstruído em memória
  pela aplicação de um `actorDelta` sobre o `Actor` base.
- **`_source`**: os dados brutos persistidos de um document (nunca mutados por
  efeitos ou dados derivados).
- **Dados derivados**: valores calculados em memória durante o ciclo de
  preparação (`prepareData`), sobre uma cópia, nunca persistidos.

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### DEC-DOC-01 — Schema runtime com Zod, tipos TS derivados

Validamos todo Document com **Zod** em runtime e derivamos os tipos TypeScript
via `z.infer`. O schema de engine de cada tipo é fixo no `packages/shared`; o
schema de `system` é fornecido pela system API.

- **Rejeitado: portar o sistema `DataModel`/`DataField` do Foundry.** É uma
  reimplementação grande de um runtime de validação que já temos pronto e melhor
  tipado em Zod. (Foundry usa `defineSchema()` com `DataField`s — pesquisa
  `02-...md` §6.)
- **Rejeitado: validar só em TS (sem runtime).** Dados vêm de rede, disco e
  importadores externos (JSON do `pf2e`); precisamos de validação **autoritativa
  no servidor** em runtime (`ver 04-rede-e-sincronizacao.md`,
  `ver 21-seguranca.md`).
- **Racional:** Zod dá validação, coerção, defaults, mensagens de erro e
  inferência de tipo num único artefato; alinha com "TypeScript estrito"
  da stack fixada. A validação roda no servidor (autoritativo) e opcionalmente
  no cliente para UX.

### DEC-DOC-02 — IDs com nanoid (16 chars, alfabeto Foundry-compatível)

`_id` é uma string de **16 caracteres** gerada com **nanoid**, alfabeto
`A–Za–z0–9` (62 símbolos), o mesmo comprimento e formato usado pelo Foundry.

- **Rejeitado: ULID.** Ordenável por tempo, mas 26 chars e embute timestamp;
  não precisamos de ordenação lexicográfica por criação (temos `_stats.createdTime`
  e `sort`), e queremos IDs curtos e opacos.
- **Rejeitado: UUID v4 (36 chars).** Verboso; incompatível com o formato dos
  dados importados do `foundryvtt/pf2e`, que usam ids de 16 chars.
- **Racional:** 16 chars no alfabeto de 62 dão ~95 bits de entropia (colisão
  desprezível na escala de um mundo). Compatibilidade direta com ids dos
  JSON importados reduz remapeamento no importador
  (`ver 16-compendiums-e-importacao.md`). IDs são imutáveis após criação.

### DEC-DOC-03 — UUID hierárquico próprio, derivado do caminho de embedding

O Fusion adota um formato de UUID próprio que codifica o caminho do document a
partir da raiz. Formato:

```
<RootType>.<rootId>[.<EmbeddedType>.<embeddedId>]*
Compendium.<packId>.<DocType>.<docId>[.<EmbeddedType>.<embeddedId>]*
```

- **Rejeitado: apenas `_id` global.** `_id` de embedded só é único dentro do pai;
  precisamos de uma chave globalmente resolvível para referências cruzadas
  (origem de efeito, alvo de nota, etc.).
- **Rejeitado: copiar literalmente o esquema do Foundry incluindo o token actor
  sintético `Scene.x.Token.y.Actor.z`.** Mantemos o _padrão_ (é prático e os
  dados importados o usam), mas simplificamos a forma do token actor — ver DEC-DOC-08.
- **Racional:** formato textual, legível, parseável sem consultar o banco, e
  alinhado ao que aparece nos dados importados do `pf2e` (`@UUID[...]`,
  `Compendium.pf2e.<pack>.<Type>.<id>`). A resolução
  (`resolveUuid`/`resolveUuidSync`) é definida aqui como contrato; a
  implementação de busca pertence à camada de coleções
  (`ver 03-persistencia-e-mundos.md`).

### DEC-DOC-04 — Catálogo de Documents enxuto; cortes explícitos para [V2]

O Fusion implementa um subconjunto curado dos 34 tipos do Foundry. Cortes
explícitos para **[V2]**: `Cards`/`Card` (baralhos), `Region`/`RegionBehavior`
(regiões com comportamentos), `Level` (níveis verticais), `Adventure` (bundle de
distribuição), `CombatantGroup` (grupos de iniciativa) e `FogExploration` como
_Document_ de primeira classe.

- **Rejeitado: paridade total com Foundry no MVP.** Cada tipo carrega schema,
  CRUD, UI e sync; a definição de MVP global (jogar uma sessão de PF2e com
  mapa, tokens, visão, fichas, rolagens, chat, combate) não requer cards,
  regions, levels nem adventures.
- **Decisão sobre FogExploration:** no MVP o estado de fog explorado é
  persistido como dado anexo à Scene por usuário, **não** como Document CRUD-able
  de primeira classe (`ver 07-visao-iluminacao-fog.md`). Mantemos a porta aberta
  para promovê-lo a Document em V2.
- **Racional:** foco no caminho crítico do MVP; reduz superfície de schema,
  validação e sync.

### DEC-DOC-05 — Subtypes via discriminated union; sem `template.json`

O conteúdo de `system` é selecionado pelo par `(documentType, subtype)`. Não
há equivalente ao `template.json` legado do Foundry; schemas `system` são
sempre Zod registrados pela system API (research `07-...md` §2 confirma que o
`template.json` está em depreciação no Foundry v14 — não há razão para emulá-lo).

- **Rejeitado: herança por "templates" estilo `template.json`.** Substituível
  por composição de schemas Zod (`z.object().merge(...)`) no código do sistema.
- **Racional:** schemas como código TS-first são a recomendação da própria
  pesquisa (`07-...md` §14.2, ponto 2 e 5).

### DEC-DOC-06 — Flags namespaced, registráveis e validáveis opcionalmente

`flags` segue a estrutura `flags.<namespace>.<key>` do Foundry, mas o Fusion
permite (não obriga) que um sistema/feature **registre um schema Zod** para seu
namespace de flags, habilitando validação. Namespaces reservados: `core`
(engine) e `world` (dados do mundo).

- **Rejeitado: flags totalmente livres como no Foundry.** A pesquisa aponta isso
  como ponto de atrito (`07-...md` §14.2, ponto 4: "namespace de flags não
  estruturado"). Mas obrigar schema quebraria casos legítimos de dado ad-hoc.
- **Racional:** default permissivo (flags são `Record<string, unknown>` por
  namespace), com opt-in de validação por quem quiser integridade.

### DEC-DOC-07 — Ownership por document com 4 níveis + default + INHERIT

Mantemos os níveis `none`(0)/`limited`(1)/`observer`(2)/`owner`(3) e o sentinel
`inherit`(-1), mais a chave `default`. Esta spec define o **campo** e a **função
pura de avaliação de nível**; o _enforcement_ por operação fica em
`ver 05-usuarios-e-permissoes.md`.

- **Rejeitado: ACLs ricas (por capability).** Excesso para o MVP; os 4 níveis do
  Foundry cobrem os casos de mesa.
- **Racional:** modelo conhecido, simples, suficiente. GM sempre tem `owner`.

### DEC-DOC-08 — Herança token→actor por delta simplificado (sobre `system`)

Tokens podem ser **linked** (espelham o `Actor` mundial) ou **unlinked**
(carregam um `actorDelta`). O Fusion **simplifica** o `ActorDelta` do Foundry:
em vez de um mini-Actor com suas próprias coleções embedded de `Item`/`Effect`,
o delta do MVP é um **merge patch parcial** sobre os campos do Actor
(`name`, `img`, `system`, e _substituição completa_ das coleções `items`/
`effects` quando o delta as especifica).

- **Rejeitado: replicar `ActorDelta` com `EmbeddedCollectionDelta`** (diff
  item-a-item, herança parcial de itens não modificados — `02-...md` §4.3). É a
  parte mais complexa do modelo do Foundry; o ganho (não duplicar itens
  herdados) não justifica a complexidade no MVP.
- **Racional:** para o MVP, NPCs unlinked tipicamente têm seus próprios itens e
  raramente precisam de herança item-a-item refinada. O TokenActor é
  reconstruído em memória: `mergeDeep(baseActor._source, actorDelta)` para
  campos escalares e `system`; coleções `items`/`effects` são substituídas
  integralmente se presentes no delta, senão herdadas. Marcado para revisão de
  refinamento em **[V2]** (delta item-granular).

### DEC-DOC-09 — `_stats` gerenciado pelo servidor; nunca confiar no cliente

Todo document primário carrega `_stats` (createdTime, modifiedTime,
lastModifiedBy, createdBy, coreVersion, systemId, systemVersion, schemaVersion).
Esses campos são **escritos exclusivamente pelo servidor** durante o CRUD;
valores vindos do cliente em `_stats` são ignorados/sobrescritos.

- **Rejeitado: deixar o cliente preencher timestamps.** Anti-cheat e auditoria
  exigem fonte autoritativa única (`ver 21-seguranca.md`).
- **Racional:** alinha com servidor autoritativo da stack fixada.

### DEC-DOC-10 — Versionamento de schema separado: engine vs system

Cada document carrega `_stats.schemaVersion` (versão do schema de **engine**) e,
quando tem `system`, o `system.<schemaVersion>` é controlado pela versão do
sistema de jogo (registrada na system API). Migrações de engine e de system são
**independentes** e encadeadas.

- **Rejeitado: versão única global.** Acopla o ciclo de release do engine ao dos
  sistemas; um update de PF2e não deveria forçar migração de engine.
- **Racional:** engine e sistemas evoluem em ritmos distintos; migrações
  isoladas reduzem risco (`ver 16-compendiums-e-importacao.md` para migração de
  dados importados).

### DEC-DOC-11 — Soft references com resolução tolerante a alvo ausente

Referências entre documents (folder pai, ator de um combatant, journal de uma
nota, origem de efeito) são **soft**: armazenadas como id/UUID, sem FK forte. A
resolução retorna `null` quando o alvo não existe, e o consumidor degrada
graciosamente.

- **Rejeitado: FKs com cascade no SQLite.** Embedded já é cascade natural (vive
  no pai); referências cruzadas entre primários são intencionalmente frouxas
  (ex.: deletar um Actor não deve quebrar mensagens de chat antigas que o
  citam).
- **Racional:** robustez a dados parciais (importação, deleção) e simplicidade.

## Requisitos funcionais

> Tags: **[MVP]** alinhado à definição de MVP global; **[V2]** pós-MVP.

### Identidade e UUID

- **REQ-DOC-001** [MVP] Todo Document DEVE possuir um campo `_id` string de 16
  caracteres no alfabeto `[A-Za-z0-9]`, único dentro de sua coleção (para
  primários) ou de sua EmbeddedCollection (para embedded), gerado via nanoid no
  momento da criação e **imutável** depois.
- **REQ-DOC-002** [MVP] O sistema DEVE gerar `_id` no servidor durante o create
  quando ausente, e DEVE aceitar um `_id` fornecido (ex.: importação) desde que
  válido e não colidente; em colisão, a operação DEVE falhar com erro
  determinístico.
- **REQ-DOC-003** [MVP] Todo Document DEVE ser endereçável por um **UUID
  hierárquico** no formato `<RootType>.<rootId>(.<EmbeddedType>.<embeddedId>)*`
  para documents de mundo e
  `Compendium.<packId>.<DocType>.<docId>(.<EmbeddedType>.<embeddedId>)*` para
  documents de compendium.
- **REQ-DOC-004** [MVP] O sistema DEVE expor `parseUuid(uuid)` que retorna a
  decomposição `{ scope: "world"|"compendium", packId?, rootType, rootId,
embedded: Array<{ type, id }> }`, e DEVE rejeitar UUIDs malformados.
- **REQ-DOC-005** [MVP] O sistema DEVE expor `resolveUuid(uuid)` (assíncrono,
  resolve world e compendium) e `resolveUuidSync(uuid)` (apenas documents de
  mundo já carregados); ambos DEVEM retornar `null` quando o alvo não existir
  (soft reference).
- **REQ-DOC-006** [MVP] Todo Document DEVE expor sua própria propriedade `uuid`
  computada a partir do caminho de embedding (raiz + cadeia de pais).

### Campos comuns

- **REQ-DOC-007** [MVP] Todo Document primário DEVE conter os campos comuns:
  `_id`, `_stats`, `name` (quando aplicável ao tipo), `flags`, e — quando o tipo
  suporta — `type` (subtype), `system`, `ownership`, `folder`, `sort`.
- **REQ-DOC-008** [MVP] O campo `_stats` DEVE conter `createdTime`,
  `modifiedTime`, `lastModifiedBy` (userId), `createdBy` (userId),
  `coreVersion`, `systemId`, `systemVersion`, `schemaVersion`, e DEVE ser
  escrito **somente pelo servidor**; valores de `_stats` recebidos do cliente
  DEVEM ser descartados.
- **REQ-DOC-009** [MVP] O campo `flags` DEVE seguir a estrutura
  `flags.<namespace>.<key>` e aceitar valores arbitrários serializáveis em JSON
  por namespace; os namespaces `core` e `world` são reservados ao engine.
- **REQ-DOC-010** [MVP] As operações `getFlag(ns, key)`, `setFlag(ns, key, val)`
  e `unsetFlag(ns, key)` DEVEM existir; `setFlag` com valor objeto DEVE fazer
  **merge** raso com o objeto existente naquela chave (paridade comportamental
  com Foundry), e `unsetFlag` DEVE remover a chave.
- **REQ-DOC-011** [V2] Um sistema/feature PODE registrar um schema Zod para seu
  namespace de flags; quando registrado, escritas nesse namespace DEVEM ser
  validadas e rejeitadas se inválidas.

### Schema e validação (Zod)

- **REQ-DOC-012** [MVP] Cada tipo de Document DEVE ter um **schema de engine**
  Zod definido em `packages/shared`, do qual o tipo TypeScript é derivado via
  `z.infer`; não DEVE haver tipo de document manualmente desincronizado do
  schema.
- **REQ-DOC-013** [MVP] O campo `system` DEVE ser validado por um schema Zod
  selecionado pelo par `(documentType, subtype)`, fornecido pela system API
  (`ver 15-api-de-sistemas.md`); quando não houver schema registrado para o par,
  o servidor DEVE validar `system` como objeto passthrough (preservar campos sem
  alterar) e registrar um aviso.
- **REQ-DOC-014** [MVP] A validação completa de um Document DEVE compor o schema
  de engine com o schema `system` aplicável, e DEVE ocorrer **no servidor** em
  toda criação e atualização antes da persistência.
- **REQ-DOC-015** [MVP] A validação DEVE suportar **modo estrito** (rejeita a
  operação em falha) e **modo tolerante** (na carga inicial do mundo:
  documents inválidos são marcados como `invalid` e excluídos do uso ativo, sem
  derrubar o carregamento).
- **REQ-DOC-016** [MVP] A validação DEVE aplicar **defaults** e **coerção** do
  schema (ex.: clamp de min/max, trim de string) de forma determinística, e o
  resultado coerido é o que será persistido.
- **REQ-DOC-017** [MVP] O sistema DEVE oferecer **validação parcial de diff**:
  dado um patch de update, validar a forma do patch e o resultado do merge
  contra o schema completo, rejeitando se o documento resultante for inválido.

### Catálogo de documents (MVP)

- **REQ-DOC-018** [MVP] O sistema DEVE implementar os Documents primários:
  `World`, `User`, `Folder`, `Actor`, `Item`, `Scene`, `JournalEntry`,
  `RollTable`, `Playlist`, `Macro`, `ChatMessage`, `Combat`, `Setting`.
- **REQ-DOC-019** [MVP] O sistema DEVE implementar os Documents embedded:
  `Token`, `Wall`, `Light`, `Sound`, `Tile`, `Drawing`, `Template`, `Note`,
  `Overlay` (todos embedded em `Scene`); `Combatant` (em `Combat`); `JournalPage`
  (em `JournalEntry`); `TableResult` (em `RollTable`); `PlaylistSound`
  (em `Playlist`); `ActorEmbeddedItem` e `ActorEmbeddedEffect`/`ActiveEffect`
  (em `Actor`, e `ActiveEffect` também em `Item`).
- **REQ-DOC-020** [MVP] Cada `Actor` DEVE conter as EmbeddedCollections `items`
  (de `Item` embedded) e `effects` (de `ActiveEffect`); cada `Item` embedded ou
  mundial DEVE conter a EmbeddedCollection `effects`.
- **REQ-DOC-021** [MVP] Cada `Scene` DEVE conter as EmbeddedCollections
  `tokens`, `walls`, `lights`, `sounds`, `tiles`, `drawings`, `templates`,
  `notes`, `overlays`.
- **REQ-DOC-022** [MVP] Os Documents `Cards`/`Card`, `Region`/`RegionBehavior`,
  `Level`, `Adventure`, `CombatantGroup` e `FogExploration` (como Document de
  primeira classe) NÃO fazem parte do MVP e DEVEM ser planejados como **[V2]**.
- **REQ-DOC-023** [MVP] Os tipos que suportam `subtype` (campo `type`) e portanto
  `system` tipado DEVEM ser, no mínimo: `Actor`, `Item`, `ActiveEffect`,
  `JournalPage`, `ChatMessage`, `Combatant`. Demais tipos têm `system` ausente
  ou objeto livre conforme tabela em **Modelo de dados**.

### EmbeddedCollection e embedding

- **REQ-DOC-024** [MVP] Cada EmbeddedCollection DEVE indexar seus documents por
  `_id`, suportar `get(id)`, iteração, e agrupamento por `type`
  (`getByType(subtype)`).
- **REQ-DOC-025** [MVP] Documents embedded NÃO DEVEM possuir `ownership` próprio
  (herdam do pai), com duas exceções: `JournalPage` e `Note`, que PODEM ter
  `ownership` individual (para `Note`, ver REQ-DOC-056).
- **REQ-DOC-026** [MVP] Toda operação de escrita em um document embedded DEVE ser
  uma operação sobre o documento pai (o pai é a unidade de autoridade e de
  evento), via `createEmbeddedDocuments`/`updateEmbeddedDocuments`/
  `deleteEmbeddedDocuments`.

### Ownership

- **REQ-DOC-027** [MVP] O campo `ownership` DEVE ser um mapa
  `{ default: Level } & Record<UserId, Level>` onde `Level ∈ {-1,0,1,2,3}`
  (`inherit`, `none`, `limited`, `observer`, `owner`).
- **REQ-DOC-028** [MVP] O sistema DEVE expor `getUserLevel(document, user)` que
  resolve o nível efetivo aplicando: (a) GM ⇒ `owner`; (b) entrada explícita do
  `userId`; (c) `default`; (d) se o nível resolvido for `inherit`, herdar do
  `Folder` pai (recursivo até a raiz, default `none`).
- **REQ-DOC-029** [MVP] Documents recém-criados por um usuário não-GM DEVEM
  receber `ownership.default = none` e `ownership.<criadorId> = owner` por
  padrão; documents criados por GM DEVEM ter `ownership.default = none` (apenas
  GMs veem) salvo override.
- **REQ-DOC-030** [MVP] O sistema DEVE expor `testUserLevel(document, user, min)`
  que retorna boolean (nível efetivo ≥ `min`). O _enforcement_ dessa checagem
  por operação CRUD é especificado em `ver 05-usuarios-e-permissoes.md`.

### Visibilidade de Notes e Overlays de mapa

- **REQ-DOC-056** [MVP] `Note` DEVE possuir `ownership` próprio (segunda exceção
  de REQ-DOC-025). Na criação, o default DEVE ser `{ default: none }` — todo pin
  nasce oculto. A **visibilidade efetiva** de um Note para um usuário DEVE ser o
  máximo entre o nível pelo ownership próprio e o nível pelo ownership da
  JournalEntry ou JournalPage vinculada (quando `entryId`/`pageId` presentes);
  `global: true` equivale a `observer` para todos os usuários.
- **REQ-DOC-057** [MVP] A semântica dos níveis para Notes DEVE ser: `none` — o
  Note não existe para o usuário (não enviado, não renderizado); `limited` — o
  usuário recebe apenas posição e um marcador genérico de "rumor" (sem nome,
  ícone temático, tooltip, `entryId`/`pageId` ou `flags` de conteúdo);
  `observer`+ — conteúdo completo. O render é normatizado em
  `06-canvas-e-renderizacao.md` (REQ-CNV-057/058).
- **REQ-DOC-058** [MVP] A redação de Notes DEVE ocorrer **no servidor**, no
  mesmo módulo único de redação usado para hidden tokens e roll modes (alinha
  REQ-NET-024 e `21-seguranca.md` §"Autorização e visibilidade"): o payload de
  `Scene` enviado a cada usuário DEVE excluir Notes `none` e reduzir Notes
  `limited` à forma redigida de REQ-DOC-057. Revelar ou rebaixar um Note
  (update de `ownership`) DEVE disparar, para cada usuário afetado, o delta
  correspondente (create/update/delete lógico).
- **REQ-DOC-059** [MVP] `Overlay` é um embedded de `Scene` que representa uma
  imagem sobreposta ao mapa da mesma cena (variante temática, anotação, andar),
  com toggle de exibição. `hidden` DEVE ter default `true` (nasce oculto) e o
  toggle é ação de GM. Overlays NÃO possuem `ownership` próprio — a
  visibilidade é binária e global (todos os jogadores veem, ou nenhum).
- **REQ-DOC-060** [MVP] Overlays com `hidden: true` DEVEM ser redigidos do
  payload de usuários não-GM (mesmo pipeline de REQ-DOC-058) — inclusive o
  caminho do asset (`src`), para não vazar conteúdo via rede/devtools. O toggle
  do GM propaga aos jogadores como create/delete lógico do overlay.

### Herança token→actor

- **REQ-DOC-031** [MVP] Um `Token` DEVE referenciar um `Actor` base via
  `actorId` (soft reference) e ter `actorLink: boolean`.
- **REQ-DOC-032** [MVP] Quando `actorLink = true`, o ator efetivo do token É o
  `Actor` mundial; mutações no ator do token DEVEM ser traduzidas em updates do
  `Actor` mundial.
- **REQ-DOC-033** [MVP] Quando `actorLink = false`, o `Token` DEVE carregar um
  `actorDelta` (merge patch parcial); o **TokenActor** efetivo DEVE ser
  reconstruído em memória aplicando o delta sobre o `Actor` base conforme DEC-DOC-08
  (merge profundo de escalares e `system`; substituição integral de `items`/
  `effects` quando presentes no delta).
- **REQ-DOC-034** [MVP] Mutações no TokenActor de um token unlinked DEVEM ser
  traduzidas pelo servidor em updates do `Token.actorDelta` (e disparar o CRUD do
  `Token`), nunca do `Actor` base.
- **REQ-DOC-035** [V2] O `actorDelta` PODE evoluir para diff item-granular
  (herança parcial de itens não modificados do `Actor` base), preservando
  compatibilidade do formato armazenado.

### Ciclo CRUD, diffs, eventos e hooks

- **REQ-DOC-036** [MVP] O sistema DEVE oferecer operações
  `create`, `update`, `delete` (e variantes batch
  `createDocuments`/`updateDocuments`/`deleteDocuments`) para primários, e
  `createEmbeddedDocuments`/`updateEmbeddedDocuments`/`deleteEmbeddedDocuments`
  para embedded.
- **REQ-DOC-037** [MVP] `update` DEVE aceitar um **diff parcial** (patch) com
  semântica de merge profundo para objetos e **substituição** para arrays;
  chaves com valor `null` em sub-objetos de `flags`/`system` DEVEM remover a
  chave (paridade com a convenção `-=key` do Foundry, exposta como helper
  `deleteKey(path)`).
- **REQ-DOC-038** [MVP] O servidor DEVE calcular o **diff mínimo** entre o patch
  solicitado e o `_source` atual e persistir/transmitir apenas as mudanças reais
  (no-op updates não geram evento de mudança).
- **REQ-DOC-039** [MVP] Cada operação CRUD DEVE disparar hooks de validação
  **pré** (canceláveis) e eventos **pós** (notificação), nesta ordem:
  `preCreate*` / `create*`, `preUpdate*` / `update*`, `preDelete*` / `delete*`,
  com variantes genéricas (`preCreateDocument`, etc.) e específicas por tipo
  (`preCreateActor`, etc.).
- **REQ-DOC-040** [MVP] Hooks `pre*` DEVEM ser **síncronos** e PODEM cancelar a
  operação retornando `false`, ou modificar os dados/diff in-place antes da
  persistência; a cadeia de `pre*` é avaliada **no servidor** (autoritativo)
  antes de persistir.
- **REQ-DOC-041** [MVP] Eventos `pós` (`create*`/`update*`/`delete*`) DEVEM ser
  emitidos após a persistência e o broadcast, em todos os clientes conectados, e
  NÃO DEVEM poder cancelar a operação.
- **REQ-DOC-042** [MVP] A assinatura dos hooks DEVE ser:
  `pre*(document, data|changes|options, context)` e
  `*(document, options, context)`, onde `context` inclui `userId` (autor) e
  `operation` (metadados); embedded incluem referência ao `parent`.
- **REQ-DOC-043** [MVP] O sistema DEVE oferecer um ciclo de **preparação de
  dados** (`prepareData`) que, sobre uma cópia do `_source`, executa
  `prepareBaseData` → preparação de embedded → aplicação de `ActiveEffect` →
  `prepareDerivedData`, sem nunca mutar `_source`.
- **REQ-DOC-044** [MVP] `ActiveEffect.changes` DEVE suportar os modos
  `custom`(0), `multiply`(1), `add`(2), `downgrade`(3), `upgrade`(4),
  `override`(5) com `key` (caminho no actor), `value`, `mode`, `priority`,
  aplicados durante `prepareData` apenas em memória.
- **REQ-DOC-045** [MVP] O sistema DEVE expor `updateSource(changes)` para mutar o
  `_source` **em memória sem persistir** (uso interno/preview), distinto de
  `update` que persiste.

### Migrações

- **REQ-DOC-046** [MVP] Cada tipo de Document DEVE declarar uma `schemaVersion`
  de **engine**; ao carregar um document com versão inferior à atual, o motor de
  migração DEVE aplicar, em ordem, os passos de migração registrados até a versão
  corrente.
- **REQ-DOC-047** [MVP] As migrações de `system` DEVEM ser versionadas e
  fornecidas pela system API por par `(documentType, subtype)`, **independentes**
  das migrações de engine, e encadeadas a partir de `system.schemaVersion`.
- **REQ-DOC-048** [MVP] A migração DEVE ser **idempotente** e **tolerante a
  falha por documento**: um documento que falhe a migração é marcado `invalid` e
  registrado, sem abortar a migração do mundo inteiro.
- **REQ-DOC-049** [MVP] A migração de carga (`migrateData`) DEVE rodar **antes**
  da validação no fluxo de inicialização do document, e DEVE registrar
  (telemetria/log) o número de documents migrados por tipo
  (`ver 24-operacao-backups-telemetria.md`).
- **REQ-DOC-050** [V2] O sistema PODE oferecer migração persistente em lote
  ("escrever de volta" os documentos migrados ao banco) controlada pelo GM, com
  backup automático prévio (`ver 03-persistencia-e-mundos.md`,
  `ver 24-operacao-backups-telemetria.md`).

## Requisitos não-funcionais

- **REQ-DOC-051** [MVP] A validação de um Document de tamanho típico (ator PF2e
  com ~40 itens embedded) DEVE completar em < 15 ms no servidor (alvo, a
  verificar em `ver 25-testes-e-qualidade.md`), para não bloquear o loop de
  eventos durante sincronização.
- **REQ-DOC-052** [MVP] Todos os schemas e tipos de Document DEVEM residir em
  `packages/shared` e ser importáveis por `server`, `client` e `system-api` sem
  duplicação, garantindo uma única fonte de verdade do contrato de dados.
- **REQ-DOC-053** [MVP] O formato serializado de um Document DEVE ser **JSON
  puro** (sem instâncias de classe, sem ciclos), para persistência em SQLite e
  transmissão por socket sem transformação adicional
  (`ver 03-persistencia-e-mundos.md`, `ver 04-rede-e-sincronizacao.md`).
- **REQ-DOC-054** [MVP] Geração de `_id` DEVE ter probabilidade de colisão
  desprezível na escala de um mundo (≤ ~10^6 documents); o servidor ainda DEVE
  tratar colisão com erro determinístico (REQ-DOC-002).
- **REQ-DOC-055** [MVP] As mensagens de erro de validação DEVEM ser estruturadas
  (caminho do campo + motivo) e localizáveis (pt-BR/en), para exibição na UI e
  em logs.

## Modelo de dados

> Interfaces TypeScript ilustrativas (derivadas dos schemas Zod de engine). Os
> schemas Zod canônicos vivem em `packages/shared`. `Json` denota qualquer valor
> serializável em JSON.

### Tipos transversais

```ts
/** ID de 16 chars, alfabeto [A-Za-z0-9], imutável. */
export type DocumentId = string;

/** UserId é um DocumentId de um User. */
export type UserId = DocumentId;

/** UUID hierárquico. Ex.: "Actor.abc...", "Scene.x.Token.y",
 *  "Compendium.pf2e.bestiary.Actor.id" */
export type Uuid = string;

/** Níveis de ownership. */
export enum OwnershipLevel {
  Inherit = -1,
  None = 0,
  Limited = 1,
  Observer = 2,
  Owner = 3,
}

export interface OwnershipMap {
  default: OwnershipLevel; // nível para usuários não listados
  [userId: string]: OwnershipLevel; // override por usuário
}

/** Flags namespaced. */
export type FlagsRecord = Record<string /*namespace*/, Record<string, Json>>;

/** Metadados gerenciados pelo servidor. */
export interface DocumentStats {
  createdTime: number; // epoch ms
  modifiedTime: number; // epoch ms
  createdBy: UserId | null;
  lastModifiedBy: UserId | null;
  coreVersion: string; // versão do engine Fusion
  systemId: string | null; // ex.: "pf2e"
  systemVersion: string | null;
  schemaVersion: number; // versão do schema de ENGINE deste tipo
}

/** Campos comuns a todo Document primário. */
export interface BaseDocument {
  _id: DocumentId;
  _stats: DocumentStats;
  flags: FlagsRecord;
}

/** Para tipos com subtype + system. */
export interface TypedDocument<TSubtype extends string = string> extends BaseDocument {
  type: TSubtype;
  system: Json; // validado por schema (documentType, subtype) da system API
}
```

### Documents primários (MVP) — campos de engine

```ts
export interface WorldDocument extends BaseDocument {
  // _id é fixo "world"; uma instância por banco
  title: string;
  systemId: string; // sistema de jogo ativo
  systemVersion: string;
  coreVersion: string;
  description: string;
  activeSceneId: DocumentId | null;
}

export interface UserDocument extends BaseDocument {
  name: string;
  role: Role; // enum Role de packages/shared (ver 05-usuarios-e-permissoes.md)
  passwordHash: string | null;
  avatar: string | null; // FilePath
  color: string; // cor de marcação
  characterId: DocumentId | null; // soft ref para Actor padrão
  hotbar: Record<string /*slot*/, DocumentId /*macroId*/>;
  // sem ownership próprio
}

export interface FolderDocument extends BaseDocument {
  name: string;
  documentType: DocumentTypeName; // tipo que organiza (Actor, Item, ...)
  parentId: DocumentId | null; // soft ref para Folder pai
  sort: number;
  sorting: "a" | "m"; // alfabético | manual
  color: string | null;
  // Folders NÃO têm ownership próprio no MVP; INHERIT resolve até a raiz
}

export interface ActorDocument extends TypedDocument {
  name: string;
  img: string | null;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  prototypeToken: PrototypeTokenData; // config padrão de token
  items: ActorEmbeddedItem[]; // EmbeddedCollection
  effects: ActiveEffectData[]; // EmbeddedCollection
}

export interface ItemDocument extends TypedDocument {
  name: string;
  img: string | null;
  ownership: OwnershipMap; // quando mundial; embedded herda do Actor
  folderId: DocumentId | null;
  sort: number;
  effects: ActiveEffectData[]; // EmbeddedCollection
}

export interface SceneDocument extends BaseDocument {
  name: string;
  active: boolean;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  width: number;
  height: number;
  padding: number;
  background: string | null; // FilePath da imagem de fundo
  backgroundColor: string;
  grid: GridConfig; // ver 06-canvas-e-renderizacao.md
  tokenVision: boolean;
  fog: FogConfig; // ver 07-visao-iluminacao-fog.md
  initialView: { x: number; y: number; scale: number } | null;
  navigation: boolean;
  navName: string | null;
  thumb: string | null;
  playlistId: DocumentId | null; // soft ref
  journalId: DocumentId | null; // soft ref
  // EmbeddedCollections:
  tokens: TokenData[];
  walls: WallData[];
  lights: LightData[];
  sounds: SoundData[];
  tiles: TileData[];
  drawings: DrawingData[];
  templates: TemplateData[];
  notes: NoteData[];
  overlays: OverlayData[];
}

export interface JournalEntryDocument extends BaseDocument {
  name: string;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  pages: JournalPageData[]; // EmbeddedCollection
}

export interface RollTableDocument extends BaseDocument {
  name: string;
  img: string | null;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  description: string;
  formula: string; // ex.: "1d100"
  replacement: boolean;
  displayRoll: boolean;
  results: TableResultData[]; // EmbeddedCollection
}

export interface PlaylistDocument extends BaseDocument {
  name: string;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  mode: number; // sequential/shuffle/loop/simultaneous
  playing: boolean;
  fade: number | null;
  sounds: PlaylistSoundData[]; // EmbeddedCollection
}

export interface MacroDocument extends BaseDocument {
  name: string;
  type: "script" | "chat";
  img: string | null;
  ownership: OwnershipMap;
  folderId: DocumentId | null;
  sort: number;
  scope: "global" | "actors"; // ver 14-macros-e-automacao.md
  command: string; // JS ou texto de chat
}

export interface ChatMessageDocument extends TypedDocument {
  author: UserId; // soft ref
  timestamp: number;
  style: number; // estilo de exibição
  content: string; // HTML sanitizado
  flavor: string | null;
  speaker: ChatSpeaker; // { sceneId, actorId, tokenId, alias }
  rolls: Json[]; // resultados de rolagem serializados (ver 08)
  whisper: UserId[]; // destinatários (soft refs)
  blind: boolean;
  sound: string | null;
  // ChatMessage não tem ownership; visibilidade via whisper/blind
}

export interface CombatDocument extends BaseDocument {
  sceneId: DocumentId | null; // soft ref
  active: boolean;
  round: number;
  turn: number | null;
  sort: number;
  combatants: CombatantData[]; // EmbeddedCollection
  // sem ownership próprio
}

export interface SettingDocument extends BaseDocument {
  key: string; // "namespace.key"
  value: Json; // JSON serializado
  // sem name/type/ownership; chave única por (key)
}
```

### Documents embedded (MVP) — campos de engine

```ts
export interface TokenData {
  _id: DocumentId;
  name: string;
  displayName: number;
  actorId: DocumentId | null; // soft ref para Actor base
  actorLink: boolean;
  actorDelta: ActorDeltaPatch | null; // merge patch quando unlinked (DEC-DOC-08)
  x: number;
  y: number;
  elevation: number;
  width: number;
  height: number; // em células de grid
  img: string | null;
  hidden: boolean;
  locked: boolean;
  disposition: -1 | 0 | 1; // hostil/neutro/amigo
  rotation: number;
  alpha: number;
  bar1: { attribute: string | null };
  bar2: { attribute: string | null };
  light: TokenLightConfig; // ver 07
  sight: TokenSightConfig; // ver 07
  flags: FlagsRecord;
  // sem ownership (deriva do Actor referenciado p/ fins de visão)
}

/** Merge patch parcial simplificado (DEC-DOC-08). */
export interface ActorDeltaPatch {
  name?: string;
  img?: string | null;
  system?: Json; // merge profundo sobre system do Actor base
  items?: ActorEmbeddedItem[]; // SUBSTITUI integralmente se presente
  effects?: ActiveEffectData[]; // SUBSTITUI integralmente se presente
}

export interface WallData {
  _id: DocumentId;
  c: [number, number, number, number]; // x1,y1,x2,y2
  door: 0 | 1 | 2; // wall | door | secret
  ds: 0 | 1 | 2; // door state: closed | open | locked
  move: number; // bloqueio de movimento
  sight: number; // bloqueio de visão
  sound: number; // bloqueio de som
  light: number; // bloqueio de luz
  dir: number; // direção (one-way)
  flags: FlagsRecord;
}

export interface LightData {
  _id: DocumentId;
  x: number;
  y: number;
  rotation: number;
  walls: boolean; // bloqueado por paredes
  vision: boolean;
  hidden: boolean;
  config: LightConfig; // ver 07 (dim, bright, color, angle, ...)
  flags: FlagsRecord;
}

export interface SoundData {
  _id: DocumentId;
  x: number;
  y: number;
  radius: number;
  path: string; // FilePath de áudio
  volume: number;
  repeat: boolean;
  walls: boolean;
  easing: boolean;
  hidden: boolean;
  flags: FlagsRecord;
}

export interface TileData {
  _id: DocumentId;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  alpha: number;
  elevation: number; // determina overhead/underfoot (ver 06)
  sort: number;
  hidden: boolean;
  locked: boolean;
  texture: TextureConfig; // src, scaleX, scaleY, tint, ...
  flags: FlagsRecord;
}

export interface DrawingData {
  _id: DocumentId;
  author: UserId;
  shape: DrawingShape; // type, points, width, height, radius
  x: number;
  y: number;
  elevation: number;
  sort: number;
  rotation: number;
  fillType: number;
  fillColor: string | null;
  fillAlpha: number;
  strokeWidth: number;
  strokeColor: string | null;
  strokeAlpha: number;
  text: string | null;
  fontFamily: string;
  fontSize: number;
  textColor: string | null;
  textAlpha: number;
  hidden: boolean;
  locked: boolean;
  flags: FlagsRecord;
}

export interface TemplateData {
  // MeasuredTemplate
  _id: DocumentId;
  author: UserId;
  t: "circle" | "cone" | "ray" | "rect";
  x: number;
  y: number;
  elevation: number;
  distance: number;
  width: number;
  angle: number;
  direction: number;
  borderColor: string | null;
  fillColor: string | null;
  texture: string | null;
  hidden: boolean;
  flags: FlagsRecord;
}

export interface OverlayData {
  _id: DocumentId;
  name: string; // rótulo no painel de camadas
  src: string; // FilePath da imagem sobreposta
  hidden: boolean; // default true — nasce oculto (REQ-DOC-059)
  opacity: number; // 0..1, default 1
  tint: string | null;
  sort: number; // ordem de empilhamento entre overlays
  // frame; null = alinhado ao retângulo do background da cena
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  flags: FlagsRecord;
}

export interface NoteData {
  _id: DocumentId;
  entryId: DocumentId | null; // soft ref para JournalEntry
  pageId: DocumentId | null; // soft ref para JournalPage
  x: number;
  y: number;
  elevation: number;
  icon: string | null;
  iconSize: number;
  text: string | null; // tooltip override
  fontFamily: string;
  fontSize: number;
  textColor: string | null;
  textAnchor: number;
  global: boolean; // visível sem ownership da entry
  ownership: OwnershipMap; // EXCEÇÃO: ownership próprio (REQ-DOC-025/056)
  flags: FlagsRecord;
}

export interface CombatantData {
  _id: DocumentId;
  tokenId: DocumentId | null; // soft ref (no contexto da scene)
  sceneId: DocumentId | null; // soft ref
  actorId: DocumentId | null; // soft ref
  name: string | null;
  img: string | null;
  initiative: number | null;
  hidden: boolean;
  defeated: boolean;
  type?: string; // subtype opcional p/ system (ver 23)
  system?: Json;
  flags: FlagsRecord;
}

export interface JournalPageData {
  _id: DocumentId;
  name: string;
  type: "text" | "image" | "video" | "pdf" | string; // subtype
  system?: Json;
  text: { content: string; format: number } | null; // HTML/markdown
  src: string | null; // img/video/pdf
  title: { show: boolean; level: number };
  ownership: OwnershipMap; // EXCEÇÃO: page tem ownership próprio
  sort: number;
  flags: FlagsRecord;
}

export interface TableResultData {
  _id: DocumentId;
  type: number; // text | document | compendium
  text: string;
  img: string | null;
  documentUuid: Uuid | null; // soft ref quando aponta p/ um document
  weight: number;
  range: [number, number]; // [min, max]
  drawn: boolean;
  flags: FlagsRecord;
}

export interface PlaylistSoundData {
  _id: DocumentId;
  name: string;
  path: string; // FilePath de áudio
  volume: number;
  repeat: boolean;
  fade: number | null;
  playing: boolean;
  pausedTime: number | null;
  sort: number;
  flags: FlagsRecord;
}

export interface ActiveEffectData {
  // embedded em Actor ou Item
  _id: DocumentId;
  name: string;
  img: string | null;
  type?: string; // subtype opcional
  system?: Json;
  changes: ActiveEffectChange[];
  disabled: boolean;
  duration: EffectDuration; // rounds/seconds/turns/...
  description: string | null;
  origin: Uuid | null; // soft ref (UUID do Item que gerou)
  tint: string | null;
  transfer: boolean; // transfere do Item para o Actor
  statuses: string[]; // status ids
  flags: FlagsRecord;
}

export interface ActiveEffectChange {
  key: string; // caminho, ex.: "system.attributes.hp.max"
  value: string; // valor (parseado conforme mode)
  mode: 0 | 1 | 2 | 3 | 4 | 5; // custom|multiply|add|downgrade|upgrade|override
  priority: number;
}

/** Item embedded num Actor reaproveita o schema de Item (sem ownership). */
export type ActorEmbeddedItem = Omit<ItemDocument, "ownership" | "folderId">;
```

> `PrototypeTokenData`, `GridConfig`, `FogConfig`, `LightConfig`,
> `TokenLightConfig`, `TokenSightConfig`, `TextureConfig`, `DrawingShape`,
> `EffectDuration`, `ChatSpeaker` são detalhados nas specs de canvas/visão/chat
> (`ver 06-`, `07-`, `09-`); aqui aparecem como tipos opacos do ponto de vista do
> modelo de dados.

### Tabela de capacidades por tipo

| Document         | Categoria | `type`/`system`   | `ownership` próprio         | MVP |
| ---------------- | --------- | ----------------- | --------------------------- | --- |
| World            | primário  | não               | não                         | MVP |
| User             | primário  | não               | não                         | MVP |
| Folder           | primário  | não               | não (INHERIT alvo)          | MVP |
| Actor            | primário  | sim               | sim                         | MVP |
| Item             | primário  | sim               | sim (quando mundial)        | MVP |
| Scene            | primário  | não               | sim                         | MVP |
| JournalEntry     | primário  | não               | sim                         | MVP |
| RollTable        | primário  | não               | sim                         | MVP |
| Playlist         | primário  | não               | sim                         | MVP |
| Macro            | primário  | sim (script/chat) | sim                         | MVP |
| ChatMessage      | primário  | sim               | não (whisper/blind)         | MVP |
| Combat           | primário  | não               | não                         | MVP |
| Setting          | primário  | não               | não                         | MVP |
| Token            | embedded  | via actorDelta    | herdado                     | MVP |
| Wall/Light/Sound | embedded  | não               | herdado                     | MVP |
| Tile/Drawing     | embedded  | não               | herdado                     | MVP |
| Template         | embedded  | não               | herdado                     | MVP |
| Note             | embedded  | não               | **próprio** (REQ-DOC-056)   | MVP |
| Overlay          | embedded  | não               | herdado (`hidden`, GM-only) | MVP |
| Combatant        | embedded  | opcional          | herdado                     | MVP |
| JournalPage      | embedded  | sim               | **próprio**                 | MVP |
| TableResult      | embedded  | não               | herdado                     | MVP |
| PlaylistSound    | embedded  | não               | herdado                     | MVP |
| ActiveEffect     | embedded  | opcional          | herdado                     | MVP |
| Cards/Card       | —         | —                 | —                           | V2  |
| Region/Behavior  | —         | —                 | —                           | V2  |
| Level            | —         | —                 | —                           | V2  |
| Adventure        | —         | —                 | —                           | V2  |
| CombatantGroup   | —         | —                 | —                           | V2  |
| FogExploration   | —         | —                 | —                           | V2  |

## API e eventos

### Operações CRUD (contrato)

```ts
// Primários
create<T>(type: DocumentTypeName, data: Partial<T>, op?: Operation): Promise<T>;
createDocuments<T>(type, data: Partial<T>[], op?): Promise<T[]>;
update<T>(type, id: DocumentId, patch: DeepPartial<T>, op?): Promise<T>;
updateDocuments<T>(type, updates: ({ _id: DocumentId } & DeepPartial<T>)[], op?): Promise<T[]>;
delete(type, id: DocumentId, op?): Promise<void>;
deleteDocuments(type, ids: DocumentId[], op?): Promise<void>;

// Embedded (sempre via pai)
createEmbeddedDocuments(parentUuid: Uuid, embeddedType: string, data: object[], op?): Promise<object[]>;
updateEmbeddedDocuments(parentUuid: Uuid, embeddedType: string, updates: object[], op?): Promise<object[]>;
deleteEmbeddedDocuments(parentUuid: Uuid, embeddedType: string, ids: DocumentId[], op?): Promise<void>;

// In-memory (não persiste)
updateSource(doc, changes: object): void;

// Resolução
parseUuid(uuid: Uuid): ParsedUuid;
resolveUuid(uuid: Uuid): Promise<AnyDocument | null>;
resolveUuidSync(uuid: Uuid): AnyDocument | null;

// Flags
getFlag(doc, ns: string, key: string): Json | undefined;
setFlag(doc, ns: string, key: string, value: Json): Promise<AnyDocument>; // merge p/ objetos
unsetFlag(doc, ns: string, key: string): Promise<AnyDocument>;

// Ownership (função pura; enforcement em 05)
getUserLevel(doc, user: UserDocument): OwnershipLevel;
testUserLevel(doc, user: UserDocument, min: OwnershipLevel): boolean;

interface Operation {
  diff?: boolean;        // calcular diff mínimo (default true)
  noHook?: boolean;      // suprimir hooks (uso interno)
  render?: boolean;      // pedir re-render no cliente
  source?: "client" | "import" | "server";
  parent?: Uuid;         // para embedded
}
```

### Eventos / hooks de ciclo de vida

| Hook                   | Fase      | Cancelável    | Onde dispara        |
| ---------------------- | --------- | ------------- | ------------------- |
| `preCreate<Type>`      | pré       | sim (`false`) | servidor (autor)    |
| `create<Type>`         | pós       | não           | todos os clientes   |
| `preUpdate<Type>`      | pré       | sim           | servidor (autor)    |
| `update<Type>`         | pós       | não           | todos os clientes   |
| `preDelete<Type>`      | pré       | sim           | servidor (autor)    |
| `delete<Type>`         | pós       | não           | todos os clientes   |
| `*Document` (genérico) | ambos     | conforme fase | idem                |
| `applyActiveEffect`    | derivação | não           | local (prepareData) |

- Assinaturas: `pre*(doc, data|changes, op, userId)` /
  `*(doc, op, userId)`. Embedded recebem `parent` em `op`.
- A cadeia `pre*` roda **no servidor** antes da persistência (autoridade e
  anti-cheat — `ver 04-`, `ver 21-`). Hooks `pre*` são síncronos; `false` cancela.
- O _broadcast_ dos eventos pós e a reconciliação otimista no cliente são
  detalhados em `ver 04-rede-e-sincronizacao.md`.

## Dependências (specs irmãs)

- `01-arquitetura-geral.md` — onde vivem `packages/shared`, `server`,
  `system-api`; camadas e fronteiras.
- `03-persistencia-e-mundos.md` — como Documents são serializados e armazenados
  em `world.db` (SQLite/WAL), coleções, índices, backup.
- `04-rede-e-sincronizacao.md` — protocolo de fio, broadcast de eventos CRUD,
  reconciliação cliente/servidor, diffs no fio.
- `05-usuarios-e-permissoes.md` — roles de User, enforcement de ownership por
  operação CRUD, filtragem de payloads por nível.
- `06-canvas-e-renderizacao.md` — `GridConfig`, `PrototypeTokenData`,
  `TextureConfig`, elevação de tiles.
- `07-visao-iluminacao-fog.md` — `FogConfig`, `LightConfig`, sight/light de
  token, e a decisão de fog não ser Document no MVP (DEC-DOC-04).
- `08-motor-de-rolagens.md` — formato serializado de `rolls` em ChatMessage.
- `09-chat-e-mensagens.md` — `ChatSpeaker`, modos de whisper/blind, styles.
- `10-combate-e-iniciativa.md` — semântica de `Combat`/`Combatant`, fórmula de
  iniciativa.
- `15-api-de-sistemas.md` — registro de schemas `system`, sheets, migrações de
  system, hooks expostos a sistemas.
- `16-compendiums-e-importacao.md` — packs de compendium, UUIDs de compendium,
  remapeamento de ids na importação, migração de dados do `pf2e`.
- `17-`, `18-`, `19-` — conteúdo dos schemas `system` de PF2e/SF2e/Etmos.
- `21-seguranca.md` — validação autoritativa, descarte de `_stats` do cliente,
  sanitização de HTML em campos.
- `24-operacao-backups-telemetria.md` — telemetria de migração, backup pré
  write-back.

## Critérios de aceitação

- **CA-01** Existe, em `packages/shared`, um schema Zod e um tipo TS derivado
  (`z.infer`) para cada Document primário e embedded listado como **MVP**, sem
  tipos manualmente desincronizados (REQ-DOC-012, 052).
- **CA-02** `parseUuid` decompõe corretamente UUIDs de mundo (primário e
  embedded aninhado) e de compendium, e rejeita malformados; round-trip
  `doc.uuid → parseUuid → resolve` retorna o mesmo document (REQ-DOC-003..006).
- **CA-03** Criar um Document sem `_id` gera um id de 16 chars válido; criar com
  `_id` colidente falha com erro determinístico (REQ-DOC-001, 002, 054).
- **CA-04** Validação de engine + `system` (com schema registrado) rejeita
  payload inválido no servidor; sem schema registrado, `system` é preservado
  passthrough com aviso (REQ-DOC-013, 014).
- **CA-05** Na carga de mundo com um document inválido, o carregamento conclui e
  o document é marcado `invalid` sem derrubar o mundo (REQ-DOC-015, 048).
- **CA-06** `update` com patch parcial faz merge profundo em objetos, substitui
  arrays, e `deleteKey` remove a chave; um no-op update não emite evento de
  mudança (REQ-DOC-037, 038).
- **CA-07** Um hook `preUpdateActor` que retorna `false` cancela a persistência;
  um que altera `changes` in-place persiste o valor alterado; o evento
  `updateActor` chega a todos os clientes após persistência (REQ-DOC-039..041).
- **CA-08** Para um token `actorLink:false` com `actorDelta`, o TokenActor
  efetivo reflete o merge sobre o Actor base; mutar o TokenActor grava no
  `Token.actorDelta`, não no Actor base (REQ-DOC-033, 034).
- **CA-09** `getUserLevel` retorna `owner` para GM; aplica override por userId;
  resolve `inherit` subindo a cadeia de Folders; default `none` na raiz
  (REQ-DOC-028).
- **CA-10** `ActiveEffect.changes` com modos `add`/`override`/`upgrade` alteram
  os dados derivados em memória durante `prepareData` sem mutar `_source`
  (REQ-DOC-043, 044, 045).
- **CA-11** Carregar um document com `schemaVersion` antiga aplica os passos de
  migração de engine em ordem; migração de `system` roda independente a partir
  de `system.schemaVersion`; migração é idempotente (REQ-DOC-046..049).
- **CA-12** `_stats` recebido do cliente é ignorado; após qualquer escrita,
  `modifiedTime`/`lastModifiedBy` são preenchidos pelo servidor (REQ-DOC-008, 009).

## Questões em aberto

- **Q1 — Sublevels/granularidade de persistência de embedded.** ~~Questão
  resolvida~~ — **DEC-PER-02** (`ver 03-persistencia-e-mundos.md`) decidiu que
  documents embedded são persistidos como JSON dentro do campo `data` do Document
  pai; não há tabela própria por tipo embedded. Toda operação de escrita em
  embedded (REQ-DOC-026) implica um `UPDATE` na linha do pai com o JSON completo
  atualizado; o diff mínimo (REQ-DOC-038) garante que apenas mudanças reais
  disparam esse UPDATE. **Nota de performance:** reescrever o pai inteiro é
  aceitável pois o carregamento é sempre do Document completo e os tamanhos
  práticos cabem em poucos MB (DEC-PER-02, racional); contudo, operações de alta
  frequência sobre embedded muito volumosos (ex.: sync contínuo de posições de
  token) devem observar os limites REQ-PER-NF-002 (< 10 ms P99) e REQ-PER-NF-006
  (100k Documents sem degradação), detalhados em `ver 03-persistencia-e-mundos.md`.
- **Q2 — Granularidade do delta de token unlinked.** DEC-DOC-08 simplifica para merge
  patch; confirmar com a importação do `pf2e` se NPCs do bestiário dependem de
  herança item-a-item (afeta REQ-DOC-033/035). Validar com
  `ver 16-compendiums-e-importacao.md`.
- **Q3 — Promover FogExploration a Document em V2?** Definir o gatilho de
  migração do formato anexo-à-Scene (MVP) para Document de primeira classe
  (`ver 07-`).
- **Q4 — `Setting` de cliente vs mundo.** Settings de escopo `client` ficam em
  `localStorage` (não são Documents). Confirmar a fronteira: apenas
  `world`/`user`-scope viram `SettingDocument`? (`ver 05-`, `ver 15-`).
- **Q5 — Limite de tamanho de Document.** Definir um teto prático (ex.: ator com
  N itens, journal com páginas grandes) para evitar payloads de sync excessivos;
  alvo a fixar junto de `ver 04-` e `ver 25-`.
- **Q6 — Compatibilidade exata de `_id` importado.** Confirmar que todos os ids
  dos JSON do `foundryvtt/pf2e` cabem no alfabeto/tamanho de REQ-DOC-001; caso
  algum não caiba, definir política de remapeamento em
  `ver 16-compendiums-e-importacao.md`.
- **Q7 — Validação de flags por terceiros [V2].** Como expor o registro de
  schema de flags (REQ-DOC-011) na system API sem reintroduzir o acoplamento que
  DEC-DOC-06 evita; coordenar com `ver 15-`.

## Referências

- `docs/research/02-foundry-documentos-persistencia.md` — catálogo de
  documentos, embedding, `DataModel`/`DataField`, ownership, `_stats`, UUID,
  ciclo CRUD/hooks, `prepareData`, ActiveEffect, ActorDelta, LevelDB.
- `docs/research/07-foundry-api-sistemas-modulos.md` — `documentTypes`,
  `TypeDataModel` vs `template.json` (depreciação), registro de dataModels,
  flags vs system, ownership API, modos de ActiveEffect, hooks de CRUD, lições
  de design (§14) que motivam DEC-DOC-01, DEC-DOC-05, DEC-DOC-06.
- Stack fixada do projeto Fusion (TypeScript estrito, Zod, better-sqlite3,
  servidor autoritativo Fastify + socket.io) — `ver 00-`, `01-`, `03-`, `04-`.
