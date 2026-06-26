# 16 — Compendiums e Importação de Dados

- **Título:** Compendiums e Importação de Dados
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/02-foundry-documentos-persistencia.md` — compendium packs, índice lazy, UUID de compendium, `foundryvtt-cli` (unpack/pack), `omitVolatile`
  - `docs/research/10-pf2e-sistema-internals.md` — estrutura JSON dos packs do `foundryvtt/pf2e`, tipos de Actor/Item, motor de Rule Elements, escala de packs, `extractPacks`
  - `docs/research/14-licencas-legal.md` — licenças ORC/OGL, arte proprietária da Paizo, metadados de `publication`, obrigações de notice e atribuição
  - `docs/research/90-asset-media-management.md` — referência de paths em Documents, placeholders de assets faltantes, otimização de imagem

> Esta spec é clean-room: descreve o subsistema de compendiums e o pipeline de
> importação do Fusion inspirado no _comportamento_ observável do Foundry VTT e na
> estrutura _pública_ (Apache-2.0) do repositório `foundryvtt/pf2e`, sem copiar
> código proprietário do Foundry core. Onde divergimos, a decisão é marcada como
> decisão de design nossa.

---

## Objetivo

Definir (a) o **formato de compendium pack** do Fusion — como packs de Documents
pré-fabricados são armazenados, indexados e servidos; (b) o **compendium browser**
— a UI de busca, filtro, preview e importação para o mundo, com drag direto para
canvas e fichas; e (c) o **pipeline `tools/importer-pf2e`** — a ferramenta que
extrai os JSON do repositório `foundryvtt/pf2e` (via `foundryvtt-cli`), transforma
o schema campo a campo (incluindo o mapeamento de **rule elements** para o motor de
modifiers do Fusion, com tabela de cobertura e fallback "não suportado ainda"),
substitui arte proprietária por placeholders livres, e produz packs Fusion
versionados, re-importáveis de forma idempotente e com relatório de diferenças.

Esta spec é a camada de **conteúdo importado**: consome o modelo de dados
(`ver 02-modelo-de-dados.md`), a persistência SQLite (`ver 03-persistencia-e-mundos.md`),
a API de sistemas (`ver 15-api-de-sistemas.md`) e a política legal
(`ver 26-licencas-e-legal.md`); alimenta as fichas (`ver 11-ui-framework-e-fichas.md`)
e os sistemas de jogo (`ver 17-`, `18-`, `19-`).

## Escopo

### O que inclui

- **Formato de pack**: um arquivo SQLite `pack.db` por pack (schema idêntico ao
  `world.db`), índice leve para _lazy browse_, e **metadados de licença por pack**
  (`pack.json`).
- **Resolução e serving de packs**: UUIDs de compendium, leitura _lazy_ (índice
  primeiro, documento completo sob demanda), e como packs do sistema ativo são
  descobertos e carregados.
- **Compendium browser (UI)**: busca textual, filtros por tipo/traits/level (PF2e),
  preview de documento, importar para o mundo, drag-and-drop para canvas (criar
  token/tile) e para fichas (adicionar item a um actor).
- **Importação para o mundo**: cópia de um documento de compendium para uma coleção
  do mundo, com novo `_id`, resolução de links `@UUID` e de assets.
- **Pipeline `tools/importer-pf2e`**: extração via `foundryvtt-cli`, transformação
  de schema pf2e→Fusion, mapeamento **rule elements → motor de modifiers** com
  tabela de cobertura e fallback, geração de packs, **versionamento** (acompanhar
  releases do `foundryvtt/pf2e`), **re-import idempotente** e **relatório de
  diferenças** (diff report).
- **Política de assets na importação**: NÃO importar arte/ícones restritos da Paizo;
  substituir por placeholders/ícones livres (`ver 26-licencas-e-legal.md`).
- **Packs do Etmos**: criados à mão a partir do SRD (ex.: as 81 Partículas como
  Items), processo editorial próprio (sem importador automático).

### O que NÃO inclui

- A **mecânica física de persistência** SQLite (PRAGMAs, WAL, transações) —
  `ver 03-persistencia-e-mundos.md` (esta spec apenas reusa o mesmo schema para
  `pack.db`).
- O **modelo de Document** em si (campos comuns, UUID, ownership, CRUD) —
  `ver 02-modelo-de-dados.md`.
- O **conteúdo dos schemas `system`** de cada jogo (forma final dos campos de um
  weapon/spell PF2e, etc.) — `ver 17-sistema-pf2e.md`, `18-sistema-sf2e.md`,
  `19-sistema-etmos.md`. Esta spec define _como_ o importer popula esses schemas, não
  os schemas em si.
- O **motor de modifiers / rule elements** em runtime (como um modifier é avaliado
  num roll) — `ver 08-motor-de-rolagens.md` e `ver 15-api-de-sistemas.md`. Esta spec
  define apenas o **formato-alvo** do mapeamento e a **tabela de cobertura**.
- O **subsistema de arquivos/assets** (upload, dedup, thumbnails, serving) —
  `ver 20-assets-e-midia.md`. Esta spec define apenas a _política_ de quais assets
  importar e o catálogo de placeholders.
- O **texto legal completo** de notices ORC/OGL e CUP — `ver 26-licencas-e-legal.md`
  (esta spec referencia e exige os campos, mas não transcreve a licença).
- **Import de mundos completos do Foundry** (LevelDB → world) — é **[V2]** e vive em
  `ver 03-persistencia-e-mundos.md` (REQ-PER-036).

## Conceitos e terminologia

- **Compendium pack** (ou simplesmente **pack**): coleção nomeada de Documents
  pré-fabricados de um mesmo tipo (Actor, Item, JournalEntry, RollTable, Macro,
  Scene, Playlist), armazenada fora do mundo ativo, em estado de _lazy loading_.
- **`pack.db`**: arquivo SQLite de um pack, com o **mesmo schema** do `world.db`
  (`ver 03-persistencia-e-mundos.md`). Um pack contém só um tipo de Document
  primário por pack (espelhando o Foundry).
- **`pack.json`**: manifesto de um pack — id, label, tipo de document, sistema-alvo,
  e **bloco de licença** (origem, licença, atribuição, versão de origem).
- **Índice do pack** (_pack index_): projeção leve de cada documento
  (`_id`, `name`, `img`, `type` + campos extras declarados) usada para listar/buscar
  sem carregar o documento completo.
- **UUID de compendium**: identificador resolvível no formato
  `Compendium.<packId>.<DocType>.<docId>` (`ver 02-modelo-de-dados.md`, D3).
- **`packId`**: identificador estável de um pack, no formato `<systemId>.<packSlug>`
  (ex.: `pf2e.bestiary-1`, `etmos.particles`).
- **Compendium browser**: aplicação de UI que lista e filtra o conteúdo dos packs e
  permite importar/arrastar para o mundo.
- **Importar para o mundo**: copiar um documento de um pack para uma coleção do
  mundo (`actors`, `items`, …), gerando novo `_id` e resolvendo referências
  (`ver "Importação para o mundo"`).
- **Rule Element (RE)**: no `foundryvtt/pf2e`, item de automação data-driven no
  array `system.rules` (`docs/research/10-...md` §5). No Fusion, o RE é traduzido
  para um **modifier descriptor** do nosso motor (formato-alvo definido nesta spec).
- **Modifier descriptor (Fusion)**: representação data-driven de um efeito de regra
  no Fusion — o destino do mapeamento de REs. Sua _avaliação_ pertence ao
  `ver 15-api-de-sistemas.md`; aqui ele é apenas um formato de dados.
- **Tabela de cobertura** (_coverage table_): mapeamento declarativo
  `RE.key → conversor Fusion`, com estado por RE
  (`supported` / `partial` / `unsupported`).
- **Fallback "não suportado ainda"**: quando um RE não tem conversor, o importer
  preserva o RE original em `flags.fusion.unconvertedRules` e marca o documento, em
  vez de descartá-lo silenciosamente.
- **Diff report** (_relatório de diferenças_): saída do importer comparando a
  geração atual com a anterior — documentos adicionados, removidos, alterados, e
  cobertura de REs.
- **Idempotência de import**: re-rodar o importer sobre a mesma versão de origem
  produz packs byte-equivalentes nos campos não-voláteis (mesmos `_id`).

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### D1 — Um `pack.db` SQLite por pack, com schema idêntico ao `world.db`

Cada pack é um arquivo SQLite `compendiums/<packId>/pack.db` com o **mesmo schema**
de tabelas e índices do `world.db` (`ver 03-persistencia-e-mundos.md`, REQ-PER-006/007).
Um pack contém só **um tipo** de Document primário (ex.: pack de Actors, pack de Items).

- **Rejeitado: LevelDB por pack (modelo do Foundry).** O Foundry usa um diretório
  LevelDB por pack (`docs/research/02-...md` §12). Já rejeitamos LevelDB para o
  mundo (`ver 03-`, DEC-PER-01); reusar SQLite mantém uma só engine de
  persistência, ferramentas de inspeção e código de CRUD.
- **Rejeitado: tabela única no `world.db` com coluna `pack_id`.** Acopla packs ao
  mundo; impede compartilhar packs entre mundos e distribuir/atualizar um pack como
  arquivo único. Packs do sistema são globais, não por mundo.
- **Rejeitado: um único `packs.db` com uma tabela por pack.** Atualizar um pack
  (re-import) exigiria reescrever o arquivo compartilhado e travá-lo para todos;
  um arquivo por pack permite _swap_ atômico no re-import.
- **Racional:** reuso total da camada de persistência; pack = arquivo portátil;
  re-import = gerar `pack.db` novo e trocar atomicamente; inspeção via qualquer
  cliente SQLite. Packs de mundo (criados pelo GM) ficam em
  `worlds/<slug>/compendiums/<packSlug>/` com o mesmo formato.

### D2 — Índice leve materializado para _lazy browse_

O browse e a busca operam sobre um **índice** projetado de cada documento
(`_id`, `name`, `img`, `type` + campos declarados no `pack.json`), nunca carregando
o `data` JSON completo até o preview/import. O índice é construído via query SQL com
`json_extract` sobre a coluna `data`, materializado em memória (e, opcionalmente, em
uma tabela `pack_index` no `pack.db`).

- **Rejeitado: carregar todos os documentos completos na abertura.** O pack de
  equipment do pf2e tem ~5.200 itens (`docs/research/10-...md` §9.1); o de feats,
  milhares. Carregar tudo estoura memória e atrasa a abertura.
- **Rejeitado: full table scan com `json_extract` a cada busca.** Lento para packs
  grandes e buscas interativas; preferimos materializar o índice uma vez por sessão
  e filtrar em memória.
- **Racional:** paridade com o _lazy loading_ do Foundry (`docs/research/02-...md`
  §12.3): índice primeiro, documento completo sob demanda via UUID. Campos de filtro
  específicos do sistema (ex.: `system.level.value` no PF2e) são declarados em
  `pack.json.indexFields` para entrarem no índice.

### D3 — Metadados de licença **por pack** (e por documento quando necessário)

Cada `pack.json` carrega um bloco `license` obrigatório (origem, licença, versão de
origem, atribuição). Quando documentos de um mesmo pack têm licenças distintas (ex.:
um item OGL legado num pack majoritariamente ORC), o campo `system.publication`
de cada documento (`docs/research/10-...md` §2.2) é preservado e prevalece sobre o
default do pack.

- **Rejeitado: licença só global do projeto.** A pesquisa legal exige rastrear a
  licença de **cada** conteúdo importado (`docs/research/14-...md` §11, ponto 2:
  "sistema de licenças por pack"). PF2e mistura ORC (remaster) e OGL (legado).
- **Rejeitado: licença só por documento.** Verboso e redundante quando o pack
  inteiro é ORC; o default por pack cobre o caso comum, o override por documento
  cobre a exceção.
- **Racional:** granularidade adequada ao risco legal; o compendium browser exibe a
  licença e o importer propaga o notice para o mundo (`ver 26-licencas-e-legal.md`).

### D4 — Importador é uma ferramenta **offline** (`tools/importer-pf2e`), não runtime

A conversão pf2e→Fusion roda **fora do servidor de jogo**, como CLI em
`tools/importer-pf2e`, produzindo `pack.db` + `pack.json` versionados e
_commitados/distribuídos_ com o sistema. O servidor em runtime apenas **lê** packs
prontos.

- **Rejeitado: converter JSON do pf2e em runtime, ao abrir o mundo.** Acopla o
  servidor à versão exata do repo pf2e, atrasa a inicialização, e mistura código de
  conversão (que precisa de heurística e exceções) com o caminho crítico de jogo.
- **Rejeitado: distribuir os JSON crus do pf2e e converter no cliente.** Empurra a
  complexidade e o risco legal (filtragem de arte/lore) para o cliente.
- **Racional:** separação limpa "build-time vs run-time"; a conversão é revisável
  via diff report antes de publicar; os packs gerados são determinísticos e auditáveis.

### D5 — `foundryvtt-cli` para extração; sem reimplementar leitura de LevelDB

O importer usa o `foundryvtt-cli` (MIT, open-source) com o comando `unpack` para
extrair os packs LevelDB do `foundryvtt/pf2e` em arquivos JSON por documento, com a
opção `omitVolatile` ligada.

- **Rejeitado: reimplementar um leitor de LevelDB.** Trabalho duplicado e frágil; o
  CLI oficial é a ferramenta suportada (`docs/research/02-...md` §11.6).
- **Rejeitado: depender dos JSON já extraídos no diretório `packs/` do repo pf2e.**
  O repo edita via UI e extrai com `pnpm run extractPacks` para JSON
  (`docs/research/10-...md` §9.2); esses JSON existem no repo e são a fonte
  preferencial. **Decisão:** consumir os JSON do diretório `packs/` do repo quando
  presentes; cair para `foundryvtt-cli unpack` de um build LevelDB apenas quando os
  JSON não estiverem disponíveis.
- **Racional:** menor superfície de código; a fonte primária são os JSON
  versionados no repo pf2e (sob Apache-2.0/ORC), legíveis e estáveis.

### D6 — Mapeamento de Rule Elements com **tabela de cobertura** e fallback explícito

O importer traduz cada RE de `system.rules` para um **modifier descriptor** do
Fusion segundo uma **tabela de cobertura** declarativa. REs sem conversor não são
descartados: são preservados em `flags.fusion.unconvertedRules` e o documento é
marcado `flags.fusion.conversion = "partial"`. A spec define o **formato-alvo** e o
**estado por RE**; a semântica de avaliação é de `ver 15-`.

> Nota de alinhamento (M3-D): o data-model real do importer e dos packs usa o
> namespace `flags.fusion.*` para TODOS os metadados de conversão
> (`conversion`, `unconvertedRules`, `assetSubstitutions`, ...), espelhando a
> convenção de `flags` do modelo de documento. Redações anteriores que citavam
> `system.fusion.conversion` referiam-se ao mesmo campo — leia-se
> `flags.fusion.conversion`.

- **Rejeitado: descartar REs não suportados.** Perde dados e impossibilita
  retroconversão quando o conversor evoluir.
- **Rejeitado: tentar suportar 100% dos ~40 REs no MVP.** Inviável; alguns
  (`BattleForm`, `Aura`, `DamageAlteration`) são muito complexos
  (`docs/research/10-...md` §5.3). O MVP cobre o subconjunto de alto valor
  (FlatModifier, AELike, RollOption, GrantItem, Note, etc.).
- **Racional:** progresso incremental mensurável (cobertura é um número no relatório);
  preservação total dos dados de origem; segurança para o GM saber o que está e o
  que não está automatizado.

### D7 — `_id` de origem **preservado** nos packs do sistema (re-import idempotente)

Os `_id` de 16 chars dos documentos do pf2e (`docs/research/10-...md` §4.2) são
**preservados** no pack Fusion (compatíveis com REQ-DOC-001 de `ver 02-`). O importer
é determinístico: mesma versão de origem ⇒ mesmos `_id` e mesmo conteúdo
não-volátil. Ao **importar para o mundo**, gera-se um **novo** `_id` (cópia
independente).

- **Rejeitado: gerar novos `_id` no pack.** Quebraria links `@UUID` que apontam para
  `Compendium.pf2e.<pack>.<Type>.<id>` (`docs/research/10-...md` §9.3) e
  impossibilitaria re-import idempotente e diffs estáveis.
- **Racional:** os `_id` do pf2e cabem no nosso alfabeto/tamanho (a confirmar em Q1);
  preservar `_id` no pack mantém links resilientes e diffs limpos; clonar com novo
  `_id` ao importar para o mundo evita colisão com o pack.

### D8 — Política de assets: nunca importar arte da Paizo; placeholders livres

O importer **não copia** nenhum arquivo de imagem do repo pf2e (arte cedida só ao
ecossistema Foundry — `docs/research/14-...md` §5.4). Para cada referência de arte
(`img`, `system.*.img`, token art), aplica um **mapa de placeholders** para ícones
livres (Game-icons.net CC BY 3.0, Kenney CC0) e registra a substituição.

- **Rejeitado: importar os paths de arte como estão.** Resultaria em paths quebrados
  (a arte não está no Fusion) **e** risco legal se a arte fosse copiada.
- **Rejeitado: deixar `img` nulo.** UI vazia; pior UX que um placeholder temático.
- **Racional:** linha vermelha legal clara (`docs/research/14-...md` §8.1: "Usar arte
  do pf2e/Foundry = risco ALTO"); placeholders temáticos por tipo/trait dão UX
  aceitável; o GM pode trocar por arte própria depois.

### D9 — Versionamento de pack atado à release de origem + `schemaVersion` do importer

Cada `pack.json` registra `source.version` (release do `foundryvtt/pf2e`, ex.:
`v8.2.0`), `importer.version` (versão do `tools/importer-pf2e`) e
`generatedAt`. Um pack só é regenerado quando uma das duas versões muda; o diff
report acompanha o que mudou entre gerações.

- **Rejeitado: versão única "do pack".** Não distingue "mudou o dado de origem" de
  "mudou nossa lógica de conversão" — duas causas com tratamento diferente.
- **Racional:** rastreabilidade dupla (dado vs. conversor); permite re-rodar o
  importer só porque a tabela de cobertura cresceu, mesmo sem nova release do pf2e.

### D10 — Etmos: packs editoriais à mão, mesmo formato, sem importador automático

Os packs do Etmos (`docs/research/10-...md` §11; SRD da Editora Balde Galáctico) são
criados **manualmente** a partir do material-fonte (ex.: 81 Partículas como Items),
em arquivos-fonte JSON/YAML versionados, e empacotados pelo **mesmo** _packer_ de
`tools/importer-pf2e` (estágio de "build de pack"), sem etapa de extração/conversão
de Foundry.

- **Rejeitado: importador automático do Etmos.** Não há sistema Foundry de Etmos de
  onde importar (`docs/research/10-...md` §11); a fonte é texto/SRD.
- **Racional:** reusar o _packer_ (JSON-fonte → `pack.db` + índice + licença) evita
  duplicar pipeline; o trabalho editorial humano produz os JSON-fonte.

## Requisitos funcionais

> Tags: **[MVP]** alinhado à definição de MVP global (jogar uma sessão de PF2e com
> mapa, tokens, visão, fichas funcionais e rolagens básicas — o que exige packs de
> PF2e importados e um browser para trazê-los ao mundo); **[V2]** pós-MVP.

### Formato de pack e armazenamento

- **REQ-CMP-001** [MVP] Um pack DEVE ser um arquivo SQLite `pack.db` com o **mesmo
  schema** de tabelas e índices do `world.db` (`ver 03-persistencia-e-mundos.md`,
  REQ-PER-006/007), contendo Documents de **um único** tipo primário por pack.
- **REQ-CMP-002** [MVP] Packs do **sistema** DEVEM residir em
  `compendiums/<packId>/` (`pack.db` + `pack.json`), e packs criados no **mundo**
  DEVEM residir em `worlds/<slug>/compendiums/<packSlug>/` com formato idêntico.
- **REQ-CMP-003** [MVP] Cada pack DEVE ter um `pack.json` com, no mínimo: `id`
  (`<systemId>.<packSlug>`), `label`, `documentType`, `systemId`, `indexFields`
  (campos extras do índice), `source` (origem, versão, licença, atribuição) e
  `generatedAt`.
- **REQ-CMP-004** [MVP] O `pack.json` DEVE incluir um bloco `license` por pack com:
  `license` (`"ORC" | "OGL-1.0a" | "CC-BY-3.0" | "CC0" | "proprietary" | "custom"`),
  `attribution` (texto), `reservedNotice` (texto), e `sourceRepo`/`sourceVersion`
  quando importado (`ver 26-licencas-e-legal.md`).
- **REQ-CMP-005** [MVP] Quando um documento individual tiver licença distinta da do
  pack (campo `system.publication` preservado da origem), essa licença do documento
  DEVE prevalecer sobre o default do pack na exibição e na propagação de notices.
- **REQ-CMP-006** [MVP] O carregamento de um pack na abertura do servidor DEVE
  construir apenas o **índice** (REQ-CMP-007), nunca os documentos completos, e DEVE
  ser tolerante a pack ausente/corrompido (logar e seguir, sem derrubar o servidor).
- **REQ-CMP-007** [MVP] O **índice** de um pack DEVE conter, por documento, ao menos
  `_id`, `name`, `img`, `type`, o `uuid` de compendium computado, e os campos
  declarados em `pack.json.indexFields`; o índice DEVE ser construível via
  `json_extract` sobre a coluna `data`.
- **REQ-CMP-008** [V2] O índice PODE ser materializado e persistido como tabela
  `pack_index` dentro do `pack.db` (com `PRAGMA user_version` controlando
  invalidação), para acelerar a primeira abertura de packs muito grandes.

### Resolução, UUID e serving

- **REQ-CMP-009** [MVP] Todo documento de pack DEVE ser endereçável pelo UUID de
  compendium `Compendium.<packId>.<DocType>.<docId>` (`ver 02-modelo-de-dados.md`,
  REQ-DOC-003), e `resolveUuid` DEVE carregar o documento completo do `pack.db` sob
  demanda, retornando `null` se o pack ou o id não existir.
- **REQ-CMP-010** [MVP] O servidor DEVE expor uma API de leitura de packs (índice e
  documento completo por id/UUID) consumível pelo compendium browser; a leitura de
  pack NÃO requer transação de escrita.
- **REQ-CMP-011** [MVP] Links inline `@UUID[Compendium.<packId>.<Type>.<id>]{Label}`
  presentes em textos importados (`docs/research/10-...md` §9.3) DEVEM ser
  preservados e resolvíveis; quando o alvo não existir, a UI DEVE degradar para o
  label textual (soft reference, `ver 02-`, D11).

### Compendium browser (UI)

- **REQ-CMP-012** [MVP] O compendium browser DEVE listar os packs disponíveis
  (sistema + mundo) agrupados por `documentType`, exibindo `label`, contagem de
  documentos e a licença do pack.
- **REQ-CMP-013** [MVP] O browser DEVE oferecer **busca textual** por `name` (case e
  acento-insensível, pt-BR/en) sobre o índice, com resultados incrementais.
- **REQ-CMP-014** [MVP] O browser DEVE oferecer **filtros** sobre campos do índice;
  para packs PF2e, no mínimo: **tipo** (subtype do document, ex.: `weapon`/`spell`/
  `feat`), **traits** (`system.traits.value`) e **level/rank**
  (`system.level.value`) — esses campos DEVEM estar em `indexFields`.
- **REQ-CMP-015** [MVP] O browser DEVE oferecer **preview** de um documento
  (carregando o documento completo sob demanda), exibindo nome, imagem
  (placeholder), licença e um resumo dos campos de `system` relevantes ao tipo.
- **REQ-CMP-016** [MVP] O browser DEVE permitir **importar para o mundo** um
  documento (ou seleção múltipla) para a coleção correspondente, com feedback de
  progresso para importações em lote.
- **REQ-CMP-017** [MVP] O browser DEVE permitir **drag-and-drop** de um documento de
  pack: (a) para o **canvas** de uma Scene, criando um `Token` (Actors) ou `Tile`
  (imagens) — `ver 06-canvas-e-renderizacao.md`; (b) para uma **ficha** de Actor,
  adicionando o `Item` à `EmbeddedCollection` `items` do Actor — `ver 11-ui-framework-e-fichas.md`.
- **REQ-CMP-018** [MVP] O drop de um Actor de pack no canvas DEVE primeiro importar o
  Actor para o mundo (REQ-CMP-016) e então criar um `Token` vinculado/desvinculado
  conforme a configuração de `prototypeToken` (`ver 02-`, `ver 06-`).
- **REQ-CMP-019** [V2] O browser PODE oferecer filtros avançados compostos
  (ex.: "feats de level ≤ 3 com trait `rogue`") e salvar presets de filtro por
  usuário.
- **REQ-CMP-020** [V2] O browser PODE permitir importar uma **pasta inteira** ou um
  pack inteiro de uma vez para o mundo.

### Importação para o mundo

- **REQ-CMP-021** [MVP] Importar um documento de pack para o mundo DEVE: (a) clonar
  o `data` do documento; (b) gerar um **novo** `_id` para a cópia de mundo
  (`ver 02-`, REQ-DOC-002); (c) preservar `system` e `flags` (incluindo
  `flags.fusion.*` de conversão); (d) inserir via CRUD normal
  (`ver 03-persistencia-e-mundos.md`).
- **REQ-CMP-022** [MVP] Na importação, referências `@UUID` internas ao **mesmo pack**
  para itens que também forem importados em lote DEVEM ser **remapeadas** para os
  novos `_id` de mundo; referências a documentos não importados DEVEM permanecer como
  UUID de compendium (resolúveis sob demanda).
- **REQ-CMP-023** [MVP] A importação DEVE resolver assets do documento via o mapa de
  placeholders (REQ-CMP-031) — nenhum asset proprietário é trazido — e registrar as
  substituições aplicadas.
- **REQ-CMP-024** [MVP] A importação DEVE propagar a **licença** do documento/pack
  para um registro de procedência do mundo (`ver 26-licencas-e-legal.md`), de modo
  que o mundo possa gerar a lista consolidada de notices/atribuições do conteúdo
  importado.
- **REQ-CMP-025** [MVP] Quando um Item de pack referenciar/contiver outros documentos
  via `GrantItem`/`@UUID` (ex.: uma classe que concede features), a importação do
  item-raiz DEVE, no MVP, importar o item-raiz e **resolver os granted itens sob
  demanda** no runtime do sistema; a importação recursiva automática de toda a árvore
  de grants é **[V2]**.

### Pipeline `tools/importer-pf2e` — extração e transformação

- **REQ-CMP-026** [MVP] O importer DEVE consumir como fonte primária os JSON do
  diretório `packs/` do repositório `foundryvtt/pf2e` (quando presentes) e, como
  fallback, extrair de um build LevelDB via `foundryvtt-cli unpack` com
  `omitVolatile` ligado (`docs/research/02-...md` §11.6, D5).
- **REQ-CMP-027** [MVP] Para cada documento de origem, o importer DEVE aplicar um
  **transformador por `(documentType, subtype)`** que mapeia campo a campo o schema
  pf2e para o schema `system` do Fusion (`ver 17-sistema-pf2e.md`), preservando
  `_id`, `name` e `type`.
- **REQ-CMP-027a** [MVP] O importer DEVE suportar, no mínimo, os subtipos de Item
  necessários ao MVP de PF2e: `weapon`, `armor`, `equipment`, `consumable`, `feat`,
  `action`/`ability`, `spell`, `spellcastingEntry`, `condition`, `effect`, `lore`,
  `melee`; e os subtipos de Actor `character`, `npc`, `hazard`, `loot`
  (`docs/research/10-...md` §3, §4).
- **REQ-CMP-028** [MVP] O importer DEVE **descartar** campos de lore/setting e
  referências de arte proprietária, mantendo apenas mecânica
  (`docs/research/14-...md` §5.3), e DEVE registrar no relatório quais campos foram
  descartados por documento-tipo (agregado, não por documento).
- **REQ-CMP-029** [MVP] O importer DEVE preencher `system.publication`
  (licença/título/remaster) a partir da origem quando presente
  (`docs/research/10-...md` §2.2) e propagar o default de licença para `pack.json`
  (REQ-CMP-004).
- **REQ-CMP-030** [MVP] O importer DEVE produzir, por pack, `pack.db` + `pack.json` +
  o índice, e DEVE realizar a escrita do `pack.db` em arquivo temporário seguido de
  **swap atômico** (rename) sobre o pack anterior, garantindo que leituras
  concorrentes nunca vejam um pack parcial.

### Pipeline — assets e placeholders

- **REQ-CMP-031** [MVP] O importer DEVE substituir toda referência de arte por um
  **placeholder livre** segundo o **mapa de placeholders** versionado
  `packages/shared/src/assets/placeholders.map.json` (formato e catálogo definidos
  em `20-assets-e-midia.md` REQ-AST-048/049/050 — a spec 20 armazena/serve o
  catálogo; este importer apenas o consome), priorizando ícone por (subtype, trait
  principal) e caindo para um placeholder genérico por `documentType`
  (`docs/research/90-...md` §9.4: placeholder visual claro).
- **REQ-CMP-032** [MVP] O importer NÃO DEVE copiar nenhum arquivo binário de imagem
  do repositório `foundryvtt/pf2e`; apenas paths para placeholders livres (já
  presentes no bundle do Fusion) DEVEM aparecer nos campos de arte
  (`docs/research/14-...md` §5.4, D8).
- **REQ-CMP-033** [MVP] O importer DEVE emitir no relatório o **manifesto de
  placeholders**: a contagem de substituições de arte por tipo e a lista de
  traits/subtypes sem placeholder específico (caíram no genérico). Este manifesto é
  o artefato de handoff para a curadoria de ícones livres do catálogo da spec 20
  (`ver 20-assets-e-midia.md` REQ-AST-048; a 20 armazena/serve, a 16 — este importer
  — gera o manifesto do que falta).

### Pipeline — mapeamento de Rule Elements (motor de modifiers)

- **REQ-CMP-034** [MVP] O importer DEVE traduzir cada RE de `system.rules` para um
  **modifier descriptor** do Fusion conforme a **tabela de cobertura**
  (REQ-CMP-035), preservando `slug`, `label`, `predicate` e `priority` quando
  aplicável.
- **REQ-CMP-035** [MVP] DEVE existir uma **tabela de cobertura** declarativa que, para
  cada `RE.key`, indique o estado `supported | partial | unsupported` e o conversor
  associado. O MVP DEVE cobrir como `supported`, no mínimo: **FlatModifier**,
  **AELike** (modos add/subtract/multiply/upgrade/downgrade/override — `subtract` é
  equivalente a `add` com valor negativo, mas DEVE ser mapeado explicitamente, não
  silenciado), **RollOption**, **GrantItem**, **RollNote**, **Sense**, **BaseSpeed**,
  **TempHP**, **MartialProficiency** (`docs/research/10-...md` §5.3).
- **REQ-CMP-036** [MVP] Para REs marcados `unsupported` (ou `partial` no que não
  cobrirem), o importer DEVE preservar o RE original em
  `flags.fusion.unconvertedRules` (array) e marcar
  `flags.fusion.conversion = "partial"` no documento, **sem descartar** dados (D6).
  (Data-model real: o campo vive em `flags.fusion.conversion`, não em
  `system.fusion.*` — ver nota de alinhamento em §D6.)
- **REQ-CMP-037** [MVP] O importer DEVE suportar as **expressões de valor** dos REs
  (`@actor.level`, `floor(...)`, `ternary(...)`, `match/when(...)` —
  `docs/research/10-...md` §5.5), traduzindo-as para a sintaxe de roll data do Fusion
  (`@atributos`, `ver 08-motor-de-rolagens.md`); expressões não parseáveis DEVEM
  cair no fallback `partial` (REQ-CMP-036) em vez de gerar valor incorreto.
- **REQ-CMP-038** [MVP] O importer DEVE computar e reportar a **cobertura de REs**:
  total de REs por `key`, quantos convertidos integralmente, parcialmente e não
  suportados, em nível de pack e agregado.
- **REQ-CMP-039** [V2] A tabela de cobertura PODE ser estendida para REs complexos
  (`Aura`, `BattleForm`, `DamageAlteration`, `IWR`, `AdjustModifier`,
  `Strike`/`AdjustStrike`), promovendo-os de `unsupported`/`partial` para `supported`
  conforme o motor de modifiers evoluir (`ver 15-`).

### Pipeline — versionamento, idempotência e relatório

- **REQ-CMP-040** [MVP] O importer DEVE registrar em `pack.json`: `source.repo`,
  `source.version` (release do pf2e), `importer.version` e `generatedAt` (D9).
- **REQ-CMP-041** [MVP] O importer DEVE ser **idempotente**: dada a mesma
  `source.version` e a mesma `importer.version`, reexecutar produz packs com os
  mesmos `_id` e o mesmo conteúdo não-volátil (mesma ordenação determinística de
  documentos e de campos no JSON serializado).
- **REQ-CMP-042** [MVP] O importer DEVE gerar um **relatório de diferenças** (diff
  report) comparando a geração atual com a anterior (quando existir), listando, por
  pack: documentos **adicionados**, **removidos**, **alterados** (com a lista de
  caminhos de campo que mudaram), e a variação de cobertura de REs.
- **REQ-CMP-043** [MVP] O relatório DEVE ser emitido em formato legível por humano
  (Markdown) e em formato estruturado (JSON) para CI; o JSON DEVE permitir falhar o
  build se a cobertura de REs **regredir** abaixo de um limiar configurável.
- **REQ-CMP-044** [MVP] O importer DEVE validar cada documento produzido contra o
  schema Zod de engine + `system` do Fusion (`ver 02-`, REQ-DOC-014) antes de gravá-lo
  no `pack.db`; documentos inválidos DEVEM ser **excluídos** do pack e listados no
  relatório, sem abortar o pack inteiro.
- **REQ-CMP-045** [V2] O importer PODE suportar **migração entre versões de origem**
  (ex.: pf2e v8.2.0 → v8.3.0) reaproveitando o diff report para destacar mudanças
  mecânicas relevantes ao GM (changelog de conteúdo).

### Packs do Etmos (editorial)

- **REQ-CMP-046** [MVP] O Fusion DEVE suportar **packs Etmos** construídos a partir
  de **arquivos-fonte** JSON/YAML versionados (não importados de Foundry),
  empacotados pelo mesmo _packer_ que gera `pack.db` + `pack.json` + índice (D10).
- **REQ-CMP-047** [MVP] O pack `etmos.particles` DEVE conter as **81 Partículas**
  como Documents `Item` do subtype apropriado do sistema Etmos
  (`ver 19-sistema-etmos.md`), cada uma com sua mecânica e `pack.json.license`
  apontando para o SRD da Editora Balde Galáctico (`ver 26-licencas-e-legal.md`).
- **REQ-CMP-048** [MVP] O _packer_ DEVE validar os arquivos-fonte do Etmos contra os
  schemas `system` do Etmos antes de empacotar, com as mesmas garantias de
  idempotência e índice dos packs importados.

## Requisitos não-funcionais

- **REQ-CMP-049** [MVP] Construir o índice de um pack grande (~5.200 documentos, ex.:
  equipment do pf2e — `docs/research/10-...md` §9.1) DEVE completar em < 1,5 s na
  abertura, e a busca textual incremental sobre esse índice DEVE responder em < 100 ms
  por tecla (alvo, a verificar em `ver 25-testes-e-qualidade.md`).
- **REQ-CMP-050** [MVP] O preview/carregamento de um documento completo a partir do
  índice (lookup por `_id` no `pack.db`) DEVE completar em < 20 ms (P99), excluindo
  rede.
- **REQ-CMP-051** [MVP] A abertura do servidor com todos os packs do sistema PF2e
  carregados (apenas índices) DEVE adicionar < 3 s ao tempo de inicialização e manter
  o uso de memória dos índices proporcional (alvo: < 200 MB para o conjunto completo
  de packs PF2e do MVP).
- **REQ-CMP-052** [MVP] O importer DEVE ser **determinístico** quanto à ordenação de
  documentos e de chaves no JSON serializado, de modo que o diff report reflita
  apenas mudanças de conteúdo reais (não ruído de ordenação) — pré-condição de
  REQ-CMP-041/042.
- **REQ-CMP-053** [MVP] O importer e o _packer_ DEVEM rodar em CI (Node.js 22+) sem
  acesso a serviços externos além do código-fonte do pf2e fornecido; nenhum segredo
  ou rede é necessário para gerar packs.
- **REQ-CMP-054** [MVP] Todos os tipos, schemas de `pack.json` e contratos de leitura
  de pack DEVEM residir em `packages/shared`, importáveis por `server`, `client` e
  `tools/importer-pf2e` sem duplicação.

## Modelo de dados

> Interfaces TypeScript ilustrativas (canônicas como Zod em `packages/shared`).
> `Json` denota valor serializável em JSON. Reusa tipos de `ver 02-` (`DocumentId`,
> `Uuid`) e o schema de tabelas de `ver 03-`.

### Manifesto de pack (`pack.json`)

```ts
export type LicenseKind = "ORC" | "OGL-1.0a" | "CC-BY-3.0" | "CC0" | "proprietary" | "custom";

