# Barra de Ações — plano de tarefas consolidado (F0 a F8)

> Origem: `plano.md` (v1, aprovado em 11/10/2026) e `decisoes.md` (D-BA01..D-BA15), nesta pasta; telas-alvo em `prototipo-barra-fiel.html` (T1–T7). Conferido contra o código em 2026-10-11: core `alfa/app` `ff15043d`, satélite `main` = pin `2015ff7c` (329 commits depois da `v0.3.20`). Os dois estavam idênticos às referências do plano quando este arquivo foi escrito.
> Linha: **pessoal alfa**. Toda branch parte da `origin/docs/barra-de-acoes` (core: `alfa/app` + o plano) e da `origin/main` (satélite), **sempre depois de `git fetch origin`**, e volta por PR de lote; promoção é ato humano.
> Processo: TDD não circular (regra do PF2e escrita no teste, nunca a tabela do pack), rolagem e permissão no servidor, redação só via `server/net/redaction.ts` + `isRolePrivileged` (`server/documents/ownership.ts`), UI por `docs/design/PROCESSO-UI.md` (P1–P4) com `docs/design/barra-de-acoes/prototipo-barra-fiel.html` (telas T1–T7) como lente obrigatória, porta de teste via `server/__tests__/helpers/ports.ts`. Entregas pequenas: cada faixa verde vira commit na hora.
> Execução: skill `/barra-de-acoes` (`.claude/skills/barra-de-acoes/`), sobre os scripts genéricos de `.claude/skills/_frentes/`.

**O que esta frente é**: uma barra no rodapé da mesa, sempre do personagem (ou NPC) que está na mão, com golpes, magias, ações, itens, reações e testes a um clique ou a uma tecla, sem abrir a ficha e sem cobrir o mapa. O grosso do motor já existe e funciona na ficha: golpe com alvo e grau decidido pelo servidor, MAP contado no servidor, conjuração gastando slot e foco, ações executáveis do Bhrotto, mira por botão direito, `item:consume` no servidor. O que falta é a **casca** (store de ator ativo, tooltip e menu genéricos, a barra) e a **ponte core ↔ sistema**: a lógica da ficha está presa dentro de componentes Svelte e o core não tem como pedir ao sistema "quais as ações deste ator".

**Tamanho**: 36 tarefas em 9 fases (F0–F8) e 5 lotes. A **primeira entrega jogável é o L1 (F1 + F2)**: cada jogador de A Queda usa a barra do próprio PJ para golpe, magia, ações executáveis e testes, e o Mestre continua na ficha para os NPCs. O L2 traz Favoritos de verdade e a barra do Mestre para os NPCs.

**O que esta frente NÃO é** (detalhes no §8): não conta ações nem bloqueia nada (**D-15**), não é o Token HUD, não cria regra de jogo (tudo executa pelos mesmos caminhos da ficha) e **nunca** mostra a um jogador a barra de um ator que não é dele (**D-BA01**).

**Onde ela entra na fila (D-BA14)**: antes do resto do Alquimista, do Animista e do Guerreiro. Os planos dessas três frentes são de 16/09 e citam linhas que já mudaram. Onde a barra **absorve um recorte** deles (BAR-F5-01, BAR-F5-02, BAR-F7-02, BAR-F7-03), o cartão traz a linha **Conferir antes**: ler o cartão de origem e o código atual antes de virar código (lição do Guerreiro). A BAR-F4-01 (rolagens da ficha de NPC) **saiu da frente** e corre avulsa em `fix/npc-rolagens` (D-BA13).

**Estado inicial deste plano** (`estado.json`): BAR-F0-01 feita (protótipo aprovado em 11/10); BAR-F0-02 (spec 53, chega pela branch `docs/barra-spec-53`, que o orquestrador integra) e BAR-F0-03 (este plano) marcadas como feitas na mesma hora — se a spec falhar, o orquestrador corrige o estado; BAR-F4-01 fora da frente. Detalhes no `Situação` de cada cartão e na tabela de porteiras do §3.

## 1. Decisões

O texto integral e as frases do Alexandre estão em [`decisoes.md`](decisoes.md). Aqui, o resumo e a quais tarefas cada decisão pesa.

### 1.1 D-15, a decisão herdada que vale sobre tudo

**D-15** (decidida pelo Alexandre na frente do Alquimista; o `decisoes.md` a mantém sobre tudo aqui): **sem contador de ações por turno, sem pips de "ações restantes" e sem bloqueio.** A razão, nas palavras do plano §5.4: o contador "precisa desfazer, desistir e planejar sem nada contar ou bloquear". A barra só mostra o **custo** de cada entrada (dado de tela), o **MAP do próximo ataque** (que o servidor já conta e publica em `combat.attackCount`), **de quem é a vez** (responde à Q-CBA-01 da spec 40) e oferece **Encerrar turno**. Nenhum critério de aceite deste arquivo conta, soma ou impõe ação; se uma lane se vir escrevendo isso, o cartão está errado e ela devolve `bloqueada`. Se o contador um dia voltar, o lugar dele é a spec 49 (`REQ-ACO-`), já reservada.

### 1.2 Decisões do Alexandre (vinculantes, 11/10/2026)

As três primeiras vieram uma a uma durante o protótipo; as doze restantes eram as DC-01..DC-12 do plano, aceitas todas como recomendadas ("Concordo com os DCs ditos e pode seguir para a execução!"). Viram `DEC-BAR-01..15` na spec 53, na mesma ordem.

| ID     | Tema                 | Decidido                                                                                                                                                                                                                                                                                                                                                                                | Tarefas                                               |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| D-BA01 | Barra de ator alheio | O jogador **nunca** vê a barra de um ator que não é dele. Selecionar o token de um NPC, ou de outro jogador, não muda a barra, que continua no personagem do jogador. Só o Mestre vê a barra de NPC. Gate de posse no store do ator ativo, com teste negativo; o chip de alvo usa o nome redigido.                                                                                      | BAR-F1-01, BAR-F2-06, BAR-F4-02                       |
| D-BA02 | Ícone customizado    | Cada entrada aceita uma **imagem customizada**, se o usuário quiser; sem imagem, vale o ícone genérico. Mapa `flags.fusion.actionBar.icons[entryId]` → `/assets/…` (sem URL externa), com teto de entradas, registrado em `server/assets/asset-fields.ts`.                                                                                                                              | BAR-F3-05                                             |
| D-BA03 | Quem troca o ícone   | O jogador **só altera os ícones do próprio personagem**; o servidor recusa escrita em ator alheio, com teste negativo. O Mestre altera em qualquer um. O envio de imagem fica aberto a todo jogador (emenda na REQ-AST-011) e há uma galeria compartilhada só com os envios marcados como ícone; mapas, retratos e handouts seguem fora da lista do jogador.                            | BAR-F0-02, BAR-F3-05                                  |
| D-BA04 | Hotbar da spec 14    | A barra **substitui** a hotbar (REQ-MAC-012..018, REQ-UIF-006): é contextual ao personagem. A macro vira um `kind` de entrada no futuro.                                                                                                                                                                                                                                                | BAR-F0-02, BAR-F1-04, BAR-F1-05                       |
| D-BA05 | Onde mora o código   | **Casca no core, conteúdo pelo sistema**, via registry no padrão do `registerPf2eSheets` (como a ficha e o card de chat). O core só importa o satélite pelo ponto de entrada publicado (`@fusion/sheets-pf2e` → `sheets/pf2e/src/index.ts`), regra `client-core-must-not-import-system-sheets` do `.dependency-cruiser.cjs`.                                                            | BAR-F1-02, BAR-F2-01..BAR-F2-07                       |
| D-BA06 | Favoritos            | **No ator**: seguem o personagem em qualquer dispositivo, e o Mestre vê.                                                                                                                                                                                                                                                                                                                | BAR-F3-01                                             |
| D-BA07 | Composição           | **Favoritos (12 slots, teclas 1–9, 0, − e =) + abas por categoria** (Golpes, Magias, Ações, Itens, Reações, Testes).                                                                                                                                                                                                                                                                    | BAR-F1-04, BAR-F1-05, BAR-F3-01                       |
| D-BA08 | Semente              | **Semente na primeira abertura** (golpes, magias e ações mais usadas); depois só o jogador mexe. Nada novo entra sozinho.                                                                                                                                                                                                                                                               | BAR-F3-01                                             |
| D-BA09 | Rodapé               | Na alfa, **a barra é dona do centro-inferior**. Se as linhas convergirem, a barra de comando do Hub (spec 28, só na `build/app`) vira um grupo compacto na ponta da barra.                                                                                                                                                                                                              | BAR-F0-02, BAR-F1-04                                  |
| D-BA10 | Mestre sem seleção   | **Barra oculta.**                                                                                                                                                                                                                                                                                                                                                                       | BAR-F1-01, BAR-F1-04, BAR-F4-02                       |
| D-BA11 | Ações sem motor      | Desmoralizar, Fintar etc. **aparecem e postam o card da ação** (sem rolagem automática) até a F7.                                                                                                                                                                                                                                                                                       | BAR-F2-04, BAR-F7-01                                  |
| D-BA12 | Outras frentes       | **Absorver os recortes** de que a barra precisa (consumo de item, golpe de NPC, Desarmar/Reposicionar/Escapar, Erguer um Escudo e Bloqueio com Escudo); **esperar** só o pool de reação (GUE-F4-01), as posturas com estado (ANI-F3-03/GUE-F6-01) e o **contador** de recurso de classe (ALQ-F3-02/04). Ação de classe que já funciona na ficha (Caçar Presa) entra na F2 com o "Usar". | BAR-F4-01, BAR-F5-01, BAR-F5-02, BAR-F7-02..BAR-F7-06 |
| D-BA13 | Rolagens de NPC      | **Consertar já, avulso** (BAR-F4-01), antes da frente, em PR próprio para a `main` do satélite e a `alfa/app`.                                                                                                                                                                                                                                                                          | BAR-F4-01                                             |
| D-BA14 | Fila                 | **A barra entra antes** do resto do Alquimista, do Animista e do Guerreiro. F1–F4 não dependem deles.                                                                                                                                                                                                                                                                                   | BAR-F0-03                                             |
| D-BA15 | Nome no slot         | **Ícone (ou imagem) com o nome curto embaixo.** Sem a arte da Paizo, os ícones genéricos se repetem; o nome desfaz a dúvida.                                                                                                                                                                                                                                                            | BAR-F1-04, BAR-F3-05                                  |

### 1.3 Decisões herdadas (valem aqui, não se rediscutem)

| ID                 | Origem     | Decisão                                                                                                        | Onde pesa na barra                                                 |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| D-15               | Alquimista | Contador de ações por turno fora de escopo (§1.1)                                                              | toda tarefa; custo e MAP só exibidos                               |
| D-B08              | Bhrotto    | Peça de outra frente de que a frente precisa **entra neste plano**, com o contrato que o plano de origem fixou | BAR-F5-01, BAR-F5-02, BAR-F7-02, BAR-F7-03 (precedente do recorte) |
| D-B23              | Bhrotto    | Condição aparece como chip **só com o nome**; clicar revela o efeito                                           | faixa de estado (BAR-F1-04, BAR-F2-06)                             |
| DEC-CBA-05         | spec 40    | Mirar é gesto espacial e vive no canvas (botão direito no token; `Esc` limpa)                                  | BAR-F8-02 (modo mira não cria controle de mira em painel)          |
| REQ-A11-036        | spec 23    | Toda ação por arrastar tem alternativa sem arrastar                                                            | BAR-F3-02, BAR-F3-03                                               |
| REQ-TOK-032 / -034 | spec 41    | `ownedActorIdsOf` é o predicado de posse do client (leitura viva, role-blind)                                  | BAR-F1-01 (nada de predicado novo)                                 |

### 1.4 Numeração de specs

| Spec                | Prefixo                | Dono      | Estado                                                                                                                                 |
| ------------------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 53 — Barra de Ações | `REQ-BAR-`, `DEC-BAR-` | BAR-F0-02 | feita e publicada na branch `docs/barra-spec-53` (`67b6be90`: 104 `REQ-BAR`, `DEC-BAR-01..15`, `Q-BAR-01..11`); o orquestrador integra |

A BAR-F0-02 também emenda as specs 11 (REQ-UIF-001/006), 14 (REQ-MAC-012..018), 28 (REQ-HUB-007, convivência no rodapé), 40 (Q-CBA-01), 41 (DEC-TOK-19), 23 (tablet) e 20 (REQ-AST-011/029: envio de imagem aberto a jogador, D-BA03). Os ids `REQ-BAR-` de cada cartão vêm do rastreio da §5.17 da spec 53, como está na branch `docs/barra-spec-53` (commit `67b6be90`, ainda não integrada): **este arquivo não reserva número nenhum**. Depois da integração, a lane confere o id na spec antes de citá-lo em teste ou comentário. Duas emendas da §12 da spec ficam **registradas e não aplicadas**: a da **21** (REQ-SEC-043 e REQ-SEC-044, que contradizem o envio de imagem aberto ao jogador da D-BA03) é entregue pela **BAR-F3-05**, no mesmo PR da exceção do `asset-fields.ts` e da revisão adversarial do grant; a da **27** (a linha de `14` na tabela de marcos) é decisão do roadmap e não é tarefa desta frente.

## 2. Contratos canônicos

Um shape por contrato, com nome fixo. A tarefa dona escreve em código e em teste; quem consome segue o nome e a forma daqui. A spec 53 (branch `docs/barra-spec-53`, commit `67b6be90`, que o orquestrador integra) fixa os requisitos e traz o contrato mínimo na sua §7.1; **este arquivo o fecha**, e está alinhado a ela no que importa: o registry resolve por `documentType` + `subtype` como a ficha (REQ-BAR-012), o contexto traz `derived` e os alvos dentro de `combat`, os flags são planos (`favorites` + `seeded` + `icons`, §7.2) e o custo tem a forma do `ActionCost` da ALQ-F7-02 com o nome `ActionBarCost`, porque o client já tem outro `ActionCost` (Q-BAR-06). Acréscimos sobre o esboço do plano, todos necessários para as lanes: `ActionBarSlice` e `composeActionBarProvider` (as fatias da F2 ficam independentes na onda 2), `ActionBarVariant`, os campos `shortLabel`, `badge`, `groupUses`, `rank`, `countsForMap` e `effect` da entrada (todos vêm das telas T1–T4 e da D-BA15), `seed` do provedor (BAR-F3-01), `request`/`getSocket` nos serviços (o `item:consume` devolve resultado e o socket de uma janela velha congela) e a §2.8, com os pontos de contato entre tarefas da mesma onda.

**Cinco diferenças com a spec, já reconciliadas em 11/10:** a §7.1 da spec 53 passou a seguir este arquivo (commit `76309fbc`). Ficam aqui como registro, porque a spec e este arquivo nasceram do mesmo esboço, em lanes paralelas:

1. **O MAP.** O REQ-BAR-053 (normativo) manda o provedor de Golpes ler `attacksThisTurn`; a tabela do §7.1 põe "a contagem de ataques do turno" no `ActionBarCombatContext`. Este arquivo segue o REQ: o MAP tem regra própria (contagem velha por combatente e rodada, MAP separado do companheiro em `attackCount.byActor`) que já vive em `attackCountForActor`/`attacksThisTurn` do satélite, e duplicá-la no core abriria uma segunda verdade.
2. **Os alvos.** O §7.1 diz que `ActionBarServices` deixa o provedor "ler os alvos marcados"; aqui eles chegam em `choice.targetTokenIds` (a foto dos alvos no instante do clique) e em `ctx.combat.targets` (para exibir), e o provedor nunca lê alvo por conta própria. É a mesma informação por um caminho só.
3. **Os slots na faixa.** O REQ-BAR-059 e o plano §4.1 põem "os slots do patamar em foco" na faixa de estado; o protótipo aprovado (T3) os põe no cabeçalho do grupo da aba Magias (`groupUses`) e a faixa só traz Foco e Herói. Vale o protótipo (lente P1): a BAR-F2-06 o segue e o REQ pede emenda.
4. **O nome do custo.** A spec (§7.1) escreve `cost?: ActionCost` e deixa em aberto, na Q-BAR-06, quem declara o tipo e como ele deixa de dividir o nome com o outro. O client já exporta um `ActionCost` de **exibição** (`{ icons, label, isText }`, em `lib/compendium/documentDetails.ts`, usado pelo compêndio), e o do plano do Alquimista (ALQ-F7-02) é uma união estruturada que vive no satélite (`engine-2e/src/actionCost.ts`). Este arquivo dá à forma estruturada o nome **`ActionBarCost`** e reaproveita o `formatActionCost` existente para exibir (adaptador `actionBarCostToken`, BAR-F1-02): nunca dois `ActionCost` no client. A frente do Alquimista, parada, mantém o nome dela no satélite.
5. **O contexto no `execute`.** A §7.1 da spec e o esboço do plano escrevem `execute(entry, choice, services)`. Só com isso o provedor não sabe de quem é a entrada: ele é um por tipo de ator (§2.6), o `id` da entrada só é único dentro do ator, e o `CharacterSheetVM` da ficha pede o documento, o `actorId` e a posse para nascer (`characterSheetVM.ts`, construtor perto da `:1038`). A BAR-F4-03 (testes em grupo) também não teria como executar por ator. Este arquivo acrescenta o quarto parâmetro, `execute(entry, choice, services, ctx)`, onde `ctx` é o mesmo `ActionBarContext` de que a `entries(ctx)` saiu; `ActionBarServices` segue sem `actorId` de propósito.

| Contrato                                                                                                        | Dono                                      | Consumidores                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `ActionBarProvider`, `ActionBarSlice`, `composeActionBarProvider`, `actionBarRegistry` (§2.1)                   | BAR-F1-02                                 | BAR-F1-04, F2-02..F2-07, F4-02, F5-01, F6-01, F7-\* |
| `ActionBarEntry`, `ActionBarVariant`, `ActionBarCost`, `actionBarCostToken`, id estável (§2.2)                  | BAR-F1-02                                 | toda tarefa que monta ou mostra uma entrada         |
| `ActionBarContext`, `ActionBarStatus`, `ActionBarChoice`, `ActionBarServices` (§2.3)                            | BAR-F1-02                                 | BAR-F1-04, F2-\*, F3-02, F4-\*, F5-\*, F6-01, F8-02 |
| `ActiveActorResult`, `resolveActiveActor` e o gate de posse (§2.4)                                              | BAR-F1-01                                 | BAR-F1-04, F2-06, F4-02, F4-03, F6-01               |
| `ActionBarFlagsSchema`: favoritos e ícones em `flags.fusion.actionBar` (§2.5)                                   | BAR-F3-01 (favoritos), BAR-F3-05 (ícones) | BAR-F3-02, F3-03, F3-05, F8-04                      |
| Registro no `registerPf2eSheets` (§2.6)                                                                         | BAR-F2-07                                 | BAR-F4-02, F6-01                                    |
| Escala de z e área livre (§2.7)                                                                                 | BAR-F1-03 (tokens), BAR-F1-04 (uso)       | BAR-F3-02, F8-01, F8-03                             |
| `FavoritesSource`, `ActionBarController` e `ActionBarPreferences`: só os membros que outras tarefas usam (§2.8) | BAR-F1-04                                 | BAR-F1-05, F3-01, F3-02, F3-03, F3-04, F8-01, F8-02 |

### 2.1 O provedor, as fatias e o registry (BAR-F1-02)

Casca no core, conteúdo no sistema, **no padrão do `sheetRegistry`**: o satélite importa os tipos e o registry do core pelo alias `$lib/…` (o mesmo que `window-manager`, `sheetRegistry` e `skillNameRegistry` já usam) e o core **nunca** importa o satélite. O provedor é puro: nada de DOM, nada de socket guardado; o socket chega por `ActionBarServices`.

```ts
// packages/client/src/lib/actionbar/types.ts — só tipos; sem barrel `index.ts` na pasta
import type { Component } from "svelte";
import type { Socket } from "socket.io-client";

/** O que o sistema registra, um por (documentType, subtype) — §2.6. */
export interface ActionBarProvider {
  /** Entradas do ator ativo. Só o doc em `ctx` + leituras reativas que a ficha já usa. Não abre a ficha. */
  entries(ctx: ActionBarContext): ActionBarEntry[];
  /** Faixa de estado: PV, recursos, condições, alvo, MAP do próximo ataque. */
  status(ctx: ActionBarContext): ActionBarStatus;
  /**
   * Executa pelas MESMAS funções da ficha; o servidor valida tudo. Recusa/erro rejeita com `Error`.
   * `ctx` é o contexto do ATOR DONO da entrada (o mesmo de que `entries(ctx)` saiu): o provedor é um por
   * tipo de ator, e é por `ctx.actor` e `ctx.actorId` que ele acha o documento e monta o VM da ficha.
   */
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
    ctx: ActionBarContext,
  ): Promise<void>;
  /** Painel de detalhe do sistema (o mesmo da ficha), aberto com Alt no tooltip. */
  details?: Component<{ entry: ActionBarEntry }>;
  /** Ids da semente dos favoritos na primeira abertura (BAR-F3-01): até 12, na ordem dos slots. */
  seed?(ctx: ActionBarContext): string[];
}

/** Fatia de um provedor: o que cada módulo do sistema entrega. O sistema compõe as fatias. */
export interface ActionBarSlice {
  /** Os `kind` que esta fatia monta E executa. Duas fatias não declaram o mesmo `kind`. */
  readonly kinds: readonly ActionBarEntryKind[];
  entries(ctx: ActionBarContext): ActionBarEntry[];
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
    ctx: ActionBarContext,
  ): Promise<void>;
}

export function composeActionBarProvider(parts: {
  slices: readonly ActionBarSlice[];
  status: ActionBarProvider["status"];
  details?: ActionBarProvider["details"];
  seed?: ActionBarProvider["seed"];
}): ActionBarProvider;
```

`composeActionBarProvider` concatena `entries` das fatias na ordem em que vêm, roteia `execute` pelo `entry.kind` para a fatia que o declara, repassando o `ctx` (kind sem fatia rejeita) e passa as entradas por `assertValidEntries` (§2.2): em desenvolvimento e em teste, entrada inválida **lança**; em produção, descarta a entrada e faz `console.warn`.

```ts
// packages/client/src/lib/actionbar/actionBarRegistry.ts — espelho do sheetRegistry (REQ-UIF-018/019, REQ-BAR-012)
export class ActionBarRegistryImpl {
  /** `documentType` é "Actor"; `subtype` é o `type` do ator ("character", "npc", "familiar"…); "*" é o fallback do documentType. */
  register(documentType: string, subtype: string, provider: ActionBarProvider): void;
  /** Resolução como a da ficha: exato → "*" → null. Sem provedor, a barra do ator não aparece. */
  resolve(documentType: string, subtype: string): ActionBarProvider | null;
  reset(): void; // só testes
}
export const actionBarRegistry: ActionBarRegistryImpl;
```

### 2.2 A entrada, as variantes e o id estável (BAR-F1-02)

