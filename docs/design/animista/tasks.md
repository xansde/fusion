# Animista — plano de tarefas consolidado (A-F0 a A-F4)

> Origem: inventário do Animista no vault (`Projects/fusion/animista/`), conferido contra o código em 2026-09-16, mais as decisões do Alexandre da mesma data.
> Linha: **pessoal alfa** (`alfa/app` @ `5e208936`; satélite `fusion-systems-2e` pin `v0.1.1`). Toda branch parte de `origin/feat/animista` e volta por PR de lote; satélite com PR no `xansde/fusion-systems-2e` + bump de pin no core.
> Processo: TDD não circular, rolagem e permissão no servidor, redação só via `net/redaction.ts` + `isRolePrivileged`, UI por `docs/design/PROCESSO-UI.md` com o protótipo `docs/design/animista/prototipo-animista.html` como lente obrigatória, porta de teste via `helpers/ports.ts`.
> Execução: skill `/animista` (`.claude/skills/animista/`), sobre os scripts genéricos de `.claude/skills/_frentes/`.

**Totais**: 40 tarefas — A-F0: 8 · A-F1: 9 · A-F2: 11 · A-F3: 7 · A-F4: 5. 10 ondas de código + 3 faixas de lote de prints.

**O que este plano NÃO cobre, por decisão de 2026-09-16:** as fases compartilhadas com o Alquimista. A fundação de combate (aplicar dano, cura, condição, TurnHooks) e o motor de rule elements e efeitos (RuleElementRegistry, AEL, MOD-ADJUST, ITEM-ALTER, EFFECT-DUR, pack de efeitos) são entregues pelo plano do Alquimista; aqui elas aparecem só como dependência externa, nomeadas pela tarefa `ALQ-*` que as entrega. A economia de ações (custo, frequência, ação anterior) segue fora de escopo nas duas frentes (D-15 do Alquimista) — 28 documentos do Animista dependem dela e continuam sem fechar.

## 1. Decisões fechadas

### 1.1 Decisões do Alexandre (2026-09-16)

| ID | Tema | Decidido | Tarefas afetadas |
| --- | --- | --- | --- |
| D-A01 | Alcance do pack de magias | `isSpellsCoreDoc` passa a aceitar **todas as tradições**, todas as raridades, **sem rituais**: +488 documentos (3,03 MB → 4,20 MB). Ritual é sistema à parte e não afeta a jogabilidade. | ANI-F1-07, ANI-F1-08 |
| D-A02 | Arquétipo Animista | **Fora deste plano.** Os 7 documentos existem no vendor, mas publicá-los exige código novo no importer (dedicação entra por branch literal por nome). Vira frente separada. | — (registrado em §8) |
| D-A03 | Proficiência de conjuração | Entra, e resolvida de forma **genérica**: hoje nenhuma classe conjuradora sai de treinado. | ANI-F0-07 |
| D-A04 | pt-BR | Lote único e cedo, na A-F0, com o gate do `qa.mjs`. As 488 magias novas têm lote próprio na A-F1, junto do pack. | ANI-F0-04, ANI-F0-05, ANI-F1-08 |
| D-A05 | Sintonia diária | Acontece **durante o descanso**, e tem que poder ser ajustada manualmente a qualquer momento, para exceção de mesa. | ANI-F2-02, ANI-F2-03 |
| D-A06 | Tipos de conjuração | Vira **motor próprio**, um build à parte: preparada, espontânea e foco modeladas num módulo puro, em vez de remendo na ficha. | ANI-F1-01 |
| D-A07 | Refocar | É **só um botão** (+1 ponto), não uma atividade de exploração com relógio. | ANI-F2-08 |
| D-A08 | Sustentar | A ação **nasce da conjuração**: lançou algo sustentado, aparece a anotação no canto (Mestre + afetado) com a rodada e o botão junto. Mesmo padrão da D-16 do Alquimista. | ANI-F3-01, ANI-F3-02 |
| D-A09 | Postura | **Uma por vez**, com a exclusividade imposta pelo sistema. | ANI-F3-03 |
| D-A10 | Aura | **Acompanha o token**, não fica presa a um ponto do mapa. | ANI-F3-04, ANI-F3-05 |
| D-A11 | Avatar e formas de batalha | **Cartão assistido**: os números da forma ficam num cartão pronto para rolar e a ficha continua a do personagem. Troca automática de statblock fica para depois. | ANI-F4-01, ANI-F4-02 |
| D-A12 | Skill de execução | Parametrizada por frente em `.claude/skills/_frentes/`; `/alquimista` fica intocada enquanto a frente dela roda. | — (feito) |
| D-A13 | Branches | `feat/animista` **separada**, nos dois repos, nascida da mesma base do PR #57. | — (feito) |
| D-A14 | Spec | Spec nova no padrão do metamodelo, que já nasce passando no `spec-lint`. | ANI-F0-01 |

### 1.2 Decisões herdadas do plano do Alquimista (valem aqui, não se rediscutem)

| ID | Decisão | Onde pesa no Animista |
| --- | --- | --- |
| D-05 | Sem relógio de mundo: efeito expira no descanso/preparação ou por remoção manual | duração das vessel spells fora de combate |
| D-13 | Fim de turno roda hooks automáticos para PC e NPC | contagem de rodada da magia sustentada |
| D-15 | Contador de ações por turno fora de escopo; custo é dado exibido | 28 documentos do Animista seguem sem fechar |
| D-16 | Estado temporizado vira anotação no canto para Mestre e afetado | sustentar, postura e forma de batalha usam o mesmo slot |
| DF-04 | TurnHooks aguardados em série, com id e prioridade | expiração e pulso de aura |
| DF-06 | Efeito é cópia embutida do pack, com origem e início | vessel spells e posturas |
| DF-20 | Área é resolvedor puro compartilhado + prévia efêmera | emanação da aura |

### 1.3 Numeração de specs

| Spec | Prefixo | Dono | Estado |
| --- | --- | --- | --- |
| 50 — `50-animista-e-conjuracao-dupla.md` | `REQ-ANI-` | ANI-F0-01 | nova |

`ANI` conferido livre no bloco `prefixos` de `specs/README.md`; 46 segue reservada (Recipientes) e 47/48/49 são do plano do Alquimista.

Reserva de ids nas specs existentes, **acima do que o Alquimista já reservou** (ele vai até `REQ-PF2-235`, `REQ-SYS-152`):

| Faixa | Tarefa dona |
| --- | --- |
| `REQ-ANI-001..060`, `DEC-ANI-01..12` | ANI-F0-01 |
| `REQ-PF2-236..244` | ANI-F0-01 (emendas da 17) |
| `REQ-SYS-153..158` | ANI-F1-01 (emendas da 15) |
| `REQ-CNV-097..099` | ANI-F3-04 (emenda da 06, emanação) |
| `REQ-CBT-061..062` | ANI-F3-01 (emenda da 10, sustentar no turno) |

## 2. Contratos canônicos

Um shape por contrato. A tarefa dona fixa em spec e tipa; quem consome segue o nome e a forma daqui.

| Contrato | Dono | Consumidores |
| --- | --- | --- |
| `SpellcastingModel` | ANI-F1-01 | ANI-F1-02..05, ANI-F2-05, ANI-F2-07 |
| `ClassSpellcasting[]` (N progressões) | ANI-F1-02 | ANI-F1-03, ANI-F1-06 |
| `Repertoire` | ANI-F1-04 | ANI-F1-05, ANI-F2-05, ANI-F4-02 |
| `AttunementState` | ANI-F2-01 | ANI-F2-02..08, ANI-F2-10, ANI-F4-02 |
| `TempSkillGrant` | ANI-F2-04 | ANI-F2-10 |
| `FocusPoolDerivation` | ANI-F2-07 | ANI-F2-06, ANI-F2-08 |
| `SustainedEffect` | ANI-F3-01 | ANI-F3-02, ANI-F3-05, ANI-F4-02 |
| `StanceGroup` | ANI-F3-03 | ANI-F4-04 |
| `AuraAttachment` | ANI-F3-04 | ANI-F3-05 |
| `FlatCheck` | ANI-F3-06 | ANI-F4-03 |
| `BattleFormCard` | ANI-F4-01 | ANI-F4-02, ANI-F4-04 |