export interface PackLicense {
  license: LicenseKind;
  attribution: string; // texto de atribuição (autores upstream)
  reservedNotice: string; // Reserved Material notice (Paizo etc.)
  sourceRepo?: string; // ex.: "github.com/foundryvtt/pf2e"
  sourceVersion?: string; // ex.: "v8.2.0"
}

export interface PackSource {
  repo: string | null; // null para packs editoriais (Etmos)
  version: string | null; // release de origem
  importerVersion: string; // versão de tools/importer-pf2e
}

export interface PackManifest {
  id: string; // "<systemId>.<packSlug>", ex.: "pf2e.bestiary-1"
  label: string; // rótulo exibido
  documentType: // tipo primário contido (um por pack)
    "Actor" | "Item" | "JournalEntry" | "RollTable" | "Macro" | "Scene" | "Playlist";
  systemId: string; // "pf2e" | "sf2e" | "etmos"
  indexFields: string[]; // caminhos extras p/ o índice (ex.: "system.level.value")
  license: PackLicense;
  source: PackSource;
  documentCount: number;
  generatedAt: string; // ISO 8601
  schemaVersion: number; // versão do schema de pack (engine)
}
```

### Entrada de índice

```ts
export interface PackIndexEntry {
  _id: DocumentId;
  uuid: Uuid; // "Compendium.<packId>.<DocType>.<docId>"
  name: string;
  img: string | null; // já mapeado para placeholder livre
  type: string | null; // subtype do document (ex.: "weapon")
  // campos declarados em PackManifest.indexFields, achatados:
  index: Record<string, Json>; // ex.: { "system.level.value": 3, "system.traits.value": ["fire"] }
}

