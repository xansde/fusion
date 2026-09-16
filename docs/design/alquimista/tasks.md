# Alquimista — plano de tarefas consolidado (F0–F7)

> Origem: merge semântico dos quatro planos paralelos (F0–F1, F2–F3, F4–F5, F6–F7) de 2026-09-15, com as decisões D-01..D-18 respondidas pelo Alexandre no mesmo dia.
> Linha: **pessoal alfa** (`alfa/app` @ `5e208936`; satélite `fusion-systems-2e` pin `v0.1.1`). Toda branch parte de `origin/alfa/app` e volta por PR; satélite com PR no `xansde/fusion-systems-2e` + bump de pin no core.
> Base: inventário no vault `Projects/fusion/alquimista/` (`alquimista-lacunas.md`, `mecanismos/mec-*.md`) conferido contra o código. Onde as notas divergem do código, vale o código (ver Achados).
> Processo: TDD não circular, rolagem e permissão no servidor, redação só via `net/redaction.ts` + `isRolePrivileged`, UI por `docs/design/PROCESSO-UI.md`, porta de teste via `helpers/ports.ts`.

**Totais**: 121 tarefas — F0: 11 · F1: 13 · F2: 16 · F3: 14 · F4: 18 · F5: 12 · F6: 22 · F7: 15. 19 ondas de código + 3 faixas de lote de prints.

## 1. Decisões fechadas

### 1.1 Decisões do Alexandre (2026-09-15)

| ID   | Tema                       | Decidido                                                                                                                                                                                                                                 | Tarefas afetadas                                |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D-01 | Talentos pré-remaster      | Ficam no pack com trait `legacy`; o picker mostra selo "Legado" e tem filtro. Não remover.                                                                                                                                               | F0-03, F0-04, F1-01                             |
| D-02 | Quem aplica dano           | O jogador aperta "Aplicar dano" no card e o dano vai para todos os alvos da ação (foto dos alvos no momento da rolagem).                                                                                                                 | F1-01, F1-05, F1-08, F1-10, F5-07               |
| D-03 | NPC a 0 PV                 | Ganha a condição `dead` visível no token (e `defeated` no combate).                                                                                                                                                                      | F1-01, F1-06, F1-12                             |
| D-04 | Resumo para o jogador      | Vê só quanto dano causou (com a linha de resistência), sem PV restantes.                                                                                                                                                                 | F1-01, F1-03, F1-08, F1-10                      |
| D-05 | Tempo fora de combate      | Sem relógio de mundo. Efeitos expiram no Descansar/preparação diária ou por remoção manual. Sem botão "passar tempo"; aflição fora de combate avança pelo Mestre no card/ficha/anotação.                                                 | F2-01, F2-09, F2-12, F6-01, F6-09               |
| D-06 | Quick Alchemy e duração    | Sem lógica de relógio. Em combate, RAW: item até o início do próximo turno do alquimista, Quick Vial até o fim do turno atual, efeitos limitados a 10 min. Fora de combate: próxima preparação diária ou remoção manual.                 | F3-01, F3-10                                    |
| D-07 | Custo do Craft             | Sem desconto de moedas. O Craft calcula o custo e o emite por `CurrencyPort` (evento `crafting:costRequested`), com implementação no-op que anota no card. A carteira pluga depois.                                                      | F3-01, F3-12, F3-13                             |
| D-08 | Alchemist's toolkit        | Quick Alchemy sem toolkit avisa e deixa fazer.                                                                                                                                                                                           | F3-01, F3-10                                    |
| D-09 | Pack dos itens alquímicos  | Pack novo `alchemical-items-core` gerado pelo importer do satélite, aproveitando a curadoria e o pt-BR dos 35 itens do #107 (linha build/app).                                                                                           | F2-03, F2-04, F2-05, F2-06, F2-07, F2-17, F3-07 |
| D-10 | Scanners antigos           | Migrar agora `embeddedModifiers` e `itemAlterations` para o `RuleElementRegistry`, cobertos pela regressão sobre packs.                                                                                                                  | F2-08, F4-01, F4-19                             |
| D-11 | Toggle de roll option      | O jogador liga no próprio ator sem aprovação do GM.                                                                                                                                                                                      | F4-01, F4-07, F4-08                             |
| D-12 | Prévia de área             | Visível para todos.                                                                                                                                                                                                                      | F5-01, F5-06                                    |
| D-13 | Dano persistente           | Pela condição remaster: no fim de cada turno de quem tem, dano e depois flat check DC 15. Automático para PCs e NPCs, hook `onTurnEnd`.                                                                                                  | F5-01, F5-03                                    |
| D-14 | AdjustDegreeOfSuccess      | Motor genérico; os 98 ligados para todas as classes com regressão. Sem lista de classes habilitadas.                                                                                                                                     | F4-01, F4-04, F4-13                             |
| D-15 | Economia de ações          | Contador de ações por turno **fora do escopo** (o Alexandre precisa desfazer, desistir e planejar sem bloqueio). `ActionCost` fica só como dado exibido.                                                                                 | F7-01, F7-02, F7-11                             |
| D-16 | Save de estágio de aflição | Sem card automático. Aflição ativa vira anotação persistente no canto da tela (Mestre + afetado) com estágio, duração do estágio e quando vence o próximo save; o save sai dali. Padrão de UI para estados temporizados daqui em diante. | F6-01, F6-09, F6-10                             |
| D-17 | DC de veneno               | Só o Mestre vê.                                                                                                                                                                                                                          | F3-11, F6-01, F6-08, F6-10                      |
| D-18 | Oferta de reação           | Sem cronômetro; some no próximo evento do mesmo personagem.                                                                                                                                                                              | F7-01, F7-05                                    |

### 1.2 Decisões de desenho herdadas dos planejadores (mantidas)

| ID    | Decisão                                                                                                             | Origem                       |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| DF-01 | Filtro de legado é regra genérica por trait, não lista do Alquimista                                                | F0 DD-01 + D-01              |
| DF-02 | `ApplyDamage` é op de servidor do core; a conta (IWR, dureza, PV temp., dying) é superfície registrada pelo sistema | F1 DD-02                     |
| DF-03 | Montante e alvos vêm da mensagem gravada, nunca do cliente; valor manual só de GM                                   | F1 DD-03/05 + D-02           |
| DF-04 | TurnHooks aguardados em série, depois de persistir o combate e antes do broadcast; erro isolado                     | F1 DD-06                     |
| DF-05 | Registro de hooks com id e prioridade (não slot único); `registerCombatHooks` vira adaptador                        | F1 DD-07                     |
| DF-06 | Efeito é cópia embutida do pack com origem e início; nunca referência viva                                          | F2 D-02                      |
| DF-07 | Duração conta pelo turno do ator de origem; `encounter` sai no `combatEnd`                                          | F2 D-03                      |
| DF-08 | Um resolvedor (`resolveExpirations`) para efeito e item temporário                                                  | F2 D-04                      |
| DF-09 | Bomba gera strike sem equipar; Interact vira nota                                                                   | F2 D-05                      |
| DF-10 | `ammo` alquímica importada como `consumable/category:"ammo"`                                                        | F2 D-06                      |
| DF-11 | Consumo, DailyPrep e fabricação são ops atômicas de servidor                                                        | F2 D-07/08, F3 D-10          |
| DF-12 | Recurso de classe é dado (descritor `special-resource`), avaliador sem `eval`                                       | F2 D-09                      |
| DF-13 | Item infundido carrega `system.fusion.infused`; DC por `max(DC impressa, Class DC)`                                 | F2 D-11, F6 Powerful Alchemy |
| DF-14 | 16 equipamentos sem estrutura saem com `automation:"manual"` e nota de mesa                                         | F2 D-12                      |
| DF-15 | Registro de RE por `kind` normalizado do importer¹; fases `pre-base → synthetics → item → strike → roll`            | F4 D1/D2/D4                  |
| DF-16 | AEL nunca persiste e tem allowlist de path                                                                          | F4 D5                        |
| DF-17 | Contexto de rolagem vai no op; notas, grau e ajustes resolvidos no servidor                                         | F4 D6                        |
| DF-18 | Texto de nota é curadoria pt-BR clean-room por `sourceId` + índice                                                  | F4 D8                        |
| DF-19 | Dano persistente é condição multi-instância por tipo (maior média vence)                                            | F4 D9                        |
| DF-20 | Área = resolvedor puro compartilhado + prévia efêmera; MeasuredTemplate persistido segue [V2]                       | F4 D10                       |
| DF-21 | Splash remaster: acerto soma para IWR, falha só respingo em alvo + adjacentes, não dobra no crítico                 | F4 D12                       |
| DF-22 | Aflição é item embutido `affliction` com definição copiada; estágio vira `grantedConditions`                        | F6 DD-01/02                  |
| DF-23 | Motor puro em `engine-2e` (aflição, counteract); testes pela regra, nunca pelo pack                                 | F6 DD-03                     |
| DF-24 | Critério G/A/N (reuso, determinismo, dado pronto: 2 de 3) para talentos exóticos                                    | F6 DD-06                     |
| DF-25 | Additive é carimbo único `flags.fusion.additive` no item criado                                                     | F7 DD-08                     |

