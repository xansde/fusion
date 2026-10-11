# Barra de Ações: plano v1 (2026-10-11)

> **Origem**: pedido do Alexandre em 11/10/2026: "uma barra de ações. Pathfinder WotR, Baldur's Gate 3,
> Divinity, todos têm essa barra com ações comuns que eu possa querer usar, e isso AJUDARIA MUITO no Fusion".
> **Base conferida**: código em `alfa/app` `ff15043d` com o satélite no pin `2015ff7c`, benchmark de
> comportamento público (§12), specs 11/14/23/28/36/40/41 e planos das frentes Alquimista, Animista, Guerreiro
> e Bhrotto.
> **Estado**: proposta. As decisões da §8 estão abertas. As telas-alvo estão no protótipo fiel
> [`prototipo-barra-fiel.html`](prototipo-barra-fiel.html).
> **Linha**: pessoal **alfa**. Toda branch parte de `alfa/app` (core) e de `main` (satélite) e volta por PR de
> lote. Promoção é ato humano.
> **Processo**: TDD, rolagem e permissão no servidor, UI por [`PROCESSO-UI.md`](../PROCESSO-UI.md) (P1–P4) com o
> protótipo como lente, entregas pequenas.

## Resumo

- **O que é**: uma barra no rodapé da mesa, sempre do personagem (ou NPC) que está na mão. Tem golpes,
  magias, ações, itens, reações e testes a um clique ou a uma tecla, sem abrir a ficha e sem cobrir o mapa.
- **Por que agora é barato**: o grosso do motor já existe e funciona na ficha. A ficha já faz golpe com alvo e
  grau decidido pelo servidor, já usa o MAP contado no servidor, já conjura gastando slot e foco, já roda as
  ações executáveis da frente Bhrotto e já tem a mira por botão direito. O servidor também já consome itens.
  Falta a **casca** e a **ponte core ↔ sistema**: a lógica da ficha está presa dentro dos componentes Svelte e o
  core não tem como pedir ao sistema "quais as ações deste ator".
- **O que ela não faz**: não conta ações nem bloqueia nada (D-15 continua valendo, §5.4). Não é o Token HUD da
  spec 11 e não cria regra nova. Tudo executa pelos mesmos caminhos da ficha. E **nunca** mostra a um jogador a
  barra de um ator que não é dele (D-BA01, §4.2).
- **Tamanho**: 36 tarefas em 9 fases (F0–F8). A **primeira entrega jogável** é F1 + F2. Nela, cada jogador
  de A Queda usa a barra do próprio PJ para golpe, magia, ações executáveis e testes.
- **Achado urgente, fora da barra**: as rolagens da **ficha de NPC estão quebradas** na `alfa/app` (§3.2). Isso
  inclui a `fusion-mesa` da sessão de 12/10. Golpe, salvamento, Percepção e perícia de NPC não rolam pela ficha.

## 1. Por que, e o que muda na mesa

Hoje, para agir em combate no Fusion, o jogador abre a ficha numa janela por cima do mapa, acha a aba (Golpes,
Magias, Ações, Inventário), acha a linha e clica. Funciona, mas é lento e esconde o mapa justo quando ele mais
importa. Também não mostra o que interessa no turno: de quem é a vez, qual é o MAP do próximo ataque, quantos
slots de 2º patamar restam. Para o Mestre é pior, porque cada NPC é outra ficha aberta.

A barra põe o que se usa a um clique de distância, sempre do personagem que está na mão. Ela é uma **superfície
nova sobre os mesmos caminhos** da ficha. O servidor continua dono de toda rolagem, de todo grau e de toda
validação.

## 2. O que os jogos e os módulos ensinam

Benchmark de comportamento público (wikis, guias, notas de patch, fóruns, README de módulos), dentro da regra
clean-room: estudamos o que a barra **faz**, não copiamos código nem texto. As fontes estão na §12.

### 2.1 O que levar

| Padrão                                                                                                     | De onde                          | Na barra do Fusion             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------ |
| Faixa fixa com retrato e PV, slots e Encerrar turno                                                        | BG3, Argon, BG3 HUD (PF2e)       | §4.1                           |
| Golpe mostrando o **bônus final** (+9 / +4 / −1), não "MAP −5", com ajuste manual                          | HUDs PF2e, Demiplane Nexus       | variante padrão = MAP corrente |
| Hover que mostra o que **muda** (o MAP do ataque seguinte)                                                 | Rogue Trader                     | §4.3                           |
| Indisponível fica **no lugar, esmaecido, com o motivo** no tooltip; só some o impossível                   | PF2e HUD, Rogue Trader           | `state` + `reason` na entrada  |
| Abas por intenção (Golpes, Magias, Ações, Itens…)                                                          | BG3 (patch 7), BG3 HUD           | §4.1                           |
| Magias por patamar com x/y de slots no cabeçalho, foco em pips, selo do patamar no atalho                  | módulos PF2e                     | aba Magias                     |
| Ações de perícia agrupadas por perícia, com MAP só nas de traço ataque; as que exigem treino somem sem ele | Token Action HUD, Argon (PF2e)   | aba Ações                      |
| Custo variável (Cura de 1, 2 ou 3 ações) como seletor no próprio botão                                     | BG3 (seletor de upcast)          | variantes da entrada           |
| Alternáveis (postura, escudo erguido) como chips com marca de ligado                                       | Token Action HUD, BG3 (Passivas) | `kind: "toggle"`               |
| Mira em dois passos (alcance, vermelho fora; confirmar), cancelada com Esc ou botão direito                | BG3, Argon, Rogue Trader         | modo mira (§4.3)               |
| Tooltip em dois níveis: curto no hover, completo por tecla                                                 | BG3 (Alt/T)                      | §4.3                           |
| Teclas 1–0 (e − =) nos slots                                                                               | BG3, Rogue Trader                | §4.3                           |
| Consumível com selo de quantidade; zero fica esmaecido                                                     | módulos PF2e, BG3 HUD            | aba Itens                      |
| NPC sem abrir a ficha; seleção múltipla mostra só o que é comum (testes)                                   | PF2e HUD, Token Action HUD       | §4.2                           |
| Reações em aba própria; depois, por reação: Perguntar / Automático / Desligado                             | BG3, módulos de reação           | F7                             |

Nenhum HUD de PF2e documentado resolve bem o custo variável (a Cura de 1 a 3 ações). É onde dá para fazer
melhor que o estado da arte.

### 2.2 O que evitar