```ts
export type ActionBarTab = "strikes" | "spells" | "actions" | "items" | "reactions" | "checks";
// Rótulos pt-BR fixos no core: Golpes, Magias, Ações, Itens, Reações, Testes. "Favoritos" não é
// aba de entradas: é a linha principal de 12 slots (§2.5). Aba sem entradas mostra o estado vazio.

export type ActionBarEntryKind =
  | "strike"
  | "spell"
  | "action"
  | "item"
  | "reaction"
  | "toggle"
  | "check";

/**
 * Custo exibido no canto do slot. Só dado de tela (D-15): nada conta, nada bloqueia.
 * Mesma forma do `ActionCost` da ALQ-F7-02 (plano do Alquimista, §2.11), com OUTRO NOME: o client já tem
 * um `ActionCost` de exibição ({ icons, label, isText }, `lib/compendium/documentDetails.ts`) e dois tipos
 * com o mesmo nome no mesmo pacote são o erro que a BAR-F1-02 existe para evitar (Q-BAR-06). O core não
 * importa o satélite; como a forma é a mesma, o valor da ALQ-F7-02 entra aqui por tipagem estrutural.
 * Para EXIBIR, a casca usa `actionBarCostToken` + `formatActionCost` (o existente): glifo e rótulo têm
 * uma fonte só. Glifos: action ◆ ◆◆ ◆◆◆ · reaction ⟳ · free ◇.
 * Custo variável (a Cura de 1 a 3 ações, a Rajada) = { kind: "activity", min: 1, max: 3, unit: "action" }.
 */
export type ActionBarCost =
  | { kind: "action"; count: 1 | 2 | 3 }
  | { kind: "reaction" }
  | { kind: "free" }
  | { kind: "activity"; min: number; max?: number; unit: "action" | "minute" | "hour" | "day" }
  | { kind: "passive" }
  | { kind: "none" };

/**
 * Token que o `formatActionCost` do client já entende; a casca exibe o custo com
 * `formatActionCost(actionBarCostToken(cost), locale)` (`client/lib/actionbar/cost.ts`).
 * `passive` e `none` → null (sem selo).
 *   { kind: "action", count: 2 }                         → "2"
 *   { kind: "reaction" }                                 → "reaction"
 *   { kind: "free" }                                     → "free"
 *   { kind: "activity", unit: "action", min: 1, max: 3 } → "1 to 3"   (sem `max`, ou `max` igual a `min`: "2")
 *   { kind: "activity", unit: "minute", min: 10 }        → "10 minutes" (texto, sem glifo; o formatter traduz)
 */
export function actionBarCostToken(cost: ActionBarCost): string | null;

export interface ActionBarVariant {
  /** Estável dentro da entrada: "map:0|1|2", "cost:1|2|3", "rank:<n>", "element:<slug>". */
  id: string;
  axis: "map" | "cost" | "rank" | "element";
  label: string; // pt-BR: "1º ataque", "2 ações", "3º patamar", "Fogo"
  badge?: string; // o que o slot mostra quando esta é a variante em uso: "+9", "−1", "CD 18"
  hint?: string; // o que muda depois: "depois deste: MAP −10"
  isDefault?: boolean; // exatamente uma por eixo
  reason?: string; // presente ⇒ a variante aparece esmaecida com o motivo
}

export interface ActionBarEntry {
  /** "<kind>:<origem>", estável no ator; é o que o favorito e o ícone customizado guardam. */
  id: string;
  kind: ActionBarEntryKind;
  tab: ActionBarTab;
  group?: string; // "Truques", "2º patamar", "Atletismo"…
  label: string; // pt-BR, o nome do pack — a barra não tem nomes próprios
  shortLabel?: string; // D-BA15: nome curto embaixo do ícone; sem ele o core abrevia o `label`
  icon?: string; // chave do conjunto de ícones livres do core (nunca arte da Paizo)
  cost?: ActionBarCost;
  traits?: string[];
  badge?: string; // bônus ou CD final: "+4", "CD 18"
  uses?: { value: number; max?: number }; // quantidade, usos, cargas
  groupUses?: { value: number; max: number; style: "count" | "pips" }; // cabeçalho do grupo: "1º patamar 2/3", "Foco ●○"
  rank?: number; // selo do patamar no slot (T3)
  countsForMap?: boolean; // selo MAP (T4): Agarrar, Empurrar, Derrubar…
  state?: "ready" | "unavailable" | "spent-until-recharge" | "active"; // ausente = "ready"
  reason?: string; // por que está esmaecida; obrigatório em "unavailable" e "spent-until-recharge"
  variants?: ActionBarVariant[];
  target?: "none" | "one" | "many";
  range?: { kind: "reach" | "range"; feet: number };
  effect?: string; // uma linha para o tooltip curto
}
```

`assertValidEntries(entries)` (em `types.ts` ou `actionBarRegistry.ts`) confere, e a F1-02 testa:

1. `id` casa `^(strike|spell|action|item|reaction|toggle|check):[A-Za-z0-9._:-]{1,120}$`, o prefixo é igual a `kind`, e **não se repete** na lista (REQ-BAR-017).
2. `state` `unavailable` ou `spent-until-recharge` exige `reason` não vazio. **Só o impossível some**; o indisponível fica no lugar, esmaecido, com o motivo (REQ-BAR-031). O estado e o motivo vêm de recurso ou estado real do ator, nunca de contagem de ações (REQ-BAR-032).
3. `variants`: exatamente uma `isDefault` por eixo; `id` único dentro da entrada.
4. `cost`, `badge`, `uses` e `groupUses` são **exibição**. Nenhum deles é lido como regra pela casca (D-15).
5. `label` é o nome do pack pt-BR (Investigar, Deslocar, Rememorar Conhecimento, Golpe Reativo, Erguer um Escudo…), nunca um nome inventado (REQ-BAR-021).

Formato dos ids: `strike:<itemId>`, `spell:<entryId>:<spellId>`, `action:<slug>`, `item:<itemId>`, `reaction:<slug>`, `toggle:<flag>`, `check:<slug>` (`check:perception`, `check:fortitude`, `check:skill-athletics`, `check:lore-<slug>`). Nunca baseado em posição na lista.

### 2.3 Contexto, faixa de estado, escolha e serviços (BAR-F1-02)

```ts
export interface ActionBarTargetRef {
  tokenId: string;
  actorId: string;
  name: string; // o que o token JÁ mostra a este usuário (mesma identidade de `getMyTargets()`); nunca o nome real de um NPC oculto
}

export interface ActionBarCombatContext {
  inCombat: boolean; // há encontro em andamento
  round: number | null;
  isMyTurn: boolean; // o participante da vez é do usuário (`activeCombatantIsOwnedBy`)
  targets: ReadonlyArray<ActionBarTargetRef>; // getMyTargets(), nome redigido
}

export interface ActionBarContext {
  actorId: string;
  /** Documento do ator no espelho, na versão atual. Só chega aqui o ator que o gate liberou (§2.4). */
  actor: Readonly<Record<string, unknown>>;
  /** `actor.system.derived`, que o servidor recalcula e persiste (o VM da ficha lê dali). A barra nunca o escreve. */
  derived: Readonly<Record<string, unknown>>;
  tokenId: string | null; // token da barra na cena atual; null = personagem do jogador sem token na cena
  viewer: { userId: string; isGm: boolean };
  combat: ActionBarCombatContext;
}
```

O MAP **não** vem no contexto (diferença 1 acima): o provedor de Golpes lê `attacksThisTurn(actorId)` (`sheet/strikeMapCount.svelte.ts`), que já é reativo, já tem o fallback pelo log do chat e já trata a contagem velha e o MAP do companheiro. A casca chama `entries(ctx)` e `status(ctx)` dentro de `$derived`; qualquer leitura reativa do provedor reavalia a barra. O `execute(entry, choice, services, ctx)` recebe o **mesmo `ctx` do ator ativo** (para o grupo da BAR-F4-03, o `ctx` de cada ator).

```ts
export interface ActionBarResource {
  id: string; // "focus" | "hero" | "class:<slug>" (BAR-F7-06)
  label: string;
  style: "pips" | "count";
  value: number;
  max: number;
}

export interface ActionBarStatus {
  name: string;
  subtitle?: string; // "Ladino 1 / Investigador 2"
  portrait?: string; // caminho /assets/… já servido a quem vê o ator
  hp: { value: number; max: number; temp: number };
  /** Só com `ctx.viewer.isGm` (T6). Para o jogador o campo NUNCA vem preenchido. */
  gmOnly?: { ac?: number };
  resources: ActionBarResource[]; // Foco e Herói (T1, T3); recurso de classe na BAR-F7-06
  conditions: Array<{ id: string; name: string; value?: number; effect?: string }>; // só o nome na faixa; `effect` abre no clique (D-B23)
  nextAttack?: { mapPenalty: 0 | -5 | -10 }; // MAP do PRÓXIMO ataque, do servidor
  target: { tokenId: string; name: string } | null; // chip do alvo; `name` = ActionBarTargetRef.name (redigido)
}

export interface ActionBarChoice {
  /** eixo → id da variante escolhida. Eixo ausente = a variante `isDefault` da entrada. */
  variants: Partial<Record<ActionBarVariant["axis"], string>>;
  /** Alvos marcados no instante do disparo. A casca lê `getMyTargets()`; o provedor NUNCA lê alvo por conta própria. */
  targetTokenIds: readonly string[];
  via: "click" | "key" | "menu";
}

export interface ActionBarServices {
  /** Socket vivo, resolvido a cada op (o socket congelado de uma janela velha foi um bug real do `makeSendOpFn`). */
  getSocket(): Socket | null;
  worldId: string;
  userId: string;
  isGm: boolean;
  /** O `makeSendOpFn` da ficha: op PLANA `{ type, ...campos }` (inclui postar no chat, `chat:send`), preenche `expectedVersion` sozinho, sem retorno. */
  sendOp(op: unknown): void;
  /** Envelope com resposta, `sendOp(socket, { type, payload })` de `lib/docs/sendOp.ts`; rejeita com `OpError`. Para o que devolve resultado (`item:consume`). */
  request<R = unknown>(type: string, payload: Record<string, unknown>): Promise<R>;
  /** "Abrir na ficha" (`openActorSheet`). */
  openActorSheet(actorId: string): void;
  /** Mensagem curta na faixa da barra (recusa do servidor, "sem alvo"). Some sozinha. */
  notify(message: string): void;
  /** Entra no modo mira e resolve com os tokens marcados; `null` se cancelou. Só existe depois da BAR-F8-02. */
  requestTargets?(opts: { count: "one" | "many" }): Promise<readonly string[] | null>;
}
```

Se uma lane precisar de algo que `ActionBarServices` não tem, ela **pede ao orquestrador em 3 linhas**; não abre um segundo canal.

### 2.4 Ator ativo e o gate de posse (BAR-F1-01, D-BA01, D-BA10)

O gate mora **no store, antes do provedor**. O provedor só é chamado com o ator que `resolveActiveActor` liberou, e a casca monta o `ActionBarContext` **apenas** a partir de um resultado `kind: "actor"`.

```ts
// packages/client/src/lib/actionbar/activeActor.ts — PURO (sem Svelte): é onde o gate é testado
export type ActiveActorResult =
  | { kind: "actor"; actorId: string; tokenId: string | null; via: "selection" | "own-character" }
  | { kind: "group"; tokenIds: readonly string[]; actorIds: readonly string[] } // só Mestre; BAR-F4-03 (F1-01 só reserva)
  | { kind: "none"; reason: "gm-no-selection" | "no-character" };

export interface ActiveActorInput {
  viewer: { userId: string; isGm: boolean };
  /** Seleção publicada pelo manager, por ATOR (o token só aponta). Vazia = nada selecionado. */
  selection: ReadonlyArray<{ tokenId: string | null; actorId: string }>;
  /** `ownedActorIdsOf(atores, userId)`: leitura viva e role-blind (só entrada de `ownership` conta). */
  ownedActorIds: ReadonlySet<string>;
  /** Personagens (`type: "character"`) de que o usuário é OWNER, com o último uso. */
  ownedCharacters: ReadonlyArray<{ actorId: string; lastUsedAt: number | null }>;
  /** O ator tem provedor (`actionBarRegistry.resolve("Actor", tipo)`)? Sem provedor não há barra (REQ-BAR-012) e o ator nunca é o ativo: vale a regra seguinte (REQ-BAR-009). */
  hasProvider(actorId: string): boolean;
}
export function resolveActiveActor(input: ActiveActorInput): ActiveActorResult;
```

Regras (§4.2 do plano, REQ-BAR-008..010), na ordem:

1. Exatamente um token selecionado **cujo ator é do usuário** (`ownedActorIds`), ou usuário Mestre, **e que tem provedor** (`hasProvider`) → `actor`, `via: "selection"`. O companheiro, eidolon ou servo do jogador entra aqui: a posse deles nasce copiada da do dono (DEC-ATR-18, DEC-ATR-19), então o mesmo gate vale sem predicado novo. **Antes da BAR-F6-01 eles não têm provedor**, e a seleção cai na regra 2: a barra segue no personagem em vez de sumir (REQ-BAR-009).
2. Senão, se o usuário tem personagem → `actor`, `via: "own-character"`, `tokenId` do token dele na cena atual ou `null`. Com mais de um personagem vale o de maior `lastUsedAt` (desempate: ordem do espelho). A seleção de um token alheio, ou de um ator sem provedor, cai aqui: **a barra não muda**. "Último usado" (Q-BAR-01) = o último ator ativo que o store publicou, guardado no dispositivo pela BAR-F3-04 (até lá, em memória).
3. Mestre sem seleção, ou com a seleção de um ator sem provedor → `none`, `gm-no-selection` (barra oculta). Jogador sem personagem → `none`, `no-character`.
4. Seleção múltipla (só Mestre) → `group` (BAR-F4-03). Para jogador a seleção é sempre única.

**Invariantes — cada uma é um teste, e o teste negativo da I3 é obrigatório:**

- **I1**: `kind: "actor"` ⇒ `viewer.isGm` ou `ownedActorIds.has(actorId)`.
- **I2**: `kind: "group"` ⇒ `viewer.isGm`. Jogador nunca recebe `group`.
- **I3**: para jogador, qualquer seleção cujo ator não está em `ownedActorIds` produz **exatamente** o resultado da seleção vazia, e um provedor-espião nunca é chamado com esse ator.
- **I4**: Mestre com seleção vazia ⇒ `none` (D-BA10).
- **I5**: função pura. Só lê ids; o resolvedor não toca em documento de ator alheio.
- **I6**: ator sem provedor nunca é o ativo: o resultado é o da seleção vazia (jogador) ou `none` (Mestre), REQ-BAR-009 e REQ-BAR-012.

```ts
// packages/client/src/lib/actionbar/activeActorStore.svelte.ts — o leitor reativo
export function getActiveActor(): ActiveActorResult; // ÚNICA porta de leitura da UI
/** Só o TokenInteractionManager chama. A seleção é guardada por ATOR: sobrevive à troca de cena (o token é re-resolvido na cena nova, ou fica `null`). */
export function publishTokenSelection(sel: { sceneId: string; tokenIds: readonly string[] }): void;
export function setActiveActorViewer(viewer: { userId: string; isGm: boolean } | null): void; // TableScreen
export function noteActorUsed(actorId: string): void; // seleção própria e execução bem-sucedida → "último usado"
export function setActiveActorProviderCheck(fn: (actorId: string) => boolean): void; // BAR-F1-04 liga ao actionBarRegistry; sem ligação, todo ator conta como tendo provedor
```

O manager ganha `onSelectionChange?: (tokenIds: ReadonlySet<string>) => void` nas suas opções (mesmo padrão do `onOpenSheet`) e a chama em `_selectToken`, no clique no vazio, em Del/Esc e no `destroy()`. O manager continua de seleção única até a BAR-F4-03.

### 2.5 `flags.fusion.actionBar`: favoritos e ícones (BAR-F3-01, BAR-F3-05)

Forma plana da §7.2 da spec: `favorites` e `seeded` irmãos de `icons`.

```ts
// packages/shared/src/actionbar.ts (novo; exportado por shared/src/index.ts) — a F3-01 cria `favorites` e `seeded`, a F3-05 estende `icons`
import { z } from "zod";

export const ACTION_BAR_SLOT_COUNT = 12;
export const ACTION_BAR_ICON_CAP = 64; // valor inicial do teto (Q-BAR-03): a BAR-F3-05 o confirma com teste de borda

export const ActionBarEntryIdSchema = z
  .string()
  .regex(/^(strike|spell|action|item|reaction|toggle|check):[A-Za-z0-9._:-]{1,120}$/);

/** UM caminho `/assets/…` por valor, casado inteiro; URL externa é recusada (CSP e grant de leitura). */
export const ActionBarAssetPathSchema = z
  .string()
  .max(512)
  .regex(/^\/assets\/[^\s?#]+$/)
  .refine((p) => !p.includes(".."), "caminho com '..'");

export const ActionBarFlagsSchema = z
  .object({
    /** Exatamente 12 posições; null = vazio. A tecla do slot i é "1".."9","0","−","=" na ordem. */
    favorites: z.array(ActionBarEntryIdSchema.nullable()).length(ACTION_BAR_SLOT_COUNT).optional(),
    /** true depois da semente: a partir daí NADA entra sozinho (D-BA08). */
    seeded: z.boolean().optional(),
    /** entryId → imagem do acervo do mundo (D-BA02). Teto: ACTION_BAR_ICON_CAP entradas. */
    icons: z
      .record(ActionBarEntryIdSchema, ActionBarAssetPathSchema)
      .refine((m) => Object.keys(m).length <= ACTION_BAR_ICON_CAP, "mapa de ícones acima do teto")
      .optional(),
  })
  .strict();
export type ActionBarFlags = z.infer<typeof ActionBarFlagsSchema>;
```

Regras de escrita (valem para as duas tarefas):

- Onde mora: `Actor.flags.fusion.actionBar`. O caminho de escrita é o `doc:update` da ficha, **sempre com `expectedVersion`** (o `makeSendOpFn` preenche); escrita sobre versão velha é recusada com `STALE_WRITE` e refeita sobre o estado fresco (REQ-BAR-063). Favorito órfão (a entrada sumiu da ficha) fica esmaecido como "não está mais na ficha" e só sai pelo Desafixar.
- O servidor valida o objeto **resultante** (`flags.fusion.actionBar` existente + o diff já expandido) com `ActionBarFlagsSchema`, no mesmo ponto de `rejectUnwritableField` em `server/net/handlers/doc-handlers.ts`, **no update e nos caminhos de create/import** (lição do `stripGmExceptionsOnCreate`: a criação não pode ser a porta aberta ao lado). Autoriza quem já autoriza o ator (OWNER ou privilegiado); o schema só fecha o **formato** e o **teto**.
- `icons`: só o dono do ator (ou o Mestre) escreve; o servidor **recusa a escrita em ator alheio** (`PERMISSION_DENIED`), com teste negativo (D-BA03, REQ-BAR-072). O campo entra em `server/assets/asset-fields.ts` — **exceção estreita e documentada** à regra 2 daquele arquivo (só o caminho `flags.fusion.actionBar.icons`, com o teto `ACTION_BAR_ICON_CAP`; nenhum outro `flags.*`) ("nada sob `flags.*` entra") e extensão da gramática de caminhos, com revisão adversarial do grant (BAR-F3-05, Q-BAR-04).

### 2.6 Registro no `registerPf2eSheets` (BAR-F2-07)

```ts
// external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/registerPf2eSheets.ts
import { actionBarRegistry } from "$lib/actionbar/actionBarRegistry.js";
import { createPf2eCharacterProvider } from "./actionbar/provider.js";
// …dentro de registerPf2eSheets(), depois de registerSkillNameResolver(skillNamePt):
actionBarRegistry.register("Actor", "character", createPf2eCharacterProvider());
//   BAR-F4-02:  actionBarRegistry.register("Actor", "npc", createPf2eNpcProvider());
//   BAR-F6-01:  actionBarRegistry.register("Actor", "familiar", createPf2eCompanionProvider());
```

Layout do satélite (`sheet/` = `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/`): `sheet/actionbar/strikesSlice.ts`, `spellsSlice.ts`, `actionsSlice.ts`, `checksSlice.ts`, `itemsSlice.ts`, `statusSlice.ts`, `seed.ts`, `provider.ts` (compõe as fatias), `npcProvider.ts`, `companionProvider.ts`. **Um arquivo por fatia** e um dono por arquivo: é isso que mantém a onda 2 sem colisão. O `sheets/pf2e/src/index.ts` continua exportando só `registerPf2eSheets` e `skillNamePt`; o comentário dele passa a listar o registry da barra.

### 2.7 Escala de z e área livre (BAR-F1-03, BAR-F1-04)

Hoje: aviso de cena z60, gaveta z90, cabeçalho z100, janelas ≥ 101 com o host em z200 (`--fusion-z-windows`), e `REQ-UIF-008` manda tooltip, menu de contexto e modal ficarem acima das janelas. Valores propostos, a lane confere os z reais e registra a escala final em `client/styles/base.css` como tokens:

| Camada                           | Token                  | z                |
| -------------------------------- | ---------------------- | ---------------- |
| barra de ações (acima do canvas) | `--fusion-z-actionbar` | 70 (60 < z < 90) |
| tooltip e popover                | `--fusion-z-tooltip`   | acima de 200     |
| menu de contexto                 | `--fusion-z-menu`      | acima do tooltip |

A **área livre** é a faixa entre a borda esquerda e a gaveta à direita (44 px de trilho fechada, 344 px aberta): a barra se centraliza nela. Abaixo de ~1000 px de área livre a barra recolhe sozinha. O estado aberto da gaveta, hoje privado em `components/sidebar/Sidebar.svelte`, passa a ser exportado por um módulo reativo da gaveta (BAR-F1-04).

### 2.8 A fonte de favoritos, o controller e as preferências (BAR-F1-04)

Só os membros que **outras tarefas** usam; o resto do controller é da BAR-F1-04. Os stubs entram com a assinatura final e corpo mínimo, e quem preenche só troca o corpo (é o que mantém as tarefas da mesma onda em arquivos distintos, §3).

```ts
// packages/client/src/lib/actionbar/favoritesSource.ts — interface e fonte em memória (SCAFFOLDING): BAR-F1-04; fonte persistida: BAR-F3-01
export interface FavoritesSource {
  slots(): ReadonlyArray<string | null>; // 12 posições, na ordem das teclas; ids de ActionBarEntry; reativo
  isPinned(entryId: string): boolean;
  pin(entryId: string): boolean; // primeiro slot vazio; false = 12/12
  unpin(entryId: string): void;
  move(from: number, to: number): void; // soltar em slot ocupado troca os dois
}
export function createFavoritesSource(actorId: string): FavoritesSource;

// packages/client/src/lib/actionbar/actionBarController.svelte.ts — dono: BAR-F1-04
export interface ActionBarController {
  readonly tab: ActionBarTab | "favorites"; // aba atual
  readonly collapsed: boolean;
  readonly hovered: ActionBarEntry | null; // entrada sob o mouse: alimenta o tooltip e, na BAR-F8-01, o anel de alcance
  readonly notice: string | null; // mensagem curta da faixa (services.notify)
  runEntry(entry: ActionBarEntry, choice?: Partial<ActionBarChoice>): Promise<void>; // clique e menu
  runFavorite(index: number): Promise<void>; // teclas 1–9, 0, − e = (via: "key")
  cancel(): void; // Esc: fecha menu e mira
}

// packages/client/src/lib/actionbar/actionBarShortcuts.ts — stub: BAR-F1-04; corpo: BAR-F1-05
export function registerActionBarShortcuts(controller: ActionBarController): () => void; // devolve o "desregistrar"

// packages/client/src/lib/actionbar/preferences.ts — stub: BAR-F1-04; corpo: BAR-F3-04
export interface ActionBarPreferences {
  collapsed: boolean;
  tab: ActionBarTab | "favorites";
  lastActorId: string | null; // desempate do "último usado" (Q-BAR-01)
}
export function loadActionBarPreferences(worldId: string, userId: string): ActionBarPreferences;
export function saveActionBarPreferences(
  worldId: string,
  userId: string,
  prefs: ActionBarPreferences,
): void;
```

