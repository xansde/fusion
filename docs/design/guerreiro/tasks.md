# Guerreiro — plano de tarefas consolidado (G-F0 a G-F7)

> Origem: inventário do Guerreiro no vault (`Projects/fusion/guerreiro/`, 158 notas), conferido contra o código em 2026-09-16.
> Linha: **pessoal alfa**. Toda branch parte de `alfa/app` (core) e de `main` (satélite), **depois do merge da frente do Alquimista em alfa** (D-G16), e volta por PR de lote; satélite com PR no `xansde/fusion-systems-2e` + bump de pin no core.
> Processo: TDD não circular, rolagem e permissão no servidor, redação só via `net/redaction.ts` + `isRolePrivileged`, UI por `docs/design/PROCESSO-UI.md` com o protótipo `docs/design/guerreiro/prototipo-guerreiro.html` como lente obrigatória, porta de teste via `helpers/ports.ts`.
> Execução: skill `/guerreiro` (`.claude/skills/guerreiro/`), sobre os scripts genéricos de `.claude/skills/_frentes/`.

**A diferença desta frente para as duas anteriores**: a classe já está no ar. Os 112 talentos e as
16 habilidades estão publicados no pin v0.1.1, com pt-BR 112/112 e 16/16, e a varredura de
construção de ficha passa 6/6 no Fighter. Não há fase "colocar a classe no ar" — **toda a fila é
combate**. O inventário mediu o tamanho do buraco: dos 50 mecanismos que os 129 documentos
exigem, **um** funciona; 83 das 86 regras escritas nesses documentos são inertes; e nenhum dos
129 documentos funciona hoje de ponta a ponta.

**O que este plano NÃO cobre, por decisão**: o motor de rule elements, o materializador de itens,
aplicar dano e condição, a expiração de efeito e a preparação diária são entregues pelo **plano do
Alquimista** e aparecem aqui só como dependência externa, nomeadas pela tarefa `ALQ-*` que as
entrega. A postura genérica é da `ANI-F3-03`. A contagem das três ações do turno segue fora de
escopo (D-15), com uma exceção: o **pool de reações** (D-G14), que não é regra dura e sim valor
derivado do ator — sem ele a G-F4 não existe.

**Quando esta frente roda**: por último. O Alexandre fixou a ordem — **Alquimista → Animista →
Guerreiro** (D-G18) — e vai mergear a frente do Alquimista em `alfa/app` ao fim dela (D-G16).
As 15 tarefas externas que este plano cita, portanto, **já estarão entregues** quando ele
arrancar: o risco deixa de ser bloqueio e passa a ser **rebase**. Em troca, nenhuma ficha aqui
pode assumir que o código das outras frentes saiu exatamente como a descrição delas prometia —
a primeira coisa que cada tarefa faz é conferir o que existe, não o que estava escrito.

## 1. Decisões

### 1.1 Decisões desta rodada (2026-09-16)

Todas saem do inventário conferido contra o código. **As oito que mudavam o plano foram
respondidas pelo Alexandre em 2026-09-16** e estão marcadas como decididas, com as emendas que
ele fez; as demais são escolhas de desenho de menor alcance, que seguem como propostas até
alguém discordar. A tarefa afetada está na última coluna.

| ID    | Tema                      | Proposta                                                                                                                                                                                                                                                                                                                                                         | Racional                                                                                                                                                                                                                                                                                                                                                                                                                            | Tarefas              |
| ----- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| D-G01 | Gesto de mira             | **DECIDIDO.** Clique com o botão direito num token alterna a mira; `Esc` limpa a mira do usuário. Sem menu de contexto, sem botão na fila.                                                                                                                                                                                                                       | DEC-CBA-05 já decidiu que mirar é gesto espacial e vive no canvas, e o teste REQ-CBA-076 provou a remoção do controle do painel. Falta só o gesto. O botão esquerdo já é seleção e arraste.                                                                                                                                                                                                                                         | GUE-F1-01            |
| D-G02 | Quem decide o crítico     | **DECIDIDO.** O servidor, sempre que houver alvo mirado: o card de golpe mostra o grau e oferece **um** botão de dano coerente com ele. Sem alvo, o card continua como hoje, com os dois botões.                                                                                                                                                                 | A graduação já existe e é testada com socket (`chat-handler.ts:451-507`); e mesa sem mapa é caso real, não exceção.                                                                                                                                                                                                                                                                                                                 | GUE-F1-03            |
| D-G03 | MAP                       | **DECIDIDO.** Contado pelo servidor e mostrado na ficha: um botão de golpe que já traz o MAP corrente. Os três botões viram um seletor recolhido de "forçar MAP", para o ataque que não conta.                                                                                                                                                                   | O jogador contar sozinho é a fonte nº 1 de erro de mesa, e o ponto de reset (`turnStart`) já existe e é testado.                                                                                                                                                                                                                                                                                                                    | GUE-F1-04, GUE-F1-05 |
| D-G04 | Como a reação é oferecida | **Anotação no canto** do jogador dono, no mesmo slot da D-16 — e **sem cronômetro**, exatamente como a D-18 já fixou: a oferta some no próximo evento do mesmo personagem. Nunca modal, nunca bloqueando o turno de quem agiu.                                                                                                                                   | Herda o que o Alquimista decidiu; o Guerreiro só traz volume (23 documentos) e o caso de duas ofertas ao mesmo tempo.                                                                                                                                                                                                                                                                                                               | GUE-F4-03            |
| D-G05 | Quais gatilhos entram     | Três no MVP, registrados no `ReactionTrigger` da `ALQ-F7-05`: **movimento ou manipulação ao seu alcance** (Golpe Reativo), **você é atingido** (Bloqueio de Escudo, Escudo Reflexivo) e **erraram você** (Ripostar em Duelo). O resto fica declarado no documento, sem automação.                                                                                | Cobrem as duas habilidades de nível 1 e a maior parte dos 23 documentos de reação; os outros dependem de conjuração ou de área.                                                                                                                                                                                                                                                                                                     | GUE-F4-02            |
| D-G06 | Flanqueio                 | **DECIDIDO, com emenda.** Automático: o servidor calcula a partir das posições e aplica desprevenido como estado derivado, com chave de desligar por mundo. **Emenda do Alexandre**: continua sendo possível **forçar desprevenido à mão**, independentemente da posição — o toggle manual vale mesmo quando a geometria discorda, e o automático nunca o apaga. | É a condição mais citada da classe (16 vezes nos textos) e a geometria já existe e é testada em `shared/grid` e `shared/vision` — falta a regra consumir. A emenda cobre o caso real de mesa: desprevenido vem de muita coisa além de flanqueio, e o Mestre decide.                                                                                                                                                                 | GUE-F3-02            |
| D-G07 | Estado do escudo          | No **item**: `hp` e `broken` no escudo. "Erguido" é **efeito com duração** até o começo do seu próximo turno, não campo do ator.                                                                                                                                                                                                                                 | Dois escudos no inventário são dois estados; e a duração já vai existir pela `ALQ-F2-09`.                                                                                                                                                                                                                                                                                                                                           | GUE-F5-01, GUE-F5-02 |
| D-G08 | Onde ficam as manobras    | A **aba Ações vira executora** para as seis manobras e para Erguer o Escudo: clicar rola contra a CD do alvo mirado e o card oferece aplicar o efeito. As outras ~500 ações do pack continuam navegáveis.                                                                                                                                                        | A aba já existe como browser; virar executora só para o que tem regra é mais barato do que uma aba nova.                                                                                                                                                                                                                                                                                                                            | GUE-F5-03            |
| D-G09 | Grupo de arma             | Entra pela porta que a **`ALQ-F1-01` já abriu**: `system.proficiencies.attacks["group:sword"]` (REQ-PF2-207), com a escolha aparecendo como eixo no Plano, no padrão da `ANI-F0-06`. A **progressão** por nível segue o padrão que a `ANI-F0-07` estabelece para conjuração — hoje nenhum dos dois planos entrega progressão de proficiência de arma.            | Não se inventa eixo novo de proficiência; o mapa e o padrão de progressão já estão decididos em outro lugar.                                                                                                                                                                                                                                                                                                                        | GUE-F6-02            |
| D-G10 | Especialização crítica    | **Oferecida, não aplicada**: no crítico, o card mostra o efeito do grupo com um botão.                                                                                                                                                                                                                                                                           | Quase todo efeito de especialização é condição no alvo, e aplicar condição em outro ator sem clique humano é o tipo de automação que a mesa rejeita.                                                                                                                                                                                                                                                                                | GUE-F6-03            |
| D-G11 | Mãos                      | **Duas mãos nomeadas** (`left`/`right`), não um contador de mãos livres.                                                                                                                                                                                                                                                                                         | As regras testam as duas coisas; contador não distingue largar o escudo de largar a arma.                                                                                                                                                                                                                                                                                                                                           | GUE-F5-04            |
| D-G12 | Postura                   | **Reusa a `ANI-F3-03`** (uma por vez, exclusividade imposta pelo sistema, D-A09). O Guerreiro só traz os 14 documentos e o gatilho.                                                                                                                                                                                                                              | Mecanismo genérico já planejado; duplicar seria criar duas verdades.                                                                                                                                                                                                                                                                                                                                                                | GUE-F6-01            |
| D-G13 | Ataque em vários alvos    | **DECIDIDO.** Rever a REQ-ACH-074 para permitir N ataques correlacionados num card só, em vez de N mensagens soltas.                                                                                                                                                                                                                                             | Hoje a API diz, por escrito, que um ataque carrega exatamente um alvo; 10 documentos do Guerreiro não cabem nisso.                                                                                                                                                                                                                                                                                                                  | GUE-F6-04            |
| D-G14 | Pool de reações           | **DECIDIDO, reformulado pelo Alexandre.** Não é regra dura: o número de reações é **valor derivado do ator, que talento alcança e altera**. O pool base entrega uma ficha por rodada; um `ReactionGrant` acrescenta fichas com restrição de uso e validade próprias (§2.4). As três ações do turno continuam fora de escopo.                                     | "Existem talentos que concedem mais reações, então não pode ser uma regra dura" — e o Guerreiro tem os dois casos que provam: **Reflexos Táticos** (nível 10) dá uma reação a mais **só para Golpe Reativo**, e **Represálias Sem Limite** (nível 20) dá uma reação no início do turno de **cada inimigo**, válida só naquele turno. Nenhum dos dois cabe em "+1 no contador". A `ALQ-F7-05` não tem orçamento nenhum, por escrito. | GUE-F4-01            |
| D-G15 | Flexibilidade de Combate  | Entra, na **preparação diária** da `ALQ-F3-05`, como talento temporário com filtro de elegibilidade.                                                                                                                                                                                                                                                             | Três habilidades da classe dependem dela (níveis 9 e 15, mais o talento de nível 20).                                                                                                                                                                                                                                                                                                                                               | GUE-F7-01            |
| D-G16 | Base das branches         | **DECIDIDO, mudou.** `feat/guerreiro` nasce de **`alfa/app`** (core) e de **`main`** (satélite) — mas **só depois que o Alexandre mergear a frente do Alquimista em alfa**, o que ele fará ao fim dela. Não se parte de `feat/alquimista`.                                                                                                                       | "Quando a parte do Alquimista finalizar eu vou mergear em alfa." Com isso, as peças de que este plano depende chegam pela linha normal, e a frente não fica pendurada na branch de outra. Enquanto o merge não acontece, a branch do plano (`docs/guerreiro-tasks`) espera — não se arranca a frente antes.                                                                                                                         | —                    |
| D-G17 | Cobertura                 | **Fora do MVP do plano** (2 documentos): vira issue, com a `PositionQuery` já preparada para recebê-la.                                                                                                                                                                                                                                                          | Custo de geometria alto para dois documentos; melhor quando houver frente de canvas.                                                                                                                                                                                                                                                                                                                                                | — (issue)            |
| D-G18 | Ordem das três frentes    | **DECIDIDO.** As frentes rodam **em série**: Alquimista → Animista → **Guerreiro por último**. Logo, **não** se antecipa o motor de reação: a G-F4 consome o `ReactionTrigger` da `ALQ-F7-05`, que já terá sido entregue quando esta frente arrancar.                                                                                                            | Ordem definida pelo Alexandre. Ela resolve sozinha o problema de calendário que motivava antecipar: as 15 dependências externas estarão prontas, e o risco passa a ser de **rebase**, não de bloqueio. Em troca, o plano não pode assumir que o código das outras frentes está igual ao que as fichas descrevem — cada tarefa confere antes de mexer.                                                                               | GUE-F4-01, GUE-F4-02 |

### 1.2 Decisões herdadas (valem aqui, não se rediscutem)

| ID                       | Origem     | Decisão                                                                                                                              | Onde pesa no Guerreiro                                                                                                   |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| D-02 / DEC-CBT-10        | Alquimista | Jogador aplica o dano em todos os alvos da ação; foto dos alvos no momento da rolagem                                                | o golpe grava o alvo na própria mensagem                                                                                 |
| D-03                     | Alquimista | NPC a 0 PV ganha `dead` visível e `defeated`                                                                                         | qualquer golpe que derruba um NPC                                                                                        |
| D-04                     | Alquimista | O jogador vê só o dano causado, sem PV restantes                                                                                     | card do golpe                                                                                                            |
| D-05                     | Alquimista | Sem relógio de mundo: efeito expira no descanso ou por remoção                                                                       | postura e escudo erguido fora de combate                                                                                 |
| D-10                     | Alquimista | Scanners antigos migram para o `RuleElementRegistry`                                                                                 | Especialização em Arma e runas do Guerreiro passam pelo registro                                                         |
| D-11                     | Alquimista | Toggle de roll option: o jogador liga no próprio ator, sem aprovação do Mestre                                                       | os 16 talentos toggleable do Guerreiro                                                                                   |
| D-13 / DEC-CBT-09        | Alquimista | Hooks de turno rodam para PC e NPC, em série, depois de persistir                                                                    | reset do MAP e expiração do escudo erguido                                                                               |
| D-14                     | Alquimista | `AdjustDegreeOfSuccess` ligado para todas as classes, sem lista                                                                      | os talentos de "em crítico, X" do Guerreiro não precisam de tarefa de habilitação                                        |
| D-15                     | Alquimista | Contador de ações por turno fora de escopo                                                                                           | 16 documentos do Guerreiro seguem sem fechar (§8); a D-G14 abre a exceção da reação, e ela é pool derivado, não contador |
| D-16                     | Alquimista | Estado temporizado vira anotação no canto para Mestre e afetado                                                                      | oferta de reação, escudo erguido, postura ativa                                                                          |
| D-18                     | Alquimista | Oferta de reação sem cronômetro: some no próximo evento do mesmo personagem                                                          | GUE-F4-03                                                                                                                |
| DF-02                    | Alquimista | Aplicar dano é op de servidor do core; a conta é superfície do sistema                                                               | bloqueio de escudo e dano do golpe                                                                                       |
| DF-03                    | Alquimista | Montante e alvos vêm da mensagem gravada, nunca do cliente; valor manual só do Mestre                                                | anti-cheat do golpe                                                                                                      |
| DF-15 (emenda 15/09)     | Alquimista | Rule element registra por `kind`; os 5 handlers MVP usam camelCase por compatibilidade, **todo handler novo registra em kebab-case** | qualquer RE novo do eixo marcial                                                                                         |
| DEC-SYS-11/12            | Alquimista | Hooks de turno são registro com id e prioridade; aplicar dano/condição é op do core                                                  | contador de MAP e bloqueio de escudo se registram aí                                                                     |
| D-A09                    | Animista   | Postura: uma por vez, exclusividade imposta pelo sistema                                                                             | os 14 talentos de postura do Guerreiro                                                                                   |
| DEC-CBA-05 / REQ-CBA-076 | spec 40    | Mirar é gesto espacial e vive no canvas, não no painel                                                                               | GUE-F1-01                                                                                                                |

### 1.3 Numeração de specs

| Spec                         | Prefixo    | Dono      | Estado |
| ---------------------------- | ---------- | --------- | ------ |
| 51 — `51-combate-marcial.md` | `REQ-GUE-` | GUE-F0-01 | nova   |

`GUE` conferido livre: não há nenhuma ocorrência de `REQ-GUE`/`DEC-GUE` em `specs/`. A spec 51
é o primeiro número realmente livre — 33 (Motor de Campanha) e 46 (Recipientes) estão
reservadas no `README.md`, e 47/48/49 (Alquimista) e 50 (Animista) estão reservadas **só nos
tasks.md daqueles planos**, sem linha no registro canônico. A `GUE-F0-01` corrige isso de
passagem: acrescenta 47–51 à seção de números reservados do `specs/README.md`.

Reserva de ids nas specs existentes, **acima do que os dois planos anteriores já reservaram**
(Alquimista vai até `REQ-PF2-235`, `REQ-SYS-152`, `REQ-CBT-060`, `REQ-CHT-053`, `REQ-CNV-096`;
Animista reservou `REQ-PF2-236..244`, `REQ-SYS-153..158`, `REQ-CNV-097..099`,
`REQ-CBT-061..062`):

| Faixa                                | Tarefa dona                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `REQ-GUE-001..300`, `DEC-GUE-01..18` | GUE-F0-01                                                          |
| `REQ-PF2-245..278`                   | GUE-F0-01 (emendas da 17)                                          |
| `REQ-CBT-063..067`                   | GUE-F0-01 (emendas da 10: MAP, reação, posição)                    |
| `REQ-CNV-100..104`                   | GUE-F0-01 (emendas da 06: mira, distância, flanqueio)              |
| `REQ-CHT-054..060`                   | GUE-F0-01 (emendas da 09: contexto de ataque e de perícia no card) |
| `REQ-SYS-159..160`                   | GUE-F0-01 (emendas da 15: predicado e reação como mecanismo)       |
| `REQ-ACH-093..096`                   | GUE-F6-04 (revisão da REQ-ACH-074, um ataque = um alvo)            |

