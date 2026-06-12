# 10 — Combate e Iniciativa

**Status:** draft v0.1  
**Data:** 2026-06-11  
**Baseada em:**

- `docs/research/09-foundry-funcionalidades-mesa.md` — modelo Combat/Combatant, hooks de turno, combat turn marker, visibilidade de NPCs
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — iniciativa por skill no PF2e (Perception / Avoid Notice / Scout), iniciativa SF2e, economia de ações, condições (Dying, Stunned, Slowed, Quickened, Fleeing)

---

## Objetivo

Especificar o subsistema de combate tático do Fusion VTT: o modelo de dados de encontros (`Combat`/`Combatant`), o fluxo de iniciativa configurável por sistema, a progressão de turnos e rodadas, os eventos de ciclo de vida expostos à system API, e a interface visual do tracker.

---

## Escopo

### O que inclui

- Documento `Combat` e subdocumento embedded `Combatant`
- Criação, início, progressão e encerramento de encontros
- Rolagem de iniciativa individual e em massa; fórmula delegada à system API
- Desempate de iniciativa (regra por sistema)
- Reordenação manual por drag no tracker
- Fluxo de turno: próximo/anterior, marcação de `defeated`, skip de derrotados
- Eventos de ciclo de vida: `combatStart`, `turnStart`, `turnEnd`, `roundStart`, `roundEnd`, `combatEnd`
- UI do tracker: sidebar tab, visibilidade de NPCs ocultos para jogadores, destaque do token ativo, pan automático opcional
- Indicador visual de turno no canvas (combat turn marker sobre o token ativo)
- Targeting de tokens para ações
- Integração com condições de duração da system API (expirar efeitos ao fim de turno/rodada)
- Encontros do tipo "cinematic starship scene" (SF2e) como variante de `CombatType` [V2]

### O que NÃO inclui

- Delay e Ready action (comportamentos avançados de turno) → [V2]
- Multi-combates simultâneos → [V2]
- Automação completa de dano, condições e efeitos → ver `15-api-de-sistemas.md`
- Rolagem de dados 3D → ver `08-motor-de-rolagens.md`
- Chat de combate (mensagens de rolagem) → ver `09-chat-e-mensagens.md`
- Canvas, tokens e grid → ver `06-canvas-e-renderizacao.md`
- Fog of War e visão → ver `07-visao-iluminacao-fog.md`

---

## Conceitos e Terminologia

| Termo                    | Definição                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Combat**               | Documento de encontro persistido no banco do mundo; contém estado global (round, turn, started) e a lista de Combatants                                                                                                                                           |
| **Combatant**            | Subdocumento embedded em Combat; representa um participante (token + ator) com valor de iniciativa, flags e estado                                                                                                                                                |
| **Round**                | Uma rodada de combate; cada participante age exatamente uma vez por rodada; em PF2e, 1 round = 6 segundos                                                                                                                                                         |
| **Turn**                 | O turno de um Combatant específico dentro de um round; o índice `turnIndex` aponta o Combatant ativo                                                                                                                                                              |
| **Initiative**           | Número (`number`) que determina a posição base do Combatant na fila; o desempate é fornecido à parte pela system API (tiebreaker numérico ou comparator)                                                                                                          |
| **Tracker**              | Painel de interface (sidebar tab) que exibe e controla o estado do encontro                                                                                                                                                                                       |
| **Combat Turn Marker**   | Indicador visual no canvas (anel/halo) sobre o token do Combatant ativo                                                                                                                                                                                           |
| **Defeated**             | Flag `defeated: true`; indica que um participante foi eliminado; pode ser pulado automaticamente                                                                                                                                                                  |
| **Hidden (combatant)**   | Flag `hidden: true`; oculta o Combatant da visão dos jogadores no tracker, independente do token no canvas                                                                                                                                                        |
| **CombatLifecycleEvent** | Evento emitido pelo servidor no início/fim de turno ou rodada; consumido pela system API para expirar efeitos e disparar automações                                                                                                                               |
| **InitiativeFormula**    | Função registrada pela system API que recebe o Combatant e retorna a fórmula de dados (`string`) a ser rolada como iniciativa                                                                                                                                     |
| **Tiebreaker**           | Valor numérico secundário retornado pela system API para desempate (ex.: bônus de Perception em PF2e). Para desempates não-monotônicos (ex.: "jogadores vencem NPCs" no Etmos), a system API fornece um `compare(a, b)` em vez disso (`ver 15-...md` REQ-SYS-042) |

---

## Decisões de Design

### DEC-CBT-01 — Combat como document first-class persistido no banco

