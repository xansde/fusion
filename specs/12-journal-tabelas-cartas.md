# 12 — Journal, Tabelas e Cartas

**Status:** draft v0.1
**Data:** 2026-06-11

**Baseada em:**
- `docs/research/09-foundry-funcionalidades-mesa.md` — seções 2 (Journals), 3 (Roll Tables), 5 (Cards)

---

## Objetivo

Especificar o subsistema de **conteúdo documental** do Fusion: entradas de journal multi-página com editor rico, compartilhamento seletivo com jogadores, blocos secretos e links @UUID; tabelas aleatórias com draw com/sem replacement e suporte a aninhamento; modelo conceitual de decks de cartas; e busca global de conteúdo na sidebar. Esses recursos são a infraestrutura de documentação e geração procedural que suporta todos os sistemas de jogo.

---

## Escopo

### Inclui

- `JournalEntry` como document de primeiro nível com coleção embedded de `JournalEntryPage`
- Tipos de página: **Text** (TipTap/ProseMirror), **Image**, **Video embed**
- Autosave e edição colaborativa em tempo real via socket.io
- Table of Contents (TOC) gerada por níveis de página
- Permissões por entry e por página (None / Limited / Observer / Owner)
- "Mostrar aos jogadores" — abertura forçada de entry/página no cliente de jogadores
- `SecretBlock` — bloco de conteúdo visível apenas ao GM e Owner; revelação persistida por página
- Links `@UUID` entre todos os documents do mundo; render como chip clicável com estado *broken*
- `RollTable` com `TableResult` embedded; tipos Text, Document, Compendium
- Draw com e sem replacement; pesos; normalização automática de fórmula
- Tabelas aninhadas (resultado Document apontando para outra RollTable)
- Rolagem de tabela diretamente do chat (`/table NomeDaTabela`)
- Busca global de conteúdo (journal, actors, items, tabelas) na sidebar
- Modelo conceitual de Cards/Decks marcado como [V2]
- Backlinks entre documents marcados como [V2]
- Tipo de página PDF marcado como [V2]

### Não inclui

- Implementação completa de Cards/Decks (ver modelo conceitual [V2])
- Plugin de edição colaborativa CRDT externo (autosave por socket é suficiente para MVP)
- Calendário de mundo (fora do escopo deste documento — candidato a spec futura)
- Map Notes / pins de journal em cenas (ver `06-canvas-e-renderizacao.md`)
- Macros embutidas em journals (ver `14-macros-e-automacao.md`)
- Enriquecedores de inline roll em texto de journal (ver `08-motor-de-rolagens.md`)

---

## Conceitos e Terminologia

| Termo | Definição |
|---|---|
| `JournalEntry` | Document de primeiro nível; container de páginas, permissões e metadados |
| `JournalEntryPage` | Document embedded em `JournalEntry`; unidade de conteúdo individual |
| `SecretBlock` | Bloco ProseMirror/TipTap com visibilidade restrita ao GM e Owner; revelação persistida |
| `@UUID link` | Referência a qualquer document do mundo pela sua UUID canônica; renderizada como chip clicável |
| Broken link | @UUID que aponta para UUID não encontrada no mundo ou compendium ativo |
| TOC | Table of Contents gerada automaticamente a partir dos níveis de página |
| `RollTable` | Document de primeiro nível; tabela de resultados indexados por range numérico |
| `TableResult` | Document embedded em `RollTable`; um resultado possível com range, peso e tipo |
| Draw with replacement | Rolagem onde todos os resultados permanecem disponíveis a cada draw |
| Draw without replacement | Rolagem onde cada resultado sorteado é marcado `drawn: true` e excluído até reset |
| Nested table | `TableResult` do tipo Document apontando para outra `RollTable`; a sub-tabela é rolada automaticamente |
| `CardStack` | Document base para Deck, Hand e Pile [V2] |
| `Card` | Document embedded em `CardStack`; possui faces, verso, suit e value [V2] |
| Backlink | Referência reversa: document B sabe que document A o referencia via @UUID [V2] |

---

## Decisões

### D-JRN-01: Editor de texto — TipTap (ProseMirror)