> ¹ **Emenda de 2026-09-15** (revisão adversarial da onda 1, achado importante #6).
> A ALQ-F4-02 (já mergeada) registrou os cinco handlers MVP com `kind` **camelCase**
> (`flatModifier`/`rollOption`/`note`/`toggleCondition`/`iwr` —
> `systems/engine-2e/src/ruleElementRegistry.ts`), não o kebab-case do importer que
> DF-15 e o exemplo de §2.8 sugerem (`"flat-modifier"`, `"roll-note"`,
> `"adjust-degree-of-success"`, `"item-alteration"`). Motivo: o código pf2e/sf2e
> já existente ANTES da F4-02 (condições em `systems/{pf2e,sf2e}/src/conditions.ts`,
> derivações como `speed.ts`/`embeddedModifiers.ts`/`elementalBlast.ts`) constrói
> `EffectRule` literais com `type` camelCase — renomear os cinco MVP para
> kebab-case teria que tocar esses arquivos de produção também (fora do escopo
> desta correção, alto risco). **Convenção fixada**: o formato de FIO (pack
> `documents.json`, campo `kind`) continua kebab-case; os cinco handlers MVP
> mantêm seu `kind` camelCase por compatibilidade com o código pré-F4-02; um
> materializador (pack items → `EffectSource[]`) faz a ponte entre os dois pelos
> três `kind`s que hoje têm handler (`flat-modifier→flatModifier`,
> `roll-option→rollOption`, `roll-note→note` — ver
> `classBuildHarness.ts::adaptPackRule`/`PACK_KIND_TO_ENGINE_TYPE`, satélite).
> **Daqui pra frente (F4-04+): todo handler NOVO registra com o `kind` kebab-case
> do importer diretamente** (sem entrada na tabela de adaptação) — só os cinco
> MVP já lançados ficam com o nome antigo. A `EffectRuleSchema` de validação
> (`systems/pf2e/src/schema-primitives.ts`) já era agnóstica a essa escolha desde
> antes (aceita `kind` OU `type` como discriminador, `.passthrough()`).

### 1.3 Numeração de specs

| Spec                                       | Prefixo                   | Dono        | Estado                      |
| ------------------------------------------ | ------------------------- | ----------- | --------------------------- |
| 46                                         | `REQ-ATR` (reserva da 45) | Recipientes | reservada, fora deste plano |
| 47 — `47-fabricacao-e-alquimia.md`         | `REQ-FAB-`                | ALQ-F3-01   | nova                        |
| 48 — `48-aflicoes-e-mutagenos.md`          | `REQ-AFL-`                | ALQ-F6-01   | nova                        |
| 49 — `49-custo-de-acao-reacao-additive.md` | `REQ-ACO-`                | ALQ-F7-01   | nova                        |

`FAB`, `AFL` e `ACO` conferidos livres no bloco `prefixos` de `specs/README.md` (nenhum REQ com esses prefixos em `specs/`).

Reserva de ids nas specs existentes (maiores atuais: `REQ-PF2-205`, `REQ-SYS-137`, `REQ-CBT-055`, `REQ-CHT-051`, `REQ-CNV-094`, `DEC-PF2-10`). O `spec-lint` confirma na escrita; quem escreve depois rebaseia se a faixa andou.

| Faixa                                                                          | Tarefa dona           |
| ------------------------------------------------------------------------------ | --------------------- |
| `REQ-PF2-206..216`, `REQ-CBT-056..060`, `REQ-SYS-138..142`, `REQ-CHT-052..053` | ALQ-F1-01 (inclui F0) |
| `REQ-PF2-217..228`, `REQ-SYS-143..144`, `DEC-PF2-11..12`                       | ALQ-F2-01             |
| `REQ-SYS-145..148` + `REQ-FAB-*`                                               | ALQ-F3-01             |
| `REQ-SYS-149..152`, `REQ-PF2-229..230`                                         | ALQ-F4-01             |
| `REQ-PF2-231..235`, `REQ-CNV-095..096`                                         | ALQ-F5-01             |
| `REQ-AFL-*`                                                                    | ALQ-F6-01             |
| `REQ-ACO-*`, emenda `REQ-PET-021`                                              | ALQ-F7-01             |

## 2. Contratos canônicos

Um shape por contrato. A tarefa dona fixa em spec e tipa; consumidor que assumia outra forma foi ajustado (coluna "Ajustes").

| Contrato                                  | Dono           | Consumidores                                                                       | Ajustes feitos nos consumidores                                                                                                                                                                |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ApplyDamage                               | F1-01/02/06/08 | F2-11, F2-14, F5-03, F5-07, F5-09, F5-11, F6-08, F6-09, F6-18, F6-20, F7-07, F7-16 | F2 usava `packets`, F5 `combineForIwr`, F6 `components` + `ignoreResistance` solto: todos passam a `instances[]` e `ActorMechanicsService`                                                     |
| TurnHooks                                 | F1-02/04       | F1-12, F2-09, F5-03, F6-09                                                         | F2 queria listener no core e `combatEnd`; F4-F5 `registerTurnHook`; F6 `onTurnStart(actorId)`: todos viram `registrar.onX(id, fn)` no satélite; `onRoundEnd`/`onCombatEnd` entram no registrar |
| TargetSelection                           | F1-05          | F1-08, F1-10, F2-11, F5-06, F5-10, F6-15                                           | alvos da ação vêm do `targetSnapshot` gravado na rolagem (D-02); F4-F5 `setTargets` vira `setMyTargets` no client                                                                              |
| ApplyCondition                            | F1-02/07/09    | F1-11, F5-02, F6-08, F6-21, F7-08                                                  | ganha `data` (persistente multi-instância) e `expiry` (Debilitating ancorado no criador)                                                                                                       |
| EffectItem                                | F2-01/08/09    | F2-12, F3-05, F6-17, F6-18, F7-08, F7-09                                           | `grantedConditions` só no derivado (sem item de condição órfão)                                                                                                                                |
| ConsumeItem                               | F2-11          | F2-14, F3-06, F5-11, F6-11, F6-15, F6-18, F7-07                                    | `effectRef` único vira `effectRefs[]` (Combine Elixirs); `onConsume`/`onConsumed` viram `registerConsumeHook`                                                                                  |
| ItemStrike                                | F2-13/14       | F3-06, F4-16, F5-07, F6-11, F7-11                                                  | `onStrikeResolved` da F6 vira `onRollResolved` (F4-09), que cobre também strike de arma comum                                                                                                  |
| ActorResource                             | F3-02          | F3-04, F3-06, F6-19, F6-20, F7-05, F7-12                                           | frequência 1/dia usa slug `freq:<itemSlug>`                                                                                                                                                    |
| DailyPrep                                 | F3-05          | F3-09, F6-20, F7-12                                                                | —                                                                                                                                                                                              |
| FormulaBook                               | F3-07          | F3-08, F3-12, F7-06                                                                | —                                                                                                                                                                                              |
| CraftingAbility                           | F3-08          | F3-09, F3-10, F7-06, F7-11                                                         | `beforeItemCreated` da F7 vira `registerCraftingDraftHook`; payload ganha `additives`                                                                                                          |
| CurrencyPort                              | F3-12          | carteira futura                                                                    | novo (D-07)                                                                                                                                                                                    |
| RuleElementRegistry                       | F4-02 (+F4-19) | F2-08, F4-06..16, F6-12, F6-14, F6-18, F7-14                                       | scanners antigos migrados (D-10); F2-08 deixa de pular kinds                                                                                                                                   |
| RollNotes + onRollResolved                | F4-09          | F2-14, F4-10, F4-13, F5-07, F5-10, F6-08, F6-12, F7-05, F7-14                      | `rollContext` nasce já na F2-14                                                                                                                                                                |
| PersistentDamage                          | F5-02/03       | F6-13, F7-07                                                                       | `applyPersistentDamage` = `ApplyCondition{slug:"persistent-damage", data}`; flat check automático no `onTurnEnd` (D-13)                                                                        |
| SplashDamage                              | F5-07          | F5-08, F6-13, F7-07, F7-10                                                         | —                                                                                                                                                                                              |
| AreaTargets                               | F5-05          | F5-06, F5-07, F6-15, F7-08, F7-10                                                  | `areaTemplateId` da F6 vira `AreaQuery`                                                                                                                                                        |
| Affliction + SaveRequest + TimedStateNote | F6-01/03/08/10 | F6-09, F6-12..22, F7-07, F7-08, F7-10                                              | save de estágio sai da anotação, não de card automático (D-16)                                                                                                                                 |
| PoisonDelivery                            | F6-11/12       | F6-13, F6-14, F6-15                                                                | —                                                                                                                                                                                              |
| Mutagen                                   | F6-17/18       | F6-19, F6-20, F7-14, F7-16                                                         | —                                                                                                                                                                                              |
| Counteract                                | F6-21          | F7-09                                                                              | —                                                                                                                                                                                              |
| ActionCost (só dado)                      | F7-02          | F6-11, F7-10, F7-11                                                                | sem `ActionBudget` (D-15)                                                                                                                                                                      |
| ReactionTrigger                           | F7-05          | F6-19, F6-22, F7-16                                                                | aceite validado por permissão + frequência, sem orçamento (D-15)                                                                                                                               |
| AdditiveHook                              | F7-06          | F5-11, F7-07..10                                                                   | carimbo lido por F5-11 via fixture antes da F7-06 existir                                                                                                                                      |

### 2.1 `ApplyDamage`

```ts
// socket "actor:applyDamage" — ActorApplyDamagePayloadSchema (@fusion/shared)
interface DamageInstanceInput {
  type: string; // "fire" | "piercing" | "healing" | "temp-hp" | …
  category?: "persistent" | "splash" | "precision";
  amount?: number; // só GM ou actingAs "system"
  source?: { messageId: string; rollIndex: number }; // o server relê o total gravado
  traits?: string[]; // exceções de IWR (magical, silver…)
  materials?: string[]; // cold-iron, silver… (F5-09)
  critical?: boolean;
  nonlethal?: boolean;
}
interface ActorApplyDamagePayload {
  instances: DamageInstanceInput[]; // mesmo tipo no mesmo payload soma antes do IWR
  targetTokenIds?: string[]; // só GM (override); player usa o targetSnapshot da mensagem
  selfActorId?: string;
  multiplier?: 0 | 0.5 | 1 | 2;
  basicSave?: { degree: DegreeOfSuccess };
  hardness?: number;
  ignoreResistance?: { type: string; value: number }[]; // Exploitive Bomb
}
// server: ActorMechanicsService.applyDamage(payload, { actingAs: { userId, role } | "system" })
// sistema: registrar.registerActorMechanics({ applyDamage(actor, instances, opts): ActorMechanicsPatch, applyCondition(actor, req): ActorMechanicsPatch })
interface ActorMechanicsPatch {
  diff: Record<string, unknown>;
  embeddedCreate: Item[];
  embeddedDelete: string[];
  breakdown: DamageBreakdownStep[];
  flags: { droppedToZero: boolean; dead: boolean; dyingChanged: boolean };
}
// broadcast: card "actor:damageApplied" (player vê dano causado, sem PV — D-04)
// hook: registrar.onDamageApplied(id, fn) — alimenta ReactionTrigger
```

Permissão: GM em qualquer ator; player dono do `casterActorId` aplica em todos os alvos do `targetSnapshot` da rolagem (D-02); aplicar em si dispensa snapshot. Character a 0 PV → dying/wounded/doomed; NPC a 0 PV → `dead` + `defeated` (D-03); não letal → unconscious.

### 2.2 `TurnHooks`

```ts
registrar.onTurnStart(id: string, fn: TurnHookFn, opts?: { priority?: number });
registrar.onTurnEnd(id: string, fn: TurnHookFn, opts?: { priority?: number });
registrar.onRoundStart(id: string, fn: RoundHookFn, opts?: { priority?: number });
registrar.onRoundEnd(id: string, fn: RoundHookFn, opts?: { priority?: number });
registrar.onCombatEnd(id: string, fn: (e: { combat: CombatDocument; actorIds: string[] }, ctx: TurnHookContext) => void | Promise<void>);
type TurnHookFn = (
  e: { combat: CombatDocument; combatant: CombatantDocument & { actorId: string | null }; actor: Record<string, unknown> | null },
  ctx: TurnHookContext,
) => void | Promise<void>;
interface TurnHookContext {
  applyDamage(p: ActorApplyDamagePayload): Promise<ApplyDamageAck>; // actingAs "system"
  applyCondition(p: ActorApplyConditionPayload): Promise<ApplyConditionAck>;
  roll(formula: string, opts: { flavor: string; speakerActorId?: string; rollMode?: RollMode }): Promise<RollResultData>;
  chat(card: { content: string; flags?: Record<string, unknown>; speakerActorId?: string }): Promise<void>;
  updateActor(actorId: string, diff: Record<string, unknown>): Promise<void>;
  createEmbedded(actorId: string, items: Record<string, unknown>[]): Promise<void>;
  deleteEmbedded(actorId: string, itemIds: string[]): Promise<void>;
  worldTime: { round: number; turn: number };
}
```

Ordem: `turnEnd(atual) → roundEnd → roundStart → turnStart(próximo)`; `combatEnd` no encerramento. Dentro do evento, prioridade decrescente e depois ordem de registro; em série, com await, depois de persistir e antes do broadcast; erro isolado. Ids e prioridades:

| Evento                          | Id                                         | Prioridade | Tarefa |
| ------------------------------- | ------------------------------------------ | ---------- | ------ |
| turnEnd                         | `pf2e.persistentDamage`                    | 100        | F5-03  |
| turnEnd                         | `pf2e.frightenedDecay`                     | 50         | F1-12  |
| turnEnd / turnStart / combatEnd | `pf2e.effectExpiry`                        | 40         | F2-09  |
| turnStart                       | `pf2e.recoveryCheck`                       | 80         | F1-12  |
| turnStart                       | `pf2e.afflictionStage` (só contagem, D-16) | 70         | F6-09  |
| todos                           | `pf2e.reactionOffers`                      | 0          | F7-05  |

### 2.3 `TargetSelection`

```ts
// server (packages/server/src/combat/target-selection.ts)
resolveTargetSelection(userId): Array<{ tokenId: string; actorId: string | null; sceneId: string }>;
assertTargetsSelected(userId, role, tokenIds): { ok: true } | { ok: false; code: "FORBIDDEN"; missing: string[] };
// chat-handler grava na mensagem de rolagem: flags.fusion.targetSnapshot = resolveTargetSelection(autor)
// client
getMyTargets(): ReadonlyArray<{ tokenId: string; actorId: string | null; name: string }>; // runes, só do próprio usuário
setMyTargets(tokenIds: string[]): void; // lote sobre combat:target (prévia de área)
```

Seleção viva é efêmera e limpa no `turnEnd` do dono (REQ-CBT-055); a foto na mensagem não muda depois.

### 2.4 `ApplyCondition`

```ts
// socket "actor:applyCondition"
interface ActorApplyConditionPayload {
  targetTokenIds: string[];
  selfActorId?: string;
  slug: string; // PF2E_CONDITION_SLUGS + "dead"
  mode: "add" | "remove" | "set" | "increase" | "decrease";
  value?: number | null;
  data?: Record<string, unknown>; // ex.: { instance: PersistentDamageInstance }
  expiry?: FusionExpiry; // ex.: até o turn-start do alquimista criador
  source?: { messageId?: string; itemUuid?: string; effectItemId?: string };
}
```

GM em qualquer ator; player no próprio ator ou nos alvos da sua seleção. Imunidade (REQ-PF2-053), maior valor (REQ-PF2-054), dying puxa unconscious.

### 2.5 `EffectItem` e expiração

```ts
type ExpiryOn = "turn-start" | "turn-end" | "round-end" | "combat-end" | "daily-prep" | "never";
interface FusionExpiry { on: ExpiryOn; ownerActorId: string; remainingRounds?: number }
interface EffectItemSystem {
  duration: { value: number; unit: "round" | "minute" | "hour" | "day" | "encounter" | "unlimited"; sustained: boolean; expiry: "turn-start" | "turn-end" | "round-end" | null };
  rules: EffectRule[];
  grantedConditions: { slug: string; value?: number }[]; // materializadas só no derivado
  iwr?: IwrBlock;
  mutagen?: MutagenPartition; // F6-17
  fusion: {
    origin: { actorId: string; itemSourceId?: string; itemLevel?: number; infused?: boolean };
    startedAt: { combatId: string | null; round: number | null };
    expiry: FusionExpiry;
    automation?: "full" | "partial" | "manual";
  };
}
resolveExpirations(actor, event:
  | { type: "turn-start" | "turn-end" | "round-end"; actorId: string; combatId: string; round: number }
  | { type: "combat-end"; combatId: string }
  | { type: "daily-prep"; actorId: string }
): { expiredItemIds: string[]; decremented: { itemId: string; remainingRounds: number }[] };
```

Fora de combate nada corre sozinho (D-05). Item físico temporário usa o mesmo `system.fusion.expiry`.

### 2.6 `ConsumeItem` e `ItemStrike`

```ts
// socket "item:consume"
interface ItemConsumePayload {
  actorId: string;
  itemId?: string;
  resourceSlug?: string; // mode "resource" (frasco versátil)
  mode: "use" | "strike" | "resource";
  mapIndex?: 0 | 1 | 2;
  expectedVersion: number;
}
interface ItemConsumeResult {
  consumed:
    | { itemId?: string; quantityLeft: number; destroyed: boolean }
    | { resourceSlug: string; valueLeft: number };
  appliedEffectIds: string[];
  chatMessageIds: string[];
}
// system-api: ConsumeItemDefinition.plan(actor, item, payload, ctx); registerConsumeHook(id, fn(ctx))
// item: system.fusion.effectRefs: string[] (sourceIds do equipment-effects-core)
// erros: PERMISSION_DENIED | NOT_FOUND | VALIDATION_FAILED | CONFLICT
interface ItemStrikeFields {
  source:
    | { kind: "item"; itemId: string }
    | { kind: "resource"; resourceSlug: string; level: number };
  consumesOnUse: true;
  quantityLeft: number; // 0 = strike some
  itemBonus: number;
  rangeIncrement: number;
  splash?: { value: number; damageType: DamageType };
  persistent?: {
    dice: number | null;
    faces: number | null;
    value?: number;
    damageType: DamageType;
  };
  notes: string[];
}
// rolar = item:consume{mode:"strike"}; a mensagem leva flags.fusion.rollContext e targetSnapshot
```

### 2.7 `ActorResource`, `DailyPrep`, `FormulaBook`, `CraftingAbility`, `CurrencyPort`

```ts
interface ActorResourceState { value: number } // system.resources.special[slug]
interface ActorResourceDerived { slug: string; label: string; value: number; max: number; level?: number; recharge: "daily-prep" | "none" | { every: "10-minutes"; amount: number } }
interface SpecialResourceDescriptor { kind: "special-resource"; slug: string; max: string; level?: string; recharge?: ActorResourceDerived["recharge"]; mode?: "set" | "add"; label?: string }
// frequência: slug "freq:<itemSlug>", recharge "daily-prep"
// socket "actor:dailyPrep" { actorId, choices?: Record<stepId, unknown>, expectedVersion }
interface DailyPrepStepDefinition {
  id: string; order: number; // hp=100, spellSlots=200, focus=300, resources=400, expiry=500, advancedAlchemy=600
  appliesTo(actor): boolean;
  needsChoice?(actor): DailyPrepChoiceSpec | null;
  run(actor, ctx: { choice?: unknown; prepId: string }): { writes: DocOp[]; summary: string[] };
}
interface FormulaEntry { sourceId: string; packId: string; addedAt: string } // system.crafting.formulas
interface CraftingAbilityDefinition {
  slug: string; appliesTo(actor): boolean; maxItemLevel(actor): number;
  cost(actor, count): { resourceSlug: string; amount: number } | null;
  capacity?(actor): number; maxPerUse?(actor): number;
  expiry(actor, ctx: { inCombat: boolean; formula: ItemDoc }): FusionExpiry; // D-06
}
interface CraftingCreatePayload { actorId: string; abilitySlug: string; formulaSourceIds: string[]; additives?: Record<string, string>; expectedVersion: number }
registerCraftingDraftHook(id: string, fn: (draft: ItemDraft, ctx: CreationCtx) => ItemDraft); // AdditiveHook pluga aqui
// item criado: traits += "infused"; system.fusion.infused = { actorId, classDc }; system.fusion.expiry
// lote diário: system.crafting.dailyBatch = { prepId, made, max }
// socket "crafting:craft" { actorId, formulaSourceId, quantity, days }
interface CurrencyPort { requestCost(req: { actorId: string; amount: { gp: number; sp: number; cp: number }; reason: "craft"; messageId: string }): Promise<{ status: "noted" | "debited" | "insufficient" }> }
// implementação atual: no-op que emite crafting:costRequested e anota "custo: X po (não descontado)" no card (D-07)
```

### 2.8 `RuleElementRegistry` e `RollNotes`

Ver nota¹ na seção 1.2 (DF-15): os cinco handlers MVP já lançados (ALQ-F4-02) usam
`kind` camelCase (`flatModifier`/`rollOption`/`note`/`toggleCondition`/`iwr`); um
adaptador na fronteira pack→EffectSource faz a ponte com o `kind` kebab-case do
importer para esses três que colidem. Handler NOVO (F4-04+) registra com o `kind`
kebab-case do importer diretamente, como o exemplo abaixo já mostrava.

```ts
type RulePhase = "pre-base" | "synthetics" | "item" | "strike" | "roll";
interface RuleElementHandler<R extends EffectRule = EffectRule> {
  kind: string; // "flat-modifier", "roll-note", "adjust-degree-of-success", "item-alteration"… (F4-04+; os 5 handlers MVP já lançados usam kind camelCase — ver nota¹ acima)
  phase: RulePhase;
  normalize(raw: Record<string, unknown>): R | null; // null => unsupportedLog
  apply(rule: R, ctx: RuleApplyContext): void;
}
interface RuleElementRegistry {
  register(h: RuleElementHandler): void; // lança em kind duplicado
  get(kind: string): RuleElementHandler | undefined;
  handlersFor(phase: RulePhase): readonly RuleElementHandler[];
  kinds(): ReadonlySet<string>;
}
interface RollContext { actorId: string; itemId?: string; selectors: string[]; options: string[] } // flags.fusion.rollContext
interface ResolvedRollNote { selector: string; title: string; text: string; outcome?: DegreeOfSuccess[]; sourceItemId: string }
// flags.fusion.rollNotes: ResolvedRollNote[] (redigido com o resultado)
registrar.onRollResolved(id, fn(e: { message; rollContext: RollContext; degree: DegreeOfSuccess | null; targets: TargetSnapshot }, ctx));
// selectors reservados: "affliction-initial-save", "affliction-stage-save"
```

Todo handler novo exige o teste de escopo da regressão sobre packs (F4-03): só atores com aquele `kind` mudam.

### 2.9 `PersistentDamage`, `SplashDamage`, `AreaTargets`

```ts
interface PersistentDamageInstance { id: string; damageType: string; formula: string; dc: number; assisted: boolean; sourceItemId?: string }
// condição "persistent-damage" com system.instances[]; adicionar = ApplyCondition{ slug, mode:"add", data:{ instance } }
// onTurnEnd("pf2e.persistentDamage"): rola cada instância -> ctx.applyDamage -> flat check automático (15; 10 se assisted) -> sucesso remove
// card action "persistent:assist" { actorId, instanceId } marca assisted para o próximo teste
interface SplashPlan { primary: DamageInstanceInput[]; splash: { targets: TokenRef[]; instances: DamageInstanceInput[] } }
computeSplash(strike, degree, targetToken, opts: { radiusFt: 5 | 10; shape?: "adjacent" | "cone"; directionDeg?: number; splashBonus?: number }): SplashPlan;
type AreaShape = "adjacent" | "burst" | "emanation" | "cone";
interface AreaQuery { sceneId: string; origin: { tokenId: string } | { x: number; y: number }; shape: AreaShape; sizeFt: number; directionDeg?: number; includeOrigin?: boolean }
resolveAreaTargets(scene: SceneGeometry, tokens: TokenFootprint[], q: AreaQuery): { cells: GridCell[]; tokenIds: string[] };
// mesma função no servidor e no client; prévia efêmera visível para todos (D-12)
```

### 2.10 `Affliction`, `SaveRequest`, `TimedStateNote`, `PoisonDelivery`, `Mutagen`, `Counteract`

```ts
type DurationSpec = { value: number; unit: "round" | "minute" | "hour" | "day" } | { formula: string; unit: "round" | "minute" | "hour" | "day" };
interface AfflictionStage { stage: number; damage: { formula: string; damageType: DamageType; category?: "persistent" }[]; conditions: { slug: string; value?: number }[]; effectUuids: string[]; text?: string; duration: DurationSpec | null }
interface AfflictionDefinition { kind: "poison" | "disease" | "curse"; delivery: Array<"injury" | "ingested" | "inhaled" | "contact">; save: { statistic: "fortitude" | "reflex" | "will"; dc: number }; onset: DurationSpec | null; maxDuration: DurationSpec | null; stages: AfflictionStage[]; virulent: boolean; level: number; provenance: "parsed" | "curated" }
interface AfflictionState { definition: AfflictionDefinition; sourceItemUuid: string | null; originActorId: string | null; stage: number; onsetRemaining: Elapsed | null; elapsedTotal: Elapsed; nextSaveIn: Elapsed | null; saveDue: boolean; consecutiveSuccesses: number; dcOverride?: number; maxDurationBonus?: DurationSpec; grantedConditions: { slug: string; value?: number }[] }
exposeInitial(def, degree, existing?): AfflictionTransition;
progressOnSave(state, degree): AfflictionTransition;
advanceTime(state, delta: Elapsed): { state: AfflictionState | null; savesDue: number; expired: boolean }; // em combate, pelo hook de contagem
mergeAfflictions(a, b): AfflictionDefinition; extendMaxDuration(def, by, cap): AfflictionDefinition;
// ações: affliction:expose { sourceItemId | definition, targetActorIds, via: "strike" | "direct" | "area", originActorId, rollOptions[] }
//        affliction:rollStageSave { actorId, afflictionItemId }  (dono do afetado ou GM, a partir da anotação)
//        affliction:advanceStage { actorId, afflictionItemId, delta: 1 | -1 }  (só GM; fora de combate, D-05)
// SaveRequest — card action "check:requestSave"
interface SaveRequest { targetActorIds: string[]; statistic: string; dc: number | { kind: "class-dc" | "item"; actorId: string; itemId?: string }; basic?: boolean; rollOptions: string[]; onResolvedHook: string }
// DC calculada no servidor, redigida para não-privilegiados (D-17); resolveItemSaveDc(item, creator) da F3-11
// TimedStateNote — slot de HUD no client, alimentado pelo sistema
registerTimedStateProvider(id: string, fn: (actor, viewer) => TimedStateNote[]);
interface TimedStateNote { id: string; actorId: string; title: string; stageLabel?: string; stageDuration?: string; nextDue?: { rounds: number } | "gm-advances"; text?: string; actions: CardButton[]; audience: "gm-and-owner" }
// PoisonDelivery
interface AppliedPoison { kind: "poison" | "versatile-vial"; definition: AfflictionDefinition | null; vialDamage?: { formula: string; damageType: DamageType }; dc: number; appliedByActorId: string; sourceItemUuid: string | null; expires: { event: "turnEnd"; actorId: string } | null; infusedCreatorActorId?: string }
// poison:apply { actorId, poisonItemId, weaponItemId } · poison:expose { actorId, poisonItemId, targetActorIds | area: AreaQuery } · poison:clear { actorId, weaponItemId }
// entrega: onRollResolved com degree ∈ {success, criticalSuccess} e appliedPoison -> affliction:expose, mesmo com dano pós-IWR 0
// Mutagen
interface MutagenPartition { benefitRules: number[]; drawbackRules: number[]; suppressed: { benefit: boolean; drawback: boolean }; appliedSeq: number }
mutagenBenefitLimit(actor): 1 | 2;
applyMutagenLimit(active: EffectDoc[], incoming: EffectDoc, limit): { suppressBenefitOf: string[]; needsChoice: boolean };
// Counteract
counteractRankFromLevel(level: number): number; // ceil(level/2)
resolveCounteract(i: { counteractRank: number; degree: DegreeOfSuccess; targetRank: number }): { removed: boolean; maxRankAffected: number | null };
// counteract:attempt { actorId, targetActorId, target: { kind: "condition" | "effect" | "affliction"; id }, source: { rank; statistic?; modifier? }, targetRankOverride? }
```

**Padrão de UI registrado (D-16)**: estado temporizado ativo (aflição agora; dano persistente e efeito com duração podem adotar depois, sem escopo novo aqui) aparece como anotação persistente no canto da tela, só para o Mestre e o afetado, com estágio, duração do estágio e quando vence a próxima ação; a ação sai da anotação. Sem duração estruturada, mostra só o texto.

### 2.11 `ActionCost`, `ReactionTrigger`, `AdditiveHook`

```ts
type ActionCost =
  | { kind: "action"; count: 1 | 2 | 3 } | { kind: "reaction" } | { kind: "free" }
  | { kind: "activity"; min: number; max?: number; unit: "action" | "minute" | "hour" | "day" }
  | { kind: "passive" } | { kind: "none" };
// system.activation?: { cost: ActionCost; traits: string[] } — só exibido; nada conta, gasta ou bloqueia (D-15)
parseActionGlyph(htmlOrGlyph: string): ActionCost | null;
type TriggerEvent = "turnStart" | "turnEnd" | "roundStart" | "saveResolved" | "damageTaken" | "hpZero" | "death" | "strikeResolved";
interface ReactionOfferDefinition {
  slug: string; event: TriggerEvent; predicate: Predicate;
  cost: ActionCost; // reaction | free | none (automático); exibido
  frequency?: { max: number; per: "turn" | "round" | "minute" | "hour" | "day" }; // validada via ActorResource "freq:"
  buildCard(ctx: TriggerContext): CardData;
}
registerReactionOffer(def: ReactionOfferDefinition): void;
// reaction:accept { offerId } / reaction:decline { offerId }; oferta só para dono/GM; aceite = permissão + frequência; some no próximo evento do mesmo ator (D-18)
interface AdditiveDefinition { slug: string; featSlug: string; appliesTo(draft: ItemDraft): boolean; apply(draft: ItemDraft, ctx: CreationCtx): ItemDraft; onUse?(ctx): CardData | void }
// item criado: flags.fusion.additive = { slug, sourceFeatUuid, creatorActorId } (máx. 1)
```

## 3. Regras de colisão usadas nas ondas

- Tarefas na mesma onda têm **arquivos disjuntos** (campo Onde). Um arquivo compartilhado serializa as tarefas em ondas diferentes. Os mais disputados: `CharacterSheet.svelte`, `characterSheetVM.ts`, `planVM.ts`, `chat-handler.ts`, `derive-runner.ts`, `transform.mjs`/`build-mvp-subset.mjs` (a "faixa do importer" roda uma tarefa por onda), `strikes.ts`, `effectsEngine.ts`, `specs/17` e `specs/15`.
- **Exceções de rebase trivial** (não serializam): linha de registro em `packages/server/src/net/socket-manager.ts`, linha de registro em `systems/pf2e/src/index.ts` (cada hook/handler vive no próprio arquivo), `specs/RASTREABILIDADE.md` (gerado: regenerar no rebase) e o pin do submodule (bump serializado no merge).
- UI nova nasce em componente + VM próprios; `CharacterSheet.svelte` recebe só o ponto de montagem, mas mesmo assim conta como colisão.
- Teto de 6 tarefas por onda. Os roteiros de print não entram no teto: rodam numa faixa só-leitura depois que o lote fecha.
- Prioridade dentro da onda: caminho crítico mais longo, com peso para a fase mais cedo (as fases fecham em ordem e os lotes fazem sentido).

## 4. Tarefas

### F0 — Classe no ar

### ALQ-F0-01 — Validar o PR #57 do satélite no recorte do Alquimista

- **Repo**: satélite
- **Onde**: PR `xansde/fusion-systems-2e#57`; `sheets/pf2e/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts`; packs `classes-core`, `class-features-core`, `feats-core`
- **Entrega**: Roda o item pendente do test plan (`pnpm --filter @fusion/sheets-pf2e test` dentro do core montado) e comenta no PR o inventário do Alquimista: 1 classe, 27 features, 67 talentos (51 remaster + 16 legado), 5 docs de arquétipo, cobertura pt-BR. Não mergeia: o merge do #57 é gate humano.
- **Depende de**: —
- **Paralelo com**: ALQ-F1-01, ALQ-F2-02, ALQ-F2-17, ALQ-F4-02, ALQ-F4-03
- **Modelo / esforço**: haiku / low — só executa e mede.
- **Teste (TDD)**: Sem código novo. A prova é `sheets-pf2e` verde contra o core montado, colada no comentário.
- **Prova visual (print)**: Coberta por ALQ-F0-06 (classe e eixo no builder).
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 1
- **Lote e2e**: L1

### ALQ-F0-02 — Bump do pin para a tag com o #57

- **Repo**: core
- **Onde**: `external/fusion-systems-2e` (pin); `specs/RASTREABILIDADE.md` via `pnpm spec:report`
- **Entrega**: O core aponta para a tag do satélite que contém o #57. Suíte do core verde (em especial `packages/client` + `sheets-pf2e`) e o teto de `build:release` conferido.
- **Depende de**: ALQ-F0-01 (gate humano: merge humano do #57 + tag no satélite)
- **Paralelo com**: ALQ-F1-02, ALQ-F1-03, ALQ-F2-01, ALQ-F2-03, ALQ-F4-19
- **Modelo / esforço**: haiku / low — mecânico.
- **Teste (TDD)**: Suíte existente; nenhum teste novo.
- **Prova visual (print)**: Coberta por ALQ-F0-06.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 2
- **Lote e2e**: L1

### ALQ-F0-03 — Talentos pré-remaster com trait `legacy`, selo "Legado" e filtro no picker

- **Repo**: satélite
- **Onde**: curadoria nova `tools/importer-pf2e/src/curation/legacy-trait.mjs` (acrescenta `legacy` aos 16 docs em `feats-core`); `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (lista do picker ≈1985) + selo e filtro no componente do picker (`PlanColumn.svelte`)
- **Entrega**: Os 16 legados (Perpetual Breadth, Wish Alchemy…) **ficam no pack** com trait `legacy`. O picker mostra o selo "Legado" e ganha o filtro "Esconder legado"; o compêndio segue mostrando todos. Regra genérica para qualquer doc com a trait.
- **Depende de**: ALQ-F0-02, ALQ-F1-01
- **Paralelo com**: ALQ-F1-08, ALQ-F2-09, ALQ-F2-13, ALQ-F1-07, ALQ-F3-01
- **Modelo / esforço**: sonnet / medium — curadoria de dado + filtro com teste.
- **Teste (TDD)**: `planVM.legacy-feats.test.ts`: a lista dos 16 vem da fonte (Player Core 2 não contém esses talentos), escrita no teste; todos saem do pack com trait `legacy` e nenhum remaster a recebe; com o filtro ligado `Wish Alchemy` some da lista e `Mega Bomb` fica; com o filtro desligado os dois aparecem e só Wish Alchemy tem `badge:"legacy"`.
- **Prova visual (print)**: Player no builder, nível 20 do Alquimista: picker com "Alquimia do Desejo" exibindo o selo "Legado"; segundo print com o filtro "Esconder legado" ligado e o talento fora da lista.
- **Spec/REQ**: `REQ-PF2-206` (escrito na ALQ-F1-01)
- **Tamanho**: P
- **Onda**: 4
- **Lote e2e**: L1
- **Decisão**: D-01 (decidido: os 16 pré-remaster ficam no pack com trait `legacy`; picker com selo "Legado" e filtro)

### ALQ-F0-04 — pt-BR dos talentos do Alquimista (50 remaster + 16 legado)

- **Repo**: satélite
- **Onde**: `tools/translate-packs` (lote + `apply.mjs`) → `systems/pf2e/packs/feats-core/i18n.pt-BR.json`; `glossary.pt-BR.json`
- **Entrega**: Os 66 talentos sem tradução ganham nome, descrição e prereq em pt-BR com glossário consistente. Legados por último (D-01 mantém no pack). Dois lotes: níveis 1–10 e 11–20.
- **Depende de**: ALQ-F0-02
- **Paralelo com**: ALQ-F1-10, ALQ-F1-09, ALQ-F2-10, ALQ-F2-11, ALQ-F0-09
- **Modelo / esforço**: haiku / low — tradução de pack guiada por glossário.
- **Teste (TDD)**: Teste de cobertura do `translate-packs` (overlay sem chave órfã, glossário respeitado) + asserção de 100% dos docs com trait `alchemist` traduzidos.
- **Prova visual (print)**: Coberta por ALQ-F0-03 (picker em pt-BR).
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 5
- **Lote e2e**: L1
- **Decisão**: D-01 (decidido: os 16 pré-remaster ficam no pack com trait `legacy`; picker com selo "Legado" e filtro)

### ALQ-F0-05 — pt-BR das 27 features do Alquimista

- **Repo**: satélite
- **Onde**: `systems/pf2e/packs/class-features-core/i18n.pt-BR.json` via `tools/translate-packs`
- **Entrega**: Research Field, Field Discovery, Advanced Vials, os 4 campos e demais features em pt-BR na ficha e no builder.
- **Depende de**: ALQ-F0-02
- **Paralelo com**: ALQ-F2-12, ALQ-F0-06, ALQ-F3-02, ALQ-F1-12, ALQ-F2-04
- **Modelo / esforço**: haiku / low — mecânico.
- **Teste (TDD)**: Mesma asserção de cobertura da ALQ-F0-04, aplicada a `class-features-core`.
- **Prova visual (print)**: Coberta por ALQ-F0-06 (nomes dos campos em pt-BR).
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 6
- **Lote e2e**: L1

### ALQ-F0-06 — Picker do Research Field (eixo de classe)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/choiceSetInventory.ts` (entrada `class-features-core/Research Field/researchField: "eixo"`); `planVM.ts` (mapas de eixo ≈612 e ≈869, padrão Muses/Racket); `PlanColumn.svelte`
- **Entrega**: No nível 1 o builder mostra o eixo "Campo de Pesquisa" com Bombardeiro, Cirurgião, Mutagenista e Toxicologista. A escolha persiste em `flags.system.rulesSelections.researchField` (uuid), o mesmo caminho que o placeholder do GrantItem lê.
- **Depende de**: ALQ-F0-02
- **Paralelo com**: ALQ-F2-12, ALQ-F0-05, ALQ-F3-02, ALQ-F1-12, ALQ-F2-04
- **Modelo / esforço**: sonnet / medium — segue padrão de eixo existente.
- **Teste (TDD)**: `planVM.research-field.test.ts`: Alchemist expõe eixo com **4** opções (os 4 campos da regra do PC2, não "o que o pack tiver"); escolher Toxicologist grava `rulesSelections.researchField` com o uuid de Toxicologist.
- **Prova visual (print)**: Player no builder do Alquimista nível 1: eixo "Campo de Pesquisa" aberto com as 4 opções e Toxicologista selecionado.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 6
- **Lote e2e**: L1

### ALQ-F0-07 — GrantItem dinâmico: placeholder `{item|flags.system.rulesSelections.<key>}`

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/grantMaterializer.ts` (`parseGrantItems` ≈136, `parseGrantUuid` ≈242, `materializeGrants` ≈497)
- **Entrega**: Grant com placeholder resolve contra a flag do ator e materializa o item escolhido (Research Field → feature do campo; Field Discovery/Advanced Vials/GFD se o pack usar o mesmo placeholder — medir antes). Sem flag vira `GrantFailure{reason:"unresolved-selection"}` visível como pendência. Genérico (Thaumaturge, Inventor).
- **Depende de**: ALQ-F0-02
- **Paralelo com**: ALQ-F0-08, ALQ-F1-04, ALQ-F1-05, ALQ-F1-06, ALQ-F2-08
- **Modelo / esforço**: sonnet / high — materializador compartilhado por todas as classes, risco de regressão.
- **Teste (TDD)**: `grantMaterializer.dynamic.test.ts`: `rulesSelections.researchField = uuid(Bomber)` gera criação de Bomber e não de Chirurgeon; sem flag gera `unresolved-selection`. `grantMaterializer.test.ts` e `varredura-classes.test.ts` continuam verdes.
- **Prova visual (print)**: Player na ficha do Alquimista nível 5 (Bombardeiro): features "Bombardeiro" e "Descoberta de Campo (Bombardeiro)" concedidas.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 3
- **Lote e2e**: L1

### ALQ-F0-08 — Class DC do Alquimista e proficiência em bombas alquímicas

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/build.ts` (≈392-407, `weaponCategories`); `derivations/character.ts` (class DC ≈515); normalizador em `tools/importer-pf2e` para preservar a categoria do documento de classe
- **Entrega**: Alquimista nível 1 com Int +4: class DC 17. Strike com bomba alquímica usa a proficiência **treinado** da categoria extra. Categoria modelada como **mapa por chave** `system.proficiencies.attacks["weapon-base-alchemical-bomb"] = {rank, label, predicate}` (mesmo path que o AEL do vendor escreve), para ALQ-F4-06 só elevar o `rank`.
- **Depende de**: ALQ-F0-02, ALQ-F1-01
- **Paralelo com**: ALQ-F1-04, ALQ-F1-05, ALQ-F1-06, ALQ-F2-08, ALQ-F0-07
- **Modelo / esforço**: sonnet / medium — derivação com teste; importer tocado de leve.
- **Teste (TDD)**: `derivations/__tests__/alchemist-proficiency.test.ts` pela regra do PC2 (treinado em simples, desarmado e bombas; class DC treinada): class DC nível 1 Int +4 = 17; ataque do Acid Flask nível 1 Des +2 = 1+2+2 = 5. Números calculados à mão.
- **Prova visual (print)**: Player na ficha do Alquimista nível 1, aba Combate: CD de classe 17 e strike "Frasco de Ácido" +5.
- **Spec/REQ**: `REQ-PF2-207` (escrito na ALQ-F1-01)
- **Tamanho**: M
- **Onda**: 3
- **Lote e2e**: L1

### ALQ-F0-09 — Pré-requisito bloqueante no picker (dedicação e atributo)

- **Repo**: satélite
- **Onde**: `planVM.ts::isFeatEligible` (≈1985) + `checkFeatPrerequisites` (≈2645)
- **Entrega**: O picker mostra desabilitado, com motivo, talento cujo prereq reconhecível falha. Reconhecedores: talento/dedicação possuído e atributo mínimo. Texto livre desconhecido segue como aviso não bloqueante.
- **Depende de**: ALQ-F0-03, ALQ-F1-01
- **Paralelo com**: ALQ-F1-10, ALQ-F1-09, ALQ-F2-10, ALQ-F2-11, ALQ-F0-04
- **Modelo / esforço**: sonnet / medium — lógica de elegibilidade com teste.
- **Teste (TDD)**: `planVM.prereq-blocking.test.ts` (padrão não circular do `prereqEvaluator.test.ts`): Guerreiro Int +0 não pega Alchemist Dedication, com Int +2 pega; Basic Concoction inelegível sem a dedicação; prereq desconhecido elegível com `requirementIssue`.
- **Prova visual (print)**: Player no builder do Guerreiro nível 2 (Free Archetype): "Dedicação de Alquimista" desabilitada com "Inteligência +2"; segundo print com Int +2 habilitando e Concocção Básica aparecendo depois.
- **Spec/REQ**: `REQ-PF2-208` (escrito na ALQ-F1-01)
- **Tamanho**: M
- **Onda**: 5
- **Lote e2e**: L1

### ALQ-F0-10 — Alchemist Dedication jogável (arquétipo)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/archetypes.ts` (`ARCHETYPE_KEY_ABILITY` + `ARCHETYPE_LABEL`, `alchemist → int`); `choiceSetInventory.ts:230`; `grantMaterializer.ts` (grant fixo Alchemical Crafting). Respeita DEC-MC-01 (`curation/disabled-rules.mjs`).
- **Entrega**: Guerreiro com Alchemist Dedication ganha class DC própria de Alquimista (treinada, Int), recebe Alchemical Crafting e escolhe Basic Concoction e o sub-slot.
- **Depende de**: ALQ-F0-07, ALQ-F0-08, ALQ-F0-09
- **Paralelo com**: ALQ-F2-14, ALQ-F3-07, ALQ-F2-05, ALQ-F2-06, ALQ-F4-01
- **Modelo / esforço**: sonnet / medium — composição sobre peças prontas.
- **Teste (TDD)**: `derivations/__tests__/archetype-alchemist.test.ts`: Guerreiro nível 2 Int +2 com a dedicação → `classDCs.alchemist` = 10+2+2+2 = 16; Alchemical Crafting presente após o materialize.
- **Prova visual (print)**: Player na ficha do Guerreiro nível 2: "CD de Alquimista 16" e feature "Criação Alquímica" concedida.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 7
- **Lote e2e**: L1

### ALQ-F0-11 — Bump de pin do F0 + roteiro tutorial-e2e do F0

- **Repo**: ambos
- **Onde**: pin `external/fusion-systems-2e`; roteiro `docs/design/alquimista/e2e/alq-f0.html` (skill tutorial-e2e, com exportar progresso)
- **Entrega**: Core no pin com F0-03..F0-10. Roteiro em mundo existente (data-dir fora da árvore git): cria Alquimista, escolhe campo, sobe ao 5, cria Guerreiro com dedicação. Um print por tarefa do F0, alvo circulado, smoke GM e player.
- **Depende de**: ALQ-F0-03, ALQ-F0-04, ALQ-F0-05, ALQ-F0-06, ALQ-F0-07, ALQ-F0-08, ALQ-F0-09, ALQ-F0-10
- **Paralelo com**: ALQ-F1-13, ALQ-F2-15
- **Modelo / esforço**: sonnet / medium — dirigir o Playwright e olhar os prints.
- **Teste (TDD)**: O próprio roteiro (asserções de DOM a cada passo).
- **Prova visual (print)**: Gera os prints de F0-03, F0-06, F0-07, F0-08, F0-09 e F0-10.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 9 (só leitura, fora do teto)
- **Lote e2e**: L1

### F1 — Fundação de combate

### ALQ-F1-01 — Spec F0+F1: legado, proficiência extra, prereq, aplicar dano/condição, TurnHooks

- **Repo**: core
- **Onde**: `specs/17-sistema-pf2e.md` (Condições, Iniciativa e combate, tabela de eventos ≈884, picker); `specs/10-combate-e-iniciativa.md` (REQ-CBT-029, 053-055); `specs/15-api-de-sistemas.md` (registrar); `specs/09-chat-e-mensagens.md` (botões de card)
- **Entrega**: Emendas com REQs e DECs para as decisões F0/F1 (DF-01..DF-10) e D-01..D-04 (inclui a foto de alvos gravada na mensagem de rolagem, D-02). Fixa os contratos canônicos `ApplyDamage`, `TurnHooks`, `TargetSelection`, `ApplyCondition` (shapes, permissões, prioridades de hook, redação do resumo). Absorve as emendas de spec do F0 (antes soltas em F0-03/08/09).
- **Depende de**: —
- **Paralelo com**: ALQ-F0-01, ALQ-F2-02, ALQ-F2-17, ALQ-F4-02, ALQ-F4-03
- **Modelo / esforço**: opus / high — contrato transversal que F2–F7 consomem.
- **Teste (TDD)**: `spec-lint` (ids únicos, tags, citações) e `pnpm spec:report` verdes.
- **Prova visual (print)**: Sem UI. Provas nas ALQ-F1-10..F1-12.
- **Spec/REQ**: `REQ-PF2-206..216`, `REQ-CBT-056..060`, `REQ-SYS-138..142`, `REQ-CHT-052..053`; DECs novas em CBT/SYS/CHT
- **Tamanho**: M
- **Onda**: 1
- **Lote e2e**: L1
- **Decisão**: D-01 (decidido: os 16 pré-remaster ficam no pack com trait `legacy`; picker com selo "Legado" e filtro); D-02 (decidido: jogador aplica o dano em todos os alvos da ação (foto na rolagem)); D-03 (decidido: NPC a 0 PV ganha `dead` visível no token); D-04 (decidido: jogador vê só o dano causado, sem PV restantes)

### ALQ-F1-02 — Contratos tipados no core (system-api + shared protocol)

- **Repo**: core
- **Onde**: `packages/system-api/src/combat.ts` (`TurnHookContext`, `TurnHookRegistrar`), `system-module.ts` (acumulador `onTurnStart/onTurnEnd/onRoundStart/onRoundEnd/onCombatEnd` + `registerActorMechanics` + adaptador do `registerCombatHooks` legado), novo `packages/system-api/src/actor-mechanics.ts`; `packages/shared/src/protocol.ts` + schemas zod de `actor:applyDamage`/`actor:applyCondition`/`actor:damageApplied`
- **Entrega**: Tipos e schemas dos contratos canônicos (§Contratos) compilam; um sistema registra vários callbacks por evento e a mecânica de ator. Sem comportamento de servidor ainda.
- **Depende de**: ALQ-F1-01
- **Paralelo com**: ALQ-F0-02, ALQ-F1-03, ALQ-F2-01, ALQ-F2-03, ALQ-F4-19
- **Modelo / esforço**: sonnet / high — contrato que cruza server, client e sistema; shape já fechado na spec.
- **Teste (TDD)**: `system-api/src/__tests__/turn-hooks-registrar.test.ts`: dois `onTurnStart` com prioridades 10 e 0 saem ordenados e o legado vira entrada `legacy`. `shared/__tests__/apply-damage-payload.test.ts`: instância sem `source` e sem `amount` rejeitada; `persistent` sem `type` rejeitada; `materials`/`ignoreResistance` aceitos.
- **Prova visual (print)**: Sem UI. Coberta por ALQ-F1-10.
- **Spec/REQ**: `REQ-SYS-138..141`
- **Tamanho**: M
- **Onda**: 2
- **Lote e2e**: L1

### ALQ-F1-03 — Protótipo dos botões de aplicar e do resumo no card

- **Repo**: core
- **Onde**: `packages/client/prototypes/apply-damage-card.prototype.html`
- **Entrega**: Protótipo estático pt-BR do AbilityCard com Aplicar/½/×2/Curar/PV temp., lista de alvos, card-resumo nas visões GM e player (D-04) e seletor de condição "em mim / nos alvos" com valor. Gabarito da lente P1 para F1-10/F1-11.
- **Depende de**: ALQ-F1-01
- **Paralelo com**: ALQ-F0-02, ALQ-F1-02, ALQ-F2-01, ALQ-F2-03, ALQ-F4-19
- **Modelo / esforço**: haiku / low — HTML estático.
- **Teste (TDD)**: n/a (protótipo).
- **Prova visual (print)**: O próprio protótipo aberto (GM e player lado a lado).
- **Spec/REQ**: `REQ-CHT-052..053` (referenciados)
- **Tamanho**: P
- **Onda**: 2
- **Lote e2e**: L1
- **Decisão**: D-04 (decidido: jogador vê só o dano causado, sem PV restantes)

### ALQ-F1-04 — TurnHooks: runner aguardado no servidor

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/turn-hook-runner.ts`; `combat-handlers.ts` (`emitTurnEnd/emitTurnStart/emitRoundStart` ≈515-540, nextTurn ≈1165, begin ≈665, end ≈1589); fiação em `net/socket-manager.ts` (linha de registro)
- **Entrega**: Ao avançar turno, o server aguarda em série `turnEnd(atual) → roundEnd → roundStart → turnStart(próximo)`, e `combatEnd` ao encerrar, com `TurnHookContext` (serviços injetados, stubs até F1-08/09), depois de persistir o estado e antes do broadcast. Erro de callback é logado e isolado. `CombatEventBus` segue para ouvintes do core.
- **Depende de**: ALQ-F1-02
- **Paralelo com**: ALQ-F0-08, ALQ-F1-05, ALQ-F1-06, ALQ-F2-08, ALQ-F0-07
- **Modelo / esforço**: sonnet / high — ordem de estado do combate autoritativo.
- **Teste (TDD)**: `combat/__tests__/turn-hook-runner.test.ts` (porta via `helpers/ports.ts`): log de chamadas no `combat:nextTurn` = `[turnEnd:A, roundEnd?, roundStart?, turnStart:B]` (REQ-CBT-026..028); callback que lança não impede o seguinte; ack só volta depois do await; `combat:end` dispara `combatEnd` com os `actorIds`.
- **Prova visual (print)**: Coberta por ALQ-F1-12 (card de recovery check no início do turno).
- **Spec/REQ**: REQ-CBT-029 (reinterpretado), `REQ-CBT-057..058`, `REQ-SYS-139..141`
- **Tamanho**: M
- **Onda**: 3
- **Lote e2e**: L1

### ALQ-F1-05 — TargetSelection no server e no client

- **Repo**: core
- **Onde**: `packages/server/src/combat/targeting-store.ts` + novo `combat/target-selection.ts`; `packages/client/src/lib/combat/targeting.ts` + `combatStore.svelte.ts` (derivado `myTargets`), exposto às sheets
- **Entrega**: Server `resolveTargetSelection(userId)` e **foto dos alvos no momento da rolagem**: ao gravar uma mensagem de rolagem, o `chat-handler` copia a TargetSelection do autor para `flags.fusion.targetSnapshot` (D-02). Client `getMyTargets()` reativo e `setMyTargets(tokenIds)` (lote sobre `combat:target`, usado pela prévia de área).
- **Depende de**: ALQ-F1-02
- **Paralelo com**: ALQ-F0-08, ALQ-F1-04, ALQ-F1-06, ALQ-F2-08, ALQ-F0-07
- **Modelo / esforço**: sonnet / medium — padrão existente com teste.
- **Teste (TDD)**: `combat/__tests__/target-selection.test.ts`: P marca T1 e T2 e rola → a mensagem grava `targetSnapshot` [T1,T2]; P desmarca T2 depois e o snapshot não muda; após `turnEnd` do ator de P a seleção esvazia (REQ-CBT-055) e o snapshot continua. Client `targeting.test.ts`: `token:targeted` de outro usuário não entra em `myTargets`.
- **Prova visual (print)**: Coberta por ALQ-F1-10 ("Alvos: Goblin, Orc" no card).
- **Spec/REQ**: `REQ-CBT-056`
- **Tamanho**: P
- **Onda**: 3
- **Lote e2e**: L1
- **Decisão**: D-02 (decidido: jogador aplica o dano em todos os alvos da ação (foto na rolagem))

### ALQ-F1-06 — pf2e: mecânica de ApplyDamage (dano, cura, PV temp., dying, NPC a 0)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/actions/damage.ts` (`resolveDamageApplication` sobre `applyDamagePipeline`; `applyHealing` corrigido para PV temp.); `engine-2e/src/dyingWounded.ts`; IWR derivado (`effectsEngine` → `IwrSet`)
- **Entrega**: Função pura `(actor, instances, opts) → ActorMechanicsPatch`. IWR por instância com exceções por `traits`/`materials` e `ignoreResistance`; instâncias do mesmo tipo no mesmo payload somam antes do IWR (respingo); dureza; PV temp. absorve primeiro e não acumula; cura limitada; character a 0 → dying 1/2 + wounded, doomed; cura tira dying e aplica wounded +1; **NPC a 0 PV ganha a condição `dead` visível e `defeated`** (D-03), não letal → unconscious.
- **Depende de**: ALQ-F1-02
- **Paralelo com**: ALQ-F0-08, ALQ-F1-04, ALQ-F1-05, ALQ-F2-08, ALQ-F0-07
- **Modelo / esforço**: sonnet / high — muita regra, TDD não circular, consumido por F5/F6/F7.
- **Teste (TDD)**: `actions/__tests__/resolve-damage-application.test.ts`, casos do Player Core: PV 20/temp 5, 12 fogo com resist. fogo 5 → temp 0, PV 18; PV 3 wounded 1, 10 crítico → dying 3; dying 2 + cura 5 → dying removido, wounded +1, PV 5; temp 4 + "PV temp. 3" → 4; veneno em imune → 0 com nota; fraqueza 5 a ferro frio com `materials:["cold-iron"]` → +5; NPC a 0 → `dead`.
- **Prova visual (print)**: Coberta por ALQ-F1-10 (breakdown de resistência) e ALQ-F1-12 (dying na ficha).
- **Spec/REQ**: REQ-PF2-022, 023, 060, 070, 072-074, `REQ-PF2-209..213`
- **Tamanho**: M
- **Onda**: 3
- **Lote e2e**: L1
- **Decisão**: D-03 (decidido: NPC a 0 PV ganha `dead` visível no token)

### ALQ-F1-07 — pf2e: mecânica de ApplyCondition e registro da superfície

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/actions/conditions-manager.ts` (`resolveConditionApplication(actor, req)` → ops de Item embutido); `systems/pf2e/src/index.ts` (linha `registrar.registerActorMechanics({ applyDamage, applyCondition })`)
- **Entrega**: Modos `add|remove|set|increase|decrease` com imunidade (REQ-PF2-053), maior valor prevalece (REQ-PF2-054), `dying` puxa `unconscious`; aceita `data` (multi-instância) e `expiry` (ancoragem por dono) como passthrough para as fases seguintes. SF2e vira issue de dívida.
- **Depende de**: ALQ-F1-02
- **Paralelo com**: ALQ-F1-08, ALQ-F2-09, ALQ-F0-03, ALQ-F2-13, ALQ-F3-01
- **Modelo / esforço**: sonnet / medium — o manager puro já existe.
- **Teste (TDD)**: `actions/__tests__/resolve-condition-application.test.ts`: `add frightened 2` sobre 1 → 2; `add frightened 1` sobre 3 → sem mudança; `add sickened` em imune → bloqueado com nota; `set dying 1` → dying + unconscious; `expiry` gravado em `system.fusion.expiry`.
- **Prova visual (print)**: Coberta por ALQ-F1-11.
- **Spec/REQ**: REQ-PF2-050, 053, 054, `REQ-PF2-215`
- **Tamanho**: P
- **Onda**: 4
- **Lote e2e**: L1

### ALQ-F1-08 — Handler `actor:applyDamage` + `ActorMechanicsService`

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/actor-mechanics-service.ts` e `apply-damage-handler.ts`; leitura da mensagem de origem em `chat/`; `documents/store.ts` (update + embutidos); `net/redaction.ts` + `isRolePrivileged`; linha em `socket-manager.ts`
- **Entrega**: O op valida payload e permissão; relê montantes **e alvos** da mensagem gravada (`targetSnapshot`, D-02): o player dono do caster aplica em **todos** os alvos daquela ação; GM pode sobrescrever com `targetTokenIds`. Aplica multiplicador/basic save, chama `actorMechanics.applyDamage` por alvo, persiste e publica `actor:damageApplied` (GM com PV; player vê só o dano causado, D-04). O mesmo serviço é injetado em `TurnHookContext` e nos handlers de F2–F7 (`actingAs:"system"` aceita `amount`) e emite o hook `onDamageApplied`. Sem mecânica registrada → `NOT_SUPPORTED`.
- **Depende de**: ALQ-F1-02, ALQ-F1-05
- **Paralelo com**: ALQ-F2-09, ALQ-F0-03, ALQ-F2-13, ALQ-F1-07, ALQ-F3-01
- **Modelo / esforço**: sonnet / high — permissão, anti-cheat e redação num handler só.
- **Teste (TDD)**: `combat/__tests__/apply-damage-handler.test.ts` (sistema fake, porta via helpers): mensagem com snapshot [T1,T2] → o player dono do caster aplica e os dois perdem PV pelo total **gravado**, mesmo com `amount: 999` ou `targetTokenIds:[T3]` no payload; mensagem sem snapshot → `FORBIDDEN` para player; `amount` manual de player → `FORBIDDEN`, de GM → aceito; player não dono do caster → `FORBIDDEN`; socket de player recebe resumo sem `hp`; `onDamageApplied` uma vez por alvo.
- **Prova visual (print)**: Coberta por ALQ-F1-10.
- **Spec/REQ**: `REQ-PF2-209`, `REQ-SYS-142`, REQ-CBT-056, `REQ-CHT-053`
- **Tamanho**: M
- **Onda**: 4
- **Lote e2e**: L1
- **Decisão**: D-02 (decidido: jogador aplica o dano em todos os alvos da ação (foto na rolagem)); D-04 (decidido: jogador vê só o dano causado, sem PV restantes)

### ALQ-F1-09 — Handler `actor:applyCondition`

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/apply-condition-handler.ts` (usa `actor-mechanics-service.ts`); linha em `socket-manager.ts`
- **Entrega**: Aplica/remove condição com valor em um ou mais atores. GM: qualquer ator; player: o próprio (OWNER) ou alvos da `TargetSelection`. Exposto como `ctx.applyCondition` e no serviço.
- **Depende de**: ALQ-F1-08
- **Paralelo com**: ALQ-F1-10, ALQ-F2-10, ALQ-F2-11, ALQ-F0-09, ALQ-F0-04
- **Modelo / esforço**: sonnet / medium — mesmo esqueleto da F1-08.
- **Teste (TDD)**: `combat/__tests__/apply-condition-handler.test.ts`: player aplica `frightened 1` em goblin marcado → item com value 1; goblin não marcado → `FORBIDDEN`; `remove` de ausente → no-op ok.
- **Prova visual (print)**: Coberta por ALQ-F1-11.
- **Spec/REQ**: `REQ-PF2-215`, REQ-CBT-056
- **Tamanho**: P
- **Onda**: 5
- **Lote e2e**: L1

### ALQ-F1-10 — Card: botões Aplicar dano / ½ / ×2 / Curar / PV temp. e card-resumo

- **Repo**: ambos
- **Onde**: satélite `sheets/pf2e/src/components/chat/pf2e/AbilityCard.svelte`, `abilityCardVM.ts` (`buildApplyDamageOp`); core: renderer de `actor:damageApplied` via `chatCardExtensionRegistry.svelte.ts`
- **Entrega**: Abaixo de cada dano rolado aparecem os botões; o card lista "Alvos: …" a partir do `targetSnapshot` da rolagem (D-02), com botão desabilitado e "a rolagem não tinha alvo" quando vazio. Clicar dispara o op para todos os alvos da ação, os tokens perdem PV e surge o resumo (player: "Goblin sofreu 7 de fogo (resistência 5)", sem PV; GM: com PV). Elixires e cura de magia usam Curar/PV temp.
- **Depende de**: ALQ-F1-03, ALQ-F1-06, ALQ-F1-08
- **Paralelo com**: ALQ-F1-09, ALQ-F2-10, ALQ-F2-11, ALQ-F0-09, ALQ-F0-04
- **Modelo / esforço**: sonnet / high — UI cruzando card do sistema, op do core e redação.
- **Teste (TDD)**: `abilityCardVM.apply-damage.test.ts`: `buildApplyDamageOp` ×2 de player → `{instances:[{source:{messageId, rollIndex:0}}], multiplier:2}` sem `targetTokenIds` e **nunca** `amount`; `canApplyDamage` falso para não-dono sem GM; componente: snapshot vazio → `disabled`; snapshot com 2 alvos → "Alvos: Goblin, Orc".
- **Prova visual (print)**: **Player**: card de Golpe com dano rolado, "Aplicar" circulado e alvo Goblin; print seguinte com resumo e barra de PV menor. **GM**: resumo com "PV 18 → 11" e linha de resistência. Mais "Curar" num aliado.
- **Spec/REQ**: `REQ-CHT-052..053`, `REQ-PF2-209..211`
- **Tamanho**: M
- **Onda**: 5
- **Lote e2e**: L1
- **Decisão**: D-02 (decidido: jogador aplica o dano em todos os alvos da ação (foto na rolagem)); D-04 (decidido: jogador vê só o dano causado, sem PV restantes)

### ALQ-F1-11 — Condição em alvo pela ficha (sai o catálogo SCAFFOLDING, entra valor)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte` (≈313-330, 738-766); `characterSheetVM.ts` (`SCAFFOLDING_CONDITION_CATALOG` ≈361 → catálogo real de `system:conditions`; `toggleCondition` ≈2365 → `actor:applyCondition`)
- **Entrega**: "+ Condição" lista todas as condições PF2e com valor para graduadas e destino "em mim / nos meus alvos (N)"; chips com +/−. A marca SCAFFOLDING (T034) sai. Base do menu de dano persistente (ALQ-F5-04).
- **Depende de**: ALQ-F1-03, ALQ-F1-07, ALQ-F1-09
- **Paralelo com**: ALQ-F3-08, ALQ-F3-03, ALQ-F5-01, ALQ-F4-07, ALQ-F4-06
- **Modelo / esforço**: sonnet / medium — UI com VM testável.
- **Teste (TDD)**: `characterSheetVM.conditions-target.test.ts`: destino "alvos" com frightened 2 gera `actor:applyCondition{targetTokenIds, slug:"frightened", value:2, mode:"add"}`; catálogo cobre `PF2E_CONDITION_SLUGS`; `condition-toggle*.test.ts` adaptados.
- **Prova visual (print)**: **Player** na ficha do Alquimista: seletor "Amedrontado 2 → nos meus alvos (1)" circulado; em seguida chip "Amedrontado 2" na ficha do Goblin aberta pelo GM.
- **Spec/REQ**: `REQ-PF2-215`
- **Tamanho**: M
- **Onda**: 8
- **Lote e2e**: L1

### ALQ-F1-12 — Dying automático, recovery check e frightened decay como TurnHooks

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/hooks/recovery-check.ts` e `hooks/frightened-decay.ts` (linhas de registro em `index.ts`); `engine-2e/src/dyingWounded.ts::applyRecoveryCheck`; `ctx.roll`/`ctx.chat`
- **Entrega**: Personagem a 0 PV ganha dying (F1-06). No início do turno dele o server rola recovery check (CD 10 + dying), ajusta dying/wounded, marca `defeated`/`dead` ao máximo e posta o card. `onTurnEnd("pf2e.frightenedDecay")` baixa frightened do próprio ator.
- **Depende de**: ALQ-F1-04, ALQ-F1-06, ALQ-F1-07, ALQ-F1-09
- **Paralelo com**: ALQ-F2-12, ALQ-F0-05, ALQ-F0-06, ALQ-F3-02, ALQ-F2-04
- **Modelo / esforço**: sonnet / medium — consumidor de contratos prontos.
- **Teste (TDD)**: `__tests__/turn-hooks-pf2e.test.ts` com RNG semeado: dying 1 e d20=15 vs CD 11 → dying 0, wounded 1; dying 3, d20=1 → dying 5 ≥ 4 → morto; frightened 2 no `turnEnd` do dono → 1, no de outro ator → 2.
- **Prova visual (print)**: **GM** no tracker: Alquimista a 0 PV com chip "Morrendo 1"; "Próximo turno" → card "Teste de recuperação — CD 11 — sucesso — Morrendo 0, Ferido 1".
- **Spec/REQ**: REQ-PF2-070, 071, 073, `REQ-PF2-212..214`, `REQ-PF2-216`, REQ-CBT-029
- **Tamanho**: M
- **Onda**: 6
- **Lote e2e**: L1
- **Decisão**: D-03 (decidido: NPC a 0 PV ganha `dead` visível no token)

### ALQ-F1-13 — Bump de pin do F1 + roteiro tutorial-e2e do F1

- **Repo**: ambos
- **Onde**: pin `external/fusion-systems-2e`; roteiro `docs/design/alquimista/e2e/alq-f1.html`
- **Entrega**: Cena com Alquimista, Goblin (resist. fogo 5) e aliado: marcar alvo → golpe → aplicar → ×2 → curar → PV temp. → condição em alvo → derrubar o Alquimista → próximo turno. Relatório P3 com o protótipo F1-03 lado a lado.
- **Depende de**: ALQ-F1-10, ALQ-F1-11, ALQ-F1-12
- **Paralelo com**: ALQ-F0-11, ALQ-F2-15
- **Modelo / esforço**: sonnet / medium — dirigir app e olhar prints.
- **Teste (TDD)**: O roteiro (asserções de DOM e de PV lido do documento).
- **Prova visual (print)**: Gera os prints de F1-03, F1-10, F1-11 e F1-12 (cobrindo F1-04..F1-09).
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 9 (só leitura, fora do teto)
- **Lote e2e**: L1

### F2 — Inventário vivo e efeitos

### ALQ-F2-01 — Emendas de spec F2 (17 e 15): efeito, consumo, strike de item

- **Repo**: core
- **Onde**: `specs/17-sistema-pf2e.md` (Strikes, Bulk e inventário, Tipos de Item, Effects), `specs/15-api-de-sistemas.md`
- **Entrega**: DEC-PF2-11 (efeito é cópia embutida com origem e início), DEC-PF2-12 (strike de item consumível). REQs de consumo, `autoDestroy`, efeito/cura no uso, strike de bomba, duração pelo turno do ator de origem, item temporário, materialização de itens embutidos no motor e política de tempo fora de combate (D-05: sem relógio de mundo; expira no Descansar/preparação ou por remoção manual). Na 15: `ConsumeItemDefinition` e hooks de consumo. `REQ-PF2-055` é emendado: a expiração de efeito passa ao REQ novo [MVP]; o persistente fica para a F5.
- **Depende de**: ALQ-F1-01
- **Paralelo com**: ALQ-F0-02, ALQ-F1-02, ALQ-F1-03, ALQ-F2-03, ALQ-F4-19
- **Modelo / esforço**: opus / high — contratos EffectItem/ConsumeItem/ItemStrike consumidos por F3–F7.
- **Teste (TDD)**: `spec-lint` (`id-unico`, `req-com-tag`, `citacao-resolvivel`, `decisao-canonica`) verde.
- **Prova visual (print)**: Sem UI. Coberta por F2-08, F2-12 e F2-14.
- **Spec/REQ**: `DEC-PF2-11..12`, `REQ-PF2-217..228`, `REQ-SYS-143..144`, emenda REQ-PF2-055
- **Tamanho**: M
- **Onda**: 2
- **Lote e2e**: L1
- **Decisão**: D-05 (decidido: sem relógio; expira no Descansar/preparação ou remoção manual; sem "passar tempo")

### ALQ-F2-02 — Importer: pack `equipment-effects-core`

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/extract.mjs`, `transform.mjs::normalizeEffectSystem` (1443), `build-mvp-subset.mjs` (`PACK_MANIFESTS`), `systems/pf2e/src/__tests__/packs-validation.test.ts`
- **Entrega**: Pack com os efeitos remaster, unidades normalizadas (`rounds→round` etc.), `unlimited → value:-1`, `expiry:null` finito → `turn-start`, imagem Paizo → placeholder, `automation:"partial"` quando há regra fora do MVP. Extract + transform frescos antes do build.
- **Depende de**: —
- **Paralelo com**: ALQ-F0-01, ALQ-F1-01, ALQ-F2-17, ALQ-F4-02, ALQ-F4-03
- **Modelo / esforço**: sonnet / medium — pipeline conhecido com teste de normalização.
- **Teste (TDD)**: `tools/importer-pf2e/src/__tests__/transform.test.mjs`: `{unit:"minutes", value:10, expiry:"turn-start"}` → `{unit:"minute", …}`; `unlimited` → `value:-1`. `packs-validation.test.ts`: 100% de `equipment-effects-core` passa `EffectSystemSchema` (falha hoje pelo plural).
- **Prova visual (print)**: Compêndio (GM) em "Efeitos de equipamento" com "Efeito: Elixir da Vida" e duração "10 minutos".
- **Spec/REQ**: `REQ-PF2-221`
- **Tamanho**: M
- **Onda**: 1
- **Lote e2e**: L1

### ALQ-F2-03 — Importer: pack `alchemical-items-core` (575 remaster)

- **Repo**: satélite
- **Onde**: `build-mvp-subset.mjs` (manifesto; filtro `alchemical && remaster`), `transform.mjs` (`case "consumable"` 885, `normalizeWeaponSystem` 1120-1197), nova curadoria `src/curation/effect-refs.mjs`
- **Entrega**: Pack novo (D-09) com 575 docs gerado pelo `build-mvp-subset.mjs`. Os 35 alquímicos já curados no #107 entram com a curadoria portada pela ALQ-F2-17. Bombas mantêm `expend`, `splashDamage`, `damage.persistent`, `bonus`. `ammo` vira `consumable/category:"ammo"`. `@UUID[...equipment-effects.Item.Effect: X]` resolvido para `system.fusion.effectRefs: string[]` (sourceIds); ref que não resolve vai para o relatório.
- **Ponte pt-BR (ALQ17-01)**: hoje nada no pipeline lê `tools/translate-packs/src/data/alchemical-from-107.json` (saída da ALQ-F2-17) — se alguém copiar o chunk direto para `out/translate/alchemical-items-core/` sem os passos abaixo, `mergeI18nOverlay` (`i18n-overlay.mjs:160`, `if (!sourceHash) continue;`) descarta as 35 entradas em silêncio: exit 0, suíte verde, e os itens aparecem em inglês no inventário. Antes de considerar esta tarefa completa: 1) exportar `deriveFusionId` de `transform.mjs` (hoje é função não exportada, linha 102); 2) re-chavear cada entrada do chunk com `newId = deriveFusionId("alchemical-items-core", sourceId)` — é essa chave (o `_id` que o doc vai ter dentro do pack novo), não o `sourceId` bruto do vendor, que o `sourceHashesById` de `apply.mjs` espera; 3) não confiar no `sourceHash` que já vem no chunk ao montar o arquivo de trabalho — `apply.mjs` recalcula via `computeSourceHashesById(docs)` a partir do doc real do pack no momento do merge e ignora qualquer valor externo (mantê-lo não quebra o apply, mas também não substitui o recálculo, então é ruído); 4) emitir o resultado em `out/translate/alchemical-items-core/translated-107.json` — o prefixo `translated-` é obrigatório, é o que `readTranslatedFiles` (`apply.mjs:66`) filtra; 5) depois de rodar o apply, um assert de cobertura confirmando que as 35 ids re-chaveadas existem no `i18n.pt-BR.json` final do pack — sem isso o descarte silencioso do passo 1 pode voltar sem que ninguém perceba.
- **Depende de**: ALQ-F2-02, ALQ-F2-17
- **Paralelo com**: ALQ-F0-02, ALQ-F1-02, ALQ-F1-03, ALQ-F2-01, ALQ-F4-19
- **Modelo / esforço**: sonnet / medium — transformação de dados com teste.
- **Teste (TDD)**: `src/__tests__/effect-refs.test.mjs`: Elixir of Life (Minor) sai com `effectRefs[0]` = id de "Effect: Elixir of Life". `packs-validation.test.ts`: 575 docs válidos; toda bomba com `expend ≥ 1` e `range > 0`.
- **Prova visual (print)**: Compêndio → "Itens alquímicos" filtrado por bomba, com Fogo de Alquimista (Menor), nível e traits.
- **Spec/REQ**: `REQ-PF2-222`
- **Tamanho**: M
- **Onda**: 2
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-04 — pt-BR lote A: bombas e munição (165 docs)