**Decisão:** `Combat` é um documento de primeiro nível persistido no `world.db`, não estado efêmero em memória. A lista de Combatants é armazenada como array embedded (não tabela separada).

**Alternativas rejeitadas:**

- _Estado em memória apenas_: impede recuperação após reconexão ou crash do servidor; inaceitável para sessões longas.
- _Combatants em tabela relacional separada_: aumenta complexidade de queries sem benefício relevante, dado que um encontro raramente ultrapassa 20 participantes.

**Racional:** Consistente com a arquitetura de Documents do Fusion (ver `02-modelo-de-dados.md`). Permite que o servidor seja autoritativo e sincronize estado via socket.io para todos os clientes reconectados.

---

### DEC-CBT-02 — Iniciativa desacoplada do sistema base; fórmula delegada à system API

**Decisão:** O documento `Combat` armazena apenas o número de iniciativa final (com tiebreaker opcional como decimal fracionário). A fórmula de rolagem, o atributo-chave e a regra de desempate são fornecidos pela system API via método `registerInitiativeFormula(combatType, fn)`.

**Alternativas rejeitadas:**

- _Fórmula hardcoded no núcleo_: impede SF2e (iniciativa de nave por papel) e Etmos (2d6+Corpo) de definir suas próprias fórmulas.
- _Campo de fórmula livre no documento_: mais flexível, mas empurra validação para o cliente; o servidor precisa conhecer a fórmula para executar RNG autoritativo.

**Racional:** O PF2e Remaster usa Perception por padrão mas permite qualquer skill de exploração como iniciativa (Stealth em Avoid Notice, skill de conhecimento em Investigate). SF2e usa o papel na nave para cinematic scenes. Etmos usa 2d6+Corpo. Um hook de fórmula delegada é o único modelo que acomoda os três sistemas sem fork do núcleo.

---

### DEC-CBT-03 — Rolagem de iniciativa executada no servidor (RNG autoritativo)

**Decisão:** A rolagem de iniciativa, como toda rolagem, é executada no servidor. O cliente envia uma requisição de `rollInitiative(combatantId, options)` via socket; o servidor executa, persiste o resultado e faz broadcast para todos.

**Alternativas rejeitadas:**

- _Rolagem no cliente com envio do resultado_: permite manipulação; contrária ao modelo anti-cheat do Fusion (ver `08-motor-de-rolagens.md`).

**Racional:** Consistência com o motor de rolagens geral (ver `08-motor-de-rolagens.md`).

---

### DEC-CBT-04 — Desempate fornecido pela system API: tiebreaker numérico ou comparator

**Decisão:** O valor de iniciativa de um Combatant é armazenado como `number` (float IEEE 754). O **desempate** é fornecido pela system API junto à `InitiativeFormula` (`ver 15-api-de-sistemas.md` REQ-SYS-042), de duas formas mutuamente combináveis:

- **`tiebreaker(combatant, ctx): number`** — valor numérico secundário (ex.: PF2e → modificador de Perception). O núcleo ordena por `initiative` descendente e, em empate, por `tiebreaker` descendente.
- **`compare(a, b): number`** — comparador total entre duas `InitiativeEntry` já roladas, para desempates **não-monotônicos** que não cabem num único número (ex.: Etmos "jogadores sempre vencem NPCs" independentemente do total). Quando fornecido, o núcleo ordena a fila usando esse comparador. `compare` tem precedência sobre `tiebreaker`.

Quando nenhum desempate é fornecido, o núcleo ordena apenas por `initiative` descendente.

**Alternativas rejeitadas:**

- _Tiebreaker embutido como casas decimais (ex.: `18.05`)_: só funciona para desempates monotônicos num único número; não expressa "jogadores vencem NPCs" do Etmos, onde um NPC com atributo maior não pode passar à frente de um jogador. Sujeito a perda de precisão e a limites de casas decimais.
- _Primeiro a rolar vence sem critério_: desfavorece sistemas com regras explícitas de desempate.

**Racional:** Separar `tiebreaker` (simples, numérico) de `compare` (geral, total) cobre tanto PF2e/SF2e quanto a regra pró-jogador do Etmos sem hardcode no núcleo. A system API é a dona da lógica de desempate; o núcleo apenas aplica o contrato.

---

### DEC-CBT-05 — Eventos de ciclo de vida via EventBus do servidor, não hooks no cliente

**Decisão:** Os eventos `combatStart`, `turnStart`, `turnEnd`, `roundStart`, `roundEnd`, `combatEnd` são emitidos pelo servidor via EventBus interno (Node.js `EventEmitter`) antes e depois das transições de estado. A system API registra handlers no servidor. Clientes recebem o estado atualizado via socket broadcast, não os eventos em si.