**Decisão:** Usar TipTap v2 (wrapper sobre ProseMirror) como editor rico de texto para páginas de journal.

**Alternativas rejeitadas:**
- Editor ProseMirror direto: TipTap oferece extensibilidade via extension API sem necessidade de gerenciar ProseMirror schemas manualmente.
- Quill.js / Slate.js: menor ecossistema e menor alinhamento com o modelo de document ProseMirror necessário para @UUID enrichers e secret blocks.
- CodeMirror: adequado para código, não para rich text com imagens e tabelas.
- Markdown puro: perda de expressividade (formatação inline, imagens embutidas, tabelas, blocos secretos).

**Racional:** TipTap permite criação de extensões customizadas (SecretBlock, UUIDChip) como nós ProseMirror de primeira classe; autosave via `onUpdate` callback; e integração com Svelte 5.

### D-JRN-02: Colaboração em tempo real — autosave por socket sem CRDT

**Decisão:** Autosave a cada 30 segundos (ou ao fechar o editor) enviando o documento inteiro via `document:update`. Sem CRDT (Yjs/Automerge) no MVP.

**Alternativas rejeitadas:**
- Yjs com provider socket.io: implementação correta de CRDT distribui complexidade significativa (awareness, merges, persistência de histórico). Reservar para V2.
- Autosave polling a cada N segundos com diff: mais complexo que simplesmente enviar o JSON do documento.

**Racional:** Para grupos locais (LAN) com editores únicos por página, conflitos simultâneos são raros. Autosave simples é suficiente para MVP. Quando dois usuários editam a mesma página, o último a salvar vence — comportamento documentado e aceitável.

### D-JRN-03: SecretBlock — visibilidade persistida no servidor

**Decisão:** O estado `revealed: boolean` de cada `SecretBlock` é persistido no documento (não apenas na sessão). O servidor é autoritativo; clientes filtram o conteúdo secreto antes de enviar a jogadores sem permissão Owner.

**Alternativas rejeitadas:**
- Revelação apenas por sessão (volátil): inaceitável — GM não deveria precisar re-revelar a cada sessão.
- Filtro apenas no cliente: inseguro — dados secretos chegariam ao cliente do jogador.

**Racional:** Consistente com o princípio de servidor autoritativo (ver `04-rede-e-sincronizacao.md`). O servidor serializa o HTML/JSON da página filtrando blocos secretos não revelados antes de enviar ao jogador.

### D-JRN-04: @UUID links — sintaxe e resolução

**Decisão:** Sintaxe `@UUID[TipoDoc.id]{Label}` no texto fonte; resolvida em tempo de render pelo TipTap extension `UUIDEnricher`. No servidor, a validação de UUIDs ocorre ao salvar (broken links são marcados mas não bloqueiam o save).

**Alternativas rejeitadas:**
- Links por nome (`@Actor[Nome]`): frágeis a renomeações; UUID é imutável.
- Links resolvidos apenas no cliente: inconsistência com SSR futuro e exportação de journal.

**Racional:** UUID canônica garante links duráveis. O enricher resolve assincrona­mente consultando o store local de documents; se não encontrar, renderiza o chip em estado *broken* com ícone visual distinto.

### D-JRN-05: Tipos de página de journal

**Decisão:** MVP entrega Text, Image e Video embed. PDF é [V2].

**Alternativas rejeitadas:**
- PDF no MVP: renderização de PDF (pdf.js) adiciona ~800KB ao bundle e complexidade de testes. PDFs com formulários têm comportamento imprevisível (conforme observado no Foundry).

**Racional:** Os três tipos cobrem >95% dos casos de uso de sessão. PDF é funcionalidade de worldbuilding avançada.

### D-JRN-06: RollTable — fórmula e normalização automática

**Decisão:** A `RollTable` armazena a fórmula de dados (`formula`) explicitamente. O endpoint de normalização (`POST /api/tables/:id/normalize`) recalcula a fórmula baseado nos pesos somados dos resultados (`1dN` onde N = soma dos pesos).

**Alternativas rejeitadas:**
- Fórmula sempre derivada dinamicamente: inflexível para tabelas com fórmulas customizadas (ex.: `2d6`).
- Sem normalização: usabilidade ruim — GM precisaria calcular ranges manualmente.