export interface PackIndex {
  packId: string;
  entries: PackIndexEntry[];
}
```

### Marcadores de conversão no documento importado

```ts
/** Anexado em flags.fusion ao importar de pf2e. */
export interface FusionConversionFlags {
  conversion: "full" | "partial"; // "partial" se houve RE não convertido
  importerVersion: string;
  sourceVersion: string;
  unconvertedRules: Json[]; // REs originais preservados (D6)
  assetSubstitutions: Array<{ field: string; original: string; placeholder: string }>;
}
```

### Tabela de cobertura de Rule Elements

```ts
export type RuleCoverageState = "supported" | "partial" | "unsupported";

export interface RuleCoverageEntry {
  key: string; // RE.key do pf2e, ex.: "FlatModifier"
  state: RuleCoverageState;
  /** nome do conversor no importer; null se unsupported */
  converter: string | null;
  notes?: string; // limitações conhecidas (para "partial")
}

/** A tabela completa vive em tools/importer-pf2e; este é o contrato. */
export type RuleCoverageTable = Record<string /*RE.key*/, RuleCoverageEntry>;
```

### Modifier descriptor (formato-alvo; semântica em `ver 15-`)

```ts
/** Destino do mapeamento de Rule Elements. Avaliação: ver 08-/15-. */
export interface ModifierDescriptor {
  kind: // categoria do efeito convertido
    | "flat-modifier" // ← FlatModifier
    | "set-property" // ← AELike (add/subtract/multiply/upgrade/downgrade/override)
    | "roll-option" // ← RollOption
    | "grant-item" // ← GrantItem
    | "roll-note" // ← RollNote
    | "sense" // ← Sense
    | "base-speed" // ← BaseSpeed
    | "temp-hp" // ← TempHP
    | "proficiency"; // ← MartialProficiency
  slug: string | null;
  label: string | null;
  selector?: string | string[]; // domínio/seletor de roll (ex.: "ac", "attack-roll")
  value?: string | number; // valor ou expressão (@atributos) — ver 08-
  mode?: "add" | "subtract" | "multiply" | "upgrade" | "downgrade" | "override" | "custom";
  predicate?: Json; // condição (traduzida do predicate pf2e)
  priority?: number;
  raw?: Json; // RE de origem (auditoria)
}
```

### Relatório de diferenças (diff report)

```ts
export interface PackDiff {
  packId: string;
  added: DocumentId[];
  removed: DocumentId[];
  changed: Array<{ _id: DocumentId; changedPaths: string[] }>;
  invalidExcluded: Array<{ _id: DocumentId; reason: string }>;
  ruleCoverage: {
    totalRules: number;
    byState: Record<RuleCoverageState, number>;
    byKey: Record<string, { total: number; state: RuleCoverageState }>;
    /** delta vs. geração anterior (negativo = regressão) */
    coverageDelta: number;
  };
  assetSubstitutions: number;
  droppedFieldKinds: string[]; // ex.: ["lore-text", "paizo-art"]
}