### 2.1 `SpellcastingModel` — o motor de tipos (D-A06)

```ts
// systems/engine-2e/src/spellcasting/ — puro, sem dependência de ator concreto.
type CastingKind = "prepared" | "spontaneous" | "focus";

interface SlotPool { rank: number; max: number; spent: number }
interface PreparedBinding { rank: number; index: number; spellId: string; expended: boolean }
interface RepertoireEntry { spellId: string; minRank: number; signature: boolean }

interface CastingModel {
  kind: CastingKind;
  pools: SlotPool[];                       // vazio para focus
  prepared?: PreparedBinding[];            // só prepared
  repertoire?: RepertoireEntry[];          // só spontaneous
}

/** O que pode ser lançado agora, e a que custo. Uma função, três modelos. */
castableAt(model: CastingModel, spellId: string): { ranks: number[]; reason?: "no-slot" | "not-known" | "not-prepared" };
/** Gasto: devolve o modelo novo, nunca muta. Erra alto se o rank não for legal. */
spend(model: CastingModel, spellId: string, rank: number): CastingModel;
/** Recarga da preparação diária: prepared mantém o que está preparado e zera expended. */
recharge(model: CastingModel): CastingModel;
```

O ponto do motor é que `castableAt` responde diferente por `kind` sem que a ficha saiba a regra: preparada devolve o rank do vínculo, espontânea devolve **todos** os ranks com espaço livre a partir de `minRank` (por isso o seletor de patamar), foco devolve o rank de auto-intensificação. Nenhuma das três decisões vive no componente Svelte.

### 2.2 `ClassSpellcasting[]` e `Repertoire`

```ts
// Hoje: ClassSystemSchema.spellcasting?: ClassSpellcastingSchema (UM). Passa a array.
interface ClassSpellcasting {
  key: string;                 // "animist" | "apparition" — estampado em flags.fusion.entryKey
  label: string;               // "Magias Animistas" | "Magias de Aparição"
  type: CastingKind;
  tradition: "arcane" | "divine" | "occult" | "primal";
  ability: "int" | "wis" | "cha";
  cantripsKnown: { level: number; count: number }[];
  slots: { level: number; slots: Record<string, number> }[];
  repertoireFrom?: "attunement";  // espontânea cujo repertório é derivado, não escolhido
  allSignature?: boolean;         // Animista: todo o repertório de aparição é signature
}
```

Compatibilidade: um `spellcasting` objeto único continua sendo aceito na curadoria e é normalizado para array de um elemento no importer — as 26 classes já publicadas não mudam de saída (provado pelo snapshot de `ALQ-F4-03`).

### 2.3 `AttunementState`, `TempSkillGrant` e `FocusPoolDerivation`

```ts
// system.fusion.attunement no ator
interface AttunementState {
  prepId: string;                 // preparação diária que gerou este estado
  slots: number;                  // 2 (nv1) → 3 (nv7) → 4 (nv15), derivado das features
  attuned: string[];              // sourceIds das aparições do dia
  primary: string | null;         // uma delas; Medium pode ter duas (nv9)
  manual: boolean;                // true quando editado fora do descanso (D-A05)
}
// etapa registrada na pipeline da ALQ-F3-05: registerDailyPrepStep({ id: "pf2e.attunement", order: 350 })
// needsChoice devolve as 14 opções; run grava o estado, as Lore e o repertório derivado.

interface TempSkillGrant { slug: string; label: string; rank: 1; source: { kind: "attunement"; apparitionId: string } }
// concedida ao entrar na sintonia, revogada ao sair — nunca vira Lore permanente de addLoreSkill.

interface FocusSource { label: string; amount: number; sourceId: string }
deriveFocusMax(sources: FocusSource[]): { max: number; breakdown: FocusSource[] }; // clampa em 3
// A UI mostra o breakdown ("1 base · +1 Terceira Aparição"), nunca um campo digitado.
```

### 2.4 `SustainedEffect`, `StanceGroup`, `AuraAttachment`, `FlatCheck`, `BattleFormCard`

```ts
interface SustainedEffect {
  effectItemId: string; originActorId: string; spellSourceId: string;
  startedAt: { combatId: string | null; round: number | null };
  maxRounds: number | null;         // 1 min = 10 rodadas
  sustainedThisRound: boolean;      // o pulso de aura só sai na 1ª sustentação da rodada
  endsAt: "unsustained" | "duration";
}
// ações: spell:sustain { actorId, effectItemId } · spell:dismiss { actorId, effectItemId }
// onTurnEnd do dono: não sustentou → expira, com card. Alimenta o TimedStateNote da ALQ-F6-10 (D-16).

interface StanceGroup { group: "stance"; effectItemId: string }
// entrar numa postura remove qualquer efeito com o mesmo group no mesmo ator, numa op só.

interface AuraAttachment { effectItemId: string; anchorTokenId: string; shape: "emanation"; sizeFt: number }
resolveAuraTargets(scene, tokens, aura): { tokenIds: string[] };  // reusa resolveAreaTargets da ALQ-F5-05
// a aura anda com o token: a lista é recalculada na leitura, nunca persistida.

rollFlatCheck(dc: number): { roll: number; success: boolean };   // rolagem no servidor, como toda rolagem

interface BattleFormCard {                                        // D-A11
  label: string; apparitionId: string; sizeLabel: string;
  ac: number; tempHp: number; speeds: { kind: string; ft: number }[];
  strikes: { name: string; attack: number; damage: string; traits: string[] }[];
  immunities: string[]; notes: string[];
}
// A ficha não é substituída: o cartão é um TimedStateNote com botões de rolagem próprios.
```

## 3. Regras de colisão

- Tarefas na mesma onda têm **arquivos disjuntos** (campo Onde). Os mais disputados aqui: `planVM.ts`, `characterSheetVM.ts`, `SpellsTab.svelte`, `CharacterSheet.svelte`, `build-mvp-subset.mjs`, `transform.mjs`, `effectsEngine.ts` e `index.ts` do `systems/pf2e`.
- **Colisão com a frente do Alquimista, que roda em paralelo sobre a mesma base.** Medido tarefa a tarefa: `characterSheetVM.ts` (7 tarefas do Alquimista), `CharacterSheet.svelte` (7), `transform.mjs` (8), `index.ts` (6), `planVM.ts` (3), `build-mvp-subset.mjs` (2), `effectsEngine.ts` (3). `SpellsTab.svelte`, `item-spellcasting-entry.ts` e o pack `spells-core` **não são tocados por nenhuma tarefa do Alquimista** — é onde o Animista corre livre. Mitigação em §7.
- Teto de 6 tarefas por onda; roteiros de print rodam em faixa só-leitura depois que o lote fecha.

## 4. Tarefas

### A-F0 — Classe e eixos no ar

### ANI-F0-01 — Spec 50 (`REQ-ANI`) + emendas da 17