**Racional:** Permite flexibilidade máxima (fórmula customizada) com conveniência (normalização automática quando pesos são alterados).

### D-JRN-07: Draw sem replacement — estado `drawn` no documento

**Decisão:** `TableResult` tem campo `drawn: boolean`. Ao sortear sem replacement, o servidor persiste `drawn: true` no resultado sorteado. `RollTable#reset()` zera todos os `drawn: false`.

**Alternativas rejeitadas:**
- Manter estado drawn em memória: perdido ao reiniciar o servidor.
- Lista separada de drawn IDs na tabela pai: redundante com flag no próprio resultado.

**Racional:** Simples e auditável. Persistência garante que o estado de um baralho (ex.: cartas de deck de eventos) sobreviva a reinicializações.

### D-JRN-08: Cards/Decks — modelo [V2]

**Decisão:** Implementar o modelo conceitual de `CardStack` (Deck/Hand/Pile) e `Card` apenas como tipos de dados no `packages/shared`; UI e lógica completas são [V2].

**Alternativas rejeitadas:**
- Omitir completamente do schema: dificultaria migração futura (documents do mundo precisariam ser re-tipados).
- Implementar no MVP: fora da definição de MVP global (sessão de PF2e com mapa, tokens, fichas, rolagens e chat).

**Racional:** Prototipagem de schema agora evita breaking changes no modelo de dados quando V2 for implementado.

### D-JRN-09: Busca global — índice em memória com fallback SQL

**Decisão:** Manter um índice em memória de `{ id, type, name, text }` para todos os documents do mundo carregado no boot do servidor. Busca via substring case-insensitive. Para mundos grandes (>10.000 documents), fallback para FTS5 do SQLite.

**Alternativas rejeitadas:**
- Elasticsearch/Meilisearch: dependência externa desproporcional para uso local/LAN.
- Busca full-text somente via SQLite FTS5 sem cache em memória: latência de I/O inaceitável para digitação em tempo real.

**Racional:** Mundos típicos têm centenas a poucos milhares de documents. Cache em memória com debounce de 200ms no cliente entrega resposta percebida como instantânea.

### D-JRN-10: Backlinks — [V2]

**Decisão:** Rastreamento de backlinks (quais documents referenciam um dado UUID) é [V2].

**Racional:** Requer índice invertido mantido a cada save de document. Complexidade não justificada para MVP.

---

## Requisitos Funcionais

### Journal

**REQ-JRN-001** [MVP] O sistema deve suportar a criação de `JournalEntry` com nome, permissões e coleção de páginas, persistida como document de primeiro nível no `world.db`.

**REQ-JRN-002** [MVP] Cada `JournalEntry` deve suportar uma ou mais `JournalEntryPage` do tipo `text`, `image` ou `video`. Cada página tem `name`, `type`, `tocLevel` (1–6), `sort` (ordem) e `content` (JSON do documento TipTap ou URL).

**REQ-JRN-003** [MVP] O editor de texto (TipTap) deve suportar: negrito, itálico, sublinhado, tachado, títulos H1–H4, listas ordenadas/não-ordenadas, tabelas, links externos, imagens inline (upload ou URL), separadores horizontais e blocos de citação.

**REQ-JRN-004** [MVP] O editor deve realizar autosave a cada 30 segundos de inatividade após última modificação, e ao perder foco ou fechar a janela de journal.

**REQ-JRN-005** [MVP] O sistema deve gerar automaticamente um Table of Contents lateral baseado em `tocLevel` e `sort` das páginas da entry, com navegação clicável entre páginas.

**REQ-JRN-006** [MVP] Páginas do tipo `image` devem exibir uma imagem referenciada por URL ou path de asset local, com legenda opcional.

**REQ-JRN-007** [MVP] Páginas do tipo `video` devem suportar embed de URL de vídeo (YouTube, Vimeo, URL direta de arquivo de vídeo). O player é embutido via `<iframe>` ou `<video>` conforme o tipo de URL detectado.

**REQ-JRN-008** [V2] Páginas do tipo `pdf` devem renderizar arquivos PDF locais via pdf.js com navegação de páginas interna.