export interface ImportReport {
  importerVersion: string;
  sourceVersion: string;
  generatedAt: string;
  packs: PackDiff[];
  /** falha o build se true (regressão de cobertura abaixo do limiar) */
  failed: boolean;
}
```

## API e eventos

### Leitura de packs (servidor → browser)

```ts
// Listagem e índice (lazy)
listPacks(filter?: { systemId?: string; documentType?: string }): PackManifest[];
getPackIndex(packId: string): PackIndex;                 // só o índice
searchPack(packId: string, query: {
  text?: string;
  filters?: Record<string /*indexField*/, Json>;         // ex.: { "system.level.value": { lte: 3 } }
}): PackIndexEntry[];

// Documento completo sob demanda
getPackDocument(uuid: Uuid): Promise<Json | null>;       // resolve Compendium.<...>

// Importar para o mundo (CRUD via ver 03-)
importToWorld(uuids: Uuid[], options?: {
  folderId?: DocumentId;
  remapInternalLinks?: boolean;   // default true (REQ-CMP-022)
}): Promise<{ created: DocumentId[]; provenance: PackLicense[] }>;
```

### CLI do importer (`tools/importer-pf2e`)

```text
importer-pf2e build
  --source <path>            # diretório do repo foundryvtt/pf2e (packs/ ou build LevelDB)
  --source-version <ver>     # ex.: v8.2.0
  --out <dir>                # destino dos pack.db + pack.json
  --packs <glob>             # subconjunto de packs a gerar (default: todos do MVP)
  --report <path>            # caminho do diff report (md + json)
  --fail-on-coverage-regression   # falha CI se cobertura de REs regredir
  --placeholders <map>       # mapa de placeholders livres