- **Repo**: satélite
- **Onde**: `tools/translate-packs/src/{extract,apply,qa}.mjs`, `glossary.pt-BR.json`, chunk `alchemical-items-core` A
- **Entrega**: Nome e descrição pt-BR das 95 bombas e 70 munições em chunk próprio, pulando os itens que a ALQ-F2-17 já trouxe traduzidos. Pés continuam pés; `@UUID`/`@Damage` intactos.
- **Depende de**: ALQ-F2-03
- **Paralelo com**: ALQ-F2-12, ALQ-F0-05, ALQ-F0-06, ALQ-F3-02, ALQ-F1-12
- **Modelo / esforço**: haiku / low — tradução guiada por glossário.
- **Teste (TDD)**: `node src/qa.mjs --packs alchemical-items-core` sem enricher quebrado; 0 ocorrências de "metros" no chunk.
- **Prova visual (print)**: Coberta por ALQ-F2-07.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 6
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-05 — pt-BR lote B: elixires, mutágenos, poções e óleo (169 docs)

- **Repo**: satélite
- **Onde**: `tools/translate-packs`, chunk `alchemical-items-core` B (`category ∈ {elixir, mutagen, potion, oil}`)
- **Entrega**: Tradução do lote B em chunk próprio, `@UUID` preservado, pulando os já traduzidos pela ALQ-F2-17 (Antidote, Antiplague, Bomber's Eye Elixir…).
- **Depende de**: ALQ-F2-03
- **Paralelo com**: ALQ-F2-14, ALQ-F0-10, ALQ-F3-07, ALQ-F2-06, ALQ-F4-01
- **Modelo / esforço**: haiku / low — mecânico.
- **Teste (TDD)**: qa sem erro e `@UUID` preservado em 100% dos docs com `effectRefs`.
- **Prova visual (print)**: Coberta por ALQ-F2-07.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 7
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-06 — pt-BR lote C: venenos, "other", kits, droga, armaduras/escudo + efeitos

- **Repo**: satélite
- **Onde**: `tools/translate-packs`, chunk `alchemical-items-core` C e chunk `equipment-effects-core`
- **Entrega**: Restante do pack alquímico (241 docs, menos os já portados pela ALQ-F2-17) e nomes/descrições dos efeitos. Se passar de 300 docs no chunk, dividir os efeitos (F2-06b).
- **Depende de**: ALQ-F2-02, ALQ-F2-03
- **Paralelo com**: ALQ-F2-14, ALQ-F0-10, ALQ-F3-07, ALQ-F2-05, ALQ-F4-01
- **Modelo / esforço**: haiku / low — mecânico.
- **Teste (TDD)**: qa sem erro nos dois packs.
- **Prova visual (print)**: Coberta por ALQ-F2-07.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 7
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-07 — Aplicar pt-BR + 16 equipamentos "manual" (NEW-NO-STRUCTURE)

- **Repo**: satélite
- **Onde**: `tools/translate-packs/src/apply.mjs --packs alchemical-items-core,equipment-effects-core`; `tools/importer-pf2e/src/curation/manual-automation.mjs` (novo); novo `sheets/pf2e/src/components/sheets/pf2e/inventory/AutomationBadge.svelte` montado na linha do inventário de `CharacterSheet.svelte`
- **Entrega**: `i18n.pt-BR.json` dos dois packs gerado num apply único. Os 16 equipamentos (Poison Concentrator, Alchemist's Flamethrower…) com `system.fusion.automation = "manual"` e nota de mesa pt-BR; o inventário mostra o selo "manual" com tooltip.
- **Depende de**: ALQ-F2-04, ALQ-F2-05, ALQ-F2-06
- **Paralelo com**: ALQ-F3-05, ALQ-F3-11, ALQ-F3-12, ALQ-F6-01, ALQ-F5-05
- **Modelo / esforço**: sonnet / low — merge de chunks e marcação; julgamento leve por item.
- **Teste (TDD)**: `packs-validation.test.ts`: cobertura pt-BR 100% nos dois packs; os 16 ids nominais com `automation:"manual"`. VM: `inventory[i].automation === "manual"`.
- **Prova visual (print)**: Ficha do player, Inventário: "Concentrador de Veneno" com selo "manual" e um elixir com nome em pt-BR.
- **Spec/REQ**: `REQ-PF2-226`
- **Tamanho**: P
- **Onda**: 9
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-08 — Materializador pf2e: efeitos e regras de itens embutidos chegam ao motor

- **Repo**: ambos
- **Onde**: satélite: novo `systems/pf2e/src/derivations/effectSources.ts` (registro `registrar.effectsMaterializer` em `index.ts`), `schemas/item-effect.ts` (`expiry` + `"daily-prep"`; bloco `system.fusion.{origin, startedAt, expiry}`); core: `packages/server/src/net/derive-runner.ts` (≈150-221, consome o materializador em vez de só condições)
- **Entrega**: **Fusão de F2-08 original + F4-05.** Efeitos, feats, classFeature, ancestry, heritage e equipamento equipado viram `EffectSource` com **todas** as regras, porque os scanners antigos já foram migrados para o registro na ALQ-F4-19 (D-10) e não há mais caminho paralelo que conte em dobro. `grantedConditions` do efeito viram EffectSource de condição no derivado, sem item órfão. Remover o efeito devolve os números.
- **Depende de**: ALQ-F2-01, ALQ-F4-03, ALQ-F4-19
- **Paralelo com**: ALQ-F0-08, ALQ-F1-04, ALQ-F1-05, ALQ-F1-06, ALQ-F0-07
- **Modelo / esforço**: sonnet / high — cruza derive-runner do core e sistema; risco de contagem dupla.
- **Teste (TDD)**: `packages/server/src/net/__tests__/derive-runner.effects.test.ts`: efeito `FlatModifier{selector:"saving-throw", type:"item", value:1}` → cada save +1; efeitos item +1 e +2 → +2 (não soma). `effectSources.test.ts`: Expanded Splash expõe `expanded-splash` em `synthetics.rollOptions` (desligado) e 1 nota; Weapon Specialization **não** duplica modificador (dano igual ao snapshot da ALQ-F4-03).
- **Prova visual (print)**: Ficha (player), aba Principal, antes e depois de aplicar "Efeito: Elixir da Vida" (gatilho SCAFFOLDING "Aplicar efeito do compêndio" até a F2-12): saves +1 e "Efeitos ativos" listando o efeito.
- **Spec/REQ**: `REQ-PF2-217..218`
- **Tamanho**: M
- **Onda**: 3
- **Lote e2e**: L1
- **Decisão**: D-10 (decidido: scanners antigos migram agora para o registro)

### ALQ-F2-09 — Expiração de efeito por TurnHooks (EFFECT-DUR)

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/expiry.ts` (`resolveExpirations`); novo `systems/pf2e/src/hooks/effect-expiry.ts` registrando `pf2e.effectExpiry` em `onTurnStart/onTurnEnd/onCombatEnd` (linha em `index.ts`)
- **Entrega**: No início/fim do turno do **ator de origem**, efeitos vencidos saem de todos os atores via `ctx.deleteEmbedded`; `encounter` sai no `combatEnd`; minuto/hora em rodadas. Fora de combate nada corre sozinho (D-05). Chat: "Efeito X terminou em Y", redigido via `redaction.ts` quando o alvo é oculto.
- **Depende de**: ALQ-F2-08, ALQ-F1-04
- **Paralelo com**: ALQ-F1-08, ALQ-F0-03, ALQ-F2-13, ALQ-F1-07, ALQ-F3-01
- **Modelo / esforço**: sonnet / high — borda de turno sutil sobre contrato server↔sistema.
- **Teste (TDD)**: `engine-2e/src/__tests__/expiry.test.ts`, regra de duração pelo turno de quem criou: efeito de 1 rodada `turn-start` criado por A em B **não** expira no turn-start de B e expira no próximo de A; 1 min = 10 turn-starts de A. Integração `pf2e/__tests__/effect-expiry-hook.test.ts` com TurnHookContext fake.
- **Prova visual (print)**: Tracker (GM) na rodada 2: "Efeito: …" de 1 rodada sumiu do alvo e o card diz que terminou.
- **Spec/REQ**: `REQ-PF2-219`, `REQ-SYS-140`
- **Tamanho**: M
- **Onda**: 4
- **Lote e2e**: L1
- **Decisão**: D-05 (decidido: sem relógio; expira no Descansar/preparação ou remoção manual; sem "passar tempo")

### ALQ-F2-10 — TEMP-ITEM: item físico com expiração

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/schemas/item-equipment.ts` e `item-weapon.ts` (`system.fusion.expiry`); `engine-2e/src/expiry.ts`; `hooks/effect-expiry.ts`; novo `inventory/TempItemBadge.svelte` montado no inventário
- **Entrega**: Item físico com `system.fusion.expiry` some ao vencer (turno ou `daily-prep`). O inventário mostra quando expira.
- **Depende de**: ALQ-F2-09
- **Paralelo com**: ALQ-F1-10, ALQ-F1-09, ALQ-F2-11, ALQ-F0-09, ALQ-F0-04
- **Modelo / esforço**: sonnet / medium — reuso do resolvedor.
- **Teste (TDD)**: `expiry.test.ts`: `expiry{on:"turn-start", ownerActorId:A}` sai no próximo turn-start de A; `expiry{on:"daily-prep"}` não sai em evento de combate.
- **Prova visual (print)**: Inventário (player) com bomba "temporária — expira no início do seu turno"; após o nextTurn do dono, sem ela. Gatilho SCAFFOLDING "Criar cópia temporária" até a F3-08.
- **Spec/REQ**: `REQ-PF2-220`
- **Tamanho**: P
- **Onda**: 5
- **Lote e2e**: L1

### ALQ-F2-11 — ConsumeItem: op de servidor `item:consume`

- **Repo**: ambos
- **Onde**: core: novo `packages/server/src/net/handlers/item-handlers.ts`, linha em `socket-manager.ts`, `packages/system-api/src/registries.ts` (`ConsumeItemDefinition` + `registerConsumeHook`), `packages/shared` (payload); satélite: novo `systems/pf2e/src/actions/consume.ts`
- **Entrega**: Dono ou Mestre consome 1 unidade. Server valida ownership, decrementa `uses`/`quantity`, apaga com `autoDestroy`. Cura rolada no servidor e aplicada via `ActorMechanicsService.applyDamage` (alvos da foto `targetTokenIds`, ou o próprio ator). Efeitos de `effectRefs` copiados do pack com origem e início. Escrita atômica e um card. Hooks `onConsumed` registráveis (F5-11, F6-18, F7-07).
- **Depende de**: ALQ-F2-01, ALQ-F2-02, ALQ-F2-08, ALQ-F1-08
- **Paralelo com**: ALQ-F1-10, ALQ-F1-09, ALQ-F2-10, ALQ-F0-09, ALQ-F0-04
- **Modelo / esforço**: sonnet / high — op nova cruzando server, system-api e sistema.
- **Teste (TDD)**: `packages/server/src/net/__tests__/item-consume.test.ts` (helpers/ports): elixir `uses{1,1,autoDestroy}` `quantity:2` → `quantity:1` e uses restaurado; `quantity:1` → apagado; sem ownership → `PERMISSION_DENIED`; dois consumes concorrentes com `quantity:1` → um ok e um `CONFLICT`; cura limitada ao máximo; hook `onConsumed` chamado uma vez.
- **Prova visual (print)**: Coberta por ALQ-F2-12.
- **Spec/REQ**: `REQ-PF2-223..224`, `REQ-SYS-143..144`
- **Tamanho**: M
- **Onda**: 5
- **Lote e2e**: L1

### ALQ-F2-12 — UI de inventário vivo: "Usar", quantidade e efeitos ativos

- **Repo**: satélite
- **Onde**: `CharacterSheet.svelte` (aba inventory 1144-1229; seção "Efeitos ativos"), `characterSheetVM.ts` (`inventory` 1284: `usable`, `usesLeft`, `automation`; `activeEffects`; `consumeItem()`, `removeEffect()`)
- **Entrega**: Consumível com botão "Usar"; ×N atualiza pelo broadcast. Aba Principal lista efeitos ativos com duração restante ("2 rodadas", "até a preparação") e remover (dono/Mestre). Estado vazio declarado.
- **Depende de**: ALQ-F2-11
- **Paralelo com**: ALQ-F0-05, ALQ-F0-06, ALQ-F3-02, ALQ-F1-12, ALQ-F2-04
- **Modelo / esforço**: sonnet / medium — UI com VM testável.
- **Teste (TDD)**: `__tests__/inventory-consume.test.ts`: `usable` só em consumível com uso; `consumeItem(id)` emite exatamente um `item:consume` com `expectedVersion`; `activeEffects.remaining` formatado pela política D-05.
- **Prova visual (print)**: **Player**: "Elixir da Vida (Menor) ×2" com Usar; após o clique ×1, PV maior e o efeito na aba Principal. Smoke **GM** vendo o mesmo.
- **Spec/REQ**: `REQ-PF2-223`, `REQ-PF2-225`
- **Tamanho**: M
- **Onda**: 6
- **Lote e2e**: L1
- **Decisão**: D-05 (decidido: sem relógio; expira no Descansar/preparação ou remoção manual; sem "passar tempo")

### ALQ-F2-13 — ItemStrike: strike derivado de item arremessável

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/equipment.ts:189-195`, `derivations/character.ts:981-1058` (`stepCharStrikes`), `actions/strikes.ts` (`StrikeDescriptor` + `source`, `consumesOnUse`, `splash`, `persistent`, `itemBonus`), `characterSheetVM.ts` (`StrikeRow`)
- **Entrega**: Arma com trait `bomb` (ou `consumable` e `expend>0`) e `quantity ≥ 1` gera strike à distância sem equipar. Traz bônus de item, incremento, proficiência da categoria `weapon-base-alchemical-bomb` (F0-08), `splash` e `persistent` como **dados** exibidos (aplicação na F5).
- **Depende de**: ALQ-F2-01, ALQ-F0-08
- **Paralelo com**: ALQ-F1-08, ALQ-F2-09, ALQ-F0-03, ALQ-F1-07, ALQ-F3-01
- **Modelo / esforço**: sonnet / medium — derivação pura com teste.
- **Teste (TDD)**: `systems/pf2e/src/__tests__/item-strike.test.ts`, fixture à mão: nível 1 Des +3, bomba `bonus:1`, `range:20`, `1d8 fire`, `splashDamage:1`, **não equipada** → strike existe; ataque = 3+2+1+1 = +7 com a categoria treinada; `consumesOnUse:true`; `quantity:0` → sem strike; arma comum não equipada continua sem strike.
- **Prova visual (print)**: Coberta por ALQ-F2-14.
- **Spec/REQ**: REQ-PF2-030 (citado), `REQ-PF2-227`
- **Tamanho**: M
- **Onda**: 4
- **Lote e2e**: L1

### ALQ-F2-14 — ItemStrike: rolar bomba consome a unidade

- **Repo**: ambos
- **Onde**: satélite `characterSheetVM.ts` (`rollStrike` 2222 com `consumesOnUse` → `item:consume{mode:"strike", mapIndex}`), `actions/consume.ts` (modo strike); core `item-handlers.ts`
- **Entrega**: Clicar no ataque da bomba consome 1 unidade e rola o ataque no servidor contra o alvo, com grau; a mensagem carrega `flags.fusion.rollContext` (contrato RollNotes) para os hooks de rolagem da F4. O dano do card aplica via ApplyDamage. Sem unidade, botão desabilitado com motivo.
- **Depende de**: ALQ-F2-11, ALQ-F2-13, ALQ-F1-10
- **Paralelo com**: ALQ-F0-10, ALQ-F3-07, ALQ-F2-05, ALQ-F2-06, ALQ-F4-01
- **Modelo / esforço**: sonnet / high — junta strike, consumo e rolagem de servidor.
- **Teste (TDD)**: `item-consume.test.ts` (modo strike): bomba `quantity:3` → 2 e **uma** ChatMessage com `RollResult` do servidor (`total = d20 + bônus derivado`); nat 20 vs CA → dados de dano dobram; `total` enviado pelo cliente é ignorado; mensagem tem `rollContext.itemId`.
- **Prova visual (print)**: Ficha (player): strike "Fogo de Alquimista ×3" → ataque → card com grau contra o alvo marcado, inventário ×2 e PV do alvo menor após o botão de dano (tela do GM).
- **Spec/REQ**: `REQ-PF2-228`, `REQ-PF2-224`
- **Tamanho**: M
- **Onda**: 7
- **Lote e2e**: L1

### ALQ-F2-15 — Roteiro tutorial-e2e da F2

- **Repo**: core
- **Onde**: `docs/design/alquimista/e2e/alq-f2.html` (skill tutorial-e2e, `PROCESSO-UI.md` P2/P4)
- **Entrega**: Um print por tarefa F2-02…F2-14, alvo circulado, GM e player, botão de exportar progresso.
- **Depende de**: ALQ-F2-02, ALQ-F2-03, ALQ-F2-07, ALQ-F2-08, ALQ-F2-09, ALQ-F2-10, ALQ-F2-12, ALQ-F2-14
- **Paralelo com**: ALQ-F0-11, ALQ-F1-13
- **Modelo / esforço**: sonnet / medium — dirigir app e olhar prints.
- **Teste (TDD)**: n/a (é a prova); divergência vira issue.
- **Prova visual (print)**: O próprio conjunto de prints.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 9 (só leitura, fora do teto)
- **Lote e2e**: L1

### ALQ-F2-17 — Portar a curadoria e o pt-BR dos 35 alquímicos do #107 (linha build/app)

- **Repo**: satélite
- **Onde**: leitura via `git show origin/build/app:systems/pf2e/packs/equipment-core/{documents,i18n.pt-BR}.json` no core; saída em `tools/importer-pf2e/src/curation/alchemical-from-107.mjs` (overrides por `sourceId`) e chunk pt-BR `tools/translate-packs` `alchemical-items-core` (lote "107")
- **Entrega**: Os 35 itens alquímicos que o PR #107 já publicou em `equipment-core` na build/app (Antidote, Antiplague, Absolute Solvent, Bomber's Eye Elixir, Bottled Catharsis…) viram overrides de curadoria e um chunk de tradução pronto, por `sourceId`, para o `alchemical-items-core` da alfa. Nada é mergeado entre as linhas: é porte de dado, e o que divergir do vendor atual vai para o relatório.
- **Depende de**: —
- **Paralelo com**: ALQ-F0-01, ALQ-F1-01, ALQ-F2-02, ALQ-F4-02, ALQ-F4-03
- **Modelo / esforço**: haiku / low — extração e remapeamento mecânico de dado já curado.
- **Teste (TDD)**: `curation/__tests__/alchemical-from-107.test.mjs`: os 35 `sourceId` do #107 existem no raw atual do vendor; todo override aponta para doc com trait `alchemical`; chunk pt-BR passa no `qa.mjs` sem enricher quebrado.
- **Prova visual (print)**: Coberta por ALQ-F2-07 (Antídoto em pt-BR no inventário).
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 1
- **Lote e2e**: L1
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F2-16 — Guard de skip do importer: a suíte de efeitos não pode falhar por falta de `out/`

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/__tests__/transform.test.mjs` (`OUT_DIR` 34, `OUT_MISSING` 44, e as 14 suítes declaradas com `{ skip: OUT_MISSING }`, não 10 — recontado em 2026-09-16)
- **Entrega**: O guard passa a checar o **arquivo** que cada suíte lê (`out/<pack>/transformed.json`), não a existência da pasta `out/`. Hoje `existsSync(OUT_DIR)` dá verdadeiro numa máquina cujo `out/` tem só `fusion-uuid-map.json`, a suíte não pula e os 7 subtestes de `effect duration normalization (ALQ-F2-02)` falham com `File not found`. Medido na onda 1: base `9945849f` = 115 pass / 52 fail; `feat/alquimista` = 128 pass / **59 fail**, e as 7 falhas novas são exatamente essa suíte. **Causa raiz (achado ALQ17-04, confirmado em 2026-09-16 — mais fundamental do que "máquina com `out/` sujo de rodada anterior")**: `transform.mjs` chama `main().catch(...)` incondicionalmente no top-level do módulo, sem nenhuma guarda `import.meta.url === ...` — então o simples `import { normalizeEffectDuration, normalizeEffectSystem } from "../transform.mjs"` no topo do PRÓPRIO `transform.test.mjs` já dispara a pipeline inteira (tentando os 13 packs, todos com erro "normalized.json not found" porque `normalize.mjs` não rodou) como efeito colateral da importação, e `saveUuidMap` (`transform.mjs:2515`: `mkdirSync` + `writeFileSync`) cria `out/fusion-uuid-map.json` ANTES de `const OUT_MISSING = existsSync(OUT_DIR) ? false : "..."` (`transform.test.mjs:44`) sequer ser avaliado — módulos ES executam o corpo de um import por completo antes do restante do arquivo importador continuar. Verificado removendo `out/` por inteiro e rodando `node --test` do zero: o guard já nasce inerte na 1ª execução, em qualquer máquina — não é só reincidência em máquina já usada. Nesse mesmo ambiente comprovadamente limpo o resultado foi idêntico ao "sujo": 128 pass / 59 fail. Efeito gêmeo confirmado do mesmo jeito: a execução sobrescreve `analysis/08-transform-report.json` (1340→13 linhas) e `.md` com um relatório degenerado (0 packs processados). Isso muda o alvo da correção: **duas correções, não uma** — 1) trocar o guard de `existsSync(OUT_DIR)` para checar o arquivo específico que cada suíte lê, como já estava planejado; 2) isolar a escrita de `saveUuidMap`/`writeTransformReport` — e o `main()` incondicional que as dispara — atrás de uma guarda de execução real (`import.meta.url === pathToFileURL(process.argv[1]).href` ou equivalente), porque sem ela qualquer código que só queira uma função pura de `transform.mjs` continua rodando a CLI inteira como efeito colateral, e a correção 1 sozinha não impede a sujeira gêmea nos relatórios rastreados.
- **Depende de**: —
- **Paralelo com**: qualquer tarefa da onda 2
- **Modelo / esforço**: haiku / low — conserto localizado de guard, com medição antes e depois.
- **Teste (TDD)**: rodar `node --test tools/importer-pf2e/src/__tests__/transform.test.mjs` antes (59 falhas) e depois (52 falhas, as 7 da F2-02 pulando com motivo). As duas suítes unitárias novas da F2-02 (`normalizeEffectDuration — encounter`, 4 testes; `normalizeEffectSystem — automation`, 3 testes) continuam rodando e passando — elas não leem `out/`.
- **Prova visual (print)**: Sem UI.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 2
- **Lote e2e**: L1