**Alternativas rejeitadas:**

- _Hooks disparados no cliente como no Foundry_: clientes podem estar desconectados; efeitos que expiram condições devem ocorrer no servidor independente de quem está online.
- _Polling de estado pelo sistema_: ineficiente e sujeito a race conditions.

**Racional:** Como o servidor é autoritativo, a lógica de expirar condições e processar efeitos automáticos deve rodar no servidor. A system API (pacotes `systems/*`) são compilados junto e rodam tanto no servidor quanto no cliente; os handlers de servidor processam automações.

---

### DEC-CBT-06 — MVP suporta exatamente um Combat ativo por cena; múltiplos são [V2]

**Decisão:** No MVP, cada cena admite no máximo um encontro ativo. O servidor rejeita criação de segundo `Combat` para a mesma cena com HTTP 409 se um já está em andamento.

**Alternativas rejeitadas:**

- _Múltiplos combates desde o início_: aumenta complexidade do tracker e do canvas (qual encontro destaca qual token); postergado para V2.

**Racional:** A maioria das sessões usa um único encontro por cena. Multi-combate (ex.: batalha dividida) é raro e pode ser resolvido em [V2].

---

### DEC-CBT-07 — Skip de defeated configurável por encontro (padrão: true)

**Decisão:** O documento `Combat` possui flag `skipDefeated: boolean` (padrão `true`). Quando ativo, a lógica de `nextTurn` pula automaticamente Combatants com `defeated: true`.

**Racional:** Comportamento universalmente esperado; configurável para sistemas que queiram que personagens mortos ainda "tenham iniciativa" (ex.: efeitos de morte imediata em PF2e que ocorrem no turno do derrotado).

---

### DEC-CBT-08 — Combat turn marker implementado no cliente via PixiJS; token destacado via shader

**Decisão:** O indicador visual de turno ativo é um efeito de anel/halo renderizado sobre o sprite do token na cena PixiJS. A implementação usa um `Graphics` ou `Sprite` overlay parametrizado (cor, animação de pulso). Não é um token separado.

**Alternativas rejeitadas:**

- _Overlay HTML sobre o canvas_: dessincroniza com transformações de zoom/pan do PixiJS.
- _Substituição da imagem do token_: destrutivo; perde a imagem original.

**Racional:** Consistente com a arquitetura de renderização PixiJS v8 descrita em `06-canvas-e-renderizacao.md`.

---

## Requisitos Funcionais

> **Convenção de numeração:** os IDs de requisito seguem blocos de dezena por seção — 001–009 (Gerenciamento de Encontros), 010–019 (Iniciativa), 020–029 (Fluxo de Turno e Rodada), 030–039 (Visibilidade e Permissões), 040–049 (UI do Tracker), 050–059 (Canvas — Combat Turn Marker e Targeting). Lacunas dentro de um bloco são intencionais e reservam espaço para requisitos futuros sem causar renumeração em cascata.

### Gerenciamento de Encontros

**REQ-CBT-001** [MVP] O sistema DEVE permitir ao GM criar um encontro (`Combat`) associado à cena ativa; o encontro é persistido no banco do mundo.

**REQ-CBT-002** [MVP] O sistema DEVE permitir adicionar tokens da cena ativa ao encontro como `Combatant`; cada Combatant referencia o `tokenId` e o `actorId` correspondentes.

**REQ-CBT-003** [MVP] O sistema DEVE permitir remover Combatants do encontro antes ou durante o combate.

**REQ-CBT-004** [MVP] O GM DEVE poder iniciar o encontro (`startCombat`), avançar ao próximo turno (`nextTurn`), recuar ao turno anterior (`previousTurn`), e encerrar o encontro (`endCombat`).

**REQ-CBT-005** [MVP] O sistema DEVE persistir o estado do encontro (`round`, `turnIndex`, `started`) após cada transição para que reconexões retomem o estado correto.

**REQ-CBT-006** [MVP] Ao encerrar um encontro, o servidor DEVE emitir o evento `combatEnd` antes de remover ou arquivar o documento.

**REQ-CBT-007** [V2] O sistema DEVE suportar múltiplos encontros simultâneos na mesma sessão de mundo; o tracker DEVE permitir alternar entre eles.

### Iniciativa

**REQ-CBT-010** [MVP] O sistema DEVE suportar rolagem de iniciativa individual para um Combatant específico.

**REQ-CBT-011** [MVP] O sistema DEVE suportar rolagem em massa: "roll all" (todos sem valor) e "roll NPCs" (apenas Combatants não-PC sem valor).