### 2.9 Questões em aberto da spec 53 que as tarefas fecham

A spec deixou onze perguntas (§10). Estas são as que o plano de tarefas já responde; o orquestrador as copia para a spec na integração.

| Questão  | Quem fecha           | Como fica                                                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-BAR-01 | BAR-F1-01            | "Último usado" = o último ator ativo publicado pelo store (`noteActorUsed`), guardado no dispositivo pela BAR-F3-04; até lá, em memória                                                                                                                                                                                                           |
| Q-BAR-02 | BAR-F3-01            | Semente em ordem fixa por tipo (golpes, magias e truques, ações), até 4 de cada, e dentro de cada tipo a ordem de relevância que a ficha já devolve                                                                                                                                                                                               |
| Q-BAR-03 | BAR-F3-05            | Valor inicial 64, confirmado pela lane com teste de borda                                                                                                                                                                                                                                                                                         |
| Q-BAR-04 | BAR-F3-05            | A lane escreve a gramática nova e a exceção no cabeçalho do `asset-fields.ts`; a revisão adversarial confere                                                                                                                                                                                                                                      |
| Q-BAR-05 | BAR-F3-05            | A revisão adversarial decide (marcar o existente como ícone ou devolver caminho novo); teste negativo obrigatório: a resposta de envio nunca revela o nome de um arquivo que a galeria esconde                                                                                                                                                    |
| Q-BAR-06 | BAR-F1-02            | A BAR-F1-02 declara a forma da ALQ-F7-02 com o nome **`ActionBarCost`** (§2.2), porque o client já exporta outro `ActionCost` (exibição, `documentDetails.ts`), e exibe com o `formatActionCost` existente por `actionBarCostToken`; a ALQ-F7-02 mantém o `ActionCost` dela no satélite (a forma é a mesma, o valor entra por tipagem estrutural) |
| Q-BAR-07 | BAR-F1-04, BAR-F1-05 | Depois de um clique de **mouse** num slot o foco sai do botão e volta ao canvas (`slotFocus.ts`, BAR-F1-04); o guard continua suspendendo as teclas com botão em foco (REQ-BAR-049); Enter/Espaço mantêm o foco; a BAR-F1-05 prova com teste que as 12 teclas seguem funcionando depois do clique                                                 |
| Q-BAR-08 | BAR-F1-04            | Para o Mestre, Encerrar turno aparece em qualquer turno de encontro em andamento; para o jogador, só no turno dele                                                                                                                                                                                                                                |
| Q-BAR-09 | —                    | Fora das tarefas desta frente (`UserDocument.hotbar`, `MacroSchema` e os tipos e endpoints de hotbar da spec `14` ficam até a macro voltar como `kind`; reclassificar REQ-MAC-021, 024 e 028 e CA-MAC-01, 03 e 10 é decisão da spec `14`)                                                                                                         |
| Q-BAR-10 | BAR-F1-04            | Confere a convivência com a lista de jogadores e o avatar quando existirem; hoje nenhum existe na linha alfa                                                                                                                                                                                                                                      |
| Q-BAR-11 | BAR-F1-04, BAR-F2-04 | A entrada esmaecida por estado de turno ou de uso **executa ao clique**: a barra não trava (REQ-BAR-104, D-15); quem recusa, quando recusa, é a função da ficha que o `execute` chama, por falta de alvo, quantidade, slot ou foco. Posição provisória até a mesa confirmar                                                                       |

### 2.10 Ambiente de teste do client

O `vitest.config.ts` do client roda em `environment: "node"`: não há jsdom, happy-dom nem testing-library no repositório (a nota de abertura do `ConditionChip.test.ts` diz o mesmo), e instalar dependência exige confirmação (baseline do squad). Isso vale para todo cartão de UI deste arquivo. Onde a linha **Teste (TDD)** de um cartão fala em clique, foco, teclado, hover ou arrastar, leia-se:

1. **Lógica em módulo puro, de tipagem estrutural**; o `.svelte` só chama. O evento e o `document` entram como objetos mínimos (`{ detail: 1, currentTarget }`, `{ activeElement, querySelector }`), como já fazem `isEditableTarget(target: unknown)` e `isEscapeForSomethingElse(e, doc)` em `token-interaction.ts`. Foco, guard, navegação do menu e arrastar vivem nesses módulos (`slotFocus.ts`, `shortcutRegistry.ts`, `dragState.ts`).
2. **Markup e CSS pela renderização no servidor** (`render` de `svelte/server`) e pela folha de estilo do componente, no padrão do `ConditionChip.test.ts`: o que está desenhado (faixa, abas, 12 slots, estado vazio, motivo no tooltip, `aria-*`, alvo mínimo de 44 px).
3. **Módulos `.svelte.ts` com `$state`** (controller, stores): o plugin do Svelte os compila no Vitest, e o comportamento reativo (clique, segundo clique ignorado enquanto ocupa, troca de aba) se testa sem DOM.
4. **O que só um navegador prova** (foco real depois do clique, hover, arrastar de verdade, Tab) fica no roteiro `tutorial-e2e` do lote, com print olhado. Nenhuma tarefa inventa teste de componente com DOM falso para isso.

O satélite roda os testes da ficha no `vitest` dele, que este plano não conferiu: a lane de cada tarefa do satélite confere a configuração antes de assumir o mesmo.

## 3. Regras de colisão

**Prefixos de caminho** usados no campo "Onde" (o `tools/colisoes.cjs` os expande): `client/` = `packages/client/src/` · `server/` = `packages/server/src/` · `shared/` = `packages/shared/src/` · `sat:` = `external/fusion-systems-2e/` · `sheet/` = `sat:sheets/pf2e/src/lib/sheets/pf2e/` · `cmp/` = `sat:sheets/pf2e/src/components/sheets/pf2e/`. Linhas citadas são do estado de **2026-10-11** (evidência datada, não contrato); "novo" marca arquivo a criar.

- Tarefas na mesma onda têm **arquivos disjuntos** (campo Onde, que lista só o que a tarefa **escreve**; o que ela apenas lê vai na Entrega). O `node tools/colisoes.cjs tasks.md` confere por onda e **a onda 1 tem de dar zero**. Duas tarefas da mesma onda no mesmo arquivo-gargalo rodam **em série**, cada uma com commit próprio (regra herdada do Bhrotto; como a série funciona aqui está no resultado do `colisoes.cjs`, abaixo).
- **Faixas**: **S** casca (`client/components/actionbar/**`, `client/lib/actionbar/**`; um dono por arquivo, **sem barrel** `index.ts`) · **C** canvas (`TokenInteractionManager.ts`, `client/lib/canvas/**`) · **D** servidor de documentos e assets (`doc-handlers.ts`, `server/documents/**`, `server/assets/**`) · **E** satélite fichas (`characterSheetVM.ts`, `CharacterSheet.svelte`, `ActionsTab.svelte`, `SpellsTab.svelte`, `npcSheetVM.ts`) · **P** satélite provedor (`sheet/actionbar/**`, um arquivo por fatia) · **M** satélite motor das ações (`sheet/actions/**`, `systems/engine-2e/**`).
- **Pontos de extensão pré-ligados** (para que tarefas da mesma onda preencham arquivos distintos): a BAR-F1-04 cria com a assinatura final os stubs `favoritesSource.ts`, `actionBarShortcuts.ts`, `preferences.ts` e `GroupBar.svelte`; a BAR-F2-07 cria `seed.ts` e `itemsSlice.ts` (vazios) já ligados no `provider.ts`. A BAR-F1-05, a BAR-F3-04, a BAR-F3-01, a BAR-F4-03 e a BAR-F5-01 só **preenchem** esses arquivos.
- **Arquivos-gargalo** e a ordem em que passam de mão: `TokenInteractionManager.ts` (BAR-F1-01 → F4-03 → F8-02) · `TableScreen.svelte` (F1-01 → F1-04) · `ActionBar.svelte` e `Slot.svelte` (F1-04 → F1-05, só o ajuste de foco, se o teste dela o exigir → F3-02 → F3-03/F3-05 → F8-03) · `actionBarController.svelte.ts` (F1-04 → F3-04 → F8-02) · `characterSheetVM.ts` (F2-01 → F5-01 → F5-02) · `executableRows.ts` (F7-01, F7-02, F7-03: **série**) · `registerPf2eSheets.ts` (F2-07 → F4-02 → F6-01) · `doc-handlers.ts` (F3-01 → F3-05).
- **Resultado do `colisoes.cjs`** (conferido ao escrever este plano): as ondas 1, 2, 4, 5, 6, 7 e 8 saem **sem colisão**, e a onda 1 — a F1 no core e a BAR-F2-01 no satélite, em paralelo — dá zero: a F1 só escreve no core e a BAR-F2-01 só no satélite. A onda 3 tem uma colisão declarada: BAR-F7-01, BAR-F7-02 e BAR-F7-03 registram a sua linha em `sheet/actions/executableRows.ts`, então rodam **em série**, na ordem F7-01 → F7-02 → F7-03, cada uma com commit próprio: a seguinte só começa depois que a anterior foi integrada e atualiza a worktree dela (`git merge origin/feat/barra-de-acoes`), porque o `prep-worktrees.sh` cria todas as branches da rodada a partir dessa branch. Mudou o campo Onde de qualquer cartão, roda de novo.
- **Tag do satélite, bump de pin e merge não são da tarefa.** Onde um cartão fala neles (BAR-F2-07, BAR-F3-05…), é do **integrador** (Passo 3 de `orquestracao.md`: merge `--no-ff` na `feat/barra-de-acoes`, commit `chore(barra): pin do satélite após a onda N`) ou do **fechamento de lote** (Passo 5 da skill: tag `<última versão>-bar.<lote>` e PRs de lote). A tarefa só commita na própria `bar/<id>` nos dois repos.
- **Testes**: amplia-se a suíte existente de cada pacote (mesmo runner, mesmo `__tests__/`, mesmos helpers). Arquivo de teste novo só para módulo novo, sempre ao lado dele. Nunca runner, config ou pacote de teste novo.
- Teto de **6 tarefas por onda**. Roteiros de print rodam depois que o lote fecha, em faixa só-leitura.

**Porteiras de dependência externa.** O `plan.mjs` só lê `depende`; estas esperas ele não vê, então a skill as confere no Passo 1 e **tira a tarefa da rodada** (sem gravar estado) se faltar a peça. Leitura somente: nunca encostar nas branches das outras frentes.

| Tarefa    | Espera                                                                                                   | Como conferir                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BAR-F4-02 | merge da `fix/npc-rolagens` (BAR-F4-01, avulsa) na `main` do satélite — e na `alfa/app`, se tocar o core | `gh pr list -R xansde/fusion-systems-2e --head fix/npc-rolagens --state merged` e o equivalente em `xansde/fusion`            |
| BAR-F7-04 | `ANI-F3-03` **ou** `GUE-F6-01` (posturas com estado) entregue e mergeada em `alfa/app`/`main`            | `estado.json` da frente dona (leitura em `origin/feat/<frente>`) **e** o `core_sha` da tarefa alcançável de `origin/alfa/app` |
| BAR-F7-05 | `GUE-F4-01` (pool de reação)                                                                             | idem                                                                                                                          |
| BAR-F7-06 | `ALQ-F3-02` e `ALQ-F3-04` (recurso de classe, spec 47)                                                   | idem                                                                                                                          |

**Liberada a porteira, a entrega entra na integração.** As lanes nascem de `origin/feat/barra-de-acoes`, que só enxerga o que foi mergeado **nela**. Por isso o integrador, antes de soltar a tarefa, traz a entrega da outra frente: no core `merge origin/alfa/app`, no satélite `merge origin/main` (na `feat/barra-de-acoes` de cada repo) e depois atualiza o ponteiro do submodule no core (Passo 1.1 da skill). Enquanto a BAR-F4-02 estiver barrada, `/barra-de-acoes proxima` devolve só ela; siga com `/barra-de-acoes onda 6` (libera F3-03, F3-05, F5-02 e F8-02; a F6-01 espera a F4-02).

## 4. Tarefas

Cada cartão: **Repo**, **Onde** (o que a tarefa escreve), **Entrega**, **Depende de**, **Paralelo com** (derivado), **Modelo / esforço**, **Teste (TDD)** (suíte a **ampliar**; arquivo novo só para módulo novo), **Prova visual (print)** (tela do protótipo `prototipo-barra-fiel.html`), **Spec/REQ**, **Tamanho** (P ≤ ½ dia de agente, M, G = vários dias) e **Onda · Lote** (derivado). Campos opcionais: **Situação** (feita ou FORA da frente), **Espera** (tarefa que aguarda entrega de outra frente), **Conferir antes** (recorte absorvido de outro plano) e **Pré-condição externa**.

### Fase F0 — Desenho e spec (docs)

### BAR-F0-01 — Protótipo fiel da barra (T1–T7) revisado pelo Alexandre

- **Repo**: core
- **Situação**: feita — protótipo v1.1 aprovado pelo Alexandre em 11/10/2026 (commits `a5683b6e`, `3494d5a1`, `252c00d2`, `66d97ade`, `d9c4d21c`).
- **Onde**: `docs/design/barra-de-acoes/prototipo-barra-fiel.html`
- **Entrega**: Protótipo navegável (arquivo único, sem build) das sete telas-alvo, montado a partir do CSS e do markup reais com dados mock do dossiê de A Queda: T1 Fora de combate (Favoritos), T2 Seu turno (Golpes com MAP), T3 Magias, T4 Ações, T5 Itens, T6 Mestre · NPC, T7 Recolhida + mira. É a lente P1 do `PROCESSO-UI.md` em toda tarefa de UI da frente.
- **Depende de**: —
- **Paralelo com**: —
- **Modelo / esforço**: opus / high — desenho e protótipo conduzidos com o Alexandre.
- **Teste (TDD)**: não se aplica (protótipo descartável, regra de escopo do TDD).
- **Prova visual (print)**: o próprio arquivo, aberto com `Start-Process`.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 0 · **Lote**: —

### BAR-F0-02 — Spec 53 "Barra de Ações" e emendas nas specs 11, 14, 28, 40, 41, 23 e 20 (D-BA03, D-BA04, D-BA09)

- **Repo**: core
- **Situação**: feita nesta hora, em outra lane: chega pela branch `docs/barra-spec-53` (já publicada, commit `67b6be90`), que o orquestrador integra à `feat/barra-de-acoes` **antes da onda 1** (a F1 inteira depende dela). Se a lane falhar, o orquestrador corrige este estado para `pendente`.
- **Onde**: nova `specs/53-barra-de-acoes.md`; `specs/README.md` (bloco `prefixos` e números reservados); emendas em `specs/11-ui-framework-e-fichas.md` (REQ-UIF-001/006), `specs/14-macros-e-automacao.md` (REQ-MAC-012..018), `specs/28-hub-do-jogador.md` (REQ-HUB-007, convivência no rodapé), `specs/40-aba-combate.md` (Q-CBA-01), `specs/41-token.md` (DEC-TOK-19), `specs/23-acessibilidade-e-dispositivos.md` (tablet e atalhos), `specs/20-assets-e-midia.md` (REQ-AST-011/029: envio de imagem aberto a jogador, D-BA03); `specs/RASTREABILIDADE.md` via `pnpm spec:report`
- **Entrega**: Spec de área no metamodelo (`specs/CONVENCOES.md`): `DEC-BAR-01..15` (D-BA01..D-BA15, na mesma ordem) e `REQ-BAR-` com `[MVP]` nas fases F1–F4 e `[V2]` nas F5–F8. Cita os contratos da §2 deste arquivo sem reescrevê-los; registra o prefixo `REQ-BAR-`; substitui a hotbar da spec 14 (D-BA04); registra a convivência no rodapé com a barra de comando do Hub (D-BA09).
- **Depende de**: BAR-F0-01
- **Paralelo com**: —
- **Modelo / esforço**: opus / high — amarra o resto e emenda seis specs.
- **Teste (TDD)**: `spec-lint` verde (prefixo com dono, id único, citação resolvível, req com tag, decisão canônica) + `pnpm spec:report` regenerado.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BAR-024`, `REQ-BAR-075`, `REQ-BAR-102`, `DEC-BAR-01..15`
- **Tamanho**: M
- **Onda**: 0 · **Lote**: —

### BAR-F0-03 — `tasks.md` no formato das frentes, ferramentas, entrada em `frentes.json` e a skill `/barra-de-acoes` (D-BA14)

- **Repo**: core
- **Situação**: feita — este arquivo e os que andam com ele (commit `docs(barra): …` na `docs/barra-de-acoes`).
- **Onde**: `docs/design/barra-de-acoes/tasks.md`, `docs/design/barra-de-acoes/tasks-resumo.json`, `docs/design/barra-de-acoes/estado.json`, `docs/design/barra-de-acoes/tools/`; locais, fora do git: a entrada `barra` em `.claude/skills/_frentes/frentes.json` e `.claude/skills/barra-de-acoes/SKILL.md`
- **Entrega**: Plano no formato das frentes (decisões, contratos, 36 cartões, ondas e lotes derivados por script), o resumo e o estado que os scripts genéricos leem, as ferramentas adaptadas do Guerreiro (`ondas.cjs`, `build-resumo.cjs`) mais o `colisoes.cjs`, a entrada `barra` no `frentes.json` (nota: pela D-BA14 a barra entra antes do resto do Alquimista, do Animista e do Guerreiro; a BAR-F4-01 saiu avulsa em `fix/npc-rolagens`; nunca encostar em `feat/alquimista`, `feat/animista`, `feat/guerreiro`, `feat/bhrotto` nem `fix/npc-rolagens`) e a skill `/barra-de-acoes [proxima|onda N|status]`.
- **Depende de**: BAR-F0-02
- **Paralelo com**: —
- **Modelo / esforço**: sonnet / high — documentação e configuração, sem código de produto.
- **Teste (TDD)**: não se aplica (documentação). Validação: `node plan.mjs --frente barra --mode status` lista as 36 tarefas e a onda 1; `build-resumo.cjs` sem problemas; `colisoes.cjs` zero na onda 1.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 0 · **Lote**: —

### Fase F1 — Fundação no core (sem conteúdo de sistema)

### BAR-F1-01 — Store reativo de ator ativo e o gate de posse (D-BA01, D-BA10)

- **Repo**: core
- **Onde**: `client/lib/actionbar/activeActor.ts` (novo; `resolveActiveActor`, puro, §2.4) · `client/lib/actionbar/activeActorStore.svelte.ts` (novo; leitor reativo e publicador) · `client/lib/canvas/tokens/TokenInteractionManager.ts` (hoje `_selectedIds` privado em `:164`, `get selectedIds` em `:482`, `_selectToken` em `:916`; passa a publicar a seleção por `onSelectionChange`) · `client/components/TableScreen.svelte` (`:650-700`: alimenta o `viewer`, liga o publicador e passa o callback ao manager, ao lado de `getOwnedActorIds`) · testes: `client/lib/actionbar/__tests__/activeActor.test.ts` (novo), `client/lib/canvas/tokens/__tests__/TokenInteractionManager.liveOwnership.test.ts` e `client/lib/canvas/tokens/__tests__/TokenInteractionManager.teardown.test.ts` (ampliados)
- **Entrega**: O store de **ator ativo** da §2.4, com as quatro regras do plano §4.2 e as invariantes I1–I5. O `TokenInteractionManager` passa a **publicar** a seleção (opção `onSelectionChange`, mesmo padrão do `onOpenSheet`) em vez de guardá-la só num `Set` privado; a seleção é guardada por **ator** e sobrevive à troca de cena (o token é re-resolvido na cena nova, ou fica `null`). O **gate de posse** (D-BA01) mora aqui, antes do provedor: o jogador que seleciona o token de um NPC, ou de outro jogador, continua com a barra do próprio personagem e **nenhum dado do ator selecionado chega ao provedor**. O predicado de posse é o que o client já usa (`ownedActorIdsOf`, REQ-TOK-032, leitura viva como o `getOwnedActorIds` do manager): nada de predicado novo. **Ator sem provedor nunca é o ativo** (REQ-BAR-009, I6): a F1-01 nasce em paralelo com a BAR-F1-02 e **não importa** o `actionBarRegistry`; o resolvedor recebe `hasProvider` e o store expõe `setActiveActorProviderCheck`, que a BAR-F1-04 liga ao registry (sem ligação, todo ator conta como tendo provedor). Seleção múltipla do Mestre fica para a BAR-F4-03 (aqui só se reserva `kind: "group"`); Mestre sem seleção devolve `none` (D-BA10). "Último usado" (Q-BAR-01) é o último ator ativo que o store publicou (`noteActorUsed`); a BAR-F3-04 o guarda no dispositivo e, até lá, fica em memória.
- **Depende de**: BAR-F0-02
- **Paralelo com**: BAR-F1-02, BAR-F1-03, BAR-F2-01
- **Modelo / esforço**: opus / high — é o gate de segurança da D-BA01: um erro aqui vaza golpes, CA, PV e magias de NPC a um jogador.
- **Teste (TDD)**: `activeActor.test.ts`, tabela de casos em que a regra está escrita no teste: (a) jogador seleciona o próprio token → `actor/selection`; (b) **jogador seleciona um NPC → resultado idêntico ao da seleção vazia (`actor/own-character` do PJ dele), sem nenhum campo que carregue o ator selecionado (teste negativo, I3)**; o provedor-espião que "nunca é chamado com o NPC" é o teste negativo da BAR-F1-04, com o stub da BAR-F1-02 — esta tarefa não importa o registry; (c) idem com o token de outro jogador; (d) jogador sem personagem e com seleção alheia → `none/no-character`; (e) dois personagens → o de maior `lastUsedAt`; (f) Mestre seleciona NPC → `actor/selection`, sem seleção → `none/gm-no-selection`; (g) companheiro do jogador (a posse dele nasce copiada da do dono, DEC-ATR-18 e DEC-ATR-19) selecionado por ele **e com provedor** → `actor`; **sem provedor (é o caso até a BAR-F6-01) → o resultado da seleção vazia, a barra segue no personagem**; selecionado por outro jogador → igual à seleção vazia; (h) OWNER concedido no meio da sessão muda o resultado sem recriar nada; (i) troca de cena mantém o ator; (j) jogador nunca recebe `group` (I2); (k) `hasProvider` falso para o ator selecionado devolve o resultado da seleção vazia — para o jogador, o `own-character` dele; para o Mestre, `none` (I6). Amplia `TokenInteractionManager.liveOwnership.test.ts` (publica ao selecionar e ao limpar) e `…teardown.test.ts` (publica no `destroy`, sem vazar listener).
- **Prova visual (print)**: sem UI nesta tarefa (a barra nasce na BAR-F1-04). O caso "jogador clica num NPC e a barra não muda" é fotografado na BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-001..005`, `REQ-BAR-007..010`, `REQ-TOK-032`, `DEC-TOK-19`
- **Tamanho**: M
- **Onda**: 1 · **Lote**: L1

### BAR-F1-02 — `actionBarRegistry`, os tipos e o provedor stub de teste (D-BA05)