- **A barra se encher sozinha** e mexer no que o jogador arrumou: BG3 e DOS2 são criticados por isso. No
  Fusion, os Favoritos recebem uma semente na primeira vez e depois só mudam pela mão do jogador. O que é novo
  vai para as abas.
- Esmaecer sem dizer por quê.
- Deixar o custo de ação fora do rótulo, crítica direta ao Demiplane Nexus.
- Várias barras e popups sem eixo de custo, como no WotR.
- Reação 100% automática (o BG3 gastou slot sem perguntar) ou prompt para tudo (o spam dos módulos de reação).
- HUD poluído por padrão, crítica ao PF2e HUD. A barra começa enxuta e pode ser recolhida.
- Encaixar PF2e no molde Ação/Bônus/Reação do 5e, como faz o Argon remapeado. PF2e é ◆ ◆◆ ◆◆◆ + ⟳ + ◇.
- Exigir a ficha aberta para agir, como no Roll20.

## 3. O que já existe

Levantado em 11/10/2026 lendo o código, não as specs. Legenda: ✅ funciona em produção, 🟡 existe mas é parcial
ou não tem chamador, ❌ não existe. Prefixos de caminho: `client/` = `packages/client/src/`, `server/` =
`packages/server/src/`, `shared/` = `packages/shared/src/`, `sat:` = repo `fusion-systems-2e` e `pf2e-sheet/` =
`sat:sheets/pf2e/src/lib/sheets/pf2e/`.

### 3.1 O que a barra pode chamar direto (a ficha já faz)

| Peça                       | Status | Onde                                                                                                                                                                                                              |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Golpe com MAP e alvo       | ✅     | `vm.strikeCard(id, mapIndex, getMyTargets())` (`pf2e-sheet/characterSheetVM.ts:3360`). O servidor decide o grau contra a CA do alvo lida no banco (`server/chat/chat-handler.ts:2110`).                           |
| MAP corrente               | ✅     | O servidor conta (`server/combat/map-counter.ts:278`) e publica `combat.attackCount` (`shared/combat/schemas.ts:157`). A ficha lê com `attacksThisTurn(actorId)` (`pf2e-sheet/strikeMapCount.svelte.ts:40`).      |
| Magia (slot, foco, truque) | ✅     | `vm.castSpell` (`characterSheetVM.ts:2608`), com gasto por `toggleSlotExpended`, `expendKnownSlot` ou `setFocusPoints`. O salvamento é graduado pelo servidor.                                                    |
| Impulso e Rajada           | ✅     | `buildImpulseCard`, `buildElementalBlastCard` (`pf2e-sheet/actionsVM.ts:894,1149`), `vm.blastCard`.                                                                                                               |
| Lista de ações relevante   | ✅     | `loadActionEntries` → `mergeActionRows` → `filterRelevantRows` → `sortActionRows` (`actionsVM.ts:1433,511,1356,1408`), 538 ações do `actions-core`.                                                               |
| Ações executáveis          | ✅     | Agarrar, Empurrar e Derrubar (CD do alvo lida no banco, limite de tamanho, MAP), Investigar, Rastrear, Tratar Ferimentos, Caçar Presa, Comandar, Apoio e Montar (`pf2e-sheet/actions/executableRows.ts:208-278`). |
| Alvo do usuário            | ✅     | O botão direito no token marca e desmarca, e Esc limpa (`client/lib/canvas/tokens/TokenInteractionManager.ts:555,798`). `getMyTargets()` é reativo (`client/lib/combat/combatStore.svelte.ts:118`).               |
| Encerrar turno             | ✅     | `combatActions.nextTurn` → `combat:nextTurn`. O dono do combatente ativo pode encerrar (`server/combat/combat-handlers.ts:1395`).                                                                                 |
| É o meu turno?             | ✅     | `activeCombatantIsOwnedBy` e `combatBadgeTone()==="amber"` (`client/lib/combat/combatBadge.svelte.ts:94,164`).                                                                                                    |
| Alternáveis da ficha       | ✅     | `flags.fusion.toggles.*` (Panache, Estratagema, alvo desprevenido, Finalizador), Atunamento Estelar, modo da arma combinada.                                                                                      |
| Usar consumível            | 🟡     | `item:consume` está pronto no servidor (OWNER, `expectedVersion`, baixa quantidade e usos, aplica efeito, rola cura e dano) e **não tem chamador no client**.                                                     |
| Abrir a ficha              | ✅     | `openActorSheet(actorId, actorDoc, opts)` (`client/lib/sheets/openActorSheet.ts:30`).                                                                                                                             |

### 3.2 O que falta para a barra existir

| Lacuna                             | Status | Detalhe                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ponto de extensão core ↔ sistema   | ❌     | O core só importa `registerPf2eSheets` e `skillNamePt` do satélite (`.dependency-cruiser.cjs:119-152`). Não existe "listar as ações do ator". O registry `action` da system-api só é usado em testes.                                                                                                |
| Lógica da ficha fora do componente | 🟡     | `actionsVM` e `executableRows` são puros. Já o `CharacterSheetVM` nasce dentro do componente (`CharacterSheet.svelte:191`), e a orquestração do "Usar" (`ActionsTab.svelte:271-395`), o `emitAbility` (`CharacterSheet.svelte:390`) e o `emitCast` (`SpellsTab.svelte:1026`) estão presos ao Svelte. |
| "Ator ativo" reativo               | ❌     | A seleção é um `Set` privado, não reativo, de seleção única e recriado a cada cena (`TokenInteractionManager.ts:164,916`). O client não tem `user.character`; "meu personagem" é inferido por posse (0..N atores).                                                                                   |
| Atalhos de teclado                 | ❌     | Não há registro central. Os dígitos 1–0 estão livres. O guard `isEditableTarget` (`token-interaction.ts:469`) não cobre botões, e Space e F9 não têm guard.                                                                                                                                          |
| Tooltip, popover, menu de contexto | ❌     | O core não tem componente genérico para isso. O botão direito no canvas é a mira.                                                                                                                                                                                                                    |
| Arrastar e soltar                  | ❌     | O framework da spec 11 (DEC-UIF-09) não existe; só há HTML5 nativo ad hoc.                                                                                                                                                                                                                           |
| Hotbar e macros (spec 14)          | 🟡     | `UserSchema.hotbar` e `MacroSchema` existem no servidor sem UI, sem rota e sem execução. 34 requisitos [MVP] da spec 14 têm zero citações.                                                                                                                                                           |
| Ações sem execução                 | ❌     | Desmoralizar, Fintar, Desarmar, Reposicionar, Escapar, Rememorar Conhecimento, Esconder, Erguer um Escudo, Passo/Deslocar e Recarregar.                                                                                                                                                              |
| Recurso de classe genérico         | ❌     | Só existe na spec 47 (`SpecialResource`).                                                                                                                                                                                                                                                            |
| **Rolagens da ficha de NPC**       | ❌     | **Quebradas**: `npcSheetVM.ts:514` emite `roll:check`, que não existe no protocolo, e o servidor descarta como "Malformed envelope" (`server/net/socket-manager.ts:1045`). É o mesmo defeito que o r9 corrigiu na ficha de personagem.                                                               |