- **Repo**: core
- **Onde**: nova `specs/50-animista-e-conjuracao-dupla.md`; `specs/README.md` (bloco `prefixos`); emendas em `specs/17-sistema-pf2e.md`; `specs/RASTREABILIDADE.md` via `pnpm spec:report`
- **Entrega**: Spec de área no padrão do metamodelo (`specs/CONVENCOES.md`): decisões `DEC-ANI-01..12` com racional, requisitos `[MVP]`/`[V2]`, seções na ordem canônica. Fixa: duas progressões na mesma classe, repertório derivado da sintonia, sintonia como escolha diária com primária, pool de foco derivado, sustentar, postura exclusiva, aura ancorada e forma de batalha assistida. Registra `REQ-ANI-` na tabela de prefixos.
- **Depende de**: —
- **Paralelo com**: ANI-F0-02, ANI-F1-01
- **Modelo / esforço**: opus / high — é o documento que amarra o resto.
- **Teste (TDD)**: `spec-lint` verde (prefixo com dono, id único, citação resolvível, req com tag, decisão canônica) + `pnpm spec:report` regenerado.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-ANI-001..060`, `REQ-PF2-236..244`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### ANI-F0-02 — Validar o PR #57 no recorte do Animista

- **Repo**: satélite
- **Onde**: PR `xansde/fusion-systems-2e#57`; `sheets/pf2e/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts`; packs `classes-core`, `class-features-core`, `feats-core`
- **Entrega**: Roda a suíte de `sheets-pf2e` dentro do core montado e comenta no PR o inventário do Animista: 1 classe, 15 features, 4 práticas, 14 aparições, 39 talentos, cobertura pt-BR. Confirma que `animist` entrou em `KNOWN_CLASS_TRAITS` (o PR adiciona 6 traits) e que a varredura de nível 1–20 roda para a classe nova. Não mergeia: o merge do #57 é gate humano.
- **Depende de**: —
- **Paralelo com**: ANI-F0-01, ANI-F1-01
- **Modelo / esforço**: haiku / low — executa e mede.
- **Teste (TDD)**: sem código novo; a prova é a suíte verde colada no comentário.
- **Prova visual (print)**: coberta por ANI-F0-06.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 1 · **Lote**: L1

### ANI-F0-03 — Pin do satélite e varredura de regressão das 27 classes

- **Repo**: core
- **Onde**: `external/fusion-systems-2e` (pin); `specs/RASTREABILIDADE.md`
- **Entrega**: O core em `feat/animista` aponta para a cabeça da `feat/animista` do satélite. Suíte do core verde, com atenção a `packages/client` e `sheets-pf2e`, e o teto do `build:release` conferido. Roda a regressão de snapshot da `ALQ-F4-03` para garantir que nenhuma das 26 outras classes mudou de derivação.
- **Depende de**: ANI-F0-02
- **Paralelo com**: ANI-F1-02, ANI-F2-01
- **Modelo / esforço**: haiku / low — mecânico.
- **Teste (TDD)**: suíte existente; sem teste novo.
- **Prova visual (print)**: coberta por ANI-F0-06.
- **Spec/REQ**: —
- **Tamanho**: P
- **Onda**: 2 · **Lote**: L1

### ANI-F0-04 — pt-BR da classe, práticas, aparições e features (lote A)

- **Repo**: satélite
- **Onde**: `tools/translate-packs` (extract → grants-from-rules → apply → qa); `systems/pf2e/packs/{classes-core,class-features-core}/i18n.pt-BR.json`
- **Entrega**: Traduz os documentos novos do Animista nesses dois packs: a classe, as 15 features, as 4 práticas e as 14 aparições, incluindo o texto das invocações de nível 1/9/17 e as perícias de Saber de cada aparição. Glossário do projeto aplicado (aparição, sintonizar, magia de vaso, primária).
- **Depende de**: ANI-F0-02
- **Paralelo com**: ANI-F0-05, ANI-F1-03
- **Modelo / esforço**: sonnet / medium — volume com gate mecânico.
- **Teste (TDD)**: `node src/qa.mjs` sem falha nos 5 checks (fórmulas, tags balanceadas, glossário, razão de tamanho, sem enricher novo); contagem de entradas traduzidas = contagem de documentos novos.
- **Prova visual (print)**: coberta por ANI-F0-06 (ficha em pt-BR).
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L1

### ANI-F0-05 — pt-BR dos 39 talentos de classe (lote B)

- **Repo**: satélite
- **Onde**: `tools/translate-packs`; `systems/pf2e/packs/feats-core/i18n.pt-BR.json`
- **Entrega**: Traduz os 39 talentos de classe do Animista, marcando no glossário os termos que se repetem (postura, wandering, aparição sintonizada). Os 12 talentos com o traço `wandering` recebem nota de mesa enquanto ANI-F2-09 não existe.
- **Depende de**: ANI-F0-02
- **Paralelo com**: ANI-F0-04, ANI-F1-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `qa.mjs` verde; nenhum talento sem entrada.
- **Prova visual (print)**: picker de talentos em pt-BR, na ANI-F0-06.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L1

### ANI-F0-06 — Eixo "Prática Animista" no picker

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (`CLASS_CHOICE_SLOTS`, `CHOICE_SLOT_REQUIRED_CLASS`, tabela espelho de `GRANTED_FEAT_CHOICES` ~935); `choiceSetInventory.ts` (de `pendente` para ativo); `PlanColumn.svelte`
- **Entrega**: O eixo de nível 1 aparece no builder com as 4 práticas (Liturgista, Médium, Vidente, Xamã), e escolher uma concede o talento inicial dela pelo `GrantItem` com placeholder — que a `ALQ-F0-07` generaliza. Sem isso a classe publica sem uma das decisões de nível 1.
- **Depende de**: ANI-F0-03, ANI-F0-04, **ALQ-F0-07** (placeholder de GrantItem dinâmico)
- **Paralelo com**: ANI-F1-04, ANI-F2-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `planVM.animist-practice.test.ts`: as 4 opções vêm do pack (não de lista escrita no teste); escolher Xamã concede Familiar Espiritual (Animista); o inventário de ChoiceSets não tem mais a entrada `pendente`; nenhuma outra classe ganha o eixo.
- **Prova visual (print)**: player no builder do Animista nível 1, eixo "Prática Animista" aberto com as 4 opções e Liturgista selecionado; segunda tela com "Círculo de Espíritos" concedido na ficha.
- **Spec/REQ**: `REQ-ANI-010..013`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L1

### ANI-F0-07 — Proficiência de conjuração que progride (transversal)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/spellcasting.ts` (:48-57 lê rank estático), `derivations/build.ts` (:280-311 não inclui conjuração), `tools/importer-pf2e/src/curation/proficiency-upgrades.mjs`
- **Entrega**: A proficiência de ataque e CD de magia passa a ser **derivada** por nível de classe, como já acontece com perícia, salvaguarda e CD de classe: Expert/Master/Legendary Spellcaster deixam de ser texto. O Animista sobe no 7, 15 e 19. Vale para **todas** as classes conjuradoras publicadas — hoje Clérigo, Mago, Feiticeiro, Bardo e os demais ficam em treinado para sempre.
- **Depende de**: ANI-F0-03
- **Paralelo com**: ANI-F1-04, ANI-F2-01
- **Modelo / esforço**: opus / high — mexe na derivação de 27 classes.
- **Teste (TDD)**: `spellcasting-proficiency.test.ts`, asserção pela regra escrita no teste (não pela tabela do pack): Mago nível 7 = expert, 15 = master, 19 = legendary; Animista idem; Bárbaro segue sem entrada. Regressão da `ALQ-F4-03` roda de novo: só os conjuradores mudam de snapshot, e só no campo de proficiência.
- **Prova visual (print)**: ficha do Animista nível 7, aba Magias: selo de proficiência **E** e CD 25 (era 23 com treinado).
- **Spec/REQ**: `REQ-ANI-020..022`, `REQ-PF2-236`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L1