**REQ-JRN-009** [MVP] O GM deve poder definir permissões por `JournalEntry` com quatro níveis por usuário: `none` (invisível), `limited` (apenas pin de mapa visível), `observer` (leitura), `owner` (edição).

**REQ-JRN-010** [MVP] O GM deve poder executar "Mostrar aos jogadores" em uma `JournalEntry` ou em uma `JournalEntryPage` específica, abrindo a janela de journal no cliente de todos os jogadores (ou de um subconjunto de jogadores com permissão `observer`+) via evento socket `journal:showToPlayers`.

**REQ-JRN-011** [MVP] O editor deve suportar a inserção de `SecretBlock` — bloco de conteúdo visível apenas ao GM e a usuários com permissão `owner` na entry. O estado de revelação (`revealed: boolean`) de cada bloco é identificado por ID único e persistido no servidor.

**REQ-JRN-012** [MVP] O GM deve poder alternar o estado `revealed` de um `SecretBlock` via botão na interface do editor. A mudança deve ser persistida e propagada em tempo real aos jogadores que estiverem visualizando a página.

**REQ-JRN-013** [MVP] O servidor deve filtrar o conteúdo de `SecretBlock` com `revealed: false` antes de enviar a página a clientes sem permissão `owner`. O filtro ocorre na serialização server-side, nunca confiando no cliente.

**REQ-JRN-014** [MVP] O editor deve suportar a inserção de links `@UUID` via drag-and-drop de qualquer document da sidebar, ou via menu de inserção com busca por nome. A sintaxe armazenada é `@UUID[TipoDoc.id]{Label}`.

**REQ-JRN-015** [MVP] Links @UUID devem ser renderizados como chips clicáveis com ícone do tipo do document (ator, item, tabela, journal, etc.) e label customizável. Clicar no chip abre o document referenciado.

**REQ-JRN-016** [MVP] Links @UUID que apontam para UUID não encontrada no mundo (document deletado ou compendium inativo) devem ser renderizados em estado *broken* com ícone de alerta e tooltip informativo, sem causar erro.

**REQ-JRN-017** [MVP] @UUID deve suportar referência a: `Actor`, `Item`, `JournalEntry`, `JournalEntryPage`, `RollTable`, `Scene`. Novos tipos de document devem ser registráveis pela system API.

**REQ-JRN-018** [V2] O sistema deve manter um índice de backlinks: dado um document, listar todos os documents que o referenciam via @UUID.

**REQ-JRN-019** [MVP] A sidebar de Journal deve exibir entries em hierarquia de pastas com suporte a drag-and-drop para reorganização. O GM vê todas as entries; jogadores veem apenas entries com permissão `observer`+.

### RollTables

**REQ-JRN-020** [MVP] O sistema deve suportar a criação de `RollTable` com `name`, `formula`, `replacement: boolean`, `displayRoll: boolean` e coleção embedded de `TableResult`.

**REQ-JRN-021** [MVP] Cada `TableResult` deve ter: `id` (UUID interno), `type` (`text` | `document` | `compendium`), `range: [number, number]` (min/max inclusivos), `weight: number` (padrão 1), `drawn: boolean` (padrão false), `text: string` (para type `text`), `documentId: string` e `documentCollection: string` (para types `document` e `compendium`).

**REQ-JRN-022** [MVP] O draw de uma tabela deve: (1) rolar a `formula` no servidor (RNG autoritativo, ver `08-motor-de-rolagens.md`); (2) selecionar o(s) resultado(s) cujo range contém o valor rolado; (3) se `replacement: false`, persistir `drawn: true` nos resultados sorteados; (4) publicar o resultado no chat como mensagem de rolagem se `displayRoll: true`.

**REQ-JRN-023** [MVP] Para draw sem replacement (`replacement: false`), quando todos os resultados disponíveis estiverem marcados como `drawn: true`, o sistema deve notificar o usuário que a tabela está esgotada, sem rolar.

**REQ-JRN-024** [MVP] O endpoint `POST /api/tables/:id/reset` deve limpar todos os `drawn: false` na tabela, permitindo novo ciclo de draw sem replacement.