- **Repo**: core
- **Onde**: `client/lib/actionbar/types.ts` (novo) · `client/lib/actionbar/actionBarRegistry.ts` (novo) · `client/lib/actionbar/cost.ts` (novo; `actionBarCostToken`) · testes: `client/lib/actionbar/__tests__/actionBarRegistry.test.ts` (novo), `client/lib/actionbar/__tests__/cost.test.ts` (novo) e `client/lib/actionbar/__tests__/stubProvider.ts` (novo; helper reutilizado pela BAR-F1-04)
- **Entrega**: Os contratos das §2.1–§2.3 **exatamente com os nomes e shapes de lá**: `ActionBarProvider`, `ActionBarSlice`, `composeActionBarProvider`, `ActionBarEntry`, `ActionBarVariant`, `ActionBarCost`, `ActionBarContext`, `ActionBarStatus`, `ActionBarChoice`, `ActionBarServices`; o `actionBarRegistry` espelhando o `sheetRegistry` (`register(documentType, subtype, provider)`, `resolve(documentType, subtype)` e `reset`, exato → `*` → `null`, REQ-BAR-012); o `ActionBarCost` na forma da ALQ-F7-02 (Q-BAR-06) e o adaptador `actionBarCostToken` (`cost.ts`). **O client já tem um `ActionCost`** (`lib/compendium/documentDetails.ts:850`, `{ icons, label, isText }`, produzido por `formatActionCost` para o compêndio): a barra **não declara outro com esse nome nem copia a tabela de glifos**. Ela reaproveita o que existe — o provedor devolve o custo estruturado e puro (`ActionBarCost`, sem locale) e a casca o exibe com `formatActionCost(actionBarCostToken(cost), locale)`, de modo que glifo e rótulo têm uma fonte só. (Caminho alternativo, só se a lane provar que basta: o `cost` da entrada passar a ser o próprio `ActionCost` existente; aí o provedor formata, o tipo estruturado some e a §2.2 é atualizada no mesmo PR. O que **não** passa é `export … ActionCost` duas vezes no client.) `ActionBarProvider.execute` e `ActionBarSlice.execute` recebem o `ctx` como quarto parâmetro (§2.1); `assertValidEntries` com as cinco regras da §2.2; e um provedor stub de teste. Só tipos e registry: **sem barrel** `index.ts` na pasta, nenhum import de satélite. A fronteira (`dependency-cruiser`, `boundary-test`) continua verde sem mudar regra nenhuma.
- **Depende de**: BAR-F0-02
- **Paralelo com**: BAR-F1-01, BAR-F1-03, BAR-F2-01
- **Modelo / esforço**: sonnet / medium — contrato já fixado na §2; a lane o transcreve e testa.
- **Teste (TDD)**: `actionBarRegistry.test.ts`: resolve por tipo exato, depois `*`, depois `null`; `composeActionBarProvider` concatena as fatias na ordem, roteia `execute(entry, choice, services, ctx)` pelo `kind`, repassando o `ctx`, e rejeita `kind` sem fatia, e duas fatias com o mesmo `kind` lançam; `assertValidEntries` lança (em teste) para id repetido, prefixo diferente de `kind`, `state: "unavailable"` sem `reason`, variantes com duas `isDefault` no mesmo eixo; em modo produção descarta a entrada e avisa. `cost.test.ts`: `actionBarCostToken` devolve o token e, passando pelo `formatActionCost` **real**, o glifo e o rótulo esperados: ação 1, 2 e 3 → ◆, ◆◆, ◆◆◆; reação → ⟳; livre → ◇; atividade de 1 a 3 ações → "◆ a ◆◆◆" (e, com `min` igual a `max`, o glifo único); atividade em minutos → texto sem glifo; `passive` e `none` → `null` (sem selo). Verificação: `pnpm lint:boundaries` e `tools/boundary-test` verdes, e `grep -rnE "export (interface|type) ActionCost\b" packages/client/src` devolve **uma** linha, a de `documentDetails.ts`: um segundo `ActionCost` no client reprova a tarefa.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BAR-011..014`, `REQ-BAR-016..020`
- **Tamanho**: P
- **Onda**: 1 · **Lote**: L1

### BAR-F1-03 — Tooltip, popover e menu de contexto genéricos

- **Repo**: core
- **Onde**: `client/components/common/Tooltip.svelte` · `client/components/common/Popover.svelte` · `client/components/common/ContextMenu.svelte` (todos novos) · `client/lib/ui/floating.ts` (novo; posição com colisão de viewport, puro) · `client/styles/base.css` (acrescenta os tokens `--fusion-z-tooltip` e `--fusion-z-menu`, §2.7) · testes: `client/components/common/__tests__/Tooltip.test.ts`, `client/components/common/__tests__/Popover.test.ts`, `client/components/common/__tests__/ContextMenu.test.ts` e `client/lib/ui/__tests__/floating.test.ts` (novos, módulos novos, no padrão de `ConditionChip.test.ts`)
- **Entrega**: Três componentes genéricos em `components/common/`, reutilizáveis pelo resto do app (o core não tem nada disso hoje). **Tooltip**: abre por hover e por foco com atraso, `role="tooltip"` + `aria-describedby`, dois níveis (curto; expandido quando a prop `expanded` liga — quem chama decide o gatilho, a barra usa Alt). **Popover**: ancorado, fecha por clique fora (reaproveita `lib/ui/clickOutside.ts`) e por Esc, devolve o foco ao gatilho. **ContextMenu**: `role="menu"` e `menuitem`, grupos com título, item `disabled` com `reason` (esmaecido com o motivo), navegação por setas/Home/End/Enter/Esc, abre no ponteiro ou no âncora, vira ao chegar na borda da viewport. Os tokens de z acima do host das janelas (200) entram em `base.css` (REQ-UIF-008). Cobre de saída os defeitos recorrentes do `PROCESSO-UI.md`: "menu que não fecha ao clicar fora".
- **Depende de**: BAR-F0-02
- **Paralelo com**: BAR-F1-01, BAR-F1-02, BAR-F2-01
- **Modelo / esforço**: sonnet / medium — componentes com testes de comportamento.
- **Teste (TDD)**: comportamento observável: clique fora fecha o menu e o popover; Esc fecha e devolve o foco ao gatilho; o tooltip aparece no foco por teclado e some no blur; setas movem o item ativo e pulam o `disabled`; o item `disabled` expõe o `reason` (aria-describedby); o menu perto da borda direita e inferior abre voltado para dentro (`floating.test.ts`, puro); atributos aria presentes. Amplia `lib/ui/__tests__/clickOutside.test.ts` só se o helper mudar. **Ambiente (§2.10):** sem DOM, a navegação por setas (Home, End, pular `disabled`), o clique fora e o Esc ficam em funções puras de tipagem estrutural, testadas com eventos mínimos, e os atributos `aria-*` e `role` se conferem na renderização no servidor.
- **Prova visual (print)**: sem tela própria; coberta pela BAR-F1-04 (tooltip e menu dentro da barra, T1 e T4).
- **Spec/REQ**: `REQ-BAR-020`, `REQ-BAR-039`, `REQ-BAR-043..045`, `REQ-UIF-008`, `REQ-A11-*` (foco e aria, spec 23)
- **Tamanho**: M
- **Onda**: 1 · **Lote**: L1

### BAR-F1-04 — Componente `ActionBar`: faixa de estado, abas, slots, recolher e lugar na tela (D-BA04, D-BA07, D-BA09, D-BA10, D-BA15)

- **Repo**: core
- **Onde**: `client/components/actionbar/ActionBar.svelte` · `client/components/actionbar/StatusStrip.svelte` · `client/components/actionbar/TabBar.svelte` · `client/components/actionbar/SlotGrid.svelte` · `client/components/actionbar/Slot.svelte` · `client/components/actionbar/GroupBar.svelte` (stub) · `client/components/actionbar/icons.ts` (todos novos) · `client/lib/actionbar/actionBarController.svelte.ts` · `client/lib/actionbar/actionBarServices.ts` · `client/lib/actionbar/layout.ts` · `client/lib/actionbar/favoritesSource.ts` (stub) · `client/lib/actionbar/actionBarShortcuts.ts` (stub) · `client/lib/actionbar/preferences.ts` (stub) · `client/lib/actionbar/slotFocus.ts` · `client/lib/sidebar/drawerLayout.svelte.ts` (todos novos) · `client/components/sidebar/Sidebar.svelte` (publica o estado aberto da gaveta, hoje privado em `:35`) · `client/components/TableScreen.svelte` (monta a barra) · `client/components/scenes/ScenePrepareNotice.svelte` (convivência no centro-inferior, hoje z60) · `client/styles/base.css` (token `--fusion-z-actionbar`) · testes: `client/components/actionbar/__tests__/ActionBar.test.ts`, `client/lib/actionbar/__tests__/actionBarController.test.ts`, `client/lib/actionbar/__tests__/layout.test.ts`, `client/lib/actionbar/__tests__/slotFocus.test.ts` (novos) e `client/components/sidebar/__tests__/SidebarDrawer.test.ts`, `client/components/sidebar/__tests__/SidebarResponsive.test.ts` (ampliados)
- **Entrega**: A casca da barra, do desenho do plano §4.1 e das telas T1, T2 e T7. **Monta** quando `getActiveActor()` é `actor` **e** `actionBarRegistry.resolve("Actor", <type do ator>)` existe; senão não renderiza nada (Mestre sem seleção, D-BA10; ator sem provedor). A F1-04 também **liga** o store ao registry (`setActiveActorProviderCheck`), de modo que um ator sem provedor nem chega a ser o ativo (REQ-BAR-009). **Faixa de estado** a partir de `provider.status`: retrato (iniciais sem imagem), nome e `subtitle`, PV com temporário, `resources` (pips ou contagem), condições como chips **só com o nome** (clique revela o `effect`, D-B23), chip do alvo (`status.target`), de quem é a vez, de `ctx.combat` ("Seu turno · Rodada 2", em âmbar; a vez de outro participante visível; "Fora de combate"; participante oculto nunca é revelado, REQ-CBA-082) e "Próximo ataque: MAP −5" (`status.nextAttack`). **Encerrar turno** só no turno do próprio usuário ou, para o Mestre, em qualquer turno de encontro em andamento (Q-BAR-08), pela mesma operação da aba Combate (`combatActions.nextTurn`); esconder o botão não é proteção, o servidor decide quem pode. **Abas**: Favoritos + as seis de `ActionBarTab`; aba sem entradas mostra o estado vazio e não some (REQ-BAR-026). **Slots**: 12 em Favoritos (teclas 1–9, 0, − e = como selo); nas abas, grupos com cabeçalho (`group` + `groupUses`); estados disponível, esmaecido **com o motivo no tooltip**, gasto até recarregar e alternável ligado (borda e ponto aceso); custo no canto (◆ ◆◆ ◆◆◆ ⟳ ◇, por `formatActionCost(actionBarCostToken(cost), locale)`, sem tabela de glifos nova), selo de quantidade, de patamar e MAP, `badge` legível; **nome curto embaixo do ícone** (D-BA15); ícones do conjunto livre do protótipo, nunca arte da Paizo. **Clique** executa a variante padrão via `provider.execute(entry, choice, services, ctx)`, com o `ActionBarChoice` montado pela casca (alvos de `getMyTargets()`) e o `ctx` do ator ativo; o slot fica ocupado até o `execute` resolver (sem rolagem em dobro) e erro vira `services.notify`. **Esmaecer é sinal, não trava (REQ-BAR-104, Q-BAR-11, D-15):** o clique numa entrada esmaecida por estado de turno ou de uso (Comandar já usado, reação já gasta) chega a `execute` do mesmo jeito; quem recusa, quando recusa, é a função da ficha que o `execute` chama, por falta de alvo, quantidade, slot ou foco, e a recusa volta por `services.notify`. A casca só ignora o clique enquanto o **próprio** `execute` daquele slot está em andamento. Depois de um clique de **mouse** (`event.detail > 0`) o foco sai do botão e volta ao canvas, por `releaseFocusAfterPointer` (`slotFocus.ts`, puro e de tipagem estrutural, §2.10): o clique do mouse deixa o foco no `<button>` e o guard da BAR-F1-05 suspende as teclas com botão em foco (REQ-BAR-049), então sem isso as teclas 1–0, − e = morrem no primeiro clique (Q-BAR-07; a BAR-F1-05 prova o resultado); a ativação por teclado (Enter, Espaço, `detail` 0) mantém o foco. **Tooltip curto** (nome, custo, traços, `badge`, alcance, `effect` e, num golpe, o `hint` da variante padrão: "depois deste: MAP −10", que a faixa de estado repete enquanto o mouse está no golpe, REQ-BAR-039); Alt expande para `provider.details` quando existir. **Botão direito** abre o menu só com "Abrir na ficha" (o menu completo é a BAR-F3-02). **Recolher**: a barra vira só a faixa, estado em memória (persistência é a BAR-F3-04). **Lugar**: centralizada na área livre (§2.7), `drawerLayout` exporta a largura da gaveta, recolhe sozinha abaixo de ~1000 px, não colide com o `ScenePrepareNotice`. **Favoritos provisório (SCAFFOLDING)**: até a BAR-F3-01, `favoritesSource.ts` entrega uma fonte **em memória**, recalculada a cada carga com as primeiras entradas do provedor (golpes, depois magias e truques, depois ações), marcada `SCAFFOLDING` no código e que não persiste; é ela que mantém jogável a aba padrão do L1. O `Slot.svelte` já traz `draggable` e `data-entry-id`, inertes até a BAR-F3-03. Deixa pré-ligados, com a assinatura final da §2.8 e corpo mínimo, `favoritesSource.ts`, `actionBarShortcuts.ts`, `preferences.ts` e `GroupBar.svelte`, e o controller com os membros da §2.8, para que as BAR-F1-05, F3-01, F3-04 e F4-03 preencham arquivos distintos. **D-15**: nenhum componente, tipo ou teste desta tarefa conta, soma ou mostra "ações restantes".
- **Depende de**: BAR-F1-01, BAR-F1-02, BAR-F1-03
- **Paralelo com**: BAR-F2-02, BAR-F2-03, BAR-F2-04
- **Modelo / esforço**: sonnet / high — maior tarefa do core: mais de dez arquivos novos e três pontos de contato (TableScreen, gaveta, aviso de cena).
- **Teste (TDD)**: `ActionBar.test.ts` com o provedor stub da BAR-F1-02: renderiza faixa, abas e 12 slots; `none` e ator sem provedor não renderizam; **um provedor-espião registrado no `actionBarRegistry` nunca é chamado com o NPC que um jogador seleciona, e a barra segue no PJ dele (teste negativo do gate, D-BA01, I3)**; entrada esmaecida mostra o motivo **e o clique chega a `provider.execute`** (esmaecer é sinal, não trava: REQ-BAR-104); clique executa a variante padrão com o `ctx` do ator ativo e o segundo clique durante a execução é ignorado; Encerrar turno aparece só no turno do dono (para o Mestre, em qualquer turno de encontro em andamento) e chama `combatActions.nextTurn`; a faixa mostra "Seu turno", a vez de outro participante e "Fora de combate"; aba sem entradas mostra o estado vazio; chip de condição mostra só o nome e o clique revela o `effect`; nada no DOM mostra "ações restantes" nem pips de ação. `slotFocus.test.ts`: o clique de mouse (`detail: 1`) chama `blur()` no botão e devolve o foco ao canvas; a ativação por teclado (`detail: 0`) não mexe no foco. **Ambiente (§2.10):** o client roda Vitest em `node`, sem DOM; o que é markup (faixa, abas, 12 slots, estado vazio, motivo no tooltip, nada de "ações restantes") se testa por `svelte/server` em `ActionBar.test.ts`, e o que é comportamento (clique, segundo clique ignorado, Encerrar turno, o clique revelando o `effect`) se testa no `actionBarController.test.ts` e nos módulos puros, com o evento mínimo; foco real e hover ficam para o roteiro da BAR-F2-07. `layout.test.ts`: centraliza na área livre e recolhe abaixo do limiar. Amplia `SidebarDrawer.test.ts` e `SidebarResponsive.test.ts` (o estado aberto da gaveta é exportado e o breakpoint de 900 px continua valendo).
- **Prova visual (print)**: tela **T1** (Fora de combate, Favoritos) e **T2** (Seu turno, Golpes) e **T7** (recolhida), como jogador, e o desenho de **T6** como Mestre, comparados com o `prototipo-barra-fiel.html` (P1). O print usa o provedor stub (layout); o print com dados reais é da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-010`, `REQ-BAR-011`, `REQ-BAR-022`, `REQ-BAR-023`, `REQ-BAR-025..027`, `REQ-BAR-029..033`, `REQ-BAR-035..037`, `REQ-BAR-040`, `REQ-BAR-102`, `REQ-BAR-104`, `REQ-UIF-001`, `REQ-UIF-008`, `REQ-HUB-007`
- **Tamanho**: G
- **Onda**: 2 · **Lote**: L1

### BAR-F1-05 — Registro mínimo de atalhos e as teclas da barra (D-BA04, D-BA07)