**REQ-CBT-012** [MVP] A fórmula de rolagem de iniciativa DEVE ser fornecida pela system API via `registerInitiativeFormula`; o núcleo não define fórmula default além de `1d20`.

**REQ-CBT-013** [MVP] A system API DEVE poder fornecer um desempate junto com a fórmula de iniciativa, via `tiebreaker(combatant, ctx): number` (valor numérico secundário) e/ou `compare(a, b): number` (comparador total entre duas entradas roladas), conforme `15-api-de-sistemas.md` REQ-SYS-042. O núcleo DEVE ordenar a fila aplicando: (1) `compare` quando fornecido; senão (2) `initiative` descendente com `tiebreaker` descendente como desempate secundário; senão (3) apenas `initiative` descendente.

**REQ-CBT-014** [MVP] O sistema DEVE permitir definição manual de iniciativa (sem rolagem) para qualquer Combatant com permissão adequada.

**REQ-CBT-015** [MVP] O sistema DEVE permitir resetar todos os valores de iniciativa para `null`, habilitando re-rolagem.

**REQ-CBT-016** [MVP] A ordem na fila (`turns`) DEVE ser gerada aplicando o desempate de REQ-CBT-013 (comparator do sistema quando fornecido; senão `initiative` descendente com `tiebreaker` secundário); Combatants com `initiative: null` ficam no final.

**REQ-CBT-017** [MVP] O sistema DEVE permitir reordenação manual da fila por drag-and-drop no tracker; a reordenação atualiza o campo `initiative` dos Combatants afetados para manter a nova ordem.

**REQ-CBT-018** [MVP] Em PF2e, a system API DEVE registrar fórmulas de iniciativa usando Perception (padrão) ou a skill escolhida pelo jogador para sua exploration activity; o Combatant armazena qual skill foi usada (`initiativeStatistic: string`).

**REQ-CBT-019** [MVP] Em Etmos, a system API DEVE registrar fórmula de iniciativa `2d6+Corpo`.

### Fluxo de Turno e Rodada

**REQ-CBT-020** [MVP] Ao iniciar o encontro, `round` DEVE ser definido como `1` e `turnIndex` como `0` (primeiro Combatant na fila).

**REQ-CBT-021** [MVP] `nextTurn` DEVE avançar `turnIndex` em 1; ao ultrapassar o último Combatant, DEVE incrementar `round` e retornar ao índice `0` (início da nova rodada).

**REQ-CBT-022** [MVP] `previousTurn` DEVE recuar `turnIndex` em 1; ao chegar antes do índice `0`, DEVE decrementar `round` e ir ao último Combatant da rodada anterior.

**REQ-CBT-023** [MVP] Com `skipDefeated: true`, `nextTurn` DEVE pular automaticamente Combatants com `defeated: true` durante a progressão.

**REQ-CBT-024** [MVP] O GM DEVE poder marcar um Combatant como `defeated`; o token correspondente no canvas DEVE receber um overlay visual de "derrotado" (ícone de caveira ou equivalente configurável pelo sistema).

**REQ-CBT-025** [MVP] O GM DEVE poder desmarcar `defeated` de um Combatant.

**REQ-CBT-026** [MVP] Ao final de cada turno, o servidor DEVE emitir o evento `turnEnd(combatant, combat)` antes de avançar o estado.

**REQ-CBT-027** [MVP] Ao início de cada turno, o servidor DEVE emitir o evento `turnStart(combatant, combat)` após atualizar o estado.

**REQ-CBT-028** [MVP] Ao final de cada rodada (quando `turnIndex` volta a `0`), o servidor DEVE emitir `roundEnd(combat)` e depois `roundStart(combat)` antes do primeiro turno da nova rodada.

**REQ-CBT-029** [MVP] A system API DEVE poder registrar handlers para `turnStart` e `turnEnd` para processar automações (ex.: decrementar condições numéricas como Frightened, processar Persistent Damage, executar Recovery Check para Dying).

**REQ-CBT-030** [V2] O sistema DEVE suportar as ações de turno `Delay` (postergar o turno para depois de outro Combatant na mesma rodada) e `Ready` (declarar uma reação com trigger).

### Visibilidade e Permissões

**REQ-CBT-031** [MVP] O GM DEVE poder ocultar um Combatant dos jogadores com flag `hidden: true`; Combatants ocultos NÃO aparecem no tracker para jogadores.

**REQ-CBT-032** [MVP] O GM DEVE ver todos os Combatants no tracker, incluindo os ocultos (com indicação visual de que estão ocultos).

**REQ-CBT-033** [MVP] Jogadores DEVEM ver seus próprios Combatants (PCs) e todos os Combatants não ocultos.