**REQ-JRN-025** [MVP] O endpoint `POST /api/tables/:id/normalize` deve calcular a soma total de `weight` de todos os resultados e reescrever a `formula` como `1dN` onde N = soma dos pesos, redistribuindo os ranges proporcionalmente.

**REQ-JRN-026** [MVP] Resultados do tipo `document` apontando para uma `RollTable` devem disparar draw automático na sub-tabela quando sorteados (tabelas aninhadas). O resultado final apresentado é o resultado da sub-tabela, com o resultado pai exibido como contexto.

**REQ-JRN-027** [MVP] O sistema deve suportar draw de tabela diretamente do chat com o comando `/table NomeDaTabela` ou `/table UUID`. O resultado é postado no chat como mensagem de rolagem; a visibilidade do resultado segue a tabela de roll modes definida em `09-chat-e-mensagens.md` D-CHT-02 — por padrão o resultado é público (`whisper: []`, `blind: false`), mas o GM pode forçar `gmroll` (visível apenas ao GM e ao autor) passando o flag `--gm` ao comando (`/table NomeDaTabela --gm`). A `RollTable` com permissão `none` para não-owners bloqueia o draw por jogadores no servidor.

**REQ-JRN-027a** [MVP] O core do Fusion DEVE registrar o comando `/table` no `CommandRegistry` definido em `09-chat-e-mensagens.md` REQ-CHT-016 durante a inicialização do servidor, como comando built-in (não como comando de sistema). O handler do comando resolve o nome ou UUID da tabela, delega o draw a `POST /api/tables/:id/draw` e publica o resultado como `ChatMessage` do tipo `roll` via o pipeline padrão de chat.

**REQ-JRN-028** [MVP] Jogadores com permissão `observer`+ em uma `RollTable` podem visualizá-la e realizar draws. Apenas GM e `owner` podem editar a tabela.

**REQ-JRN-029** [MVP] A sidebar de RollTables deve exibir tabelas em hierarquia de pastas, visível ao GM. Tabelas com permissão `observer`+ são visíveis a jogadores.

**REQ-JRN-030** [MVP] O sistema deve suportar importação de `RollTable` de compendiums. Resultados do tipo `compendium` referenciam documents por pack ID + document ID; o document referenciado é carregado apenas no momento do draw.

### Cards/Decks (modelo conceitual [V2])

**REQ-JRN-031** [V2] O sistema deve implementar `CardStack` como document de primeiro nível com subtipo `deck` | `hand` | `pile`, contendo coleção embedded de `Card`.

**REQ-JRN-032** [V2] Cada `Card` deve ter: `id`, `name`, `type` (extensível pelo sistema), `suit`, `value: number`, `faces: CardFace[]` (cada face com `name`, `img`, `text`), `back: CardFace`, `drawn: boolean`, `faceDown: boolean`, `width: number`, `height: number`.

**REQ-JRN-033** [V2] O sistema deve suportar as operações: `deal` (distribuir N cartas de Deck para Hand/Pile), `draw` (Hand retira de Deck), `pass` (transferir entre stacks), `play` (Hand → Pile), `shuffle` (randomizar ordem), `reset` (Pile → Deck de origem).

**REQ-JRN-034** [V2] Permissões de `CardStack`: `limited` (visível no diretório), `observer` (leitura, frente de cartas em stacks públicos), `owner` (acesso completo, faces de Hand própria).

**REQ-JRN-035** [V2] Decks devem ser exportáveis/importáveis como JSON e armazenáveis em compendiums para reutilização entre mundos.

### Busca Global

**REQ-JRN-036** [MVP] A sidebar deve ter um campo de busca global que pesquisa por nome em: `JournalEntry`, `JournalEntryPage`, `Actor`, `Item`, `RollTable`, `Scene`, `RollTable`. A busca é case-insensitive e suporta substring matching.

**REQ-JRN-037** [MVP] Os resultados da busca global devem ser agrupados por tipo de document, exibindo ícone do tipo, nome e path de pasta. Clicar em um resultado abre o document correspondente.

**REQ-JRN-038** [MVP] A busca global deve responder em menos de 200ms para mundos com até 5.000 documents, usando índice em memória no servidor mantido atualizado via eventos de criação/atualização/deleção de documents.