### ANI-F0-08 — Roteiro tutorial-e2e da A-F0

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/animista-f0.spec.ts`; prints em `.fusion-build/animista/L1/f0/`
- **Entrega**: Roteiro que cria um Animista nível 1 e um nível 7 num mundo existente, com servidor isolado e data-dir no scratchpad, e fotografa: classe no builder, eixo de prática, ficha em pt-BR, CD e proficiência. Relatório P3 com protótipo × tela.
- **Depende de**: ANI-F0-06, ANI-F0-07
- **Paralelo com**: faixa de lote
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L1

### A-F1 — Conjuração dupla

### ANI-F1-01 — Motor de tipos de conjuração no `engine-2e` (D-A06)

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/spellcasting/{model.ts,castable.ts,spend.ts,index.ts}`; export em `systems/engine-2e/src/index.ts`; emenda em `specs/15-api-de-sistemas.md`
- **Entrega**: Módulo puro com `CastingModel`, `castableAt`, `spend` e `recharge` (§2.1). É onde a diferença entre preparada, espontânea e foco passa a morar — hoje ela não existe em lugar nenhum: `prepared.value` só rotula a entrada e o componente trata os três iguais. Sem dependência de documento concreto, para o SF2e herdar.
- **Depende de**: —
- **Paralelo com**: ANI-F0-01, ANI-F0-02
- **Modelo / esforço**: opus / high — é o contrato central da frente.
- **Teste (TDD)**: `engine-2e/src/__tests__/spellcasting.test.ts`, regra do PF2e escrita no teste: espontânea com Golpe Certeiro (mínimo 1º) e espaços livres no 2º e 3º devolve `ranks: [2,3]`; preparada devolve só o rank do vínculo; foco devolve metade do nível; gastar rank sem espaço erra; `recharge` mantém o vínculo da preparada e zera `expended`.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-ANI-030..038`, `REQ-SYS-153..155`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L2

### ANI-F1-02 — Uma classe pode declarar N progressões

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/schemas/item-equipment.ts` (:432-440, :500-501); `tools/importer-pf2e/src/transform.mjs` (:1848-1876 `spellcastingFor`); `tools/importer-pf2e/src/curation/index.mjs`
- **Entrega**: `ClassSystemSchema.spellcasting` aceita array (§2.2), com objeto único normalizado para array de um — as 26 classes publicadas saem idênticas. O teto de "uma progressão por classe" cai nas três camadas ao mesmo tempo, porque está replicado nelas.
- **Depende de**: ANI-F1-01, ANI-F0-03
- **Paralelo com**: ANI-F0-04, ANI-F0-05
- **Modelo / esforço**: sonnet / high — schema + importer, com regressão.
- **Teste (TDD)**: `class-spellcasting-array.test.ts`: curadoria com objeto único → array de 1, sem diff de pack; curadoria com duas progressões → duas entradas com `key` distinto; `key` duplicado erra alto.
- **Prova visual (print)**: coberta por ANI-F1-05.
- **Spec/REQ**: `REQ-ANI-039..042`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### ANI-F1-03 — Escolher a classe cria as duas entradas

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (`applyClass` ~3139-3206, `buildSpellcastingEntryOp` ~3225, `buildFocusEntryOp` ~3259)
- **Entrega**: `applyClass` passa a iterar as progressões da classe e criar uma entrada por `key`, estampando `flags.fusion.entryKey`, em vez de chamar a criação uma vez. A entrada de foco continua como está. Multiclasse (`chooseClassLevel` ~5016-5079) segue funcionando: cada classe traz as suas.
- **Depende de**: ANI-F1-02
- **Paralelo com**: ANI-F0-04, ANI-F0-05
- **Modelo / esforço**: sonnet / high — caminho quente do builder.
- **Teste (TDD)**: `planVM.dual-spellcasting.test.ts`: Animista nível 1 → 3 entradas (animista, aparição, foco) com tradições e tipos certos; Feiticeiro segue com 2; Guerreiro com 0; multiclasse Animista/Clérigo não mistura `entryKey`.
- **Prova visual (print)**: coberta por ANI-F1-05.
- **Spec/REQ**: `REQ-ANI-043..045`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### ANI-F1-04 — Repertório espontâneo: schema e derivação

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/schemas/item-spellcasting-entry.ts` (:19-42); `systems/pf2e/src/derivations/spellcasting.ts`
- **Entrega**: A entrada espontânea passa a carregar `repertoire: RepertoireEntry[]` e `allSignature`, e a derivação expõe o repertório resolvido. `repertoireFrom: "attunement"` marca que a lista é derivada (ANI-F2-05), não escolhida à mão.
- **Depende de**: ANI-F1-01
- **Paralelo com**: ANI-F0-06, ANI-F0-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `repertoire.test.ts`: entrada com 10 magias devolve 10 lançáveis; `allSignature` faz toda magia aceitar rank acima do mínimo; entrada preparada ignora o campo.
- **Prova visual (print)**: coberta por ANI-F1-05.
- **Spec/REQ**: `REQ-ANI-046..048`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### ANI-F1-05 — Aba de aparição: espaços genéricos e escolha de patamar

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/SpellsTab.svelte` (grade ~901-988, `heightenChrome` ~783-811); `characterSheetVM.ts` (`spellTabs` ~1537)
- **Entrega**: A aba de uma entrada espontânea deixa de usar a grade de preparada: mostra o repertório e, por patamar, quantos espaços genéricos restam; lançar abre o seletor de patamar entre os que têm espaço. Consome `castableAt` — nenhuma regra de patamar no componente. Bardo e Feiticeiro herdam a mesma tela.
- **Depende de**: ANI-F1-03, ANI-F1-04
- **Paralelo com**: ANI-F2-03, ANI-F2-04
- **Modelo / esforço**: opus / high — é a tela central da classe.
- **Teste (TDD)**: `SpellsTab.spontaneous.test.ts`: entrada espontânea não renderiza "Preparar do grimório"; lançar no 3º com espaço no 3º gasta o 3º; sem espaço no 3º, a opção some do seletor; preparada não ganha seletor.
- **Prova visual (print)**: tela 1 do protótipo — player na aba "Magias de Aparição", repertório visível, espaços por patamar e "Golpe Certeiro" sendo lançado no 3º. Comparar lado a lado com `prototipo-animista.html`.
- **Spec/REQ**: `REQ-ANI-049..053`
- **Tamanho**: G
- **Onda**: 5 · **Lote**: L2

### ANI-F1-06 — Curadoria do Animista com as duas metades

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/curation/classes/animist.json`
- **Entrega**: A metade de aparição sai de `notes[]` e vira dado: segunda progressão com `type: "spontaneous"`, `repertoireFrom: "attunement"`, `allSignature: true`, truques 2→3 (nv7)→4 (nv15), 1 espaço por patamar subindo a 2 a partir do nível 10, e o 10º patamar só no 19. Mantém a nota de conferência contra o pregen oficial.
- **Depende de**: ANI-F1-02
- **Paralelo com**: ANI-F1-04, ANI-F2-01
- **Modelo / esforço**: sonnet / medium — dado medido, com fonte citada.
- **Teste (TDD)**: `animist-curation.test.ts`: as duas progressões batem célula a célula com a tabela do journal escrita no teste; a metade animista nunca tem rank 10 sem True Channel Spell; a de aparição só ganha rank 10 no nível 19.
- **Prova visual (print)**: coberta por ANI-F1-05 e ANI-F2-06.
- **Spec/REQ**: `REQ-ANI-054`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### ANI-F1-07 — Abrir o `spells-core` para todas as tradições (D-A01)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/build-mvp-subset.mjs` (`isSpellsCoreDoc` :920-935)
- **Entrega**: O critério passa a aceitar magia de **qualquer** tradição, em qualquer raridade, excluindo ritual (`system.ritual`). Medido: 1262 → 1750 documentos (+488), `documents.json` de 3,03 MB → 4,20 MB, longe do teto de 150 MB do `build:release`. Fecha as 24 magias que faltavam nas listas de aparição e a lista divina inteira; Clérigo, Druida, Bardo, Oráculo e Bruxa ganham junto.
- **Depende de**: ANI-F0-03
- **Paralelo com**: ANI-F2-01, ANI-F2-04
- **Modelo / esforço**: sonnet / medium — uma função, muita regressão.
- **Teste (TDD)**: `spells-core-subset.test.ts`: as 22 originais continuam; nenhum ritual entra; Ill Omen e Wrathful Storm (ausentes hoje) entram; contagem bate com a medição; todo doc novo tem `flags.fusion.sourceId`.
- **Prova visual (print)**: compêndio do GM filtrado por tradição divina, mostrando magia que hoje não existe (ex.: Bênção).
- **Spec/REQ**: `REQ-ANI-055`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### ANI-F1-08 — pt-BR das 488 magias novas