Os números saem do `tools/reqs.cjs`, que reatribui as faixas na ordem das fichas — a tabela
acima é o resultado dele, não uma reserva escrita à mão. Ids dentro de uma faixa ficam com a
ficha que os consumiu; a `GUE-F0-01` declara o bloco inteiro na spec.

**Nenhuma dessas faixas anteriores está escrita nas specs reais ainda** — só a `ALQ-F1-01`
integrou (até `REQ-PF2-216`). Se um dos dois planos andar antes deste, a `GUE-F0-01` rebaseia a
faixa antes de escrever: o `spec-lint` não enxerga reserva de branch não mergeada.

## 2. Contratos canônicos

Um shape por contrato. A tarefa dona fixa em spec e tipa; quem consome segue o nome e a forma daqui.

| Contrato                            | Dono      | Consumidores                               |
| ----------------------------------- | --------- | ------------------------------------------ |
| `AttackCheckContext`                | GUE-F1-03 | GUE-F1-05, GUE-F1-06, GUE-F3-03, GUE-F6-03 |
| `TargetGesture`                     | GUE-F1-01 | GUE-F1-02, GUE-F5-03, GUE-F6-04            |
| `MapCounter`                        | GUE-F1-04 | GUE-F1-05, GUE-F1-06, GUE-F4-04            |
| `ReactionPool` / `ReactionGrant`    | GUE-F4-01 | GUE-F4-02..04, GUE-F5-02                   |
| `ReactionTrigger` / `ReactionOffer` | GUE-F4-02 | GUE-F4-03, GUE-F4-04, GUE-F5-02            |
| `ShieldState`                       | GUE-F5-01 | GUE-F5-02                                  |
| `ManeuverAction`                    | GUE-F5-03 | GUE-F5-05, GUE-F6-03                       |
| `HandState`                         | GUE-F5-04 | GUE-F2-03 (predicado), GUE-F6-01           |
| `PositionQuery`                     | GUE-F3-01 | GUE-F3-02, GUE-F3-03, GUE-F3-04, GUE-F4-02 |
| `SkillCheckContext`                 | GUE-F5-05 | GUE-F5-03                                  |
| `WeaponGroupChoice`                 | GUE-F6-02 | GUE-F6-03                                  |
| `CritSpecEffect`                    | GUE-F6-03 | —                                          |

### 2.1 `AttackCheckContext` — o grau de sucesso do golpe (GUE-F1-03)

O servidor já grada ataque contra CA (`packages/server/src/chat/chat-handler.ts:451-507`,
`computeAttackDegree` em `:1620`), e `CheckContextSchema`
(`packages/shared/src/chat/types.ts:389-398`) é uma união discriminada que o comentário do
próprio arquivo deixou aberta: "`kind` keeps the shape open for attack/skill checks without a
breaking change". Esta tarefa exerce essa abertura — não inventa contrato novo.

```ts
// packages/shared/src/chat/types.ts — terceiro membro de CheckContextSchema
const AttackCheckContextSchema = z.object({
  kind: z.literal("attack"),
  /** Token mirado; a CA vem do banco, NUNCA do payload (REQ-ACH-070). */
  targetTokenId: z.string().min(1),
  /** Índice de MAP efetivamente aplicado — auditoria, não entra na conta. */
  mapIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Arma ágil: muda a penalidade para -4/-8 (engine-2e/src/map.ts:31). */
  agile: z.boolean().optional(),
});
```

O `payload.target` continua sendo o caminho de resolução do retrato (já implementado); o
`checkContext` acrescenta **por que** a rolagem é um ataque, para o card saber qual botão de
dano mostrar. Sem alvo resolvível não há grau (REQ-ACH-071) e o card cai no comportamento de
hoje: dois botões, escolha do jogador.

### 2.2 `TargetGesture` — mirar no canvas (GUE-F1-01)

Não há tipo novo: o handler `combat:target`
(`packages/server/src/combat/target-handler.ts:92-114`), o broadcast `token:targeted`, a
limpeza no fim do turno (`:169-180`) e a retícula PIXI
(`packages/client/src/lib/canvas/combat/TargetingMarker.ts`) já existem e são testados. O que
o contrato fixa é o **gesto** e o **leitor**:

```ts
// packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts
//   gesto → combatActions.target(socket, tokenId, next)  (combatStore.svelte.ts:391-410)
// packages/client/src/lib/combat/targeting.ts — getTargetingState() / isTargetedByUser()
```

A leitura para quem monta um payload de rolagem **não nasce aqui**: `getMyTargets()` e
`setMyTargets()` são entregues pela `ALQ-F1-05`, que também copia a seleção para
`flags.fusion.targetSnapshot` na hora de gravar a mensagem (D-02 do Alquimista). O que falta,
e é o que esta tarefa entrega, é o **gesto** — a única coisa que a DEC-CBA-05 prometeu e
ninguém implementou.

### 2.3 `MapCounter` — a penalidade de ataque múltiplo (GUE-F1-04)

```ts
// packages/server/src/combat/map-counter.ts
interface MapCounterState {
  /** combatantId → ataques já feitos NESTE turno. */
  attacks: Record<string, number>;
}
/** Lido pela ficha para saber qual variante oferecer. */
getAttackCount(combatId: string, combatantId: string): number;
/** Incrementado pelo chat-handler quando um AttackCheckContext grada. */
noteAttack(combatId: string, combatantId: string, opts: { countsForMap: boolean }): number;
// zerado por onLifecycle("turnStart") — o bus existe e hoje tem UM consumidor
// (target-handler.ts:169-180).
```

O cálculo em si não se reescreve: `calculateMapPenalty(attackNumber, weaponAgile)`
(`systems/engine-2e/src/map.ts:31`) já é puro e testado. O que nasce aqui é **quem conta**.

### 2.4 `ReactionPool` e `ReactionOffer` (GUE-F4-01, GUE-F4-02)

O pool **não é um booleano nem uma constante**: é valor derivado do ator, e talento alcança e
altera (D-G14). O Guerreiro tem os dois casos que provam a necessidade — **Reflexos Táticos**
(nível 10) concede, no início de cada turno seu, uma reação a mais **utilizável só para Golpe
Reativo**, e **Represálias Sem Limite** (nível 20) concede uma reação no início do turno de
**cada inimigo**, válida só naquele turno e só para reação de talento de Guerreiro. Nenhum dos
dois cabe em "+1 no contador": os dois concedem uma ficha com **restrição de uso** e **validade
própria**.

```ts
// packages/shared/src/combat/reaction.ts
/** Uma ficha de reação. O pool base entrega uma por rodada, sem restrição. */
interface ReactionSlot {
  id: string;
  /** "base" ou o sourceId do documento que concedeu. */
  source: string;
  /** Restrição de uso; ausente = serve para qualquer reação. */
  only?: { itemSourceIds?: string[]; traits?: string[] };
  /** Até quando a ficha vale. */
  validUntil:
    | { kind: "next-own-turn" } // o padrão: até o começo do seu próximo turno
    | { kind: "combatant-turn"; combatantId: string }; // Represálias Sem Limite
  spentOn?: string; // itemSourceId da reação usada
}

interface ReactionPool {
  combatantId: string;
  slots: ReactionSlot[];
}

/** O que o ator declara na derivação; um rule element novo escreve aqui. */
interface ReactionGrant {
  source: string;
  /** Quando a ficha nasce. */
  on: "own-turn-start" | "enemy-turn-start";
  only?: ReactionSlot["only"];
}
```

`hasSlotFor(pool, itemSourceId, traits)` responde se há ficha utilizável, e `spend` consome a
**mais restrita** que serve — senão a ficha genérica seria gasta antes e a restrita morreria sem
uso. Sem nenhum `ReactionGrant`, o pool é uma ficha por rodada: a regra base do PF2e, escrita
num lugar só e não espalhada por `if`.

```ts
/** Gatilho que o servidor percebe e que um observador pode responder. */
type ReactionTriggerKind =
  | "move-within-reach" // Golpe Reativo: alvo usa ação de movimento ao seu alcance
  | "manipulate-in-reach" // Golpe Reativo: ação de manipulação ao seu alcance
  | "hit-by-strike" // Bloqueio de Escudo, Escudo Reflexivo
  | "missed-by-strike"; // Ripostar em Duelo

interface ReactionOffer {
  id: string; // idempotência: responder duas vezes não gasta duas fichas
  triggerKind: ReactionTriggerKind;
  /** Quem pode responder (dono do ator). */
  combatantId: string;
  /** O que disparou — para o texto da anotação e para a reação saber o alvo. */
  source: { actorId: string; tokenId?: string; label: string };
  /** Reações elegíveis do ator, já filtradas pelo servidor contra o pool. */
  options: { itemSourceId: string; label: string }[];
}
```

A oferta **não bloqueia** o fluxo de ninguém: ela chega como anotação no canto do jogador dono
(mesmo slot da D-16 do Alquimista) e **não tem cronômetro** — some no próximo evento do mesmo
personagem (D-18 do Alquimista). Quem não respondeu, não reagiu — é a mesma regra da mesa.

### 2.5 `ShieldState` (GUE-F5-01, GUE-F5-02)

```ts
// systems/pf2e — estado do escudo vive no ITEM, não no ator
interface ShieldState {
  hp: number;
  broken: boolean;
} // system.shield do item
/** "Erguido" é EFEITO com duração, não campo: reusa o EffectItem da ALQ-F2-09. */
// effect: { slug: "raised-shield", duration: { unit: "turn-start", value: 1 }, rules: [flat-modifier ac +N] }
interface ShieldBlockResult {
  absorbed: number;
  toShield: number;
  toActor: number;
  broke: boolean;
}
```

### 2.6 `ManeuverAction` e `SkillCheckContext` (GUE-F5-03, GUE-F5-05)

```ts
// systems/engine-2e/src/maneuvers.ts — puro, o SF2e herda
type ManeuverSlug = "trip" | "grapple" | "shove" | "disarm" | "reposition" | "escape";
interface ManeuverDef {
  slug: ManeuverSlug;
  /** Perícia do executante. */
  skill: "athletics" | "acrobatics" | "thievery";
  /** CD do alvo: qual defesa dele vira DC (10 + mod). */
  against: "fortitude" | "reflex" | "ac";
  /** Efeito por grau — o card oferece o botão, não aplica sozinho. */
  outcome: Record<"critSuccess" | "success" | "failure" | "critFailure", ManeuverOutcome>;
}
type ManeuverOutcome =
  | { kind: "condition"; slug: string; value?: number }
  | { kind: "move"; feet: number }
  | { kind: "drop-held" }
  | { kind: "none" };

// packages/shared/src/chat/types.ts — quarto membro de CheckContextSchema
const SkillCheckContextSchema = z.object({
  kind: z.literal("skill"),
  targetTokenId: z.string().min(1),
  /** Qual defesa do alvo vira CD; resolvida no servidor, como a CA já é. */
  against: z.enum(["fortitude", "reflex", "will", "ac", "perception"]),
  maneuver: z.string().max(40).optional(),
});
```

### 2.7 `HandState` (GUE-F5-04)

Duas mãos nomeadas, não um contador — porque as regras do Guerreiro testam as duas coisas
("uma mão livre" e "empunhando com as duas mãos"), e um contador não distingue soltar o escudo
de soltar a arma.

```ts
// system.fusion.hands no ator; o campo `usage` do item (item-weapon.ts:73-74) diz quanto ocupa
interface HandState {
  left: string | null;
  right: string | null;
} // itemId
/** Derivado, é o que os predicados leem: "hands:free:1", "hands:wielding:two". */
interface HandsDerived {
  free: 0 | 1 | 2;
  twoHanded: boolean;
  heldItemIds: string[];
}
```

### 2.8 `PositionQuery` (GUE-F3-01)

A matemática **já existe e é testada** em `packages/shared/src/grid/math.ts`
(`chebyshevDistance:262`, `squareCellDistance:320`, `squareMeasurePath:368`,
`squareNeighborhoodCells:223`) e em `packages/shared/src/vision/`
(`segmentIntersect:125`, `computeVisibilityPolygon:250`, `isInLOS:437`). Nenhuma regra de
combate a consome: o único consumidor de produção de `squareMeasurePath` hoje é a régua
(`packages/client/src/lib/presence/rulerState.ts:143`). O contrato é a ponte.

```ts
// packages/server/src/combat/position.ts — servidor, porque a regra é autoritativa
interface TokenPos { tokenId: string; actorId: string; i: number; j: number; size: number }
/** Distância em pés entre dois tokens, pela regra de diagonal da cena. */
distanceBetween(scene: SceneLike, a: TokenPos, b: TokenPos): number;
/** A ameaça B, dado o alcance da arma empunhada? */
threatens(scene: SceneLike, a: TokenPos, b: TokenPos, reachFeet: number): boolean;
/** A e C flanqueiam B? (lados opostos, ambos ameaçando, nenhum incapacitado) */
isFlanking(scene: SceneLike, a: TokenPos, c: TokenPos, b: TokenPos, reach: ReachPair): boolean;
/** Cobertura de A para B, considerando paredes da cena (REQ-VIS-001). */
coverBetween(scene: SceneLike, a: TokenPos, b: TokenPos): "none" | "lesser" | "standard" | "greater";
```

### 2.9 `WeaponGroupChoice` e `CritSpecEffect` (GUE-F6-02, GUE-F6-03)

O eixo de proficiência extra **não é novo**: a `ALQ-F1-01` já fixou
`system.proficiencies.attacks[<chave>] = { rank, label, predicate }` (REQ-PF2-207) para a
proficiência em bombas alquímicas. O grupo de arma entra por essa mesma porta.

```ts
// escolha persistida (mesmo mecanismo do ChoiceSet: flags.system.rulesSelections)
interface WeaponGroupChoice {
  featureSourceId: string;
  group: WeaponGroup;
  level: number;
}
type WeaponGroup =
  | "axe"
  | "bow"
  | "brawling"
  | "club"
  | "crossbow"
  | "dart"
  | "firearm"
  | "flail"
  | "hammer"
  | "knife"
  | "pick"
  | "polearm"
  | "shield"
  | "sling"
  | "spear"
  | "sword";
// resultado: system.proficiencies.attacks["group:sword"] = { rank, label, predicate:["item:group:sword"] }

interface CritSpecEffect {
  group: WeaponGroup;
  outcome: ManeuverOutcome;
  note: string;
}
```

## 3. Regras de colisão

- Tarefas na mesma onda têm **arquivos disjuntos** (campo Onde).
- **Esta frente chega por último** (D-G18), então o problema **não é colisão simultânea: é
  deriva**. Os arquivos que as outras duas mais mexem são os mesmos que este plano mais toca —
  `chat-handler.ts` (4 tarefas do Alquimista, 0 do Animista, e é onde o Guerreiro mais mexe),
  `strikes.ts` (4), `derive-runner.ts` (3), `effectsEngine.ts` (3 + 1), `characterSheetVM.ts`
  (7 + 3), `CharacterSheet.svelte` (7 + 2), `planVM.ts` (3 + 4), `systems/pf2e/src/index.ts` (6),
  `combatStore.svelte.ts` (1, a `ALQ-F1-05`). Cada ficha aqui cita arquivo e linha do estado de
  **2026-09-16**: quando a frente arrancar, a primeira coisa a fazer é conferir se o trecho ainda
  está lá, e corrigir a ficha se não estiver — a linha citada é evidência datada, não contrato.
- Onde o Guerreiro corre livre, sem nenhuma tarefa das outras duas frentes: `TokenInteractionManager.ts`,
  `target-handler.ts`, `combat-event-bus.ts`, `ActionsTab.svelte`, `npcSheetVM.ts`/`NpcSheet.svelte`,
  `packages/shared/src/grid/`, `packages/shared/src/vision/`, `weapons-core`, `actions-core`.
- Teto de 6 tarefas por onda; roteiros de print rodam em faixa só-leitura depois que o lote fecha.
- `transform.mjs` e `build-mvp-subset.mjs` são faixa do importer: **uma tarefa por onda**, regra
  herdada do plano do Alquimista.

## 4. Tarefas

### G-F0 — Dado, dívida e fundação do plano

### GUE-F0-01 — Spec 51 (`REQ-GUE`) do combate marcial + emendas 10/06/09/17/15