**REQ-JRN-039** [MVP] Para mundos com mais de 10.000 documents, a busca deve fazer fallback para FTS5 do SQLite com query `MATCH`.

**REQ-JRN-040** [MVP] O índice de busca deve ser atualizado em tempo real via eventos socket quando documents são criados, renomeados ou deletados, sem necessidade de reiniciar o servidor.

---

## Requisitos Não-Funcionais

**REQ-JRN-NF-001** [MVP] O autosave de journal não deve bloquear a UI; deve ocorrer de forma assíncrona e exibir indicador visual de "salvando" e "salvo".

**REQ-JRN-NF-002** [MVP] O carregamento da janela de `JournalEntry` deve ocorrer em menos de 300ms para entries com até 20 páginas e conteúdo de texto < 500KB.

**REQ-JRN-NF-003** [MVP] O draw de `RollTable` deve retornar resultado em menos de 100ms (excluindo latência de rede).

**REQ-JRN-NF-004** [MVP] O editor de texto deve suportar documentos de até 200KB de JSON TipTap sem degradação de performance perceptível.

**REQ-JRN-NF-005** [MVP] Todos os dados sensíveis (conteúdo de `SecretBlock` não revelado) devem ser filtrados server-side antes de qualquer transmissão ao cliente. Isso deve ser validado por testes de integração.

---

## Modelo de Dados

```typescript
// packages/shared/src/documents/journal.ts

export type JournalPageType = 'text' | 'image' | 'video' | 'pdf'; // pdf = V2

export interface JournalEntryPageData {
  id: string;           // UUID
  name: string;
  type: JournalPageType;
  tocLevel: number;     // 1–6, controla indentação no TOC
  sort: number;         // ordem de exibição
  content: string;      // JSON serializado do TipTap doc (type=text) | URL (image/video/pdf)
  secretBlocks: SecretBlockState[]; // estado de revelação de blocos secretos
  ownership: OwnershipMap;          // permissões por página (sobrescrevem a entry)
}

export interface SecretBlockState {
  blockId: string;      // ID único do bloco no documento TipTap
  revealed: boolean;
}

export interface JournalEntryData {
  _id: string;
  name: string;
  folder: string | null;
  sort: number;
  ownership: OwnershipMap;  // ver 05-usuarios-e-permissoes.md
  pages: JournalEntryPageData[];
  flags: Record<string, unknown>;
}

// packages/shared/src/documents/rolltable.ts

export type TableResultType = 'text' | 'document' | 'compendium';

export interface TableResultData {
  id: string;
  type: TableResultType;
  range: [number, number];  // [min, max] inclusivos
  weight: number;           // peso relativo para normalização
  drawn: boolean;
  text: string;             // type=text: conteúdo; outros: descrição opcional
  documentId: string | null;
  documentCollection: string | null;  // world collection name ou compendium pack id
}

export interface RollTableData {
  _id: string;
  name: string;
  folder: string | null;
  sort: number;
  formula: string;          // fórmula de dados, ex.: "1d20"
  replacement: boolean;
  displayRoll: boolean;
  description: string;
  ownership: OwnershipMap;
  results: TableResultData[];
  flags: Record<string, unknown>;
}

// packages/shared/src/documents/cards.ts  [V2]

export interface CardFace {
  name: string;
  img: string;
  text: string;
}

export type CardStackType = 'deck' | 'hand' | 'pile';

export interface CardData {
  id: string;
  name: string;
  type: string;   // extensível pelo sistema
  suit: string;
  value: number;
  faces: CardFace[];
  back: CardFace;
  drawn: boolean;
  faceDown: boolean;
  width: number;
  height: number;
  sort: number;
  origin: string | null;   // id do Deck de origem, para reset
}

export interface CardStackData {
  _id: string;
  name: string;
  type: CardStackType;
  folder: string | null;
  sort: number;
  ownership: OwnershipMap;
  cards: CardData[];
  flags: Record<string, unknown>;
}
```

---

## API e Eventos