**REQ-CBT-034** [MVP] Jogadores DEVEM poder rolar a própria iniciativa (para seus PCs) a partir do tracker, se o encontro ainda não tiver sido iniciado ou se a iniciativa do PC for `null`.

**REQ-CBT-035** [MVP] Jogadores DEVEM poder definir manualmente `initiativeStatistic` nos seus PCs antes da rolagem (para sistemas como PF2e que permitem escolha de skill).

### UI do Tracker

**REQ-CBT-040** [MVP] O tracker DEVE ser exibido como aba da sidebar, acessível durante e fora de combate.

**REQ-CBT-041** [MVP] Cada linha do tracker DEVE exibir: imagem do token (miniatura), nome do Combatant (ou "???" se oculto), valor de iniciativa, HP atual/máximo (se disponível via system API), indicador de `defeated`, e controles contextuais.

**REQ-CBT-042** [MVP] O Combatant ativo (turno corrente) DEVE ser visualmente destacado no tracker (ex.: fundo colorido, borda ou indicador de turno).

**REQ-CBT-043** [MVP] O tracker DEVE exibir o número do round atual e botões de controle (Next Turn, Previous Turn, End Combat) acessíveis ao GM.

**REQ-CBT-044** [MVP] O tracker DEVE suportar reordenação manual via drag-and-drop nas linhas dos Combatants.

**REQ-CBT-045** [MVP] O sistema DEVE suportar pan automático opcional: quando `autoPan: true` no Combat, o canvas DEVE centralizar automaticamente o token ativo ao mudar de turno.

**REQ-CBT-046** [MVP] O tracker DEVE exibir um indicador de "combate não iniciado" quando `started: false`, com botão "Begin Combat" para o GM.

**REQ-CBT-047** [MVP] O tracker DEVE exibir um recurso rastreado configurável ao lado do HP (ex.: AC, nível, shield HP) via configuração de `trackedResource` no documento Combat; a system API fornece o valor.

### Canvas — Combat Turn Marker e Targeting

**REQ-CBT-050** [MVP] O sistema DEVE renderizar um combat turn marker (anel/halo visual animado) sobre o token ativo no canvas durante o combate.

**REQ-CBT-051** [MVP] O visual do combat turn marker DEVE ser parametrizável pelo sistema (cor, estilo); o padrão para PF2e DEVE ser um anel dourado.

**REQ-CBT-052** [MVP] Ao mudar de turno, o combat turn marker DEVE mover-se para o novo token ativo com transição suave (fade ou interpolação de posição).

**REQ-CBT-053** [MVP] O sistema DEVE suportar targeting: o GM ou jogador com permissão DEVE poder marcar tokens como alvos (`targeted: true`) para uso por automações e macros.

**REQ-CBT-054** [MVP] Tokens marcados como alvo DEVEM receber indicador visual no canvas (retícula ou anel colorido, diferente do turn marker).

**REQ-CBT-055** [MVP] O targeting DEVE ser limpo automaticamente ao fim do turno do Combatant que realizou o targeting, salvo configuração de sistema contrária.

---

## Requisitos Não-Funcionais

**REQ-CBT-NFR-001** [MVP] Transições de turno (nextTurn) DEVEM completar o ciclo servidor → broadcast → update no cliente em menos de 200 ms em condições normais de LAN.

**REQ-CBT-NFR-002** [MVP] O estado do Combat DEVE ser reconstruído corretamente após reconexão de qualquer cliente, incluindo turno e round atuais.

**REQ-CBT-NFR-003** [MVP] O tracker DEVE ser responsivo: funcionar em viewports de 320 px de largura sem perda de funcionalidade essencial (ver `23-acessibilidade-e-dispositivos.md`).

**REQ-CBT-NFR-004** [MVP] A ordenação da fila de iniciativa DEVE ser O(n log n) ou melhor; n ≤ 100 participantes é o limite esperado de encontro.

---

## Modelo de Dados