- **Repo**: core
- **Onde**: nova `specs/51-combate-marcial.md`; `specs/README.md` (bloco `prefixos` e a seção de números reservados, hoje sem 47–50); emendas em `specs/10-combate-e-iniciativa.md`, `specs/06-canvas-e-renderizacao.md`, `specs/09-chat-e-mensagens.md`, `specs/17-sistema-pf2e.md`, `specs/15-api-de-sistemas.md`; `specs/RASTREABILIDADE.md` via `pnpm spec:report`
- **Entrega**: Spec de área no padrão do metamodelo (`specs/CONVENCOES.md`): `DEC-GUE-01..17` com racional e `REQ-GUE-` com tag `[MVP]`/`[V2]`, na ordem canônica de seções. Fixa: mira como gesto de canvas, grau de sucesso do golpe no servidor, contagem de MAP por turno, economia e oferta de reação, escudo com estado e bloqueio, manobra como ação executável, estado de mãos, geometria de posição (flanqueio, alcance, cobertura), grupo de arma como eixo de proficiência, especialização crítica, ataque em vários alvos. Registra `REQ-GUE-` na tabela de prefixos e acrescenta 51 (e as 47–50 órfãs) à seção de números reservados.
- **Depende de**: —
- **Paralelo com**: GUE-F0-02, GUE-F0-03, GUE-F0-05
- **Modelo / esforço**: opus / high — é o documento que amarra o resto.
- **Teste (TDD)**: `spec-lint` verde (prefixo com dono, id único, citação resolvível, req com tag, decisão canônica) + `pnpm spec:report` regenerado.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-GUE-001..300`, `DEC-GUE-01..17`, `REQ-CBT-063..067`, `REQ-CNV-100..104`, `REQ-CHT-054..060`, `REQ-PF2-245..278`, `REQ-SYS-159..160`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### GUE-F0-02 — Armor Expertise e Armor Mastery no nível certo do Guerreiro

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/curation/` (regra de nível por classe dona); `systems/pf2e/packs/class-features-core/documents.json`; `sheets/pf2e/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts`
- **Entrega**: Fecha a issue #71 do satélite. `class-features-core` publica Armor Expertise com nível 7 e Armor Mastery com 13 — os níveis do Campeão/Bárbaro — enquanto o `featuresByLevel` do Guerreiro diz 11 e 17. Como a feature é compartilhada entre classes, o nível não pode viver no documento: passa a valer o nível declarado pelo `featuresByLevel` de quem concede, e o campo `level` do documento compartilhado deixa de ser lido na montagem.
- **Depende de**: —
- **Paralelo com**: GUE-F0-01, GUE-F0-03, GUE-F0-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: teste não circular na varredura: a asserção escreve a regra do PF2e (Guerreiro ganha Armor Expertise no 11 e Armor Mastery no 17; Campeão no 7 e 13) e confere contra a ficha montada — não contra a tabela do pack. Nenhuma outra classe muda de nível.
- **Prova visual (print)**: ficha de Guerreiro nível 11 com Armor Expertise na lista de habilidades, e nível 10 sem ela.
- **Spec/REQ**: `REQ-GUE-001`
- **Tamanho**: M
- **Onda**: 1 · **Lote**: L1

### GUE-F0-03 — `weapons-core`: os cinco grupos que faltam e os traits `fatal` e `free-hand`

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e` (seleção do subconjunto publicado); `systems/pf2e/packs/weapons-core/documents.json` e `i18n.pt-BR.json`
- **Entrega**: Fecha a issue #72. Hoje o pack tem 30 armas, cobre 11 dos 16 grupos (faltam Bomb, Brawling, Firearm, Pick, Polearm e Shield inteiros) e **nenhuma** arma tem `fatal` ou `free-hand`. Amplia o subconjunto para cobrir os 16 grupos e incluir ao menos uma arma de cada trait que as regras do Guerreiro testam, com pt-BR no mesmo lote. Sem isso, escolher maestria em Polearm é escolher um grupo sem arma, e o defeito de `fatal` (GUE-F0-04) é invisível porque não há arma para exercitá-lo.
- **Depende de**: —
- **Paralelo com**: GUE-F0-01, GUE-F0-02, GUE-F0-05
- **Modelo / esforço**: sonnet / high — volume com gate mecânico.
- **Teste (TDD)**: teste dirigido por dado: para cada um dos 16 grupos do PF2e existe ao menos uma arma publicada; existe ao menos uma arma com `fatal` e uma com `free-hand`; `qa.mjs` verde no pt-BR; contagem de entradas traduzidas igual à de documentos.
- **Prova visual (print)**: compêndio do GM na estante de armas, filtro por grupo Polearm com resultado, e a ficha de um Guerreiro empunhando uma arma `fatal`.
- **Spec/REQ**: `REQ-GUE-002..004`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### GUE-F0-04 — Crítico: `fatal` eleva o dado base

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/character.ts:948-966` (`renderCritDamageRoll`); `systems/pf2e/src/actions/strikes.ts:426-431` (`computeStrikeDamage`, hoje sem chamador); `systems/pf2e/src/schemas/item-weapon.ts`
- **Entrega**: Fecha as issues #73 e #76 do satélite. `renderCritDamageRoll` trata `fatal` como `deadly` — soma um dado extra sem elevar o dado base, e o comentário do próprio código assume isso ("fatal does NOT replace the base die"). Pelo RAW, `fatal` troca o dado da arma pelo dado fatal em todo o dano crítico e só depois soma o extra. Corrige o caminho da ficha e faz as duas funções (`renderCritDamageRoll` e `computeStrikeDamage`) concordarem, com uma única fonte da regra. Junto, fecha a #76: `WeaponDamageSchema` aceita `dice > 0` sem `die` e `strikes.ts` rola `1d1` em silêncio.
- **Depende de**: GUE-F0-03 (arma com o trait para exercitar)
- **Paralelo com**: GUE-F0-06, GUE-F1-01, GUE-F1-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: asserção pela regra escrita no teste, não pela saída atual: arma d8 com `fatal-d10` em crítico = `2d10 + 1d10` (mais modificadores dobrados), não `2d8 + 1d10`; arma d6 com `deadly-d8` = `2d6 + 1d8`; `dice: 2` sem `die` falha a validação em vez de virar `1d1`.
- **Prova visual (print)**: card de golpe crítico com uma arma `fatal`, mostrando a fórmula com o dado elevado.
- **Spec/REQ**: `REQ-GUE-005..006`, `REQ-PF2-245`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### GUE-F0-05 — Arquétipo do Guerreiro publicado e traduzido

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/out/feats/` no core (origem, já convertida); curadoria e publicação em `systems/pf2e/packs/feats-core/documents.json` e `i18n.pt-BR.json`
- **Entrega**: Fecha a issue #74. Os seis talentos do arquétipo (Fighter Dedication, Basic Maneuver, Fighter Resiliency, Reactive Striker, Advanced Maneuver, Diverse Weapon Expert) já estão convertidos pelo importador no core, com apenas três regras não convertidas no total, e nenhum foi publicado nem traduzido — hoje `feats-core` tem só seis dedicações, nenhuma do Guerreiro. Leva os seis para o pipeline de curadoria e publicação, com pt-BR, e liga o pré-requisito bloqueante da `ALQ-F0-09`. Diferente do Animista (D-A02), aqui a lacuna é de dado, não de motor.
- **Depende de**: —
- **Paralelo com**: GUE-F0-01, GUE-F0-02, GUE-F0-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: teste não circular: os seis existem no pack com trait `dedication` e `archetype`; um personagem de outra classe com Destreza/Força suficiente pode tomar Fighter Dedication no picker e recebe a proficiência marcial que ela concede; sem o atributo, o picker bloqueia com motivo.
- **Prova visual (print)**: picker de talento de arquétipo de um Ladino nível 2 com "Dedicação de Guerreiro" em pt-BR, e a ficha depois de tomada.
- **Spec/REQ**: `REQ-GUE-007..009`
- **Tamanho**: M
- **Onda**: 1 · **Lote**: L1

### GUE-F0-06 — Protótipo das telas do combate marcial

- **Repo**: core
- **Onde**: novo `docs/design/guerreiro/prototipo-guerreiro.html`
- **Entrega**: Protótipo navegável (arquivo único, sem build) das telas que o plano cria, para servir de lente P1 do `docs/design/PROCESSO-UI.md` em toda tarefa de UI daqui em diante: token mirado no canvas com retícula, card de golpe com grau de sucesso e um botão de dano, botão de golpe com o MAP corrente, anotação de reação no canto com prazo, escudo erguido e barra de PV do escudo, aba Ações com as seis manobras executáveis, estado de mãos no inventário, eixo de grupo de arma no Plano, card de crítico com o efeito de especialização.
- **Depende de**: GUE-F0-01
- **Paralelo com**: GUE-F0-04, GUE-F1-01, GUE-F1-04
- **Modelo / esforço**: sonnet / medium — é HTML com dados fixos, não código de produção.
- **Teste (TDD)**: não se aplica (protótipo descartável, regra de escopo do TDD).
- **Prova visual (print)**: o próprio arquivo, aberto com `Start-Process`.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### GUE-F0-07 — Roteiro `tutorial-e2e` da G-F0

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f0.spec.ts`; prints em `.fusion-build/guerreiro/L1/f0/`
- **Entrega**: Roteiro que monta um Guerreiro nível 11 e um nível 17 num mundo existente, com servidor isolado e data-dir no scratchpad, e fotografa: as habilidades de armadura no nível certo, uma arma de cada grupo novo no compêndio, o crítico com arma `fatal`, e a dedicação de Guerreiro no picker de um personagem de outra classe. Relatório P3 com protótipo × tela.
- **Depende de**: GUE-F0-02, GUE-F0-03, GUE-F0-04, GUE-F0-05, GUE-F0-06
- **Paralelo com**: GUE-F1-02, GUE-F1-05, GUE-F4-01
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L1

### G-F1 — O golpe que acerta e machuca

### GUE-F1-01 — Mirar no canvas: o gesto que faltou (D-G01)

- **Repo**: core
- **Onde**: `packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts:546-548` (`pointerdown` no container de tokens, hoje com `if (e.button !== 0) return`); `packages/client/src/lib/combat/combatStore.svelte.ts:391-410` (`combatActions.target`, hoje sem chamador de produção); `packages/client/src/lib/combat/targeting.ts`; `packages/client/src/components/combat/__tests__/CombatQueue.test.ts:405-436` (o teste que documenta a decisão)
- **Entrega**: Fecha a issue #221. O servidor já marca alvo (`packages/server/src/combat/target-handler.ts:92-114`, registrado em `net/socket-manager.ts:460`), limpa a mira no fim do turno (`:169-180`) e o canvas já desenha a retícula (`lib/canvas/combat/TargetingMarker.ts`, reconciliada todo frame em `combatCanvasController.ts:158-176`). Falta o gesto: `combatActions.target()` não é chamado em lugar nenhum de produção. O clique direito num token passa a alternar a mira do usuário e `Esc` a limpa, como a DEC-CBA-05 prometeu quando tirou o controle do painel de combate. O botão direito está livre: `TokenInteractionManager.ts:548` descarta tudo que não é botão esquerdo, e `FusionCanvas.ts:128-130` já suprime o menu do navegador com `preventDefault` — não há gesto a desalojar. A leitura do lado da ficha não nasce aqui — `getMyTargets()`/`setMyTargets()` são da `ALQ-F1-05`, que também grava a foto dos alvos na mensagem; esta tarefa entrega a única peça que ninguém tem: o gesto.
- **Depende de**: GUE-F0-01, **ALQ-F1-05** (`getMyTargets`/`setMyTargets` e a foto dos alvos)
- **Paralelo com**: GUE-F0-04, GUE-F0-06, GUE-F1-04
- **Modelo / esforço**: sonnet / high — mexe no gestor de interação do canvas, onde clique e arraste já disputam.
- **Teste (TDD)**: `targeting-gesture.test.ts`: clique direito num token emite `combat:target` com `targeted: true` e o segundo clique desfaz; clique esquerdo continua selecionando e arrastando sem mirar; `Esc` limpa só a mira do próprio usuário; depois do gesto, `getMyTargets()` (da `ALQ-F1-05`) passa a devolver o token mirado. O teste de `CombatQueue` (REQ-CBA-076) continua verde — o painel segue sem controle de mira.
- **Prova visual (print)**: canvas com um token inimigo mirado (retícula de 4 cantos) visto pelo jogador, e o mesmo token visto por outro usuário com a cor de "mira alheia".
- **Spec/REQ**: `REQ-GUE-040..042`, `REQ-CNV-100..102`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L2

### GUE-F1-02 — O golpe carrega o alvo mirado

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2263-2284` (`strikeCard`) e `:2222-2233` (`rollStrike`); `_chatOp`/`buildChatSendPayload` no mesmo arquivo; `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:268-274`
- **Entrega**: Hoje o golpe da ficha já sai como card interativo (`strikeCard` monta `flags.pf2e.abilityCard` com `kind:"strike"` e dispara o ataque aninhado) — o que ele não carrega é alvo, e por isso o servidor nunca grada: `payload.target` fica indefinido e a graduação de `chat-handler.ts:451-507` não roda. Esta tarefa liga as duas pontas: o payload do ataque passa a levar `target` (o token mirado, lido por `getMyTargets()`) e o `checkContext` de ataque da §2.1. Sem alvo mirado, nada muda — o card sai como hoje.
- **Depende de**: GUE-F1-01
- **Paralelo com**: GUE-F0-07, GUE-F1-05, GUE-F4-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `strikeCard.target.test.ts`: com alvo mirado, o payload do ataque traz `target` e `checkContext.kind === "attack"` com o `mapIndex` escolhido; sem alvo, nenhum dos dois campos aparece; o `rollMode` continua vindo do seletor do chat (REQ-ACH-042), não é reescrito aqui.
- **Prova visual (print)**: coberta por GUE-F1-03.
- **Spec/REQ**: `REQ-GUE-043`, `REQ-CHT-054`
- **Tamanho**: P
- **Onda**: 3 · **Lote**: L2

### GUE-F1-03 — O sistema decide o crítico (D-G02)

- **Repo**: core + satélite
- **Onde**: core — `packages/shared/src/chat/types.ts:389-398` (`CheckContextSchema`, terceiro membro), `packages/server/src/chat/chat-handler.ts:451-507` (aceitar o contexto de ataque), `packages/server/src/__tests__/chat-target.test.ts`; satélite — `sheets/pf2e/src/components/chat/pf2e/AbilityCard.svelte`, `sheets/pf2e/src/lib/sheets/pf2e/abilityCardVM.ts` (`hasCritDamage`, `canRollDamage`, `buildDamageRollOp`)
- **Entrega**: O servidor já sabe graduar ataque contra CA — resolve o retrato do alvo lendo a CA do banco, nunca do cliente (`resolveTargetPortrait:1586`), e anexa `degreeOfSuccess` à mensagem (`computeAttackDegree:1620`), tudo testado com socket real. O que ninguém faz é usar esse grau: o card mostra "Dano" e "Crítico" lado a lado e quem escolhe é o jogador. Com alvo, o card passa a mostrar o grau (acerto crítico / acerto / erro / erro crítico) e **um** botão de dano coerente — em erro, nenhum. Sem alvo, os dois botões continuam, porque mesa sem mapa é caso real e não exceção.
- **Depende de**: GUE-F1-02
- **Paralelo com**: GUE-F6-01, GUE-F6-02, GUE-F6-04
- **Modelo / esforço**: opus / high — é o contrato central da fase e cruza os dois repos.
- **Teste (TDD)**: no core, `chat-target.test.ts` ganha o caso de ataque: rolagem com `checkContext.kind:"attack"` e alvo resolvível recebe grau graduado contra a CA lida do banco; um cliente que manda a CA no payload é ignorado; alvo oculto para quem rolou não resolve (e então não há grau). No satélite, asserção pela regra: total 10 pontos acima da CA é acerto crítico e o card mostra só "Rolar dano crítico"; 1 abaixo é erro e o card não mostra botão de dano; 20 natural sobe um grau.
- **Prova visual (print)**: card de golpe com "Acerto crítico" e um único botão de dano; segundo print do mesmo golpe sem alvo mirado, com os dois botões de hoje.
- **Spec/REQ**: `REQ-GUE-044..048`, `REQ-CHT-055..056`, `REQ-PF2-246`
- **Tamanho**: G
- **Onda**: 4 · **Lote**: L2

### GUE-F1-04 — O servidor conta o ataque múltiplo (D-G03)

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/map-counter.ts`; `packages/server/src/combat/combat-event-bus.ts:1-27` (consumir `turnStart`); `packages/server/src/chat/chat-handler.ts` (notar o ataque ao graduar); `packages/server/src/combat/target-handler.ts:169-180` (o único consumidor de `turnEnd` hoje, como modelo)
- **Entrega**: Não existe contagem de MAP em lugar nenhum dos dois repos: a busca por `\bMAP\b` no core não devolve nada, a ficha oferece três botões fixos e quem conta é o jogador. O cálculo, esse, já existe e é puro (`systems/engine-2e/src/map.ts:31`, `calculateMapPenalty(attackNumber, weaponAgile)`) — falta quem conte. Nasce um contador por combatente, incrementado quando um ataque grada e zerado por `turnStart`, com a marcação de quais ataques não contam (Golpe Reativo é o caso do Guerreiro). O ponto de encaixe está pronto e testado desde a spec 10; o que faltava era o listener.
- **Depende de**: GUE-F0-01, **ALQ-F1-04** (TurnHooks com id e prioridade)
- **Paralelo com**: GUE-F0-04, GUE-F0-06, GUE-F1-01
- **Modelo / esforço**: opus / high — estado novo no combate, com anti-cheat.
- **Teste (TDD)**: `map-counter.test.ts` com socket real: três ataques no mesmo turno devolvem penalidade 0, −5 e −10; com arma ágil, 0, −4 e −8; passar o turno zera; um ataque marcado como fora da contagem não incrementa; um ataque de quem não é o combatente ativo não mexe no contador de ninguém.
- **Prova visual (print)**: coberta por GUE-F1-05.
- **Spec/REQ**: `REQ-GUE-049..053`, `REQ-CBT-063..065`
- **Tamanho**: G
- **Onda**: 2 · **Lote**: L2