- **Repo**: satélite
- **Onde**: `tools/translate-packs`; `systems/pf2e/packs/spells-core/i18n.pt-BR.json`
- **Entrega**: Cobertura pt-BR volta a 100% no `spells-core` (hoje é 1262/1262 e cada magia nova entra sem tradução). Lote grande, com glossário e `qa.mjs` como gate.
- **Depende de**: ANI-F1-07
- **Paralelo com**: ANI-F2-05, ANI-F2-06
- **Modelo / esforço**: sonnet / high — volume.
- **Teste (TDD)**: `qa.mjs` verde; contagem de entradas = contagem de documentos; nenhuma entrada `stale` por `sourceHash`.
- **Prova visual (print)**: picker de magias em pt-BR na ANI-F2-06.
- **Spec/REQ**: —
- **Tamanho**: G
- **Onda**: 5 · **Lote**: L2

### ANI-F1-09 — Roteiro tutorial-e2e da A-F1

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/animista-f1.spec.ts`; prints em `.fusion-build/animista/L2/f1/`
- **Entrega**: Fotografa as duas abas de conjuração do mesmo personagem, o seletor de patamar em uso, e prova que gastar espaço numa metade não mexe na outra. Smoke como GM e como player.
- **Depende de**: ANI-F1-05, ANI-F1-08
- **Paralelo com**: faixa de lote
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio roteiro.
- **Prova visual (print)**: telas 1 e 2 do protótipo, lado a lado com a implementação.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L2

### A-F2 — Sintonia diária

### ANI-F2-01 — Estado de sintonia no ator

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/schemas/actor-character.ts`; novo `systems/pf2e/src/attunement/state.ts`
- **Entrega**: `system.fusion.attunement` (§2.3) com as aparições do dia, a primária, o número de vagas derivado das features (2 → 3 no nível 7 → 4 no 15) e a marca de edição manual. Funções puras de validar: não aceita mais aparições que vagas, nem primária fora das sintonizadas.
- **Depende de**: ANI-F0-03
- **Paralelo com**: ANI-F1-06, ANI-F1-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `attunement-state.test.ts`: nível 1 aceita 2 e recusa 3; nível 7 aceita 3; primária fora da lista erra; Médium no nível 9 aceita duas primárias.
- **Prova visual (print)**: coberta por ANI-F2-03.
- **Spec/REQ**: `REQ-ANI-060..063`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### ANI-F2-02 — Sintonia como etapa da preparação diária (D-A05)

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/src/actions/daily-prep/attunement.ts`, registrado com `order: 350`; `characterSheetVM.ts` (`restAll` ~2733-2805)
- **Entrega**: A etapa entra na pipeline de `DailyPrep` da `ALQ-F3-05`: pede a escolha, grava o estado, concede as Lore, recalcula o repertório e libera a magia de vaso da primária. Etapa que lança aborta sem escrita parcial, como as outras.
- **Depende de**: ANI-F2-01, **ALQ-F3-05** (pipeline de preparação diária)
- **Paralelo com**: ANI-F1-05, ANI-F2-04
- **Modelo / esforço**: sonnet / high — op de servidor com transação.
- **Teste (TDD)**: `daily-prep-attunement.test.ts` (helper de porta): descansar sem escolha não muda a sintonia de ontem; com escolha, troca as três coisas de uma vez; escolha inválida aborta a transação inteira.
- **Prova visual (print)**: tela 3 do protótipo.
- **Spec/REQ**: `REQ-ANI-064..067`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### ANI-F2-03 — Painel de sintonia (descanso e ajuste manual)

- **Repo**: satélite
- **Onde**: novo `sheets/pf2e/src/components/sheets/pf2e/AttunementPanel.svelte` + VM própria; ponto de montagem em `CharacterSheet.svelte`
- **Entrega**: O painel do protótipo: as 14 aparições, quantas faltam escolher, marcar a primária, e o que cada uma traz (Lore, magia de vaso, repertório). Sai do fluxo de Descansar e também de um botão "Ajustar manualmente", que marca o estado como manual (D-A05).
- **Depende de**: ANI-F2-02
- **Paralelo com**: ANI-F2-05, ANI-F2-07
- **Modelo / esforço**: opus / high — UI nova com estado de escolha.
- **Teste (TDD)**: `AttunementPanel.test.ts`: confirmar com 2 de 3 escolhidas fica desabilitado; trocar a primária troca a magia de vaso listada; ajuste manual fora do descanso grava `manual: true`.
- **Prova visual (print)**: tela 3 do protótipo, comparada lado a lado.
- **Spec/REQ**: `REQ-ANI-068..071`
- **Tamanho**: G
- **Onda**: 7 · **Lote**: L2

### ANI-F2-04 — Lore temporária da sintonia

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/attunement/skills.ts`; `derivations/character.ts`; `planVM.ts` (`addLoreSkill` ~4645 fica só para Lore permanente)
- **Entrega**: Cada aparição sintonizada concede as suas duas Lore enquanto durar, e as revoga ao sair — sem passar por `addLoreSkill`, que só sabe criar permanente e não tem remoção. A ficha marca a perícia como vinda da sintonia.
- **Depende de**: ANI-F2-01
- **Paralelo com**: ANI-F1-07, ANI-F2-02
- **Modelo / esforço**: sonnet / high — derivação com origem.
- **Teste (TDD)**: `temp-lore.test.ts`: sintonizar Custódia concede Agricultura e Herbalismo em treinado; dessintonizar remove as duas; Lore permanente com o mesmo nome sobrevive e não vira temporária.
- **Prova visual (print)**: aba Perícias com as 6 Lore marcadas como "da sintonia", e sem elas depois de trocar o dia.
- **Spec/REQ**: `REQ-ANI-072..074`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### ANI-F2-05 — Repertório derivado das aparições sintonizadas

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/attunement/repertoire.ts`; `derivations/spellcasting.ts`
- **Entrega**: A entrada de aparição tem o repertório montado a partir das aparições do dia (10 magias cada), sem duplicata, com o mínimo de patamar de cada magia. Trocar a sintonia troca o repertório na mesma operação.
- **Depende de**: ANI-F1-04, ANI-F2-02
- **Paralelo com**: ANI-F1-08, ANI-F2-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `derived-repertoire.test.ts`: 3 aparições → união sem repetida; magia em duas listas aparece uma vez com o menor mínimo; Embodiment of the Balance acrescenta Curar e Ferir ao conjunto.
- **Prova visual (print)**: coberta por ANI-F1-05.
- **Spec/REQ**: `REQ-ANI-075..077`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L2

### ANI-F2-06 — Magia de vaso da primária

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/attunement/vessel.ts`; `SpellsTab.svelte` (aba Foco ~1022-1085)
- **Entrega**: A aba Foco mostra a magia de vaso da primária como lançável, e as das outras sintonizadas como indisponíveis com o motivo ("não é a primária de hoje"). Trocar a primária troca qual está ativa.
- **Depende de**: ANI-F2-05, ANI-F2-07
- **Paralelo com**: ANI-F1-08, ANI-F3-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `vessel-spell.test.ts`: primária Testemunha → Encarnação da Batalha lançável e Jardim da Cura bloqueado com motivo; trocar inverte; nenhuma vessel spell aparece sem sintonia.
- **Prova visual (print)**: tela 4 do protótipo.
- **Spec/REQ**: `REQ-ANI-078..080`
- **Tamanho**: M
- **Onda**: 9 · **Lote**: L2