### REST — Journal

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/journal` | Lista `JournalEntry` com permissão do usuário solicitante |
| `POST` | `/api/journal` | Cria `JournalEntry` (requer GM ou owner) |
| `GET` | `/api/journal/:id` | Retorna entry com páginas; filtra SecretBlocks não revelados para não-owners |
| `PATCH` | `/api/journal/:id` | Atualiza metadados da entry |
| `DELETE` | `/api/journal/:id` | Remove entry (requer GM) |
| `POST` | `/api/journal/:id/pages` | Adiciona página à entry |
| `PATCH` | `/api/journal/:id/pages/:pageId` | Atualiza página (inclui content e secretBlocks) |
| `DELETE` | `/api/journal/:id/pages/:pageId` | Remove página |
| `POST` | `/api/journal/:id/show` | Envia evento `journal:showToPlayers` para os jogadores especificados |

### REST — RollTable

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/tables` | Lista tabelas com permissão do usuário |
| `POST` | `/api/tables` | Cria tabela |
| `GET` | `/api/tables/:id` | Retorna tabela com resultados |
| `PATCH` | `/api/tables/:id` | Atualiza metadados e resultados |
| `DELETE` | `/api/tables/:id` | Remove tabela |
| `POST` | `/api/tables/:id/draw` | Realiza draw; body: `{ count?: number }` |
| `POST` | `/api/tables/:id/reset` | Reseta todos os `drawn: false` |
| `POST` | `/api/tables/:id/normalize` | Recalcula formula e ranges com base nos pesos |

### Eventos Socket.io

| Evento | Direção | Payload | Descrição |
|---|---|---|---|
| `journal:update` | server → clients | `{ entryId, pageId?, patch }` | Página ou entry atualizada |
| `journal:showToPlayers` | server → clients | `{ entryId, pageId?, userIds? }` | GM força abertura de journal |
| `journal:secretRevealed` | server → clients | `{ entryId, pageId, blockId, revealed }` | GM alterou visibilidade de bloco secreto |
| `journal:created` | server → clients | `JournalEntryData` | Nova entry criada |
| `journal:deleted` | server → clients | `{ entryId }` | Entry removida |
| `table:draw` | server → clients | `{ tableId, results, roll }` | Resultado de draw publicado |
| `table:reset` | server → clients | `{ tableId }` | Tabela resetada |
| `search:reindex` | server interno | `{ docType, id, op }` | Atualiza índice de busca em memória |

### Comandos de Chat

| Comando | Descrição |
|---|---|
| `/table <nome ou UUID>` | Realiza draw da tabela e posta no chat |
| `/table <nome ou UUID> <N>` | Realiza N draws consecutivos |

---

## Dependências

- **`02-modelo-de-dados.md`** — Document model base, OwnershipMap, embedded collections
- **`03-persistencia-e-mundos.md`** — Persistência SQLite, WAL, serialização JSON
- **`04-rede-e-sincronizacao.md`** — Protocolo socket.io, eventos de document, autoridade do servidor
- **`05-usuarios-e-permissoes.md`** — Níveis de permissão (none/limited/observer/owner), filtragem server-side
- **`08-motor-de-rolagens.md`** — RNG autoritativo no servidor, parsing de fórmulas para `RollTable`
- **`09-chat-e-mensagens.md`** — Publicação de resultados de tabela no chat, comandos `/table`
- **`16-compendiums-e-importacao.md`** — Importação de Journal e RollTable de compendiums; resultados tipo `compendium`

---

## Critérios de Aceitação

**CA-JRN-001** Um GM pode criar uma `JournalEntry` com três páginas (text, image, video), navegar pelo TOC e visualizar cada página sem erros.

**CA-JRN-002** Um GM pode inserir um `SecretBlock` numa página de texto, marcar como revelado, e um jogador com permissão `observer` passa a ver o conteúdo; ao desvelar, o jogador para de ver. A mudança persiste após reiniciar o servidor.

**CA-JRN-003** Um GM pode arrastar um `Actor` da sidebar para o editor de journal; o link `@UUID` é inserido como chip clicável; clicar no chip abre a ficha do ator. Deletar o ator faz o chip ficar em estado broken com ícone de alerta.

**CA-JRN-004** Um GM executa "Mostrar aos jogadores" em uma página de journal; todos os jogadores conectados veem a janela da página abrindo automaticamente no cliente.