### GUE-F1-05 — O botão de golpe já sabe o MAP

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:1013-1021` (os três botões de variante); `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2263-2284` (`strikeCard`); `systems/pf2e/src/derivations/character.ts:1066` (as três variantes pré-computadas continuam)
- **Entrega**: Com o contador do servidor, a aba Ações passa a mostrar **um** botão de golpe com a penalidade corrente ("Espada longa −5"), e os três botões de hoje viram um seletor recolhido de "forçar MAP", para o ataque que declaradamente não conta. A derivação não muda: as três variantes continuam pré-computadas, só a escolha sai da mão do jogador.
- **Depende de**: GUE-F1-04
- **Paralelo com**: GUE-F0-07, GUE-F1-02, GUE-F4-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `strike-map-button.test.ts`: fora de combate, o botão mostra MAP 0 e o seletor continua disponível; depois de um ataque no turno, o botão mostra −5 e o card carrega `mapIndex: 1`; forçar MAP 0 pelo seletor manda `mapIndex: 0` e marca o ataque como fora da contagem.
- **Prova visual (print)**: aba Ações de um Guerreiro em combate, antes e depois do primeiro ataque do turno, com o número do botão mudando; protótipo × tela contra `prototipo-guerreiro.html`.
- **Spec/REQ**: `REQ-GUE-054..055`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### GUE-F1-06 — Golpe de NPC com MAP e com dano clicável

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/npcSheetVM.ts:511-525` (`rollStrike`, bônus fixo único); `sheets/pf2e/src/components/sheets/pf2e/NpcSheet.svelte:107-108,294-298` (o dano é texto, sem `onclick`)
- **Entrega**: A ficha de NPC é estritamente mais pobre que a de personagem: um único botão de bônus fixo, sem variantes de MAP, e o dano exibido como texto sem botão. Como quase todo alvo do Guerreiro é NPC e a reação de Golpe Reativo dispara no turno deles, o NPC precisa do mesmo caminho: card de golpe com alvo, grau de sucesso e MAP contado. Iguala as duas fichas no que é mecânico, sem mexer no resto do layout do NPC.
- **Depende de**: GUE-F1-03, GUE-F1-04
- **Paralelo com**: GUE-F2-02, GUE-F3-02, GUE-F3-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `npcSheetVM.strike.test.ts`: o golpe do NPC monta card com `kind:"strike"`, carrega o alvo mirado pelo Mestre e o `mapIndex` do contador; o dano tem fórmula rolável; o segundo ataque do NPC no mesmo turno sai com −5.
- **Prova visual (print)**: ficha de NPC com o botão de golpe mostrando o MAP e o card resultante com o grau contra a CA do personagem.
- **Spec/REQ**: `REQ-GUE-056..057`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### GUE-F1-07 — Roteiro `tutorial-e2e` da G-F1

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f1.spec.ts`; prints em `.fusion-build/guerreiro/L2/f1/`
- **Entrega**: Roteiro que põe um Guerreiro e um NPC em combate num mundo existente e fotografa o ciclo inteiro do golpe: mirar no canvas, atacar, ver o grau no card, rolar o dano que o grau escolheu, atacar de novo com −5, passar o turno e ver o contador zerar. Como GM e como jogador. Relatório P3 com protótipo × tela.
- **Depende de**: GUE-F1-05, GUE-F1-06
- **Paralelo com**: GUE-F2-03, GUE-F3-04, GUE-F4-03
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### G-F2 — A regra escrita no talento sai do papel

Esta fase é a que **menos** código novo tem e a que mais destrava: o motor de rule elements e o
materializador de itens são entregues pelo plano do Alquimista (`ALQ-F2-08`, `ALQ-F4-02`,
`ALQ-F4-06..16`, `ALQ-F4-19`). O que o Guerreiro acrescenta é o que o Alquimista não precisa:
os seletores de ataque, dano e CA, os predicados do eixo marcial, e a prova de que as 83 regras
inertes passaram a valer.

### GUE-F2-01 — Seletores de ataque, dano e defesa no pipeline de efeitos

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/embeddedModifiers.ts:10-13,75-82` (`isFlatModifierRule`, hoje chamado só por `hp.ts:90` e `speed.ts:144`); `systems/pf2e/src/derivations/character.ts:279-300` (`stepCharAc`) e `:1056` (`stepCharStrikes`); `systems/pf2e/src/actions/strikes.ts:224-340` (`deriveStrikeFromWeapon`)
- **Entrega**: A `ALQ-F2-08` faz efeito, talento, habilidade de classe, ancestralidade, herança e equipamento equipado virarem `EffectSource` com todas as regras — mas a emenda dela, de 16/09, é explícita: a `ALQ-F4-19` unificou só o **reconhecimento** da regra no registro, e a **execução** continua nos scanners (`hp.ts`, `speed.ts`, `equipment.ts:243-244`), que varrem `doc.items` e escrevem direto no derivado sem passar pelo `synthetics`. Resultado: os dois únicos seletores que alguém agrega são `hp` e `land-speed`. Os 45 `flat-modifier` dos documentos do Guerreiro pedem `ac` (5), `strike-damage` (13), `ranged-attack-roll` (4), `melee-strike-attack-roll` (1), `melee-strike-damage` (2), `saving-throw`, `skill-check`, `reflex` e `initiative`. Esta tarefa liga a derivação de CA, de golpe e de salvaguarda ao `ctx.synthetics` — é ligação, não motor novo — e é onde o risco de contagem dupla que a `ALQ-F2-08` nomeou precisa morrer: um seletor tem um agregador só.
- **Depende de**: GUE-F0-01, **ALQ-F2-08** (itens viram EffectSource), **ALQ-F4-19** (scanners no registro)
- **Paralelo com**: GUE-F0-04, GUE-F0-06, GUE-F1-01
- **Modelo / esforço**: opus / high — toca a derivação de todas as classes.
- **Teste (TDD)**: asserção pela regra escrita no teste: um efeito com `flat-modifier` de `+1 status` em `ac` sobe a CA derivada em 1 e aparece no detalhamento; `+2 circumstance` em `melee-strike-attack-roll` sobe só os golpes corpo a corpo, não os à distância; dois bônus do mesmo tipo não somam (o maior vence); a regressão de snapshot da `ALQ-F4-03` roda e só muda onde há efeito.
- **Prova visual (print)**: ficha com o detalhamento de CA mostrando a linha do efeito, e a mesma ficha sem o efeito.
- **Spec/REQ**: `REQ-GUE-080..084`, `REQ-PF2-247..249`
- **Tamanho**: G
- **Onda**: 2 · **Lote**: L3

### GUE-F2-02 — Predicados do eixo marcial

- **Repo**: satélite
- **Onde**: `systems/engine-2e/src/effectsEngine.ts:112` (avaliação de predicado); `systems/engine-2e/src/ruleElementRegistry.ts` (criado pela `ALQ-F4-02`); `systems/pf2e/src/derivations/character.ts` (opções de rolagem do ator)
- **Entrega**: As regras do Guerreiro não testam só "tenho o talento": testam a arma na mão (`item:group:sword`, `item:trait:agile`, `item:category:martial`), o estado das mãos (`hands:free:1`, `hands:wielding:two`) e o alvo (`target:condition:off-guard`). Nenhum desses predicados existe — o motor não tem `item:group`/`item:category`, e o estado de mãos nem é lido. Esta tarefa acrescenta o vocabulário de opções de rolagem do eixo marcial e o resolve na derivação, para que as 17 `roll-option` e os 45 `flat-modifier` condicionais tenham contra o que testar.
- **Depende de**: GUE-F2-01, GUE-F5-04 (estado de mãos), GUE-F6-02 (grupo de arma)
- **Paralelo com**: GUE-F1-06, GUE-F3-02, GUE-F3-03
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: regra escrita no teste: com espada longa empunhada, as opções incluem `item:group:sword` e `item:category:martial` e não incluem `item:trait:agile`; com adaga, incluem `item:trait:agile`; com escudo na outra mão, `hands:free:0`; sem escudo, `hands:free:1`. Um efeito com predicado `item:trait:agile` só aplica no golpe da adaga.
- **Prova visual (print)**: coberta por GUE-F2-03.
- **Spec/REQ**: `REQ-GUE-085..089`, `REQ-SYS-159..160`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L3

### GUE-F2-03 — As 83 regras inertes do Guerreiro, dirigidas por dado

- **Repo**: satélite
- **Onde**: novo `sheets/pf2e/src/lib/sheets/pf2e/__tests__/guerreiro-rules.test.ts` ao lado de `varredura-classes.test.ts`; `sheets/pf2e/src/lib/sheets/pf2e/__tests__/helpers/classBuildHarness.ts:188` (hoje chama `collectEffects([], new Set())` — array vazio, sempre)
- **Entrega**: O inventário contou 86 regras escritas nos 129 documentos do Guerreiro e 83 inertes (45 `flat-modifier`, 17 `roll-option`, 10 `roll-note`, 6 `set-property`, 5 `proficiency`); só as 3 `grant-item` funcionam, por um caminho próprio. Esta tarefa é o gate da fase: uma varredura dirigida pelos packs que monta o Guerreiro em cada nível, aplica cada regra e afirma que ela chegou ao motor — e que o harness deixou de chamar `collectEffects` com a lista vazia. É o teste que impede a fase de fechar com "funciona para o talento que eu olhei".
- **Depende de**: GUE-F2-01, GUE-F2-02
- **Paralelo com**: GUE-F1-07, GUE-F3-04, GUE-F4-03
- **Modelo / esforço**: sonnet / high — é varredura, mas a asserção precisa ser da regra.
- **Teste (TDD)**: a própria varredura, não circular: para cada documento do Guerreiro com regra de tipo suportado, o efeito aparece no `Synthetics` do ator montado; o número de regras não alcançadas é declarado no teste e cai a zero para os tipos suportados; as `proficiency` continuam declaradas como pendentes até a `GUE-F6-02`, com o motivo escrito.
- **Prova visual (print)**: ficha de um Guerreiro nível 7 com Especialização em Arma, mostrando o +2 de dano no detalhamento do golpe — hoje ausente.
- **Spec/REQ**: `REQ-GUE-090..092`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### GUE-F2-04 — Roteiro `tutorial-e2e` da G-F2

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f2.spec.ts`; prints em `.fusion-build/guerreiro/L4/f2/`
- **Entrega**: Roteiro que sobe um Guerreiro nível 7 e um nível 15 e fotografa o que passou a existir: o detalhamento do golpe com o bônus de Especialização em Arma, a CA com o efeito somado, um interruptor de talento ligado mudando o número na tela, e a nota de rolagem aparecendo no card. Relatório P3 com protótipo × tela.
- **Depende de**: GUE-F2-03
- **Paralelo com**: GUE-F4-04, GUE-F5-02, GUE-F6-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

### G-F3 — Posição no mapa

### GUE-F3-01 — Consultas de posição no servidor (distância, ameaça, flanqueio, cobertura)

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/position.ts` (a pasta hoje tem `combat-chat.ts`, `combat-event-bus.ts`, `combat-handlers.ts`, `index.ts`, `initiative-registry.ts`, `system-formula-adapter.ts`, `target-handler.ts`, `targeting-store.ts` — sem `position.ts`, confirmado por listagem). Consome `packages/shared/src/grid/math.ts` (`chebyshevDistance:262`, `squareCellDistance:320`, `squareMeasurePath:368`, `squareNeighborhoodCells:223`) e `packages/shared/src/vision/primitives.ts` (`segmentIntersect:125`) — pura matemática já testada, hoje sem nenhum consumidor de regra de combate (o único consumidor de produção de `squareMeasurePath` é a régua, `packages/client/src/lib/presence/rulerState.ts:143`). Lê `packages/shared/src/scene.ts` (`TokenDocumentSchema:146-284` — `x`/`y` em pixel, linhas 171/176, **sem** campo de largura/altura; `disposition:229-232`; `walls:479`, `WallDocumentSchema` com endpoints `a`/`b` em `packages/shared/src/vision/scene-schemas.ts:57-65`) e o trait `size` do ator (`external/fusion-systems-2e/systems/pf2e/src/schemas/actor-character.ts:346`, enum `tiny/sm/med/lg/huge/grg`) para montar `TokenPos`.
- **Entrega**: Nasce `position.ts` com as quatro funções do contrato `PositionQuery` (§2.8): `distanceBetween`, `threatens` e `isFlanking` como implementações reais sobre a matemática já testada; `coverBetween` como stub tipado que sempre devolve `"none"` — cobertura é issue registrada por D-G17, fora do MVP deste plano, e o nome existe só para o consumidor futuro não precisar mudar assinatura. A peça genuinamente nova é resolver `TokenPos` a partir do documento de cena: o token só guarda posição em pixel, sem largura/altura (tamanho é herdado do ator, spec 41 — decisão já fechada), então esta tarefa cria o mapeamento de `size` do ator para número de células, que não existe hoje em nenhum lugar do repo (confirmado por busca — zero ocorrências de mapeamento tiny/sm/med/lg/huge/grg → células). `distanceBetween` mede pela célula mais próxima do footprint, não pelo centro, para tokens grandes.
- **Depende de**: GUE-F0-01
- **Paralelo com**: GUE-F0-04, GUE-F0-06, GUE-F1-01
- **Modelo / esforço**: opus / high — é o contrato central que amarra flanqueio, alcance e o gatilho de movimento da reação (§2.8, consumido por GUE-F3-02, GUE-F3-03, GUE-F3-04 e GUE-F4-02).
- **Teste (TDD)**: `position.test.ts` (não circular — a asserção escreve a regra de grid do PF2e, nunca lê o pack): grade de 5 pés/célula com regra alternada 5-10-5 (REQ-CNV-020) — atacante médio em (0,0) e alvo em (2,1) ficam a 15 pés (duas diagonais: 5+10), não 10; uma criatura Grande (footprint 2×2 ocupando (0,0)-(1,1)) mede pela célula mais próxima do footprint, então um alvo em (3,0) fica a 10 pés (2 células), não 15 como daria medir do centro; `threatens` com alcance 5 cobre as 8 células adjacentes de um atacante médio e recusa uma 2 células adiante, e com alcance 10 cobre essa segunda coroa; `isFlanking` com A em (0,0), alvo em (1,0) e C em (2,0) retorna verdadeiro (lados opostos), e com C em (0,1) (mesmo lado de A) retorna falso; `coverBetween` sempre devolve `"none"`, documentado como stub, não como regra testada.
- **Prova visual (print)**: sem UI própria — a geometria só aparece indiretamente nos prints de GUE-F3-02/GUE-F3-03/GUE-F3-04.
- **Spec/REQ**: `REQ-GUE-100..104`, `REQ-CNV-103`
- **Tamanho**: G
- **Onda**: 2 · **Lote**: L2

### GUE-F3-02 — Flanqueio gera desprevenido (D-G06)

- **Repo**: ambos
- **Onde**: `packages/server/src/chat/chat-handler.ts` — o mesmo bloco que a GUE-F1-03 introduz para `checkContext.kind === "attack"`, vizinho do `kind === "save"` já existente (`:476-483`); consome `packages/server/src/combat/position.ts` (`isFlanking`, `threatens`, GUE-F3-01) e `disposition` do token (`packages/shared/src/scene.ts:229-232`) para achar o parceiro de flanqueio. Satélite: `external/fusion-systems-2e/systems/pf2e/src/index.ts:363-372` — mesmo padrão de `registrar.setting({ key: "variantRules.freeArchetype", scope: "world", ... })` usado hoje, para a chave nova `variantRules.autoFlanking`.
- **Entrega**: Quando uma rolagem carrega `AttackCheckContext` (GUE-F1-03) e o mundo não desligou `variantRules.autoFlanking` (novo, default ligado), o servidor varre os outros tokens da cena com disposição oposta à do alvo que já ameaçam esse alvo (`threatens`) e testa cada um contra `isFlanking(atacante, candidato, alvo)`; no primeiro par válido, subtrai 2 da CA usada só naquela comparação, sem gravar a condição off-guard no ator. É deliberadamente diferente do toggle existente (`external/fusion-systems-2e/systems/pf2e/src/conditions.ts:122-131`, -2 CA + roll-option persistente, ligado à mão): flanqueio é posição, recalculada a cada golpe, não um estado pendurado no alvo depois que os atacantes saem de posição — D-G06 pede exatamente "estado derivado, não condição escrita à mão". **Emenda do Alexandre (D-G06)**: o toggle manual continua valendo e é **independente da geometria** — marcar desprevenido à mão aplica o -2 mesmo sem flanqueio, o automático nunca apaga o manual, e os dois não se somam (o alvo está desprevenido ou não está). É o caso real de mesa: desprevenido vem de muita coisa além de posição, e o Mestre decide.
- **Depende de**: GUE-F3-01, GUE-F1-03
- **Paralelo com**: GUE-F1-06, GUE-F2-02, GUE-F3-03
- **Modelo / esforço**: sonnet / high — mexe no caminho de ataque autoritativo testado por socket (`chat-target.test.ts`, REQ-ACH-070..092); não pode regredir nenhum desses testes.
- **Teste (TDD)**: `flanking-ac.test.ts` (helper de porta, socket real): atacante e um aliado em lados opostos de um inimigo, ambos ameaçando → CA efetiva -2 só nessa rolagem, e o documento do ator do inimigo não ganha a condição off-guard (confirmado lendo o doc persistido); aliado do MESMO lado não aplica o ajuste; com `variantRules.autoFlanking` desligado no mundo, o mesmo par não aplica nada. E os três casos da emenda: **sem flanqueio nenhum, com off-guard ligado à mão, a CA cai 2 do mesmo jeito**; com flanqueio **e** toggle manual ligados, cai 2 e não 4; desligar `autoFlanking` no mundo não apaga nem impede o toggle manual.
- **Prova visual (print)**: card de golpe no chat mostrando o grau de sucesso da mesma rolagem forçada com e sem flanqueio, visto igual pelo GM e pelo jogador flanqueado.
- **Spec/REQ**: `REQ-GUE-105..108`, `REQ-CBT-066`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### GUE-F3-03 — Alcance da arma contra a distância do alvo