```typescript
// packages/shared/src/combat.ts

/** Documento principal de encontro */
export interface CombatDocument {
  _id: string;
  type: "Combat";
  sceneId: string; // cena à qual este encontro pertence
  round: number; // rodada atual (começa em 1)
  turnIndex: number; // índice do Combatant ativo em `turns`
  started: boolean; // false até beginCombat()
  ended: boolean; // true após endCombat()
  skipDefeated: boolean; // padrão true
  autoPan: boolean; // pan automático ao mudar turno
  combatType: string; // "standard" | "starship" (SF2e) | customizado
  trackedResource: string | null; // chave de atributo do ator a exibir (ex.: "attributes.hp")
  combatants: CombatantDocument[]; // embedded array, ordenado por initiative desc
  flags: Record<string, unknown>; // extensível por sistemas
  permission: PermissionMap; // ver 05-usuarios-e-permissoes.md
  sort: number;
  folder: string | null;
}

/** Participante embedded em CombatDocument */
export interface CombatantDocument {
  _id: string;
  tokenId: string;
  actorId: string;
  name: string; // snapshot do nome para exibição (pode divergir do ator)
  img: string; // snapshot da imagem do token
  initiative: number | null; // null = não rolou ainda
  initiativeStatistic: string | null; // qual skill/estatística foi usada (ex.: "perception", "stealth")
  hidden: boolean; // oculto dos jogadores no tracker
  defeated: boolean; // marcado como derrotado
  hasPlayerOwner: boolean; // cache; true se algum jogador é owner do ator
  flags: Record<string, unknown>; // extensível por sistemas
}

/** Snapshot imutável do estado antes/depois de transição */
export interface CombatTurnSnapshot {
  round: number;
  turnIndex: number;
  combatantId: string | null;
  tokenId: string | null;
}

/** Eventos emitidos pelo servidor (EventBus interno) */
export type CombatLifecycleEvent =
  | { type: "combatStart"; combat: CombatDocument }
  | {
      type: "turnStart";
      combat: CombatDocument;
      combatant: CombatantDocument;
      previous: CombatTurnSnapshot;
    }
  | { type: "turnEnd"; combat: CombatDocument; combatant: CombatantDocument }
  | { type: "roundStart"; combat: CombatDocument; round: number }
  | { type: "roundEnd"; combat: CombatDocument; round: number }
  | { type: "combatEnd"; combat: CombatDocument };

/** Contrato da system API para fórmula de iniciativa (ver 15-api-de-sistemas.md, InitiativeFormula) */
export interface InitiativeFormulaResult {
  formula: string; // ex.: "1d20+@perception" — resolvido pelo motor de rolagens
  tiebreaker?: number; // valor numérico secundário de desempate (ex.: bônus de Perception)
  statistic: string; // identificador human-readable para exibição (ex.: "Perception")
  // Desempate não-monotônico (ex.: "jogadores vencem NPCs" no Etmos) é fornecido como
  // `compare(a, b)` na InitiativeFormula registrada (ver 15-...md REQ-SYS-042), não aqui.
}

export type InitiativeFormulaFn = (
  combatant: CombatantDocument,
  actor: ActorDocument,
  options?: Record<string, unknown>,
) => InitiativeFormulaResult | Promise<InitiativeFormulaResult>;
```

---

## API e Eventos

### Endpoints REST (Fastify)

| Método   | Rota                                               | Permissão | Descrição                   |
| -------- | -------------------------------------------------- | --------- | --------------------------- |
| `POST`   | `/api/worlds/:worldId/combats`                     | GM        | Cria novo encontro          |
| `GET`    | `/api/worlds/:worldId/combats`                     | Observer  | Lista encontros do mundo    |
| `GET`    | `/api/worlds/:worldId/combats/:id`                 | Observer  | Retorna estado atual        |
| `PATCH`  | `/api/worlds/:worldId/combats/:id`                 | GM        | Atualiza campos do encontro |
| `DELETE` | `/api/worlds/:worldId/combats/:id`                 | GM        | Remove/arquiva encontro     |
| `POST`   | `/api/worlds/:worldId/combats/:id/combatants`      | GM        | Adiciona Combatant          |
| `DELETE` | `/api/worlds/:worldId/combats/:id/combatants/:cId` | GM        | Remove Combatant            |

### Mensagens Socket.io (namespace `/world`)

| Evento (cliente → servidor) | Payload                                | Descrição                                   |
| --------------------------- | -------------------------------------- | ------------------------------------------- |
| `combat:beginCombat`        | `{ combatId }`                         | GM inicia o encontro                        |
| `combat:nextTurn`           | `{ combatId }`                         | Avança turno                                |
| `combat:previousTurn`       | `{ combatId }`                         | Recua turno                                 |
| `combat:endCombat`          | `{ combatId }`                         | Encerra encontro                            |
| `combat:rollInitiative`     | `{ combatId, combatantIds, options? }` | Rola iniciativa para os combatants listados |
| `combat:setInitiative`      | `{ combatId, combatantId, value }`     | Define iniciativa manualmente               |
| `combat:resetInitiative`    | `{ combatId }`                         | Zera todas as iniciativas                   |
| `combat:reorder`            | `{ combatId, order: string[] }`        | Reordena combatants por drag (array de IDs) |
| `combat:setDefeated`        | `{ combatId, combatantId, defeated }`  | Marca/desmarca derrotado                    |
| `combat:setHidden`          | `{ combatId, combatantId, hidden }`    | Oculta/revela combatant                     |
| `combat:target`             | `{ tokenId, targeted, userId }`        | Marca/desmarca token como alvo              |