**CA-JRN-005** Um GM cria uma `RollTable` com 5 resultados de pesos variados, clica em "Normalizar" e os ranges são redistribuídos corretamente; ao realizar draw sem replacement 5 vezes, cada resultado aparece exatamente uma vez; ao tentar o 6º draw, o sistema informa que a tabela está esgotada.

**CA-JRN-006** Uma `RollTable` com resultado tipo `document` apontando para outra tabela retorna, ao ser sorteada, o resultado da sub-tabela encadeada.

**CA-JRN-007** Um jogador digita `/table NomeDaTabela` no chat e o resultado é postado como mensagem de rolagem visível a todos os presentes (permissão observer+ na tabela).

**CA-JRN-008** A busca global encontra journal entries, actors e items por substring do nome em menos de 200ms em um mundo com 2.000 documents.

**CA-JRN-009** Um request HTTP direto a `GET /api/journal/:id` por um usuário sem permissão `owner` não contém o conteúdo de `SecretBlock` com `revealed: false` na resposta, mesmo que o conteúdo exista no banco.

**CA-JRN-010** Dois usuários editando a mesma página de journal ao mesmo tempo: o autosave do último a salvar prevalece; não há crash e o conteúdo salvo é o do último save.

---

## Questões em Aberto

**Q-JRN-001** Qual é o tamanho máximo esperado de um documento TipTap por página? Definir limite para evitar inserção de documentos excessivamente grandes que degradem performance do servidor. Sugestão inicial: 1MB de JSON serializado.

**Q-JRN-002** ~~Resolvida em REQ-JRN-027.~~ O comando `/table` usa roll mode `public` por padrão; o flag `--gm` produz `gmroll` (visível ao GM e ao autor), seguindo a tabela de roll modes de `09-chat-e-mensagens.md` D-CHT-02. Sistemas que precisam de draw privado (ex.: tabelas de crit do PF2e) devem usar `POST /api/tables/:id/draw` diretamente com o roll mode desejado, em vez de `/table` pelo chat.

**Q-JRN-003** Permissões por `JournalEntryPage` sobrescrevem ou herdam as da `JournalEntry` pai? O modelo atual assume sobrescrita (ownership da página > ownership da entry). Confirmar com o designer de produto.

**Q-JRN-004** Quando um resultado `compendium` é sorteado de uma `RollTable`, o document do compendium deve ser linkado no resultado ou importado automaticamente para o mundo? O comportamento do Foundry é apenas linkar. Confirmar se Fusion seguirá o mesmo comportamento.

**Q-JRN-005** Colaboração em tempo real com CRDT (Yjs) está marcada como V2. Em qual milestone V2 isso deve entrar? É dependente do volume de reclamações de conflito durante testes de grupo.

**Q-JRN-006** A busca global deve incluir conteúdo textual das páginas de journal (full-text) ou apenas nomes de documents? Full-text aumenta utilidade mas eleva o tamanho do índice em memória. Decisão de produto necessária antes da implementação.

---

## Referências

- `docs/research/09-foundry-funcionalidades-mesa.md` — seções 2, 3, 5 (Journal, Roll Tables, Cards)
- [Journal Entries — Foundry VTT Knowledge Base](https://foundryvtt.com/article/journal/) (via research doc)
- [Rollable Tables — Foundry VTT Knowledge Base](https://foundryvtt.com/article/roll-tables/) (via research doc)
- [Cards — Foundry VTT Knowledge Base](https://foundryvtt.com/article/cards/) (via research doc)
- TipTap v2 — https://tiptap.dev/docs
- SQLite FTS5 — https://www.sqlite.org/fts5.html
- `specs/02-modelo-de-dados.md` — Document model e embedded collections
- `specs/04-rede-e-sincronizacao.md` — Protocolo socket.io e autoridade do servidor
- `specs/05-usuarios-e-permissoes.md` — OwnershipMap e filtragem de dados
- `specs/08-motor-de-rolagens.md` — RNG autoritativo e parsing de fórmulas
- `specs/09-chat-e-mensagens.md` — Publicação de mensagens de rolagem
- `specs/16-compendiums-e-importacao.md` — Resultados de tabela tipo compendium