### ANI-F2-07 — Pool de foco derivado

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/build.ts` (`stepCharFocusClamp` :663-688 passa a derivar, não só clampar); `CharacterSheet.svelte` (:458-462 sai o input manual)
- **Entrega**: `focusPoints.max` passa a sair das fontes que concedem foco, com o detalhamento visível ("1 base · +1 Terceira Aparição"), em vez de nascer 0 e depender de alguém digitar. Third e Fourth Apparition somam pelo `ActiveEffectLike` que a `ALQ-F4-06` liga. Teto de 3 continua.
- **Depende de**: ANI-F2-01, **ALQ-F4-06** (AEL com allowlist de path)
- **Paralelo com**: ANI-F2-03, ANI-F2-05
- **Modelo / esforço**: sonnet / high — derivação que hoje não existe.
- **Teste (TDD)**: `focus-pool.test.ts`: Animista nível 1 → max 1; nível 7 → 2; nível 15 → 3; nível 20 com Círculo de Espíritos → continua 3; classe sem foco → 0. Confirma que `system.resources.focus.max` está na allowlist do AEL.
- **Prova visual (print)**: tela 4 do protótipo — pips e a origem do teto.
- **Spec/REQ**: `REQ-ANI-081..084`
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L2

### ANI-F2-08 — Refocar como botão (D-A07)

- **Repo**: satélite
- **Onde**: `SpellsTab.svelte` (:1098-1100, hoje só texto); `characterSheetVM.ts`; `AttunementPanel.svelte` (troca de primária)
- **Entrega**: "Refocar" vira botão que devolve 1 ponto (nunca acima do máximo) e é onde a primária pode ser trocada sem refazer a sintonia. O descanso continua enchendo o pool.
- **Depende de**: ANI-F2-07, ANI-F2-03
- **Paralelo com**: ANI-F3-02, ANI-F3-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `refocus.test.ts`: 0/2 → 1/2; 2/2 → continua 2/2; trocar a primária no Refocar troca a magia de vaso e não mexe nas Lore.
- **Prova visual (print)**: tela 4 do protótipo, antes e depois do clique.
- **Spec/REQ**: `REQ-ANI-085..086`
- **Tamanho**: P
- **Onda**: 10 · **Lote**: L2

### ANI-F2-09 — Talentos trocáveis na preparação (`wandering`)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/curation/` (traço `wandering` preservado); `systems/pf2e/src/actions/daily-prep/wandering.ts`; `planVM.ts` (picker filtrado)
- **Entrega**: Os 12 talentos do Animista com o traço podem ser trocados por outro elegível na preparação diária, sem retreinamento. Etapa própria na pipeline, depois da sintonia.
- **Depende de**: ANI-F2-02
- **Paralelo com**: ANI-F2-06, ANI-F3-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `wandering-feats.test.ts`: talento sem o traço não aparece para troca; trocar Espírito Flamejante por Coração Rugidor mantém o nível do slot; talento com pré-requisito não cumprido não entra na lista.
- **Prova visual (print)**: preparação diária com a troca de um talento de nível 6.
- **Spec/REQ**: `REQ-ANI-087..089`
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L3

### ANI-F2-10 — Requisito ligado à Lore da aparição

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/attunement/skills.ts`; avaliação de requisito de ação
- **Entrega**: Talento que exige "uma aparição sintonizada que conceda Saber X" passa a checar o estado real da sintonia, com mensagem dizendo qual Lore falta. São 4 talentos.
- **Depende de**: ANI-F2-04
- **Paralelo com**: ANI-F3-03, ANI-F3-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `apparition-skill-gate.test.ts`: Coração da Floresta com Custódia sintonizada libera; sem ela, bloqueia dizendo "exige Saber: Floresta ou Herbalismo"; Lore permanente de mesmo nome não satisfaz (a regra pede a da sintonia).
- **Prova visual (print)**: aba Ações com o talento bloqueado e o motivo, e liberado depois de trocar a sintonia.
- **Spec/REQ**: `REQ-ANI-090..091`
- **Tamanho**: M
- **Onda**: 9 · **Lote**: L3

### ANI-F2-11 — Roteiro tutorial-e2e da A-F2

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/animista-f2.spec.ts`; prints em `.fusion-build/animista/L2/f2/`
- **Entrega**: Um dia inteiro: descansar, sintonizar três aparições, ver as Lore entrarem, lançar a magia de vaso, refocar e trocar a primária. Smoke GM e player.
- **Depende de**: ANI-F2-08, ANI-F2-06
- **Paralelo com**: faixa de lote
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio roteiro.
- **Prova visual (print)**: telas 3 e 4 do protótipo, lado a lado.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 11 · **Lote**: L2

### A-F3 — Sustentar, posturas e auras

### ANI-F3-01 — Ação Sustentar (D-A08)

- **Repo**: ambos
- **Onde**: core `packages/server/src/net/handlers/` (`spell:sustain`, `spell:dismiss`) + linha em `socket-manager.ts`; satélite `systems/pf2e/src/spells/sustain.ts` e hook `onTurnEnd`
- **Entrega**: Lançar magia com duração sustentada cria o efeito com `SustainedEffect` (§2.4). Sustentar marca a rodada e estende; não sustentar expira no fim do turno do dono, com card. `Dismiss` encerra na hora.
- **Depende de**: **ALQ-F2-09** (expiração por TurnHooks), **ALQ-F1-04** (runner de TurnHooks)
- **Paralelo com**: ANI-F2-08, ANI-F2-09
- **Modelo / esforço**: opus / high — borda de turno com autoridade no servidor.
- **Teste (TDD)**: `sustain.test.ts` (helper de porta): efeito de 10 rodadas não sustentado expira no fim do turno do conjurador, não no do alvo; sustentado, sobrevive e marca `sustainedThisRound`; sustentar duas vezes na mesma rodada não estende duas vezes; jogador que não é dono recebe `PERMISSION_DENIED`.
- **Prova visual (print)**: coberta por ANI-F3-02.
- **Spec/REQ**: `REQ-ANI-100..105`, `REQ-CBT-061..062`
- **Tamanho**: G
- **Onda**: 6 · **Lote**: L3

### ANI-F3-02 — Anotação no canto para magia sustentada

- **Repo**: satélite
- **Onde**: `registerTimedStateProvider` (da `ALQ-F6-10`), novo provider de magia sustentada
- **Entrega**: Toda magia sustentada ativa aparece na anotação de canto do Mestre e do dono, com o nome, em que rodada está, se o pulso da rodada já saiu, e os botões Sustentar e Encerrar. Nada de card automático por rodada.
- **Depende de**: ANI-F3-01, **ALQ-F6-10** (slot de anotação no HUD)
- **Paralelo com**: ANI-F3-03, ANI-F3-06
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `sustained-note.test.ts`: três usuários — dono e GM veem a anotação, o terceiro não; contagem de rodada bate com o estado; encerrar remove a anotação.
- **Prova visual (print)**: tela 5 do protótipo, comparada lado a lado.
- **Spec/REQ**: `REQ-ANI-106..108`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

### ANI-F3-03 — Postura com exclusividade (D-A09)

- **Repo**: satélite
- **Onde**: `systems/engine-2e/src/effectsEngine.ts` (hoje `toggleCondition` não tem noção de grupo); `systems/pf2e/src/spells/stance.ts`; aba Ações
- **Entrega**: Efeito com `StanceGroup` é exclusivo: entrar numa postura remove a anterior na mesma operação, sem o jogador precisar lembrar. Vale para os 59 documentos com o traço `stance` já publicados, não só para os 6 do Animista.
- **Depende de**: **ALQ-F2-08** (efeitos de item chegando ao motor)
- **Paralelo com**: ANI-F2-10, ANI-F3-02
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: `stance.test.ts`: entrar em Postura do Canalizador com Postura da Floresta ativa deixa só a segunda; sair encerra sem deixar efeito órfão; dois atores diferentes não interferem.
- **Prova visual (print)**: tela 5 do protótipo — postura ativa e a troca.
- **Spec/REQ**: `REQ-ANI-109..111`
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L3