- **Repo**: ambos
- **Onde**: mesmo bloco de `chat-handler.ts` usado pela GUE-F3-02 (`checkContext.kind === "attack"`); lê `range` do item (`external/fusion-systems-2e/systems/pf2e/src/schemas/item-weapon.ts:57-58`, null = corpo a corpo) e o trait `"reach"` do array de traits da arma (presente em 3 armas hoje no pack `weapons-core`, confirmado por busca); usa o mesmo teste melee/à distância que `resolveAttackAbility` já usa (`external/fusion-systems-2e/systems/pf2e/src/actions/strikes.ts:162-172`, `weapon.range !== null`); consome `PositionQuery.distanceBetween`/`threatens` (GUE-F3-01).
- **Entrega**: O card de golpe (GUE-F1-03) passa a trazer um aviso quando a distância medida entre atacante e alvo não é coberta pela arma empunhada: corpo a corpo sem o trait `reach` ameaça só a própria célula e adjacentes (5 pés), com o trait passa a 10; à distância, compara contra o primeiro incremento de `range` (a penalidade por incremento adicional fica de fora — não foi pedida aqui). O aviso é informativo, no mesmo espírito de D-G08/D-G10: o sistema oferece, não bloqueia o clique. Fica documentado, e não resolvido aqui, que o aumento de alcance por talento (`system.attributes.reach.base`, usado por Lunge — `feats-core/documents.json:59466`, órfão hoje porque o consumidor de `set-property` só cobre `damage-dice-faces`/`upgrade`) fica fora desta tarefa: depende de EFFECT-SOURCE-ITEMS, fora do escopo deste plano.
- **Depende de**: GUE-F3-01, GUE-F1-03
- **Paralelo com**: GUE-F1-06, GUE-F2-02, GUE-F3-02
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: `weapon-range.test.ts`: espada curta (melee, sem `reach`) contra alvo a 2 células → aviso de fora de alcance; a 1 célula → sem aviso; lança (`reach`) a 2 células → sem aviso; arco com `range: 60` contra alvo a 30 pés → sem aviso (dentro do primeiro incremento); a 90 pés → aviso, sem alterar o total rolado nem impedir a rolagem.
- **Prova visual (print)**: card de golpe com o aviso de alcance, ao lado do mesmo card sem aviso contra um alvo adjacente.
- **Spec/REQ**: `REQ-GUE-109..112`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### GUE-F3-04 — Roteiro `tutorial-e2e` da G-F3

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f3.spec.ts` (novo — a pasta hoje tem 15 roteiros, nenhum do Guerreiro); prints em `.fusion-build/guerreiro/L2/f3/` (`.fusion-build/guerreiro/` ainda não existe — criado pela primeira tarefa desta onda que rodar).
- **Entrega**: Combate curto num mundo existente, servidor isolado e data-dir no scratchpad: dois aliados flanqueando um inimigo (mostra o -2 aplicado só naquela rolagem e a ausência de condição persistida no doc do alvo), um golpe corpo a corpo contra alvo fora de alcance (mostra o aviso) e o mesmo golpe contra um alvo adjacente (sem aviso). Smoke como GM e como jogador, com relatório P3 comparando o protótipo (GUE-F0-06) com a tela real.
- **Depende de**: GUE-F3-02, GUE-F3-03
- **Paralelo com**: GUE-F1-07, GUE-F2-03, GUE-F4-03
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### G-F4 — Reações

> **Fronteira revisada (2026-09-16)**: a primeira leitura desta rodada dizia "não existe nada de reação" — impreciso num ponto decisivo. O plano do Alquimista já tem tarefa dona do motor genérico de gatilho e oferta: **`ALQ-F7-05` — "ReactionTrigger: gatilhos e oferta de reação"** (satélite, `systems/pf2e/src/actions/reaction-trigger.ts`, sonnet/high, onda 16 do plano do Alquimista). Ela entrega `ReactionOfferDefinition`, avaliação após o evento (`TurnHooks`, `onDamageApplied`, `onRollResolved`), card sussurrado (`redaction.ts`) e as ações `reaction:accept`/`reaction:decline`, validando aceite **só por permissão e frequência declarada — sem orçamento** (o próprio teste dela prova que aceitar duas reações no mesmo turno é permitido hoje). D-18 (Alquimista, herdada): a oferta **não tem cronômetro** — some no próximo evento do mesmo personagem, nunca um prazo em segundos. As quatro fichas abaixo foram reescritas para nunca reimplementar esse motor: usam-no, citam-no como dependência, e entregam só o que ele deliberadamente não cobre (o **pool derivado de reações** que a D-G14 pede — não um teto fixo —, os gatilhos do eixo marcial, e a ligação com a anotação de canto). Como as frentes rodam em série (D-G18), a `ALQ-F7-05` já estará entregue quando esta fase arrancar: a primeira coisa que cada tarefa faz é conferir o que ela deixou de verdade, não o que a ficha dela prometia.

### GUE-F4-01 — Pool de reações: derivado do ator, alterável por talento (D-G14)

- **Repo**: ambos
- **Onde**: novo `packages/shared/src/combat/reaction.ts` (`ReactionSlot`, `ReactionPool`, `ReactionGrant`, `hasSlotFor`, `spend` — puros, §2.4); novo `packages/server/src/combat/reaction-pool-store.ts` (mesmo padrão de `packages/server/src/combat/targeting-store.ts`: Map em memória por combatente, nunca persistido), com registro em `eventBus.onLifecycle("turnStart", ...)` — a mesma API que `combat/target-handler.ts:169-180` já usa para `"turnEnd"`, e o mesmo ponto onde a GUE-F1-04 zera o MAP. Satélite: `external/fusion-systems-2e/systems/pf2e/src/actions/reaction-trigger.ts` (entregue pela `ALQ-F7-05`) ganha a consulta ao pool antes de confirmar `reaction:accept`; `systems/pf2e/src/derivations/character.ts` passa a derivar os `ReactionGrant` do ator; `systems/engine-2e/src/ruleElementRegistry.ts` (criado pela `ALQ-F4-02`) recebe o handler novo `grant-reaction`, em kebab-case (DF-15).
- **Entrega**: A `ALQ-F7-05` entrega o motor de oferta e aceite inteiro, e deliberadamente **sem orçamento nenhum** — o teste dela permite, por escrito, aceitar duas reações no mesmo turno. Isso serve para reação de 1/dia e quebra esta classe. O que nasce aqui **não é um teto fixo**: é um **pool derivado do ator** (D-G14), uma ficha por rodada como base, e um rule element `grant-reaction` pelo qual talento acrescenta fichas com restrição de uso e validade próprias. Os dois casos do Guerreiro são exatamente os que um contador simples não cobre: **Reflexos Táticos** (nível 10) dá uma ficha por turno seu, utilizável **só para Golpe Reativo**; **Represálias Sem Limite** (nível 20) dá uma ficha no início do turno de **cada inimigo**, válida só naquele turno e só para reação de talento de Guerreiro. Gastar consome a ficha **mais restrita que serve**, senão a genérica morre primeiro e a restrita nunca é usada. Nenhuma peça do motor de oferta é reescrita.
- **Depende de**: GUE-F0-01; **ALQ-F7-05** (motor de oferta e aceite), **ALQ-F1-04** (TurnHooks), **ALQ-F4-02** (registro de rule elements)
- **Paralelo com**: GUE-F0-07, GUE-F1-02, GUE-F1-05
- **Modelo / esforço**: opus / high — contrato derivado novo, estado autoritativo de combate e rule element, cruzando os dois repos.
- **Teste (TDD)**: `reaction-pool.test.ts` (puro) com a regra do PF2e escrita no teste: sem nenhum grant, um combatente tem uma ficha por rodada e a segunda oferta da mesma rodada é recusada; com o grant de Reflexos Táticos, tem duas — e a segunda **só** aceita Golpe Reativo, recusando Bloqueio de Escudo; gastar com Golpe Reativo consome a ficha restrita e deixa a genérica de pé (prova de que a escolha da ficha não é a primeira que aparece); com o grant de Represálias Sem Limite e três inimigos, o pool ganha uma ficha por turno de inimigo e a ficha expira no fim daquele turno, sem acumular. `reaction-pool-handler.test.ts` (socket real, helper de porta): o aceite que excede o pool é recusado **no servidor**, e um `reaction:accept` forjado por quem não é dono é recusado (mesmo padrão do `combat-own-turn.test.ts`, G054).
- **Prova visual (print)**: ficha ou cabeçalho de turno mostrando as fichas de reação disponíveis de um Guerreiro nível 10 (duas, uma marcada "só Golpe Reativo") e depois de gastar uma.
- **Spec/REQ**: `REQ-GUE-130..132`
- **Tamanho**: G
- **Onda**: 3 · **Lote**: L4

### GUE-F4-02 — Gatilhos de reação percebidos pelo servidor (D-G05)

- **Repo**: ambos
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/actions/reaction-trigger.ts` (herdado da `ALQ-F7-05`, que hoje escuta `TurnHooks`, `onDamageApplied` e `onRollResolved` — nenhum evento de movimento). Soma um consumidor de `packages/server/src/net/handlers/vision-handlers.ts` (`buildTokenMoveHandler`, registrado em `"token:move"` — `packages/server/src/net/socket-manager.ts:412`) para o gatilho de movimento, filtrado por `PositionQuery.threatens` (GUE-F3-01). Registra as definições citando `Compendium...Item.Reactive Strike` (`external/fusion-systems-2e/systems/pf2e/packs/actions-core/documents.json:20283-20296`, gatilho RAW: "uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action") e `Dueling Riposte` (`.../packs/feats-core/documents.json:61213-61243`).
- **Entrega**: Registra no motor da `ALQ-F7-05` os três `ReactionOfferDefinition` do eixo marcial que D-G05 fechou. `hit-by-strike` e `missed-by-strike` reaproveitam o `onRollResolved` que a `ALQ-F7-05` já escuta — a graduação de golpe da GUE-F1-03 já alimenta esse evento, sem encanamento novo. `move-within-reach` é gatilho genuinamente novo: nenhum dos três eventos que a `ALQ-F7-05` escuta hoje cobre movimento, então esta tarefa soma essa quarta fonte, ligada ao handler real de `token:move`, testando `threatens(quem se moveu, quem reage)` antes de oferecer. `manipulate-in-reach` — a outra metade do gatilho RAW de Golpe Reativo — fica documentado e **sem automação** nesta onda: não existe hoje, em lugar nenhum do Fusion, um evento de "ação declarada" para Interagir (D-15 mantém a economia de 3 ações por turno fora de escopo, e sem declarar a ação não há o que o servidor perceba) — o mesmo tratamento que D-G05 já reserva para o resto dos 23 documentos de reação.
- **Depende de**: GUE-F4-01, GUE-F3-01, GUE-F1-03, ALQ-F7-05
- **Paralelo com**: GUE-F1-06, GUE-F2-02, GUE-F3-02
- **Modelo / esforço**: sonnet / high — cruza combate, posição e o motor de reação herdado.
- **Teste (TDD)**: `reaction-triggers-martial.test.ts`: um combatente com Golpe Reativo vê a oferta quando um inimigo deixa uma célula que ele ameaça, chegando só a ele e ao GM (reuso do teste de visibilidade da própria `ALQ-F7-05`); o mesmo movimento fora do alcance da reação não oferece nada, provando que `threatens` é consultado e não só "moveu"; um golpe que resolve como acerto contra um combatente com reação de bloqueio dispara `hit-by-strike`; um golpe que resolve como erro dispara `missed-by-strike` de forma genérica (o filtro por grau crítico específico de Ripostar em Duelo é da GUE-F4-04, não desta tarefa).
- **Prova visual (print)**: coberta por GUE-F4-04.
- **Spec/REQ**: `REQ-GUE-133..136`, `REQ-CBT-067`
- **Tamanho**: G
- **Onda**: 5 · **Lote**: L4

### GUE-F4-03 — Oferta de reação como anotação no canto (D-G04)

- **Repo**: satélite
- **Onde**: novo provider registrado contra o slot genérico de anotação da `ALQ-F6-10` — o mesmo mecanismo (`registerTimedStateProvider`) que a `ANI-F3-02` usa para a magia sustentada do Animista. O caminho exato de `ALQ-F6-10` está fora do que consegui conferir nesta sessão (fase ainda não implementada no branch `feat/alquimista` no momento desta pesquisa); por isso cito o mecanismo pelo nome e pelo precedente (`ANI-F3-02`), não por um arquivo que eu não li. Consome as ofertas vivas de `reaction-trigger.ts` (`ALQ-F7-05` + GUE-F4-01/GUE-F4-02).
- **Entrega**: A `ALQ-F7-05` já entrega a oferta como card sussurrado no chat — funciona, mas D-16 (padrão de estado temporizado do Alquimista, reafirmado aqui pelo Alexandre) pede o mesmo slot de anotação de canto que a magia sustentada usa, não um card perdido na rolagem do chat. Esta tarefa não recria a oferta: registra um provider que lê os dados que a `ALQ-F7-05` já produz (`source`, `options`, a quem é dirigida) e os desenha como linha na anotação de canto do dono e do GM, com os mesmos botões `reaction:accept`/`reaction:decline` que a `ALQ-F7-05` já valida no servidor. O que é novo aqui é só a renderização e o caso de múltiplas ofertas simultâneas — um Guerreiro elegível a mais de uma reação ao mesmo tempo: a anotação empilha uma linha por oferta, e cada linha some sozinha quando a `ALQ-F7-05` fecha aquela oferta específica (D-18 — sem cronômetro, some no próximo evento do mesmo personagem), nunca quando outra oferta distinta é aceita ou recusada.
- **Depende de**: GUE-F4-02 (ofertas reais do eixo marcial para ligar), ALQ-F6-10 (slot de anotação)
- **Paralelo com**: GUE-F1-07, GUE-F2-03, GUE-F3-04
- **Modelo / esforço**: sonnet / medium — reuso de dois mecanismos já prontos, sem motor novo.
- **Teste (TDD)**: `reaction-note.test.ts` (três usuários, mesmo desenho do `sustained-note.test.ts` da ANI-F3-02): dono e GM veem a linha da oferta, um terceiro jogador não; duas ofertas simultâneas para o mesmo dono aparecem como duas linhas distintas; aceitar uma não remove a outra da anotação; a linha some quando a `ALQ-F7-05` marca o próximo evento do personagem (D-18), sem nenhum relógio contado no cliente.
- **Prova visual (print)**: anotação de canto com a oferta de Golpe Reativo, vista pelo dono e pelo GM, e sem a linha para um terceiro jogador.
- **Spec/REQ**: `REQ-GUE-137..139`, `REQ-CNV-104`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L4

### GUE-F4-04 — Golpe Reativo e Ripostar em Duelo ponta a ponta

- **Repo**: ambos
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/actions/reaction-trigger.ts` — opções concretas para os dois talentos: `Reactive Strike` (classFeature nível 1, `class-features-core/documents.json:33055-33094`, concede por `grant-item` o documento de ação real em `actions-core/documents.json:20283-20296`) e `Dueling Riposte` (feat nível 8, `feats-core/documents.json:61213-61243`, pré-requisito "Dueling Parry"). A Strike resultante reaproveita o caminho de card já em produção — `strikeCard`/`flags.pf2e.abilityCard` (`CharacterSheet.svelte:272`, `characterSheetVM.ts:2263-2284`), o mesmo que a GUE-F1-03 liga ao alvo — disparado pela aceitação da oferta em vez de um clique na aba Ações. Contador de MAP: `packages/server/src/combat/map-counter.ts` (GUE-F1-04), chamado com `countsForMap:false`.
- **Entrega**: Fecha as duas reações que D-G05 escolheu para provar o eixo ponta a ponta. **Golpe Reativo**: aceitar a oferta de `move-within-reach` (GUE-F4-02) monta uma Strike normal contra quem disparou o gatilho, mas sempre em MAP 0 e sem incrementar o contador da rodada — o texto RAW é explícito ("doesn't count toward your multiple attack penalty, and your multiple attack penalty doesn't apply to this Strike"), o que amarra esta tarefa à `MapCounter` da GUE-F1-04 por um caminho que nenhuma outra tarefa deste plano usa (uma Strike que não entra na conta). **Ripostar em Duelo**: a oferta de `missed-by-strike` só inclui esta reação na lista de opções do ator quando o grau do erro é **crítico** — o texto RAW não é "erraram você", é "critically fails a Strike against you" — e exige estar "se beneficiando de Aparo em Duelo" (Dueling Parry). Como Aparo em Duelo é uma postura (GUE-F6-01, reuso da exclusividade da ANI-F3-03) que ainda não existe nesta onda, o predicado de pré-requisito fica documentado com uma marcação `TODO(GUE-F6-01)` e hoje sempre falha — a reação é oferecida a quem a possui, mas o pré-requisito de postura ativa não bloqueia nem libera de verdade até a F6 chegar. A escolha entre Strike e a manobra Desarmar que o próprio texto do talento também oferece fica só com Strike nesta tarefa; Desarmar chega quando a `ManeuverAction` da GUE-F5-03 existir.
- **Depende de**: GUE-F4-01, GUE-F4-02, GUE-F4-03, GUE-F1-04 (MapCounter), GUE-F3-01, ALQ-F7-05
- **Paralelo com**: GUE-F2-04, GUE-F5-02, GUE-F6-05
- **Modelo / esforço**: sonnet / high — integra cinco contratos numa única prova ponta a ponta.
- **Teste (TDD)**: `reactive-strike.test.ts` / `dueling-riposte.test.ts` (não circulares — a asserção escreve o texto RAW da habilidade, não lê o pack): um Guerreiro nível 1 com Reactive Strike aceita a oferta quando um inimigo sai de uma célula ameaçada, e a Strike resultante usa o bônus de MAP 0 mesmo tendo atacado duas vezes antes no próprio turno, sem mudar o contador da GUE-F1-04; a oferta de Ripostar em Duelo aparece nas opções só quando o erro contra o Guerreiro é crítico, e some da lista quando é falha comum; sem Aparo em Duelo modelado, a reação ainda é oferecida (não trava o fluxo), mas nenhuma asserção depende do pré-requisito bloquear de verdade — o teste documenta o gap em vez de fingir que está fechado.
- **Prova visual (print)**: combate curto — inimigo se move, anotação de canto oferece Golpe Reativo, jogador aceita, card do golpe aparece no chat com MAP 0; segunda cena com erro crítico contra o Guerreiro oferecendo Ripostar em Duelo.
- **Spec/REQ**: `REQ-GUE-140..144`
- **Tamanho**: G
- **Onda**: 7 · **Lote**: L4

### GUE-F4-05 — Roteiro `tutorial-e2e` da G-F4

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f4.spec.ts` (novo); prints em `.fusion-build/guerreiro/L2/f4/`.
- **Entrega**: Combate curto com dois jogadores e um GM: um inimigo sai de alcance e o dono de Golpe Reativo vê a anotação, aceita, e o card aparece no chat; no mesmo combate, um segundo gatilho oferece uma segunda reação na mesma rodada ao mesmo combatente e a oferta é recusada pelo orçamento (GUE-F4-01), com print do motivo da recusa. Smoke como GM e como os dois jogadores, comparando contra o protótipo da GUE-F0-06.
- **Depende de**: GUE-F4-04
- **Paralelo com**: GUE-F5-06
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L4