- **Repo**: core
- **Onde**: `client/lib/shortcuts/shortcutRegistry.ts` (novo; o `KeybindingRegistry` da REQ-A11-020 na forma mínima, com o guard `shouldSuspendShortcut`) · `client/lib/actionbar/actionBarShortcuts.ts` (preenche o stub da BAR-F1-04) · testes: `client/lib/shortcuts/__tests__/shortcutRegistry.test.ts` (novo) e `client/lib/actionbar/__tests__/actionBarShortcuts.test.ts` (novo)
- **Entrega**: Registro central de atalhos (`registerShortcut(def): () => void`, `dispatchShortcut(e, doc = globalThis.document): boolean`) e as ligações da barra: **1–9, 0, − e =** executam o slot correspondente de Favoritos (por `e.code`: `Digit1..Digit0`, `Minus`, `Equal`, via `controller.runFavorite(i)`) e **Esc** cancela o menu aberto e, quando o modo mira existir (BAR-F8-02), a mira (REQ-BAR-048). O **guard** é próprio do registro: `shouldSuspendShortcut(e, doc)`, puro e de tipagem estrutural como o `isEscapeForSomethingElse` que já existe (o evento e o `document` entram como objetos mínimos, §2.10). Suspende o atalho com foco em `input`, `textarea`, `select`, `[contenteditable]`, dentro de `<dialog>` ou `[role="dialog"]`, **em botão ou link focado** (REQ-BAR-049), durante composição de IME (`e.isComposing`) e com Ctrl/Alt/Meta; `e.repeat` não repete a execução. Para o que é campo de texto o guard pergunta a `isEditableTarget`, **sem alterá-la**: ela é, de propósito, só "campo onde se digita" (o teste de `token-interaction.test.ts` fixa que checkbox, radio e botão **não** a acionam, para que as alternativas de teclado do token — Backspace, setas, KeyD — continuem valendo com um botão da gaveta em foco; é a P2 do #194, e o comentário do código a cita como REQ-A11-036). Ampliá-la mudaria o canvas, e esta tarefa **não muda o comportamento dos atalhos do canvas**. **O clique do mouse não pode matar as teclas (Q-BAR-07).** Clicar num slot deixa o foco no `<button>` do slot, e o guard suspende as teclas com botão em foco: sem tratamento, depois do primeiro clique as teclas 1–0, − e = param de funcionar até o usuário clicar fora, e quem usa mouse e teclado juntos não vê nada acontecer. A BAR-F1-04 devolve o foco ao canvas depois do clique de mouse (`releaseFocusAfterPointer`, `slotFocus.ts`); **a F1-05 é a dona do resultado**: depois de um clique num slot, as 12 teclas continuam executando o slot certo, e a tarefa o prova com teste; se o teste mostrar que a saída da F1-04 não basta, a F1-05 corrige `slotFocus.ts` e a chamada em `Slot.svelte` (a F1-04 já está integrada, e nenhuma outra tarefa da onda 3 mexe neles). A ativação por teclado (Tab até o slot, Enter) mantém o foco e **continua suspendendo** as teclas (REQ-BAR-049). Hoje não há registro central, os dígitos 1–0 estão livres e Space e F9 não têm guard.
- **Depende de**: BAR-F1-04
- **Paralelo com**: BAR-F3-04, BAR-F7-01, BAR-F7-02
- **Modelo / esforço**: sonnet / medium — pequena, mas o guard é a mitigação do risco "rolagem pública indesejada" (plano §9).
- **Teste (TDD)**: tudo em Vitest `node`, sem DOM (§2.10): elementos e `document` são objetos mínimos (`{ tagName: "BUTTON" }`, `{ isContentEditable: true }`, `{ activeElement, querySelector }`), como já faz `token-interaction.test.ts`. `shortcutRegistry.test.ts`, matriz tecla × elemento focado: `Digit1` dispara com o corpo da página em foco e **não** dispara com foco em input textual, textarea, select, contenteditable, diálogo, botão e link (um `input type="checkbox"` segue a regra do botão); Ctrl+1 e `isComposing` não disparam; `repeat` não executa duas vezes; `Escape` cancela o menu. `actionBarShortcuts.test.ts`: as 12 teclas (`Digit1..Digit9`, `Digit0`, `Minus`, `Equal`) chamam `runFavorite(0..11)` na ordem. **Depois de clicar num slot com o mouse, as 12 teclas continuam funcionando**: o teste monta um `document` falso cujo `activeElement` é o botão do slot, aplica o clique de mouse (`releaseFocusAfterPointer` com `detail: 1`, que chama `blur()` e devolve o foco ao canvas) e dispara cada tecla, que tem de executar o slot certo (`it.each`); o mesmo teste com ativação por teclado (`detail: 0`, foco no botão) **não** executa nenhuma (REQ-BAR-049, REQ-BAR-051). Fixa também o que **não** pode mudar: `token-interaction.test.ts` passa sem alteração, e o `shortcutRegistry.test.ts` afirma que `isEditableTarget({ tagName: "BUTTON" })` continua `false`. O foco real no navegador (clicar num golpe e apertar 2) é verificado no roteiro da BAR-F2-07.
- **Prova visual (print)**: sem print próprio; a tecla aparece como selo no slot (T1) e o roteiro da BAR-F2-07 aperta "1" sobre um golpe e, **depois de clicar num golpe com o mouse, aperta "2" sem clicar em mais nada**.
- **Spec/REQ**: `REQ-BAR-048..051`, `REQ-BAR-102`, `REQ-A11-020`, `REQ-A11-023`
- **Tamanho**: P
- **Onda**: 3 · **Lote**: L1

### Fase F2 — Conteúdo PF2e do personagem (primeira entrega jogável)

### BAR-F2-01 — Extração sem mudança de comportamento: `CharacterSheetVM` headless e as funções do "Usar" (D-BA05)

- **Repo**: satélite
- **Onde**: `cmp/CharacterSheet.svelte` (`:191` onde o VM nasce; `:390` `emitAbility`) · `cmp/ActionsTab.svelte` (`:271-395` orquestração do "Usar") · `cmp/SpellsTab.svelte` (`:1026` `emitCast`) · `sheet/characterSheetVM.ts` · novos: `sheet/createCharacterVM.ts`, `sheet/useExecutable.ts`, `sheet/emitAbility.ts`, `sheet/emitCast.ts` · testes: `sheet/__tests__/characterSheetVM.test.ts`, `sheet/__tests__/executableRows.test.ts`, `sheet/__tests__/executableRows.refusal.test.ts`, `sheet/__tests__/spellCast.test.ts` (ampliados), `sheet/__tests__/createCharacterVM.headless.test.ts` (novo)
- **Entrega**: A primeira tarefa de conteúdo é uma **extração**, e só isso (plano §5.2): a barra só pode chamar a lógica da ficha se ela existir fora do componente. (1) O `CharacterSheetVM` passa a ser **construível sem montar a ficha**: `createCharacterVM(deps)`, com o mesmo que o componente lhe passa hoje; e `characterVMFor(ctx, services)`, que guarda em memória o VM do ator por `actorId` + `_stats.version` e o monta **a partir do `ActionBarContext` e do `ActionBarServices`** que o `execute(entry, choice, services, ctx)` recebe (§2.1). O construtor do VM pede `{ doc, actorId, ownership, userId, isGm, worldId, systemId, spellNameTranslator, spellHeal, sourceNamesPt }` (`characterSheetVM.ts`, perto da `:1038`): `doc`, `actorId` e `ownership` saem de `ctx` (`ctx.actor`, `ctx.actorId` e a posse do `ctx.viewer` no ator, pelo mesmo helper que a ficha usa), `userId`, `isGm` e `worldId` de `ctx.viewer` e `services`, e os resolvedores opcionais a lane monta como o `CharacterSheet.svelte` os monta hoje. Se a posse não puder ser derivada de `ctx`, a lane devolve ao orquestrador em 3 linhas e o `ActionBarContext` ganha `ownership: number`. Assim as fatias da F2 não reconstroem um VM por entrada. (2) A orquestração do "Usar" (`ActionsTab.svelte:271-395`), o `emitAbility` (`CharacterSheet.svelte:390`) e o `emitCast` (`SpellsTab.svelte:1026`) viram funções de `lib/` (`useExecutable`, `emitAbility`, `emitCast`), chamadas pela ficha **e** pela barra. (3) De brinde, a ficha ganha um runner headless que hoje não existe. **Nada muda na tela e nenhum teste existente é alterado ou removido**; só se acrescentam. A suíte do satélite e a catraca `pathbuilder-parity` ficam verdes **antes** de qualquer conteúdo da barra (risco do plano §9).
- **Depende de**: —
- **Paralelo com**: BAR-F1-01, BAR-F1-02, BAR-F1-03
- **Modelo / esforço**: sonnet / high — refator grande em arquivo-gargalo da ficha em uso na mesa; o cuidado é não regredir.
- **Teste (TDD)**: critério verificável: o diff de `CharacterSheet.svelte`, `ActionsTab.svelte` e `SpellsTab.svelte` só **remove corpo** e chama a função extraída; o número de testes existentes da suíte do satélite não cai; `pathbuilder-parity` e `huo-jinwu-catraca` rodam **sem edição**. `createCharacterVM.headless.test.ts` (novo): monta o VM só com um doc e dependências injetadas e dispara, sem Svelte, um golpe (`strikeCard`), uma conjuração (`castSpell`) e um executável (`useExecutable`), conferindo o `chat:send` ou a op emitida. Amplia `characterSheetVM.test.ts`, `executableRows.test.ts`, `executableRows.refusal.test.ts` e `spellCast.test.ts` com os mesmos casos chamando a função extraída.
- **Prova visual (print)**: a ficha de personagem (Huo Jinwu, de A Queda) **antes × depois** da extração, idêntica — prova de não regressão; não há tela nova.
- **Spec/REQ**: `REQ-BAR-052`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### BAR-F2-02 — Provedor de Golpes: MAP corrente, variantes, munição exibida e bombas (D-BA05)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/strikesSlice.ts` (novo) · testes: `sheet/__tests__/actionbar-strikes.test.ts` (novo) e `sheet/__tests__/strikeMapButton.test.ts` (ampliado)
- **Entrega**: A fatia de `kind: "strike"` da aba Golpes. Lê, sem editar, `strikeCard` do VM (`characterSheetVM.ts:3360`), `attacksThisTurn` (`strikeMapCount.svelte.ts:40`), `strikeMap.ts`, `strikeExtras.ts` e `combinationWeapon.ts`. Uma entrada por golpe da ficha (arma, ataque desarmado, bomba arremessável). `badge` = **bônus final com o MAP corrente** (+9 / +4 / −1, não "MAP −5"); `variants` do eixo `map` (1º, 2º e 3º ataque) com o `hint` "depois deste: MAP −10", a padrão sendo a do ataque corrente, e a opção de **forçar MAP** para o ataque que não conta, igual à ficha; `range` e `target` conforme o golpe; munição e quantidade **exibidas** (`uses`) quando a ficha as tem — baixar a unidade é da BAR-F5-02. `execute` chama `strikeCard(id, mapIndex, targetTokenIds)` com os alvos de `choice.targetTokenIds`: **o servidor decide o grau contra a CA lida no banco** (`server/chat/chat-handler.ts:2110`), e nada de CA, PV ou bônus do alvo entra em `reason` nem em `effect`.
- **Depende de**: BAR-F1-02, BAR-F2-01
- **Paralelo com**: BAR-F1-04, BAR-F2-03, BAR-F2-04
- **Modelo / esforço**: sonnet / high — o golpe é o núcleo do L1 e o MAP errado é o pior bug de mesa.
- **Teste (TDD)**: a regra do PF2e está escrita no teste: com bônus base +9, depois de 0, 1 e 2 ataques no turno o `badge` é +9, +4 e −1 (arma comum, MAP 0/−5/−10) e +9, +5 e +1 (arma **ágil**, 0/−4/−8); forçar MAP 0 manda `mapIndex: 0`; **a barra e a ficha emitem o mesmo `chat:send` para o mesmo golpe, MAP e alvo** (teste de igualdade das duas rotas); sem alvo marcado a entrada continua executável (o card sai como hoje); bomba sem unidade fica `unavailable` com `reason`. Amplia `strikeMapButton.test.ts` com o caso do `badge` por variante.
- **Prova visual (print)**: **T2** (Seu turno, Golpes): slot "+5" depois de um ataque, tooltip com a base +9 e "depois deste golpe: +1 (MAP −8)". Coberta pelo roteiro da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-015`, `REQ-BAR-021`, `REQ-BAR-037..039`, `REQ-BAR-041`, `REQ-BAR-042`, `REQ-BAR-044`, `REQ-BAR-053`, `REQ-CBT-069`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### BAR-F2-03 — Provedor de Magias: truques, patamares com slots, foco e elevação (D-BA05)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/spellsSlice.ts` (novo) · testes: `sheet/__tests__/actionbar-spells.test.ts` (novo) e `sheet/__tests__/spellHeightening.test.ts` (ampliado)
- **Entrega**: A fatia de `kind: "spell"` da aba Magias. Lê, sem editar, `castSpell` do VM (`characterSheetVM.ts:2608`, com o gasto por `toggleSlotExpended`, `expendKnownSlot` e `setFocusPoints`), `spellHeightening.ts`, `spellCastCardVM.ts` e `emitCast` (extraído na BAR-F2-01). Entradas por grupo — **Truques**, um grupo por patamar (preparada e espontânea) e **Foco** — com `groupUses` (x/y de slots no cabeçalho do grupo; foco em pips), `rank` (selo do patamar no atalho) e `badge` (CD ou bônus de ataque de magia). Truques elevam sozinhos (a elevação que já existe); o eixo de variante `rank` oferece os patamares de conjuração disponíveis e `cost` o custo variável (Chuva de Força de ◆ a ◆◆◆), cada variante com o efeito no `hint`. **Esmaecida sempre com o motivo**: foco em 0 ("Sem pontos de foco (0/2). Recupere com Refocar"), sem espaço no patamar. `execute` chama a mesma conjuração da ficha: o slot e o foco são gastos pelos mesmos caminhos e o salvamento é graduado pelo servidor.
- **Depende de**: BAR-F1-02, BAR-F2-01
- **Paralelo com**: BAR-F1-04, BAR-F2-02, BAR-F2-04
- **Modelo / esforço**: sonnet / high — regras de slot, foco e elevação; preparada e espontânea se comportam diferente.
- **Teste (TDD)**: regra do PF2e escrita no teste: conjurar uma magia de 2º patamar gasta **exatamente um** espaço de 2º patamar (3/3 → 2/3) e não mexe nos outros patamares; truque nunca consome espaço e eleva ao patamar ⌈nível ÷ 2⌉; magia de foco gasta 1 ponto de foco e com foco 0 vem `unavailable` com `reason`; magia espontânea só oferece os patamares em que há espaço; **a barra e a ficha emitem a mesma op de conjuração**. Amplia `spellHeightening.test.ts` com os casos de elevação por variante de patamar.
- **Prova visual (print)**: **T3** (Magias): grupos Truques, 1º patamar com "2/3", Foco com pips; Chuva de Força com seletor de custo; os três feitiços de foco esmaecidos com o motivo. Coberta pelo roteiro da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-015`, `REQ-BAR-021`, `REQ-BAR-037`, `REQ-BAR-041`, `REQ-BAR-044`, `REQ-BAR-054`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### BAR-F2-04 — Provedor de Ações: lista relevante, "Usar" nas executáveis, Impulsos, Rajada e alternáveis (D-BA05, D-BA11)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/actionsSlice.ts` (novo) · testes: `sheet/__tests__/actionbar-actions.test.ts` (novo) e `sheet/__tests__/actionsVM.test.ts` (ampliado)
- **Entrega**: A fatia de `kind: "action"` e `"toggle"` da aba Ações. Lê, sem editar, `loadActionEntries` → `mergeActionRows` → `filterRelevantRows` → `sortActionRows` (`actionsVM.ts:1433,511,1356,1408`; as 538 ações do `actions-core`), as linhas executáveis (`actions/executableRows.ts:208-278`: Agarrar, Empurrar e Derrubar com a CD do alvo lida no banco e o limite de tamanho, Investigar, Rastrear, Tratar Ferimentos, Caçar Presa, Comandar, Apoio e Montar), `buildImpulseCard` e `buildElementalBlastCard` (`actionsVM.ts:894,1149`), `rollOptionToggles.ts` e `actions/commandMark.ts`. Mesma **lista relevante e mesma ordem** da aba Ações da ficha, agrupada por origem (Básicas, Atletismo, classe…). Nas executáveis, "Usar" chama o `useExecutable` extraído; **as outras postam o card da ação, sem rolagem automática** (D-BA11, REQ-BAR-057): Desmoralizar, Fintar, Rememorar Conhecimento e Esconder até o motor da BAR-F7-01; Desarmar, Reposicionar e Escapar até o da BAR-F7-02; Erguer um Escudo até o da BAR-F7-03; Deslocar, Passo e Recarregar não têm tarefa de motor no plano e seguem postando o card (os rótulos vêm do pack pt-BR, REQ-BAR-021: confira o nome na fonte). Impulsos e Rajada entram com custo **variável** (eixo `cost`). Os **alternáveis** de `flags.fusion.toggles.*` (Panache, Estratagema, alvo desprevenido, Finalizador), o Atunamento Estelar e o modo da arma combinada viram `kind: "toggle"` com `state: "active"` quando ligados, virando pela **mesma op** da ficha. `countsForMap` nas que contam (Agarrar, Empurrar, Derrubar); "Comandar um Animal" esmaecido com o motivo "Já comandou neste turno" quando o `commandMark` diz que sim — **esmaecido não é travado** (REQ-BAR-104): o `execute` da entrada continua ligado à função da ficha, que decide. Sem alvo marcado, a ação que a ficha só aceita com alvo (Caçar Presa) fica esmaecida com o motivo "Marque um alvo" (REQ-BAR-042); Desmoralizar aparece e, ao clicar, posta o card da ação e não rola nada sozinho (CA-BAR-12).
- **Depende de**: BAR-F1-02, BAR-F2-01
- **Paralelo com**: BAR-F1-04, BAR-F2-02, BAR-F2-03
- **Modelo / esforço**: sonnet / high — lista heterogênea e muita regra de disponibilidade.
- **Teste (TDD)**: para o mesmo ator, o conjunto de entradas executáveis é igual ao de `executableRows` da ficha e a ordem é a de `sortActionRows`; ação sem executável **não** dispara rolagem: posta o card; ligar um alternável emite a mesma op da ficha e a entrada vira `active`; Comandar com `commandMark` do turno vem `unavailable` com o motivo **e o `execute` dele ainda chama a função da ficha** (espião na função: esmaecer é sinal, não trava, REQ-BAR-104); Rajada e Impulso expõem o eixo `cost` com uma variante padrão; Caçar Presa sem alvo vem `unavailable` com o motivo; Desmoralizar posta o card e não rola; depois de quatro golpes no mesmo turno o quinto ainda executa, com o MAP no teto (−10), e nenhuma entrada fica bloqueada por custo, por turno ou por MAP (CA-BAR-04); nenhum campo carrega contagem de ações do turno (D-15). Amplia `actionsVM.test.ts`.
- **Prova visual (print)**: **T4** (Ações): ações agrupadas por origem, selos MAP em Agarrar/Empurrar/Derrubar, Comandar esmaecido com o motivo no tooltip. Coberta pelo roteiro da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-015`, `REQ-BAR-021`, `REQ-BAR-030..032`, `REQ-BAR-037`, `REQ-BAR-041`, `REQ-BAR-042`, `REQ-BAR-044`, `REQ-BAR-055..057`, `REQ-BAR-104`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### BAR-F2-05 — Provedor de Testes: Percepção, salvamentos, perícias e saberes (D-BA05)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/checksSlice.ts` (novo) · testes: `sheet/__tests__/actionbar-checks.test.ts` (novo) e `sheet/__tests__/skillNames.test.ts` (ampliado)
- **Entrega**: A fatia de `kind: "check"` da aba Testes. Lê, sem editar, as estatísticas derivadas da ficha e os nomes (`skillNames.ts`, `displayNames.ts`). Entradas: **Percepção**, os três **salvamentos** (Fortitude, Reflexos, Vontade), as **perícias** e os **saberes**, em grupos, com o `badge` igual ao modificador que a ficha mostra. `execute` rola pelo **mesmo caminho de chat da ficha de personagem** (o `chat:send` do teste), nunca pelo `roll:check`, que não existe no protocolo e é o defeito da ficha de NPC (plano §3.2).
- **Depende de**: BAR-F1-02
- **Paralelo com**: BAR-F1-04, BAR-F2-02, BAR-F2-03
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: o modificador exibido bate com a regra escrita no teste (atributo + proficiência, e perícia sem treino sem o bônus de nível), não com a tabela da ficha; clicar emite o mesmo `chat:send` que o botão de rolar da ficha; os nomes saem em pt-BR do pack (Percepção, Fortitude, Reflexos, Vontade); o saber (Lore) aparece com o nome da ficha. Amplia `skillNames.test.ts`.
- **Prova visual (print)**: aba **Testes** (desenho na **T6**; o jogador abre a aba clicando nela em qualquer tela). Coberta pelo roteiro da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-021`, `REQ-BAR-058`
- **Tamanho**: P
- **Onda**: 2 · **Lote**: L1

### BAR-F2-06 — Faixa de estado: PV, temporário, foco, herói, condições, alvo e MAP do próximo ataque (D-BA01, D-BA05)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/statusSlice.ts` (novo) · testes: `sheet/__tests__/actionbar-status.test.ts` (novo) e `sheet/__tests__/combatStatesVM.test.ts` (ampliado)
- **Entrega**: O `status(ctx)` do provedor. Lê, sem editar, o VM (PV, PV temporário, foco, pontos de herói), `combatStatesVM.ts` e `activeEffects.ts` (condições), `strikeMapCount.svelte.ts` (`attacksThisTurn`). Devolve `hp`, `resources` (**Foco** em pips e **Herói** em pips, como na T1 e na T3), `conditions` só com o nome e o `effect` para o clique (D-B23), `nextAttack.mapPenalty` (0, −5 ou −10, do servidor) e `target`. **O chip do alvo usa o nome redigido**: `status.target.name` é o `ActionBarTargetRef.name` que a casca recebeu (a mesma identidade que o token mostra), nunca o nome real de um NPC oculto ou desconhecido. `gmOnly.ac` só vem com `ctx.viewer.isGm`. **Divergência registrada**: o plano §4.1 e o REQ-BAR-059 põem os slots do patamar em foco na faixa; o protótipo aprovado (T3) os mostra no **cabeçalho do grupo** da aba Magias (`groupUses`, BAR-F2-03) e a faixa só traz Foco e Herói. Vale o protótipo (lente P1) e o orquestrador pede a emenda do REQ-BAR-059.
- **Depende de**: BAR-F1-02
- **Paralelo com**: BAR-F1-04, BAR-F2-02, BAR-F2-03
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: **teste negativo (D-BA01)**: com um NPC cujo nome real o jogador não conhece, o chip mostra o nome que o token mostra e `gmOnly` vem `undefined` para `isGm: false`; PV e temporário batem com a regra (o temporário absorve primeiro); `nextAttack.mapPenalty` acompanha `attacksThisTurn` (0 → −5 → −10 e nunca abaixo disso); condição sem efeito conhecido não quebra o chip; a faixa não carrega "ações restantes" (D-15). Amplia `combatStatesVM.test.ts`.
- **Prova visual (print)**: faixa de estado das **T1**, **T2** e **T3** (Herói, Foco 0/2, condições Escondido e Amedrontado, chip do alvo). Coberta pelo roteiro da BAR-F2-07.
- **Spec/REQ**: `REQ-BAR-006`, `REQ-BAR-019`, `REQ-BAR-027`, `REQ-BAR-028`, `REQ-BAR-035`, `REQ-BAR-036`, `REQ-BAR-038`, `REQ-BAR-040`, `REQ-BAR-059`, `Q-CBA-01`
- **Tamanho**: P
- **Onda**: 2 · **Lote**: L1

### BAR-F2-07 — Registro em `registerPf2eSheets`, provedor composto e roteiro do L1 com os 4 PJs de A Queda (D-BA05)

- **Repo**: core + satélite
- **Onde**: `sheet/actionbar/provider.ts` (novo; `createPf2eCharacterProvider`) · `sheet/actionbar/seed.ts` e `sheet/actionbar/itemsSlice.ts` (novos, vazios, já ligados no `provider.ts`, §3) · `cmp/ActionBarDetails.svelte` (novo; envoltório do `DocumentDetailsPanel.svelte` como `details`) · `sheet/registerPf2eSheets.ts` · `sat:sheets/pf2e/src/index.ts` (só o comentário do registry) · `.claude/skills/tutorial-e2e/roteiros/barra-l1.spec.ts` (novo, local, fora do git) · prints em `.fusion-build/barra-de-acoes/L1/` · testes: `sheet/__tests__/actionbar-provider.test.ts` (novo)
- **Entrega**: (1) O provedor composto: `composeActionBarProvider` com as fatias de Golpes, Magias, Ações, Testes (e a de Itens, vazia), a faixa de estado, `details` e `seed`, e o registro `actionBarRegistry.register("Actor", "character", createPf2eCharacterProvider())` em `registerPf2eSheets` (§2.6). (2) O **roteiro `tutorial-e2e`** do L1: servidor isolado em cópia do mundo `a_queda` (data-dir no scratchpad, fora da worktree; reaproveita o provisionamento de `a-queda-pjs.spec.ts`), confere a branch com `git merge-base --is-ancestor` e, **para os quatro PJs (Huo Jinwu, Tormentor Maximus Eternus, Bhrotto Raiz-funda e C.L.A.U.D.E.), como jogador e como Mestre**, fotografa: a barra com a faixa e os Favoritos provisórios (T1); golpe duas vezes com o `badge` caindo (T2); Magias com slot e foco (T3); Ações com Comandar esmaecido (T4); aba Testes; a tecla "1" executando o primeiro Favorito e **não** disparando com o foco no chat, num diálogo ou num botão (CA-BAR-07); **depois de clicar num golpe com o mouse, a tecla "2" executando o segundo Favorito sem clicar em mais nada** (o foco não pode ter ficado no botão, Q-BAR-07); quatro golpes no mesmo turno, o quinto ainda executando com o MAP no teto, sem nenhuma entrada bloqueada e com a faixa mostrando só o MAP do próximo ataque (CA-BAR-04); recolher (T7). Inclui o caso da **D-BA01**: o jogador clica num NPC criado pelo roteiro (nome fictício) e a barra continua no PJ dele, sem nenhum dado do NPC; o Mestre, sem seleção, não vê barra (D-BA10), e com o NPC selecionado também não (a barra de NPC é a BAR-F4-02). (3) Relatório P3 `.fusion-build/barra-de-acoes/L1/relatorio.html` com **protótipo × tela** e o checklist P4 (testado como GM e como player). **A tag do satélite e o bump do pin que o plano associa a esta tarefa são do fechamento do L1** (Passo 5 da skill), não da lane. **Fecha o L1.**
- **Depende de**: BAR-F1-04, BAR-F1-05, BAR-F2-02, BAR-F2-03, BAR-F2-04, BAR-F2-05, BAR-F2-06
- **Paralelo com**: —
- **Modelo / esforço**: sonnet / high — junta os dois repos e exige olhar print.
- **Teste (TDD)**: `actionbar-provider.test.ts`: o provedor composto devolve as entradas de cada fatia, roteia `execute` pelo `kind`, passa em `assertValidEntries` com um ator real de A Queda e `registerPf2eSheets` registra `"character"`. O próprio roteiro; prints abertos com Read, um por um, antes de declarar pronto; suíte do satélite e `pathbuilder-parity` verdes.
- **Prova visual (print)**: é a tarefa de print do L1: **T1, T2, T3, T4 e T7** com os quatro PJs, jogador e Mestre, lado a lado com o protótipo.
- **Spec/REQ**: `REQ-BAR-005`, `REQ-BAR-012`, `REQ-BAR-060`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L1

### Fase F3 — Favoritos e personalização

### BAR-F3-01 — Favoritos no ator: schema, semente, fixar, desafixar e reordenar (D-BA06, D-BA07, D-BA08)

- **Repo**: core + satélite
- **Onde**: `shared/actionbar.ts` (novo; `v` e `favorites` do §2.5) · `shared/index.ts` (exporta) · `server/documents/action-bar-flags.ts` (novo; valida o objeto resultante) · `server/net/handlers/doc-handlers.ts` (`rejectUnwritableField`, `:~510-600`, e os caminhos de create/import) · `client/lib/actionbar/favoritesSource.ts` (troca o corpo provisório pela fonte persistida) · `client/lib/actionbar/favoritesStore.svelte.ts` (novo) · `client/components/actionbar/SlotGrid.svelte` (entrada órfã) · `sheet/actionbar/seed.ts` (preenche o stub da BAR-F2-07) · testes: `shared/__tests__/actionbar.test.ts`, `server/__tests__/action-bar-flags-socket.test.ts`, `client/lib/actionbar/__tests__/favoritesStore.test.ts`, `sheet/__tests__/actionbar-seed.test.ts` (todos novos, módulos novos)
- **Entrega**: Os favoritos de verdade, **no ator** (`flags.fusion.actionBar.favorites`, §2.5). (1) O schema Zod no `shared` e a **validação no servidor do objeto resultante** (existente + diff expandido), no mesmo ponto onde o `doc-handlers.ts` já recusa campo não escrevível, **no update e nos caminhos de create/import** (a criação não pode ser a porta aberta ao lado, lição do `stripGmExceptionsOnCreate`). Quem autoriza a escrita continua sendo a posse do ator; o schema fecha o formato e o teto. (2) A fonte persistida: **fixar, desafixar e reordenar** com `expectedVersion` pelo `makeSendOpFn`, no lugar da fonte em memória da BAR-F1-04. (3) A **semente da primeira abertura**: `provider.seed(ctx)` devolve até 12 ids — golpes (até 4), depois magias e truques (até 4), depois as ações da lista relevante (até 4); "mais usadas" aqui é a ordem de `filterRelevantRows` e `sortActionRows` da ficha, porque não existe histórico de uso — e a casca grava `seeded: true` e `favorites` (as 12 posições) uma única vez, por quem puder escrever no ator (dono ou Mestre). Depois disso **nada entra sozinho** (D-BA08): um golpe novo vai para a aba, não para os Favoritos. (4) **Entrada órfã** (item vendido, magia trocada) fica esmaecida como "não está mais na ficha", com Desafixar. A F3-05 estende o mesmo schema com `icons`.
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-02, BAR-F4-02, BAR-F4-03
- **Modelo / esforço**: sonnet / high — schema, validação de servidor, escrita concorrente e semente determinística.
- **Teste (TDD)**: `actionbar.test.ts`: o schema recusa 11 ou 13 slots, id fora do formato, campo desconhecido (`.strict()`). `action-bar-flags-socket.test.ts` com socket real (porta via `helpers/ports.ts`, no padrão de `gm-exceptions-socket.test.ts`): dono grava favoritos válidos; id malformado e 13 slots são recusados; **jogador sem posse não grava no ator alheio (negativo)**; o objeto resultante inválido por um diff parcial é recusado; um create/import com `actionBar` inválido é recusado ou limpo. `favoritesStore.test.ts`: fixar vai ao primeiro slot vazio, com 12/12 recusa com aviso, mover troca de lugar, desafixar esvazia, escrita concorrente com versão velha refaz a partir do doc novo, órfão fica marcado. `actionbar-seed.test.ts`: a semente respeita os tetos 4+4+4, é determinística, e **com `seeded: true` um golpe novo não entra**.
- **Prova visual (print)**: **T1** (Favoritos com os 12 slots e as teclas), mais um favorito órfão esmaecido com "não está mais na ficha".
- **Spec/REQ**: `REQ-BAR-016`, `REQ-BAR-017`, `REQ-BAR-061..066`, `REQ-A11-036`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BAR-F3-02 — Menu de contexto completo e seletor de variantes no botão

- **Repo**: core
- **Onde**: `client/components/actionbar/Slot.svelte` · `client/components/actionbar/SlotMenu.svelte` (novo; monta o `ContextMenu` da BAR-F1-03) · `client/components/actionbar/VariantPicker.svelte` (novo) · testes: `client/components/actionbar/__tests__/SlotMenu.test.ts` (novo) e `client/components/actionbar/__tests__/ActionBar.test.ts` (ampliado)
- **Entrega**: O **botão direito** abre o menu da entrada: as **variantes** por eixo (1º, 2º e 3º ataque; 1, 2 ou 3 ações; patamar de conjuração; elemento da Rajada), cada uma com o `hint` ("depois deste: MAP −10") e esmaecida com o `reason` quando impossível; **Fixar** ou **Desafixar** (pela interface `FavoritesSource` da BAR-F1-04, que a BAR-F3-01 torna persistente); **Ver detalhes** (`provider.details`; some se o provedor não tem); **Abrir na ficha** (`services.openActorSheet`). O custo variável (Cura de 1 a 3 ações, Rajada) ganha ainda o **seletor no próprio botão**, onde nenhum HUD de PF2e documentado resolve bem (plano §2.1). Escolher uma variante executa a entrada com `ActionBarChoice.variants[eixo]`; o clique sem variante continua executando a padrão. O menu abre também por teclado (tecla de menu e Shift+F10) e é a **alternativa sem arrastar** da REQ-A11-036.
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-01, BAR-F4-02, BAR-F4-03
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: o menu lista exatamente as variantes da entrada; escolher "2º ataque" executa com `variants.map = "map:1"`; "Fixar" fica desabilitado com o motivo quando os 12 slots estão cheios; "Ver detalhes" não aparece sem `details`; o menu fecha por clique fora e por Esc; a entrada esmaecida abre o menu mas as variantes ficam esmaecidas com o motivo. Amplia `ActionBar.test.ts`. **Ambiente (§2.10):** a montagem do menu (itens, variantes, `disabled` com motivo) é uma função pura testada sem DOM; o Esc, o clique fora e a navegação por setas já são da lógica pura da BAR-F1-03.
- **Prova visual (print)**: **T4** (menu de botão direito: variantes com MAP, Fixar nos favoritos, Ver detalhes, Abrir na ficha) e **T3** (seletor de custo da Chuva de Força).
- **Spec/REQ**: `REQ-BAR-045`, `REQ-BAR-046`, `REQ-A11-036`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BAR-F3-03 — Arrastar e soltar dentro da barra

- **Repo**: core
- **Onde**: `client/components/actionbar/SlotGrid.svelte` (handlers por delegação) · `client/lib/actionbar/dragState.ts` (novo; reducer puro dos gestos) · testes: `client/lib/actionbar/__tests__/dragState.test.ts` (novo) e `client/lib/actionbar/__tests__/favoritesStore.test.ts` (ampliado)
- **Entrega**: Arrastar **de qualquer aba para Favoritos fixa**; **dentro de Favoritos reordena** (soltar num slot ocupado troca os dois); **para fora da barra desafixa**. HTML5 nativo, ad hoc (o framework de arrastar da spec 11, DEC-UIF-09, não existe); o `Slot.svelte` já traz `draggable` e `data-entry-id` desde a BAR-F1-04, e os handlers ficam no `SlotGrid.svelte` por delegação. As escritas passam pelo store de favoritos da BAR-F3-01 (com `expectedVersion`). Soltar com os 12 slots cheios recusa com aviso na faixa. O menu da BAR-F3-02 continua sendo a alternativa sem arrastar (REQ-A11-036).
- **Depende de**: BAR-F3-01
- **Paralelo com**: BAR-F3-05, BAR-F5-02, BAR-F6-01
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: `dragState.test.ts` (puro): arrastar da aba para um slot vazio fixa, para um ocupado troca, de Favoritos para fora desafixa, de uma entrada já fixada para outro slot move; soltar com 12/12 não altera nada. Amplia `favoritesStore.test.ts` com a ordem resultante depois de cada gesto.
- **Prova visual (print)**: **T1** (arrastar uma entrada de uma aba para um slot de Favoritos, antes e depois).
- **Spec/REQ**: `REQ-BAR-047`, `REQ-A11-036`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### BAR-F3-04 — Preferências do dispositivo: recolhida, última aba e último personagem

- **Repo**: core
- **Onde**: `client/lib/actionbar/preferences.ts` (preenche o stub da BAR-F1-04) · `client/lib/actionbar/actionBarController.svelte.ts` · testes: `client/lib/actionbar/__tests__/preferences.test.ts` (novo)
- **Entrega**: A barra lembra, **neste dispositivo e para este usuário**, se está recolhida, qual foi a última aba e qual foi o último personagem usado (`lastActorId`, que desempata a regra 2 da §2.4 quando o jogador tem mais de um). Chave `fusion:actionBar:<worldId>:<userId>` em `localStorage`, no padrão de `client/lib/sidebar/preferences.ts` (`loadSidebarPreferences` / `saveSidebarPreferences`): **todo acesso em `try`/`catch`**, a barra renderiza igual sem `localStorage` (janela privada, dados bloqueados), e nada disso vai ao servidor.
- **Depende de**: BAR-F1-04
- **Paralelo com**: BAR-F1-05, BAR-F7-01, BAR-F7-02
- **Modelo / esforço**: sonnet / low
- **Teste (TDD)**: grava e relê as três preferências; valor corrompido e `localStorage` indisponível (lança) caem no padrão sem quebrar; o `lastActorId` de um mundo ou de um usuário não vaza para outro; recarregar a barra recolhida a mantém recolhida.
- **Prova visual (print)**: **T7** (barra recolhida, recarregada e ainda recolhida).
- **Spec/REQ**: `REQ-BAR-033`, `REQ-BAR-034`, `DEC-UIF-10`
- **Tamanho**: P
- **Onda**: 3 · **Lote**: L2

### BAR-F3-05 — Ícone customizado por entrada e galeria compartilhada de ícones (D-BA02, D-BA03, D-BA15)

- **Repo**: core + satélite
- **Onde**: `shared/actionbar.ts` (estende com `icons`, §2.5) · `server/documents/action-bar-flags.ts` (valida `icons`: teto e só caminhos sob /assets/) · `server/net/handlers/doc-handlers.ts` (a escrita de `icons` em ator alheio é recusada) · `server/assets/asset-fields.ts` (exceção **estreita** à regra 2 do cabeçalho: registra só o caminho `flags.fusion.actionBar.icons`, com o teto de entradas, e estende a gramática) · `server/assets/routes.ts` (envio por jogador só no fluxo de ícone; listagem da galeria; apagar segue só do Mestre) · `server/assets/asset-store.ts` (marca "ícone" no registro de assets) · `client/lib/assets/assetApi.ts` (envio com a marca e listagem da galeria) · `client/lib/components/assets/FilePicker.svelte` (modo "Ícones da barra") · `client/components/actionbar/SlotMenu.svelte` ("Trocar ícone…" e "Restaurar ícone padrão") · `client/components/actionbar/Slot.svelte` (imagem preenchendo o slot) · `specs/21-seguranca.md` (a emenda de REQ-SEC-043 e REQ-SEC-044, no mesmo PR) · testes ampliados: `server/assets/__tests__/asset-grant.test.ts`, `server/__tests__/assets.test.ts`, `server/__tests__/action-bar-flags-socket.test.ts`, `shared/__tests__/actionbar.test.ts`, `client/lib/assets/__tests__/assetApi.test.ts`, `sheet/__tests__/actionbar-provider.test.ts`
- **Entrega**: No menu de uma entrada, **"Trocar ícone…"** abre o seletor de imagem do acervo e **"Restaurar ícone padrão"** volta ao genérico. O seletor tem a **galeria compartilhada**: tudo que qualquer um já enviou por "Trocar ícone…" fica **marcado como ícone no registro de assets** — gravado **pelo servidor, no mesmo ato do envio**, a partir da finalidade "ícone" que o pedido de envio declara (REQ-BAR-103); nenhum outro caminho de cliente marca como ícone um asset que já existe —, e todo jogador pode listar a galeria e **receber o grant de leitura das imagens marcadas**, mesmo sem `STORAGE_BROWSE` (REQ-BAR-080; é o canal que a revisão adversarial confere); **enviar imagem nova vale para todo jogador** (emenda na REQ-AST-011, hoje `role ≥ TRUSTED`), com a validação de tipo e tamanho do pipeline igual para todos. O resto do acervo (mapas, retratos, handouts do Mestre) **segue fora da lista do jogador**, porque nome de arquivo pode ser spoiler; apagar continua só do Mestre; sem cota, por decisão. A escolha fica em `flags.fusion.actionBar.icons` (§2.5: só `/assets/…`, URL externa recusada, teto inicial de 64 entradas (Q-BAR-03: a lane o confirma com teste de borda), `expectedVersion`). **O jogador só altera ícone de ator de que é dono**: o servidor recusa a escrita em ator alheio; o Mestre altera em qualquer um. Por fim, **o ponto delicado**: `asset-fields.ts` hoje proíbe qualquer caminho sob `flags.*` (regra 2 do cabeçalho: os `flags` são passthrough e o jogador é dono da própria ficha, então toda chave que ele inventa sobrevive à escrita) e só aceita as gramáticas `field` e `array[].field`. Registrar o mapa de ícones exige **uma exceção estreita, documentada no cabeçalho**: vale **só** para o caminho `flags.fusion.actionBar.icons` (nenhum outro `flags.*`, nenhum `system.*`, nem `favorites` e `seeded`, que não carregam imagem) e **só** para os valores do mapa, no máximo `ACTION_BAR_ICON_CAP` por documento — o teto vale também na hora de assinar o grant, não só no schema. A exceção pede uma terceira forma de caminho (valores de um mapa) e mantém a regra "um caminho por valor, casado inteiro", para que o Mestre e os demais donos do ator (que veem a barra sem ser quem escolheu a imagem) recebam o grant **sem** abrir a amplificação que o arquivo documenta (1 requisição → milhares de grants). A lane escreve a exceção, as medidas e a medição (1 referência → 1 grant; 5000 referências → recusado ou limitado ao teto) no cabeçalho antes de integrar. **A emenda da spec 21 entra nesta tarefa, no mesmo PR** (a spec 53 a registra na §12 e não a aplicou): REQ-SEC-043 (diretórios por papel) ganha a exceção do destino do envio de ícone — o jogador **não** ganha diretório de escrita, o **servidor** decide o destino numa área reservada para os ícones (a lane a nomeia e a documenta na emenda) e o cliente não escolhe pasta nem caminho (REQ-BAR-076); REQ-SEC-044 (cota por usuário) fica desligada para esse envio (REQ-BAR-077) — hoje o servidor não tem cota por usuário, então a emenda registra a regra e o teste prova que o envio de ícone não passa por nenhuma. Satélite: o provedor só garante que seus ids cabem no formato do schema e permanecem estáveis.
- **Depende de**: BAR-F3-01
- **Paralelo com**: BAR-F3-03, BAR-F5-02, BAR-F6-01
- **Modelo / esforço**: opus / high — segurança: amplificação de grant, envio aberto a jogador, galeria que pode vazar nome de arquivo e escrita em ator alheio.
- **Teste (TDD)**: testes de **segurança**, cada um negativo: (a) jogador **não** grava `icons` em ator que não é dele, com socket real; o Mestre grava; (b) jogador envia imagem **só** pelo fluxo de ícone — o envio sem a marca continua recusado (REQ-AST-011 preservada); (c) a galeria lista **somente** envios marcados como ícone: um mapa do Mestre e um retrato **não** aparecem na lista nem abrem por nome (`asset-grant.test.ts`); (d) um mapa de ícones com 5000 caminhos é recusado ou truncado no teto e o grant devolvido tem no máximo 64 nomes; (e) URL externa, `..` e valor com mais de um caminho são recusados pelo schema; (f) apagar segue só do Mestre; (g) quem vê o ator recebe o grant do ícone e quem não pode ver o ator, não; (h) o envio deduplicado de um jogador, quando já existe um arquivo igual que **não** é ícone (um handout do Mestre, por exemplo), não revela o nome nem o caminho dele: marca o existente como ícone ou devolve um caminho novo, como a revisão adversarial decidir (Q-BAR-05); (i) o destino do envio de quem não tem `STORAGE_UPLOAD` é decidido pelo servidor, e o cliente não escolhe pasta nem caminho (REQ-BAR-076); (j) a exceção é **estreita**: `flags.fusion.actionBar.favorites`, `flags.fusion.outra` e qualquer `system.*` continuam fora da tabela do `asset-fields.ts` e não geram grant; (k) quem lista a galeria recebe o grant de leitura **só** das imagens marcadas como ícone, mesmo sem `STORAGE_BROWSE` (REQ-BAR-080); (l) o pedido de envio de um jogador sem a finalidade "ícone" continua recusado, e nenhuma rota de cliente marca como ícone um asset que já existe (REQ-BAR-103); (m) o envio de ícone não passa por cota por usuário (REQ-BAR-077). **Revisão adversarial do grant** na revisão da onda (lente obrigatória do revisor opus).
- **Prova visual (print)**: **T1** (Hanabi e Arco Elétrico com imagem customizada, custo, tecla e bônus ainda legíveis), o menu "Trocar ícone…" e a galeria aberta, como jogador e como Mestre.
- **Spec/REQ**: `REQ-BAR-016`, `REQ-BAR-029`, `REQ-BAR-067..081`, `REQ-BAR-103`, `REQ-AST-011`, `REQ-AST-029`, `REQ-SEC-043`, `REQ-SEC-044`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### Fase F4 — Mestre e NPCs

### BAR-F4-01 — Conserta as rolagens da ficha de NPC (D-BA12, D-BA13)

- **Repo**: satélite
- **Situação**: FORA da frente (D-BA13) — **a corrigir avulsa**, na branch `fix/npc-rolagens`, com PRs próprios para a `main` do satélite e para a `alfa/app`. No dia em que este plano foi escrito a branch e os PRs ainda não existiam (conferido com `gh pr list` e `git ls-remote`): a porteira da BAR-F4-02 (§3) só libera com o PR **mergeado**. Esta frente **não a executa, não a revisa e não a conta**; ela aparece aqui só como dependência externa da BAR-F4-02. Nenhuma tarefa da frente depende dela para **começar**.
- **Onde**: `sheet/npcSheetVM.ts` (`:514` emite `roll:check`, que não existe no protocolo; o servidor descarta como "Malformed envelope", `server/net/socket-manager.ts:1045`) · `cmp/NpcSheet.svelte`
- **Entrega**: Troca o `roll:check` pelo caminho de chat da ficha de personagem, com golpe com MAP, alvo e grau. É o mesmo defeito que o r9 corrigiu na ficha de personagem. Hoje, na `alfa/app`, **golpe, salvamento, Percepção e perícia de NPC não rolam pela ficha** — inclui a `fusion-mesa` da sessão de 12/10. Recorte da GUE-F1-06.
- **Depende de**: —
- **Paralelo com**: —
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: no PR avulso: `npcSheetVM.test.ts` ampliado (o golpe do NPC monta o card com alvo e `mapIndex`, e a perícia e o salvamento emitem `chat:send`). Fora desta frente.
- **Prova visual (print)**: ficha de NPC com o golpe rolando e o card resultante (no PR avulso).
- **Spec/REQ**: `REQ-BAR-084`, `REQ-BAR-085`
- **Tamanho**: M
- **Onda**: 0 · **Lote**: L2

### BAR-F4-02 — Provedor de NPC, só para o Mestre (D-BA01, D-BA10)

- **Repo**: satélite
- **Onde**: `sheet/actionbar/npcProvider.ts` (novo) · `sheet/registerPf2eSheets.ts` (`actionBarRegistry.register("Actor", "npc", createPf2eNpcProvider())`) · testes: `sheet/__tests__/actionbar-npc.test.ts` (novo) e `sheet/__tests__/npcSheetVM.test.ts` (ampliado)
- **Entrega**: A barra do NPC para o Mestre, sem abrir a ficha: **golpes** (bônus fixo do statblock com o MAP contado pelo servidor; cada arma com a sua agilidade: a espada ágil de +10 vira +6, o arco de +8 vira +3, T6), **ações** (na T6, de um NPC fictício: Golpe Duplo e Brado de Comando), **reações** (Golpe Reativo, que não conta no MAP), **magias inatas com CD**, mais a **faixa de estado com CA e PV exatos** (`gmOnly.ac`, T6). Os dados saem do que a ficha de NPC lê (`npcSheetVM.ts`) e as rolagens passam pelo caminho consertado pela BAR-F4-01. **Só o Mestre** (D-BA01): além do gate do store (BAR-F1-01), o provedor repete a defesa — com `ctx.viewer.isGm === false` devolve `[]` e uma faixa sem números — porque este é o provedor que carrega os dados que o jogador não pode ver. Mestre sem seleção segue sem barra (D-BA10).
- **Depende de**: BAR-F2-07; BAR-F4-01 (externa, FORA da frente: ver Pré-condição externa)
- **Paralelo com**: BAR-F3-01, BAR-F3-02, BAR-F4-03
- **Pré-condição externa**: BAR-F4-01 — a `fix/npc-rolagens` **mergeada na `main` do satélite** (e na `alfa/app`, se tocou o core); sem isso as rolagens do NPC não funcionam. Porteira do §3: a skill tira a tarefa da rodada se o merge não estiver feito. Declarada como `dependeExterno`.
- **Modelo / esforço**: sonnet / high — modelo de dados diferente da ficha de personagem e provedor que carrega dado sensível.
- **Teste (TDD)**: **negativo**: o provedor chamado com `isGm: false` devolve `[]` e `status` sem `gmOnly`; para o Mestre, o bônus do golpe é o do statblock somado ao MAP conforme a regra escrita no teste (0/−5/−10; ágil 0/−4/−8); o Golpe Reativo vem em `reactions` e não conta no MAP (`countsForMap: false`); `execute` do golpe emite o mesmo `chat:send` que o botão da ficha de NPC consertada. Amplia `npcSheetVM.test.ts`.
- **Prova visual (print)**: **T6** (Mestre · NPC): selo "Mestre · NPC", CA 18 e PV exatos, aba Reações com o Golpe Reativo ⟳, aba Ações com o Golpe Duplo ◆◆; e o mesmo NPC **não** aparece para o jogador.
- **Spec/REQ**: `REQ-BAR-082`, `REQ-BAR-083`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BAR-F4-03 — Seleção múltipla do Mestre e barra-resumo com testes em grupo

- **Repo**: core
- **Onde**: `client/lib/canvas/tokens/TokenInteractionManager.ts` (hoje a seleção é única) · `client/lib/actionbar/activeActor.ts` e `client/lib/actionbar/activeActorStore.svelte.ts` (o resultado `group`) · `client/lib/actionbar/groupChecks.ts` (novo; interseção e execução em grupo) · `client/components/actionbar/GroupBar.svelte` (preenche o stub da BAR-F1-04) · testes: `client/lib/actionbar/__tests__/activeActor.test.ts` e `client/lib/canvas/tokens/__tests__/TokenInteractionManager.liveOwnership.test.ts` (ampliados), `client/lib/actionbar/__tests__/groupChecks.test.ts` (novo)
- **Entrega**: O **Mestre** seleciona vários tokens (Shift+clique soma e tira) e a barra vira uma **barra-resumo** ("3 tokens") só com o que é **comum**: os testes de grupo — salvamentos, Percepção e iniciativa. Os testes em grupo são a interseção, por `id`, das entradas `check` que o provedor de cada ator devolve; executar um salvamento roda o `execute` do provedor de cada ator, **com o `ctx` desse ator** (§2.1) e cada um com o próprio bônus; a iniciativa usa a operação de iniciativa que o combate já tem, e avisa quando um token não está no combate. **Só o Mestre**: o jogador nunca multi-seleciona e nunca recebe `group` (invariante I2 da §2.4). As operações de um token só do manager (ocultar, apagar, duplicar, setas) continuam agindo no token primário, como hoje.
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-01, BAR-F3-02, BAR-F4-02
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: `groupChecks.test.ts`: com três atores, só aparecem os testes que **todos** têm; executar um salvamento emite um `chat:send` por ator com o bônus de cada um; ator sem provedor sai da interseção. Amplia `activeActor.test.ts` (Mestre com 3 tokens → `group`; **jogador** com Shift+clique → continua única, **negativo**) e o teste de posse do manager (Shift+clique só soma para quem é privilegiado; Del e `H` agem só no primário).
- **Prova visual (print)**: **sem tela no protótipo** (T1–T7 só têm seleção única): registra-se a ausência (P1) e compara-se com a faixa e as abas da **T6**; a barra-resumo segue o mesmo desenho.
- **Spec/REQ**: `REQ-BAR-086`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### Fase F5 — Itens e consumíveis

### BAR-F5-01 — Liga o `item:consume` na aba Itens e no inventário da ficha (absorve a ALQ-F2-12) (D-BA12)

- **Repo**: core + satélite
- **Onde**: `cmp/CharacterSheet.svelte` (aba inventário: botão "Usar" e ×N) · `sheet/characterSheetVM.ts` (`inventory` com `usable` e `usesLeft`; `consumeItem()`) · `sheet/actionbar/itemsSlice.ts` (preenche o stub da BAR-F2-07) · testes: `sheet/__tests__/inventory-consume.test.ts` (novo), `sheet/__tests__/actionbar-items.test.ts` (novo) e, no core, `server/net/__tests__/item-consume.test.ts` (ampliado)
- **Entrega**: O `item:consume` **já está pronto no servidor** (`server/net/handlers/item-handlers.ts`: dono ou Mestre, `expectedVersion`, baixa a quantidade e os usos, apaga com `autoDestroy`, aplica efeito, rola cura e dano) e **não tem chamador no client**. Esta tarefa liga o chamador nos dois lugares com **uma só função** (`consumeItem(itemId)` no VM, que monta `{ actorId, itemId, mode: "use", expectedVersion: <_stats.version do ator> }` e chama `services.request("item:consume", …)`): a **aba Itens da barra** (selo de quantidade ×N, quantidade 0 esmaecida com o motivo "Acabou"; T5) e o **inventário da ficha** (botão "Usar", ×N). A quantidade atualiza pelo broadcast do documento, sem estado paralelo. No core, a tarefa só **amplia o teste de servidor** em que a UI se apoia (negativos de posse e de zero).
- **Conferir antes**: absorve a **ALQ-F2-12** (plano do Alquimista de 16/09, cartão em `docs/design/alquimista/tasks.md` na branch `docs/alquimista-tasks`). Ler o cartão e conferir no código atual `characterSheetVM.ts` (`inventory`, `consumeItem`), a aba de inventário de `CharacterSheet.svelte` e `item-handlers.ts` antes de escrever: as linhas citadas lá são de 16/09. A parte de **efeitos ativos** daquele cartão já foi entregue pelo Bhrotto (BHR-F2-07); aqui entram só o **"Usar" e a quantidade**.
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-01, BAR-F3-02, BAR-F4-02
- **Modelo / esforço**: sonnet / high — liga a UI a uma op de servidor com escrita atômica e versão esperada.
- **Teste (TDD)**: `inventory-consume.test.ts`: `usable` só em consumível com uso; `consumeItem(id)` emite **exatamente um** `item:consume` com `expectedVersion`; item sem unidade vem `unavailable` com "Acabou". `actionbar-items.test.ts`: a aba lista os consumíveis com `uses`, o zero fica esmaecido, o clique chama `request("item:consume", …)`. No servidor, amplia `item-consume.test.ts` (se ainda não houver): **jogador sem posse → `PERMISSION_DENIED`**, consumir com `quantity: 0` é recusado, dois consumos concorrentes com `quantity: 1` dão um ok e um `CONFLICT`.
- **Prova visual (print)**: **T5** (Itens: ×2, ×5, ×10, ×100, quantidade 0 esmaecida com "Acabou") e a ficha com "Usar", antes e depois do clique, como jogador.
- **Spec/REQ**: `REQ-BAR-087`, `REQ-SYS-143`, `REQ-SYS-144`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L3

### BAR-F5-02 — A bomba consome a unidade ao ser arremessada e a munição baixa no disparo (absorve a ALQ-F2-14) (D-BA12)

- **Repo**: core + satélite
- **Onde**: `sheet/characterSheetVM.ts` (`rollStrike`/`strikeCard`, onde o golpe de item com `consumesOnUse` passa a chamar o `item:consume`) · `sheet/actionbar/strikesSlice.ts` (esmaece sem unidade) · `server/net/handlers/item-handlers.ts` (só se o modo `strike` não fizer o que o recorte precisa) · testes: `server/net/__tests__/item-consume.test.ts` e `sheet/__tests__/actionbar-strikes.test.ts` (ampliados)
- **Entrega**: Arremessar uma **bomba** consome **uma unidade** (`item:consume` com `mode: "strike"` e o `mapIndex` do golpe, que o protocolo já tem), e disparar uma arma de munição baixa a munição. Sem unidade ou sem munição o golpe fica `unavailable` com o motivo ("Sem unidades", "Sem munição"); a quantidade que a BAR-F2-02 já exibe passa a acompanhar o broadcast.
- **Conferir antes**: absorve a **ALQ-F2-14** (e depende da derivação da **ALQ-F2-13**, que as ondas 1–5 do Alquimista já trouxeram para a `alfa/app`; confirme). Ler os dois cartões em `docs/design/alquimista/tasks.md` (branch `docs/alquimista-tasks`) e conferir no servidor o que o modo `strike` do `item:consume` faz hoje. Entregar o **recorte mínimo**: consumir a unidade ao arremessar. O cartão de origem também pede o ataque rolado no servidor, com grau e `rollContext`; se o recorte mínimo não bastar para isso, é **extensão de escopo** e volta ao orquestrador em 3 linhas, sem a lane decidir sozinha.
- **Depende de**: BAR-F5-01
- **Paralelo com**: BAR-F3-03, BAR-F3-05, BAR-F6-01
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: bomba com `quantity: 3` → 2 depois do arremesso e **uma** mensagem de chat; com `quantity: 0` o golpe vem `unavailable` e o clique não emite `item:consume`; o `mapIndex` do golpe chega à op; arma de munição com munição 10 → 9 no disparo e o `unavailable` em 0. Amplia `item-consume.test.ts` (modo `strike`) e `actionbar-strikes.test.ts`.
- **Prova visual (print)**: **T2** (o golpe de bomba e o de disparo com o selo de quantidade caindo, ×10 → ×9).
- **Spec/REQ**: `REQ-BAR-088`, `REQ-SYS-143`, `REQ-PF2-224`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### Fase F6 — Companheiros e vínculos

### BAR-F6-01 — Barra do companheiro, do eidolon e do servo; Comandar e Agir Junto na barra do dono

- **Repo**: core + satélite
- **Onde**: `sheet/actionbar/companionProvider.ts` (novo) · `sheet/registerPf2eSheets.ts` (`actionBarRegistry.register("Actor", "familiar", createPf2eCompanionProvider())`) · `sheet/actionbar/actionsSlice.ts` (Agir Junto ao lado do Comandar do dono) · testes: `sheet/__tests__/actionbar-companion.test.ts` (novo), `sheet/__tests__/companionCommandMark.test.ts` (ampliado) e, no core, `client/lib/actionbar/__tests__/activeActor.test.ts` (ampliado)
- **Entrega**: Quando o **dono seleciona** o urso ou o antílope do Bhrotto, o eidolon ou o servo, a barra é a **dele** (a posse do companheiro nasce copiada da do dono, DEC-ATR-18 e DEC-ATR-19, então o gate da regra 1 da §2.4 vale sem predicado novo; é esta tarefa que registra o provedor `familiar`, e **só a partir dela** o companheiro selecionado vira o ator ativo — antes, a seleção cai na regra 2, REQ-BAR-009), com os golpes e ações da ficha própria do companheiro (`companionSheetVM.ts`, `eidolonPanelVM.ts`). A barra **do dono** mostra **Comandar um Animal** ou **Agir Junto**, esmaecidos com o motivo quando já usados no turno (o `commandMark` já existe), **mas o clique segue chegando à função da ficha** (CA-BAR-17, REQ-BAR-104). **Gate (D-BA01)**: o companheiro de outro jogador **não** aparece para quem não é o dono, só para o Mestre; teste negativo no store.
- **Depende de**: BAR-F4-02
- **Paralelo com**: BAR-F3-03, BAR-F3-05, BAR-F5-02
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: **negativo**: jogador A seleciona o companheiro do jogador B → a barra segue no PJ de A (amplia `activeActor.test.ts`); o dono seleciona o companheiro → `actor/selection` e o provedor devolve as entradas do companheiro; Comandar volta `unavailable` com o motivo quando o `commandMark` do turno existe **e o `execute` dele ainda chama a função da ficha** (CA-BAR-17); o Mestre vê a barra de qualquer companheiro. Amplia `companionCommandMark.test.ts`.
- **Prova visual (print)**: sem tela dedicada no protótipo (a **T4** mostra o Urso como token do Bhrotto e o Comandar esmaecido na barra do dono): registra-se a ausência (P1) e compara-se com a T4 e a T6.
- **Spec/REQ**: `REQ-BAR-089`, `REQ-BAR-090`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### Fase F7 — Ações e estados que faltam (motor; recortes de outras frentes)

### BAR-F7-01 — Desmoralizar, Fintar, Rememorar Conhecimento e Esconder executáveis (D-BA11)

- **Repo**: satélite
- **Onde**: `sheet/actions/skillActions.ts` (novo) · `sheet/actions/executableRows.ts` (registra as quatro linhas; arquivo-gargalo da F7, §3) · testes: `sheet/__tests__/executableRows.skillActions.test.ts` (novo, no padrão dos `executableRows.<tema>.test.ts` vizinhos)
- **Entrega**: As quatro deixam de só postar o card (D-BA11) e passam a ser **executáveis**, pelo mesmo `useExecutable` e o mesmo tipo de linha executável de Agarrar, Empurrar e Derrubar, **sem o campo `maneuver`** (abaixo) (a CD do alvo lida no banco, nunca do cliente): **Desmoralizar** (Intimidação contra a CD de Vontade do alvo mirado), **Fintar** (Enganação contra a CD de Percepção), **Esconder** (Furtividade contra a CD de Percepção) e **Rememorar Conhecimento** (teste secreto da perícia do saber; a CD é do Mestre, então a barra rola o teste e posta o card sem CD de alvo). O plano e o REQ-BAR-091 agrupam as quatro como "contra a Vontade ou a Percepção do alvo"; Rememorar Conhecimento não tem CD de alvo na regra, e essa é a única diferença (a lane confirma na fonte do PF2e e, se discordar, devolve em 3 linhas). O resultado posta o card com o grau e, onde a regra dá condição (Amedrontado, Desprevenido), oferece aplicá-la pelo botão do card, como o Derrubar já faz. **Nenhuma conta para o MAP** (não têm o traço ataque): o contador do servidor não anda. **Cuidado com o servidor** (`chat-handler.ts`, por volta de `:543` e `:699`, conferido): ele fixa a defesa pelo `maneuver` do `checkContext` (a tabela `MANEUVER_DEFENSE` do engine-2e já tem `feint` e `demoralize`) e **conta MAP para toda perícia graduada que declara `maneuver`**. Como estas quatro não têm o traço ataque, a lane **não declara `maneuver`** nelas: o MAP não anda, e a defesa contra a qual o servidor gradua passa a ser a que a linha nomeia (`against`). Se isso abrir uma brecha que a lane considere inaceitável (o jogador nomear a defesa mais fraca do alvo), ela devolve ao orquestrador em 3 linhas a mudança de servidor que separa "defesa fixa" de "conta MAP" — não a faz por conta própria, porque `chat-handler.ts` não está no `Onde` desta tarefa.
- **Depende de**: BAR-F2-04
- **Paralelo com**: BAR-F1-05, BAR-F3-04, BAR-F7-02
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: regra do PF2e remaster escrita no teste: Desmoralizar contra a CD de Vontade dá Amedrontado 1 em sucesso e 2 em sucesso crítico; Fintar contra a CD de Percepção; **depois de qualquer das quatro, `attacksThisTurn` não muda, o `mapIndex` do golpe seguinte continua 0 e o `checkContext` enviado não traz `maneuver`**; sem alvo marcado a linha posta o card sem rolar contra CD. Novo `executableRows.skillActions.test.ts`.
- **Prova visual (print)**: **T4** (Ações com as quatro executáveis e o card de resultado).
- **Spec/REQ**: `REQ-BAR-091`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L4

### BAR-F7-02 — Desarmar, Reposicionar e Escapar (D-BA12)

- **Repo**: core + satélite
- **Onde**: `sheet/actions/maneuvers.ts` (novo) · `sheet/actions/executableRows.ts` (registra as três linhas; arquivo-gargalo da F7, §3) · `sheet/actions/maneuverSize.ts` (limite de tamanho, só se a regra o pedir) · `sat:systems/engine-2e/src/maneuvers.ts` (`ManeuverDefSlug` e `MANEUVER_DEFS` ganham Desarmar e Reposicionar, com o resultado por grau) · `server/chat/chat-handler.ts` (só no caminho do Escapar descrito na Entrega) · testes: `sheet/__tests__/executableRows.maneuvers.test.ts` (novo), `sheet/__tests__/maneuverSize.test.ts` (ampliado se o limite mudar), `sat:systems/engine-2e/src/__tests__/maneuvers.test.ts` (ampliado) e, se mexer no servidor, `server/__tests__/chat-skill-degree.test.ts` (ampliado)
- **Entrega**: As três manobras restantes (D-BA12) viram executáveis, pelo padrão das três já feitas (Agarrar, Empurrar, Derrubar): CD do alvo **lida no banco**, `mapIndex` do MAP que o servidor conta, limite de tamanho onde a regra o exige. **Desarmar** (Atletismo contra a CD de Reflexos), **Reposicionar** (Atletismo contra a CD de Fortitude) e **Escapar** (contra a CD do que prende o personagem; sem origem conhecida, posta o card). As três têm o **traço ataque e contam o MAP**: o servidor registra o ataque e o `badge` do golpe seguinte cai (`countsForMap`). **O que o código de hoje permite** (conferido em `systems/engine-2e/src/maneuvers.ts` e `server/chat/chat-handler.ts`): o servidor fixa a defesa pelo `maneuver` do `checkContext` e recusa um `maneuver` fora da tabela com "Unknown maneuver"; `MANEUVER_DEFENSE` já tem `disarm` (Reflexos) e `reposition` (Fortitude), mas `ManeuverDefSlug` e `MANEUVER_DEFS` só têm `grapple`, `shove` e `trip` — a lane acrescenta Desarmar e Reposicionar ali. **Escapar não tem defesa fixa**, porque a CD é a do efeito que prende: ele não entra em `MANEUVER_DEFENSE` por si, e declarar `maneuver: "escape"` hoje volta "Unknown maneuver". Para Escapar graduar contra a CD do efeito e contar o MAP, a lane faz no servidor a mudança mínima (reconhecer `escape` e aceitar a CD do efeito que prende, lida do banco quando a condição guardar a origem), com teste; se a mudança no servidor passar de pequena, ela **devolve ao orquestrador em 3 linhas** e o Escapar fica como "rola o teste e posta o card, sem grau e sem contar MAP", registrado no relatório.
- **Conferir antes**: recorte da **GUE-F5-03** (plano do Guerreiro de 16/09, `docs/design/guerreiro/tasks.md` na branch `docs/guerreiro-tasks`; ler o cartão e o contrato `ManeuverAction`). O Bhrotto já entregou o miolo (BHR-F6-01..04, `executableRows.ts`, `maneuverSize.ts`, `engine-2e/src/maneuvers.ts`): confira o código atual antes de acrescentar, porque as linhas do cartão de origem mudaram. As regras de tamanho e de mãos livres vêm da fonte do PF2e remaster, não do código atual.
- **Depende de**: BAR-F2-04
- **Paralelo com**: BAR-F1-05, BAR-F3-04, BAR-F7-01
- **Modelo / esforço**: sonnet / high — manobras que mexem no MAP e em tamanho.
- **Teste (TDD)**: regra do PF2e escrita no teste: Desarmar contra Reflexos, Reposicionar contra Fortitude; depois de **uma** das três, o próximo golpe sai com o MAP de segundo ataque (−5, ou −4 se ágil); o limite de tamanho recusa o alvo grande demais com o motivo; sem alvo posta o card; `maneuvers.test.ts` do engine cobre Desarmar e Reposicionar por grau; **Escapar**: `maneuver: "escape"` deixa de voltar "Unknown maneuver" e o ataque conta MAP (ou, se a mudança de servidor foi devolvida ao orquestrador, o teste afirma que Escapar posta o card sem grau e sem contar MAP). Novo `executableRows.maneuvers.test.ts`.
- **Prova visual (print)**: **T4** (as seis manobras com o selo MAP, antes e depois de uma delas, o `badge` do golpe caindo).
- **Spec/REQ**: `REQ-BAR-092`, `REQ-CBT-069`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L4

### BAR-F7-03 — Erguer um Escudo com estado e Bloqueio com Escudo (D-BA12)

- **Repo**: core + satélite
- **Onde**: `sheet/actions/shield.ts` (novo) · `sheet/actions/executableRows.ts` (registra as duas linhas; arquivo-gargalo da F7, §3) · `sheet/combatStatesVM.ts` (mostra "Escudo erguido") · `sat:systems/pf2e/src/derivations/` (a CA derivada leva o bônus enquanto o efeito existe) · `server/combat/turn-hook-runner.ts` (a expiração no começo do próximo turno do dono; só se o ganho da BHR-F0-03 não bastar) · testes: `sheet/__tests__/executableRows.shield.test.ts` (novo)
- **Entrega**: **Erguer um Escudo** passa a ser uma ação executável de 1 ação que aplica o efeito "Escudo erguido": **bônus de circunstância na CA igual ao do escudo equipado, até o começo do próximo turno do dono** (expiração ancorada no dono, `ownerActorId`, que a BHR-F0-03 já provou). **Bloqueio com Escudo** vira uma **reação com disponibilidade**: só com o escudo erguido e inteiro; ao usar, o escudo previne dano até a sua **Dureza** e o personagem e o escudo sofrem o restante (PV do escudo e quebra). **Sem contador de reações** (o pool é a BAR-F7-05, que espera): a barra só mostra a reação disponível ou esmaecida com o motivo (D-15).
- **Conferir antes**: recorte da **GUE-F5-01/02** (plano do Guerreiro de 16/09; ler o contrato `ShieldState` da §2.5 daquele plano: `hp` e `broken` no item, "erguido" como efeito com duração) e a **ALQ-F2-09** (expiração). Confira no código atual o que já existe de expiração e de PV de escudo; entregue o recorte mínimo e devolva ao orquestrador, em 3 linhas, qualquer extensão de escopo (por exemplo, interceptar o dano antes de aplicado, que depende do pool de reação).
- **Depende de**: BAR-F2-04
- **Paralelo com**: BAR-F1-05, BAR-F3-04, BAR-F7-01
- **Modelo / esforço**: sonnet / high — estado de escudo, expiração e reação.
- **Teste (TDD)**: regra do PF2e escrita no teste: com um escudo de bônus +2, Erguer um Escudo leva a CA de 17 a 19 e o efeito **expira no começo do próximo turno do dono** (não no do companheiro nem no de outro); sem escudo equipado a ação vem `unavailable` com o motivo; Bloqueio com Escudo só fica `ready` com o escudo erguido e não quebrado; dano 12 com Dureza 5: o escudo previne 5 e o personagem e o escudo sofrem 7 cada um. Novo `executableRows.shield.test.ts`.
- **Prova visual (print)**: **T4** (Ações com Erguer um Escudo, o chip "Escudo erguido" na faixa e a CA subindo na ficha) e a aba Reações com o Bloqueio disponível.
- **Spec/REQ**: `REQ-BAR-093`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L4

### BAR-F7-04 — Posturas e Fúria como alternáveis com estado (D-BA12)

- **Repo**: core + satélite
- **Espera**: depende de **entrega de outra frente**: o `ondas.cjs` a põe na última onda e ela passa pela porteira do §3 antes de qualquer rodada.
- **Onde**: `sheet/actionbar/actionsSlice.ts` (as posturas e a Fúria como `kind: "toggle"` com `state`) · `sheet/rollOptionToggles.ts` (só leitura do mecanismo entregue) · testes: `sheet/__tests__/actionbar-actions.test.ts` (ampliado)
- **Entrega**: As posturas (uma por vez, exclusividade imposta pelo **sistema**, D-A09) e a Fúria aparecem como alternáveis na aba Ações com a marca de ligado, e clicar chama a operação do mecanismo de postura que a outra frente entregar: a barra só mostra o `state` e dispara; a regra e a exclusividade não são dela. No lado do core, o chip alternável já existe desde a BAR-F1-04 e a BAR-F2-04.
- **Depende de**: **ANI-F3-03** ou **GUE-F6-01** (basta uma das duas: o mecanismo genérico de postura)
- **Paralelo com**: BAR-F7-05, BAR-F7-06
- **Pré-condição externa**: a postura entregue **e mergeada** em `alfa/app`/`main`. Porteira do §3. Conferir o contrato real entregue, porque o cartão de origem é de 16/09.
- **Modelo / esforço**: sonnet / high — depende de um contrato que ainda não existe.
- **Teste (TDD)**: ligar uma postura desliga a anterior **pelo mecanismo do sistema** (a barra não implementa exclusividade); o alternável reflete `state: "active"` pelo broadcast; o Fúria ligado mostra a marca. Amplia `actionbar-actions.test.ts`.
- **Prova visual (print)**: **T1** (a postura ligada como chip com a borda e o ponto aceso, igual ao Esgueirar da T1).
- **Spec/REQ**: `REQ-BAR-094`, `REQ-BAR-097`
- **Tamanho**: G
- **Onda**: 8 · **Lote**: L4

### BAR-F7-05 — Aba Reações com disponibilidade (D-BA12)

- **Repo**: core
- **Espera**: depende de **entrega de outra frente**: o `ondas.cjs` a põe na última onda e ela passa pela porteira do §3 antes de qualquer rodada.
- **Onde**: `client/components/actionbar/Slot.svelte` e `client/components/actionbar/TabBar.svelte` (a disponibilidade da reação) · testes: `client/components/actionbar/__tests__/ActionBar.test.ts` (ampliado)
- **Entrega**: A aba **Reações** (que existe desde a BAR-F1-04 listando as reações do ator) passa a mostrar a **disponibilidade** de cada reação a partir do `ReactionPool` que a GUE-F4-01 entregar (valor **derivado do ator**, que talento alcança e altera): disponível, gasta e, quando houver, a oferta. Segue a D-15 no que ela decide (a barra não conta ações) e a **D-G14** do plano do Guerreiro, que abre a exceção: o pool de reações **não** é contador de ações nem regra dura, e sim valor derivado do ator, que talento alcança e altera; sem o pool, a aba continua listando as reações sem disponibilidade.
- **Depende de**: **GUE-F4-01** (pool de reação)
- **Paralelo com**: BAR-F7-04, BAR-F7-06
- **Pré-condição externa**: o pool de reação entregue **e mergeado**. Porteira do §3. Conferir o contrato `ReactionPool`/`ReactionOffer` real.
- **Modelo / esforço**: sonnet / low
- **Teste (TDD)**: a reação sem ficha de uso vem esmaecida com o motivo (e o clique ainda chega ao `execute`, REQ-BAR-104); a que tem vem pronta; com o pool ausente a aba não muda. Amplia `ActionBar.test.ts`.
- **Prova visual (print)**: **T6** (aba Reações com o Golpe Reativo ⟳).
- **Spec/REQ**: `REQ-BAR-095`, `REQ-BAR-097`
- **Tamanho**: P
- **Onda**: 8 · **Lote**: L4

### BAR-F7-06 — Recursos de classe genéricos na faixa de estado (D-BA12)

- **Repo**: core + satélite
- **Espera**: depende de **entrega de outra frente**: o `ondas.cjs` a põe na última onda e ela passa pela porteira do §3 antes de qualquer rodada.
- **Onde**: `sheet/actionbar/statusSlice.ts` (os recursos de classe em `ActionBarStatus.resources`) · testes: `sheet/__tests__/actionbar-status.test.ts` (ampliado)
- **Entrega**: O recurso de classe genérico (um contador **de recurso**, como "Frascos versáteis 6/6", e não de ações) aparece na faixa de estado, a partir do `SpecialResource` da spec 47 que a frente do Alquimista entregar. A casca já desenha `resources` desde a BAR-F1-04; esta tarefa só alimenta o campo.
- **Depende de**: **ALQ-F3-02**, **ALQ-F3-04**
- **Paralelo com**: BAR-F7-04, BAR-F7-05
- **Pré-condição externa**: os dois entregues **e mergeados**. Porteira do §3. Conferir o contrato real da spec 47.
- **Modelo / esforço**: sonnet / low
- **Teste (TDD)**: o recurso de classe aparece com `value` e `max` da ficha; sem o recurso a faixa não muda. Amplia `actionbar-status.test.ts`.
- **Prova visual (print)**: faixa de estado com o recurso de classe ao lado do Foco e do Herói (desenho da **T1**/**T3**).
- **Spec/REQ**: `REQ-BAR-096`, `REQ-BAR-097`, `REQ-FAB-*` (spec 47, citada)
- **Tamanho**: P
- **Onda**: 8 · **Lote**: L4

### Fase F8 — Alcance, tablet e acabamento

### BAR-F8-01 — Anel de alcance no canvas ao passar o mouse

- **Repo**: core
- **Onde**: `client/lib/canvas/rangeRing.ts` (novo; desenho no PIXI e geometria de `shared/grid`) · `client/lib/canvas/FusionCanvas.ts` (monta a camada do anel, que lê `controller.hovered` da §2.8) · testes: `client/lib/canvas/__tests__/rangeRing.test.ts` (novo)
- **Entrega**: Ao passar o mouse num golpe ou magia com `range`, um **anel de alcance** aparece em volta do token do ator ativo, com a geometria e a medida de distância de `shared/grid` (`squareCellDistance`, `squareMeasurePath`); **vermelho** quando o alvo marcado está fora do alcance, com a distância no tooltip ("Fora de alcance: 45 pés"). É só informação: **não bloqueia** o clique (D-15).
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-01, BAR-F3-02, BAR-F4-02
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: `rangeRing.test.ts` (geometria pura): golpe corpo a corpo de alcance 5 pés cobre as casas adjacentes; arma de alcance 10 pés cobre duas; à distância 30 pés cobre seis casas em cada direção; alvo a 7 casas está fora e o anel vem vermelho; sem alvo o anel é neutro; sem `range` não há anel.
- **Prova visual (print)**: **sem tela no protótipo** (a T2 só cita o gesto no texto): registra-se a ausência (P1); print do anel verde e do vermelho no canvas.
- **Spec/REQ**: `REQ-BAR-098`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L5

### BAR-F8-02 — Modo mira quando falta alvo

- **Repo**: core
- **Onde**: `client/lib/actionbar/aimMode.svelte.ts` (novo) · `client/lib/actionbar/actionBarController.svelte.ts` (a casca entra no modo mira e expõe `requestTargets`) · `client/components/actionbar/AimOverlay.svelte` (novo; canvas levemente escurecido e a dica no topo) · `client/lib/canvas/tokens/TokenInteractionManager.ts` (o clique no token, no modo mira, marca o alvo) · testes: `client/lib/actionbar/__tests__/aimMode.test.ts` (novo) e `client/lib/canvas/tokens/__tests__/targeting-gesture.test.ts` (ampliado)
- **Entrega**: A entrada que precisa de alvo (`target: "one" | "many"`) e é executada **sem alvo marcado** entra no **modo mira**: cursor de mira, o canvas escurece levemente e uma dica aparece no topo. **Clicar num token** (botão esquerdo, ou direito, que é o gesto de marcar que já existe, DEC-CBA-05) marca o alvo e **executa a ação pendente**; **Esc** ou botão direito no vazio **cancela** sem executar. Implementa o `ActionBarServices.requestTargets` da §2.3. Não cria controle de mira em painel (DEC-CBA-05).
- **Depende de**: BAR-F2-07
- **Paralelo com**: BAR-F3-03, BAR-F3-05, BAR-F5-02
- **Modelo / esforço**: sonnet / low
- **Teste (TDD)**: `aimMode.test.ts`: golpe sem alvo entra no modo mira e **não** emite o ataque; clicar num token marca o alvo (`combat:target`) e emite o ataque com ele; Esc cancela e não emite nada; com alvo já marcado o clique executa direto. Amplia `targeting-gesture.test.ts` para garantir que o gesto de marcar do botão direito segue igual fora do modo mira.
- **Prova visual (print)**: **T7** (Recolhida + mira): o canvas escurecido, o cursor de mira e a dica no topo, e o Arco Elétrico pedindo alvo.
- **Spec/REQ**: `REQ-BAR-099`, `DEC-CBA-05`
- **Tamanho**: P
- **Onda**: 6 · **Lote**: L5

### BAR-F8-03 — Tablet e toque: alvos de 44 px, safe-area, hover permanente e navegação completa por Tab

- **Repo**: core
- **Onde**: `client/components/actionbar/ActionBar.svelte`, `client/components/actionbar/Slot.svelte`, `client/components/actionbar/SlotGrid.svelte`, `client/components/actionbar/TabBar.svelte` (CSS de toque e ordem de foco) · `client/lib/actionbar/layout.ts` (modo tablet por `pointer: coarse`) · `client/styles/base.css` (tokens de toque) · testes: `client/components/actionbar/__tests__/ActionBar.test.ts` (ampliado) e `client/components/sidebar/__tests__/SidebarResponsive.test.ts` (ampliado)
- **Entrega**: Em dispositivo de toque, **alvos de 44 px**, respeito à **safe-area**, e o **hover permanente**: tocar num slot mostra o tooltip fixo (não existe hover), e o **toque longo** faz o papel do botão direito (menu). **Navegação completa por Tab** (spec 23): ordem de foco coerente (faixa, abas, slots, Encerrar turno), `aria-keyshortcuts` com a tecla de cada slot e o foco visível. Não há modo tablet hoje; o único breakpoint do shell é a gaveta abaixo de 900 px.
- **Depende de**: BAR-F3-03
- **Paralelo com**: BAR-F8-04
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: em `pointer: coarse` o alvo mínimo de cada controle é 44 px; o toque longo abre o menu; a ordem de Tab percorre faixa → abas → slots → Encerrar turno e o foco nunca cai fora da barra; `aria-keyshortcuts` presente. **Ambiente (§2.10):** sem DOM, o alvo mínimo de 44 px e o `aria-keyshortcuts` se conferem na folha de estilo e na renderização no servidor, e o toque longo e a ordem de Tab real ficam no roteiro de print do L5.
- **Prova visual (print)**: **sem tela no protótipo** (P1: ausência registrada); print da barra num viewport de tablet (1024 × 768, toque emulado) com o tooltip fixo e o foco visível.
- **Spec/REQ**: `REQ-BAR-100`, `REQ-A11-005`, `REQ-A11-044`, `REQ-A11-046`, `REQ-A11-049`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L5

### BAR-F8-04 — SF2e: munição, cargas e Recarregar na barra

- **Repo**: core + satélite
- **Onde**: `sat:systems/sf2e/src/actions/strikes.ts` (onde o `consumeCharge` existe sem chamador; confirmar o arquivo) · `sheet/actionbar/strikesSlice.ts` (munição e cargas) · `sheet/actionbar/actionsSlice.ts` (Recarregar como ação executável) · testes: `sheet/__tests__/actionbar-strikes.test.ts` e `sheet/__tests__/actionbar-actions.test.ts` (ampliados)
- **Entrega**: No SF2e, os golpes de arma de fogo mostram **munição e cargas** (`uses`), cada disparo baixa a carga pelo `consumeCharge` (hoje sem chamador) e **Recarregar** vira ação executável que repõe a carga (o rótulo exato vem do pack pt-BR do SF2e, REQ-BAR-021: confira na fonte, não invente); sem carga o golpe fica `unavailable` com o motivo. Reaproveita o `item:consume` e a quantidade exibida da F5.
- **Depende de**: BAR-F5-02
- **Paralelo com**: BAR-F8-03
- **Modelo / esforço**: sonnet / medium
- **Teste (TDD)**: arma com 2 cargas → 1 depois de um disparo → 0 depois de dois e o golpe `unavailable`; Recarregar devolve a carga conforme a regra escrita no teste; PF2e (sem cargas) não muda.
- **Prova visual (print)**: **sem tela no protótipo** (o SF2e não aparece nas T1–T7; P1: ausência registrada); print do golpe com carga e do Recarregar num personagem SF2e.
- **Spec/REQ**: `REQ-BAR-101`, `REQ-SF2-*` (spec 18, citada)
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L5

## 5. Ondas

Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do pin no core com a suíte verde.

Pré-frente, onda 0, nunca entram numa rodada: `BAR-F0-01`, `BAR-F0-02`, `BAR-F0-03`, `BAR-F4-01` (feitas antes da frente ou fora dela, ver `Situação` nos cartões).

| Onda | Tarefas                                                          | Repo  | Espera algo de fora                                             |
| ---- | ---------------------------------------------------------------- | ----- | --------------------------------------------------------------- |
| 1    | BAR-F1-01, BAR-F1-02, BAR-F1-03, BAR-F2-01                       | ambos | —                                                               |
| 2    | BAR-F1-04, BAR-F2-02, BAR-F2-03, BAR-F2-04, BAR-F2-05, BAR-F2-06 | ambos | —                                                               |
| 3    | BAR-F1-05, BAR-F3-04, BAR-F7-01, BAR-F7-02, BAR-F7-03            | ambos | —                                                               |
| 4    | BAR-F2-07                                                        | ambos | —                                                               |
| 5    | BAR-F3-01, BAR-F3-02, BAR-F4-02, BAR-F4-03, BAR-F5-01, BAR-F8-01 | ambos | `BAR-F4-01`                                                     |
| 6    | BAR-F3-03, BAR-F3-05, BAR-F5-02, BAR-F6-01, BAR-F8-02            | ambos | —                                                               |
| 7    | BAR-F8-03, BAR-F8-04                                             | ambos | —                                                               |
| 8    | BAR-F7-04, BAR-F7-05, BAR-F7-06                                  | ambos | `ALQ-F3-02`, `ALQ-F3-04`, `ANI-F3-03`, `GUE-F4-01`, `GUE-F6-01` |

Fechamento por lote: L1 na onda 4 · L2 na onda 6 · L3 na onda 6 · L4 na onda 8 · L5 na onda 7.

## 6. Lotes de print

Regras comuns: servidor isolado em mundo existente (cópia de `a_queda`) com data-dir no scratchpad, fora da worktree; o primeiro passo confere a branch com `git merge-base --is-ancestor`; um print por tarefa com UI, visão do Mestre e do jogador; prints em `.fusion-build/barra-de-acoes/<lote>/<fase>/`; relatório P3 em `.fusion-build/barra-de-acoes/<lote>/relatorio.html`, com **protótipo × tela** contra `docs/design/barra-de-acoes/prototipo-barra-fiel.html` (telas T1–T7). Cada print é aberto com Read, um por um, antes de a tarefa se declarar pronta (Iron Law da skill `tutorial-e2e`).

| Lote | Fases | Roteiro                                 | O que o lote prova                                                                                                                                                                                                                                                                                       |
| ---- | ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | F1+F2 | BAR-F2-07                               | **a barra jogável** (T1, T2, T3, T4, T7): cada jogador de A Queda usa a barra do próprio PJ — golpe com o MAP do servidor, magia gastando slot e foco, ações executáveis, testes; o jogador que clica num NPC não vê a barra dele; o Mestre vê a de qualquer PJ; tecla "1" executa e não dispara no chat |
| L2   | F3+F4 | fechamento do lote (sem tarefa própria) | **Favoritos de verdade e a barra do Mestre** (T1, T3, T4, T6, T7): semente, fixar, arrastar e órfão; menu de botão direito e seletor de variantes; recolhida que persiste; ícone customizado e galeria; barra do NPC só para o Mestre e a seleção múltipla                                               |
| L3   | F5+F6 | fechamento do lote                      | **itens e companheiros** (T5, T4): "Usar" com a quantidade caindo, bomba e munição consumidas, e a barra do companheiro, do eidolon e do servo com Comandar e Agir Junto na barra do dono                                                                                                                |
| L4   | F7    | fechamento do lote                      | **as ações que faltam** (T4, T6): Desmoralizar, Fintar, Rememorar, Esconder, Desarmar, Reposicionar, Escapar, Erguer um Escudo e Bloqueio; posturas, aba Reações e recursos de classe quando as outras frentes entregarem                                                                                |
| L5   | F8    | fechamento do lote                      | **alcance, mira, tablet e SF2e** (T7): anel de alcance, modo mira, toque e Tab, munição e cargas do SF2e                                                                                                                                                                                                 |

O plano aprovado tem 36 tarefas e **só uma tem roteiro** (a BAR-F2-07, que fecha o L1). Nos lotes L2 a L5 o roteiro é um **passo do fechamento de lote** (Passo 5 da skill): o orquestrador lança **um** subagente `sonnet` que escreve e roda `.claude/skills/tutorial-e2e/roteiros/barra-l<N>.spec.ts` cobrindo as telas da lista "Prova visual" das tarefas do lote. Não é tarefa nova: não entra no `tasks-resumo.json` nem no estado.

O **L1 é o lote que muda a mesa**: sem ele, nada do resto tem onde acontecer. Se a frente precisar parar em algum lugar, é depois dele, ou depois do L2, que traz os Favoritos e o Mestre. O **L4 só fecha de verdade** quando as três esperas (BAR-F7-04, F7-05 e F7-06) forem entregues por outras frentes; fechar um L4 parcial, com as três do motor, é decisão do Alexandre e fica fora do `record.mjs`, que só fecha lote completo.

**O PR de lote leva o que estiver integrado.** As ondas seguem as dependências e os lotes só agrupam o fechamento, como no Guerreiro e no Bhrotto; então o PR do L1 (fechado na onda 4) já carrega o que a onda 3 integrou de lotes seguintes (BAR-F3-04 e BAR-F7-01..03). Se o Alexandre quiser o PR do L1 só com F1+F2, o orquestrador tira essas quatro tarefas da rodada da onda 3 (como faz com as porteiras do §3) e as roda depois do PR.

## 7. Riscos

| Risco                                                                                                                                                                                               | Efeito                                                                                     | Mitigação                                                                                                                                                                                                                                                                                                                                     | Tarefas                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Jogador vendo dados de NPC pela barra**: hoje qualquer clique seleciona qualquer token                                                                                                            | Vazam golpes, CA, PV e magias do NPC                                                       | Gate de posse no store do ator ativo (D-BA01); o provedor nunca é chamado com ator alheio; o chip de alvo usa o nome redigido; o provedor de NPC repete a defesa; teste negativo em cada um e o caso no roteiro do L1 como jogador (P4)                                                                                                       | BAR-F1-01, F2-06, F2-07, F4-02, F6-01 |
| A extração da lógica da ficha (BAR-F2-01) quebra a ficha                                                                                                                                            | Regressão na ficha em uso na mesa                                                          | Tarefa isolada e sem mudança de comportamento, nenhum teste existente alterado, suíte da ficha e `pathbuilder-parity` verdes **antes** de qualquer conteúdo da barra                                                                                                                                                                          | BAR-F2-01                             |
| O rodapé é disputado com a barra de comando do Hub, que só existe na `build/app`                                                                                                                    | Conflito se as linhas convergirem                                                          | D-BA09 e a emenda na spec 28 desde já                                                                                                                                                                                                                                                                                                         | BAR-F0-02, F1-04                      |
| Gaveta de 344 px à direita, aberta por padrão, com janelas por cima                                                                                                                                 | Barra espremida em tela estreita                                                           | Posição relativa à área livre; abaixo de ~1000 px a barra recolhe; o estado da gaveta passa a ser exportado                                                                                                                                                                                                                                   | BAR-F1-04                             |
| Teclas 1–0 disparando com foco em campo de texto ou botão                                                                                                                                           | Rolagem pública indesejada                                                                 | Registro de atalhos com guard completo (input, textarea, contenteditable, diálogo, botão focado, IME, modificadores), com teste de matriz                                                                                                                                                                                                     | BAR-F1-05, F2-07                      |
| **Anti-cheat herdado**: bônus e MAP vêm da fórmula do client; o `chat:send` genérico não confere se o `speakerActorId` é do usuário; slot e foco são gastos por `doc:update` sem validação de regra | A barra facilita um caminho que já é frouxo                                                | A barra não piora nada. O endurecimento fica numa frente própria (§8)                                                                                                                                                                                                                                                                         | todas as tarefas de execução          |
| Os planos de 16/09 envelheceram                                                                                                                                                                     | Recorte absorvido com evidência errada                                                     | Cada recorte confere o código atual antes de virar código: a linha **Conferir antes** dos cartões                                                                                                                                                                                                                                             | BAR-F5-01, F5-02, F7-02, F7-03        |
| A barra polui a mesa                                                                                                                                                                                | Crítica comum aos HUDs de PF2e                                                             | Começa enxuta, pode ser recolhida e fica oculta para o Mestre sem seleção                                                                                                                                                                                                                                                                     | BAR-F1-04, F3-04                      |
| Recalcular entradas a cada mudança                                                                                                                                                                  | Engasgo com muitos NPCs                                                                    | `entries`/`status` dentro de `$derived`, só para o ator ativo; o VM headless guardado por `actorId` + `_stats.version`                                                                                                                                                                                                                        | BAR-F1-04, F2-01                      |
| Ícone customizado como vetor de amplificação de grant: o jogador escreve milhares de caminhos no mapa de ícones do próprio ator                                                                     | Uma requisição gera milhares de grants assinados, o caso que o `asset-fields.ts` documenta | Schema com teto de 64, um caminho por valor casado inteiro, validação **no servidor** (`flags` é passthrough) e revisão adversarial na BAR-F3-05. **Agravante desta execução**: o cabeçalho de `asset-fields.ts` proíbe `flags.*` (regra 2) e só aceita `field` e `array[].field`; a exceção e a gramática nova vão documentadas no cabeçalho | BAR-F3-05                             |
| Envio de imagem aberto a todo jogador e galeria de ícones compartilhada (D-BA03)                                                                                                                    | Mais arquivos no acervo; um ícone enviado por um jogador fica visível a todos              | A validação de tipo e tamanho do pipeline vale igual para todos. Só os envios marcados como ícone entram na galeria; mapas, retratos e handouts seguem fora da lista do jogador. O Mestre apaga o que quiser (apagar segue só dele). Sem cota, por decisão                                                                                    | BAR-F3-05                             |
| **O contrato da §2 diverge da spec 53** (duas lanes escreveram a partir do mesmo esboço do plano)                                                                                                   | Lanes seguem uma forma e a spec diz outra                                                  | O orquestrador reconcilia **antes da onda 1**; a spec cita a §2 sem reescrevê-la; divergência achada depois volta como pergunta de 3 linhas                                                                                                                                                                                                   | BAR-F0-02, F1-02                      |
| **BAR-F0-02 marcada como feita sem a spec integrada**                                                                                                                                               | A F1 começa sem a spec que a embasa                                                        | Pré-requisito da skill: `specs/53-*.md` existe na worktree de integração, senão **PARE**                                                                                                                                                                                                                                                      | BAR-F0-02                             |
| **Arquivos-gargalo compartilhados** (`ActionBar.svelte`, `executableRows.ts`, `doc-handlers.ts`…)                                                                                                   | Conflito de merge entre tarefas da mesma onda                                              | Stubs pré-ligados, um dono por arquivo, `colisoes.cjs` por onda e a ordem em série declarada no §3                                                                                                                                                                                                                                            | §3                                    |

## 8. Fora do escopo / futuro

| Item                                                                                   | Motivo                                                        | Onde retomar                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------- |
| Contador de ações por turno (pips, orçamento, bloqueio)                                | D-15                                                          | spec 49 (`REQ-ACO-`, reservada) |
| Token HUD (REQ-UIF-008a)                                                               | outro propósito (controles da peça); o botão direito é a mira | spec 11                         |
| Macros e `QuickAction` declarativas                                                    | a barra substitui a hotbar; a macro entra depois como `kind`  | spec 14                         |
| Prévia de caminho com custo em ações                                                   | depende de régua com regra                                    | spec 41 / frente futura         |
| Chance de acerto na prévia                                                             | vaza a CA do alvo para o jogador                              | —                               |
| Sugestão de 3ª ação, presets, várias linhas configuráveis                              | luxo; avaliar depois do uso na mesa                           | depois da F8                    |
| Endurecimento anti-cheat (bônus no servidor, dono do speaker, conjuração autoritativa) | defeito anterior à barra, frente própria                      | frente de segurança             |
| Etmos                                                                                  | legado, vive na `build/app`                                   | —                               |
| Cota de envio de imagem por jogador                                                    | decisão do Alexandre ("não vamos limitar o upload", D-BA03)   | —                               |

## 9. Como este plano se mantém

Nada aqui é escrito à mão duas vezes. As ferramentas são as do Guerreiro adaptadas (`docs/design/guerreiro/tools/` na branch `docs/guerreiro-tasks`: `ondas.cjs` e `build-resumo.cjs`), mais o `colisoes.cjs` desta frente. Não vieram `gen.cjs`, `lacunas.cjs`, `conteudo.cjs` e `preprocess.cjs` (derivam o inventário do vault do Guerreiro) nem o `reqs.cjs` (distribui as faixas de `REQ-GUE`; as de `REQ-BAR` são da spec 53).

- **Ondas, lotes e paralelismo são derivados** das dependências: `node tools/ondas.cjs tasks.md` recalcula a onda de cada cartão por ordenação topológica (teto de 6), reescreve as linhas "Onda · Lote" e "Paralelo com" e regenera a seção 5. A F0 e a BAR-F4-01 (`Situação`) são pré-frente: onda 0, fora das rodadas. Tarefa que espera entrega de outra frente (`ALQ`/`ANI`/`GUE` em "Depende de") vai para a última onda. Mudou uma dependência, roda de novo.
- **O `tasks-resumo.json` que a skill consome** sai de `node tools/build-resumo.cjs tasks.md tasks-resumo.json`, que valida id único, dependência existente, onda que cresce, paralelismo coerente, campo obrigatório ausente e teto por onda, e falha com código 1: é gate, não relatório. Dependência de tarefa FORA da frente e de outras frentes vai para `dependeExterno`, que o `plan.mjs` não lê: a espera é a porteira do §3.
- **A disjunção de arquivos por onda** é conferida por `node tools/colisoes.cjs tasks.md [--onda N]`. A onda 1 tem de dar zero.
- **O estado de execução** (`estado.json`) é escrito pelo `record.mjs` da skill, nunca à mão. As únicas entradas escritas à mão são as do estado inicial deste plano (F0 feita, BAR-F4-01 fora da frente), que o orquestrador corrige se a spec 53 falhar.
- **O vault** (`Projects/fusion/barra-de-acoes/` e a seção "🎛️ Barra de Ações" do `Projects/fusion/todo.md`) recebe o status da execução a cada rodada (Passo 6 da skill).

Ordem completa depois de editar os cartões:

```bash
cd docs/design/barra-de-acoes
node tools/ondas.cjs tasks.md                           # recalcula ondas, lotes, paralelismo e escreve s5.md
# cole o s5.md no lugar da seção 5 e apague o s5.md
node tools/build-resumo.cjs tasks.md tasks-resumo.json  # valida e gera o resumo da skill
node tools/colisoes.cjs tasks.md                        # a onda 1 tem de dar zero
```

A seção 5 sai em `s5.md` e é colada no lugar da atual: é a única parte do arquivo que um script escreve e um humano copia. Depois, `prettier --write` nos arquivos tocados.