### ALQ-F2-18 — Compêndio: pré-visualização mostra a duração do efeito

- **Repo**: core
- **Onde**: `packages/client/src/lib/compendium/documentDetails.ts::buildMechanicalFields` (≈1296-1315)
- **Entrega**: `buildMechanicalFields()` ganha o caso `type: "effect"` e renderiza a duração em linguagem de mesa ("10 minutos", "1 rodada", "enquanto durar o encontro", "ilimitado"), respeitando `expiry` e `sustained`. Hoje não existe nenhum `case` para efeito: um documento com `duration: {unit:'minute', value:10}` abre sem campo de duração nenhum, e a linha da lista mostra só o rótulo cru `Unit minute`. É o que impediu a prova visual pedida pela ALQ-F2-02.
- **Depende de**: ALQ-F2-02
- **Paralelo com**: ALQ-F2-19
- **Modelo / esforço**: sonnet / medium — UI com dado já pronto no pack.
- **Teste (TDD)**: teste de `documentDetails` com os quatro shapes de duração do pack (`minute`/`round`/`encounter`/`unlimited`), asserindo o texto exibido pela regra do PF2e remaster, não pela string do vendor.
- **Prova visual (print)**: Compêndio (GM) com "Effect: Elixir of Life" aberto mostrando a duração; depois da ALQ-F2-06/07, o mesmo print em pt-BR fecha a dívida da F2-02.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 3
- **Lote e2e**: L1

### ALQ-F2-19 — Compêndio: descrição sem HTML cru na pré-visualização

- **Repo**: core
- **Onde**: `packages/client/src/components/compendium/CompendiumPreviewWindow.svelte:267`
- **Entrega**: A descrição deixa de aparecer com as tags literais na tela. Hoje a linha é `<p class="compendium-preview__description">{preview.description}</p>`, e como Svelte escapa a interpolação o jogador lê `<p>Granted by @UUID[...]</p>` na janela. Decidir entre sanitizar e renderizar o HTML ou converter para texto limpo antes de exibir — e tratar os `@UUID[...]` do vendor, que também vazam crus. Defeito **pré-existente**, observado no print `03-preview-elixir-of-life.png` da onda 1.
- **Depende de**: —
- **Paralelo com**: ALQ-F2-18
- **Modelo / esforço**: sonnet / medium — decisão de render com risco de XSS se mal feita.
- **Teste (TDD)**: teste de componente/VM com descrição contendo `<p>`, `<em>` e `@UUID[...]`, asserindo que o texto exibido não contém marcação crua e que nada executável sobrevive à sanitização.
- **Prova visual (print)**: Mesma janela do print `03-preview-elixir-of-life.png`, agora sem tags na tela.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 3
- **Lote e2e**: L1

### ALQ-F2-20 — Curadoria: confirmar os dois Aeon Stones do `equipment-effects-core`

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/build-mvp-subset.mjs` (lista curada do pack, ≈782); exige o clone de `tools/importer-pf2e/vendor/`
- **Entrega**: `Effect: Aeon Stone (Pink Rhomboid)` e `Effect: Aeon Stone Resonance (Black Disc)` entraram no pack na ALQ-F2-02 e podem ser pré-remaster/OGL. Rodar extract+transform com o vendor presente, checar a `publication` de cada um e decidir: sai do pack ou fica documentado como ORC. `Aura: Demon's Knot` já foi confirmado pré-remaster (Pathfinder #195) e está documentado. Achado da revisão adversarial da onda 1, deixado em aberto por falta do vendor na máquina.
- **Depende de**: ALQ-F2-02
- **Paralelo com**: qualquer tarefa da onda 4
- **Modelo / esforço**: haiku / low — medição no vendor e ajuste de lista.
- **Teste (TDD)**: teste de política do pack: todo documento publicado tem `publication.remaster === true` ou consta na lista explícita de exceções documentadas.
- **Prova visual (print)**: Sem UI.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 4
- **Lote e2e**: L1

### F3 — Núcleo alquímico

### ALQ-F3-01 — Spec nova `47-fabricacao-e-alquimia.md` (FAB) + emendas 15/17

- **Repo**: core
- **Onde**: `specs/47-fabricacao-e-alquimia.md` (novo, nível Recorte), `specs/README.md` (bloco `prefixos`: `REQ-FAB-`), `specs/15-api-de-sistemas.md`, `specs/17-sistema-pf2e.md` (`REQ-PF2-103` reclassificado)
- **Entrega**: `DEC-FAB-01…` para recurso de classe como dado, DailyPrep em pipeline, CraftingAbility parametrizada, item infundido, D-06/D-07/D-08. REQs de ActorResource, DailyPrep, FormulaBook, CraftingAbility (Advanced/Quick/Double Brew/vial), Craft, lote diário e DC de item pela Class DC. Cita 10, 15, 17 sem contrariar DEC-PF2-03. Na 15: `DailyPrepStepDefinition`, `CraftingAbilityDefinition` e o ponto `registerCraftingDraftHook`.
- **Depende de**: ALQ-F2-01
- **Paralelo com**: ALQ-F1-08, ALQ-F2-09, ALQ-F0-03, ALQ-F2-13, ALQ-F1-07
- **Modelo / esforço**: opus / high — pipeline de preparação e ability de fabricação consumidos por F6/F7.
- **Teste (TDD)**: `spec-lint`: prefixo `FAB` registrado com dono único, REQs com tag, citações resolvem.
- **Prova visual (print)**: Sem UI. Coberta por F3-04, F3-06, F3-09 e F3-10.
- **Spec/REQ**: 47 → `DEC-FAB-01..06`, `REQ-FAB-001..040`; 15 → `REQ-SYS-145..148`; 17 → emenda `REQ-PF2-103`
- **Tamanho**: G (spec: não quebrar, a seção Decisões nasce inteira)
- **Onda**: 4
- **Lote e2e**: L2
- **Decisão**: D-06 (decidido: Quick Alchemy sem relógio novo: RAW em combate, `daily-prep` fora); D-07 (decidido: sem desconto de moedas; custo sai pela `CurrencyPort` no-op); D-08 (decidido: Quick Alchemy sem toolkit avisa e deixa fazer)

### ALQ-F3-02 — ActorResource: schema, descritor e avaliador de fórmula

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/schemas/actor-character.ts:142-159` (`ResourcesSchema.special`), `derivations/build.ts` (step `pf2e.character.derived.specialResources` ≈653-686), novo `systems/engine-2e/src/resourceFormula.ts`, `derivations/types.ts`
- **Entrega**: `system.derived.resources[slug] = {value, max, level?, recharge, label}` a partir de descritores `kind:"special-resource"`; `value` persistido e clampado. Frequências (1/dia) usam o mesmo contrato com slug `freq:<itemSlug>`. Avaliador sem `eval`.
- **Depende de**: ALQ-F3-01
- **Paralelo com**: ALQ-F2-12, ALQ-F0-05, ALQ-F0-06, ALQ-F1-12, ALQ-F2-04
- **Modelo / esforço**: sonnet / high — contrato novo de ator e superfície de segurança.
- **Teste (TDD)**: `engine-2e/src/__tests__/resourceFormula.test.ts`: `"2 + @actor.system.abilities.int.mod"` Int +4 → 6; ternary do nível do vial nos níveis 3/4/12/18 → 1/4/12/18 (tabela do PC2 escrita no teste); `"process.exit()"` → erro de parse. `special-resources.test.ts`: `value:9, max:6` → 6; dois descritores do mesmo slug somam só com `mode:"add"`.
- **Prova visual (print)**: Coberta por ALQ-F3-04.
- **Spec/REQ**: `REQ-FAB-001..006`
- **Tamanho**: M
- **Onda**: 6
- **Lote e2e**: L2

### ALQ-F3-03 — Importer: `SpecialResource` → descritor `special-resource`

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/transform.mjs:161`, `curation/classes/alchemist.json`; regenerar `class-features-core`/`feats-core` (extract + transform frescos)
- **Entrega**: Versatile Vials, Alchemist Dedication (4 fixo) e Voluminous Vials saem com o descritor; o relatório lista os `SpecialResource` de outras classes convertidos.
- **Depende de**: ALQ-F3-02, ALQ-F0-02
- **Paralelo com**: ALQ-F1-11, ALQ-F3-08, ALQ-F5-01, ALQ-F4-07, ALQ-F4-06
- **Modelo / esforço**: sonnet / medium — conversor de RE conhecido.
- **Teste (TDD)**: `transform.test.mjs`: RE `{key:"SpecialResource", slug:"versatile-vials", max:"2 + …"}` → `{kind:"special-resource", slug, max, level, recharge:"daily-prep"}`; `packs-validation.test.ts`: Versatile Vials com exatamente um descritor.
- **Prova visual (print)**: Coberta por ALQ-F3-04.
- **Spec/REQ**: `REQ-FAB-002`
- **Tamanho**: P
- **Onda**: 8
- **Lote e2e**: L2

### ALQ-F3-04 — UI de recursos de classe (contador genérico)

- **Repo**: satélite
- **Onde**: novo `sheets/pf2e/src/components/sheets/pf2e/resources/SpecialResources.svelte` + `specialResourcesVM.ts`, montados em `CharacterSheet.svelte` (aba main, perto de heroico/foco)
- **Entrega**: Todo recurso derivado vira contador com nome pt-BR, `valor/máx` e ±. Recurso sem descritor não aparece. Player dono edita via `doc:update`.
- **Depende de**: ALQ-F3-02, ALQ-F3-03
- **Paralelo com**: ALQ-F3-06, ALQ-F3-09, ALQ-F4-09, ALQ-F4-04, ALQ-F6-03
- **Modelo / esforço**: sonnet / medium — UI padrão com VM.
- **Teste (TDD)**: `__tests__/special-resources-vm.test.ts`: `setSpecialResource("versatile-vials", 99)` emite diff clampado; lista vazia para Guerreiro.
- **Prova visual (print)**: Ficha do Alquimista nível 1 Int +4 (player): "Frascos versáteis 6/6"; − → 5/6 e a tela do GM também 5/6.
- **Spec/REQ**: `REQ-FAB-005`
- **Tamanho**: P
- **Onda**: 10
- **Lote e2e**: L2

### ALQ-F3-05 — DailyPrep: pipeline de servidor com etapas registráveis

- **Repo**: ambos
- **Onde**: core `packages/system-api/src/registries.ts` (`registerDailyPrepStep`), novo `packages/server/src/net/handlers/actor-prep-handlers.ts` (`actor:dailyPrep`), linha em `socket-manager.ts`; satélite novo `systems/pf2e/src/actions/daily-prep/{hp,spellSlots,focus,resources,expiry}.ts`, `characterSheetVM.ts:2733` (`restAll` emite a op)
- **Entrega**: Descansar chama a op; etapas em ordem numa transação, card de resumo. Etapas nativas: HP, slots, foco (paridade com `restAll`), recarga de recursos `daily-prep` e expiração `daily-prep` via `resolveExpirations`. Etapa que lança aborta sem escrita parcial.
- **Depende de**: ALQ-F3-01, ALQ-F3-02, ALQ-F2-10
- **Paralelo com**: ALQ-F3-11, ALQ-F2-07, ALQ-F3-12, ALQ-F6-01, ALQ-F5-05
- **Modelo / esforço**: sonnet / high — pipeline server↔sistema.
- **Teste (TDD)**: `packages/server/src/net/__tests__/daily-prep.test.ts` (helper de porta): **paridade** com o `restAll` antigo (fixture congelada; HP = mod Con × nível, mínimo 1 × nível); recurso 2/6 → 6/6; item temporário `daily-prep` → apagado; efeito de hora → apagado; etapa que lança → nada muda.
- **Prova visual (print)**: Alquimista (player) com vials 1/6, bomba "temporária até a preparação" e PV ferido; Descansar → 6/6, bomba some, PV recupera e card lista as três coisas.
- **Spec/REQ**: `REQ-FAB-010..015`, `REQ-SYS-145`
- **Tamanho**: M (se passar de 300 linhas: 05a pipeline+paridade, 05b recurso+expiração)
- **Onda**: 9
- **Lote e2e**: L2

### ALQ-F3-06 — VIALS: frasco versátil como bomba e regeneração em exploração

- **Repo**: satélite
- **Onde**: `derivations/character.ts` (strike virtual a partir do recurso), `actions/consume.ts` (modo `resource`), `sheets/pf2e/.../ActionsTab.svelte` + `actionsVM.ts` ("Refinar frascos — 10 min")
- **Entrega**: Com vial > 0, strike "Frasco versátil (nível N)"; rolar gasta 1 vial (`item:consume{mode:"resource"}`). Ação de exploração regenera +2 (+3 com Alchemical Expertise) até o máximo.
- **Depende de**: ALQ-F3-02, ALQ-F3-05, ALQ-F2-14
- **Paralelo com**: ALQ-F3-09, ALQ-F4-09, ALQ-F4-04, ALQ-F3-04, ALQ-F6-03
- **Modelo / esforço**: sonnet / high — ItemStrike e ConsumeItem com fonte nova.
- **Teste (TDD)**: `__tests__/versatile-vials.test.ts`: nível 4 → strike `level:4` com +1 de item (tabela do PC2 no teste); vial 0 → sem strike; regenerar 5/6 → 6/6; com Alchemical Expertise 1/6 → 4/6.
- **Prova visual (print)**: Alquimista (player) vials 3/6: strike "Frasco versátil" → card e 2/6; "Refinar frascos" → 4/6.
- **Spec/REQ**: `REQ-FAB-016..019`
- **Tamanho**: M
- **Onda**: 10
- **Lote e2e**: L2

### ALQ-F3-07 — FORMULA-BOOK: fórmulas conhecidas no ator