### ANI-F3-04 — Emanação ancorada no token (D-A10)

- **Repo**: ambos
- **Onde**: core `packages/shared/src/grid/math.ts` (emanação, que hoje não tem cálculo) + camada `templates` do canvas; satélite `systems/pf2e/src/spells/aura.ts`
- **Entrega**: `AuraAttachment` (§2.4): a emanação é desenhada a partir do token de origem e acompanha o movimento dele; a lista de quem está dentro é recalculada na leitura. Reusa `resolveAreaTargets` da `ALQ-F5-05`, que cobre explosão e cone mas não emanação.
- **Depende de**: **ALQ-F5-05** (resolvedor de área), **ALQ-F5-06** (prévia no canvas)
- **Paralelo com**: ANI-F2-10, ANI-F3-06
- **Modelo / esforço**: opus / high — geometria com render.
- **Teste (TDD)**: `emanation.test.ts`: emanação de 3 m a partir de token médio pega as 8 casas adjacentes e a própria; token grande mede da borda; mover o token muda a lista; regra escrita no teste, não tirada do pack.
- **Prova visual (print)**: tela 6 do protótipo — o círculo acompanhando o token, visto pelo GM e por outro jogador.
- **Spec/REQ**: `REQ-ANI-112..115`, `REQ-CNV-097..099`
- **Tamanho**: G
- **Onda**: 9 · **Lote**: L3

### ANI-F3-05 — Pulso de aura ao sustentar

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/spells/aura.ts`; card de resolução
- **Entrega**: Sustentar uma magia de aura resolve o efeito sobre quem está dentro **naquele momento** — para o Jardim da Cura, 1d4 de cura por criatura, uma vez por rodada. O sistema calcula em quem; quem sustenta aperta o botão. Usa o `ApplyDamage`/cura da `ALQ-F1-06`.
- **Depende de**: ANI-F3-04, ANI-F3-01, **ALQ-F1-06** (aplicar dano e cura)
- **Paralelo com**: ANI-F4-01, ANI-F4-03
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: `aura-pulse.test.ts`: primeira sustentação da rodada cura os de dentro; a segunda não; quem saiu da área não é curado; intensificar aumenta o dado.
- **Prova visual (print)**: tela 6 do protótipo — card do pulso e PV dos dois aliados subindo.
- **Spec/REQ**: `REQ-ANI-116..118`
- **Tamanho**: M
- **Onda**: 10 · **Lote**: L3

### ANI-F3-06 — Teste simples (flat check) genérico

- **Repo**: ambos
- **Onde**: core `packages/server/src/chat/roll-service.ts` (rolagem no servidor); satélite `systems/engine-2e/src/flatCheck.ts`
- **Entrega**: Primitiva de teste simples com CD, rolada no servidor, com card próprio. Hoje não existe em lugar nenhum — nem o teste de recuperação do Morrendo rola: `applyRecoveryCheck` recebe o grau pronto e não tem quem a chame. Fecha Estabilização da Aparição (CD 15/13/10) e a vessel spell Espelhos do Trapaceiro.
- **Depende de**: **ALQ-F1-12** (recovery check como TurnHook)
- **Paralelo com**: ANI-F3-02, ANI-F3-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `flat-check.test.ts`: CD 15 com rolagem forçada 14 falha e 15 passa; a CD cai para 13 com Terceira Aparição e 10 com Quarta; o card mostra a CD só para quem pode ver.
- **Prova visual (print)**: card de teste simples no chat durante uma conjuração interrompida.
- **Spec/REQ**: `REQ-ANI-119..121`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

### ANI-F3-07 — Roteiro tutorial-e2e da A-F3

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/animista-f3.spec.ts`; prints em `.fusion-build/animista/L3/f3/`
- **Entrega**: Combate curto: entra em postura, lança a magia de aura, sustenta duas rodadas, deixa de sustentar e vê expirar. Smoke GM e player.
- **Depende de**: ANI-F3-05, ANI-F3-03
- **Paralelo com**: faixa de lote
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio roteiro.
- **Prova visual (print)**: telas 5 e 6 do protótipo.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 11 · **Lote**: L3

### A-F4 — Formas de batalha e avatar

### ANI-F4-01 — Cartão de forma de batalha (D-A11)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/curation/` (o bloco de avatar de cada aparição vira dado estruturado); novo `systems/pf2e/src/spells/battle-form.ts`; provider de anotação
- **Entrega**: `BattleFormCard` (§2.4): os números da forma saem da prosa de cada aparição e viram dado — CA, PV temporários, deslocamentos, golpes com ataque e dano, imunidades. Enquanto a forma dura, o cartão fica na anotação de canto com os botões de rolagem. A ficha do personagem **não** é substituída.
- **Depende de**: ANI-F3-01, **ALQ-F4-16** (modificador de golpe)
- **Paralelo com**: ANI-F3-05, ANI-F4-03
- **Modelo / esforço**: opus / high — extração de dado + UI de estado.
- **Teste (TDD)**: `battle-form.test.ts`: as 14 formas extraídas têm CA, PV temporário e ao menos um golpe; General das Batalhas Sem Fim tem deslocamento 21 m e imunidade a imobilizado; rolar o golpe usa o ataque da forma, não o do personagem.
- **Prova visual (print)**: tela 7 do protótipo, opção A.
- **Spec/REQ**: `REQ-ANI-130..135`
- **Tamanho**: G
- **Onda**: 10 · **Lote**: L3

### ANI-F4-02 — Avatar no nível 19

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/attunement/vessel.ts`; curadoria da progressão de aparição (10º patamar no nível 19)
- **Entrega**: Encarnação Suprema concede o 10º patamar na metade de aparição, e lançar Avatar por ele assume a forma da **primária do momento** — não a lista de divindades da magia original. Trocar a primária no Refocar troca qual forma sai.
- **Depende de**: ANI-F4-01, ANI-F2-06, ANI-F1-07 (a magia Avatar entra no pack com a abertura de tradições)
- **Paralelo com**: ANI-F4-03, ANI-F4-04
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: `avatar.test.ts`: nível 18 não tem 10º patamar, 19 tem; lançar com Testemunha primária traz o General; trocar a primária traz outra forma; a lista de divindades do documento original é ignorada para o Animista.
- **Prova visual (print)**: coberta por ANI-F4-01.
- **Spec/REQ**: `REQ-ANI-136..138`
- **Tamanho**: M
- **Onda**: 11 · **Lote**: L3

### ANI-F4-03 — Fortune e misfortune

- **Repo**: ambos
- **Onde**: core `packages/server/src/chat/roll-service.ts`; satélite `systems/engine-2e/src/fortune.ts`
- **Entrega**: Primitiva de rolar duas vezes e ficar com o melhor (fortune) ou o pior (misfortune), com as duas se anulando quando incidem na mesma rolagem. Hoje não existe nada disso no servidor. Fecha Sussurros Perturbadores e três talentos.
- **Depende de**: ANI-F3-06
- **Paralelo com**: ANI-F4-01, ANI-F4-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `fortune.test.ts`: misfortune com 18 e 4 usa 4; fortune usa 18; os dois juntos rolam uma vez só; o card mostra os dois dados e qual valeu.
- **Prova visual (print)**: card de ataque do inimigo sob Sussurros Perturbadores, com os dois dados.
- **Spec/REQ**: `REQ-ANI-139..141`
- **Tamanho**: M
- **Onda**: 10 · **Lote**: L3

### ANI-F4-04 — Talentos de forma e de postura de nível alto

- **Repo**: satélite
- **Onde**: curadoria dos talentos; `battle-form.ts`; `stance.ts`
- **Entrega**: Os talentos que acrescentam forma ou postura passam a funcionar sobre as peças já prontas: Caminhar as Selvas (Forma Animal no repertório, sustentação estendida), Coração da Floresta e Gracejo do Bufão (postura com golpe próprio), Inclinações Monstruosas.
- **Depende de**: ANI-F4-01, ANI-F3-03, ANI-F2-10
- **Paralelo com**: ANI-F4-02, ANI-F4-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: `animist-form-feats.test.ts`: Caminhar as Selvas acrescenta Forma Animal ao repertório derivado; Coração da Floresta só entra em postura com a Lore exigida; o golpe da postura usa 4d8 e alcance de 9 m.
- **Prova visual (print)**: aba Ações com a postura ativa e o golpe de raízes disponível.
- **Spec/REQ**: `REQ-ANI-142..144`
- **Tamanho**: M
- **Onda**: 11 · **Lote**: L3

### ANI-F4-05 — Roteiro tutorial-e2e da A-F4 + fechamento

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/animista-f4.spec.ts`; prints em `.fusion-build/animista/L3/f4/`; relatório do lote
- **Entrega**: Animista nível 19: lança Avatar, rola o golpe da forma, encerra. Relatório P3 do L3 com protótipo × tela das sete telas, e o resumo do que ficou sem fechar (os 28 documentos presos à economia de ações).
- **Depende de**: ANI-F4-02, ANI-F4-04
- **Paralelo com**: faixa de lote
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio roteiro.
- **Prova visual (print)**: tela 7 do protótipo.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 12 · **Lote**: L3