| Evento (servidor → clientes) | Payload                                                                   | Descrição                                                  |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `combat:created`             | `CombatDocument`                                                          | Novo encontro criado                                       |
| `combat:updated`             | `Partial<CombatDocument>`                                                 | Estado do encontro atualizado (inclui transições de turno) |
| `combat:deleted`             | `{ combatId }`                                                            | Encontro encerrado/removido                                |
| `combat:turnChange`          | `{ combatId, current: CombatTurnSnapshot, previous: CombatTurnSnapshot }` | Broadcast de mudança de turno para UI                      |
| `combat:initiativeSet`       | `{ combatId, combatantId, initiative }`                                   | Iniciativa individual atualizada                           |
| `token:targeted`             | `{ tokenId, targeted, userId }`                                           | Atualização de targeting                                   |

### system API — Métodos Relevantes

```typescript
// packages/system-api/src/combat.ts

interface CombatSystemHooks {
  /**
   * Registra a fórmula de iniciativa para este sistema.
   * Chamado no bootstrap do sistema.
   */
  registerInitiativeFormula(combatType: string, fn: InitiativeFormulaFn): void;

  /**
   * Retorna o valor numérico a exibir como "recurso rastreado"
   * (ex.: HP atual) para um Combatant no tracker.
   */
  getTrackedResource(
    combatant: CombatantDocument,
    actor: ActorDocument,
    key: string,
  ): { value: number; max: number; label: string } | null;

  /**
   * Hook executado no servidor ao início do turno de um Combatant.
   * Pode retornar um array de atualizações a aplicar ao ator/combatant.
   */
  turnStart(combatant: CombatantDocument, combat: CombatDocument): Promise<void>;

  /**
   * Hook executado no servidor ao fim do turno de um Combatant.
   * Exemplo de uso: processar Persistent Damage, decrementar Frightened/Stunned.
   */
  turnEnd(combatant: CombatantDocument, combat: CombatDocument): Promise<void>;

  /**
   * Hook executado ao início de cada nova rodada.
   * Exemplo: decrementar condições que expiram por rodada.
   */
  roundStart(combat: CombatDocument): Promise<void>;
}
```

---

## Dependências (Specs Irmãs)

| Spec                          | Dependência                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `02-modelo-de-dados.md`       | Estrutura base de Documents; campos `_id`, `flags`, `permission`, `folder`       |
| `03-persistencia-e-mundos.md` | Persistência no `world.db`; WAL mode; transações ACID para transições de turno   |
| `04-rede-e-sincronizacao.md`  | Protocolo socket.io; servidor autoritativo; namespace `/world`; broadcast        |
| `05-usuarios-e-permissoes.md` | `PermissionMap`; quem pode controlar o tracker                                   |
| `06-canvas-e-renderizacao.md` | Renderização do combat turn marker; targeting visual; integração com token layer |
| `08-motor-de-rolagens.md`     | Execução da fórmula de iniciativa no servidor; resolução de `@atributos`         |
| `09-chat-e-mensagens.md`      | Mensagens de resultado de iniciativa e avanço de turno no chat                   |
| `15-api-de-sistemas.md`       | `InitiativeFormulaFn`; `CombatSystemHooks`; expiração de efeitos por turno       |
| `17-sistema-pf2e.md`          | Implementação concreta da iniciativa PF2e (Perception/skill) e hooks de turno    |
| `18-sistema-sf2e.md`          | Iniciativa SF2e por papel na nave (cinematic scenes)                             |
| `19-sistema-etmos.md`         | Fórmula de iniciativa Etmos (2d6+Corpo)                                          |

---

## Critérios de Aceitação