importer-pf2e coverage       # imprime a tabela de cobertura de REs atual
packer build                 # empacota arquivos-fonte (Etmos) → pack.db (REQ-CMP-046)
```

### Eventos

| Evento (servidor)     | Quando                                   | Consumidor                   |
| --------------------- | ---------------------------------------- | ---------------------------- |
| `pack:loaded`         | índice de um pack construído na abertura | telemetria, browser          |
| `pack:load-failed`    | pack ausente/corrompido (tolerado)       | log, browser                 |
| `compendium:imported` | documentos importados para o mundo       | sync (`ver 04-`), provenance |

> Eventos de UI do browser (abrir, filtrar, drag) são locais ao cliente
> (`ver 11-ui-framework-e-fichas.md`). A criação de Documents resultante da
> importação dispara os hooks CRUD normais (`ver 02-`, REQ-DOC-039).

## Dependências (specs irmãs)

- `02-modelo-de-dados.md` — `_id`/UUID de compendium, soft references, CRUD,
  `flags.fusion.*`, validação Zod de documentos importados.
- `03-persistencia-e-mundos.md` — schema SQLite reusado para `pack.db`, swap atômico
  de arquivo, layout `compendiums/` e `worlds/<slug>/compendiums/`.
- `04-rede-e-sincronizacao.md` — broadcast da criação de Documents ao importar para o
  mundo.
- `06-canvas-e-renderizacao.md` — criação de Token/Tile no drop de pack no canvas;
  `prototypeToken`.
- `08-motor-de-rolagens.md` — sintaxe de roll data (`@atributos`) alvo das expressões
  de valor dos REs; inline rolls (`@Check`, `@Damage`, `@Template`).
- `11-ui-framework-e-fichas.md` — host do compendium browser; drop de Item em ficha.
- `15-api-de-sistemas.md` — registro de transformadores por `(documentType, subtype)`,
  schemas `system`, e a **semântica de avaliação** dos modifier descriptors.
- `17-sistema-pf2e.md` — forma final dos schemas `system` que o importer popula;
  conjunto de subtipos suportados.
- `18-sistema-sf2e.md` — SF2e compartilha a codebase pf2e (`docs/research/10-...md`
  §11); o importer é parametrizável para gerar packs `sf2e.*` [V2 quanto a packs
  próprios].
- `19-sistema-etmos.md` — schemas `system` do Etmos; conteúdo das 81 Partículas.
- `20-assets-e-midia.md` — catálogo de placeholders livres, serving de imagens,
  tratamento de assets faltantes.
- `25-testes-e-qualidade.md` — testes de idempotência do importer, snapshot do diff
  report, metas de performance de índice/busca.
- `26-licencas-e-legal.md` — texto dos notices ORC/OGL/CUP, regra de arte
  proprietária, atribuição consolidada no mundo.

## Critérios de aceitação

- **CA-CMP-01** Um pack `pf2e.equipment` gerado pelo importer abre como SQLite válido
  com o schema de `ver 03-`, e o servidor constrói seu índice (~5.200 entradas) na
  abertura sem carregar os documentos completos (REQ-CMP-001, 006, 007, 049).
- **CA-CMP-02** `resolveUuid("Compendium.pf2e.equipment.Item.<id>")` retorna o
  documento completo do `pack.db`; um id inexistente retorna `null` (REQ-CMP-009).
- **CA-CMP-03** O compendium browser lista os packs com licença, busca por nome
  (acento-insensível) e filtra um pack de feats por `system.level.value ≤ 3` e trait
  `rogue` usando apenas o índice (REQ-CMP-012..014).
- **CA-CMP-04** Arrastar um Actor de `pf2e.bestiary-1` para o canvas importa o Actor
  para o mundo (novo `_id`) e cria um Token na Scene; arrastar um Item para uma ficha
  adiciona-o aos `items` do Actor (REQ-CMP-017, 018, 021).
- **CA-CMP-05** Importar 3 itens de um mesmo pack que se referenciam via `@UUID`
  remapeia os links internos para os novos `_id` de mundo; um link para um item não
  importado permanece como UUID de compendium e ainda resolve (REQ-CMP-022, 011).
- **CA-CMP-06** Nenhum arquivo de imagem do repo `foundryvtt/pf2e` é copiado pelo
  importer; todo campo de arte aponta para um placeholder livre presente no bundle, e
  as substituições são listadas no relatório (REQ-CMP-031, 032, 033, D8).
- **CA-CMP-07** Um feat com `system.rules` contendo um `FlatModifier` produz um
  `ModifierDescriptor` `flat-modifier` com `selector`/`value`/`predicate`; um RE de
  `key` `Aura` (unsupported no MVP) é preservado em `flags.fusion.unconvertedRules` e
  o documento é marcado `conversion: "partial"` (REQ-CMP-034..036, D6).
- **CA-CMP-08** Uma expressão de valor `floor(@actor.level / 2)` é traduzida para a
  sintaxe de roll data do Fusion; uma expressão não parseável faz o RE cair em
  `partial` sem gerar valor incorreto (REQ-CMP-037).
- **CA-CMP-09** Rodar o importer duas vezes sobre a mesma `source.version` e
  `importer.version` produz `pack.db` com os mesmos `_id` e JSON não-volátil
  idêntico; o diff report da segunda execução acusa zero documentos
  adicionados/removidos/alterados (REQ-CMP-041, 042, 052).
- **CA-CMP-10** Após uma nova `source.version`, o diff report lista por pack os
  documentos adicionados/removidos/alterados (com caminhos de campo) e a variação de
  cobertura de REs; o build falha se a cobertura regredir abaixo do limiar
  (REQ-CMP-042, 043).
- **CA-CMP-11** Um documento importado que falhe a validação Zod (engine + `system`) é
  excluído do `pack.db` e listado em `invalidExcluded` do relatório, sem abortar o
  pack (REQ-CMP-044).
- **CA-CMP-12** O pack `etmos.particles` é construído a partir de arquivos-fonte
  JSON/YAML (sem extração de Foundry), contém as 81 Partículas como Items válidos
  contra o schema Etmos, com `pack.json.license` referenciando o SRD da Editora Balde
  Galáctico (REQ-CMP-046, 047, 048, D10).
- **CA-CMP-13** Cada `pack.json` carrega o bloco `license` por pack e
  `source.version`/`importer.version`; um documento com `system.publication` OGL num
  pack ORC tem sua licença individual exibida no browser (REQ-CMP-003, 004, 005, 040).

## Questões em aberto

- **Q1 — Compatibilidade de `_id` importado.** Confirmar que **todos** os `_id` dos
  JSON do `foundryvtt/pf2e` cabem no alfabeto/tamanho de `ver 02-` (REQ-DOC-001).
  Caso algum não caiba, definir política de remapeamento estável e o impacto em links
  `@UUID` (coordena com `ver 02-`, Q6).
- **Q2 — Importação recursiva de grants.** Itens que concedem outros
  (`GrantItem`, classes que dão features) — importar a árvore inteira no MVP ou
  resolver granted sob demanda no runtime? Esta spec adota "sob demanda" no MVP
  (REQ-CMP-025); validar com `ver 15-`/`ver 17-` se há casos que quebram fichas sem a
  árvore completa.
- **Q3 — Granularidade do índice persistido.** Materializar `pack_index` no `pack.db`
  (REQ-CMP-008, [V2]) vale a complexidade de invalidação, ou o índice em memória basta
  para a escala do MVP? Medir em `ver 25-`.
- **Q4 — Limiar de regressão de cobertura.** Qual o valor default do
  `--fail-on-coverage-regression` (zero tolerância vs. margem)? Definir com o roadmap
  de REs (coordenar com `ver 00-visao-e-escopo.md` e `ver 25-testes-e-qualidade.md`).
- **Q5 — SF2e: packs próprios vs. parametrização.** SF2e compartilha codebase pf2e
  (`docs/research/10-...md` §11). Geramos packs `sf2e.*` com o mesmo importer
  parametrizado, ou SF2e entra só em V2? Coordenar com `ver 18-`.
- **Q6 — Curadoria de placeholders.** Quantos placeholders temáticos por trait/subtype
  curar antes do cair-no-genérico ser aceitável de UX? Depende do catálogo livre
  escolhido em `ver 20-`/`ver 26-`.
- **Q7 — Atualização de packs já importados no mundo.** Quando um pack do sistema é
  re-importado (nova `source.version`), como (ou se) propagar mudanças para documentos
  **já copiados** para mundos existentes? No MVP a cópia de mundo é independente e não
  é atualizada automaticamente; avaliar um fluxo de "atualizar do compendium" em
  `ver 15-`.
- **Q8 — Lore mecânica vs. setting.** A fronteira entre "texto de regra mecânica"
  (importável) e "lore de setting" (Reserved Material) nem sempre é nítida em
  descrições de feats/spells (`docs/research/14-...md` §5.3). Definir heurística de
  filtragem e revisão editorial com `ver 26-`.

## Referências

- `docs/research/02-foundry-documentos-persistencia.md` — §12 (Compendium Packs:
  índice lazy, UUID `Compendium.<...>`, export/import), §11.6 (`foundryvtt-cli`
  unpack/pack, `omitVolatile`).
- `docs/research/10-pf2e-sistema-internals.md` — §2 (licenças do conteúdo,
  `publication`), §3–§4 (tipos de Actor/Item e campos), §5 (Rule Elements: tabela
  completa, seletores, expressões de valor), §9 (escala dos packs, `extractPacks`,
  links `@UUID`), §11 (SF2e/Etmos).
- `docs/research/14-licencas-legal.md` — §2 (ORC), §3 (OGL), §5 (o que pode ser
  extraído do repo pf2e; arte como linha vermelha), §10–§11 (obrigações de notice e
  decisões arquiteturais: separação conteúdo/código, licença por pack).
- `docs/research/90-asset-media-management.md` — §6 (referência de paths em
  Documents), §9.4 (tratamento de assets faltantes: placeholder visual claro),
  §7 (otimização/placeholders).
- Stack fixada do Fusion (TypeScript estrito, Node.js 22+, monorepo pnpm,
  better-sqlite3) e `foundryvtt-cli` (MIT) — `ver 00-`, `01-`, `03-`.