- **Repo**: satélite
- **Onde**: `schemas/actor-character.ts` (`system.crafting.formulas`), step `pf2e.character.derived.formulaBook`, novo `components/sheets/pf2e/crafting/CraftingTab.svelte` + `formulaBookVM.ts` (aba "Fabricação" montada em `CharacterSheet.svelte`), picker filtrado por `alchemical-items-core`
- **Entrega**: Jogador vê e gerencia o livro; adicionar abre picker (traço, nível ≤ personagem). Identidade = `flags.fusion.sourceId`, nunca o nome. Contagem esperada × real das fórmulas iniciais, sem auto-concessão.
- **Depende de**: ALQ-F3-01, ALQ-F2-03
- **Paralelo com**: ALQ-F2-14, ALQ-F0-10, ALQ-F2-05, ALQ-F2-06, ALQ-F4-01
- **Modelo / esforço**: sonnet / medium — schema + UI padrão.
- **Teste (TDD)**: `__tests__/formula-book.test.ts`: mesma sourceId duas vezes → um registro; fórmula nível 5 em personagem 3 → inválida; esperado no nível 3 = 2 + 2×3 = 8 (regra do PC2 escrita no teste).
- **Prova visual (print)**: Aba Fabricação (player): "Livro de fórmulas 3/8", picker filtrado ≤ 3 e "Elixir da Vida (Menor)" adicionado.
- **Spec/REQ**: `REQ-FAB-020..024`
- **Tamanho**: M
- **Onda**: 7
- **Lote e2e**: L2
- **Decisão**: D-09 (decidido: pack novo `alchemical-items-core` + porte dos 35 itens do #107)

### ALQ-F3-08 — CraftingAbility: op `crafting:create` (item temporário de fórmula)

- **Repo**: ambos
- **Onde**: core `packages/system-api/src/registries.ts` (`CraftingAbilityDefinition`, `registerCraftingDraftHook`), novo `packages/server/src/net/handlers/crafting-handlers.ts`, linha em `socket-manager.ts`; satélite novo `systems/pf2e/src/actions/crafting/{ability.ts, abilities/advancedAlchemy.ts, abilities/quickAlchemy.ts}`
- **Entrega**: `crafting:create{actorId, abilitySlug, formulaSourceIds[], additives?, expectedVersion}`: valida livro, teto de nível e recurso; copia do pack com `traits += infused`, `system.fusion.infused{actorId, classDc}`, `system.fusion.expiry` da ability; debita recurso; roda os draft hooks (vazio até a F7-06). Atômico, um card.
- **Depende de**: ALQ-F3-02, ALQ-F3-07, ALQ-F2-10
- **Paralelo com**: ALQ-F1-11, ALQ-F3-03, ALQ-F5-01, ALQ-F4-07, ALQ-F4-06
- **Modelo / esforço**: sonnet / high — op nova com validação de regra.
- **Teste (TDD)**: `packages/server/src/net/__tests__/crafting-create.test.ts`: fórmula fora do livro → `VALIDATION_FAILED`; item nível 5 em alquimista 3 → recusado; quick-alchemy com vials 0 → recusado sem escrita; sucesso → `infused` e `expiry.on:"turn-start"`, vials −1; sem ownership → `PERMISSION_DENIED`.
- **Prova visual (print)**: Coberta por ALQ-F3-09 e ALQ-F3-10.
- **Spec/REQ**: `REQ-FAB-025..029`, `REQ-SYS-146`
- **Tamanho**: M
- **Onda**: 8
- **Lote e2e**: L2

### ALQ-F3-09 — Alquimia Avançada na preparação + rastreio do lote diário

- **Repo**: satélite
- **Onde**: `actions/daily-prep/advancedAlchemy.ts` (etapa com escolha), `crafting/abilities/advancedAlchemy.ts`, `system.crafting.dailyBatch`, novo `components/sheets/pf2e/crafting/AdvancedAlchemyDialog.svelte`, `formulaBookVM.ts`
- **Entrega**: Com Advanced Alchemy, Descansar abre "Alquimia avançada": escolher do livro até o teto (4 + Int; 4 na Dedicação), contador "usados 3/8". Confirma → `crafting:create` em lote, itens infundidos com `expiry:"daily-prep"`; "Lote de hoje" na aba Fabricação zera na próxima preparação.
- **Depende de**: ALQ-F3-05, ALQ-F3-08
- **Paralelo com**: ALQ-F3-06, ALQ-F4-09, ALQ-F4-04, ALQ-F3-04, ALQ-F6-03
- **Modelo / esforço**: sonnet / high — etapa interativa dentro do pipeline.
- **Teste (TDD)**: `__tests__/advanced-alchemy.test.ts`: Int +4 → teto 8; Dedicação → 4 independente de Int; 9 → recusado; preparação seguinte → lote anterior apagado e `made = 0`.
- **Prova visual (print)**: Alquimista (player): Descansar → "Alquimia avançada 0/8" → 2× Fogo de Alquimista (Menor) + 1× Elixir da Vida (Menor) → inventário com os 3 "infundido — até a preparação" e "Lote de hoje 3/8".
- **Spec/REQ**: `REQ-FAB-030..033`
- **Tamanho**: M
- **Onda**: 10
- **Lote e2e**: L2

### ALQ-F3-10 — QUICK-ALCH: ação Alquimia Rápida (+ Double Brew)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/actionsVM.ts` + `ActionsTab.svelte`, `crafting/abilities/quickAlchemy.ts`
- **Entrega**: Botão "Alquimia rápida ◆": escolhe fórmula (duas com Double Brew), gasta vial e cria o item na hora, sem relógio novo (D-06). Em combate segue RAW: item potente até o início do próximo turno do alquimista (`expiry turn-start`), Quick Vial até o fim do turno atual (`turn-end`), efeitos criados limitados a 10 min. Fora de combate expira na próxima preparação diária ou por remoção manual (`daily-prep`). Sem kit equipado **avisa e deixa fazer** (D-08).
- **Depende de**: ALQ-F3-08, ALQ-F3-06
- **Paralelo com**: ALQ-F3-13, ALQ-F4-11, ALQ-F4-13, ALQ-F4-14, ALQ-F4-12
- **Modelo / esforço**: sonnet / medium — ability parametrizada; UI + parâmetro.
- **Teste (TDD)**: `__tests__/quick-alchemy.test.ts`: sem Alchemist's Toolkit → `canUse:true, warning:"toolkit"`; Double Brew com vials 1 → só 1 item; payload leva `abilitySlug:"quick-alchemy"` e nunca `expiry`; servidor decide: com combate ativo → `turn-start` do dono (Quick Vial: `turn-end`); sem combate → `daily-prep`; efeito de 1 h vira 10 min.
- **Prova visual (print)**: Em combate (tracker visível), player usa Alquimia Rápida → "Elixir da Vida (Menor) — expira no início do seu turno", vials −1; GM avança até o turno dele e o item some.
- **Spec/REQ**: `REQ-FAB-034..036`
- **Tamanho**: M
- **Onda**: 11
- **Lote e2e**: L2
- **Decisão**: D-06 (decidido: Quick Alchemy sem relógio novo: RAW em combate, `daily-prep` fora); D-08 (decidido: Quick Alchemy sem toolkit avisa e deixa fazer)

### ALQ-F3-11 — CLASS-DC-ITEM: DC de item infundido pela Class DC (Powerful Alchemy)

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/derivations/itemDc.ts` (`resolveItemSaveDc(item, creator)`), `derivations/character.ts` (`effectiveClassDcRank`), enricher de `@Check` no card de consumo
- **Entrega**: **Fusão com a F6-16 original.** Item com `system.fusion.infused.actorId` cujo criador tem Powerful Alchemy: DC = `max(DC impressa, Class DC)`; o card mostra "CD 19 (classe)" (origem só para o GM, D-17). O mesmo resolvedor serve à exposição de aflição (F6-08) e às bombas.
- **Depende de**: ALQ-F3-08, ALQ-F2-12, ALQ-F0-08
- **Paralelo com**: ALQ-F3-05, ALQ-F2-07, ALQ-F3-12, ALQ-F6-01, ALQ-F5-05
- **Modelo / esforço**: sonnet / medium — função pura + pontos de uso.
- **Teste (TDD)**: `__tests__/class-dc-item.test.ts`: `@Check[fortitude|dc:17]`, Class DC 19 com Powerful Alchemy → 19; sem a feature → 17; não infundido por ele → 17; Class DC 15 → 17 (é max).
- **Prova visual (print)**: Inventário (player) com veneno infundido e card "Fortitude CD 19"; lado a lado o mesmo item comprado com CD 17.
- **Spec/REQ**: `REQ-FAB-037..038`
- **Tamanho**: P
- **Onda**: 9
- **Lote e2e**: L2
- **Decisão**: D-17 (decidido: só o Mestre vê a DC do veneno)

### ALQ-F3-12 — CRAFT-ACT (a): atividade Craft no servidor

- **Repo**: ambos
- **Onde**: core `crafting-handlers.ts` (`crafting:craft`); satélite novo `systems/pf2e/src/actions/crafting/craft.ts`
- **Entrega**: `crafting:craft{actorId, formulaSourceId, quantity, days}` rola Crafting no servidor contra a DC do nível (ajuste por raridade), exige fórmula e proficiência; sucesso/crítico cria item permanente; falha não cria; falha crítica gera nota de perda. **Custo sem desconto de moedas (D-07)**: o craft calcula o custo e o emite pela porta `CurrencyPort.requestCost` (evento `crafting:costRequested`); a implementação registrada agora é no-op e só anota o custo no card, para a futura carteira plugar sem mexer no crafting.
- **Depende de**: ALQ-F3-08
- **Paralelo com**: ALQ-F3-05, ALQ-F3-11, ALQ-F2-07, ALQ-F6-01, ALQ-F5-05
- **Modelo / esforço**: sonnet / high — rolagem de servidor com grau e DC.
- **Teste (TDD)**: `__tests__/craft-activity.test.ts`: DC de item nível 1 comum = 15, nível 5 = 20, incomum +2 (tabela do GM Core escrita no teste); Crafting destreinado → recusado; nat 20 → crítico → item criado; nat 1 → nada criado + nota; `CurrencyPort` fake recebe `requestCost` uma vez com o custo pela regra (metade do preço do item em sucesso) e o no-op padrão só anota o valor no card, sem tocar inventário.
- **Prova visual (print)**: Coberta por ALQ-F3-13.
- **Spec/REQ**: `REQ-FAB-039`, `REQ-PF2-103` (reclassificado)
- **Tamanho**: M
- **Onda**: 9
- **Lote e2e**: L2
- **Decisão**: D-07 (decidido: sem desconto de moedas; custo sai pela `CurrencyPort` no-op)

### ALQ-F3-13 — CRAFT-ACT (b): UI da atividade Craft

- **Repo**: satélite
- **Onde**: `crafting/CraftingTab.svelte` (botão "Fabricar"), novo `crafting/CraftDialog.svelte`, `formulaBookVM.ts`
- **Entrega**: "Fabricar…" abre diálogo com DC previsto, bônus e custo informativo ("a carteira ainda não desconta"); confirmar chama `crafting:craft` e o resultado aparece no card e no inventário.
- **Depende de**: ALQ-F3-12
- **Paralelo com**: ALQ-F3-10, ALQ-F4-11, ALQ-F4-13, ALQ-F4-14, ALQ-F4-12
- **Modelo / esforço**: sonnet / medium — UI com VM.
- **Teste (TDD)**: `__tests__/craft-dialog-vm.test.ts`: DC previsto = DC do servidor (mesma função pura importada); botão desabilitado com Crafting destreinado.
- **Prova visual (print)**: Aba Fabricação (player) → "Fabricar Fogo de Alquimista (Menor)" → "CD 15, +7" → card de sucesso → item permanente **sem** selo temporário.
- **Spec/REQ**: `REQ-FAB-040`
- **Tamanho**: P
- **Onda**: 11
- **Lote e2e**: L2
- **Decisão**: D-07 (decidido: sem desconto de moedas; custo sai pela `CurrencyPort` no-op)

### ALQ-F3-14 — Roteiro tutorial-e2e da F3

- **Repo**: core
- **Onde**: `docs/design/alquimista/e2e/alq-f3.html`
- **Entrega**: Um print por tarefa F3-04…F3-13 com o mesmo Alquimista (nível 4, e 5 para Powerful Alchemy) em mundo existente, GM e player.
- **Depende de**: ALQ-F3-04, ALQ-F3-05, ALQ-F3-06, ALQ-F3-07, ALQ-F3-09, ALQ-F3-10, ALQ-F3-11, ALQ-F3-13
- **Paralelo com**: ALQ-F4-18
- **Modelo / esforço**: sonnet / medium — dirigir app e olhar prints.
- **Teste (TDD)**: n/a (é a prova).
- **Prova visual (print)**: O próprio conjunto.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 13 (só leitura, fora do teto)
- **Lote e2e**: L2

### F4 — Motor de rule elements

### ALQ-F4-01 — Spec: motor de rule elements como plataforma

- **Repo**: core
- **Onde**: `specs/15-api-de-sistemas.md` (REQ-SYS-082, 088, 089), `specs/17-sistema-pf2e.md` (DEC-PF2-04), `specs/38-aba-chat.md` (notas no card)
- **Entrega**: Promove AEL, roll option com toggle, nota no card, adjustModifier, adjustDegreeOfSuccess, itemAlteration, damageAlteration/damageDice condicional e adjustStrike para entregue; fixa fases, allowlist AEL, contexto de rolagem + hook `onRollResolved`, toggles (D-11), migração imediata dos scanners antigos para o registro (D-10) e motor genérico com os 98 AdjustDegreeOfSuccess ligados para todas as classes, sem lista de classes habilitadas (D-14). REQ-SYS-089 sai de [V2] no modelo "registro compilado".
- **Depende de**: —
- **Paralelo com**: ALQ-F2-14, ALQ-F0-10, ALQ-F3-07, ALQ-F2-05, ALQ-F2-06
- **Modelo / esforço**: sonnet / high — texto normativo com ids e spec-lint.
- **Teste (TDD)**: `spec-lint` verde e `pnpm spec:report`.
- **Prova visual (print)**: Sem UI. Coberta por F4-08 e F4-10.
- **Spec/REQ**: 15 → emenda REQ-SYS-082/088/089 + `REQ-SYS-149..152`; 17 → `REQ-PF2-229..230`; 38 → emenda
- **Tamanho**: M
- **Onda**: 7
- **Lote e2e**: L2
- **Decisão**: D-10 (decidido: scanners antigos migram agora para o registro); D-11 (decidido: jogador liga roll option no próprio ator); D-14 (decidido: motor genérico; AdjustDegreeOfSuccess ligado para todas as classes)

### ALQ-F4-02 — `RuleElementRegistry` no engine-2e (troca o switch, comportamento idêntico)

- **Repo**: ambos
- **Onde**: satélite `systems/engine-2e/src/effectsEngine.ts` (149-173), novo `ruleElementRegistry.ts`; core `packages/system-api/src/effects.ts` (`EFFECT_RULE_KEYS`, `MVP_EFFECT_RULE_KEYS`, `isMvpRuleType`, `Synthetics` ampliado)
- **Entrega**: `register/get/handlersFor/kinds`; os 5 tipos atuais viram handlers; `collectEffects` despacha pelo registro; chave desconhecida vai ao `unsupportedLog`. `isMvpRuleType` consulta o registro. Zero mudança observável.
- **Depende de**: —
- **Paralelo com**: ALQ-F0-01, ALQ-F1-01, ALQ-F2-02, ALQ-F2-17, ALQ-F4-03
- **Modelo / esforço**: opus / high — contrato transversal (system-api + engine + pf2e + sf2e).
- **Teste (TDD)**: `engine-2e/src/__tests__/ruleElementRegistry.test.ts`: handler fictício muda o resultado; kind duplicado lança; pre-base antes de synthetics. Suíte de `effectsEngine` inalterada e verde.
- **Prova visual (print)**: Sem UI. Coberta por ALQ-F4-17.
- **Spec/REQ**: REQ-SYS-089, `REQ-SYS-149..150`
- **Tamanho**: M
- **Onda**: 1
- **Lote e2e**: L2

### ALQ-F4-03 — Regressão sobre packs: snapshot de derivação das classes publicadas

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/__tests__/helpers/classBuildHarness.ts` (reuso), novo `systems/pf2e/src/__tests__/rule-elements-regression.test.ts` + `__snapshots__`
- **Entrega**: Linha de base **antes** da ALQ-F2-08: cada classe nos níveis 1/5/10/15/20 com escolhas default, snapshot de `system.derived`. Segundo teste: habilitar handler X só altera atores com `kind` X. Remedir as classes quando o #57 entrar (ALQ-F0-02).
- **Depende de**: —
- **Paralelo com**: ALQ-F0-01, ALQ-F1-01, ALQ-F2-02, ALQ-F2-17, ALQ-F4-02
- **Modelo / esforço**: sonnet / high — harness grande, determinístico e rápido (fork pool).
- **Teste (TDD)**: O snapshot; o teste de escopo falha de propósito ao registrar um handler `roll-note` falso que muda Fighter, e passa com o handler real.
- **Prova visual (print)**: Sem UI. Relatório do diff no corpo de cada PR de handler.
- **Spec/REQ**: `REQ-SYS-149` (aceite "handler novo não regride classe publicada")
- **Tamanho**: M
- **Onda**: 1
- **Lote e2e**: L2

### ALQ-F4-04 — Importer: converter os tipos com semântica própria

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/transform.mjs` (`convertAdjustModifier:485`, `convertItemAlteration:455`, `convertActiveEffectLike:240`, `convertRuleElement:566`), testes, packs regenerados
- **Entrega**: `AdjustModifier` → `kind:"adjust-modifier"` (não mais `flat-modifier`; hoje Weapon Specialization soma +3 e +4); novos `adjust-degree-of-success`, `damage-alteration`, `adjust-strike`; `item-alteration` completo. Packs regenerados (extract + transform frescos) e `build-report.json` atualizado.
- **Depende de**: —
- **Paralelo com**: ALQ-F3-06, ALQ-F3-09, ALQ-F4-09, ALQ-F3-04, ALQ-F6-03
- **Modelo / esforço**: sonnet / medium — mapeamento de dado com teste.
- **Teste (TDD)**: `transform.test`: Weapon Specialization gera 2 `adjust-modifier` `mode:"upgrade"` e **nenhum** `flat-modifier`; Chemical Hardiness → `adjust-degree-of-success{selector:"fortitude", adjustment:{success:"one-degree-better"}}`; 0 `AdjustDegreeOfSuccess` em `unconvertedRules`.
- **Prova visual (print)**: Sem UI. Coberta por F4-12/F4-13.
- **Spec/REQ**: spec 16 (nota de mapeamento)
- **Tamanho**: M
- **Onda**: 10
- **Lote e2e**: L2
- **Decisão**: D-14 (decidido: motor genérico; AdjustDegreeOfSuccess ligado para todas as classes)

### ALQ-F4-19 — Migrar os scanners antigos (`embeddedModifiers`, `itemAlterations`) para o registro

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/embeddedModifiers.ts` (`RULE_CARRYING_EMBEDDED_TYPES`, scan de `flat-modifier`), `derivations/itemAlterations.ts` (`damage-dice-faces upgrade`), `derivations/equipment.ts:238-244`; handlers `flat-modifier` e `item-alteration` no `RuleElementRegistry`
- **Entrega**: Os dois scanners avulsos viram handlers do registro com comportamento idêntico, e os call sites passam a ler do motor (D-10). Com isso a ALQ-F2-08 materializa todas as regras sem risco de contagem dupla. Os scanners saem do código, não ficam em paralelo.
- **Depende de**: ALQ-F4-02, ALQ-F4-03
- **Paralelo com**: ALQ-F0-02, ALQ-F1-02, ALQ-F1-03, ALQ-F2-01, ALQ-F2-03
- **Modelo / esforço**: sonnet / high — troca de caminho de derivação coberta pela regressão sobre packs.
- **Teste (TDD)**: `rule-elements-regression.test.ts` (ALQ-F4-03) com snapshot **idêntico** antes e depois para todas as classes publicadas; `embeddedModifiers.test.ts` e o teste de Powerful Fist (#33) reescritos contra o handler e verdes; grep de teste garante que `collectEmbeddedModifiers` não é mais importado pelas derivações.
- **Prova visual (print)**: Sem UI. Coberta por ALQ-F4-17 (painel lista `flat-modifier` como aplicado pelo registro).
- **Spec/REQ**: emenda REQ-SYS-082 (na ALQ-F4-01)
- **Tamanho**: M
- **Onda**: 2
- **Lote e2e**: L2
- **Decisão**: D-10 (decidido: scanners antigos migram agora para o registro)

### ALQ-F4-06 — AEL (`set-property`) na fase pre-base

- **Repo**: ambos
- **Onde**: handler `set-property` no registro; `derive-runner.ts` (overlay antes de `baseSteps`); `derivations/character.ts` (rank via overlay); avaliador `resourceFormula.ts` (REQ-SYS-087)
- **Entrega**: Modos `upgrade/downgrade/override/add/multiply` em overlay efêmero com allowlist; Alchemical Weapon Expertise eleva `system.proficiencies.attacks["weapon-base-alchemical-bomb"].rank` para expert; Efficient Alchemy calcula `maxSlots`; nada gravado na fonte.
- **Depende de**: ALQ-F4-02, ALQ-F2-08, ALQ-F0-08, ALQ-F3-02, ALQ-F4-01
- **Paralelo com**: ALQ-F1-11, ALQ-F3-08, ALQ-F3-03, ALQ-F5-01, ALQ-F4-07
- **Modelo / esforço**: sonnet / high — ordem do pipeline de derivação do core.
- **Teste (TDD)**: `ael.test.ts`: Alquimista nível 7 com Alchemical Weapon Expertise → ataque de bomba = mod + nível + 4 (expert); `upgrade` menor não rebaixa; `system.details.alliance` → unsupported log; após `doc:update` a fonte não tem o rank 2.
- **Prova visual (print)**: Ficha do Alquimista nível 7 (player), aba Ações: strike de bomba "Especialista" com bônus correto e tooltip do breakdown.
- **Spec/REQ**: `REQ-SYS-151`
- **Tamanho**: M
- **Onda**: 8
- **Lote e2e**: L2

### ALQ-F4-07 — ROLL-OPTION completo: toggles persistidos e validados

- **Repo**: ambos
- **Onde**: handler `roll-option` (toggleable, domain, sub-opções); `packages/server/src/net/handlers/doc-handlers.ts` (validação de `flags.fusion.toggles`)
- **Entrega**: Opção `toggleable` só ativa com `item.flags.fusion.toggles[option] === true`; sub-seleção em `toggleSelections`. Dono do ator ou GM alteram sem aprovação (D-11). Não-toggleable segue automática.
- **Depende de**: ALQ-F2-08, ALQ-F4-02, ALQ-F4-01
- **Paralelo com**: ALQ-F1-11, ALQ-F3-08, ALQ-F3-03, ALQ-F5-01, ALQ-F4-06
- **Modelo / esforço**: sonnet / high — server + sistema + permissão.
- **Teste (TDD)**: `roll-option-toggles.test.ts` (server, helpers/ports): dono liga `expanded-splash` → `synthetics` contém a opção; não-dono → erro de permissão; a nota de Expanded Splash só resolve com toggle ligado.
- **Prova visual (print)**: Coberta por ALQ-F4-08.
- **Spec/REQ**: `REQ-PF2-229`
- **Tamanho**: M
- **Onda**: 8
- **Lote e2e**: L2
- **Decisão**: D-11 (decidido: jogador liga roll option no próprio ator)

### ALQ-F4-08 — UI de toggles de roll option na ficha

- **Repo**: satélite
- **Onde**: novo `components/sheets/pf2e/actions/RollOptionToggle.svelte` + `rollOptionTogglesVM.ts`, montados no bloco de strikes de `CharacterSheet.svelte`
- **Entrega**: Seção "Opções de ataque" com interruptor por roll option toggleable (rótulo pt-BR, item de origem) e seletor de sub-opção (field vials, material). Ligar muda bônus/nota na hora.
- **Depende de**: ALQ-F4-07
- **Paralelo com**: ALQ-F4-10, ALQ-F4-16, ALQ-F5-02, ALQ-F5-06, ALQ-F6-02
- **Modelo / esforço**: sonnet / medium — componente + VM (PROCESSO-UI).
- **Teste (TDD)**: `rollOptionToggles.vm.test.ts`: lista `expanded-splash`, `directional-bombs` no build de teste e emite update no path certo.
- **Prova visual (print)**: Player com Alquimista Bombardeiro liga "Respingo Ampliado"; interruptor ligado e o card de ataque seguinte com a nota. Smoke GM.
- **Spec/REQ**: `REQ-PF2-229`
- **Tamanho**: M
- **Onda**: 12
- **Lote e2e**: L2
- **Decisão**: D-11 (decidido: jogador liga roll option no próprio ator)

### ALQ-F4-09 — `RollNotes` + `onRollResolved`: contexto de rolagem resolvido no servidor

- **Repo**: ambos
- **Onde**: `packages/server/src/chat/chat-handler.ts` (após `computeSaveDegree`/`computeAttackDegree` ≈481-525), `net/redaction.ts`, `engine-2e` `resolveNotesForSelector` (filtro `outcome`), `characterSheetVM.ts` (`rollStrike`/`rollSave`/`rollSkill` enviam `flags.fusion.rollContext`); `system-api` hook `onRollResolved`
- **Entrega**: Server re-deriva o ator, resolve notas dos selectors contra options do ator e do alvo, filtra por grau e grava `flags.fusion.rollNotes`; blind/privada seguem a redação do resultado. Emite `onRollResolved({message, rollContext, degree, targets})` para sistemas (splash, veneno, reações).
- **Depende de**: ALQ-F2-08, ALQ-F4-02, ALQ-F4-01
- **Paralelo com**: ALQ-F3-06, ALQ-F3-09, ALQ-F4-04, ALQ-F3-04, ALQ-F6-03
- **Modelo / esforço**: sonnet / high — chat-handler autoritativo + redação + sistema.
- **Teste (TDD)**: `chat-roll-notes.test.ts`: ataque de bomba com Expanded Splash ligado → nota em sucesso e crítico, ausente em falha; `rollNotes` forjados pelo cliente ignorados; blind não vaza nota; `onRollResolved` recebe o grau calculado no servidor.
- **Prova visual (print)**: Coberta por ALQ-F4-10.
- **Spec/REQ**: `REQ-SYS-152`, `REQ-PF2-230`
- **Tamanho**: M
- **Onda**: 10
- **Lote e2e**: L2

### ALQ-F4-10 — Notas visíveis no card de rolagem

- **Repo**: ambos
- **Onde**: core `packages/client/src/components/chat/ChatCard.svelte`; satélite `AbilityCard.svelte`, `abilityCardVM.ts`
- **Entrega**: Bloco "Notas": título (item de origem), texto pt-BR e marca do grau. Sem texto curado mostra só o título.
- **Depende de**: ALQ-F4-09, ALQ-F4-11
- **Paralelo com**: ALQ-F4-16, ALQ-F4-08, ALQ-F5-02, ALQ-F5-06, ALQ-F6-02
- **Modelo / esforço**: sonnet / medium — UI com VM.
- **Teste (TDD)**: `abilityCardVM.test.ts`: 2 notas → 2 entradas em ordem de prioridade; sem notas → sem bloco.
- **Prova visual (print)**: Chat do player após bomba com acerto: card com a nota "Respingo Ampliado" e texto; o mesmo lance em falha sem a nota (lado a lado).
- **Spec/REQ**: `REQ-PF2-230`, emenda 38
- **Tamanho**: P
- **Onda**: 12
- **Lote e2e**: L2

### ALQ-F4-11 — Curadoria pt-BR dos textos de nota do Alquimista

- **Repo**: satélite
- **Onde**: novo `tools/importer-pf2e/curation/note-texts.mjs`, `transform.mjs` (overlay)
- **Entrega**: Texto pt-BR escrito do zero (clean-room) para as 19 notas do Alquimista, chave `sourceId` + índice.
- **Depende de**: —
- **Paralelo com**: ALQ-F3-10, ALQ-F3-13, ALQ-F4-13, ALQ-F4-14, ALQ-F4-12
- **Modelo / esforço**: haiku / low — texto de dado.
- **Teste (TDD)**: `note-texts.test.mjs`: toda chave aponta para doc/regra existente `kind:"roll-note"`; nenhuma nota do Alquimista com `text:""`.
- **Prova visual (print)**: Coberta por ALQ-F4-10.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 11
- **Lote e2e**: L2

### ALQ-F4-12 — MOD-ADJUST (`adjust-modifier`) na resolução

- **Repo**: satélite
- **Onde**: handler no registro (synthetics), `engine-2e/src/effectsEngine.ts` `resolveModifiersForSelector`, `modifierStacking.ts`
- **Entrega**: Ajustes por `slug` + selector antes do stacking; modos `upgrade/downgrade/override/add/subtract/remove`; valor-expressão.
- **Depende de**: ALQ-F4-04, ALQ-F4-19, ALQ-F2-08, ALQ-F4-01
- **Paralelo com**: ALQ-F3-10, ALQ-F3-13, ALQ-F4-11, ALQ-F4-13, ALQ-F4-14
- **Modelo / esforço**: sonnet / medium — lógica pura com testes.
- **Teste (TDD)**: `adjustModifier.test.ts`: Weapon Specialization mestre → modificador 3 (não 3+4), lendário → 4; Calculated Splash eleva splash ao mod de INT só se maior.
- **Prova visual (print)**: Ficha do Alquimista nível 7 (player): breakdown do dano de bomba com "Especialização em Arma +X" uma vez só.
- **Spec/REQ**: emenda REQ-SYS-082
- **Tamanho**: P
- **Onda**: 11
- **Lote e2e**: L2

### ALQ-F4-13 — DOS-ADJUST no grau autoritativo do servidor

- **Repo**: ambos
- **Onde**: handler `adjust-degree-of-success`; `packages/server/src/chat/chat-handler.ts` (`computeSaveDegree`, `computeAttackDegree`); `engine-2e/src/degreesOfSuccess.ts`
- **Entrega**: Após graduar, aplica ajustes do selector e grava `degreeAdjustment {from, to, source}`; card mostra "Sucesso → Sucesso crítico (Resistência Química)". Ligado para todas as classes com a regressão (D-14).
- **Depende de**: ALQ-F4-04, ALQ-F4-09, ALQ-F4-01
- **Paralelo com**: ALQ-F3-10, ALQ-F3-13, ALQ-F4-11, ALQ-F4-14, ALQ-F4-12
- **Modelo / esforço**: sonnet / high — grau autoritativo e 98 regras de outras classes.
- **Teste (TDD)**: `dos-adjust.test.ts`: Chemical Hardiness → Fortitude sucesso vira crítico; falha continua; Resist Magic sem trait arcane não ajusta; snapshot F4-03 só muda atores com a regra.
- **Prova visual (print)**: Chat do player: save de Fortitude com "Sucesso → Sucesso crítico" e a origem.
- **Spec/REQ**: emenda REQ-SYS-082, REQ-SYS-088
- **Tamanho**: M
- **Onda**: 11
- **Lote e2e**: L2
- **Decisão**: D-14 (decidido: motor genérico; AdjustDegreeOfSuccess ligado para todas as classes)

### ALQ-F4-14 — ITEM-ALTER genérico

- **Repo**: satélite
- **Onde**: `engine-2e/src/itemAlteration.ts`, `systems/pf2e/src/derivations/itemAlterations.ts`, `derivations/equipment.ts:238-244`
- **Entrega**: Propriedades `damage-type`, `traits`, `other-tags`, `damage-dice-faces` (com predicado), `frequency-max`, `range-increment`; predicado contra opções do item-alvo e do ator; valor `{item|flags.system.rulesSelections.x}` resolvido.
- **Depende de**: ALQ-F4-04, ALQ-F4-19, ALQ-F2-08, ALQ-F0-07, ALQ-F4-01
- **Paralelo com**: ALQ-F3-10, ALQ-F3-13, ALQ-F4-11, ALQ-F4-13, ALQ-F4-12
- **Modelo / esforço**: sonnet / high — generaliza o handler migrado com risco em 381 regras.
- **Teste (TDD)**: `itemAlterations.test.ts`: Toxicologist → vial perde `acid`, ganha `poison`, dano vira veneno; Powerful Fist continua d6 (regressão #33); Deadly Simplicity sem predicado não altera.
- **Prova visual (print)**: Ficha do Toxicologista (player): frasco versátil com traço "veneno" e "1d6 veneno".
- **Spec/REQ**: emenda REQ-SYS-082
- **Tamanho**: M
- **Onda**: 11
- **Lote e2e**: L2

### ALQ-F4-15 — DAMAGE-ALT e DamageDice condicional na montagem do dano

- **Repo**: satélite
- **Onde**: handlers `damage-alteration` e `flat-modifier/damage-dice`, `systems/pf2e/src/actions/strikes.ts` (`computeStrikeDamage:412`), `characterSheetVM.ts` (`rollStrikeDamage`)
- **Entrega**: Instâncias recebem dados extras e alterações conforme opções da rolagem (alvo off-guard, toggle); fórmula final vem do servidor com o `rollContext`.
- **Depende de**: ALQ-F4-09, ALQ-F4-14, ALQ-F4-01
- **Paralelo com**: ALQ-F4-17, ALQ-F6-04, ALQ-F5-03, ALQ-F5-10, ALQ-F5-11
- **Modelo / esforço**: sonnet / medium — padrão com teste.
- **Teste (TDD)**: `damageAlteration.test.ts`: Sneak Attack com alvo off-guard +1d4 precisão; Toxicologist troca tipo da bomba infusa para veneno só com toggle.
- **Prova visual (print)**: Card de dano de bomba (player) com tipo alterado e instância extra no breakdown.
- **Spec/REQ**: emenda REQ-SYS-082
- **Tamanho**: M
- **Onda**: 13
- **Lote e2e**: L2

### ALQ-F4-16 — STRIKE-MOD (`adjust-strike`)

- **Repo**: satélite
- **Onde**: handler fase `strike`, `actions/strikes.ts` (`deriveStrikeFromWeapon:224`), strike de item (ItemStrike)
- **Entrega**: `definition` + `property` `range-increment`/`traits`/`weapon-traits`/`materials`, depois do ITEM-ALTER. Far Lobber: 30 pés; Uncanny Bombs: 60 pés.
- **Depende de**: ALQ-F4-04, ALQ-F4-14, ALQ-F2-13, ALQ-F4-01
- **Paralelo com**: ALQ-F4-10, ALQ-F4-08, ALQ-F5-02, ALQ-F5-06, ALQ-F6-02
- **Modelo / esforço**: sonnet / medium — escopo contido.
- **Teste (TDD)**: `adjustStrike.test.ts`: bomba 20 → 30 com Far Lobber; + Uncanny Bombs → 60 (upgrade pega o maior); não-bomba inalterada.
- **Prova visual (print)**: Aba Ações do Alquimista (player): strike de bomba "Incremento 30 pés".
- **Spec/REQ**: emenda REQ-SYS-082
- **Tamanho**: P
- **Onda**: 12
- **Lote e2e**: L2

### ALQ-F4-17 — Painel "Regras do personagem" (visibilidade do motor)

- **Repo**: ambos
- **Onde**: core `derive-runner.ts` (grava `system.derived.ruleLog` resumido); satélite novo `RulesDebugPanel.svelte` montado na ficha
- **Entrega**: Lista por item as regras aplicadas (fase, efeito) e as não suportadas (tipo, motivo). Visível para GM e dono.
- **Depende de**: ALQ-F4-02, ALQ-F2-08
- **Paralelo com**: ALQ-F4-15, ALQ-F6-04, ALQ-F5-03, ALQ-F5-10, ALQ-F5-11
- **Modelo / esforço**: sonnet / medium — UI de leitura sobre dado pronto.
- **Teste (TDD)**: `rulesDebugVM.test.ts`: Alquimista Bombardeiro lista `set-property` aplicado e `CraftingAbility` não suportado.
- **Prova visual (print)**: GM abre a ficha do Alquimista → "aplicadas: N / não suportadas: M" com Alchemical Weapon Expertise e CraftingAbility.
- **Spec/REQ**: `REQ-SYS-149` (diagnóstico)
- **Tamanho**: P
- **Onda**: 13
- **Lote e2e**: L2

### ALQ-F4-18 — Roteiro tutorial-e2e da F4 + bump de pin + spec:report

- **Repo**: ambos
- **Onde**: `docs/design/alquimista/e2e/alq-f4.html`, pin `external/fusion-systems-2e`
- **Entrega**: Um print por tarefa F4 com UI (06, 08, 10, 12, 13, 14, 15, 16, 17), smoke GM + player, exportar progresso.
- **Depende de**: ALQ-F4-06, ALQ-F4-08, ALQ-F4-10, ALQ-F4-12, ALQ-F4-13, ALQ-F4-14, ALQ-F4-15, ALQ-F4-16, ALQ-F4-17
- **Paralelo com**: ALQ-F3-14
- **Modelo / esforço**: sonnet / medium — julgamento de olhar prints (subido de haiku para alinhar aos outros roteiros).
- **Teste (TDD)**: Suíte completa verde antes do push; `pnpm spec:report`.
- **Prova visual (print)**: Os prints listados.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: faixa de lote após a onda 13 (só leitura, fora do teto)
- **Lote e2e**: L2

### F5 — Bombas

### ALQ-F5-01 — Spec: bombas (splash, persistente, área, material, flat checks)

- **Repo**: core
- **Onde**: `specs/17-sistema-pf2e.md` (REQ-PF2-055/061), `specs/06-canvas-e-renderizacao.md` (preview efêmero), `specs/10-combate-e-iniciativa.md` (hook de fim de turno)
- **Entrega**: REQs de splash (remaster), dano persistente multi-instância com assistência, `AreaTargets` e preview (D-12), material em strike, auto-sucesso vs concealed, flat check com dano ao consumir; persistente automático também em NPC (D-13). REQ-PF2-055 (persistente) sai de [V2].
- **Depende de**: —
- **Paralelo com**: ALQ-F1-11, ALQ-F3-08, ALQ-F3-03, ALQ-F4-07, ALQ-F4-06
- **Modelo / esforço**: sonnet / high — normativo citando contratos F1/F2.
- **Teste (TDD)**: `spec-lint` verde.
- **Prova visual (print)**: Sem UI. Coberta pelos prints F5.
- **Spec/REQ**: emenda REQ-PF2-055/061; `REQ-PF2-231..235`; `REQ-CNV-095..096`
- **Tamanho**: M
- **Onda**: 8
- **Lote e2e**: L3
- **Decisão**: D-12 (decidido: prévia de área visível para todos); D-13 (decidido: persistente no fim de cada turno do portador + flat check DC 15, PC e NPC)

### ALQ-F5-02 — `PersistentDamage`: condição multi-instância

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/conditions.ts:402`, `actions/conditions-manager.ts` (`applyCondition:105`), schema de condição em `systems/pf2e/src/schemas`
- **Entrega**: `persistent-damage` com `system.instances[]` `{damageType, formula, dc, assisted}` via `ApplyCondition{mode:"add", data}`; mesmo tipo mantém a maior média; tipos diferentes coexistem; imunidade ao tipo impede.
- **Depende de**: ALQ-F5-01, ALQ-F1-07
- **Paralelo com**: ALQ-F4-10, ALQ-F4-16, ALQ-F4-08, ALQ-F5-06, ALQ-F6-02
- **Modelo / esforço**: sonnet / high — schema de condição usado por ficha, token e combate.
- **Teste (TDD)**: `persistent-damage.test.ts`: 1d6 fogo sobre 2d4 fogo mantém 2d4 (5 > 3,5); 1d6 ácido coexiste; imune a fogo não recebe.
- **Prova visual (print)**: Coberta por ALQ-F5-04.
- **Spec/REQ**: `REQ-PF2-232`
- **Tamanho**: M
- **Onda**: 12
- **Lote e2e**: L3

### ALQ-F5-03 — `PersistentDamage`: fim de turno, dano e recuperação

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/hooks/persistent-damage.ts` (`pf2e.persistentDamage` em `onTurnEnd`, linha em `index.ts`); card actions `persistent:recover`/`persistent:assist` via `registerCardAction`
- **Entrega**: Pela condição Persistent Damage (remaster): **no fim de cada turno de quem a tem** (`onTurnEnd`, nunca `turnStart`), o servidor rola cada instância, aplica via `ctx.applyDamage` e em seguida rola **automaticamente** o flat check DC 15 (10 se assistido); sucesso remove a instância. O card mostra dano e check, com o botão "Assistência" para a próxima vez. Automático para jogadores e NPCs (D-13).
- **Depende de**: ALQ-F5-02, ALQ-F1-04, ALQ-F1-08
- **Paralelo com**: ALQ-F4-15, ALQ-F4-17, ALQ-F6-04, ALQ-F5-10, ALQ-F5-11
- **Modelo / esforço**: sonnet / high — combate + chat + dano autoritativos.
- **Teste (TDD)**: `persistent-damage-turn.test.ts` (RNG semeado, TurnHookContext real sobre servidor de teste com porta dinâmica): o hook está registrado em `onTurnEnd`; fim do turno reduz PV pelo rolado menos resistência e só depois rola o flat check; 15+ remove; 14 mantém; assistido com 10 remove; não dispara no turno de outro nem no `turnStart`; PC e NPC recebem igual.
- **Prova visual (print)**: Combate com NPC em chamas: fim do turno dele gera card "Dano persistente 1d6 fogo: 4 · teste de recuperação 17 — recuperado" e a condição some do token (GM).
- **Spec/REQ**: REQ-PF2-061, `REQ-PF2-232`
- **Tamanho**: M
- **Onda**: 13
- **Lote e2e**: L3
- **Decisão**: D-13 (decidido: persistente no fim de cada turno do portador + flat check DC 15, PC e NPC)

### ALQ-F5-04 — UI de dano persistente (ficha, token, aba Combate)

- **Repo**: ambos
- **Onde**: satélite: chips de condição na ficha (componente de condições da F1-11) e `npcSheetVM.ts`; core: ícone no token (`packages/client/src/lib/canvas/tokens`)
- **Entrega**: Condição mostra "Persistente 1d6 fogo (CD 15)" por instância; o menu "+ Condição" (F1-11) ganha tipo/fórmula para o GM aplicar à mão (gatilho real antes das bombas).
- **Depende de**: ALQ-F5-02, ALQ-F1-11
- **Paralelo com**: ALQ-F5-08, ALQ-F6-12, ALQ-F6-17, ALQ-F6-09, ALQ-F7-01
- **Modelo / esforço**: sonnet / medium — UI padrão com VM.
- **Teste (TDD)**: `persistentChip.vm.test.ts`: duas instâncias → dois chips pt-BR; remover uma mantém a outra.
- **Prova visual (print)**: GM aplica "1d6 fogo" num goblin pelo menu; chip na ficha e ícone no token; player vê o chip do próprio personagem.
- **Spec/REQ**: `REQ-PF2-232`
- **Tamanho**: P
- **Onda**: 15
- **Lote e2e**: L3

### ALQ-F5-05 — `AreaTargets`: resolvedor puro

- **Repo**: core
- **Onde**: novo `packages/shared/src/area/areaTargets.ts` (parte pura extraída de `client/src/lib/canvas/sceneCoords.ts`/`GridRenderer.ts`), `honeycomb-grid` para hex
- **Entrega**: `resolveAreaTargets(scene, tokens, query)` para `adjacent`, `burst`, `emanation`, `cone` em grade quadrada, hex e gridless. Mesma função no servidor e no client.
- **Depende de**: ALQ-F5-01
- **Paralelo com**: ALQ-F3-05, ALQ-F3-11, ALQ-F2-07, ALQ-F3-12, ALQ-F6-01
- **Modelo / esforço**: opus / high — contrato geométrico transversal; erro vira dano no alvo errado.
- **Teste (TDD)**: `areaTargets.test.ts`: quadrada 5 pés — adjacentes de Médio = 8 casas; Grande adjacente por 1 casa entra; emanação 10 pés com diagonal 5-10-5; cone 15 pés a 90° cobre as casas da regra.
- **Prova visual (print)**: Coberta por ALQ-F5-06.
- **Spec/REQ**: `REQ-CNV-095`, `REQ-PF2-231`
- **Tamanho**: M
- **Onda**: 9
- **Lote e2e**: L3

### ALQ-F5-06 — Prévia de área e confirmação de alvos

- **Repo**: core
- **Onde**: `packages/client/src/lib/canvas/FusionCanvas.ts:430` (`layer:templates`), novo `client/src/lib/canvas/area/AreaPreview.ts`, `setMyTargets` (F1-05)
- **Entrega**: Ao iniciar ação com área, o canvas destaca casas e tokens; confirmar vira seleção múltipla; cancelar limpa. A prévia é **visível para todos** na cena (D-12), por broadcast efêmero. Nada persistido.
- **Depende de**: ALQ-F5-05, ALQ-F1-05
- **Paralelo com**: ALQ-F4-10, ALQ-F4-16, ALQ-F4-08, ALQ-F5-02, ALQ-F6-02
- **Modelo / esforço**: sonnet / medium — PIXI + store existente.
- **Teste (TDD)**: `areaPreview.test.ts`: N highlights = resultado do resolvedor; cancelar remove os filhos da layer em todos os clientes; o broadcast da prévia chega a todos os usuários da cena e não grava documento.
- **Prova visual (print)**: Player mira bomba num goblin: casas adjacentes destacadas e 3 tokens marcados; na tela de **outro player** e do GM a mesma prévia aparece.
- **Spec/REQ**: `REQ-CNV-096`
- **Tamanho**: M
- **Onda**: 12
- **Lote e2e**: L3
- **Decisão**: D-12 (decidido: prévia de área visível para todos)

### ALQ-F5-07 — `SplashDamage`: plano por grau e aplicação em alvo + adjacentes

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/actions/strikes.ts` (novo `computeSplash`, `buildStrikeChatCard:574`), `AbilityCard.svelte` ("Aplicar respingo"), hook `onRollResolved`
- **Entrega**: Strike com `splash`: acerto/crítico → alvo recebe inicial + respingo somados para IWR; falha → alvo e adjacentes só respingo; crítico não dobra respingo; falha crítica nada. Adjacentes via `AreaTargets`. Botão aplica em todos via `actor:applyDamage` (player aplica, D-02).
- **Depende de**: ALQ-F5-05, ALQ-F1-10, ALQ-F2-14, ALQ-F4-09
- **Paralelo com**: ALQ-F6-08, ALQ-F6-11, ALQ-F5-09, ALQ-F6-05, ALQ-F6-21
- **Modelo / esforço**: sonnet / high — regra de bordas cruzando strike, dano e área.
- **Teste (TDD)**: `splash.test.ts`: bomba moderada (2d8 + 2 respingo): acerto → 2d8+2 com resist. 5 aplicada uma vez; falha → alvo e adjacentes 2; crítico → 4d8+2; falha crítica → vazio.
- **Prova visual (print)**: Player erra a bomba: card "Falha — respingo 2 fogo em 3 criaturas"; após aplicar, PV dos 3 tokens menor (GM).
- **Spec/REQ**: `REQ-PF2-231`
- **Tamanho**: M
- **Onda**: 14
- **Lote e2e**: L3
- **Decisão**: D-02 (decidido: jogador aplica o dano em todos os alvos da ação (foto na rolagem))

### ALQ-F5-08 — Talentos de respingo: Expanded, Calculated, Directional, Field Bomber

- **Repo**: satélite
- **Onde**: `computeSplash` (raio e forma parametrizados) em novo `actions/splash-feats.ts`; handlers da F4
- **Entrega**: Expanded Splash amplia para 10 pés e soma INT; Calculated Splash eleva ao mod de INT; Directional Bombs troca por cone de 15 pés; notas no card.
- **Depende de**: ALQ-F5-07, ALQ-F4-07, ALQ-F4-12, ALQ-F5-06
- **Paralelo com**: ALQ-F5-04, ALQ-F6-12, ALQ-F6-17, ALQ-F6-09, ALQ-F7-01
- **Modelo / esforço**: sonnet / medium — composição de peças prontas.
- **Teste (TDD)**: `splash-feats.test.ts`: Expanded ligado → burst 10 e respingo base + INT; Directional → alvos em cone, não no anel.
- **Prova visual (print)**: Player liga "Respingo Ampliado": prévia com raio de 10 pés e card "respingo 2+4".
- **Spec/REQ**: `REQ-PF2-231`
- **Tamanho**: P
- **Onda**: 15
- **Lote e2e**: L3

### ALQ-F5-09 — NEW-MATERIAL-GRADE: material precioso no frasco (Advanced Vials Bomber)

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/data/preciousMaterials.ts`, sub-seleção do toggle (F4-07), `adjust-strike` `materials` (F4-16), instância com `materials` no ApplyDamage
- **Entrega**: Jogador escolhe o material do dia; strikes de bomba carregam o material; IWR com exceção de material reage.
- **Depende de**: ALQ-F4-07, ALQ-F4-16, ALQ-F1-06
- **Paralelo com**: ALQ-F5-07, ALQ-F6-08, ALQ-F6-11, ALQ-F6-05, ALQ-F6-21
- **Modelo / esforço**: sonnet / medium — dado + ligação (tabela pode ir a haiku como subtarefa).
- **Teste (TDD)**: `materialGrade.test.ts`: ferro frio contra fraqueza 5 a ferro frio → +5; sem seleção nada; "exceto prata" não resiste a bomba de prata.
- **Prova visual (print)**: Seletor "Material: ferro frio" na ficha (player) e card no demônio com "fraqueza ferro frio +5" (GM).
- **Spec/REQ**: `REQ-PF2-233`
- **Tamanho**: M
- **Onda**: 14
- **Lote e2e**: L3

### ALQ-F5-10 — NEW-AUTO-SUCCESS-CONCEALED: flat check de ocultação

- **Repo**: ambos
- **Onde**: `packages/server/src/chat/chat-handler.ts` (antes de `computeAttackDegree`), opção `target:condition:concealed`, roll option de Uncanny Bombs
- **Entrega**: Ataque contra alvo `concealed` rola flat check DC 5 no servidor e mostra no card; falha anula. Com Uncanny Bombs e bomba: sucesso automático explicado.
- **Depende de**: ALQ-F4-09, ALQ-F1-05
- **Paralelo com**: ALQ-F4-15, ALQ-F4-17, ALQ-F6-04, ALQ-F5-03, ALQ-F5-11
- **Modelo / esforço**: sonnet / medium — lógica pequena no fluxo autoritativo.
- **Teste (TDD)**: `concealed-flat-check.test.ts`: RNG 4 contra concealed → ataque perdido; Uncanny Bombs + bomba → sem rolagem, "sucesso automático"; arma comum com o talento → rola.
- **Prova visual (print)**: Card de bomba contra goblin oculto: "Teste de ocultação: sucesso automático (Bombas Assombrosas)".
- **Spec/REQ**: `REQ-PF2-234`, REQ-PF2-052
- **Tamanho**: P
- **Onda**: 13
- **Lote e2e**: L3

### ALQ-F5-11 — NEW-FLAT-CHECK-DAMAGE: flat check com dano ao consumir (Unstable Concoction)

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/consume-hooks/unstable.ts` (`registerConsumeHook`), `ActorMechanicsService.applyDamage`
- **Entrega**: **Dono único do flat check de Unstable Concoction** (a F7-07 só faz o degrau de dado). Item com `flags.fusion.additive.slug === "unstable-concoction"` rola DC 10 ao ser consumido; falha → ácido = nível do item em quem ativou; card mostra check e dano.
- **Depende de**: ALQ-F2-11, ALQ-F1-08
- **Paralelo com**: ALQ-F4-15, ALQ-F4-17, ALQ-F6-04, ALQ-F5-03, ALQ-F5-10
- **Modelo / esforço**: sonnet / medium — composição sobre contratos.
- **Teste (TDD)**: `unstable-concoction.test.ts` (fixture com o carimbo do AdditiveHook): RNG 9 → ácido = nível no próprio ator; RNG 10 → nada.
- **Prova visual (print)**: Player consome elixir instável: card "Teste instável 7 — falha: 3 ácido" e PV menor na ficha.
- **Spec/REQ**: `REQ-PF2-235`
- **Tamanho**: P
- **Onda**: 13
- **Lote e2e**: L3

### ALQ-F5-12 — Roteiro tutorial-e2e da F5 + bump de pin

- **Repo**: ambos
- **Onde**: `docs/design/alquimista/e2e/alq-f5.html`
- **Entrega**: Um print por tarefa F5 com UI (03, 04, 06, 07, 08, 09, 10, 11), combate com 3 goblins, smoke GM + player, exportar progresso.
- **Depende de**: ALQ-F5-03, ALQ-F5-04, ALQ-F5-06, ALQ-F5-07, ALQ-F5-08, ALQ-F5-09, ALQ-F5-10, ALQ-F5-11
- **Paralelo com**: ALQ-F6-23, ALQ-F7-17
- **Modelo / esforço**: sonnet / medium — julgamento de olhar prints.
- **Teste (TDD)**: Suíte completa verde antes do push.
- **Prova visual (print)**: Os listados.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: faixa de lote após a onda 19 (só leitura, fora do teto)
- **Lote e2e**: L3

### F6 — Venenos e mutágenos

### ALQ-F6-01 — Spec nova `48-aflicoes-e-mutagenos.md` (AFL) + emenda da 17

- **Repo**: core
- **Onde**: `specs/48-aflicoes-e-mutagenos.md` (novo), `specs/17-sistema-pf2e.md` (`affliction` ⏳V2→MVP; REQ-PF2-086 parcial; REQ-PF2-043 no save de aflição), `specs/README.md` (prefixo `REQ-AFL-`)
- **Entrega**: Contratos `Affliction`, `PoisonDelivery`, `Mutagen`, `Counteract`, `SaveRequest`; regras remaster (graus→estágio, onset, duração máxima, virulent = dois sucessos seguidos, reexposição, limite de mutágeno do trait, faixas de counteract). Aplica D-05 (sem relógio: fora de combate o Mestre avança o estágio), D-16 (anotação de estado temporizado em vez de card automático) e D-17. Registra a **anotação de estado temporizado** como padrão de UI para estados com duração. Confere virulent/mutagen contra o texto dos traits no pack.
- **Depende de**: —
- **Paralelo com**: ALQ-F3-05, ALQ-F3-11, ALQ-F2-07, ALQ-F3-12, ALQ-F5-05
- **Modelo / esforço**: opus / high — contrato transversal consumido por F7 e SF2e.
- **Teste (TDD)**: `spec-lint` verde; `COBERTURA-MINIMA.json` com os REQ-AFL como pendentes de teste.
- **Prova visual (print)**: Sem UI. Coberta por F6-10/18/19.
- **Spec/REQ**: `REQ-AFL-001..0xx`; emenda 17
- **Tamanho**: M
- **Onda**: 9
- **Lote e2e**: L3
- **Decisão**: D-05 (decidido: sem relógio; expira no Descansar/preparação ou remoção manual; sem "passar tempo"); D-16 (decidido: sem card automático; anotação de estado temporizado no canto); D-17 (decidido: só o Mestre vê a DC do veneno)

### ALQ-F6-02 — Schema `AfflictionDefinition` e item type `affliction`

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/schemas/item-affliction.ts`, `schemas/item-equipment.ts` (`ConsumableSystemSchema.affliction?`), `schema-primitives.ts`, linha de registro em `index.ts`
- **Entrega**: Consumível de veneno aceita `system.affliction` (Zod); ator aceita embutido `affliction` com estado. Docs atuais continuam válidos.
- **Depende de**: ALQ-F6-01
- **Paralelo com**: ALQ-F4-10, ALQ-F4-16, ALQ-F4-08, ALQ-F5-02, ALQ-F5-06
- **Modelo / esforço**: sonnet / medium — schema Zod no padrão existente.
- **Teste (TDD)**: `schemas/__tests__/item-affliction.test.ts`: aceita Arsenic escrito à mão do texto (onset 10 min, 3 estágios de 1 min); rejeita estágio sem número e DC negativa.
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: REQ-AFL (schema)
- **Tamanho**: P
- **Onda**: 12
- **Lote e2e**: L3

### ALQ-F6-03 — Motor puro de progressão de aflição

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/afflictionEngine.ts`, `engine-2e/src/index.ts`
- **Entrega**: `exposeInitial`, `progressOnSave`, `advanceTime`, `mergeAfflictions`, `extendMaxDuration` puros: onset, graus (inicial CS/S não afeta, F → 1, CF → 2; seguintes CS −2, S −1, F +1, CF +2), estágio 0 encerra, teto, duração máxima, virulent, reexposição, "As stage N".
- **Depende de**: ALQ-F6-01
- **Paralelo com**: ALQ-F3-06, ALQ-F3-09, ALQ-F4-09, ALQ-F4-04, ALQ-F3-04
- **Modelo / esforço**: sonnet / high — regra densa, teste não circular.
- **Teste (TDD)**: `engine-2e/src/__tests__/afflictionEngine.test.ts` pela regra: CF no inicial → estágio 2; virulent: um sucesso não reduz, o segundo consecutivo reduz 1; após duração máxima termina mesmo no 3; nada antes do onset; `mergeAfflictions` usa menor DC, menos estágios e maior intervalo.
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: REQ-AFL (motor)
- **Tamanho**: M
- **Onda**: 10
- **Lote e2e**: L3

### ALQ-F6-04 — Revisão adversarial do motor de aflição

- **Repo**: satélite
- **Onde**: PR da ALQ-F6-03, `afflictionEngine.test.ts`
- **Entrega**: Relatório no PR com mutações (trocar +2 por +1 no CF; ignorar virulent) mostrando teste vermelho para cada uma, mais os casos faltantes adicionados. Antídoto da #48.
- **Depende de**: ALQ-F6-03
- **Paralelo com**: ALQ-F4-15, ALQ-F4-17, ALQ-F5-03, ALQ-F5-10, ALQ-F5-11
- **Modelo / esforço**: opus / high — revisão adversarial.
- **Teste (TDD)**: Mutação manual: cada mutante com ≥1 teste vermelho.
- **Prova visual (print)**: Sem UI.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 13
- **Lote e2e**: L3

### ALQ-F6-05 — Parser HTML → `system.affliction` no importer

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/transform.mjs` (chamada), novo `src/affliction-parser.mjs`, `src/__tests__/affliction-parser.test.mjs`
- **Entrega**: Preenche `system.affliction` em consumíveis `poison` (e `disease`): `@Check`, Onset, Maximum Duration, estágios com `@Damage` e `@UUID` de condição, condição em texto puro por dicionário, duração inline `[[/gmr 1d4 #hours]]` → `{formula}`, "As stage N". O que não fecha sai `provenance:"unparsed"` com relatório (medido: 58/72 parseáveis).
- **Depende de**: ALQ-F6-02, ALQ-F2-03
- **Paralelo com**: ALQ-F5-07, ALQ-F6-08, ALQ-F6-11, ALQ-F5-09, ALQ-F6-21
- **Modelo / esforço**: sonnet / medium — parser com fixtures calibradas.
- **Teste (TDD)**: Fixtures de Giant Centipede Venom, Arsenic e Black Smear Poison → estrutura escrita à mão a partir do texto; Lethargy Poison estágio 4 com `duration.formula === "1d4"` e `unit:"hour"`.
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: REQ-AFL (importação), spec 16
- **Tamanho**: M
- **Onda**: 14
- **Lote e2e**: L3

### ALQ-F6-06 — Curadoria dos venenos não parseáveis + gate 72/72

- **Repo**: satélite
- **Onde**: novo `tools/importer-pf2e/src/curation/afflictions.mjs` (padrão `disabled-rules.mjs`), teste de gate, regeneração do pack (extract + transform frescos)
- **Entrega**: Override manual dos ~14 restantes (Creeping Death, Unending Itch, Primal Pollen…) com efeito narrativo em `stage.text`; CI falha se veneno remaster ficar sem `system.affliction` válido.
- **Depende de**: ALQ-F6-05
- **Paralelo com**: ALQ-F6-14, ALQ-F6-18, ALQ-F6-10, ALQ-F7-06, ALQ-F7-05
- **Modelo / esforço**: sonnet / low — transcrição de regra sem desenho.
- **Teste (TDD)**: `__tests__/affliction-coverage.test.mjs`: 72/72 remaster com `provenance ∈ {parsed, curated}` e ≥1 estágio.
- **Prova visual (print)**: Coberta por ALQ-F6-10 (Unending Itch curado no compêndio).
- **Spec/REQ**: REQ-AFL (cobertura)
- **Tamanho**: P
- **Onda**: 16
- **Lote e2e**: L3

### ALQ-F6-07 — pt-BR dos textos de estágio e onset

- **Repo**: satélite
- **Onde**: `tools/translate-packs` (pack `alchemical-items-core`), labels "Estágio", "Início", "Duração máxima"
- **Entrega**: Card e ficha mostram estágio, onset e duração em pt-BR; `stage.text` curado traduzido.
- **Depende de**: ALQ-F6-06, ALQ-F2-07
- **Paralelo com**: ALQ-F6-13, ALQ-F6-19, ALQ-F6-22, ALQ-F7-02, ALQ-F7-08
- **Modelo / esforço**: haiku / low — tradução mecânica.
- **Teste (TDD)**: Cobertura i18n do translate-packs (0 chaves faltando).
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 17
- **Lote e2e**: L3

### ALQ-F6-08 — Exposição, save inicial e primitiva `SaveRequest`

- **Repo**: ambos
- **Onde**: satélite novo `systems/pf2e/src/actions/affliction.ts`; core: card action genérica `check:requestSave` via `registerCardAction` sobre o `checkContext.kind="save"` do `chat-handler.ts`, `net/redaction.ts`
- **Entrega**: `affliction:expose` cria card "Exposto a X" com "Rolar Fortitude" só para dono do alvo e Mestre; grau no servidor; em F/CF cria a instância (onset ou estágio 1/2), condições por `grantedConditions`, dano via ApplyDamage. DC por `resolveItemSaveDc` (F3-11) e **só o GM vê** (D-17). A primitiva `SaveRequest` (DC calculada no servidor, botão por alvo, redigida) é reusada por F6-20, F7-08 e F7-10.
- **Depende de**: ALQ-F6-02, ALQ-F6-03, ALQ-F1-09, ALQ-F3-11, ALQ-F4-09, ALQ-F6-04
- **Paralelo com**: ALQ-F5-07, ALQ-F6-11, ALQ-F5-09, ALQ-F6-05, ALQ-F6-21
- **Modelo / esforço**: sonnet / high — server + sistema + chat com permissão e redação.
- **Teste (TDD)**: `packages/server/src/__tests__/affliction-expose.test.ts` (helpers/ports): player sem ownership do alvo não rola; CF cria instância no estágio 2 com as condições do 2; payload do player sem `dc`; item infundido com Powerful Alchemy usa a Class DC.
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: REQ-AFL (exposição, SaveRequest, redação)
- **Tamanho**: M
- **Onda**: 14
- **Lote e2e**: L3
- **Decisão**: D-17 (decidido: só o Mestre vê a DC do veneno)

### ALQ-F6-09 — Progressão de estágio: contagem no turno e save disparado pela anotação

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/actions/affliction.ts`, novo `hooks/affliction-stage.ts` (`pf2e.afflictionStage` em `onTurnStart`, só contagem), card actions `affliction:rollStageSave` e `affliction:advanceStage` (GM)
- **Entrega**: **Sem card automático (D-16).** Em combate, o hook só decrementa `nextSaveIn` (em rodadas) no início do turno do afetado e marca o save como vencido. O save é disparado pela anotação/ficha (dono do afetado ou Mestre); o resultado aplica `progressOnSave`, troca condições, rola dano e encerra no 0 ou na duração máxima. Fora de combate não há relógio (D-05): o Mestre avança o estágio manualmente pela anotação, card ou ficha.
- **Depende de**: ALQ-F6-08, ALQ-F1-04
- **Paralelo com**: ALQ-F5-04, ALQ-F5-08, ALQ-F6-12, ALQ-F6-17, ALQ-F7-01
- **Modelo / esforço**: sonnet / high — ciclo de combate com contagem por estágio.
- **Teste (TDD)**: `affliction-progression.test.ts`: Giant Centipede estágio 1 com intervalo de 1 rodada → após o `turnStart` do afetado `nextSaveIn` = 0 e `saveDue:true`, **nenhuma** ChatMessage criada; rolar o save pela ação com sucesso leva ao 0 e remove clumsy/fatigued; `affliction:advanceStage` de player → `FORBIDDEN`, de GM → estágio +1 sem rolagem.
- **Prova visual (print)**: Coberta por ALQ-F6-10.
- **Spec/REQ**: REQ-AFL (progressão)
- **Tamanho**: M
- **Onda**: 15
- **Lote e2e**: L3
- **Decisão**: D-05 (decidido: sem relógio; expira no Descansar/preparação ou remoção manual; sem "passar tempo"); D-16 (decidido: sem card automático; anotação de estado temporizado no canto)

### ALQ-F6-10 — Anotação de estado temporizado (padrão novo) + UI de aflição

- **Repo**: ambos
- **Onde**: core: novo slot de HUD `packages/client/src/components/hud/TimedStateNotes.svelte` + registro `registerTimedStateProvider` em `system-api` (itens redigidos no servidor via `net/redaction.ts`); satélite: provider de aflição `sheets/pf2e/src/lib/sheets/pf2e/afflictions/afflictionNotesProvider.ts`, seção `afflictions/AfflictionsSection.svelte` montada em `CharacterSheet.svelte`
- **Entrega**: Padrão de UI para estados temporizados (D-16): pequena anotação persistente no canto da tela, visível **só para o Mestre e o afetado**, com veneno/doença, estágio atual, duração do estágio e quando vence o próximo save (em rodadas no combate; fora dele "o Mestre avança"). O save sai de um botão na própria anotação. Quando a duração do estágio não está estruturada, mostra só o texto do estágio. A ficha repete a lista; DC só para o GM (D-17). O provider é genérico, mas nesta tarefa só a aflição o usa.
- **Depende de**: ALQ-F6-08, ALQ-F6-09
- **Paralelo com**: ALQ-F6-06, ALQ-F6-14, ALQ-F6-18, ALQ-F7-06, ALQ-F7-05
- **Modelo / esforço**: sonnet / high — slot de HUD novo no core + redação por papel e estado vivo.
- **Teste (TDD)**: `client/__tests__/timed-state-notes.test.ts`: um terceiro player não recebe a anotação; o afetado e o GM recebem. `__tests__/afflictionVM.test.ts`: VM de player sem DC; `nextSaveIn: 2` → "save em 2 rodadas"; fora de combate → "o Mestre avança"; estágio sem `duration` → só `stage.text`; aflição encerrada some.
- **Prova visual (print)**: **Player afetado**: anotação no canto "Arsênico — Estágio 2/3 · 1 min por estágio · save em 3 rodadas", sem DC. **GM**: a mesma com DC 18 ("DC 19 (classe)" quando infundido) e botão "Avançar estágio". **Outro player**: tela sem a anotação.
- **Spec/REQ**: REQ-AFL (UI) + padrão de UI registrado na ALQ-F6-01
- **Tamanho**: M
- **Onda**: 16
- **Lote e2e**: L3
- **Decisão**: D-16 (decidido: sem card automático; anotação de estado temporizado no canto); D-17 (decidido: só o Mestre vê a DC do veneno)

### ALQ-F6-11 — Aplicar veneno de injeção em arma/munição

- **Repo**: ambos
- **Onde**: novo `systems/pf2e/src/actions/poison-delivery.ts` (`poison:apply`/`poison:clear`), `schemas/item-weapon.ts` (`appliedPoison?`), ação no inventário/strike (novo `inventory/PoisonApplyMenu.svelte`)
- **Entrega**: "Aplicar veneno…" em arma/munição: escolhe veneno `injury`, consome via `item:consume` e grava `appliedPoison`. Arma com selo na ficha e no strike. O custo em ações só é exibido (de `system.activation` quando existir), nunca contado.
- **Depende de**: ALQ-F6-02, ALQ-F2-11, ALQ-F2-13
- **Paralelo com**: ALQ-F5-07, ALQ-F6-08, ALQ-F5-09, ALQ-F6-05, ALQ-F6-21
- **Modelo / esforço**: sonnet / high — fluxo server + ficha com estado no item.
- **Teste (TDD)**: `server/__tests__/poison-apply.test.ts`: aplicar consome 1 e grava `appliedPoison.dc` igual à do veneno; `ingested` recusado em arma; sem ownership da arma → recusado.
- **Prova visual (print)**: **Player**: adaga com selo "Envenenada: Veneno de Centopeia Gigante" e o veneno com quantidade reduzida.
- **Spec/REQ**: REQ-AFL (injeção)
- **Tamanho**: M
- **Onda**: 14
- **Lote e2e**: L3

### ALQ-F6-12 — Entrega do veneno no acerto

- **Repo**: satélite
- **Onde**: `actions/poison-delivery.ts`, `onRollResolved` (F4-09), selector `affliction-initial-save` no `RuleElementRegistry`
- **Entrega**: Acerto (S/CS) com arma envenenada chama `affliction:expose` **mesmo com dano pós-IWR 0**; o contexto do save inicial carrega roll options do ataque.
- **Depende de**: ALQ-F6-08, ALQ-F6-11, ALQ-F4-09
- **Paralelo com**: ALQ-F5-04, ALQ-F5-08, ALQ-F6-17, ALQ-F6-09, ALQ-F7-01
- **Modelo / esforço**: sonnet / medium — hook num contrato pronto.
- **Teste (TDD)**: `poison-strike.test.ts`: alvo com resist. perfurante 10 e dano 6 recebe o card de exposição; errar não gasta o veneno; acerto gasta.
- **Prova visual (print)**: **GM** no chat: "Acerto, 0 de dano (resistência)" seguido de "Exposto a Veneno de Centopeia Gigante" com Fortitude.
- **Spec/REQ**: REQ-AFL (entrega no acerto)
- **Tamanho**: P
- **Onda**: 15
- **Lote e2e**: L3

### ALQ-F6-13 — Toxicologist: field benefit, field vials, advanced vials, GFD

- **Repo**: satélite
- **Onde**: `actions/poison-delivery.ts`, features Toxicologist (PR #57), `ActorResource`
- **Entrega**: (a) aplicar veneno custa 1 ação; (b) "Aplicar vial como veneno" soma dano do vial no 1º acerto e fica inerte no fim do turno; (c) Advanced Vials: persistente de veneno = respingo; (d) GFD: na falha do save inicial de veneno infundido próprio, "Espirrar em adjacente".
- **Depende de**: ALQ-F6-12, ALQ-F3-06, ALQ-F5-03, ALQ-F5-07
- **Paralelo com**: ALQ-F6-07, ALQ-F6-19, ALQ-F6-22, ALQ-F7-02, ALQ-F7-08
- **Modelo / esforço**: sonnet / medium — riders sobre contratos.
- **Teste (TDD)**: `toxicologist.test.ts`: custo 1 ação só com o field; vial aplicado expira no `turnEnd` do aplicador; GFD não oferece espirrar em veneno criado por outro.
- **Prova visual (print)**: **Player** Toxicologista: card de acerto "+1d6 veneno (frasco)" e, após a falha do alvo, "Espirrar em adjacente".
- **Spec/REQ**: REQ-AFL (Toxicologist)
- **Tamanho**: M
- **Onda**: 17
- **Lote e2e**: L3

### ALQ-F6-14 — Riders de veneno: Blowgun, Pinpoint, Sticky, Double Poison, Tenacious Toxins

- **Repo**: satélite
- **Onde**: `actions/poison-delivery.ts`, REs dos feats via `RuleElementRegistry`, `afflictionEngine.mergeAfflictions`/`extendMaxDuration`
- **Entrega**: Blowgun (G): crítico de zarabatana piora 1 grau o save inicial. Pinpoint (G): −2 circunstância se off-guard. Sticky Poison (A): flat check no servidor. Double Poison (G): funde. Tenacious Toxins (G): estende duração máxima.
- **Depende de**: ALQ-F6-12, ALQ-F4-13
- **Paralelo com**: ALQ-F6-06, ALQ-F6-18, ALQ-F6-10, ALQ-F7-06, ALQ-F7-05
- **Modelo / esforço**: sonnet / medium — cinco riders pequenos no mesmo módulo.
- **Teste (TDD)**: `poison-riders.test.ts`: falha vira falha crítica com Blowgun + crítico; sem off-guard sem −2; Tenacious: veneno de 6 rodadas com estágio de 1 → 7, com estágio de 4 → teto 12.
- **Prova visual (print)**: **GM**: card do save inicial com "−2 circunstância (Envenenador Preciso)" e "Falha → Falha crítica (Envenenador de Zarabatana)".
- **Spec/REQ**: REQ-AFL (riders)
- **Tamanho**: M
- **Onda**: 16
- **Lote e2e**: L3

### ALQ-F6-15 — Veneno sem strike: ingerido, contato e inalado

- **Repo**: satélite
- **Onde**: `actions/poison-delivery.ts` (`poison:expose`), ação no inventário, `AreaTargets` para inalado
- **Entrega**: "Expor alvo…" em ingested/contact: alvo pela foto `targetTokenIds`, consome e expõe. Inhaled: pede `AreaQuery` e expõe todos dentro. GM expõe sem ownership do item.
- **Depende de**: ALQ-F6-08, ALQ-F5-06, ALQ-F2-11
- **Paralelo com**: ALQ-F6-20, ALQ-F7-07, ALQ-F7-09, ALQ-F7-10, ALQ-F7-11
- **Modelo / esforço**: sonnet / medium — variação de entrada.
- **Teste (TDD)**: `poison-expose.test.ts`: player expõe com Arsênico que possui; sem o item → recusado; inalado em área com 3 tokens → 3 cards de save.
- **Prova visual (print)**: **Player**: menu do Arsênico com "Expor alvo…" → card "Arsênico: início em 10 minutos".
- **Spec/REQ**: REQ-AFL (entrega direta)
- **Tamanho**: P
- **Onda**: 18
- **Lote e2e**: L3

### ALQ-F6-17 — Mutágeno: partição benefício/desvantagem

- **Repo**: satélite
- **Onde**: `schemas/item-effect.ts` (`mutagen?`), `tools/importer-pf2e/src/transform.mjs` + novo `curation/mutagen-partition.mjs`, pack `equipment-effects-core`
- **Entrega**: Todo `Effect: * Mutagen *` com `system.mutagen.{benefitRules, drawbackRules}` por heurística (sinal do modifier; Strike/ItemAlteration = benefício) + override curado (Quicksilver, Juggernaut, Bestial). Gate: ≥1 desvantagem.
- **Depende de**: ALQ-F6-01, ALQ-F2-02, ALQ-F2-08
- **Paralelo com**: ALQ-F5-04, ALQ-F5-08, ALQ-F6-12, ALQ-F6-09, ALQ-F7-01
- **Modelo / esforço**: sonnet / medium — transform + curadoria com gate.
- **Teste (TDD)**: `mutagen-partition.test.mjs`: Bestial (Lesser) → benefício com +1 Atletismo, desvantagem com −2 Reflexos/Acrobacia/Furtividade (escrito do texto); cobertura 57/57.
- **Prova visual (print)**: Coberta por ALQ-F6-18.
- **Spec/REQ**: REQ-AFL (mutágeno: dados)
- **Tamanho**: P
- **Onda**: 15
- **Lote e2e**: L3

### ALQ-F6-18 — Mutágeno em jogo: consumo, limite e supressão

- **Repo**: satélite
- **Onde**: `engine-2e/src/effectsEngine.ts` (`collectEffects` pula índices suprimidos), novo `systems/pf2e/src/actions/mutagen.ts` (`registerConsumeHook`), novo `components/sheets/pf2e/effects/MutagenBadge.svelte` montado em "Efeitos ativos"
- **Entrega**: Beber aplica o efeito com `mutagen`; acima do limite (1; 2 com GFD Mutagenist) os benefícios mais antigos são suprimidos e as desvantagens seguem; com GFD e 3º mutágeno, card de escolha. Ficha mostra "Benefício (suprimido)" riscado. Quicksilver: dano 2×nível + nota.
- **Depende de**: ALQ-F6-17, ALQ-F2-11, ALQ-F2-12, ALQ-F4-02
- **Paralelo com**: ALQ-F6-06, ALQ-F6-14, ALQ-F6-10, ALQ-F7-06, ALQ-F7-05
- **Modelo / esforço**: sonnet / high — effects engine compartilhado (PF2e+SF2e) + server + ficha.
- **Teste (TDD)**: `engine-2e/__tests__/effectsEngine.mutagen.test.ts`: dois mutágenos → só o benefício do mais recente e as duas desvantagens. `mutagen.test.ts`: 3º com GFD pede escolha e não suprime sozinho.
- **Prova visual (print)**: **Player**: Bestial e Juggernaut ativos; Bestial com "Benefício suprimido" riscado; Reflexos com −2 das duas desvantagens e Fortitude sem o +2 suprimido.
- **Spec/REQ**: REQ-AFL (limite de mutágeno)
- **Tamanho**: M
- **Onda**: 16
- **Lote e2e**: L3

### ALQ-F6-19 — Mutagenist: field benefit, field vial, Field Discovery, GFD

- **Repo**: satélite
- **Onde**: `actions/mutagen.ts`, `ActorResource`, `ReactionTrigger` (evento `saveResolved`)
- **Entrega**: (a) PV temp. = Int + ½ nível por 1 min com cooldown; (b) "Beber frasco: suprimir desvantagem"; (c) Field Discovery: Fortitude falho sob mutágeno oferece "Encerrar mutágeno e rerrolar"; (d) GFD: limite 2 e escolha do bônus.
- **Depende de**: ALQ-F6-18, ALQ-F7-05, ALQ-F3-02
- **Paralelo com**: ALQ-F6-07, ALQ-F6-13, ALQ-F6-22, ALQ-F7-02, ALQ-F7-08
- **Modelo / esforço**: sonnet / medium — riders sobre contratos.
- **Teste (TDD)**: `mutagenist.test.ts`: Int 4 nível 5 → 6 PV temp.; segundo mutágeno em <1 min sem PV temp.; o reroll encerra o mutágeno antes de rolar e não aparece sem mutágeno.
- **Prova visual (print)**: **Player** Mutagenista: "Fortitude: Falha" com "Encerrar mutágeno e rerrolar"; depois o novo resultado e o mutágeno fora da ficha.
- **Spec/REQ**: REQ-AFL (Mutagenist)
- **Tamanho**: M
- **Onda**: 17
- **Lote e2e**: L3

### ALQ-F6-20 — Ações sobre o mutágeno: Revivifying, Regurgitate, Persistent

- **Repo**: satélite
- **Onde**: `actions/mutagen.ts`, botões no efeito ativo (`MutagenBadge.svelte`), `DailyPrep`
- **Entrega**: Revivifying (A): 1 ação encerra e cura 1d6 a cada 2 níveis. Regurgitate (A): Reflexo básico via `SaveRequest` vs class DC, ácido, sickened, encerra. Persistent Mutagen (G): 1/dia (recurso `freq:`) estende até a próxima `DailyPrep`.
- **Depende de**: ALQ-F6-18, ALQ-F6-08, ALQ-F3-05
- **Paralelo com**: ALQ-F6-15, ALQ-F7-07, ALQ-F7-09, ALQ-F7-10, ALQ-F7-11
- **Modelo / esforço**: sonnet / medium — três botões sobre contratos.
- **Teste (TDD)**: `mutagen-actions.test.ts`: Revivifying no nível 6 rola 3d6 e remove o efeito; Persistent recusado na 2ª vez no dia e liberado após `DailyPrep`.
- **Prova visual (print)**: **Player**: Bestial ativo com os três botões; após "Revivificante", card de cura 3d6 e o efeito sumindo.
- **Spec/REQ**: REQ-AFL (ações de mutágeno)
- **Tamanho**: M
- **Onda**: 18
- **Lote e2e**: L3

### ALQ-F6-21 — Counteract: motor + ação no servidor + card

- **Repo**: satélite
- **Onde**: novo `engine-2e/src/counteract.ts`, novo `systems/pf2e/src/actions/counteract.ts` (`counteract:attempt`), card action
- **Entrega**: `resolveCounteract` puro (CS até rank+3, S até rank+1, F só menor, CF nada) e `counteractRankFromLevel = ceil(nível/2)`. Ação rola no servidor e remove via `ApplyCondition`/remoção de efeito/aflição; card explica.
- **Depende de**: ALQ-F6-01, ALQ-F1-09
- **Paralelo com**: ALQ-F5-07, ALQ-F6-08, ALQ-F6-11, ALQ-F5-09, ALQ-F6-05
- **Modelo / esforço**: sonnet / medium — função pura pequena + handler padrão.
- **Teste (TDD)**: `engine-2e/__tests__/counteract.test.ts`: rank 3 com sucesso remove rank 4 e não 5; falha remove 2 e não 3; CF nunca remove. Server: sem ownership do alvo não tenta.
- **Prova visual (print)**: Coberta por ALQ-F7-09.
- **Spec/REQ**: REQ-AFL (counteract); emenda REQ-PF2-086
- **Tamanho**: P
- **Onda**: 14
- **Lote e2e**: L3

### ALQ-F6-22 — Fortified Elixirs (reroll de save sob antídoto)

- **Repo**: satélite
- **Onde**: `actions/affliction.ts`, oferta via `ReactionTrigger` (`saveResolved`, predicado `self:effect:antidote|antiplague`)
- **Entrega**: Fortitude falho contra veneno (antídoto) ou doença (antiplague) oferece "Rerrolar (Elixires Fortificados)" sem o bônus de item; usar encerra o efeito do elixir.
- **Depende de**: ALQ-F6-09, ALQ-F7-05
- **Paralelo com**: ALQ-F6-07, ALQ-F6-13, ALQ-F6-19, ALQ-F7-02, ALQ-F7-08
- **Modelo / esforço**: sonnet / low — um predicado e um botão.
- **Teste (TDD)**: `fortified-elixirs.test.ts`: reroll sem o bônus do antídoto; efeito removido; sem o feat do criador sem oferta.
- **Prova visual (print)**: **Player**: "Fortitude vs Arsênico: Falha" com "Rerrolar (Elixires Fortificados)" e o Antídoto sumindo.
- **Spec/REQ**: REQ-AFL (fortuna)
- **Tamanho**: P
- **Onda**: 17
- **Lote e2e**: L3

### ALQ-F6-23 — Roteiro tutorial-e2e da F6

- **Repo**: core
- **Onde**: `docs/design/alquimista/e2e/alq-f6.html` (data-dir no scratchpad, exportar progresso)
- **Entrega**: Um print por tarefa F6 com UI (10, 11, 12, 13, 14, 15, 18, 19, 20, 22), GM e player; o primeiro passo confere a branch (`git merge-base --is-ancestor`).
- **Depende de**: ALQ-F6-10, ALQ-F6-11, ALQ-F6-12, ALQ-F6-13, ALQ-F6-14, ALQ-F6-15, ALQ-F6-18, ALQ-F6-19, ALQ-F6-20, ALQ-F6-22, ALQ-F6-07
- **Paralelo com**: ALQ-F5-12, ALQ-F7-17
- **Modelo / esforço**: sonnet / medium — dirigir app.
- **Teste (TDD)**: O roteiro é o e2e.
- **Prova visual (print)**: Índice com os 10 prints.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 19 (só leitura, fora do teto)
- **Lote e2e**: L3

### F7 — Talentos exóticos

### ALQ-F7-01 — Spec nova `49-custo-de-acao-reacao-additive.md` (ACO)

- **Repo**: core
- **Onde**: `specs/49-custo-de-acao-reacao-additive.md` (novo), emendas `specs/10-combate-e-iniciativa.md`, `specs/29-pets-companions-familiars.md` (REQ-PET-021), `specs/README.md` (prefixo `REQ-ACO-`)
- **Entrega**: Contratos `ActionCost` (só dado e exibição), `ReactionTrigger` (sem orçamento: permissão + frequência), `AdditiveHook`, critério G/A/N e a triagem talento a talento como decisão; D-18. Registra o contador de ações por turno como **fora do escopo** (D-15), com o motivo.
- **Depende de**: —
- **Paralelo com**: ALQ-F5-04, ALQ-F5-08, ALQ-F6-12, ALQ-F6-17, ALQ-F6-09
- **Modelo / esforço**: opus / high — contrato de ação/reação para todo o VTT.
- **Teste (TDD)**: `spec-lint` verde; REQ-ACO na cobertura mínima.
- **Prova visual (print)**: Sem UI. Coberta por F7-06/F7-11.
- **Spec/REQ**: `REQ-ACO-001..0xx`; emendas 10/29
- **Tamanho**: M
- **Onda**: 15
- **Lote e2e**: L3
- **Decisão**: D-15 (decidido: contador de ações fora do escopo (futuro)); D-18 (decidido: oferta de reação sem cronômetro, some no próximo evento do personagem)

### ALQ-F7-02 — `ActionCost` como dado exibido nos itens

- **Repo**: satélite
- **Onde**: novo `engine-2e/src/actionCost.ts` (`parseActionGlyph`), `tools/importer-pf2e/src/transform.mjs` (consumíveis: `system.activation`), `schemas/item-equipment.ts`, mapeamento de `item-feat.ts`
- **Entrega**: Todo feat/ação/consumível tem `ActionCost` derivável (glifos, Interact, atividades), **só para exibir** o custo na aba Ações e nos cards (Mega Bomba "◆◆", Alquimia Rápida "◆", aplicar veneno). Nada conta, gasta ou bloqueia ação (D-15).
- **Depende de**: ALQ-F7-01, ALQ-F2-03
- **Paralelo com**: ALQ-F6-07, ALQ-F6-13, ALQ-F6-19, ALQ-F6-22, ALQ-F7-08
- **Modelo / esforço**: sonnet / medium — normalização com fixtures.
- **Teste (TDD)**: `actionCost.test.ts`: Arsênico (glifo `A`) → `{kind:"action",count:1}`; Black Smear (`3`, Interact) → 3 ações + manipulate; Centopeia Gigante (`2`) → 2; gate: 0 consumíveis alquímicos remaster sem `activation`.
- **Prova visual (print)**: Aba Ações (player): "Alquimia Rápida ◆" e, no inventário, "Veneno de Centopeia Gigante — Ativar ◆◆" com o custo só exibido.
- **Spec/REQ**: REQ-ACO (custo)
- **Tamanho**: P
- **Onda**: 17
- **Lote e2e**: L3
- **Decisão**: D-15 (decidido: contador de ações fora do escopo (futuro))

### ALQ-F7-05 — `ReactionTrigger`: gatilhos e oferta de reação

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/actions/reaction-trigger.ts`; eventos de `TurnHooks`, `onDamageApplied`, `onRollResolved`; card sussurrado (redação via `redaction.ts`); card actions `reaction:accept`/`reaction:decline`
- **Entrega**: Sistemas registram `ReactionOfferDefinition`; o servidor avalia após o evento, oferece só a dono/GM e valida o aceite **só por permissão e frequência declarada** (ex.: 1/dia via recurso `freq:`), sem contar ações (D-15). Sem cronômetro: a oferta some no próximo evento do mesmo personagem (D-18). Custo `none` = gatilho automático.
- **Depende de**: ALQ-F7-01, ALQ-F3-02, ALQ-F4-09, ALQ-F1-08, ALQ-F1-04
- **Paralelo com**: ALQ-F6-06, ALQ-F6-14, ALQ-F6-18, ALQ-F6-10, ALQ-F7-06
- **Modelo / esforço**: sonnet / high — barramento cruzando combate, chat e dano.
- **Teste (TDD)**: `reaction-trigger.test.ts`: oferta de `saveResolved` só ao dono e ao GM; aceite de não-dono → recusado; frequência 1/dia: segundo aceite no dia → recusado; aceitar duas reações no mesmo turno é permitido (não há orçamento); oferta antiga recusada após novo evento do mesmo ator.
- **Prova visual (print)**: Coberta por ALQ-F6-19 e ALQ-F7-16.
- **Spec/REQ**: REQ-ACO (reação)
- **Tamanho**: M
- **Onda**: 16
- **Lote e2e**: L3
- **Decisão**: D-18 (decidido: oferta de reação sem cronômetro, some no próximo evento do personagem)

### ALQ-F7-06 — Additive framework

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/additives/registry.ts`, `registerCraftingDraftHook` (F3-08), seletor nos diálogos de Quick/Advanced Alchemy (`AdvancedAlchemyDialog.svelte`, `ActionsTab` via `actionsVM.ts`)
- **Entrega**: Ao criar item alquímico, seletor lista additives conhecidos e compatíveis; escolher carimba `flags.fusion.additive` (máx. 1) e aplica o patch; selo no inventário e no card.
- **Depende de**: ALQ-F7-01, ALQ-F3-09, ALQ-F3-10
- **Paralelo com**: ALQ-F6-06, ALQ-F6-14, ALQ-F6-18, ALQ-F6-10, ALQ-F7-05
- **Modelo / esforço**: sonnet / high — ponto de extensão novo no fluxo de criação.
- **Teste (TDD)**: `additives/__tests__/registry.test.ts`: Smoke Bomb não aparece para elixir; 2º additive recusado; feat não possuído não aparece.
- **Prova visual (print)**: **Player**: diálogo Alquimia Rápida com "Aditivo: Bomba Pegajosa" e a bomba criada com o selo.
- **Spec/REQ**: REQ-ACO (additive)
- **Tamanho**: M
- **Onda**: 16
- **Lote e2e**: L3

### ALQ-F7-07 — Additives genéricos: Sticky, Exploitive, Pernicious, Combine, Unstable (degrau)

- **Repo**: satélite
- **Onde**: novos `systems/pf2e/src/additives/{sticky,exploitive,pernicious,combine,unstable}.ts`, hook `onInitialSave` do afflictionEngine, `effectRefs[]` do ConsumeItem
- **Entrega**: Sticky Bomb: persistente = respingo. Exploitive Bomb: `ignoreResistance {type, value: nível}`. Pernicious Poison: sucesso não crítico no inicial ainda causa dano = nível. Combine Elixirs: `effectRefs` com dois efeitos, +1 vial. Unstable Concoction: só o +1 degrau de dado (flat check é da F5-11).
- **Depende de**: ALQ-F7-06, ALQ-F6-08, ALQ-F5-03, ALQ-F5-07, ALQ-F5-11
- **Paralelo com**: ALQ-F6-15, ALQ-F6-20, ALQ-F7-09, ALQ-F7-10, ALQ-F7-11
- **Modelo / esforço**: sonnet / medium — patches pequenos.
- **Teste (TDD)**: `additives-generic.test.ts`: Pernicious com Sucesso aplica dano = nível e com Sucesso crítico não; Exploitive nível 16 contra resist. fogo 10 → 0; Combine aplica os dois efeitos e cobra 2 vials; Unstable sobe d6 → d8.
- **Prova visual (print)**: **GM**: card de acerto de Bomba Pegajosa com "persistente 2 ácido" e a condição no alvo; card de Veneno Pernicioso "Sucesso, ainda sofre 4 veneno".
- **Spec/REQ**: REQ-ACO (additives G)
- **Tamanho**: M
- **Onda**: 18
- **Lote e2e**: L3

### ALQ-F7-08 — Card de resolução assistida + additives assistidos

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/assisted/assistedCard.ts` (sobre `SaveRequest` da F6-08 e `CardButtonSchema`), novos `additives/{debilitating,sour,smoke,glitter,healing-bomb,numbing-spice}.ts`
- **Entrega**: Builder único de cards com botões validados no servidor (`saveVsClassDc` via SaveRequest, `applyCondition` com `expiry` ancorado, `heal`, `flatCheck`, `placeArea`, `grantTempAction`). Ligações: Debilitating (até o início do turno **do alquimista**), Sour, Smoke, Glitter, Healing Bomb, Numbing Spice.
- **Depende de**: ALQ-F7-06, ALQ-F6-08, ALQ-F2-09, ALQ-F5-06
- **Paralelo com**: ALQ-F6-07, ALQ-F6-13, ALQ-F6-19, ALQ-F6-22, ALQ-F7-02
- **Modelo / esforço**: sonnet / medium — builder pequeno + ligações declarativas.
- **Teste (TDD)**: `assistedCard.test.ts`: save usa a class DC do **criador** mesmo com outro arremessando; condição expira no `turnStart` do criador; player não aplica condição em alvo alheio sem passar pelo save.
- **Prova visual (print)**: **Player** arremessa bomba Debilitante: "Escolher: ofuscado/surdo/desprevenido/−5 pés" → "Fortitude (CD 21)"; **GM** vê o alvo ofuscado com "até o início do turno de <alquimista>".
- **Spec/REQ**: REQ-ACO (resolução assistida)
- **Tamanho**: M
- **Onda**: 17
- **Lote e2e**: L3

### ALQ-F7-09 — Invigorating Elixir + Improved + Supreme

- **Repo**: satélite
- **Onde**: novo `additives/invigorating.ts`, `counteract` (F6-21), imunidade de 10 min como EffectItem
- **Entrega**: Additive em elixir de cura: ao consumir, card "Contra-atacar condição" com as condições permitidas por nível do talento; rank = ½ nível, modificador = class DC − 10; imunidade de 10 min; ingerível mesmo enjoado.
- **Depende de**: ALQ-F7-08, ALQ-F6-21
- **Paralelo com**: ALQ-F6-15, ALQ-F6-20, ALQ-F7-07, ALQ-F7-10, ALQ-F7-11
- **Modelo / esforço**: sonnet / medium — dados de lista + Counteract pronto.
- **Teste (TDD)**: `invigorating.test.ts`: sem Improved, "lento" não aparece; Supreme no nível 12 usa rank 7; 2º uso em <10 min recusado.
- **Prova visual (print)**: **Player** enjoado 2 bebe o elixir: "Contra-atacar: enjoado (rank 3 vs rank 2), Sucesso, removido" e a ficha sem enjoado.
- **Spec/REQ**: REQ-ACO + REQ-AFL (counteract)
- **Tamanho**: P
- **Onda**: 18
- **Lote e2e**: L3

### ALQ-F7-10 — Mega Bomb (atividade de 2 ações)

- **Repo**: satélite
- **Onde**: novo `additives/mega-bomb.ts`, `AreaTargets`/`SplashDamage`, `ActionCost`
- **Entrega**: Atividade "Detonar Mega Bomba" (custo ◆◆ exibido, sem ataque): burst de 30 pés a até 60, `SaveRequest` Reflexo básico por alvo vs class DC, dano de bomba e respingo como primário, efeito de alvo primário na falha.
- **Depende de**: ALQ-F7-08, ALQ-F7-02, ALQ-F5-07
- **Paralelo com**: ALQ-F6-15, ALQ-F6-20, ALQ-F7-07, ALQ-F7-09, ALQ-F7-11
- **Modelo / esforço**: sonnet / high — área + save por alvo + dano.
- **Teste (TDD)**: `mega-bomb.test.ts`: 3 alvos → 3 saves; Sucesso crítico → 0; Falha → dano integral + off-guard do bottled lightning; card exibe `ActionCost {action, 2}`.
- **Prova visual (print)**: **GM**: template de 30 pés sobre 3 tokens e card com três linhas de Reflexo e dano aplicado.
- **Spec/REQ**: REQ-ACO (atividade)
- **Tamanho**: M
- **Onda**: 18
- **Lote e2e**: L3

### ALQ-F7-11 — Quick Bomber (assistido) + Abundant Vials (nota)

- **Repo**: satélite
- **Onde**: `crafting/abilities/quickAlchemy.ts` declara `ActionCost` exibido; novo `actions/quick-bomber.ts`; `ActionsTab.svelte`; nota de Abundant Vials via `RollNotes`
- **Entrega**: Quick Bomber (A): um botão "Bombardeiro Rápido ◆" abre o picker de Alquimia Rápida e, com a bomba criada, faz o strike na mesma ação composta. Abundant Vials (NEW-QUICKENED): sem contador (D-15), vira nota/resolução assistida — o card de Alquimia Rápida mostra "ação extra de Frascos Abundantes: só para frasco rápido" e oferece criar o frasco sem gastar vial extra com Double Brew.
- **Depende de**: ALQ-F7-02, ALQ-F7-06, ALQ-F2-14, ALQ-F4-10
- **Paralelo com**: ALQ-F6-15, ALQ-F6-20, ALQ-F7-07, ALQ-F7-09, ALQ-F7-10
- **Modelo / esforço**: sonnet / medium — composição sobre contratos.
- **Teste (TDD)**: `quick-bomber.test.ts`: o fluxo cria exatamente 1 bomba e 1 strike com o `itemId` dela; sem vial → botão indisponível; Abundant Vials → a nota aparece só em ator com o talento e só no card de Alquimia Rápida, e frasco rápido com Double Brew custa 1 vial.
- **Prova visual (print)**: **Player** nível 17: card "Bombardeiro Rápido" com a bomba criada e o ataque rolado; card de Alquimia Rápida com a nota de Frascos Abundantes.
- **Spec/REQ**: REQ-ACO (ação composta, nota)
- **Tamanho**: M
- **Onda**: 18
- **Lote e2e**: L3
- **Decisão**: D-15 (decidido: contador de ações fora do escopo (futuro))

### ALQ-F7-12 — Improvise Admixture

- **Repo**: satélite
- **Onde**: novo `actions/improvise-admixture.ts`, `ActorResource` (vials + `freq:`)
- **Entrega**: "Improvisar mistura" (1 ação, 1/dia, só com vials abaixo do máximo): Crafting no servidor contra a DC do nível; por grau 3/2/1/0 vials até o máximo. Kit vira confirmação no card.
- **Depende de**: ALQ-F7-02, ALQ-F3-05
- **Paralelo com**: ALQ-F7-13, ALQ-F7-14, ALQ-F7-15, ALQ-F7-16
- **Modelo / esforço**: sonnet / low — um handler check → recurso.
- **Teste (TDD)**: `improvise-admixture.test.ts`: crítico com máx 5 e atual 4 → 5; 2º uso no dia recusado; vials cheios → indisponível.
- **Prova visual (print)**: **Player**: "Criação CD 16: Sucesso, +2 frascos" e o contador subindo de 1 para 3.
- **Spec/REQ**: REQ-ACO (frequência)
- **Tamanho**: P
- **Onda**: 19
- **Lote e2e**: L3

### ALQ-F7-13 — Alchemical Familiar

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/familiar-grant.ts` (`detectFamiliarGrant`), `sheets/pf2e/.../pets/FamiliarAbilityPicker.svelte` (UI já existe no satélite), `player-familiar-create.test.ts`
- **Entrega**: O talento libera a aba Pets pelo gate existente. Construct fixo e fora do orçamento. Hipótese a testar primeiro: o `upgrade 2` do vendor é somado como bônus (orçamento 4) quando a regra dá 2 + Construct.
- **Depende de**: ALQ-F0-02
- **Paralelo com**: ALQ-F7-12, ALQ-F7-14, ALQ-F7-15, ALQ-F7-16
- **Modelo / esforço**: sonnet / medium — correção pontual em código testado.
- **Teste (TDD)**: `familiar-grant.test.ts`: Alchemical Familiar → `canHaveFamiliar` e 2 selecionáveis com Construct fixo; Enhanced Familiar segue com 6.
- **Prova visual (print)**: **Player** alquimista: Pets → "Criar familiar" → "Constructo (fixo)" travado e "0/2 escolhidas".
- **Spec/REQ**: emenda REQ-PET-021 (na ALQ-F7-01 ou aqui)
- **Tamanho**: P
- **Onda**: 19
- **Lote e2e**: L3

### ALQ-F7-14 — Mutant Physique + Mutant Innervation

- **Repo**: satélite
- **Onde**: REs dos feats (PR #57) no `RuleElementRegistry` com predicado `self:effect:<slug>-mutagen-*`, `RollNotes`
- **Entrega**: Physique (G): Bestial com bônus de Intimidação e garra/mandíbula; Juggernaut com resistência física ½ nível; Quicksilver como nota. Innervation: bônus de item G, telepatia/idiomas como nota. Respeita benefício suprimido.
- **Depende de**: ALQ-F6-18, ALQ-F4-12, ALQ-F4-14, ALQ-F4-10
- **Paralelo com**: ALQ-F7-12, ALQ-F7-13, ALQ-F7-15, ALQ-F7-16
- **Modelo / esforço**: sonnet / medium — dados de RE sobre o motor da F4.
- **Teste (TDD)**: `mutant-physique.test.ts`: Juggernaut (Moderado) nível 8 → resistência física 4 só com o efeito; benefício suprimido → sem resistência.
- **Prova visual (print)**: **Player** nível 8 sob Juggernaut: "Resistência física 4 (Físico Mutante)"; com Quicksilver, nota "Passo de 10 pés".
- **Spec/REQ**: REQ-ACO (triagem N/G)
- **Tamanho**: P
- **Onda**: 19
- **Lote e2e**: L3

### ALQ-F7-15 — Sentidos assistidos: Blowgun Poisoner (furtividade) + nota de cobertura de Uncanny Bombs

- **Repo**: satélite
- **Onde**: `assisted/assistedCard.ts` (botão `opposedCheck`), REs `Note` dos feats
- **Entrega**: Blowgun (A): strike de zarabatana oculto gera card "Furtividade vs Percepção" no servidor com manter/revelar. Uncanny Bombs: só a nota de cobertura −1 (alcance é F4-16, auto-sucesso é F5-10).
- **Depende de**: ALQ-F7-08, ALQ-F6-14, ALQ-F5-10
- **Paralelo com**: ALQ-F7-12, ALQ-F7-13, ALQ-F7-14, ALQ-F7-16
- **Modelo / esforço**: sonnet / low — botão novo + notas.
- **Teste (TDD)**: `blowgun-stealth.test.ts`: sem hidden/undetected sem card; Percepção do alvo (DC) nunca no payload do player.
- **Prova visual (print)**: **Player** oculto atira de zarabatana: "Furtividade 24 vs Percepção, continua oculto" e selo mantido.
- **Spec/REQ**: REQ-ACO (resolução assistida)
- **Tamanho**: P
- **Onda**: 19
- **Lote e2e**: L3

### ALQ-F7-16 — Alchemical Revivification

- **Repo**: satélite
- **Onde**: `ReactionTrigger` (`turnStart`, `self:dead` + `self:effect:trait:elixir`, custo `none`), `assistedCard`, imunidade 1d4 h
- **Entrega**: No início do turno seguinte à morte sob elixir, card automático para dono e GM encadeia Rejuvenescimento → Elixir da Vida (Verdadeiro) → mutágeno Maior; imunidade de 1d4 h no fim.
- **Depende de**: ALQ-F7-05, ALQ-F7-08, ALQ-F6-18, ALQ-F1-12
- **Paralelo com**: ALQ-F7-12, ALQ-F7-13, ALQ-F7-14, ALQ-F7-15
- **Modelo / esforço**: sonnet / medium — gatilho pronto + cadeia de botões.
- **Teste (TDD)**: `alchemical-revivification.test.ts`: morto sem efeito de elixir não dispara; com efeito dispara 1×; sob imunidade não dispara.
- **Prova visual (print)**: **GM**: tracker com o alquimista morto e card "Revivificação Alquímica"; após os cliques, PV > 0 e mutágeno Maior na ficha.
- **Spec/REQ**: REQ-ACO (gatilho automático)
- **Tamanho**: P
- **Onda**: 19
- **Lote e2e**: L3

### ALQ-F7-17 — Roteiro tutorial-e2e da F7

- **Repo**: core
- **Onde**: `docs/design/alquimista/e2e/alq-f7.html` (exportar progresso)
- **Entrega**: Um print por tarefa F7 com UI (02, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16), GM e player.
- **Depende de**: ALQ-F7-02, ALQ-F7-06, ALQ-F7-07, ALQ-F7-08, ALQ-F7-09, ALQ-F7-10, ALQ-F7-11, ALQ-F7-12, ALQ-F7-13, ALQ-F7-14, ALQ-F7-15, ALQ-F7-16
- **Paralelo com**: ALQ-F5-12, ALQ-F6-23
- **Modelo / esforço**: sonnet / medium — dirigir app.
- **Teste (TDD)**: O roteiro é o e2e.
- **Prova visual (print)**: Índice com os 12 prints.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: faixa de lote após a onda 19 (só leitura, fora do teto)
- **Lote e2e**: L3

## 5. Ondas globais

19 ondas de código. Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do bump de pin no core com a suíte verde. O gate humano do merge do PR #57 (+ tag) fica na saída da onda 1.

| Onda | Tarefas                                                                                                           | Repo     | Gate de saída                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | ALQ-F0-01, ALQ-F1-01, ALQ-F2-02, ALQ-F2-17, ALQ-F4-02, ALQ-F4-03                                                  | ambos    | suítes de @fusion/sheets-pf2e, @fusion/system-api, engine-2e, importer-pf2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde · **gate humano: merge do #57 + tag no satélite** |
| 2    | ALQ-F0-02, ALQ-F1-02, ALQ-F1-03, ALQ-F2-01, ALQ-F2-03, ALQ-F4-19                                                  | ambos    | suítes de @fusion/client, @fusion/shared, @fusion/system-api, importer-pf2e, pf2e · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                         |
| 3    | ALQ-F0-08, ALQ-F1-04, ALQ-F1-05, ALQ-F1-06, ALQ-F2-08, ALQ-F0-07                                                  | ambos    | suítes de @fusion/client, @fusion/server, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                           |
| 4    | ALQ-F1-08, ALQ-F2-09, ALQ-F0-03, ALQ-F2-13, ALQ-F1-07, ALQ-F3-01                                                  | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                             |
| 5    | ALQ-F1-10, ALQ-F1-09, ALQ-F2-10, ALQ-F2-11, ALQ-F0-09, ALQ-F0-04                                                  | ambos    | suítes de @fusion/server, @fusion/shared, @fusion/sheets-pf2e, @fusion/system-api, engine-2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                |
| 6    | ALQ-F2-12, ALQ-F0-05, ALQ-F0-06, ALQ-F3-02, ALQ-F1-12, ALQ-F2-04                                                  | satélite | suítes de @fusion/sheets-pf2e, engine-2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                    |
| 7    | ALQ-F2-14, ALQ-F0-10, ALQ-F3-07, ALQ-F2-05, ALQ-F2-06, ALQ-F4-01                                                  | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                 |
| 8    | ALQ-F1-11, ALQ-F3-08, ALQ-F3-03, ALQ-F5-01, ALQ-F4-07, ALQ-F4-06                                                  | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, @fusion/system-api, importer-pf2e, pf2e · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                    |
| 9    | ALQ-F3-05, ALQ-F3-11, ALQ-F2-07, ALQ-F3-12, ALQ-F6-01, ALQ-F5-05                                                  | ambos    | suítes de @fusion/server, @fusion/shared, @fusion/sheets-pf2e, @fusion/system-api, importer-pf2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                              |
| 10   | ALQ-F3-06, ALQ-F3-09, ALQ-F4-09, ALQ-F4-04, ALQ-F3-04, ALQ-F6-03 + faixa de lote: ALQ-F0-11, ALQ-F1-13, ALQ-F2-15 | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                           |
| 11   | ALQ-F3-10, ALQ-F3-13, ALQ-F4-11, ALQ-F4-13, ALQ-F4-14, ALQ-F4-12                                                  | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                           |
| 12   | ALQ-F4-10, ALQ-F4-16, ALQ-F4-08, ALQ-F5-02, ALQ-F5-06, ALQ-F6-02                                                  | ambos    | suítes de @fusion/client, @fusion/server, @fusion/sheets-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                     |
| 13   | ALQ-F4-15, ALQ-F4-17, ALQ-F6-04, ALQ-F5-03, ALQ-F5-10, ALQ-F5-11                                                  | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                                     |
| 14   | ALQ-F5-07, ALQ-F6-08, ALQ-F6-11, ALQ-F5-09, ALQ-F6-05, ALQ-F6-21 + faixa de lote: ALQ-F3-14, ALQ-F4-18            | ambos    | suítes de @fusion/server, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                           |
| 15   | ALQ-F5-04, ALQ-F5-08, ALQ-F6-12, ALQ-F6-17, ALQ-F6-09, ALQ-F7-01                                                  | ambos    | suítes de @fusion/client, @fusion/sheets-pf2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `spec-lint` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                        |
| 16   | ALQ-F6-06, ALQ-F6-14, ALQ-F6-18, ALQ-F6-10, ALQ-F7-06, ALQ-F7-05                                                  | ambos    | suítes de @fusion/client, @fusion/sheets-pf2e, engine-2e, importer-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                           |
| 17   | ALQ-F6-07, ALQ-F6-13, ALQ-F6-19, ALQ-F6-22, ALQ-F7-02, ALQ-F7-08                                                  | satélite | suítes de engine-2e, importer-pf2e, pf2e, translate-packs (qa) · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                          |
| 18   | ALQ-F6-15, ALQ-F6-20, ALQ-F7-07, ALQ-F7-09, ALQ-F7-10, ALQ-F7-11                                                  | satélite | suítes de @fusion/sheets-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                                                     |
| 19   | ALQ-F7-12, ALQ-F7-13, ALQ-F7-14, ALQ-F7-15, ALQ-F7-16                                                             | satélite | suítes de @fusion/sheets-pf2e, pf2e · typecheck + lint + `format:check` · `pnpm spec:report` · bump de pin no core com suíte verde                                                                                                                                     |
| 20   | faixa de lote: ALQ-F5-12, ALQ-F6-23, ALQ-F7-17                                                                    | core     | prints olhados, relatório P3 publicado                                                                                                                                                                                                                                 |

Fechamento por fase (última onda com código): F0 na onda 7 · F1 na onda 8 · F2 na onda 9 · F3 na onda 11 · F4 na onda 13 · F5 na onda 15 · F6 na onda 18 · F7 na onda 19.

Caminho crítico: ALQ-F4-02/F4-03 → ALQ-F4-19 → ALQ-F2-08 → ALQ-F2-09 → ALQ-F2-10 → ALQ-F3-05/F3-08 → ALQ-F3-09 → ALQ-F3-10 → ALQ-F7-06 → ALQ-F7-08 → ALQ-F7-16. O motor de RE (F4-02, F4-03, F4-19) roda nas ondas 1–2, em paralelo com F0 e F1, porque a F2-08 depende dele.

## 6. Lotes de print

Os lotes continuam L1 (F0–F2), L2 (F3–F4) e L3 (F5–F7): nas ondas globais as fases fecham nessa ordem (L1 fecha na onda 9, L2 na 13, L3 na 19). A F5 fecha na onda 15; se quiser adiantar, o roteiro dela pode rodar antes do resto do L3 sem mudar nada.

Regras comuns: servidor isolado em mundo existente com data-dir no scratchpad (nunca dentro da worktree); primeiro passo de cada roteiro confere a branch com `git merge-base --is-ancestor`; um print por tarefa com UI, alvo circulado, smoke como GM e como player; roteiro HTML com botão de exportar progresso; prints em `.fusion-build/alquimista/L<n>/<fase>/`; relatório HTML P3 (PROCESSO-UI) com protótipo × tela em `.fusion-build/alquimista/L<n>/relatorio.html`, linkado nos PRs do lote.

### L1 — faixa após a onda 9

Roteiros: ALQ-F0-11, ALQ-F1-13, ALQ-F2-15. Pasta: `.fusion-build/alquimista/L1/`.

| Tarefa    | Visão               | O que o print prova                                                                                                                                                                                           | Pasta    |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ALQ-F0-01 | —                   | Coberta por ALQ-F0-06 (classe e eixo no builder).                                                                                                                                                             | `L1/f0/` |
| ALQ-F0-02 | —                   | Coberta por ALQ-F0-06.                                                                                                                                                                                        | `L1/f0/` |
| ALQ-F0-03 | player (+ smoke GM) | Player no builder, nível 20 do Alquimista: picker com "Alquimia do Desejo" exibindo o selo "Legado"; segundo print com o filtro "Esconder legado" ligado e o talento fora da lista.                           | `L1/f0/` |
| ALQ-F0-04 | —                   | Coberta por ALQ-F0-03 (picker em pt-BR).                                                                                                                                                                      | `L1/f0/` |
| ALQ-F0-05 | —                   | Coberta por ALQ-F0-06 (nomes dos campos em pt-BR).                                                                                                                                                            | `L1/f0/` |
| ALQ-F0-06 | player (+ smoke GM) | Player no builder do Alquimista nível 1: eixo "Campo de Pesquisa" aberto com as 4 opções e Toxicologista selecionado.                                                                                         | `L1/f0/` |
| ALQ-F0-07 | player (+ smoke GM) | Player na ficha do Alquimista nível 5 (Bombardeiro): features "Bombardeiro" e "Descoberta de Campo (Bombardeiro)" concedidas.                                                                                 | `L1/f0/` |
| ALQ-F0-08 | player (+ smoke GM) | Player na ficha do Alquimista nível 1, aba Combate: CD de classe 17 e strike "Frasco de Ácido" +5.                                                                                                            | `L1/f0/` |
| ALQ-F0-09 | player (+ smoke GM) | Player no builder do Guerreiro nível 2 (Free Archetype): "Dedicação de Alquimista" desabilitada com "Inteligência +2"; segundo print com Int +2 habilitando e Concocção Básica aparecendo depois.             | `L1/f0/` |
| ALQ-F0-10 | player (+ smoke GM) | Player na ficha do Guerreiro nível 2: "CD de Alquimista 16" e feature "Criação Alquímica" concedida.                                                                                                          | `L1/f0/` |
| ALQ-F1-01 | —                   | Sem UI. Provas nas ALQ-F1-10..F1-12.                                                                                                                                                                          | `L1/f1/` |
| ALQ-F1-02 | —                   | Sem UI. Coberta por ALQ-F1-10.                                                                                                                                                                                | `L1/f1/` |
| ALQ-F1-03 | player (+ smoke GM) | O próprio protótipo aberto (GM e player lado a lado).                                                                                                                                                         | `L1/f1/` |
| ALQ-F1-04 | —                   | Coberta por ALQ-F1-12 (card de recovery check no início do turno).                                                                                                                                            | `L1/f1/` |
| ALQ-F1-05 | —                   | Coberta por ALQ-F1-10 ("Alvos: Goblin, Orc" no card).                                                                                                                                                         | `L1/f1/` |
| ALQ-F1-06 | —                   | Coberta por ALQ-F1-10 (breakdown de resistência) e ALQ-F1-12 (dying na ficha).                                                                                                                                | `L1/f1/` |
| ALQ-F1-07 | —                   | Coberta por ALQ-F1-11.                                                                                                                                                                                        | `L1/f1/` |
| ALQ-F1-08 | —                   | Coberta por ALQ-F1-10.                                                                                                                                                                                        | `L1/f1/` |
| ALQ-F1-09 | —                   | Coberta por ALQ-F1-11.                                                                                                                                                                                        | `L1/f1/` |
| ALQ-F1-10 | GM + player         | **Player**: card de Golpe com dano rolado, "Aplicar" circulado e alvo Goblin; print seguinte com resumo e barra de PV menor. **GM**: resumo com "PV 18 → 11" e linha de resistência. Mais "Curar" num aliado. | `L1/f1/` |
| ALQ-F1-11 | player (+ smoke GM) | **Player** na ficha do Alquimista: seletor "Amedrontado 2 → nos meus alvos (1)" circulado; em seguida chip "Amedrontado 2" na ficha do Goblin aberta pelo GM.                                                 | `L1/f1/` |
| ALQ-F1-12 | GM                  | **GM** no tracker: Alquimista a 0 PV com chip "Morrendo 1"; "Próximo turno" → card "Teste de recuperação — CD 11 — sucesso — Morrendo 0, Ferido 1".                                                           | `L1/f1/` |
| ALQ-F2-01 | —                   | Sem UI. Coberta por F2-08, F2-12 e F2-14.                                                                                                                                                                     | `L1/f2/` |
| ALQ-F2-02 | GM                  | Compêndio (GM) em "Efeitos de equipamento" com "Efeito: Elixir da Vida" e duração "10 minutos".                                                                                                               | `L1/f2/` |
| ALQ-F2-03 | player (+ smoke GM) | Compêndio → "Itens alquímicos" filtrado por bomba, com Fogo de Alquimista (Menor), nível e traits.                                                                                                            | `L1/f2/` |
| ALQ-F2-04 | —                   | Coberta por ALQ-F2-07.                                                                                                                                                                                        | `L1/f2/` |
| ALQ-F2-05 | —                   | Coberta por ALQ-F2-07.                                                                                                                                                                                        | `L1/f2/` |
| ALQ-F2-06 | —                   | Coberta por ALQ-F2-07.                                                                                                                                                                                        | `L1/f2/` |
| ALQ-F2-07 | player (+ smoke GM) | Ficha do player, Inventário: "Concentrador de Veneno" com selo "manual" e um elixir com nome em pt-BR.                                                                                                        | `L1/f2/` |
| ALQ-F2-08 | player (+ smoke GM) | Ficha (player), aba Principal, antes e depois de aplicar "Efeito: Elixir da Vida" (gatilho SCAFFOLDING "Aplicar efeito do compêndio" até a F2-12): saves +1 e "Efeitos ativos" listando o efeito.             | `L1/f2/` |
| ALQ-F2-09 | GM                  | Tracker (GM) na rodada 2: "Efeito: …" de 1 rodada sumiu do alvo e o card diz que terminou.                                                                                                                    | `L1/f2/` |
| ALQ-F2-10 | player (+ smoke GM) | Inventário (player) com bomba "temporária — expira no início do seu turno"; após o nextTurn do dono, sem ela. Gatilho SCAFFOLDING "Criar cópia temporária" até a F3-08.                                       | `L1/f2/` |
| ALQ-F2-11 | —                   | Coberta por ALQ-F2-12.                                                                                                                                                                                        | `L1/f2/` |
| ALQ-F2-12 | GM + player         | **Player**: "Elixir da Vida (Menor) ×2" com Usar; após o clique ×1, PV maior e o efeito na aba Principal. Smoke **GM** vendo o mesmo.                                                                         | `L1/f2/` |
| ALQ-F2-13 | —                   | Coberta por ALQ-F2-14.                                                                                                                                                                                        | `L1/f2/` |
| ALQ-F2-14 | player (+ smoke GM) | Ficha (player): strike "Fogo de Alquimista ×3" → ataque → card com grau contra o alvo marcado, inventário ×2 e PV do alvo menor após o botão de dano (tela do GM).                                            | `L1/f2/` |
| ALQ-F2-17 | —                   | Coberta por ALQ-F2-07 (Antídoto em pt-BR no inventário).                                                                                                                                                      | `L1/f2/` |

### L2 — faixa após a onda 13

Roteiros: ALQ-F3-14, ALQ-F4-18. Pasta: `.fusion-build/alquimista/L2/`.

| Tarefa    | Visão               | O que o print prova                                                                                                                                                                             | Pasta    |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ALQ-F3-01 | —                   | Sem UI. Coberta por F3-04, F3-06, F3-09 e F3-10.                                                                                                                                                | `L2/f3/` |
| ALQ-F3-02 | —                   | Coberta por ALQ-F3-04.                                                                                                                                                                          | `L2/f3/` |
| ALQ-F3-03 | —                   | Coberta por ALQ-F3-04.                                                                                                                                                                          | `L2/f3/` |
| ALQ-F3-04 | player (+ smoke GM) | Ficha do Alquimista nível 1 Int +4 (player): "Frascos versáteis 6/6"; − → 5/6 e a tela do GM também 5/6.                                                                                        | `L2/f3/` |
| ALQ-F3-05 | player (+ smoke GM) | Alquimista (player) com vials 1/6, bomba "temporária até a preparação" e PV ferido; Descansar → 6/6, bomba some, PV recupera e card lista as três coisas.                                       | `L2/f3/` |
| ALQ-F3-06 | player (+ smoke GM) | Alquimista (player) vials 3/6: strike "Frasco versátil" → card e 2/6; "Refinar frascos" → 4/6.                                                                                                  | `L2/f3/` |
| ALQ-F3-07 | player (+ smoke GM) | Aba Fabricação (player): "Livro de fórmulas 3/8", picker filtrado ≤ 3 e "Elixir da Vida (Menor)" adicionado.                                                                                    | `L2/f3/` |
| ALQ-F3-08 | —                   | Coberta por ALQ-F3-09 e ALQ-F3-10.                                                                                                                                                              | `L2/f3/` |
| ALQ-F3-09 | player (+ smoke GM) | Alquimista (player): Descansar → "Alquimia avançada 0/8" → 2× Fogo de Alquimista (Menor) + 1× Elixir da Vida (Menor) → inventário com os 3 "infundido — até a preparação" e "Lote de hoje 3/8". | `L2/f3/` |
| ALQ-F3-10 | player (+ smoke GM) | Em combate (tracker visível), player usa Alquimia Rápida → "Elixir da Vida (Menor) — expira no início do seu turno", vials −1; GM avança até o turno dele e o item some.                        | `L2/f3/` |
| ALQ-F3-11 | player (+ smoke GM) | Inventário (player) com veneno infundido e card "Fortitude CD 19"; lado a lado o mesmo item comprado com CD 17.                                                                                 | `L2/f3/` |
| ALQ-F3-12 | —                   | Coberta por ALQ-F3-13.                                                                                                                                                                          | `L2/f3/` |
| ALQ-F3-13 | player (+ smoke GM) | Aba Fabricação (player) → "Fabricar Fogo de Alquimista (Menor)" → "CD 15, +7" → card de sucesso → item permanente **sem** selo temporário.                                                      | `L2/f3/` |
| ALQ-F4-01 | —                   | Sem UI. Coberta por F4-08 e F4-10.                                                                                                                                                              | `L2/f4/` |
| ALQ-F4-02 | —                   | Sem UI. Coberta por ALQ-F4-17.                                                                                                                                                                  | `L2/f4/` |
| ALQ-F4-03 | —                   | Sem UI. Relatório do diff no corpo de cada PR de handler.                                                                                                                                       | `L2/f4/` |
| ALQ-F4-04 | —                   | Sem UI. Coberta por F4-12/F4-13.                                                                                                                                                                | `L2/f4/` |
| ALQ-F4-19 | —                   | Sem UI. Coberta por ALQ-F4-17 (painel lista `flat-modifier` como aplicado pelo registro).                                                                                                       | `L2/f4/` |
| ALQ-F4-06 | player (+ smoke GM) | Ficha do Alquimista nível 7 (player), aba Ações: strike de bomba "Especialista" com bônus correto e tooltip do breakdown.                                                                       | `L2/f4/` |
| ALQ-F4-07 | —                   | Coberta por ALQ-F4-08.                                                                                                                                                                          | `L2/f4/` |
| ALQ-F4-08 | player (+ smoke GM) | Player com Alquimista Bombardeiro liga "Respingo Ampliado"; interruptor ligado e o card de ataque seguinte com a nota. Smoke GM.                                                                | `L2/f4/` |
| ALQ-F4-09 | —                   | Coberta por ALQ-F4-10.                                                                                                                                                                          | `L2/f4/` |
| ALQ-F4-10 | player (+ smoke GM) | Chat do player após bomba com acerto: card com a nota "Respingo Ampliado" e texto; o mesmo lance em falha sem a nota (lado a lado).                                                             | `L2/f4/` |
| ALQ-F4-11 | —                   | Coberta por ALQ-F4-10.                                                                                                                                                                          | `L2/f4/` |
| ALQ-F4-12 | player (+ smoke GM) | Ficha do Alquimista nível 7 (player): breakdown do dano de bomba com "Especialização em Arma +X" uma vez só.                                                                                    | `L2/f4/` |
| ALQ-F4-13 | player (+ smoke GM) | Chat do player: save de Fortitude com "Sucesso → Sucesso crítico" e a origem.                                                                                                                   | `L2/f4/` |
| ALQ-F4-14 | player (+ smoke GM) | Ficha do Toxicologista (player): frasco versátil com traço "veneno" e "1d6 veneno".                                                                                                             | `L2/f4/` |
| ALQ-F4-15 | player (+ smoke GM) | Card de dano de bomba (player) com tipo alterado e instância extra no breakdown.                                                                                                                | `L2/f4/` |
| ALQ-F4-16 | player (+ smoke GM) | Aba Ações do Alquimista (player): strike de bomba "Incremento 30 pés".                                                                                                                          | `L2/f4/` |
| ALQ-F4-17 | GM                  | GM abre a ficha do Alquimista → "aplicadas: N / não suportadas: M" com Alchemical Weapon Expertise e CraftingAbility.                                                                           | `L2/f4/` |

### L3 — faixa após a onda 19

Roteiros: ALQ-F5-12, ALQ-F6-23, ALQ-F7-17. Pasta: `.fusion-build/alquimista/L3/`.

| Tarefa    | Visão               | O que o print prova                                                                                                                                                                                                                             | Pasta    |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ALQ-F5-01 | —                   | Sem UI. Coberta pelos prints F5.                                                                                                                                                                                                                | `L3/f5/` |
| ALQ-F5-02 | —                   | Coberta por ALQ-F5-04.                                                                                                                                                                                                                          | `L3/f5/` |
| ALQ-F5-03 | GM                  | Combate com NPC em chamas: fim do turno dele gera card "Dano persistente 1d6 fogo: 4 · teste de recuperação 17 — recuperado" e a condição some do token (GM).                                                                                   | `L3/f5/` |
| ALQ-F5-04 | GM                  | GM aplica "1d6 fogo" num goblin pelo menu; chip na ficha e ícone no token; player vê o chip do próprio personagem.                                                                                                                              | `L3/f5/` |
| ALQ-F5-05 | —                   | Coberta por ALQ-F5-06.                                                                                                                                                                                                                          | `L3/f5/` |
| ALQ-F5-06 | player (+ smoke GM) | Player mira bomba num goblin: casas adjacentes destacadas e 3 tokens marcados; na tela de **outro player** e do GM a mesma prévia aparece.                                                                                                      | `L3/f5/` |
| ALQ-F5-07 | GM                  | Player erra a bomba: card "Falha — respingo 2 fogo em 3 criaturas"; após aplicar, PV dos 3 tokens menor (GM).                                                                                                                                   | `L3/f5/` |
| ALQ-F5-08 | player (+ smoke GM) | Player liga "Respingo Ampliado": prévia com raio de 10 pés e card "respingo 2+4".                                                                                                                                                               | `L3/f5/` |
| ALQ-F5-09 | GM                  | Seletor "Material: ferro frio" na ficha (player) e card no demônio com "fraqueza ferro frio +5" (GM).                                                                                                                                           | `L3/f5/` |
| ALQ-F5-10 | player (+ smoke GM) | Card de bomba contra goblin oculto: "Teste de ocultação: sucesso automático (Bombas Assombrosas)".                                                                                                                                              | `L3/f5/` |
| ALQ-F5-11 | player (+ smoke GM) | Player consome elixir instável: card "Teste instável 7 — falha: 3 ácido" e PV menor na ficha.                                                                                                                                                   | `L3/f5/` |
| ALQ-F6-01 | —                   | Sem UI. Coberta por F6-10/18/19.                                                                                                                                                                                                                | `L3/f6/` |
| ALQ-F6-02 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-03 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-04 | —                   | Sem UI.                                                                                                                                                                                                                                         | `L3/f6/` |
| ALQ-F6-05 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-06 | —                   | Coberta por ALQ-F6-10 (Unending Itch curado no compêndio).                                                                                                                                                                                      | `L3/f6/` |
| ALQ-F6-07 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-08 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-09 | —                   | Coberta por ALQ-F6-10.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-10 | GM + player         | **Player afetado**: anotação no canto "Arsênico — Estágio 2/3 · 1 min por estágio · save em 3 rodadas", sem DC. **GM**: a mesma com DC 18 ("DC 19 (classe)" quando infundido) e botão "Avançar estágio". **Outro player**: tela sem a anotação. | `L3/f6/` |
| ALQ-F6-11 | player (+ smoke GM) | **Player**: adaga com selo "Envenenada: Veneno de Centopeia Gigante" e o veneno com quantidade reduzida.                                                                                                                                        | `L3/f6/` |
| ALQ-F6-12 | GM                  | **GM** no chat: "Acerto, 0 de dano (resistência)" seguido de "Exposto a Veneno de Centopeia Gigante" com Fortitude.                                                                                                                             | `L3/f6/` |
| ALQ-F6-13 | player (+ smoke GM) | **Player** Toxicologista: card de acerto "+1d6 veneno (frasco)" e, após a falha do alvo, "Espirrar em adjacente".                                                                                                                               | `L3/f6/` |
| ALQ-F6-14 | GM                  | **GM**: card do save inicial com "−2 circunstância (Envenenador Preciso)" e "Falha → Falha crítica (Envenenador de Zarabatana)".                                                                                                                | `L3/f6/` |
| ALQ-F6-15 | player (+ smoke GM) | **Player**: menu do Arsênico com "Expor alvo…" → card "Arsênico: início em 10 minutos".                                                                                                                                                         | `L3/f6/` |
| ALQ-F6-17 | —                   | Coberta por ALQ-F6-18.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-18 | player (+ smoke GM) | **Player**: Bestial e Juggernaut ativos; Bestial com "Benefício suprimido" riscado; Reflexos com −2 das duas desvantagens e Fortitude sem o +2 suprimido.                                                                                       | `L3/f6/` |
| ALQ-F6-19 | player (+ smoke GM) | **Player** Mutagenista: "Fortitude: Falha" com "Encerrar mutágeno e rerrolar"; depois o novo resultado e o mutágeno fora da ficha.                                                                                                              | `L3/f6/` |
| ALQ-F6-20 | player (+ smoke GM) | **Player**: Bestial ativo com os três botões; após "Revivificante", card de cura 3d6 e o efeito sumindo.                                                                                                                                        | `L3/f6/` |
| ALQ-F6-21 | —                   | Coberta por ALQ-F7-09.                                                                                                                                                                                                                          | `L3/f6/` |
| ALQ-F6-22 | player (+ smoke GM) | **Player**: "Fortitude vs Arsênico: Falha" com "Rerrolar (Elixires Fortificados)" e o Antídoto sumindo.                                                                                                                                         | `L3/f6/` |
| ALQ-F7-01 | —                   | Sem UI. Coberta por F7-06/F7-11.                                                                                                                                                                                                                | `L3/f7/` |
| ALQ-F7-02 | player (+ smoke GM) | Aba Ações (player): "Alquimia Rápida ◆" e, no inventário, "Veneno de Centopeia Gigante — Ativar ◆◆" com o custo só exibido.                                                                                                                     | `L3/f7/` |
| ALQ-F7-05 | —                   | Coberta por ALQ-F6-19 e ALQ-F7-16.                                                                                                                                                                                                              | `L3/f7/` |
| ALQ-F7-06 | player (+ smoke GM) | **Player**: diálogo Alquimia Rápida com "Aditivo: Bomba Pegajosa" e a bomba criada com o selo.                                                                                                                                                  | `L3/f7/` |
| ALQ-F7-07 | GM                  | **GM**: card de acerto de Bomba Pegajosa com "persistente 2 ácido" e a condição no alvo; card de Veneno Pernicioso "Sucesso, ainda sofre 4 veneno".                                                                                             | `L3/f7/` |
| ALQ-F7-08 | GM + player         | **Player** arremessa bomba Debilitante: "Escolher: ofuscado/surdo/desprevenido/−5 pés" → "Fortitude (CD 21)"; **GM** vê o alvo ofuscado com "até o início do turno de <alquimista>".                                                            | `L3/f7/` |
| ALQ-F7-09 | player (+ smoke GM) | **Player** enjoado 2 bebe o elixir: "Contra-atacar: enjoado (rank 3 vs rank 2), Sucesso, removido" e a ficha sem enjoado.                                                                                                                       | `L3/f7/` |
| ALQ-F7-10 | GM                  | **GM**: template de 30 pés sobre 3 tokens e card com três linhas de Reflexo e dano aplicado.                                                                                                                                                    | `L3/f7/` |
| ALQ-F7-11 | player (+ smoke GM) | **Player** nível 17: card "Bombardeiro Rápido" com a bomba criada e o ataque rolado; card de Alquimia Rápida com a nota de Frascos Abundantes.                                                                                                  | `L3/f7/` |
| ALQ-F7-12 | player (+ smoke GM) | **Player**: "Criação CD 16: Sucesso, +2 frascos" e o contador subindo de 1 para 3.                                                                                                                                                              | `L3/f7/` |
| ALQ-F7-13 | player (+ smoke GM) | **Player** alquimista: Pets → "Criar familiar" → "Constructo (fixo)" travado e "0/2 escolhidas".                                                                                                                                                | `L3/f7/` |
| ALQ-F7-14 | player (+ smoke GM) | **Player** nível 8 sob Juggernaut: "Resistência física 4 (Físico Mutante)"; com Quicksilver, nota "Passo de 10 pés".                                                                                                                            | `L3/f7/` |
| ALQ-F7-15 | player (+ smoke GM) | **Player** oculto atira de zarabatana: "Furtividade 24 vs Percepção, continua oculto" e selo mantido.                                                                                                                                           | `L3/f7/` |
| ALQ-F7-16 | GM                  | **GM**: tracker com o alquimista morto e card "Revivificação Alquímica"; após os cliques, PV > 0 e mutágeno Maior na ficha.                                                                                                                     | `L3/f7/` |

## 7. Riscos

| Risco                                                                        | Efeito                                       | Mitigação                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Merge do PR #57 do satélite atrasa                                           | F0-02 em diante e F3-03/F7-13 param          | F1, F2 (importer/efeitos) e o motor de RE rodam sem ele nas ondas 1–3                                                             |
| Faixa do importer (`transform.mjs`, packs regenerados) serializa ~12 tarefas | vira gargalo de calendário                   | uma tarefa de importer por onda já está no plano; extract + transform frescos sempre, para não reverter enrichment (lição do PC2) |
| Migração dos scanners (F4-19) muda número de classe publicada                | regressão silenciosa em 27 classes           | snapshot da F4-03 idêntico como critério; F4-19 não mergeia com diff                                                              |
| 98 AdjustDegreeOfSuccess ligados para todas as classes (D-14)                | grau errado em classe que não é o Alquimista | teste de escopo da F4-03 e revisão do diff do snapshot no PR da F4-13                                                             |
| `chat-handler.ts` concentra F1-05, F4-09, F4-13, F5-10                       | conflito e regressão no grau autoritativo    | serializado nas ondas 3, 10, 11 e 13; cada PR roda a suíte inteira do server                                                      |
| Teste circular (lição #48)                                                   | testes verdes com regra errada               | asserções pela regra escrita no teste; revisão adversarial dedicada no motor de aflição (F6-04)                                   |
| Flakiness do vitest no server sob carga                                      | CI vermelho sem defeito                      | re-rodar o arquivo isolado antes de tratar como regressão; porta sempre via helpers                                               |
| Anotação de estado temporizado (F6-10) é slot novo de HUD no core            | vazamento de informação para terceiros       | redação no servidor e teste com três usuários                                                                                     |
| Faixas de REQ reservadas andam entre fases                                   | colisão de id no spec-lint                   | faixas por tarefa na §1.3; quem escreve depois rebaseia a faixa                                                                   |
| Porte dos 35 itens do #107 diverge do vendor atual                           | dado velho sobrescreve o novo                | overrides por `sourceId` com relatório de divergência (F2-17)                                                                     |

## 8. Fora do escopo / futuro

| Item                                                                    | Motivo                                                                                                                                          | Onde retomar                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Contador de ações por turno (`ActionBudget`, pips, setting de bloqueio) | D-15: o Alexandre precisa desfazer, desistir e planejar sem nada contar ou bloquear. Quickened/slowed/stunned ficam como condições informativas | spec 49 registra; ex-ALQ-F7-03/F7-04 |
| Relógio de mundo e "passar tempo"                                       | D-05: sem relógio; expira no Descansar/preparação ou remoção manual                                                                             | spec 33 (reservada)                  |
| Carteira e desconto de moedas no Craft                                  | D-07: outra frente em breve; a costura `CurrencyPort` já fica pronta                                                                            | frente de carteira                   |
| MOVEMENT, SENSE, SPELL-LIKE genéricos                                   | triagem G/A/N: reuso baixo e geometria/visão fora do modelo (visão, névoa e colisão fora pela spec 41)                                          | notas e resolução assistida na F7    |
| MeasuredTemplate persistido                                             | spec 06 DEC-CNV-06 segue [V2]; aqui só prévia efêmera                                                                                           | spec 06                              |
| Mecânica de ator no SF2e                                                | a superfície é registrada só no pf2e                                                                                                            | issue de dívida aberta na F1-07      |
| Strike, ActorTraits, CriticalSpecialization, Aura, EphemeralEffect (RE) | fora do Alquimista (42/29/22/12/8 regras no pin)                                                                                                | issue do motor de RE                 |

## Apêndice A — Renomeações, fusões e remoções

| Original                                         | Consolidado                             | O que mudou                                                                                              |
| ------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ALQ-F4-05 (materializador pf2e)                  | fundida em ALQ-F2-08                    | duplicata com a F2-08: uma tarefa só, na fase mais cedo; dependentes da F4 passam a apontar para a F2-08 |
| ALQ-F6-16 (Powerful Alchemy)                     | fundida em ALQ-F3-11 + uso na ALQ-F6-08 | mesma função `max(DC, Class DC)`; o print foi para a F6-10 (visão GM)                                    |
| —                                                | ALQ-F4-19 (nova)                        | migração dos scanners antigos para o registro (D-10)                                                     |
| —                                                | ALQ-F2-17 (nova)                        | porte da curadoria e do pt-BR dos 35 alquímicos do #107 (D-09)                                           |
| Q-01 (F2) e P3/DD-04 (F6) "passar tempo"         | nenhuma tarefa                          | D-05 fechou sem botão; a aflição fora de combate avança pelo Mestre (F6-09)                              |
| ALQ-F7-03 (`ActionBudget`)                       | removida                                | D-15, fora do escopo                                                                                     |
| ALQ-F7-04 (UI do contador de ações)              | removida                                | D-15, fora do escopo                                                                                     |
| ALQ-F7-02 (`ActionCost`)                         | mantida, reduzida                       | só dado exibido                                                                                          |
| ALQ-F7-11                                        | reduzida                                | Quick Alchemy sem gasto de ação; Abundant Vials vira nota/assistida                                      |
| ALQ-F7-05                                        | ajustada                                | aceite por permissão + frequência, sem orçamento                                                         |
| ALQ-F7-07 (Unstable Concoction)                  | parte movida para ALQ-F5-11             | o flat check com dano é da F5-11; a F7-07 fica com o degrau de dado                                      |
| ALQ-F0-03, F0-08, F0-09 (emendas de spec soltas) | absorvidas pela ALQ-F1-01               | uma emenda serializada na spec 17 em vez de três PRs de spec                                             |
| ALQ-F0-03                                        | retitulada                              | de "fora do picker por setting" para trait `legacy` + selo + filtro (D-01)                               |
| ALQ-F6-09, ALQ-F6-10                             | retituladas                             | save de estágio sai da anotação de estado temporizado (D-16)                                             |
| ALQ-F4-18                                        | modelo haiku → sonnet                   | alinhado aos outros roteiros, que exigem olhar prints                                                    |
| REQ-PF2-206..217 (F2)                            | REQ-PF2-217..228                        | colisão com a F0/F1                                                                                      |
| REQ-PF2-055a (F2)                                | REQ novo na faixa da F2 + emenda do 055 | id com sufixo não é garantido pelo spec-lint                                                             |
| REQ-SYS-138..141 (F2)                            | REQ-SYS-143..144                        | colisão com a F1                                                                                         |
| REQ-SYS-142..145 (F3)                            | REQ-SYS-145..148                        | colisão com a F1/F2                                                                                      |
| REQ-SYS-091..094 (F4)                            | REQ-SYS-149..152                        | a F4 citava "próximos livres" errados (o maior é 137)                                                    |
| REQ-PF2-206..207 (F4)                            | REQ-PF2-229..230                        | colisão                                                                                                  |
| REQ-PF2-208..212 (F5)                            | REQ-PF2-231..235                        | colisão                                                                                                  |
| `specs/NN-*` (F6, F7)                            | 48 (AFL) e 49 (ACO)                     | numeração decidida; 46 segue reservada para Recipientes                                                  |

Conflitos de contrato resolvidos: formas de `ApplyDamage` (três variantes), registro de `TurnHooks` (quatro variantes, faltavam `onRoundEnd`/`onCombatEnd`), alvos no clique × na rolagem (D-02), `effectRef` único × lista, `onStrikeResolved` × `onRollResolved`, `beforeItemCreated` × `registerCraftingDraftHook`, `areaTemplateId` × `AreaQuery`, e o path da proficiência em bomba (`attacks.other[]` da F0 × path do AEL do vendor): vale o mapa por chave `system.proficiencies.attacks["weapon-base-alchemical-bomb"]`, que o AEL consegue endereçar.

Ciclos e órfãs: nenhum ciclo; a spec da F4 (F4-01), a revisão adversarial (F6-04) e o pt-BR de estágios (F6-07) estavam sem dependentes e iam para o fim da fila. Agora a F4-01 bloqueia os handlers com comportamento novo, a F6-04 bloqueia a F6-08 e a F6-07 entra no roteiro da F6.

## Apêndice B — Achados dos planejadores

| Achado                                                                                                                             | Evidência                                                     | Consequência                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| O PR #57 do satélite publica 15 classes (27 no total), não só o Alquimista; o Alquimista tem 67 talentos, 16 pré-remaster          | `feats-core` no branch do PR                                  | F0-01 mede, F0-03 marca `legacy`                           |
| `Research Field` é `GrantItem` com placeholder `{item\|flags.system.rulesSelections.researchField}` descartado pelo materializador | `grantMaterializer.ts:136-150,242`                            | F0-06 + F0-07                                              |
| Hooks `CombatSystemHooks.turnStart/turnEnd` existem e o servidor nunca os chama; o bus é fire-and-forget                           | `system-api/src/combat.ts:79-98`, `socket-manager.ts:420-428` | F1-04                                                      |
| `applyDamagePipeline` e `applyHealing` são puros e sem chamador; `applyHealing` ignora PV temp.                                    | `pf2e/src/actions/damage.ts:119,215`                          | F1-06                                                      |
| O derive-runner só transforma **condições** em EffectSource; efeito colado não muda número                                         | `derive-runner.ts:163-181`                                    | F2-08                                                      |
| `embeddedModifiers` só lê `feat/heritage/classFeature/ancestry`, nunca `effect`                                                    | `embeddedModifiers.ts:40`                                     | justificou migrar os scanners (D-10) em vez de pular kinds |
| Vendor usa unidades no plural; o schema aceita singular                                                                            | `transform.mjs:1443-1467`                                     | F2-02 normaliza                                            |
| Bomba é `weapon` (não `consumable`); 70 munições alquímicas são `ammo`, tipo não registrado                                        | raw do vendor                                                 | F2-13 e DF-10                                              |
| 575 itens alquímicos remaster no vendor                                                                                            | `out/equipment/raw.json`                                      | F2-03                                                      |
| O #107 (build/app) já publicou 35 alquímicos em `equipment-core` com curadoria e pt-BR                                             | `origin/build/app:systems/pf2e/packs/equipment-core/`         | F2-17 porta em vez de refazer                              |
| Não existe relógio de mundo; o Descansar é só cliente                                                                              | 0 hits de `worldTime`; `characterSheetVM.ts:2733-2805`        | D-05; F3-05 vira pipeline de servidor                      |
| O vendor declara `SpecialResource` e o transform descarta                                                                          | `transform.mjs:161`                                           | F3-03                                                      |
| `AdjustModifier` é convertido como `flat-modifier` em 93 regras: Weapon Specialization soma +3 **e** +4                            | `transform.mjs:485`                                           | F4-04 converte; F4-12 resolve                              |
| 169 `roll-note` e 328 `roll-option` convertidos nunca chegam ao motor; o texto das notas é removido do pack                        | `derive-runner.ts:215`; `textStripped:true`                   | F2-08, F4-09, F4-11                                        |
| Grau de sucesso já é autoritativo no servidor, e o card com botões (`registerCardAction`) já existe                                | `chat-handler.ts:475-525`; `shared/chat/types.ts:161`         | F4-09, F4-13, F6-08 reusam                                 |
| A UI de familiar já existe no satélite (`pets/*`); a nota do vault olhou só `packages/client`                                      | `sheets/pf2e/.../pets/`, `CharacterSheet.svelte:163`          | F7-13 é P                                                  |
| 72 venenos remaster (não 71); um parser ingênuo estrutura 58 (80%) e os 14 restantes caem em 4 padrões                             | `raw.json`                                                    | F6-05 parser + F6-06 curadoria com gate 72/72              |
| Virulent **exige dois saves bem-sucedidos seguidos** para baixar 1 estágio (não acelera nada)                                      | texto do trait (conferir no pack na F6-01)                    | F6-03                                                      |
| O limite de mutágeno é regra do trait `mutagen` (vale para qualquer criatura), não do Mutagenist                                   | texto do trait                                                | F6-18                                                      |
| O efeito do mutágeno já vem estruturado no pack de efeitos; só falta separar benefício e desvantagem                               | `Effect: Bestial Mutagen (Lesser)`                            | F6-17 é partição, não parser                               |
| `FeatSystemSchema` já tem `actionType`/`actions`; só consumíveis têm o custo no HTML                                               | `item-feat.ts`; `ActionsTab.svelte:138`                       | F7-02 normaliza só consumíveis                             |
| Improved/Supreme Invigorating Elixir só estendem o Invigorating Elixir (additive)                                                  | notas de regra                                                | F7-09                                                      |
| A proficiência da F0 (`attacks.other[]`) não é endereçável pelo AEL do vendor (`attacks.weapon-base-alchemical-bomb.rank`)         | `derivations/character.ts:304,365,407`                        | contrato ajustado para mapa por chave                      |