| ID         | Critério                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-CBT-001 | GM cria encontro na cena ativa, adiciona 4 tokens; todos aparecem no tracker como Combatants com initiative `null`.                                                                                         |
| CA-CBT-002 | GM clica "Roll All"; servidor executa rolagens autoritativas para todos os 4 Combatants; fila é ordenada descrescentemente; resultado aparece no chat.                                                      |
| CA-CBT-003 | GM clica "Begin Combat"; round exibe "1", turno do primeiro Combatant é destacado no tracker e o combat turn marker aparece sobre o token no canvas.                                                        |
| CA-CBT-004 | GM clica "Next Turn" 4 vezes; round incrementa para "2" e o ciclo recomeça corretamente.                                                                                                                    |
| CA-CBT-005 | GM marca um Combatant como Defeated; com skipDefeated ativo, esse Combatant é pulado nas chamadas subsequentes de "Next Turn".                                                                              |
| CA-CBT-006 | GM seta hidden em um NPC; cliente de jogador não vê esse Combatant no tracker; GM o vê com indicador de "oculto".                                                                                           |
| CA-CBT-007 | Jogador arrasta sua linha no tracker para uma posição diferente; a fila é reordenada e o servidor persiste a nova ordem; outros clientes refletem a mudança em ≤ 200 ms.                                    |
| CA-CBT-008 | Um cliente se desconecta e reconecta durante o combate; ao reconectar, recebe o estado atual (round, turnIndex, lista de Combatants com iniciativas) sem necessidade de ação do GM.                         |
| CA-CBT-009 | Sistema PF2e registra fórmula de iniciativa via Stealth (Avoid Notice); ao rolar iniciativa de um PC com essa opção selecionada, o servidor usa a fórmula correta e salva `initiativeStatistic: "stealth"`. |
| CA-CBT-010 | Pan automático habilitado: ao avançar turno, canvas centraliza no token ativo; ao desabilitar, canvas não se move.                                                                                          |
| CA-CBT-011 | GM encerra encontro; evento `combatEnd` é disparado; documento Combat é arquivado; tracker exibe estado vazio.                                                                                              |
| CA-CBT-012 | Handler `turnEnd` registrado pelo PF2e decrementa condição `Frightened` do Combatant ao final do seu turno; atualização do ator é persistida e transmitida a todos.                                         |

---

## Questões em Aberto

1. **Iniciativa PF2e — Scout Activity:** a atividade de exploração Scout concede +1 circunstancial à iniciativa de _todo o grupo_. Como o bônus afeta todos os Combatants do grupo e é declarado por um único PC, a system API precisa de acesso à lista completa de Combatants no momento da rolagem. O núcleo deve fornecer o array `combatants` como parâmetro extra da `InitiativeFormulaFn`, ou a responsabilidade de aplicar o bônus cai no handler `combatStart` do sistema?

2. **Iniciativa em combate de naves SF2e:** cada jogador escolhe um papel (Captain, Engineer, Gunner, etc.) e usa uma skill específica para iniciativa. O `initiativeStatistic` por Combatant resolve parcialmente isso, mas o papel precisa ser armazenado antes do combate começar. O modelo `CombatantDocument` deve ter campo `role` ou isso fica em `flags.sf2e.shipRole`?

3. **Persistência histórica de encontros:** após `endCombat`, o documento deve ser deletado ou arquivado (movido para coleção de histórico)? Histórico de combates é útil para analytics e review pós-sessão, mas aumenta o tamanho do banco.

4. **Visibilidade de nomes de NPCs ocultos no tracker:** quando `hidden: true`, o nome exibido para o GM deve ser o nome real ou pode ser mascarado para simular o ponto de vista de um jogador? Uma flag `revealedName` separada permitiria nomear o NPC como "Criatura Misteriosa" no tracker dos jogadores.

5. **Combat turn marker para múltiplos tokens ativos (SF2e com combate de grupo):** em sistemas onde múltiplos Combatants podem agir simultaneamente no mesmo turno, o marcador deve aparecer em todos ou apenas no "líder"? Decisão postergada para [V2] junto com multi-combates.

6. **Targeting cross-user:** se dois jogadores miram o mesmo token e um limpa o targeting ao final do turno, o targeting do outro deve ser preservado? A atual proposta limpa por `userId`, o que preserva outros usuários' targeti. Confirmar se essa é a semântica desejada.

7. **Archival automático de encontros encerrados:** definir período de retenção e se o `world.db` deve manter histórico ou apenas a sessão corrente.

---

## Referências

- `docs/research/09-foundry-funcionalidades-mesa.md` — Seções 1.1–1.9 (Combat Tracker, modelo, turnos, hooks, combat turn marker)
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — Seção 12 (Modos de jogo, iniciativa PF2e Remaster, Scout/Avoid Notice), Seção 15.8 (Cinematic Starship Scenes SF2e), Seção 7 (condições com expiração por turno)
- Archives of Nethys PF2e — [Encounter Mode / Initiative](https://2e.aonprd.com/Rules.aspx?ID=1026)
- Archives of Nethys SF2e — [Cinematic Starship Scenes](https://2e.aonsrd.com/rules/1179-cinematic-starship-scenes)
- Foundry VTT Knowledge Base — [Combat Encounters](https://foundryvtt.com/article/combat/) (referência comportamental; nenhum código copiado)
