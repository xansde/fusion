# Token — plano de tarefas (spec 41)

Origem: [`specs/41-token.md`](../../../specs/41-token.md), escrita e mergeada em `alfa/app` em
2026-08-17 (PR #173). São **61 requisitos [MVP]**, **22 decisões** e **zero citação de teste ou
de código** — este documento é o caminho de 0% até a mesa jogando com a peça que a spec descreve.

O racional completo de cada decisão está em [`decisoes.md`](decisoes.md); o modelo roda em
[`prototipo-token.html`](prototipo-token.html), com 19 expectativas que servem de rascunho de
teste.

Base de trabalho: `alfa/app`. Uma fase = um PR. Promoção `alfa → beta → stable` é sempre ato
humano.

**Escopo de linha:** vale para `alfa`/`beta`/`stable` e só para ela. `build/app` e `main` são a
linha geral, paralela desde `ab4966f` (02/08), sem convergência planejada.

**Escopo de frente — este plano MEXE em schema.** Diferente do plano da gaveta, aqui a mudança
de forma da peça é o trabalho: `actorLink` e `actorDelta` **não existem no código** e três campos
saem. Isso é `packages/shared/src/scene.ts`, que é validação de documento embedded, **não**
migration de tabela: a peça vive como JSON dentro da linha da cena (DEC-PER-02, DEC-TOK-21) e
nenhuma coluna nova é criada. Se uma tarefa daqui parecer precisar de migration, pare — ela está
lendo a spec errado.

---

## O que muda no produto, em uma frase

A peça de hoje — que **copia** a arte do ator, nasce sempre 1×1 e neutra, desenha a barra de vida
sempre cheia, deixa qualquer um mover o que não é seu e não sabe o que é uma ficha desvinculada —
passa a ser **um endereço**: guarda onde o ator está e nada que descreva quem ele é.

---

## O estado real do código, conferido em 2026-08-17 na ponta de `alfa/app`

Não é levantamento de spec: é o que está lá.

| Achado                                                                                                             | Onde                                                       | Consequência                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **`actorLink` e `actorDelta` não existem.** Só há menção em comentário. A peça é sempre, implicitamente, vinculada | `packages/shared/src/scene.ts`                             | Bloqueia DEC-TOK-14, REQ-TOK-023, REQ-TOK-072 e REQ-CNV-091/092/093. É a Fase 1 |
| O schema tem `texture`, `width`, `height` — os três campos que a spec elimina                                      | idem                                                       | REQ-TOK-010/012                                                                 |
| `actorId` é `nullable().default(null)`                                                                             | idem                                                       | REQ-TOK-002 recusa nulo                                                         |
| A barra é desenhada com `const fraction = 1; // placeholder: full bar`                                             | `packages/client/src/lib/canvas/tokens/TokenSprite.ts:533` | O oposto literal de REQ-CNV-090 e REQ-TOK-073. Issue #165                       |
| `_isTokenControlledByUser` lê `token.ownership` e `token.userId` — campos que não existem e que REQ-DOC-025 proíbe | `packages/client/src/lib/canvas/scene-orchestrator.ts:434` | Devolve `false` para todo não-Mestre. Issue #164, REQ-TOK-034                   |
| O arraste do NPC para a cena escreve `texture`, `width: 1`, `height: 1`, `disposition: 0` fixos                    | `packages/client/src/lib/npcs/npcsFooter.ts:146..153`      | Issue #167. Some inteiro com a herança da Fase 3                                |
| `token:move` valida colisão com parede e reescreve a coleção inteira de tokens                                     | `packages/server/src/net/handlers/vision-handlers.ts`      | Colisão sai (DEC-TOK-07); a reescrita é issue #169, fora deste plano            |
| Nenhum teste cita requisito de token do bloco `REQ-CNV-025..033`                                                   | —                                                          | A cobertura da `41` começa literalmente em zero                                 |

---

## Decisões fechadas que regem o plano

Nenhuma é invenção deste documento. Mudar qualquer uma é mudar spec antes de mudar código
(`CONVENCOES.md` §2).

| #   | Decisão                                                                                   | Consequência para o plano                                                                                                  |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| T-1 | A peça é endereço, não identidade (DEC-TOK-02)                                            | Metade das tarefas é **remoção**. Toda tarefa que acrescenta campo à peça é suspeita — confira contra §7.1 da spec         |
| T-2 | `actorLink`/`actorDelta` são pré-requisito de tudo que envolve estado vivo                | A Fase 1 bloqueia as Fases 3, 6 e 8. Não dá para "fazer a barra funcionar" antes dela                                      |
| T-3 | Esconder na tela não é proteger (RNF-TOK-02)                                              | Ocultação, nome e vida têm **metade de servidor obrigatória**. Nenhuma delas entra só no cliente                           |
| T-4 | Uma função só resolve o ator efetivo, compartilhada entre servidor e cliente (RNF-TOK-01) | Segunda implementação em qualquer ponta é defeito. É o que a REQ-CNV-091 já exigia e ninguém cumpriu                       |
| T-5 | Recusar, não ignorar em silêncio (DEC-TOK-05, REQ-TOK-022)                                | Todo campo derivado precisa de teste que **reproduza a escrita indevida** e veja a recusa. Lição da T025 do plano de banco |
| T-6 | Visão, névoa e colisão só saem do projeto se Q-TOK-04 for respondida                      | A Fase 9 é **condicional**. Enquanto não for, o código de visão fica onde está, e as issues #164/#166 seguem abertas       |
| T-7 | Preferência de exibição é do usuário, e só subtrai (DEC-TOK-11)                           | O teste que importa não é "desliga e some": é **o payload não muda**. Sem ele, alguém a implementa como filtro             |
| T-8 | A `41` não tem regra de nome (DEC-TOK-09)                                                 | A Fase 7 é quase toda na `39` e na `21`. Se aparecer lógica de nome dentro do token, está errada                           |

**Princípio que rege a ordem:** primeiro a fundação que falta (Fase 1), depois o que já está
errado na mesa (Fase 2), depois a herança que apaga campos (Fase 3) — e só então as regras que
dependem das três.

---

## Como ler estas tarefas

- `TK###` — id estável. Não renumerar; tarefa cancelada vira `~~TK###~~` com o motivo.
- `[P]` — pode ser feita em paralelo com as outras `[P]` da mesma fase.
- **Pronto quando** — critério verificável. Sem comando ou teste que prove, a tarefa não fecha.
- **Cobre** — os requisitos que a tarefa entrega. O teste **DEVE citar esses ids**: é assim que a
  cobertura de `RASTREABILIDADE.md` sobe (`CONVENCOES.md` §8). Requisito entregue sem citação não
  afirma nada.
- Toda tarefa cita arquivo real.

Comandos do repo: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` ·
`pnpm build` · `pnpm spec:report`

Três hábitos que o repo já cobra:

- **`pnpm spec:report` roda em todo PR que acrescenta teste citando requisito** — o relatório é
  comparado com o repo por um teste e o piso de `COBERTURA-MINIMA.json` sobe sozinho. Esquecer
  derruba o CI depois do merge.
- **Teste de servidor nunca hardcoda porta** — use
  `packages/server/src/__tests__/helpers/ports.ts`. `port: 0` não funciona: `boot()` injeta
  `currentPort` antes do `listen()`.
- **Testes do server rodam em forks** (better-sqlite3 quebra em worker_threads). Saída não-zero
  com "Timeout calling onTaskUpdate" e nenhum teste falhando é flakiness de infra — re-rode o
  arquivo isolado antes de tratar como regressão.

---

## Fase 0 — Fechar as 12 emendas que a spec obriga (sem uma linha de código) ⚠️ pré-requisito

A §12 da `41` registrou o que ela obriga a mudar em spec alheia — a catraca que impede spec
contrariada em silêncio. Enquanto não forem aplicadas, há requisito citando contrato que não
existe, e a implementação teria dois textos concorrentes para consultar.

Duas já foram aplicadas no PR da spec e não devem ser refeitas: `README.md` (linha `REQ-TOK-` no
registro de prefixos) e `CONVENCOES.md` §7 (a lacuna `41` riscada).

### TK001 — `02`: `TokenData` passa a espelhar §7.1 da `41`

`specs/02-modelo-de-dados.md` (~linha 819)

Saem `img`, `width`, `height`, `displayName`, `locked`, `alpha`; `sight` vira `vision`; `actorId`
deixa de ser anulável; entram `seenBy` e `disposition` anulável. A tabela de campos passa a ser da
`41` — o resto do documento continua dono da forma de Document. **Não renumerar nada**: os ids
`REQ-DOC-031..035` seguem válidos e citados por código.

**Pronto quando:** `pnpm test` (spec-lint) passa e a interface da `02` é idêntica à §7.1 da `41`.

### TK002 [P] — `06`: seis requisitos de token perdem base

`specs/06-canvas-e-renderizacao.md` (~linhas 306–341)

**REQ-CNV-025** perde a textura de sujeito e a `scale`; **REQ-CNV-026** perde `alpha`, `tint`,
`mirrorX`, `mirrorY`; **REQ-CNV-027** perde `secret`; **REQ-CNV-029** é aposentado (DEC-TOK-19);
**REQ-CNV-031** e **REQ-CNV-089** perdem os cinco níveis e passam a citar conhecimento e posse;
**REQ-CNV-041** passa de [V2] a [MVP], com dois modos. **DEC-CNV-07** perde a metade da escala
visual independente; **DEC-CNV-15** é revertida por DEC-TOK-10 — escrita como decisão substituída,
não apagada (`CONVENCOES.md` §5).

### TK003 [P] — `39`: o retrato sai da redação de contato `entrevisto`

`specs/39-contatos.md` (DEC-CTT-04 ~linha 109, REQ-CTT-041 ~linha 317)

A emenda menos óbvia e a mais importante da Fase 0. Hoje a `39` proíbe **nome, título e retrato**
no payload de um contato `entrevisto` — e um token precisa da arte para ser desenhado. A regra que
fica de pé nas duas specs: **o nome é redigido, a arte viaja**; a silhueta no cartão de contato
passa a ser escolha de apresentação daquela tela. Motivo em DEC-TOK-09.

**Cuidado:** isto não afrouxa `oculto`. Um ator que o usuário não conhece só é emitido quando ele
**recebe uma peça** daquele ator — ver TK031.

### TK004 [P] — `15`: o sistema declara a conversão tamanho → células

`specs/15-api-de-sistemas.md` (junto de REQ-SYS-004)

Ponto de extensão novo (DEC-TOK-03). A engine não arbitra: PF2e declara Médio 1×1, Grande 2×2. É
a mesma disciplina que REQ-SYS-004 já aplica a barras e iniciativa.

### TK005 [P] — `20`: a arte de criatura vive no ator

`specs/20-assets-e-midia.md` (REQ-AST-043)

O `AssetRef` de arte de criatura vive no `Actor`, nunca no token (DEC-TOK-02).

### TK006 [P] — `37`: um setting de mundo e duas preferências de usuário

`specs/37-configuracoes.md`

Hospeda o setting de **numeração** (DEC-TOK-16) e as **duas preferências** de exibição de nome e
de barras (REQ-TOK-074). Repare na fronteira da `37`: setting de mundo é `Setting` no servidor;
preferência de exibição é ergonomia local do aparelho (DEC-UIF-10).

### TK007 [P] — `09`: quem fala é o jogador, nunca a peça

`specs/09-chat-e-mensagens.md` (REQ-CHT-022; REQ-CHT-041/043)

REQ-CHT-022 resolve hoje o falante por "token controlado pelo usuário na cena ativa". Com
DEC-TOK-06 isso deixa de fazer sentido. Os chat bubbles, que existem para aparecer acima da peça
de quem falou, perdem a âncora — **decidir o que fica** é da `09`, não desta spec.

### TK008 [P] — `07` e `27`: registrar que a `41` não herda visão

`specs/07-visao-iluminacao-fog.md`, `specs/27-roadmap-e-milestones.md`

Nada muda em requisito. Registra-se que `vision`/`light` do token são declaração inerte até a `07`
valer (DEC-TOK-18) e que o marco que citava "tokens com visão" depende de Q-TOK-04.

### TK009 [P] — `42`: a contradição do baú, herdada da `45`

`specs/42-aba-npcs.md` (REQ-NPC-061)

REQ-NPC-061 ainda diz que o baú NÃO DEVE ser ator, contra DEC-ATR-09. A emenda é da `45` — issue
#171 —, e este plano depende dela para que o baú possa ter peça.

### TK010 — Fechar a Fase 0 com o lint verde

**Pronto quando:** `pnpm test` passa, `pnpm spec:report` roda e nenhuma citação nova ficou
pendurada. **Nenhuma tarefa da Fase 1 começa antes disto.**

---

## Fase 1 — A fundação que falta: vínculo e forma da peça

O maior buraco do levantamento. `actorLink` e `actorDelta` são especificados desde a `02` e
**nunca chegaram ao código** — a peça é sempre implicitamente vinculada, e o modelo dos seis
esqueletos com vidas separadas não existe.

### TK020 — `actorLink` e `actorDelta` nascem no schema

`packages/shared/src/scene.ts` (`TokenDocumentSchema`)

`actorLink: boolean` e `actorDelta: ActorDeltaPatch | null`, conforme REQ-DOC-031..034 e DEC-DOC-08.
O merge patch é o simplificado da `02`: `items` **substitui** integralmente quando presente.

**Cobre:** REQ-TOK-023 · **Pronto quando:** um token desvinculado sobrevive ao round-trip de
persistência (create e update) sem o delta ser descartado pela validação (REQ-DOC-018).

**Atenção — janela de redação aberta por esta tarefa (REQ-DOC-062):** a partir desta tarefa,
`actorDelta` passa a existir e a ser persistido na `Scene` — mas `packages/server/src/net/redaction.ts`
ainda não sabe da sua existência (redação é Fase 6, TK072, fora do escopo desta fase). Entre esta
tarefa e a TK072 landing, os pontos de vida (e demais overrides) de um token unlinked viajam sem
corte em qualquer payload de `Scene` que chegue a um jogador. TK072 já é a dona funcional do corte
(DEC-TOK-10 — corte por OWNER, lido do `Actor` base mesmo quando desvinculado), mas seu "Cobre"
ainda não cita REQ-DOC-062 literalmente; ver nota espelhada lá. Registrar como openQuestion: a
janela é aceitável dentro do MVP em construção (mundo de teste, sem jogador externo antes da Fase
6), mas TK072 não pode ser adiada além do fechamento da onda.

### TK021 — A função única do ator efetivo

`packages/shared/src/` (novo módulo) + consumo no servidor e no cliente

Uma função `resolveEffectiveActor(token, baseActor)`: base quando vinculado, base + delta quando
não. **Uma só implementação**, usada pelo servidor para rotear mutações e pelo cliente para
desenhar — é o que REQ-CNV-091 já exigia.

**Cobre:** RNF-TOK-01 · **Pronto quando:** dois tokens do mesmo ator com deltas diferentes
resolvem vidas diferentes, e existe teste que falha se uma segunda implementação for introduzida
no cliente.

### TK022 — `actorId` deixa de aceitar nulo

`packages/shared/src/scene.ts` · `packages/server/src/net/handlers/`

O schema recusa `null`, ausente e id que não resolve para ator existente. O `TokenAddDialog`
(`TokenAddDialog.svelte` + `tokenController.ts`, em
`packages/client/src/components/scenes/`) hoje cria peça com **nome e textura, sem ator nenhum** —
é literalmente o caso que DEC-TOK-04 bane. Ele passa a exigir um ator, ou é substituído pelo
arraste do diretório, que já nasce vinculado.

**Cobre:** REQ-TOK-002, CA-TOK-003 · **Pronto quando:** a criação com `actorId` nulo é recusada
pelo servidor com erro explícito, e há teste que reproduz a tentativa (T-5).

### TK023 — Os três campos saem do schema

`packages/shared/src/scene.ts`

Saem `texture`, `width`, `height`. Nada os substitui: a Fase 3 os deriva.

**Cobre:** REQ-TOK-010, REQ-TOK-012 · **Pronto quando:** `pnpm typecheck` passa e nenhum consumidor
lê os três — o compilador é o verificador aqui.

### TK024 [P] — `seenBy` e `disposition` anulável entram

`packages/shared/src/scene.ts`

`seenBy: string[]` (exceções à ocultação) e `disposition` passa a aceitar `null` = herda do ator.
`name` idem: `null` = herda.

**Cobre:** REQ-TOK-050, REQ-TOK-080

### TK025 — O contrato de invocação recusa o que não aceita

`packages/server/src/net/handlers/doc-handlers.ts` (ou o handler de criação de token)

Implementa §7.2 da spec: obrigatório, sobrescrevível, **derivado** e **recusado**. Campo derivado
que chega no payload é rejeitado com erro — não recalculado em silêncio.

**Cobre:** REQ-TOK-020, REQ-TOK-021, REQ-TOK-022, CA-TOK-004 · **Pronto quando:** existe um teste
por linha da tabela §7.2, inclusive o de `actorDelta` na criação. **É a tarefa que T-5 governa** —
o teste tem de reproduzir a escrita indevida, não só afirmar a derivação.

---

## Fase 2 — Os defeitos que já estão na mesa

Nenhum é trabalho novo: são issues abertas que a spec agora nomeia. Vêm antes das regras porque
uma delas — o controle — é pré-requisito de permissão.

### TK030 — O "controle de token" errado morre (#164)

`packages/client/src/lib/canvas/scene-orchestrator.ts:434`

`_isTokenControlledByUser` lê `token.ownership` e `token.userId`: campos que não existem no schema
e que REQ-DOC-025 proíbe. O resultado é `false` para todo não-Mestre. Substituir pela posse do
**ator** (REQ-USR-013), pela mesma função do servidor.

**Cobre:** REQ-TOK-013, REQ-TOK-034, REQ-TOK-032 · **Pronto quando:** um jogador OWNER do próprio
personagem controla a peça dele, e não controla a de um NPC — com teste, não com print.

### TK031 [P] — A barra deixa de ser desenhada sempre cheia (#165)

`packages/client/src/lib/canvas/tokens/TokenSprite.ts:533`

`const fraction = 1; // placeholder: full bar` é o oposto literal de REQ-CNV-090. Lê o valor real
do atributo no **ator efetivo** (TK021), limita a fração a [0,1], e **omite** a barra quando o
caminho não resolve ou `max <= 0` — nunca desenha cheia.

**Cobre:** REQ-TOK-073 · **Pronto quando:** um token ferido desenha barra parcial, um token cujo
atributo não resolve não desenha barra nenhuma, e existe o teste de repintura de REQ-CNV-092.

### TK032 [P] — `ActorDragPayload.uuid` para de mentir (#170)

`packages/client/src/lib/actors/actorDirectory.ts`

O campo chamado `uuid` carrega um `_id`. Renomear, ou fazer carregar o que o nome diz. Não é
cosmético: a identidade de documento é `flags.fusion.sourceId` (DEC-ATR-11) e um `uuid` falso é
convite a comparação errada.

### TK033 [P] — `token:preview` sai do literal (#168)

`packages/server/src/net/handlers/` · protocolo

REQ-NET-044 é [MVP] e existe hoje só como string no protocolo. Com o arraste mantido como gesto de
movimento (DEC-TOK-07), o preview volta a ter função.

---

## Fase 3 — Herança: a peça para de descrever o ator

Depende de TK021 (ator efetivo) e TK023 (campos fora).

### TK040 — A arte passa a ser lida do ator a cada render

`packages/client/src/lib/canvas/tokens/TokenSprite.ts` · `packages/client/src/lib/npcs/npcsFooter.ts:146`

Hoje o arraste **copia** a arte para a peça, e trocar a arte do ator não atualiza nada no mapa.
Com o campo fora (TK023), a leitura passa a ser do ator efetivo.

**Cobre:** REQ-TOK-010, REQ-TOK-011, CA-TOK-001 · **Pronto quando:** trocar a arte de um ator com
três peças em duas cenas muda as três, sem nenhuma escrita em peça.

### TK041 — O footprint passa a ser derivado do tamanho pelo sistema (#167)

`systems/*/src/index.ts` (declaração) · `packages/client/src/lib/canvas/` (consumo)

O sistema declara o mapeamento (TK004); a engine consome. `npcsFooter.ts` para de escrever
`width: 1, height: 1` fixos.

**Cobre:** REQ-TOK-012, REQ-TOK-017, REQ-TOK-043, CA-TOK-002 · **Pronto quando:** um ator Grande
do PF2e ocupa 2×2, o snapping multi-célula de REQ-CNV-023 continua correto, e uma criatura que
muda de tamanho em jogo muda de footprint **sem escrita na peça**.

### TK042 [P] — A disposição passa a ser herdada, e `secret` some

`packages/shared/src/scene.ts` · `packages/client/src/lib/canvas/tokens/`

Três valores (DEC-TOK-12). `SECRET_RING_COLOR` sai — ele era o fallback de "qualquer outro valor"
e o que pintava peça sem ator; DEC-TOK-04 e DEC-TOK-12 apagam os dois casos. A borda por
disposição **fica**.

**Cobre:** REQ-TOK-080, REQ-TOK-081

---

## Fase 4 — Permissões: quem cria, quem move, quem tira

### TK050 — Criar, duplicar e excluir passam a exigir papel privilegiado

`packages/server/src/net/handlers/doc-handlers.ts` · caminhos de criação no cliente

A régua é uma só (DEC-TOK-06). Inclui o caso que alguém vai testar primeiro: **o jogador não põe
o próprio personagem no mapa**.

**Cobre:** REQ-TOK-030, REQ-TOK-031, REQ-TOK-033, CA-TOK-005 · **Pronto quando:** o servidor
recusa a criação pedida pelo OWNER do ator e aceita a do Mestre, com teste dos dois lados.

### TK051 — Mover exige OWNER do ator

`packages/server/src/net/handlers/vision-handlers.ts` (`buildTokenMoveHandler`)

A checagem já existe e já usa `OwnershipLevel.OWNER` — o que falta é ser **a única**, e o cliente
consultá-la pela mesma função (TK030).

**Cobre:** REQ-TOK-032, REQ-TOK-034, CA-TOK-006

---

## Fase 5 — Movimento

### TK060 — As setas movem a peça selecionada

`packages/client/src/lib/canvas/` (handler de teclado da cena)

Quatro direções ortogonais, uma célula por acionamento, sem diagonal (DEC-TOK-07). Respeita
footprint e os limites da cena.

**Cobre:** REQ-TOK-040, REQ-TOK-043 · **Pronto quando:** a `23` pode marcar REQ-A11-036 como
satisfeito para o movimento de peça — cite os dois ids no teste.

### TK061 [P] — O arraste continua movendo, com a mesma validação

`packages/client/src/lib/canvas/` · `vision-handlers.ts`

Mesmo efeito, mesma validação. Não são dois caminhos de permissão: são dois gestos para o mesmo
caminho.

**Cobre:** REQ-TOK-041

### TK062 — A colisão com parede sai do `token:move` ⚠️ depende de Q-TOK-04

`packages/server/src/net/handlers/vision-handlers.ts`

Hoje o handler carrega as paredes da cena e recusa movimento bloqueado. DEC-TOK-07 tira isso — e
a issue #166 (colisão ignora footprint) deixa de ser defeito a corrigir e vira código a remover.
**Não execute antes de Q-TOK-04 ser respondida** (T-6): se visão/parede ficarem no projeto, esta
tarefa vira o conserto da #166 em vez da remoção.

**Cobre:** REQ-TOK-042, REQ-TOK-044

---

## Fase 6 — Redação: o que chega a cada cliente

Toda tarefa aqui tem metade de servidor obrigatória (T-3). O funil é
`packages/server/src/net/redaction.ts`, e os quatro caminhos de emissão de REQ-NET-096 valem para
todas.

### TK070 — Ocultação por usuário

`packages/server/src/net/redaction.ts`

O predicado passa de "é privilegiado?" para "é privilegiado **ou** está em `seenBy`?". A emissão
de `Scene` já é por socket, então não há caminho novo — só um predicado que conhece o `userId`.

**Cobre:** REQ-TOK-050, REQ-TOK-051, REQ-TOK-052, CA-TOK-007 · **Pronto quando:** o teste cobre
os **quatro** caminhos (snapshot de join, broadcast, replay de delta, eco do ack), não só o
broadcast.

### TK071 [P] — A documentação distingue ocultar de não enxergar

`docs/` ou o próprio código, onde a decisão for encontrada

Ocultar é servidor (a peça não chega); estar fora do campo de visão é cliente (a peça chega e não
é desenhada). Sem isso registrado, alguém vai supor que a névoa protege posição de inimigo.

**Cobre:** REQ-TOK-053

### TK072 — A vida só é emitida ao dono

`packages/server/src/net/redaction.ts` · `packages/client/src/lib/combat/combatVisibility.ts`

Corte em OWNER, em toda superfície (DEC-TOK-10). O corte é lido do **Actor base** mesmo para peça
desvinculada: um delta descreve o que a peça tem, nunca quem pode olhar.

**Cobre:** REQ-TOK-070, REQ-TOK-071, REQ-TOK-072, CA-TOK-010, **REQ-DOC-062** · **Atenção:** isto
**reverte a DEC-CNV-15** e afeta `combatVisibility.ts` e a Q-CBA-02 da `40`. A nota está no
cabeçalho da Fase 4 de [`../gaveta-lateral/tasks.md`](../gaveta-lateral/tasks.md) — conferir os
dois planos antes de mexer. **Também é a tarefa que fecha REQ-DOC-062** (specs/02:501-508): o
`actorDelta` que a TK020 (Fase 1) fez nascer no schema ainda não é redigido em nenhum caminho de
emissão de `Scene`. DEC-DOC-12 (specs/02:292-301) descreve um corte fail-closed **por papel**
("não privilegiado" perde `actorDelta` inteiro); DEC-TOK-10 desta spec escolhe um corte mais fino
**por ownership** (só a vida, só quem não é OWNER do `Actor` base). As duas decisões não foram
reconciliadas por escrito — resolver aqui qual prevalece (ou se ambas se aplicam: papel primeiro,
ownership depois) antes de implementar, e não deduzir em silêncio.

### TK073 — O nome só chega a quem conhece o ator

`packages/server/src/net/redaction.ts` · modelo de conhecimento da `39`

O estado efetivo do usuário é o **maior entre seus personagens** — REQ-CTT-071 já diz isso, não é
regra nova. `conhecido` recebe o nome; `entrevisto` e `oculto` não. A arte viaja nos três (TK003).

**Cobre:** REQ-TOK-060, REQ-TOK-061, REQ-TOK-063, CA-TOK-008, CA-TOK-009 · **Pronto quando:**
passar de `entrevisto` para `conhecido` faz o nome aparecer nas peças já em cena **sem que nenhuma
peça tenha sido escrita** — é o teste que prova que a regra é do ator, não da peça.

### TK074 [P] — O rótulo da peça é exibição, não ocultação

`packages/client/src/lib/canvas/tokens/`

O nome próprio prevalece sobre o herdado e é visível a quem vê a peça; ele **não** protege
identidade. Sem essa fronteira nascem dois mecanismos concorrentes de "você não sabe quem é este".

**Cobre:** REQ-TOK-060, REQ-TOK-062

---

## Fase 7 — Exibição: o que o usuário escolhe ver

### TK080 — As duas preferências de exibição

`packages/client/src/` (ergonomia local, por mundo + usuário) · aba Configurações

Nome e barras: o usuário liga e desliga. Some `displayName`/`displayBars` de qualquer lugar que
ainda os tenha.

**Cobre:** REQ-TOK-015, REQ-TOK-074, REQ-TOK-075, REQ-TOK-076, CA-TOK-011 · **Pronto quando:**
existe o teste de T-7 — **o payload é idêntico** com a preferência ligada e desligada. Esse é o
teste que impede a preferência de virar filtro de servidor.

### TK081 [P] — Numeração como setting de mundo

`packages/server/` (`Setting`, REQ-DOC-018) · caminho de criação de peça

Age no nascimento, como valor inicial do rótulo. **O contador só cresce** — morto o Esqueleto 3, o
próximo nasce 7.

**Cobre:** REQ-TOK-064, REQ-TOK-065, CA-TOK-017 · **Em aberto:** Q-TOK-02 (por cena ou por mundo)
precisa de resposta antes desta tarefa.

### TK082 [P] — FIFO afirmado, e a guarda contra reordenação

`packages/client/src/lib/canvas/` · caminho genérico de `doc:update`

A ordem é a da coleção, sem campo de ordenação. O caminho genérico de update substitui a coleção
inteira com a ordem que o requisitante mandar — a guarda contra isso é o que torna a regra real.

**Cobre:** REQ-TOK-016, REQ-TOK-084, CA-TOK-016

### TK083 [P] — Peça não controlada para de aparecer degradada

`packages/client/src/lib/canvas/`

Ou a peça chega e é desenhada como qualquer outra, ou não chega. Esmaecer o que não se controla
sugere visão, que não existe. **Conferir se o defeito existe no código** — foi encontrado no
protótipo, e é o tipo de afetação que costuma estar nos dois.

**Cobre:** REQ-TOK-085, CA-TOK-018

### TK084 [P] — Ícones de status saem da peça

`packages/client/src/lib/canvas/tokens/`

REQ-CNV-029 foi aposentado (TK002). O registro de condição em REQ-SYS-043 continua — muda **onde**
aparece, não que exista. Para onde vai é de quem for dono da HUD.

**Cobre:** REQ-TOK-083

---

## Fase 8 — Ciclo de vida

### TK090 — As duas cópias

`packages/client/src/lib/canvas/` · servidor

Crua (estado vivo zerado) e idêntica (preservado). Em peça **vinculada** os dois modos colapsam num
só, e a interface não oferece escolha sem efeito. A `23` exige alternativa não-arraste para os dois.

**Cobre:** REQ-TOK-090, REQ-TOK-091, CA-TOK-013 · **Em aberto:** Q-TOK-01 (colapsar ou recusar).

### TK091 — Excluir o ator apaga as peças dele

`packages/server/src/net/handlers/doc-handlers.ts`

Cascata em **todas as cenas do mundo**, com broadcast de cada cena tocada — não é deleção de uma
linha só. É exceção deliberada à DEC-DOC-11, e o código precisa dizer isso em comentário, senão
alguém "conserta" de volta para soft reference.

**Cobre:** REQ-TOK-092, REQ-TOK-093, CA-TOK-015 · **Atenção:** REQ-ATR-041 já recusa excluir ator
com combate ativo — a cascata só roda onde a exclusão é permitida.

### TK092 [P] — Morrer não mexe na peça

`packages/server/` · consumo da faceta `container` da `45`

Nada nesta spec remove peça por consequência de estado do ator. O corpo caído ganha a faceta e
continua sendo a mesma peça, com o mesmo `_id`.

**Cobre:** REQ-TOK-094, REQ-TOK-095, CA-TOK-014

### TK093 [P] — `flags` como ponto de extensão, sem leitura pela engine

`packages/shared/src/scene.ts` · `tools/boundary-test`

A peça aceita; a engine não lê. Candidato natural a regra de `boundary-test`, como a `45` fez com
comparação de subtype contra literal.

**Cobre:** REQ-TOK-100, CA-TOK-019

---

## Fase 9 — Retirada de visão, névoa e colisão ⚠️ condicional a Q-TOK-04

**Não comece esta fase sem a resposta.** Ela não é decisão da `41`: visão/névoa está escrita como
[MVP] na `07` inteira, no MVP global da `00` (`REQ-ESC-006/007`), no marco M2 da `27` e no
`CLAUDE.md` do projeto. Tirar de verdade emenda os quatro.

Se a resposta for **sim**:

### TK100 — `vision` e `light` ficam inertes, e o resto é removido

`packages/shared/src/scene.ts` · `packages/client/src/lib/canvas/` · `packages/server/`

Os campos ficam declarados e sem comportamento (REQ-TOK-101). A issue **#164** deixa de ser
defeito e vira código a remover junto; a **#166** idem, por TK062.

**Cobre:** REQ-TOK-101, REQ-TOK-102

Se a resposta for **não**: TK062 vira o conserto da #166 (colisão passa a considerar o footprint),
#164 continua sendo defeito a corrigir, e esta fase é cancelada — `~~TK100~~` com o motivo.

---

## O que este plano deliberadamente não faz

| Assunto                                        | Por quê                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Amplificação de escrita do `token:move` (#169) | É frente de banco (DEC-TOK-21). O gatilho da revisão pede números de **sessão real**, que não temos   |
| Tabela própria para a peça                     | Herda o adiamento do plano de banco. A peça continua embutida (REQ-TOK-103)                           |
| Marcação de alvo                               | Q-TOK-05: segue sem dona. REQ-CNV-039 e as regras de combate especificam o mesmo gesto sem se citarem |
| Arraste concorrente / trava efêmera            | DEC-TOK-22: problema de servidor e rede, na Q5 da `04`                                                |
| Peça sem ator ("token rápido")                 | Q-TOK-03: adiado deliberadamente. A saída provável é o ator descartável, não exceção no modelo        |
| Onde os ícones de condição passam a viver      | DEC-TOK-19 os tira da peça; para onde vão é de quem for dono da HUD                                   |

---

## Ordem de execução, em uma linha

**Fase 0** (specs, sem código) → **Fase 1** (vínculo e forma) → **Fase 2** (defeitos vivos) →
**Fase 3** (herança) → **4** (permissões) → **5** (movimento) → **6** (redação) → **7** (exibição)
→ **8** (ciclo de vida) → **9** (condicional).

As Fases 0 e 1 são as únicas que bloqueiam tudo. A partir da 3, as fases podem ser reordenadas
conforme o que a mesa precisar primeiro — desde que nenhuma aba entre sem a sua metade de servidor
(T-3).