### G-F5 — Escudo, manobras e mãos

### GUE-F5-01 — Escudo na CA e a ação Erguer o Escudo (D-G07)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/derivations/equipment.ts:159-249` (`stepCharCollectEquipment`) — novo ramo `itemType === "shield"` ao lado do de armadura (`:197`), com `toEquippedShield()` ao lado de `toEquippedArmor` (`:120`), lendo `hardness`/`hp`/`brokenThreshold`/`acBonus` de `ShieldSystemSchema` (`schemas/item-equipment.ts:91-102`) e escrevendo `doc["_equippedShield"]` (ao lado de `doc["_equippedArmor"]`, `:248`); o mesmo passo varre `doc.items` por um `type:"effect"` de slug `raised-shield` ainda não expirado e escreve `doc["_shieldRaised"]`; `external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts:279-300` (`stepCharAc`) — soma `_equippedShield.acBonus` só quando `_shieldRaised === true` e `_equippedShield.broken !== true`; `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/ActionsTab.svelte` (hoje só abre `DocumentDetailsPanel`, comentário `:1-24`) — primeira entrada de um registro novo "linha executável": a linha "Raise a Shield" (`actions-core/documents.json:11405`) passa a aplicar o efeito em vez de abrir a descrição; o efeito `raised-shield` é sintetizado em código no clique, mesmo padrão do "Punho" em `equipment.ts` (sintetizado, não vem de pack) — sem pack novo
- **Entrega**: Hoje um escudo equipado não muda a CA em nenhuma circunstância — `stepCharAc` só lê `_equippedArmor`, e o schema do escudo (`hardness`, `hp`, `brokenThreshold`, `acBonus` "while raised") não tem consumidor nenhum. Esta tarefa fecha as duas pontas do RAW: um escudo só equipado NÃO altera a CA — só conta **erguido**; erguer é a ação já publicada no pack (hoje documento morto), que vira clicável na aba Ações e aplica um efeito com duração (schema `EffectSystemSchema` já aceita `duration:{value,unit,expiry}`) que expira sozinho no início do turno seguinte via o TurnHooks da `ALQ-F2-09` — sem isso "erguido" nunca desligaria. Um escudo `broken` para de conceder o bônus mesmo com o efeito ainda ativo, mesma regra de qualquer item quebrado que não seja armadura. Proficiência com escudo não existe no PF2e (bônus plano, sem rank) — nada a fazer nesse eixo.
- **Depende de**: GUE-F0-01; **ALQ-F2-09** (efeito com duração por TurnHooks)
- **Paralelo com**: GUE-F0-07, GUE-F1-02, GUE-F1-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: escudo `acBonus:2` equipado e NÃO erguido → CA igual à de não ter escudo nenhum; após aplicar o efeito `raised-shield` → CA sobe exatamente 2; simulando o lifecycle `turnStart` do dono → o efeito expira e a CA volta ao valor original (prova que é efeito com fim, não campo do ator); escudo `broken:true` erguido → CA NÃO sobe.
- **Prova visual (print)**: ficha com escudo equipado, CA antes de erguer, aba Ações com "Erguer o Escudo" clicado, CA depois — dois números lado a lado.
- **Spec/REQ**: `REQ-GUE-170..175`, `REQ-PF2-250..252`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L4

### GUE-F5-02 — Bloqueio de Escudo: dureza, PV do escudo e quebra

- **Repo**: satélite (regra pf2e) — toca um handler do core (chamador de dano da `ALQ-F1-08`) sem reimplementá-lo
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/actions/damage.ts` — nova função pura `resolveShieldBlock(incomingAmount, shield)` ao lado de `applyDamagePipeline` (`:122-198`, cujo Passo 2 de dureza em `:158-159` já existe e segue sem chamador), devolvendo `ShieldBlockResult` (contrato §2.5); `external/fusion-systems-2e/systems/pf2e/src/schemas/item-equipment.ts:91-102` — sem mudança de schema, esta tarefa é o primeiro código que ESCREVE `shield.hp.value`/`shield.broken` de volta no item; registro do sistema como respondente do gatilho `hit-by-strike` (extensão que a `GUE-F4-02` abre no core, consumida aqui pela primeira vez) — Shield Block já chega materializado na ficha como item via `grantMaterializer.ts:136-163,497` (uma das 3 regras `grant-item` que funcionam); chamador de dano real: o handler `actor:applyDamage`/`ActorMechanicsService` que a `ALQ-F1-08` entrega (core) — esta tarefa passa `hardness: shield.hardness`, primeiro chamador de produção a preencher esse parâmetro (hoje sempre `0` por default)
- **Entrega**: Shield Block hoje é só uma das três regras `grant-item` que funcionam — o item de reação chega inerte na ficha, sem reação nenhuma no sistema e sem consumidor para o passo de dureza que `applyDamagePipeline` já tem pronto. Esta tarefa liga as três pontas: no gatilho `hit-by-strike` (`GUE-F4-02`), com a oferta no canto (`GUE-F4-03`) e descontada da economia (`GUE-F4-01`), a dureza do escudo reduz o dano recebido e o que sobra é aplicado DUAS VEZES, independentemente — uma no personagem, pelo handler de dano real da `ALQ-F1-06`/`ALQ-F1-08`, e uma no PV do próprio item-escudo, campo até então nunca escrito. Quando o PV do escudo cai ao limiar de quebra ou abaixo, `broken` vira `true`, e a CA que a `GUE-F5-01` deriva para de contar o bônus do escudo mesmo com o efeito "erguido" ainda ativo.
- **Depende de**: GUE-F5-01; GUE-F4-01, GUE-F4-02, GUE-F4-03 (economia, gatilho e oferta de reação); ALQ-F1-06, ALQ-F1-08 (aplicar dano — primeiro chamador de produção do pipeline)
- **Paralelo com**: GUE-F2-04, GUE-F4-04, GUE-F6-05
- **Modelo / esforço**: sonnet / high — cruza reação, dano e estado de item num fluxo só.
- **Teste (TDD)**: a conta é a regra, não a saída do código — escudo dureza 5, PV 12/12, limiar de quebra 6, sofre 12 de dano com o Bloqueio ativo → absorve 5 (dureza), sobram 7; o portador perde 7 PV (menos, se tiver PV temporário — a diferença fica registrada no breakdown, não escondida) e o escudo perde 7, ficando com 5; 5 ≤ 6 → `broken:true`. Segundo cenário: o mesmo escudo, já quebrado e erguido, toma outro golpe — a CA da rolagem seguinte NÃO inclui o bônus. Terceiro: pool sem ficha utilizável na rodada (`hasSlotFor` falso) → a oferta de Bloqueio não aparece.
- **Prova visual (print)**: card de dano recebido com o botão "Bloquear com Escudo" no canto, antes/depois mostrando PV do personagem, PV do escudo e o selo de quebrado.
- **Spec/REQ**: `REQ-GUE-176..183`, `REQ-PF2-253..256`, `REQ-CHT-057..058`
- **Tamanho**: G
- **Onda**: 7 · **Lote**: L4

### GUE-F5-03 — As seis manobras executáveis na aba Ações (D-G08)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/systems/engine-2e/src/maneuvers.ts` — novo: catálogo puro `ManeuverDef` das seis manobras (`ManeuverSlug`, contrato §2.6), herdável pelo SF2e; `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/ActionsTab.svelte` — estende o registro de "linha executável" aberto pela `GUE-F5-01` com as seis entradas (Trip/Grapple/Shove/Disarm/Reposition/Escape — `sourceId`s confirmados em `actions-core/documents.json:26733,25340,26286,25077,26151,11053`); clicar exige alvo mirado (`myTargetTokenId`, `packages/client/src/lib/combat/targeting.ts`, contrato `TargetGesture` da `GUE-F1-01`) e envia `checkContext:{kind:"skill", against, maneuver}` (contrato `SkillCheckContext` da `GUE-F5-05`); card de resultado (satélite) — mostra o grau e um botão "aplicar efeito" que despacha por `ManeuverOutcome.kind` (`condition` → `ALQ-F1-09`/`ALQ-F1-11`; `move`/`drop-held` → sugestão textual, sem mover token nem soltar item sozinho; `none` → nada)
- **Entrega**: As seis manobras existem hoje só como documentos navegáveis — a aba Ações é, no comentário do próprio componente, um "browser de descrição", e não há rolagem de perícia contra a CD de outro ator em lugar nenhum do core. Esta tarefa cria o catálogo de cada manobra (perícia, defesa oposta, efeito por grau) e faz a linha correspondente executar: rola contra o alvo mirado, grada pelo mecanismo genérico da `GUE-F5-05`, e oferece — nunca aplica sozinho — o efeito do grau obtido. Conferido contra o comportamento público do sistema (fato de regra, não texto copiado — CLAUDE.md permite): Derrubar e Desarmar opõem Reflexos, Agarrar/Empurrar/Reposicionar opõem Fortitude, nenhuma usa CA. Escapar é a exceção do lote: sua CD não vem de uma defesa do alvo mirado, e sim do Atletismo de quem prendeu a criatura — por isso lê a CD gravada na própria condição `grabbed` em vez de passar por `SkillCheckContext.against`, único desvio do padrão genérico entre as seis. Desarmar modela só o efeito de crítico (item cai no chão); a penalidade de sucesso normal fica fora do MVP — `ManeuverOutcome` não tem um `kind` para penalidade contínua.
- **Depende de**: GUE-F5-01 (registro de linha executável); GUE-F5-05 (SkillCheckContext); GUE-F1-01 (mira); ALQ-F1-09, ALQ-F1-11 (aplicar condição em alvo)
- **Paralelo com**: GUE-F1-07, GUE-F2-03, GUE-F3-04
- **Modelo / esforço**: sonnet / high — seis manobras, volume com regra factual a conferir.
- **Teste (TDD)**: a asserção escreve a regra confirmada na fonte pública — Atletismo total 24 contra Fortitude DC 20 (bate por 4) executando Agarrar → sucesso → aplica `grabbed`; total 31 (bate por 11, crítico) → aplica `restrained`, efeito DIFERENTE do de sucesso, não o mesmo com rótulo trocado; total 9 (crítico fracasso) → o EXECUTANTE, não o alvo, recebe o efeito adverso. Segundo teste: duas criaturas agarradas por atacantes com Atletismo diferente saem com CDs de Escapar diferentes — prova que Escapar lê a CD gravada na condição, não uma defesa fixa do alvo.
- **Prova visual (print)**: aba Ações com a linha "Derrubar" clicada tendo um alvo mirado, card de resultado com o grau e o botão de aplicar `prone`.
- **Spec/REQ**: `REQ-GUE-184..197`, `REQ-PF2-257..260`
- **Tamanho**: G
- **Onda**: 6 · **Lote**: L4

### GUE-F5-04 — Estado de mãos e empunhadura (D-G11)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/schemas/actor-character.ts` — novo campo `system.fusion.hands:{left, right}` (contrato `HandState`, §2.7), ao lado de `ProficiencyBlockSchema.weapons` (`:118-124`, mesmo arquivo); `external/fusion-systems-2e/systems/pf2e/src/derivations/equipment.ts:159-249` (`stepCharCollectEquipment`) — deriva `HandsDerived` (`free`, `twoHanded`, `heldItemIds`) cruzando `_equippedWeapons`/`_equippedShield` com `system.fusion.hands` e o campo `usage` de cada item (valores reais publicados em `weapons-core/documents.json`: `held-in-one-hand`, `held-in-two-hands`, `held-in-one-plus-hands`), gravando `doc["_handsDerived"]`; `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte` — escolha de mão ao equipar (esquerda/direita/as duas) e botão "largar"; predicados `hands:free:0|1|2`, `hands:wielding:one|two` para o motor de rolagem, consumidos fora desta tarefa pela `GUE-F2-03`
- **Entrega**: O campo de mão só existe como default de schema hoje (`usage:"held-in-one-hand"`), com um único uso fora do schema (um literal isolado na derivação de desarmado); `_equippedWeapons` marca "equipado" sem dizer em qual mão nem quantas ela ocupa. Esta tarefa cria o estado de verdade: duas mãos NOMEADAS, não um contador, porque os 14 talentos do Guerreiro que dependem disso testam duas coisas separadas — "uma mão livre" e "empunhando com as duas mãos" — e um contador não distingue soltar o escudo de soltar a arma. Ao equipar, o jogador escolhe a mão (ou "as duas", para itens de duas mãos); trocar ou largar atualiza na hora. Os 21 documentos do Guerreiro que citam mão livre/duas mãos passam a ter onde ler a resposta — o predicado em si é lido pela `GUE-F2-03`, fora desta tarefa.
- **Depende de**: GUE-F0-01
- **Paralelo com**: GUE-F0-07, GUE-F1-02, GUE-F1-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: personagem com arma `held-in-one-hand` na direita e escudo na esquerda → `free:0`, `twoHanded:false`; larga o escudo → `free:1`; empunha uma arma `held-in-two-hands` → ocupa as DUAS mãos mesmo informando uma só (`twoHanded:true`, `free:0`), e tentar segurar o escudo junto é rejeitado — não é permitido 3 itens em 2 mãos.
- **Prova visual (print)**: inventário com o seletor de mão ao lado de uma arma equipada, indicador "mãos livres: 1" mudando ao trocar de arma.
- **Spec/REQ**: `REQ-GUE-198..205`, `REQ-PF2-261..262`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L4

### GUE-F5-05 — Perícia rolada contra a CD de outra criatura (genérico)

- **Repo**: core
- **Onde**: `packages/shared/src/chat/types.ts:389-398` (`CheckContextSchema`) — quarto membro da união discriminada, `SkillCheckContextSchema` (`kind:"skill"`, contrato §2.6), ao lado do terceiro (`AttackCheckContextSchema` da `GUE-F1-03`); `packages/server/src/chat/chat-handler.ts:1458` (`readActorAc`) — nova função irmã `readActorDefense(db, actorId, against)`, mesmo padrão de nunca confiar no payload: `against:"ac"` reusa `readActorAc`; `"fortitude"|"reflex"|"will"` lê `system.derived.saves.<nome>.dc` (campo `dc` de `DerivedStatistic`, `derivations/types.ts:44-53`, calculado por `stepCharSaves`, `character.ts:332-377`); `"perception"` lê `system.derived.perception.dc` (`stepCharPerception`, `character.ts:389-417`); `packages/server/src/chat/chat-handler.ts:451-507` — o bloco que hoje só trata `checkContext?.kind === "save"` e o caminho `payload.target`+AC ganha um terceiro ramo, `checkContext?.kind === "skill"`, gradado por uma nova `computeSkillDegree(rollResult, dc)` (mesma fórmula de grau de `computeAttackDegree`, `:1620`, trocando CA por CD)
- **Entrega**: O servidor já grada rolagem contra CA (ataque) e contra a CD do próprio conjurador (salvamento), mas não existe caminho para graduar uma perícia contra a CD de OUTRA criatura — base de qualquer manobra e de talentos fora do combate marcial. Esta tarefa generaliza o padrão já testado da `GUE-F1-03` (união discriminada, nunca confia no cliente, sem alvo resolvível não há grau) para as cinco defesas padrão do PF2e — fortitude, reflex, will, ac, perception —, lendo cada uma de onde a derivação real do ator já escreve, nunca inventando um número novo. Não modela CDs que não vêm de uma defesa do alvo mirado (ex.: a CD de Escapar, que é da criatura que prendeu, não do alvo do check) — esse caso fica fora do genérico e é resolvido pontualmente por quem o usa (ver ressalva da `GUE-F5-03`).
- **Depende de**: GUE-F1-03 (terceiro membro da união, precede o quarto); GUE-F1-01 (mira/resolução de alvo)
- **Paralelo com**: GUE-F1-06, GUE-F2-02, GUE-F3-02
- **Modelo / esforço**: opus / high — mecanismo genérico, server-autoritativo, base de todo skill-check contra alvo daqui em diante.
- **Teste (TDD)**: a asserção escreve o grau de sucesso do PF2e, não a saída do código — total do d20+perícia vs CD do alvo: bate por 10+ → sucesso crítico; bate (sem chegar a 10) → sucesso; erra (sem passar de 10) → fracasso; erra por 10+ → fracasso crítico; 20/1 natural ajustam um grau, mesma regra de `computeAttackDegree`. Segundo teste: a MESMA rolagem contra o MESMO alvo, uma vez com `against:"fortitude"` e outra com `against:"reflex"` (defesas diferentes no alvo) sai com graus DIFERENTES — prova que a CD vem da defesa certa, lida do banco, não de um número fixo.
- **Prova visual (print)**: card de rolagem de perícia com alvo mirado mostrando "CD 19 (Reflexos)" e o grau, ao lado do mesmo card sem alvo (comportamento de hoje, sem grau).
- **Spec/REQ**: `REQ-GUE-206..211`, `REQ-CHT-059..060`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L4