## 5. Ondas

Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do pin no core com a suíte verde.

| Onda | Tarefas | Repo | Espera algo de fora |
| --- | --- | --- | --- |
| 1 | ANI-F0-01, ANI-F0-02, ANI-F1-01 | ambos | — |
| 2 | ANI-F0-03 | core | **merge humano do PR #57 + tag** |
| 3 | ANI-F0-04, ANI-F1-02, ANI-F2-01 | satélite | — |
| 4 | ANI-F0-05, ANI-F1-03, ANI-F1-04, ANI-F1-06, ANI-F1-07 | satélite | — |
| 5 | ANI-F0-06, ANI-F0-07, ANI-F1-05, ANI-F1-08 | satélite | ALQ-F0-07 (GrantItem dinâmico) |
| 6 | ANI-F0-08, ANI-F2-02, ANI-F2-04, ANI-F3-01 | ambos | ALQ-F3-05 (preparação diária), ALQ-F2-09 (expiração), ALQ-F1-04 (TurnHooks) |
| 7 | ANI-F2-03, ANI-F2-05, ANI-F3-02, ANI-F3-06 | ambos | ALQ-F6-10 (anotação no canto), ALQ-F1-12 (teste de recuperação) |
| 8 | ANI-F1-09, ANI-F2-07, ANI-F2-09, ANI-F3-03 | ambos | ALQ-F4-06 (AEL), ALQ-F2-08 (efeitos chegando ao motor) |
| 9 | ANI-F2-06, ANI-F2-10, ANI-F3-04 | ambos | ALQ-F5-05 e ALQ-F5-06 (área e prévia) |
| 10 | ANI-F2-08, ANI-F3-05, ANI-F4-01, ANI-F4-03 | ambos | ALQ-F1-06 (aplicar dano e cura), ALQ-F4-16 (modificador de golpe) |
| 11 | ANI-F2-11, ANI-F3-07, ANI-F4-02, ANI-F4-04 | ambos | — |
| 12 | ANI-F4-05 | core | — |

Fechamento por fase: A-F0 na onda 6 · A-F1 na onda 8 · A-F2 na onda 11 · A-F3 na onda 11 · A-F4 na onda 12.

Caminho crítico: ANI-F1-01 → ANI-F1-02 → ANI-F1-03 → ANI-F1-04 → ANI-F1-05 → ANI-F2-05 → ANI-F2-06 → ANI-F4-02. O motor de conjuração abre a fila e não depende de nada externo: começa na onda 1, junto com a spec.

**As ondas 5 a 10 dependem do plano do Alquimista.** A mais exposta é a 7, que espera a `ALQ-F6-10` — onda 16 das 19 dele. Se aquela frente atrasar, a tarefa fica `bloqueada` no estado e as dependentes esperam a rodada seguinte; nunca se reimplementa a peça do outro plano.

## 6. Lotes de print

Regras comuns: servidor isolado em mundo existente com data-dir no scratchpad, fora da worktree; primeiro passo confere a branch com `git merge-base --is-ancestor`; um print por tarefa com UI, visão GM e player; prints em `.fusion-build/animista/<lote>/<fase>/`; relatório P3 em `.fusion-build/animista/<lote>/relatorio.html`, com **protótipo × tela** contra `docs/design/animista/prototipo-animista.html`.

| Lote | Fases | Roteiros | Fecha na onda |
| --- | --- | --- | --- |
| L1 | A-F0 | ANI-F0-08 | 5 |
| L2 | A-F1, A-F2 | ANI-F1-09, ANI-F2-11 | 9 |
| L3 | A-F3, A-F4 | ANI-F3-07, ANI-F4-05 | 11 |

## 7. Riscos

| Risco | Efeito | Mitigação |
| --- | --- | --- |
| PR #57 não mergeia | A-F0 inteira para, e com ela a classe | A onda 1 (spec + motor de conjuração) roda sem ele; a frente trabalha na `feat/animista` do satélite, que já nasce da cabeça do PR |
| **Duas frentes sobre a mesma base** | conflito no merge dos PRs de lote | As tarefas do Animista concentram-se em arquivos que o Alquimista não toca (`SpellsTab.svelte`, `item-spellcasting-entry.ts`, `spells-core`); onde há sobreposição (`characterSheetVM.ts`, `CharacterSheet.svelte`, `transform.mjs`, `planVM.ts`), a tarefa entra por componente/arquivo novo e o `CharacterSheet.svelte` recebe só o ponto de montagem |
| Ondas 6–10 esperam o Alquimista | calendário refém da outra frente | Cada tarefa nomeia a `ALQ-*` que espera; se atrasar, ela fica `bloqueada` no estado e a rodada seguinte tenta de novo — nunca se reimplementa a peça do outro plano |
| ANI-F0-07 mexe na derivação de 27 classes | regressão silenciosa em conjurador publicado | Snapshot da `ALQ-F4-03` como critério: só o campo de proficiência muda, e só em conjurador |
| +488 magias no pack | pt-BR regride de 100% para 72% até a ANI-F1-08 | As duas tarefas estão na mesma fase e a de tradução é gate do lote L2 |
| Extração dos blocos de avatar é prosa | dado errado no cartão de forma | Teste com as 14 formas e conferência contra o texto de cada aparição; forma sem número obrigatório falha o build do pack |
| Teste circular (lição #48) | verde com regra errada | Asserção pela regra do PF2e escrita no teste; revisão adversarial por onda |

## 8. Fora do escopo / futuro

| Item | Motivo | Onde retomar |
| --- | --- | --- |
| Arquétipo Animista (7 documentos) | D-A02: existe no vendor, mas publicar exige branch novo no importer, que hoje trata dedicação por nome literal | frente própria, depois da A-F1 |
| Economia de ações (28 documentos do Animista) | D-15 do Alquimista: sem contador de ações por turno | spec 49 |
| Troca automática de statblock na forma de batalha | D-A11: cartão assistido primeiro | reusa `BattleFormCard` como fonte |
| Rituais no `spells-core` (166 documentos) | D-A01: sistema à parte, não afeta a jogabilidade da classe | quando houver frente de rituais |
| Sentidos e deslocamentos por rule element | `BaseSpeed` e `Sense` chegam limpos do importer e o motor não reconhece nenhum dos dois | issue do motor de rule elements |
| Práticas Liturgista e Xamã completas | as invocações de nível 9 e 17 dependem de economia de ações e de familiar incorpóreo | com a spec 49 e a 29 |