### 3.3 Estado das frentes (11/10)

- **Bhrotto**: concluída (61/61). Foi ela que entregou mira, grau do golpe pelo servidor, MAP, condição pelo
  card, Comandar e Montar, com o miolo da G-F1 do Guerreiro.
- **Alquimista**: parada em 33/125 (ondas 1–5, já em `alfa/app` via #313). Entregou dano e cura, condição,
  expiração de efeito, ganchos de turno e `item:consume` no servidor.
- **Guerreiro e Animista**: não iniciadas. Os planos são de 16/09 e estão envelhecidos (656 commits atrás).

### 3.4 Onde ela cabe na tela

- A gaveta lateral é overlay de altura total **à direita**: 44 px de trilho + 300 px de painel, z90, aberta por
  padrão, com o estado privado em `Sidebar.svelte:35`. O cabeçalho ocupa o topo (48 px, z100). As janelas ficam em
  z ≥ 101 e o host delas em z200.
- O rodapé central está livre no código. A exceção é o aviso `ScenePrepareNotice`, no centro-inferior em z60,
  que só aparece quando o Mestre prepara uma cena. Na alfa não existem lista de jogadores, navegação de cenas,
  minimapa nem avatar no canto.
- Nas **specs**, o rodapé é disputado. A spec 11 (REQ-UIF-001/006) e a spec 14 põem a hotbar lá. A spec 28
  (REQ-HUB-007) põe a barra de comando do Hub, que só existe em código na `build/app`. A spec 35 põe o avatar no
  canto inferior direito.
- Não há modo tablet. O único breakpoint do shell é a gaveta abaixo de 900 px, que então cobre tudo. O tema é um
  só `client/styles/base.css` (`--fusion-*`, escuro), e os z-index são literais soltos.

## 4. Desenho proposto

O protótipo fiel (telas T1–T7) é a fonte visual. Esta seção é a fonte do comportamento. Os rótulos são os do
pack pt-BR, os mesmos da ficha: Investigar, Deslocar, Esgueirar, Rememorar Conhecimento, Arquitetar uma
Estratégia, Golpe Reativo, Erguer um Escudo, Comandar um Animal. A barra lê os dados de onde a ficha lê, então
não tem nomes próprios.

### 4.1 Anatomia

A barra fica centralizada **na área livre do canvas**, entre a borda esquerda e a gaveta, acima do canvas e
abaixo das janelas e da gaveta.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ (HJ) Huo Jinwu · Ladino 1 / Investigador 2     PV ▰▰▰▰▰▰▰▰ 33/33     Herói ●○○        │
│      Desprevenido · Alvo: Capitão Bandido      Seu turno · R2   Próximo ataque: MAP −5 │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ★ Favoritos │ Golpes │ Magias │ Ações │ Itens │ Reações │ Testes                    ▾ │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐ ┌──────────┐ │
│ │◆   ││◆   ││◆   ││◆◆  ││◆   ││◆   ││    ││    ││    ││    ││    ││    │ │ Encerrar │ │
│ │Golp││Fint││Esco││Arco││Estr││Proc││    ││    ││    ││    ││    ││    │ │  turno   │ │
│ │ +4 ││+10 ││+11 ││CD18││    ││ +8 ││    ││    ││    ││    ││    ││    │ └──────────┘ │
│ └1───┘└2───┘└3───┘└4───┘└5───┘└6───┘└7───┘└8───┘└9───┘└0───┘└−───┘└=───┘              │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Faixa de estado**:
  - retrato, nome, classes e PV (com temporário);
  - os recursos que importam no turno: foco, herói e os slots do patamar em foco;
  - condições ativas como chips **só com o nome**, e o efeito aparece ao clicar (padrão D-B23);
  - o alvo marcado, com o nome que o jogador já vê no token (a mesma redação), nunca o nome real de um NPC
    oculto ou desconhecido;
  - à direita, de quem é a vez e o MAP do próximo ataque.
- **Abas**: Favoritos é a linha principal, com 12 slots e teclas 1–0, − e =. As outras são:
  - **Golpes**;
  - **Magias**: por patamar, com x/y de slots no cabeçalho do grupo e foco em pips;
  - **Ações**: básicas, de perícia e de classe, filtradas por relevância como a aba Ações da ficha e agrupadas
    por perícia;
  - **Itens**: consumíveis com quantidade;
  - **Reações**;
  - **Testes**: Percepção, salvamentos, perícias e saberes.
- **Slot**:
  - mostra a **imagem escolhida pelo usuário** para aquela entrada (D-BA02) ou, sem ela, um ícone livre
    (nunca arte da Paizo). Por cima, custo no canto, tecla, selo de quantidade ou de patamar e o bônus ou CD
    final, legíveis sobre a imagem;
  - estados: disponível, esmaecido **com motivo** no tooltip, gasto até recarregar e alternável ligado.
- **Encerrar turno**: só aparece no seu turno, ou para o Mestre.
- **Recolher**: a barra vira só a faixa de estado. O estado fica salvo no dispositivo.

### 4.2 De quem é a barra

**Regra de posse (D-BA01, decidida pelo Alexandre em 11/10):** a barra só mostra ator de que o usuário é
**dono** (OWNER do ator efetivo do token). O Mestre vê a de qualquer ator. Hoje qualquer clique seleciona qualquer
token, inclusive o de um NPC. Por isso o jogador que seleciona o token de um NPC, ou de outro jogador, **não** vê
a barra dele: a barra continua no personagem do próprio jogador, e nenhum dado do ator selecionado chega ao
provedor. O teste de posse é o que o client já usa (`ownedActorIdsOf`, spec 41 REQ-TOK-032); nada de predicado
novo.

1. Se o usuário selecionou exatamente um token cujo ator é dele (ou se é o Mestre), a barra é desse ator.
2. Fora isso, se o usuário tem personagem, a barra é dele, mesmo sem token na cena e mesmo que ele tenha
   selecionado um token alheio. Com mais de um personagem, vale o último usado.
3. Mestre sem seleção: a barra fica oculta.
4. Seleção múltipla (só Mestre) mostra uma barra-resumo ("3 tokens") com testes em grupo: salvamentos,
   Percepção e iniciativa.
5. Com um companheiro, eidolon ou servo selecionado, a barra é a dele **se ele for do jogador** (a posse do
   companheiro já é forçada à do dono). A do dono mostra Comandar ou Agir Juntos, esmaecido com motivo quando
   já foi usado no turno (o `commandMark` já existe).

### 4.3 Interação

- **Clique** executa a variante padrão: golpe no MAP corrente, magia no patamar e custo padrão, ação com o teste
  certo. O resultado sai no card de chat que já existe, com ataque, dano e salvamentos aninhados.
- **Botão direito** abre o menu da entrada:
  - variantes: 1º, 2º ou 3º ataque, 1, 2 ou 3 ações, patamar de conjuração, elemento da Rajada;
  - Fixar ou Desafixar;
  - Ver detalhes;
  - Abrir na ficha.
- **Passar o mouse** mostra o tooltip curto: nome, custo, traços, bônus ou CD, alcance e uma linha de efeito. Num
  golpe, mostra também **o que muda**: "depois deste: MAP −10". Alt abre o painel completo, que é o mesmo da
  ficha.
- **Alvo**: a ação que precisa de alvo usa os alvos marcados com o botão direito no token (isso já existe). Sem
  alvo, entra em **modo mira**: cursor de mira, clique no token e Esc cancela. Ao passar o mouse num golpe ou
  magia com alcance, um anel de alcance aparece em volta do token (F8).
- **Arrastar**: de qualquer aba para Favoritos fixa; dentro de Favoritos reordena; para fora desafixa. O menu de
  contexto é a alternativa sem arrastar (REQ-A11-036).
- **Teclado**: 1–0, − e = executam os Favoritos, nunca com foco em campo de texto, botão ou diálogo. Esc cancela
  a mira ou o menu.
- **Toque** (F8): no modo tablet, alvos de 44 px, safe-area e hover permanente (spec 23).

## 5. Arquitetura

### 5.1 Casca no core, conteúdo no sistema

Mesmo padrão da ficha e do card de chat: `registerPf2eSheets` preenche o `sheetRegistry`, o
`chatCardExtensionRegistry` e o `skillNameRegistry`, e é chamado em `TableScreen.svelte:302`.

- O **core** (`packages/client`) é dono da **casca**: posição na tela, faixa de estado, abas, slots, tooltip,
  menu, teclado, favoritos e Encerrar turno. Ele não sabe o que é um golpe PF2e.
- O **satélite** (`sheets/pf2e`) registra um **provedor**. O provedor diz quais entradas o ator tem e como
  executar cada uma, chamando as **mesmas funções** que a ficha chama. Nenhuma regra é reescrita na barra.
- O **servidor** continua dono de rolagem, grau, MAP, consumo e permissão. A barra não ganha autoridade nova e
  não cria op de servidor na F1–F3.

```ts
// core: client/lib/actionbar/actionBarRegistry.ts (esboço; o contrato fecha na spec 53)
interface ActionBarProvider {
  /** Entradas do ator, puras: doc + derived + contexto de combate. Sem abrir a ficha. */
  entries(ctx: ActionBarContext): ActionBarEntry[];
  /** Faixa de estado: PV, foco, herói, slots, condições, recursos de classe. */
  status(ctx: ActionBarContext): ActionBarStatus;
  /** Executa emitindo as mesmas ops da ficha; o servidor valida tudo. */
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
  ): Promise<void>;
  /** Painel de detalhe do sistema (o mesmo da ficha), aberto pelo tooltip. */
  details?: Component<{ entry: ActionBarEntry }>;
}

interface ActionBarEntry {
  id: string; // estável no ator ("<kind>:<origem>"): é o que o favorito guarda
  kind: "strike" | "spell" | "action" | "item" | "reaction" | "toggle" | "check";
  tab: string; // aba onde aparece
  group?: string; // "2º patamar", "Atletismo"…
  label: string; // pt-BR
  icon?: string;
  cost?: ActionCost; // 1–3 ações, reação, livre ou variável: só exibido (D-15)
  traits?: string[];
  uses?: { value: number; max?: number }; // quantidade, slots, cargas
  state?: "ready" | "unavailable" | "spent-until-recharge" | "active";
  reason?: string; // por que está esmaecida
  variants?: ActionBarVariant[]; // MAP, nº de ações, patamar, elemento
  target?: "none" | "one" | "many";
  range?: { kind: "reach" | "range"; feet: number };
}
```

### 5.2 O que o satélite precisa extrair, sem mudar a ficha

A barra só pode chamar a lógica da ficha se ela existir fora do componente. Por isso a primeira tarefa de
conteúdo (BAR-F2-01) é uma **extração sem mudança de comportamento**: os testes da ficha e a catraca
`pathbuilder-parity` continuam verdes e nada muda na tela.

- O `CharacterSheetVM` passa a ser construível sem montar a ficha.
- A orquestração do "Usar", o `emitAbility` e o `emitCast` viram funções de `lib/`. A ficha e a barra chamam
  as mesmas funções.

De brinde, a ficha ganha um runner headless que hoje não existe e serve de base para teste.

### 5.3 Ator ativo

O core ganha um store reativo novo, alimentado pelo `TokenInteractionManager`. O manager passa a publicar a
seleção em vez de guardá-la num `Set` privado, e a seleção sobrevive à troca de cena. As regras de quem é a
barra estão na §4.2.

O **gate de posse** (D-BA01) mora nesse store, antes do provedor. O store só publica ator de que o usuário é dono,
ou qualquer ator para o Mestre. A seleção de um token alheio não muda o ator ativo do jogador. O provedor nunca é
chamado com ator alheio, e isso tem teste negativo.

### 5.4 Turno e custo de ação, dentro da D-15

A **D-15** foi decidida pelo Alexandre na frente do Alquimista. Ela tirou do escopo o contador de ações por
turno (pips, orçamento, bloqueio), porque ele precisa desfazer, desistir e planejar sem nada contar ou bloquear.
A barra respeita a D-15:

- mostra o **custo** de cada entrada, só como dado exibido, como a ALQ-F7-02 já previa;
- mostra o **MAP do próximo ataque**, que o servidor já conta. O golpe usa esse MAP como variante padrão, com
  "forçar MAP" no menu, igual à ficha;
- mostra **de quem é a vez** fora da gaveta, o que responde à Q-CBA-01 da spec 40, e oferece Encerrar turno;
- **não** tem pips de "ações restantes" e não bloqueia nada.

Se esse contador um dia voltar, o lugar dele é a spec 49 (REQ-ACO), já reservada.

### 5.5 Persistência

- **Favoritos no ator**, em `flags.fusion.actionBar` com schema Zod no shared. A escrita usa `expectedVersion`
  pelo `makeSendOpFn`. Assim o favorito segue o personagem em qualquer dispositivo e o Mestre o vê.
- Um favorito cuja entrada sumiu (item vendido, magia trocada) aparece esmaecido como "não está mais na ficha",
  com Desafixar. Isso responde à Q2 da spec 14.
- **Ícones customizados no ator** (D-BA02), em `flags.fusion.actionBar.icons`. É um mapa de id da entrada para o
  caminho de uma imagem do **acervo do mundo** (`/assets/…`). URL externa é recusada pelo schema: o `FilePicker`
  aceita URL, mas a imagem precisa obedecer à CSP e ao grant de leitura. O mapa tem teto de entradas. O campo
  entra em `server/assets/asset-fields.ts`, seguindo as regras do arquivo (um caminho por valor, casado inteiro),
  para que quem vê o ator receba o grant da imagem. Sem isso, a imagem não carrega para os outros.
- **Preferências do dispositivo** (recolhida, última aba) usam o padrão existente
  `fusion:actionBar:<worldId>:<userId>`.

### 5.6 E a hotbar da spec 14?

A spec 14 pede uma hotbar **por usuário** com 5 páginas de 10 slots de macro, e o servidor já tem
`UserSchema.hotbar` e `MacroSchema` sem uso. A barra de ações é a versão contextual disso: segue o
**personagem**, não o usuário. A proposta (DC-01) é que a spec 53 **substitua** a hotbar (REQ-MAC-012..018 e
REQ-UIF-006) e que a macro vire, no futuro, mais um `kind` de entrada fixável. Assim não convivem dois modelos de
barra.

## 6. Fases e tarefas

`Tam.` vai de P (≤ ½ dia de agente) a G (vários dias). A ficha completa de cada tarefa, com ondas e lotes por
script como nas outras frentes, sai no `tasks.md` (BAR-F0-03), depois das decisões.

### F0: Desenho e spec (docs)

| ID        | Repo | Entrega                                                                                                                                                                                                                                                   | Depende de | Tam. |
| --------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| BAR-F0-01 | core | Protótipo fiel `prototipo-barra-fiel.html` (T1–T7) revisado pelo Alexandre.                                                                                                                                                                               | —          | M    |
| BAR-F0-02 | core | **Spec 53 "Barra de Ações"** (`REQ-BAR-`, `DEC-BAR-`) e emendas nas specs 11 (REQ-UIF-001/006), 14 (REQ-MAC-012..018), 28 (REQ-HUB-007, convivência no rodapé), 40 (Q-CBA-01), 41 (DEC-TOK-19) e 23 (tablet). Inclui registro do prefixo e `spec:report`. | F0-01      | M    |
| BAR-F0-03 | core | `tasks.md` no formato das frentes (ondas e lotes por script), entrada em `_frentes/frentes.json` e skill `/barra-de-acoes`.                                                                                                                               | F0-02      | M    |

### F1: Fundação no core (sem conteúdo de sistema)

| ID        | Repo | Entrega                                                                                                                                                                                                                                                                                                                                | Depende de | Tam. |
| --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| BAR-F1-01 | core | Store reativo de **ator ativo**. A seleção é publicada pelo `TokenInteractionManager` e sobrevive à troca de cena. Implementa as regras da §4.2 (seleção múltipla fica para a F4) com o **gate de posse** (D-BA01): teste negativo em que o jogador seleciona um NPC e a barra segue no personagem dele, sem o provedor receber o NPC. | F0-02      | M    |
| BAR-F1-02 | core | `actionBarRegistry` e tipos (`ActionBarEntry`, `ActionBarStatus`…), com um provedor stub de teste. Fronteira (`dependency-cruiser`, `boundary-test`) verde.                                                                                                                                                                            | F0-02      | P    |
| BAR-F1-03 | core | Tooltip/popover e menu de contexto **genéricos** em `components/common/`, com clique fora, Esc, foco e aria. Ficam reutilizáveis pelo resto do app.                                                                                                                                                                                    | F0-02      | M    |
| BAR-F1-04 | core | Componente `ActionBar` com faixa de estado, abas, slots e recolher. Posição na área livre (o estado aberto da gaveta passa a ser exportado), convivência com o `ScenePrepareNotice` e lugar na escala de z.                                                                                                                            | F1-01..03  | G    |
| BAR-F1-05 | core | Registro mínimo de atalhos (spec 23 REQ-A11-020/023) com as teclas da barra e Esc. O guard cobre input, textarea, contenteditable, diálogo e botão focado.                                                                                                                                                                             | F1-04      | P    |

### F2: Conteúdo PF2e do personagem (primeira entrega jogável)

| ID        | Repo     | Entrega                                                                                                                                                                                                                                         | Depende de           | Tam. |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---- |
| BAR-F2-01 | satélite | **Extração sem mudança de comportamento**: `CharacterSheetVM` headless; `useExecutable`, `emitAbility` e `emitCast` em `lib/`; a ficha chama o extraído. Suíte da ficha e `pathbuilder-parity` verdes.                                          | —                    | G    |
| BAR-F2-02 | satélite | Provedor de **Golpes**: MAP corrente por `attacksThisTurn`, variantes, munição exibida, bombas.                                                                                                                                                 | F1-02, F2-01         | M    |
| BAR-F2-03 | satélite | Provedor de **Magias**: truques, patamares com slots, foco, preparada e espontânea, elevação que já existe.                                                                                                                                     | F1-02, F2-01         | M    |
| BAR-F2-04 | satélite | Provedor de **Ações**: lista relevante; "Usar" nas executáveis; as outras postam o card da ação. Inclui Impulsos e Rajada (custo variável) e os alternáveis de `flags.fusion.toggles`.                                                          | F1-02, F2-01         | M    |
| BAR-F2-05 | satélite | Provedor de **Testes**: Percepção, salvamentos, perícias e saberes.                                                                                                                                                                             | F1-02                | P    |
| BAR-F2-06 | satélite | **Faixa de estado**: PV, temporário, foco, herói, condições compactas, alvo e MAP do próximo ataque.                                                                                                                                            | F1-02                | P    |
| BAR-F2-07 | ambos    | Registro em `registerPf2eSheets`, tag do satélite e bump do pin. Roteiro `tutorial-e2e` com os 4 PJs de A Queda (jogador e Mestre, incluindo o jogador clicando num NPC sem ver a barra dele) e relatório protótipo × tela (PROCESSO-UI P1–P4). | F1-04..05, F2-02..06 | M    |

### F3: Favoritos e personalização

| ID        | Repo  | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Depende de | Tam. |
| --------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| BAR-F3-01 | ambos | Favoritos no ator: schema Zod em `flags.fusion.actionBar`, semente na primeira abertura (sem auto-add depois), fixar, desafixar e reordenar com `expectedVersion`; entrada órfã esmaecida.                                                                                                                                                                                                                                                                              | F2-07      | M    |
| BAR-F3-02 | core  | Menu de contexto completo e seletor de variantes no botão (MAP, custo variável, patamar, elemento).                                                                                                                                                                                                                                                                                                                                                                     | F2-07      | M    |
| BAR-F3-03 | core  | Arrastar e soltar dentro da barra (reordenar, fixar a partir das abas, arrastar para fora desafixa).                                                                                                                                                                                                                                                                                                                                                                    | F3-01      | M    |
| BAR-F3-04 | core  | Preferências do dispositivo (recolhida, última aba) no padrão `fusion:actionBar:<worldId>:<userId>`.                                                                                                                                                                                                                                                                                                                                                                    | F1-04      | P    |
| BAR-F3-05 | ambos | **Ícone customizado por entrada** (D-BA02). No menu, "Trocar ícone…" abre o `FilePicker` do core (o mesmo de cenas e retrato) e "Restaurar ícone padrão" volta ao genérico. Fica em `flags.fusion.actionBar.icons` (schema Zod com teto de entradas, só `/assets/…`, `expectedVersion`), com o campo registrado em `asset-fields.ts` e revisão adversarial do grant. Enviar arquivo segue a regra que já existe (REQ-AST-011, papel ≥ Confiável); o Mestre sempre pode. | F3-01      | M    |

### F4: Mestre e NPCs

| ID        | Repo     | Entrega                                                                                                                                                                                              | Depende de   | Tam. |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---- |
| BAR-F4-01 | satélite | **Conserta as rolagens da ficha de NPC**: troca `roll:check` pelo caminho de chat da ficha de personagem, com golpe com MAP, alvo e grau. É recorte da GUE-F1-06 e pode sair **já, avulso** (DC-10). | —            | M    |
| BAR-F4-02 | satélite | Provedor de **NPC**, só para o Mestre (D-BA01): golpes, ações, reações e magias inatas com CD, com CA e PV.                                                                                          | F2-07, F4-01 | M    |
| BAR-F4-03 | core     | Seleção múltipla do Mestre (hoje a seleção é única) e barra-resumo com testes em grupo (salvamentos, Percepção, iniciativa).                                                                         | F2-07        | M    |

### F5: Itens e consumíveis

| ID        | Repo  | Entrega                                                                                                                                                 | Depende de | Tam. |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| BAR-F5-01 | ambos | Liga o `item:consume`, que já existe no servidor, na aba Itens **e** no inventário da ficha: quantidade e usos, esmaecido no zero. Absorve a ALQ-F2-12. | F2-07      | M    |
| BAR-F5-02 | ambos | A bomba consome a unidade ao ser arremessada (absorve a ALQ-F2-14). A munição baixa no disparo.                                                         | F5-01      | M    |

### F6: Companheiros e vínculos

| ID        | Repo  | Entrega                                                                                                                                                                              | Depende de | Tam. |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---- |
| BAR-F6-01 | ambos | Barra do companheiro (urso e antílope do Bhrotto), do eidolon e do servo quando selecionados. Comandar e Agir Juntos ficam na barra do dono, esmaecidos com motivo quando já usados. | F4-02      | M    |

### F7: Ações e estados que faltam (motor; recortes de outras frentes)

| ID        | Repo     | Entrega                                                                                                                             | Depende de                     | Tam. |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---- |
| BAR-F7-01 | satélite | Desmoralizar, Fintar, Rememorar Conhecimento e Esconder executáveis: teste contra Vontade ou Percepção do alvo, **sem** contar MAP. | F2-04                          | M    |
| BAR-F7-02 | ambos    | Desarmar, Reposicionar e Escapar (traço ataque, contam MAP). Recorte da GUE-F5-03.                                                  | F2-04                          | M    |
| BAR-F7-03 | ambos    | Erguer um Escudo com estado (+CA até o próximo turno) e Bloqueio com Escudo. Recorte da GUE-F5-01/02.                               | F2-04                          | M    |
| BAR-F7-04 | ambos    | Posturas e Fúria como alternáveis com estado.                                                                                       | **ANI-F3-03** ou **GUE-F6-01** | G    |
| BAR-F7-05 | core     | Aba Reações com disponibilidade.                                                                                                    | **GUE-F4-01** (pool de reação) | P    |
| BAR-F7-06 | ambos    | Recursos de classe genéricos na faixa de estado.                                                                                    | **ALQ-F3-02/04**               | P    |

### F8: Alcance, tablet e acabamento

| ID        | Repo  | Entrega                                                                                                            | Depende de | Tam. |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------ | ---------- | ---- |
| BAR-F8-01 | core  | Anel de alcance ou aproximação no canvas ao passar o mouse (geometria de `shared/grid`), vermelho fora de alcance. | F2-07      | M    |
| BAR-F8-02 | core  | Modo mira quando falta alvo (a mira por botão direito já existe).                                                  | F2-07      | P    |
| BAR-F8-03 | core  | Tablet e toque (44 px, safe-area, hover permanente) e navegação completa por Tab (spec 23).                        | F3-03      | M    |
| BAR-F8-04 | ambos | SF2e: munição, cargas e Recarregar na barra (`consumeCharge` existe sem chamador).                                 | F5-02      | M    |

### Ordem de entrega

1. **Já, avulso**: BAR-F4-01, o fix das rolagens de NPC (se a DC-10 for aceita).
2. **Primeira entrega jogável**: F1 + F2. Cada jogador usa a barra do próprio PJ e o Mestre continua na ficha.
3. **Segunda**: F3 + F4. Entram Favoritos de verdade e a barra do Mestre para os NPCs.
4. **Terceira**: F5 + F6, com itens e companheiros.
5. **Depois**: F7, que anda junto com as frentes de motor, e F8.

A F1 e a F2-01 andam em paralelo, porque os arquivos são disjuntos: a F1 mexe no core e a F2-01 no satélite.

## 7. Dependências de outras frentes

| A barra precisa de                   | Situação           | Fonte                           | Como a barra trata       |
| ------------------------------------ | ------------------ | ------------------------------- | ------------------------ |
| Mira, grau do golpe, MAP             | ✅ entregue        | BHR-F3-01..05 (= GUE-F1-01..05) | usa                      |
| Dano, cura e condição pelo card      | ✅ entregue        | ALQ-F1-06..10, BHR-F6-02        | usa                      |
| Comandar, Montar, Caçar Presa        | ✅ entregue        | BHR-F3-06..08, F4-07, F5-02     | usa                      |
| Consumo de item                      | ✅ servidor, ❌ UI | ALQ-F2-11 (feito), ALQ-F2-12    | absorve a UI (BAR-F5-01) |
| Bomba consome a unidade              | ❌                 | ALQ-F2-14                       | absorve (BAR-F5-02)      |
| Golpe de NPC com MAP                 | ❌                 | GUE-F1-06                       | absorve (BAR-F4-01)      |
| Manobras restantes                   | 🟡 3 de 6          | GUE-F5-03                       | recorte (BAR-F7-02)      |
| Escudo erguido e Bloqueio com Escudo | ❌                 | GUE-F5-01/02                    | recorte (BAR-F7-03)      |
| Pool de reação                       | ❌                 | GUE-F4-01 (← ALQ-F7-05, F6-10)  | espera (BAR-F7-05)       |
| Posturas                             | ❌                 | ANI-F3-03, GUE-F6-01            | espera (BAR-F7-04)       |
| Recurso de classe genérico           | ❌                 | ALQ-F3-02/04 (spec 47)          | espera (BAR-F7-06)       |
| Slot de canto (estados temporizados) | ❌                 | ALQ-F6-10 (D-16)                | convive; não é a barra   |

"Absorve" segue o precedente do Bhrotto (D-B08): a peça entra neste plano com o contrato que o plano de origem
fixou, e a ficha de origem é marcada como absorvida. Antes de virar código, cada recorte confere o código
atual, porque os planos de 16/09 citam linhas que já mudaram.

## 8. Decisões

### 8.1 Já decididas

| ID     | Tema                 | Decidido                                                                                                                                                                                                                                                                                                      | Tarefas                         |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| D-BA01 | Barra de ator alheio | O jogador **nunca** vê a barra de um ator que não é dele. Selecionar o token de um NPC, ou de outro jogador, não muda a barra, que continua no personagem do jogador. Só o Mestre vê a barra de NPC (Alexandre, 11/10: "não será aceitável que um player veja a barra de ações de um NPC ao selecionar ele"). | BAR-F1-01, BAR-F2-06, BAR-F4-02 |
| D-BA02 | Ícone customizado    | Cada entrada da barra aceita uma **imagem customizada**, se o usuário quiser; sem imagem, vale o ícone genérico (Alexandre, 11/10: "quero que tenha como adicionar imagem customizada para cada ícone, se eu quiser").                                                                                        | BAR-F3-05                       |

### 8.2 A fechar

Cada linha traz a recomendação. Basta responder "como recomendado" e apontar as exceções. Elas viram `D-BA03…`
em `decisoes.md` e `DEC-BAR-…` na spec 53.

| ID    | Tema                     | Recomendação                                                                                                                                                                                                                            | Alternativa                                                                                         |
| ----- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| DC-01 | Hotbar da spec 14        | **A barra substitui a hotbar** (REQ-MAC-012..018, REQ-UIF-006): contextual por personagem; a macro vira um `kind` de entrada no futuro.                                                                                                 | Manter as duas (hotbar de macros por usuário + barra do ator).                                      |
| DC-02 | Onde mora o código       | **Casca no core, conteúdo pelo sistema** via registry, como a ficha e o card de chat.                                                                                                                                                   | Barra inteira no satélite (mais rápido, mas a casca fica presa ao PF2e).                            |
| DC-03 | Onde vivem os favoritos  | **No ator**: seguem o personagem em qualquer dispositivo, e o Mestre vê.                                                                                                                                                                | Por usuário: cada um arruma a sua, inclusive para o mesmo ator.                                     |
| DC-04 | Composição               | **Favoritos (12 slots com teclas) + abas por categoria.**                                                                                                                                                                               | Grade única com filtros (BG3) ou só slots manuais (WotR).                                           |
| DC-05 | Como os favoritos nascem | **Semente na primeira abertura** (golpes, magias e ações mais usadas); depois só o jogador mexe.                                                                                                                                        | Auto-adicionar tudo que for novo (o que BG3 e DOS2 erram).                                          |
| DC-06 | Rodapé                   | Na alfa, **a barra é dona do centro-inferior**. Se as linhas convergirem, a barra de comando do Hub (spec 28, só na `build/app`) vira um grupo compacto na ponta da barra, como os botões de menu do BG3 e do WotR.                     | Empilhar as duas barras.                                                                            |
| DC-07 | Mestre sem seleção       | **Barra oculta.**                                                                                                                                                                                                                       | Mostrar a barra do último NPC usado.                                                                |
| DC-08 | Ações sem motor ainda    | Desmoralizar, Fintar etc. **aparecem e postam o card da ação** (sem rolagem automática) até a F7.                                                                                                                                       | Ficar de fora até ter motor.                                                                        |
| DC-09 | Outras frentes           | **Absorver os recortes que a barra precisa** (consumo, golpe de NPC, manobras, escudo), como no Bhrotto; esperar só pool de reação, posturas e recurso de classe.                                                                       | Esperar cada frente entregar a sua parte.                                                           |
| DC-10 | Rolagens de NPC          | **Consertar já, avulso** (BAR-F4-01), antes da frente: a ficha de NPC não rola nada hoje.                                                                                                                                               | Esperar a F4.                                                                                       |
| DC-11 | Fila                     | **A barra entra antes** do resto do Alquimista, do Animista e do Guerreiro. F1–F4 não dependem deles e é o que mais muda a mesa agora.                                                                                                  | Depois das três frentes de classe.                                                                  |
| DC-12 | Nome no slot             | **Ícone (ou imagem) com o nome curto embaixo.** Sem a arte da Paizo, os ícones genéricos se repetem: na T6 o NPC tem duas espadas iguais lado a lado.                                                                                   | Só ícone e bônus, como no BG3 (o nome fica no tooltip).                                             |
| DC-13 | Quem troca o ícone       | **Quem já pode enviar arquivo** (REQ-AST-011: papel ≥ Confiável) troca nos atores dele, e o Mestre troca em qualquer um. O jogador comum vê "Trocar ícone…" esmaecido com o motivo e pede ao Mestre, ou o Mestre o promove a Confiável. | Qualquer dono troca, com envio limitado a imagens pequenas numa pasta própria (muda a REQ-AST-011). |

## 9. Riscos

| Risco                                                                                                                                                                                                | Efeito                                                                                      | Mitigação                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jogador vendo dados de NPC pela barra: hoje qualquer clique seleciona qualquer token.                                                                                                                | Vazam golpes, CA, PV e magias do NPC.                                                       | Gate de posse no store do ator ativo (D-BA01); o provedor nunca é chamado com ator alheio; o chip de alvo usa o nome redigido; há teste negativo e o caso entra no smoke como jogador (P4). |
| A extração da lógica da ficha (BAR-F2-01) quebra a ficha.                                                                                                                                            | Regressão na ficha em uso na mesa.                                                          | Tarefa isolada e sem mudança de comportamento, com suíte da ficha e `pathbuilder-parity` verdes **antes** de qualquer conteúdo da barra.                                                    |
| O rodapé é disputado com a barra de comando do Hub, que só existe na `build/app`.                                                                                                                    | Conflito se as linhas convergirem.                                                          | DC-06 e emenda na spec 28 desde já.                                                                                                                                                         |
| Gaveta de 344 px à direita, aberta por padrão, com janelas por cima.                                                                                                                                 | Barra espremida em tela estreita.                                                           | Posição relativa à área livre; abaixo de ~1000 px de área livre a barra recolhe; o estado da gaveta passa a ser exportado.                                                                  |
| Teclas 1–0 disparando com foco em campo de texto ou botão.                                                                                                                                           | Rolagem pública indesejada.                                                                 | Registro de atalhos com guard completo (input, textarea, contenteditable, diálogo, botão focado), com teste.                                                                                |
| **Anti-cheat herdado**: bônus e MAP vêm da fórmula do client; o `chat:send` genérico não confere se o `speakerActorId` é do usuário; slot e foco são gastos por `doc:update` sem validação de regra. | A barra facilita um caminho que já é frouxo.                                                | A barra não piora nada. O endurecimento fica numa frente própria (§10).                                                                                                                     |
| Os planos de 16/09 envelheceram.                                                                                                                                                                     | Recorte absorvido com evidência errada.                                                     | Cada recorte confere o código atual antes de virar código (lição do Guerreiro).                                                                                                             |
| A barra polui a mesa.                                                                                                                                                                                | Crítica comum aos HUDs de PF2e.                                                             | Começa enxuta, pode ser recolhida e fica oculta para o Mestre sem seleção.                                                                                                                  |
| Recalcular entradas a cada mudança.                                                                                                                                                                  | Engasgo com muitos NPCs.                                                                    | Memo por versão do doc do ator, só para o ator ativo.                                                                                                                                       |
| Ícone customizado como vetor de amplificação de grant: o jogador escreve milhares de caminhos no mapa de ícones do próprio ator.                                                                     | Uma requisição gera milhares de grants assinados, o caso que o `asset-fields.ts` documenta. | Schema com teto de entradas e um caminho por valor, casado inteiro; revisão adversarial na BAR-F3-05.                                                                                       |

## 10. Fora do escopo

| Item                                                                                   | Motivo                                                       | Onde retomar                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Contador de ações por turno (pips, orçamento, bloqueio)                                | D-15                                                         | spec 49 (REQ-ACO, reservada) |
| Token HUD (REQ-UIF-008a)                                                               | outro propósito (controles da peça); botão direito é a mira  | spec 11                      |
| Macros e QuickAction declarativas                                                      | a barra substitui a hotbar; a macro entra depois como `kind` | spec 14                      |
| Prévia de caminho com custo em ações                                                   | depende de régua com regra                                   | spec 41 / frente futura      |
| Chance de acerto na prévia                                                             | vaza a CA do alvo para o jogador                             | —                            |
| Sugestão de 3ª ação, presets, várias linhas configuráveis                              | luxo; avaliar depois do uso na mesa                          | depois da F8                 |
| Endurecimento anti-cheat (bônus no servidor, dono do speaker, conjuração autoritativa) | defeito anterior à barra, frente própria                     | frente de segurança          |
| Etmos                                                                                  | legado, vive na `build/app`                                  | —                            |

## 11. Próximos passos

1. O Alexandre responde as DCs (pode ser "como recomendado" com exceções) e revisa o protótipo, telas T1–T7.
2. As respostas viram `decisoes.md` (D-BA03…, junto com as D-BA01 e D-BA02 já decididas) e o protótipo é ajustado se alguma mudar o desenho.
3. Vêm a spec 53 com as emendas (BAR-F0-02) e o `tasks.md` no formato das frentes (BAR-F0-03), com a skill
   `/barra-de-acoes`.
4. Se a DC-10 for aceita, o fix das rolagens de NPC sai antes de tudo.
5. A execução segue por ondas, com a primeira entrega jogável em F1 + F2.

## 12. Fontes do benchmark

Comportamento público apenas. O `https://` foi omitido.

- **BG3**: bg3.wiki (Controls, Reactions tab, Resources, Class actions); eip.gg; progametalk.com (hotbar guide);
  notas dos patches 3 e 7; fóruns da Larian e discussões no Steam.
- **Pathfinder WotR**: pathfinderwrathoftherighteous.wiki.fextralife.com (Combat); wrath.owlcat.games/news/16;
  forum.quartertothree.com (Solasta × WotR × BG3).
- **DOS2**: divinityoriginalsin2.wiki.fextralife.com (Combat, Action Points); nota do patch 3.0.158.595.
- **Solasta**: solastacrownofthemagister.wiki.fextralife.com (Actions, Controls).
- **Rogue Trader**: roguetrader.owlcat.games/news (16, 27, 38).
- **Módulos (README e wiki)**: Token Action HUD Core e PF2e (Larkinabout), Argon e Argon-PF2e, BG3 Inspired HUD
  (core + PF2e), PF2e HUD e PF2e Toolbelt (reonZ), PF2e Reaction Checker, Crucible Reaction Prompts, PF2e Drag
  Ruler. Também as páginas foundryvtt.com/packages de Token Action HUD PF2e, Auto Action Tracker, Combater,
  Third Action Suggester, Action Keeper e Display Actions.
- **Opinião de usuários**: enworld.org, fórum do Roll20, forums.demiplane.com (custo de ação ausente,
  MAP do Flurry).