### GUE-F5-06 — Roteiro `tutorial-e2e` da G-F5

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f5.spec.ts`; prints em `.fusion-build/guerreiro/L3/f5/`
- **Entrega**: Roteiro que monta um Guerreiro nível 1 com escudo e uma arma de uma mão num mundo existente, servidor isolado e data-dir no scratchpad, fotografando em sequência: a CA antes/depois de Erguer o Escudo; um Bloqueio de Escudo até a quebra do item; as seis manobras executadas na aba Ações contra um alvo mirado, cada uma com o card de grau de sucesso; a troca de mão no inventário refletindo em "mãos livres". Relatório P3 com protótipo (`GUE-F0-06`) × tela real, lado a lado.
- **Depende de**: GUE-F5-01, GUE-F5-02, GUE-F5-03, GUE-F5-04, GUE-F5-05
- **Paralelo com**: GUE-F4-05
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L4

### G-F6 — Postura, grupo de arma e crítico

### GUE-F6-01 — Postura do Guerreiro sobre o mecanismo de exclusividade (D-G12)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/traitGroups.ts:192` (o trait `stance` já é reconhecido como badge — ancoragem para o motor genérico saber quais documentos são posturas); `external/fusion-systems-2e/systems/pf2e/packs/feats-core/documents.json` (os 14 documentos: Everstand Stance, Point Blank Stance, Haft Striker Stance, Disarming Stance, Ricochet Stance, Impassable Wall Stance, Mobile Shot Stance, Disruptive Stance, Dueling Dance, Lunging Stance, Paragon's Guard, Graceful Poise, Multishot Stance, Twinned Defense); novo — `systems/pf2e/src/schemas/actor-character.ts` (postura ativa, mesmo formato que a exclusividade da ANI-F3-03 já declarar no ator); novo — `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts` (ação `toggleStance`, ao lado de `restAll`/`rollStrike`); novo — afford. de alternância em `sheets/pf2e/src/components/sheets/pf2e/ActionsTab.svelte` (mesmo padrão executor da GUE-F5-03) ou indicador no cabeçalho de `CharacterSheet.svelte` — nenhum dos 14 talentos tem hoje qualquer clique associado.
- **Entrega**: Os 14 talentos do Guerreiro com o trait `stance` ganham um gatilho de ativar/desativar, com exclusividade mútua garantida pelo mecanismo genérico que a ANI-F3-03 já entrega (uma postura ativa por vez, imposta pelo sistema — não pelo jogador lembrando de desligar a anterior). O Guerreiro não reimplementa a exclusividade: só liga os 14 documentos a ela pelo trait `stance`, que `traitGroups.ts:192` já reconhece como badge, e constrói o gatilho que falta (nenhum dos 14 tem hoje qualquer afford. clicável). `HandState` (GUE-F5-04) entra como predicado para as posturas que exigem empunhadura específica. Como "Everstand Stance" tem `rules: []` no próprio pack do vendor — e nada garante que as outras 13 estejam mais completas sem conferir cada uma —, a maioria fica por ora só com o estado ligado/desligado e o badge; o efeito numérico de quem tiver regra convertida chega sozinho pelo pipeline da GUE-F2-01/02, sem trabalho adicional aqui.
- **Depende de**: GUE-F0-01, GUE-F2-01, GUE-F5-04; **ANI-F3-03** (postura com exclusividade imposta pelo sistema)
- **Paralelo com**: GUE-F1-03, GUE-F6-02, GUE-F6-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: Guerreiro entra em Everstand Stance (ação): a ficha marca a postura ativa. Ao entrar em Point Blank Stance logo depois, o sistema desliga Everstand Stance sozinho — nunca duas posturas ativas ao mesmo tempo, a regra RAW de que só se pode estar em uma postura por vez. Um talento sem o trait `stance` (ex.: Bravery) nunca aparece como opção de alternância.
- **Prova visual (print)**: ficha com Everstand Stance ativa (badge), depois Point Blank Stance ativada no lugar — mostrando a troca automática, nunca as duas ligadas.
- **Spec/REQ**: `REQ-GUE-220..225`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L3

### GUE-F6-02 — Grupo de arma como eixo de proficiência (D-G09)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/schemas/actor-character.ts:118-124` (`ProficiencyBlockSchema.weapons` só tem 4 categorias — unarmed/simple/martial/advanced — sem slot de grupo); `systems/pf2e/src/schemas/item-weapon.ts:53-55` (`weaponGroup` marcado `[V2]`, opcional, sem consumidor); `systems/pf2e/src/derivations/build.ts:406-426` (aplica o mapa `attacks` da classe nas 4 categorias — onde o eixo de grupo entra em paralelo); `systems/pf2e/src/actions/strikes.ts:250-251` (lê `proficiencies.weapons[weaponCategory]` — precisa de uma leitura irmã pela chave de grupo); `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:852` (`CLASS_CHOICE_SLOTS`, hoje sem "Fighter Weapon Mastery"/"Weapon Legend") e `:2165` (`CHOICE_SLOT_REQUIRED_CLASS`); `sheets/pf2e/src/lib/sheets/pf2e/choiceSetInventory.ts` (inventário de opções do ChoiceSet, precisa dos 16 grupos); `tools/importer-pf2e/src/curation/` (o ChoiceSet de ambas as features está `unconverted`/`unsupported` — precisa de conversão).
- **Entrega**: O schema de proficiência de arma só tem 4 categorias (`actor-character.ts:118-124`) e `weaponGroup` está reservado `[V2]` sem consumidor (`item-weapon.ts:53-55`) — os 5 rule elements `proficiency` (MartialProficiency) dos talentos do Guerreiro não alcançam pipeline nenhum. A escolha de grupo é lacuna de DADO antes de ser lacuna de motor: o ChoiceSet de Fighter Weapon Mastery (nível 5) e Weapon Legend (nível 13) está `unconverted`/`unsupported` no próprio pack do vendor. Esta tarefa converte os dois ChoiceSets no importador, registra um novo slot `weaponGroup` em `CLASS_CHOICE_SLOTS` (mesmo mecanismo da Prática do Animista, ANI-F0-06) e persiste a escolha em `flags.system.rulesSelections`, como qualquer ChoiceSet. A porta de schema já está aberta pela ALQ-F1-01 (REQ-PF2-207): a escolha grava `system.proficiencies.attacks["group:sword"] = { rank, label, predicate }`, e `strikes.ts` passa a checar essa chave além da categoria, tomando o maior dos dois ranks. A GUE-F0-03 garante ao menos uma arma publicada por grupo para exercitar o picker com os 16 grupos de verdade.
- **Depende de**: GUE-F0-01, GUE-F0-03; **ALQ-F1-01** (REQ-PF2-207: proficiência de ataque fora das quatro categorias), **ALQ-F0-07** (GrantItem dinâmico)
- **Paralelo com**: GUE-F1-03, GUE-F6-01, GUE-F6-04
- **Modelo / esforço**: sonnet / high — volume em três camadas (importador, schema/derivação, UI de escolha).
- **Teste (TDD)**: Guerreiro nível 5 que tomou Fighter Weapon Mastery escolhendo o grupo Espada fica Mestre (rank 3) — 2 a mais de proficiência do que o Perito (rank 2) padrão da classe nesse nível — com uma espada longa (grupo espada), e continua só Perito (sem o bônus extra) com um machado (grupo machado), mesmo o machado sendo uma arma marcial qualquer.
- **Prova visual (print)**: tela do Plano no nível 5 oferecendo a escolha de grupo de arma, e a ficha do mesmo Guerreiro mostrando o bônus de ataque maior com espada longa do que com machado.
- **Spec/REQ**: `REQ-GUE-226..235`, `REQ-PF2-263..267`
- **Tamanho**: G
- **Onda**: 4 · **Lote**: L3

### GUE-F6-03 — Especialização crítica por grupo (D-G10)

- **Repo**: satélite
- **Onde**: `packages/shared/src/chat/types.ts` (schema `AbilityCard`, campos `damageFormula`/`critDamageFormula` — ganha um `critSpecEffect` irmão; arquivo do core, tocado como contrato compartilhado, mesmo padrão da `AttackCheckContext` da GUE-F1-03); `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2263-2284` (`strikeCard` — monta o `AbilityCard` que vai ao chat com `flags.pf2e.abilityCard kind:"strike"`; é aqui que o efeito de especialização entra, não nos botões soltos de MAP/Dano/Crítico da ficha, que são o caminho de fallback pré-r20-X1); `sheets/pf2e/src/components/chat/pf2e/AbilityCard.svelte` (renderiza "Rolar dano"/"Rolar dano crítico"; ganha o terceiro botão); pack `feats-core` → "Fighter Weapon Mastery" (nível 5), `unconverted[1]` = `{"key":"CriticalSpecialization","predicate":[{"gte":["item:proficiency:rank",3]}],"_conversionState":"unsupported"}` — regra e predicado já existem no dado, só não convertidos; novo — `systems/pf2e/src/data/critical-specialization.ts` (tabela curada de efeito por grupo, mesmo padrão de curadoria manual do `mechanics.json`).
- **Entrega**: O importador marca `CriticalSpecialization` como `unconverted`/`unsupported` em Fighter Weapon Mastery, com o predicado já escrito no dado do vendor (Mestre ou mais no grupo, `gte: item:proficiency:rank, 3`). Esta tarefa converte a regra, cria uma tabela curada de efeito por grupo de arma (16 entradas) e acrescenta um botão ao card de golpe: quando o resultado é crítico (decidido pelo servidor via GUE-F1-03) e a proficiência no grupo da arma empunhada é Mestre ou mais, o `AbilityCard` ganha um campo opcional com o efeito — oferecido, nunca aplicado sozinho ao alvo (D-G10): o card mostra o efeito e um botão, a aplicação ao alvo é clique humano, o mesmo padrão das seis manobras da GUE-F5-03. `strikeCard` é o ponto real de montagem do card em produção.
- **Depende de**: GUE-F6-02, GUE-F1-03
- **Paralelo com**: GUE-F1-07, GUE-F2-03, GUE-F3-04
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: Guerreiro com Fighter Weapon Mastery e Mestre (rank 3) no grupo Espada acerta um crítico com espada longa: o card oferece o botão de especialização crítica do grupo Espada. O mesmo Guerreiro, com uma arma do grupo Machado (onde só tem Perito, rank 2), acerta um crítico: o card NÃO oferece o botão — abaixo de Mestre não desbloqueia a especialização, o mesmo predicado `gte: item:proficiency:rank, 3` já presente e nunca lido no pack.
- **Prova visual (print)**: card de golpe crítico com espada longa (grupo Espada, Mestre) mostrando o botão de especialização crítica; o mesmo card com um machado (grupo Machado, Perito) sem o botão.
- **Spec/REQ**: `REQ-GUE-236..243`, `REQ-PF2-268..270`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### GUE-F6-04 — Um ataque contra vários alvos (D-G13)

- **Repo**: core
- **Onde**: `packages/server/src/chat/chat-handler.ts:496-506` (hoje monta `messageTargets = [targetPortrait]`, sempre um elemento — o "por design" que vira "por lista"); `specs/38-aba-chat.md:375` (REQ-ACH-074: "Uma magia com salvaguarda PODE carregar vários alvos; um ataque carrega **um**" — a frase a emendar); `packages/shared/src/chat/protocol.ts:95` (`ChatSendPayloadSchema.target: ChatTargetRefSchema.optional()`, singular — precisa de uma variante em lista para as ações multi-alvo); `packages/shared/src/chat/types.ts:47-52` (`RollTargetSchema = {name, ac?}`, sem grau por alvo — ganha `degreeOfSuccess` opcional) e `:513` (`targets: z.array(RollTargetSchema).max(20).optional()` — o array de SAÍDA já existe e já suporta até 20; faltam a entrada e a graduação por alvo); `packages/client/src/lib/combat/targeting.ts` (`TargetingState.byUser: Map<string, Set<string>>` — o estado por usuário já é um conjunto, multi-alvo de verdade; a leitura de hoje, `myTargetTokenId` da GUE-F1-01, só pega um); `packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts:876` (já lê `e.shiftKey` para outro gesto — precedente para "Shift+botão direito acumula no conjunto" em vez de substituir); novo — `rollMultiStrike` em `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts`, satélite, só para os 10 documentos da lista.
- **Entrega**: A API de ataque exclui vários alvos POR DESIGN, não por omissão: `chat-handler.ts:496-506` só grava um portrait, e REQ-ACH-074 diz por escrito que magia com salvaguarda pode carregar vários alvos e um ataque carrega um. Dez documentos do Guerreiro (Rebounding Toss, Double Shot, Quick Reversal, Swipe, Triple Shot, Haft Beatdown, Two-Weapon Flurry, Whirlwind Strike, Needle in the Gods' Eyes, Impossible Volley) não cabem nisso. Esta tarefa emenda REQ-ACH-074 (REQ-ACH-093..096) para permitir N alvos correlacionados num card só, em duas famílias: um único d20 comparado contra várias CAs (geometria via `PositionQuery`/GUE-F3-01, todo adjacente, sem seleção manual) e N rolagens independentes contra N alvos escolhidos (reaproveitando o mesmo gesto de mira da GUE-F1-01/`TargetGesture`, já que `TargetingState.byUser` já é um `Set` por usuário — só falta ler o conjunto inteiro em vez de um único id). `RollTargetSchema` ganha `degreeOfSuccess` por portrait, porque hoje só o resultado no topo carrega o grau. Sem o talento certo, mirar mais de um alvo numa Strike comum continua recusado pelo servidor, não pela UI.
- **Depende de**: GUE-F1-01, GUE-F1-02, GUE-F3-01
- **Paralelo com**: GUE-F1-03, GUE-F6-01, GUE-F6-02
- **Modelo / esforço**: sonnet / high — protocolo, handler e canvas mudam juntos.
- **Teste (TDD)**: Guerreiro com Golpe Redemoinho (Whirlwind Strike) mirando 3 inimigos adjacentes faz UM d20 e compara o MESMO total contra a CA de cada um — pode acertar dois e errar o terceiro no mesmo card, com um grau por alvo. Um Guerreiro com Tiro Duplo (Double Shot) mirando 2 alvos diferentes faz DOIS d20 independentes, cada um contra sua própria CA. Sem nenhum dos dois talentos, uma Strike comum com mais de um `ChatTargetRef` no payload é recusada pelo servidor com erro de validação, não truncada silenciosamente para um.
- **Prova visual (print)**: card de Golpe Redemoinho com 3 mini-resultados (um grau de sucesso por alvo) na mesma mensagem, e o card de Tiro Duplo com 2 rolagens independentes lado a lado.
- **Spec/REQ**: `REQ-GUE-244..251`, `REQ-ACH-093..096`
- **Tamanho**: G
- **Onda**: 4 · **Lote**: L3

### GUE-F6-05 — Roteiro `tutorial-e2e` da G-F6

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f6.spec.ts` (novo); prints em `.fusion-build/guerreiro/L4/f6/` (novo)
- **Entrega**: Roteiro que monta um Guerreiro nível 13 (para ter Weapon Legend, Fighter Weapon Mastery e proficiência Mestre num grupo) num mundo existente, com servidor isolado e data-dir no scratchpad, e fotografa: a alternância de postura sem duas ativas ao mesmo tempo, a escolha de grupo de arma no Plano com o bônus de proficiência aparecendo na Strike certa, o card de crítico com o botão de especialização do grupo escolhido, e o card de Golpe Redemoinho (ou Tiro Duplo) com os múltiplos resultados na mesma mensagem. Relatório P3 com protótipo (`docs/design/guerreiro/prototipo-guerreiro.html`, GUE-F0-06) × tela real, lado a lado.
- **Depende de**: GUE-F6-01, GUE-F6-02, GUE-F6-03, GUE-F6-04
- **Paralelo com**: GUE-F2-04, GUE-F4-04, GUE-F5-02
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

### G-F7 — Escolha diária

### GUE-F7-01 — Flexibilidade de Combate: talento temporário na preparação diária (D-G15)

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2733-2805` (`restAll()` — único fluxo de preparação diária hoje: recupera PV, desexpende slots, reabastece foco; nada de talento temporário); `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:358-363` (botão "Descansar" real, chama `vm.restAll()`); pack `class-features-core` → "Combat Flexibility" (nível 9) e "Improved Flexibility" (nível 15), `rules: []` nos dois — descrição pura, sem rule element; "Ultimate Flexibility" (talento, nível 20) — mesmo eixo (DAILY-CHOICE: 3 documentos, níveis 9/15/20); `sheets/pf2e/src/lib/sheets/pf2e/grantMaterializer.ts:497` (`materializeGrants`) e `:623` (`buildGrantCreateOp`) — padrão de materialização reaproveitado para o item temporário; novo — chamada a `registerDailyPrepStep` (ALQ-F3-05).
- **Entrega**: "Combat Flexibility" (nível 9) tem `rules: []` no pack — é descrição pura ("ganhe um talento de Guerreiro de nível 8 ou menor até sua próxima preparação diária"), e o único fluxo de preparação diária do Fusion hoje é `restAll()`, que só cuida de PV/slots/foco. Esta tarefa registra um passo de preparação diária específico do Guerreiro na pipeline com etapas registráveis que a ALQ-F3-05 entrega (`registerDailyPrepStep`, reaproveitada — o Animista já usa a mesma pipeline na ANI-F2-02): o passo verifica se o personagem tem Combat Flexibility (nível ≥9) ou Improved Flexibility (nível ≥15, eleva o teto de nível do talento elegível), oferece um seletor de talento de Guerreiro dentro do filtro de elegibilidade que o personagem ainda não possui, e materializa a escolha como item TEMPORÁRIO (mesmo padrão de `grantMaterializer.ts`, com marca de origem que o próximo `restAll()` usa para remover antes de oferecer a escolha seguinte — nunca acumula duas). Ultimate Flexibility (nível 20) amplia a mesma escolha diária; a frequência que ele também carrega é escopo da GUE-F7-02.
- **Depende de**: GUE-F0-01, GUE-F2-01; **ALQ-F3-05** (pipeline de preparação diária com etapas registráveis)
- **Paralelo com**: GUE-F1-03, GUE-F6-01, GUE-F6-02
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: Guerreiro nível 9 com Combat Flexibility, ao clicar "Descansar", pode escolher um talento de Guerreiro de nível 8 ou menor que ainda não possui; o talento aparece na ficha até o próximo descanso. Um Guerreiro nível 8 (sem a habilidade) não vê a oferta ao descansar. Descansar de novo troca o talento temporário anterior pelo novo — nunca os dois juntos.
- **Prova visual (print)**: botão "Descansar" clicado num Guerreiro nível 9, abrindo o seletor de talento temporário, e a ficha depois mostrando o talento escolhido entre os permanentes, visualmente distinto.
- **Spec/REQ**: `REQ-GUE-260..267`, `REQ-PF2-271..273`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L3

### GUE-F7-02 — Frequência de uso limitada

- **Repo**: satélite
- **Onde**: `external/fusion-systems-2e/systems/pf2e/src/schemas/item-feat.ts:39-44` (campo `frequency: {max, per: enum[day,encounter,hour,minute,round,turn]}` já existe no schema); dado — "Determination" (nível 14) já tem `frequency: {max:1, per:"day"}` populado no pack; "Haft Beatdown" (nível 10) e "Ultimate Flexibility" (nível 20) NÃO têm o campo preenchido, lacuna de curadoria; zero ocorrências de `.frequency` em `systems/pf2e/src` ou `sheets/pf2e/src` fora do schema — nenhum consumidor; `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2733` (`restAll()` — ponto de reset para `per:"day"`); novo — flag de contagem no item (`flags.fusion.frequencyUsed`), mesmo padrão de persistência do `rulesSelections` (não o `resources` do ator, que é pool de personagem — heroPoints/focusPoints —, não contador por item).
- **Entrega**: O schema já tem o campo (`item-feat.ts:39-44`) e o dado já vem preenchido para "Determination" (`{max:1, per:"day"}`) — mas ninguém lê: zero ocorrências de `.frequency` fora do próprio schema, nos dois repos. É o mesmo padrão de campo-sem-consumidor já visto em PV temporário e nas proficiências de grupo. Esta tarefa cria o contador de uso (`flags.fusion.frequencyUsed` no item), um botão que desabilita quando `used >= max`, e o reset: para `per:"day"` — o caso de Determination, e provavelmente dos outros dois depois de curados —, o reset acontece dentro do `restAll()` que já existe, sem relógio de mundo (D-05). "Haft Beatdown" e "Ultimate Flexibility" entram na lista sem `frequency` populado no pack; esta tarefa também cura os dois valores que faltam. `per:"encounter"/"round"/"turn"` fica fora do escopo testado — o mecanismo reconhece os valores, mas o reset via bus de combate do core (o mesmo do MAP e da reação) não é construído aqui, porque nenhum dos três documentos do Guerreiro precisa disso hoje.
- **Depende de**: GUE-F0-01, GUE-F2-01
- **Paralelo com**: GUE-F1-03, GUE-F6-01, GUE-F6-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: Determination (`frequency: {max:1, per:"day"}`) permite um uso; usar a habilidade desabilita o botão até o próximo descanso. Uma segunda tentativa de uso, sem ter descansado, é RECUSADA PELO SERVIDOR (não só escondida na UI) — o mesmo padrão anti-cheat já usado pelo MAP e pela reação. Depois de `restAll()`, o botão volta a ficar disponível.
- **Prova visual (print)**: Determination na ficha mostrando o uso disponível, botão desabilitado depois de usar, e reabilitado depois de clicar "Descansar".
- **Spec/REQ**: `REQ-GUE-268..275`, `REQ-PF2-274..278`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L3

### GUE-F7-03 — Roteiro `tutorial-e2e` da G-F7 e fechamento do plano

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/guerreiro-f7.spec.ts` (novo); prints em `.fusion-build/guerreiro/L4/f7/` (novo); fechamento — agrega os roteiros de G-F0 a G-F6 já existentes num relatório único.
- **Entrega**: Roteiro que monta um Guerreiro nível 9 (Combat Flexibility) e nível 14 (Determination) num mundo existente, com servidor isolado e data-dir no scratchpad, e fotografa: o seletor de talento temporário ao descansar, o talento aparecendo até o próximo descanso e sumindo depois, e o uso de Determination gastando e reabastecendo com o descanso. Fecha o plano do Guerreiro: roda a varredura dirigida por dado (`varredura-classes.test.ts`, filtro Fighter) para confirmar que nenhuma das 16 features se perdeu ao longo das ondas, agrega os roteiros de G-F0 a G-F6 num relatório único, e registra como pendência EXPLÍCITA (issue, não silêncio) o que ficou fora do MVP: NEW-LAST-ACTION (4 documentos, depende de economia de ações fora de escopo por D-G14), cobertura (D-G17) e qualquer postura das 14 cujo `rules` não tenha sido convertido a tempo da GUE-F6-01.
- **Depende de**: GUE-F7-01, GUE-F7-02
- **Paralelo com**: GUE-F2-04, GUE-F4-04, GUE-F5-02
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; roda `varredura-classes.test.ts -t Fighter` (6/6 na medição de 16/09) antes de fechar, para provar que a onda não regrediu a montagem da classe.
- **Prova visual (print)**: é a tarefa de print — mais o relatório de fechamento agregando G-F0..G-F7.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

## 5. Ondas

Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do pin no core com a suíte verde.

| Onda | Tarefas                                                          | Repo  | Espera algo de fora                                |
| ---- | ---------------------------------------------------------------- | ----- | -------------------------------------------------- |
| 1    | GUE-F0-01, GUE-F0-02, GUE-F0-03, GUE-F0-05                       | ambos | —                                                  |
| 2    | GUE-F0-04, GUE-F0-06, GUE-F1-01, GUE-F1-04, GUE-F2-01, GUE-F3-01 | ambos | `ALQ-F1-04`, `ALQ-F1-05`, `ALQ-F2-08`, `ALQ-F4-19` |
| 3    | GUE-F0-07, GUE-F1-02, GUE-F1-05, GUE-F4-01, GUE-F5-01, GUE-F5-04 | ambos | `ALQ-F1-04`, `ALQ-F2-09`, `ALQ-F4-02`, `ALQ-F7-05` |
| 4    | GUE-F1-03, GUE-F6-01, GUE-F6-02, GUE-F6-04, GUE-F7-01, GUE-F7-02 | ambos | `ALQ-F0-07`, `ALQ-F1-01`, `ALQ-F3-05`, `ANI-F3-03` |
| 5    | GUE-F1-06, GUE-F2-02, GUE-F3-02, GUE-F3-03, GUE-F4-02, GUE-F5-05 | ambos | `ALQ-F7-05`                                        |
| 6    | GUE-F1-07, GUE-F2-03, GUE-F3-04, GUE-F4-03, GUE-F5-03, GUE-F6-03 | ambos | `ALQ-F1-09`, `ALQ-F1-11`, `ALQ-F6-10`              |
| 7    | GUE-F2-04, GUE-F4-04, GUE-F5-02, GUE-F6-05, GUE-F7-03            | ambos | `ALQ-F1-06`, `ALQ-F1-08`, `ALQ-F7-05`              |
| 8    | GUE-F4-05, GUE-F5-06                                             | core  | —                                                  |

Fechamento por lote: L1 na onda 3 · L2 na onda 6 · L3 na onda 7 · L4 na onda 8.

## 6. Lotes de print

Regras comuns: servidor isolado em mundo existente com data-dir no scratchpad, fora da worktree;
primeiro passo confere a branch com `git merge-base --is-ancestor`; um print por tarefa com UI,
visão do Mestre e do jogador; prints em `.fusion-build/guerreiro/<lote>/<fase>/`; relatório P3 em
`.fusion-build/guerreiro/<lote>/relatorio.html`, com **protótipo × tela** contra
`docs/design/guerreiro/prototipo-guerreiro.html`.

O lote agrupa por **ordem de fechamento**, não por número de fase — as fases são temas, e várias
correm entrelaçadas (ver §5).

| Lote | Fases            | Roteiros                        | O que o lote prova                                                                                                |
| ---- | ---------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| L1   | G-F0             | GUE-F0-07                       | a classe com o dado certo: níveis de armadura, os 16 grupos de arma, crítico com `fatal`, dedicação no picker     |
| L2   | G-F1, G-F3       | GUE-F1-07, GUE-F3-04            | **o Guerreiro ataca**: mira, grau de sucesso pela regra, MAP contado, flanqueio e alcance                         |
| L3   | G-F2, G-F6, G-F7 | GUE-F2-04, GUE-F6-05, GUE-F7-03 | a regra escrita no talento mudando número na tela: postura, grupo de arma, especialização crítica, talento do dia |
| L4   | G-F4, G-F5       | GUE-F4-05, GUE-F5-06            | reação oferecida na hora certa, escudo erguido e bloqueando, manobra rolada contra o alvo                         |

O L2 é o lote que muda a mesa: sem ele, nada do resto tem onde acontecer. Se a frente precisar
parar em algum lugar, é depois dele.

## 7. Riscos

| Risco                                          | Efeito                                                                                                                                                                         | Mitigação                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O plano envelhece antes de rodar**           | Esta frente é a terceira da fila (D-G18) e as outras duas vão mexer nos mesmos arquivos. As linhas citadas nas 41 fichas são do estado de 2026-09-16 e podem não existir mais. | Toda ficha cita arquivo **e** o porquê, não só a linha: o porquê sobrevive ao rebase. Ao arrancar a frente, a onda 1 começa por uma conferência das dependências externas — o que a `ALQ-*` entregou de verdade — e as fichas afetadas são corrigidas antes de qualquer código. O `build-resumo.cjs` continua sendo o gate de coerência do plano. |
| `chat-handler.ts` é o gargalo das três frentes | conflito no rebase sobre o que o Alquimista deixou                                                                                                                             | O Guerreiro entra por `checkContext` novo (união discriminada aberta) e por um módulo próprio (`map-counter.ts`), não editando o corpo da graduação; a `ALQ-F5-10` e a `ALQ-F4-09` mexem no mesmo trecho e chegam antes — o ponto de inserção do contexto de ataque precisa ser reconferido ali.                                                  |
| Geometria no servidor                          | custo e latência a cada ataque                                                                                                                                                 | As consultas de posição são puras e usam a matemática já testada de `shared/grid` e `shared/vision`; o flanqueio é calculado por golpe, não por frame, e tem chave de desligar por mundo (D-G06).                                                                                                                                                 |
| Flanqueio automático erra                      | desprevenido aplicado onde a mesa discorda                                                                                                                                     | É estado derivado e visível (badge no token), não condição escrita; o Mestre desliga por mundo **e continua podendo marcar desprevenido à mão, independentemente da posição** (emenda da D-G06).                                                                                                                                                  |
| Contagem de MAP diverge do que o jogador fez   | ataque com penalidade errada, o pior tipo de bug de mesa                                                                                                                       | O contador vive no servidor, com o mesmo anti-cheat do "encerrar o próprio turno" (G054); o seletor de forçar MAP existe justamente para a exceção, e o card grava qual índice foi usado.                                                                                                                                                         |
| Rever a REQ-ACH-074 (um ataque, um alvo)       | mexe num contrato de chat já testado                                                                                                                                           | A revisão é aditiva: a lista de alvos já existe no schema; o que muda é a regra escrita de que ataque não a usa. O teste `chat-target.test.ts` continua verde para o caso de um alvo.                                                                                                                                                             |
| Teste circular (lição #48)                     | verde com regra errada                                                                                                                                                         | Asserção pela regra do PF2e escrita no teste; a `GUE-F2-03` é uma varredura dirigida por dado que existe só para impedir "funciona no talento que eu olhei".                                                                                                                                                                                      |
| 112 talentos, 21 mecanismos                    | plano grande demais para uma leva                                                                                                                                              | Sete fases cumulativas, cada uma com roteiro de print próprio; a G-F0 e a G-F1 sozinhas já devolvem um Guerreiro que ataca, acerta e machuca.                                                                                                                                                                                                     |

## 8. Fora do escopo / futuro

| Item                                          | Motivo                                                                                                                       | Onde retomar                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Cobertura (2 documentos)                      | D-G17: geometria cara para pouco documento                                                                                   | issue própria; a `PositionQuery` já prevê `coverBetween` |
| As três ações do turno                        | D-15 do Alquimista, mantida                                                                                                  | spec 49 (`REQ-ACO`)                                      |
| Saber qual foi a ação anterior (4 documentos) | depende da contagem de ações                                                                                                 | spec 49                                                  |
| Sentidos e deslocamento por rule element      | `Sense` e `BaseSpeed` chegam limpos do importer e o motor não reconhece nenhum dos dois; fora do Alquimista por decisão dele | issue do motor de rule elements                          |
| Refletir magia de volta (2 documentos)        | depende de `COUNTERACT` (`ALQ-F6-21`) e de interceptação no fluxo de conjuração                                              | depois da F6 do Alquimista                               |
| Histórico de quem feriu o alvo (1 documento)  | Assalto Unido é o único dependente                                                                                           | com o log de dano, se e quando houver                    |
| Paridade contra pregen oficial do Fighter     | não existe fixture de Valeros em `pregen-parity.test.ts`; a validação hoje é só de consistência interna                      | issue #49                                                |

## 9. Como este plano se mantém

Nada aqui é escrito à mão duas vezes.

- **Ondas e lotes são derivados** das dependências: `node tools/ondas.cjs tasks.md` recalcula a
  onda de cada ficha por ordenação topológica, respeita o teto de 6 por onda, reescreve as linhas
  "Onda · Lote" e "Paralelo com" e regenera a seção 5. Mudou uma dependência, roda de novo.
- **As faixas de `REQ-GUE` são reatribuídas** por `node tools/reqs.cjs tasks.md`, que distribui os
  ids por fase na ordem das fichas — as fases foram escritas em paralelo e cada uma partiu de um
  bloco próprio.
- **O `tasks-resumo.json` que a skill consome** sai de `node tools/build-resumo.cjs tasks.md
tasks-resumo.json`, que de quebra valida id único, dependência existente, onda que cresce,
  paralelismo coerente, campo obrigatório ausente e teto por onda. Ele falha com código 1 — é
  gate, não relatório.
- **O estado de execução** (`estado.json`) é escrito pelo `record.mjs` da skill, nunca à mão.
- **O inventário no vault** (`Projects/fusion/guerreiro/`) é a fonte do diagnóstico: quando uma
  tarefa entrega um mecanismo, muda-se o `status` e a evidência em
  `docs/design/guerreiro/dados/mecanismos-guerreiro.json` e roda-se `preprocess.cjs`, `gen.cjs`,
  `lacunas.cjs` e `conteudo.cjs` — as fases e as contagens do inventário são derivadas daí.
  Mecanismo compartilhado com Alquimista e Animista vive na pasta deles; mudar um obriga a
  recalcular os derivados das três classes.

Ordem completa depois de editar as fichas:

```bash
cd docs/design/guerreiro
node tools/reqs.cjs tasks.md          # reatribui as faixas REQ-GUE por fase
node tools/ondas.cjs tasks.md         # recalcula ondas, lotes, paralelismo e a seção 5
node tools/build-resumo.cjs tasks.md tasks-resumo.json   # valida e gera o resumo da skill
```

A seção 5 sai em `s5.md` e é colada no lugar da atual — é a única parte do arquivo que um script
escreve e um humano copia.
