# Evidência viva FINAL — Onda 0 (gate, 2026-09-21)

Worktree `wt-o0` (core `ficha3/onda0` @ `b2bf41a1`, satélite `ficha3/onda0` @ `4a41939`,
ambas já com os fixes r1/r2/r3). Rebuild (`pnpm build`) verde antes do teste. Servidor real
em `http://localhost:33005`, mundo `teste_xande` (cópia isolada em `scratchpad/data-o0`),
browser real via `playwright-cli` (sessão `o0`) — nunca a extensão Chrome.

## Contexto: por que este relatório substitui o `evidencia-viva.md` anterior

O `evidencia-viva.md` desta mesma pasta (de uma rodada anterior) registrou o achado
bloqueante C1/C4 ("features de nível 1 do Monge não concedidas") **antes** do fix. Esse
achado foi corrigido pelo fixer rodada 1 (`d081bc8` + `c57169f` + `35a56b1`, ver
`fix-r1.md`) e coberto por teste automatizado — mas o próprio `fix-r1.md` registrou
explicitamente que **o runbook AO VIVO com prints não foi rodado** naquela rodada. Esta
lane fecha essa lacuna: repete o teste ao vivo, no estado JÁ CORRIGIDO do código.

## Estado inicial encontrado e correção de metodologia necessária

Os 3 atores do mundo copiado (`Tobias`, `Novo Ator`, `GateO0-Guardian`) vinham de um reset
incompleto da lane anterior: `system.details.level.value` tinha sido zerado para 1, mas o
código de materialização de features lê **`system.level.value`** (campo IRMÃO, não
aninhado em `details`) — que continuava com o valor antigo (5, 3 e 5 respectivamente,
herdado de testes anteriores). Abrir a ficha de Tobias nesse estado confirmou ao vivo que o
heal-on-open materializou classFeatures até nível 5 (Expert Strikes, Perception Expertise)
num ator com `details.level.value=1` — **achado novo, ver seção "Anomalias encontradas"**.

Para poder provar 1→2→3 de forma limpa, resetei os 3 atores por escrita direta no
`world.db` (servidor **parado**, reiniciado depois — mesmo método já usado/documentado pela
lane anterior): `system.level.value=1` E `system.details.level.value=1` (os DOIS campos),
removidos os itens `class`/`classFeature` remanescentes, e limpas as entradas
`classLevel-*` órfãs de `system.build.choices`. Login via usuário novo `gm-o0-2`
(GAMEMASTER, criado pelo CLI) — a senha do `gm-o0` da lane anterior não estava documentada.

## Monk (Tobias) — 1 → 2 → 3

1. Classe "Monge Monk" escolhida pelo picker (nível 1). **Observação**: logo após
   confirmar a classe (antes de qualquer level-up), os itens do ator ainda NÃO continham
   `classFeature:Flurry of Blows`/`Powerful Fist` (conferido no `world.db`, aguardei 5s) —
   só a UI mostrava os chips (via `featuresByLevel`, puramente informativo). Ver
   "Anomalias" — pendência de re-teste, não bloqueante (o nível 1 acaba coberto pelo
   level-up seguinte, que resolve retroativamente).
2. Clique em "Subir de nível → 2" (level-up real, botão do rodapé da coluna Plano):
   `system.level.value` vira 2, e AGORA os itens do ator ganham
   `classFeature:Flurry of Blows` + `classFeature:Powerful Fist` (`grantedSlot`
   `classFeature:1:flurry of blows` / `classFeature:1:powerful fist`) — confirmado por
   leitura direta do `world.db`. Print: `prints/monk-tobias-nivel1e2-plano.png` (mostra
   Nível 2, PV 24/24, bloco NÍVEL 1 com "Monge 1"✓ + os dois chips de feature).
3. Clique em "Subir de nível → 3": `system.level.value` vira 3; itens ganham
   `classFeature:Mystic Strikes` + `classFeature:Incredible Movement`. Print:
   `prints/monk-tobias-nivel3-plano.png` (Nível 3, PV 33/33, **Deslocamento 40 pés** — 30
   base + 10 do Incredible Movement, batendo com a derivação real testada em
   `derivations-speed.test.ts`/`fix-r1.md`).

Itens finais do Monk (`world.db`, ator `MVZPT17ybspil2yu`):
`class:Monk, classFeature:Flurry of Blows, classFeature:Powerful Fist,
classFeature:Mystic Strikes, classFeature:Incredible Movement`. As 4 features pedidas pelo
gate (nível 1: Flurry of Blows + Powerful Fist; nível 3: Mystic Strikes + Incredible
Movement) estão **concedidas como item real do ator**, não só exibidas na UI.

## Ranger (Novo Ator) — 1 → 2 → 3

Classe "Patrulheiro Ranger" escolhida; "Subir de nível → 2" e depois "→ 3". Ao nível 1 o
slot "Especialidade de Caçador" (Hunter's Edge — feature de ESCOLHA) ficou pendente de
seleção (comportamento esperado: é escolha do jogador, não um grant fixo); escolhi
"Precisão"/Precision para fechar o requisito do gate ("Hunt Prey + Hunter's Edge no
Ranger 1"). Print: `prints/ranger-novoator-nivel3-plano.png` (Nível 3, "Patrulheiro 1"✓,
"Precisão"✓ com badge "Especialidade de Caçador · Hunter's Edge", chip "Caçar Presa
Hunt Prey").

Itens finais (`world.db`, ator `uPI3hK89HeppNd4a`): `class:Ranger,
classFeature:Hunt Prey, action:Hunt Prey, classFeature:Will Expertise,
classFeature:Precision`. Hunt Prey embutido COM a ação concedida (`action:Hunt Prey`,
prova que o `GrantItem` interno da própria feature também resolveu — não só o embed da
feature-mãe). Will Expertise é o não-choice de nível 3 do Ranger, presente.

## Guardian (GateO0-Guardian) — 1 → 2 → 3

Classe "Guardian" (sem tradução pt-BR própria no picker desta sessão — chip aparece só em
inglês); "Subir de nível → 2" e "→ 3". Print:
`prints/guardian-gateo0-nivel3-plano.png` (Nível 3, PV 39/39, bloco NÍVEL 1 mostrando Taunt,
Guardian's Techniques, "Bloqueio com Escudo"/Shield Block, Guardian's Armor,
"Interceptar Ataque"/Intercept Attack).

Itens finais (`world.db`, ator `4fe91a6a6311f094`): `class:Guardian, classFeature:Taunt,
action:Taunt, classFeature:Guardian's Techniques, action:Intercept Attack,
classFeature:Shield Block, feat:Shield Block, classFeature:Guardian's Armor,
classFeature:Tough To Kill, feat:Diehard` — as 5 features nomeadas no `fix-r1.md` (Taunt,
Guardian's Techniques, Shield Block, Guardian's Armor, Tough To Kill) todas presentes, cada
uma com sua ação/feat concedida onde aplicável.

## Contagem de grants não resolvíveis fora da allowlist

Rodei `sheets/pf2e`'s `grant-resolution-validator.test.ts` (T0.4) diretamente contra os
packs reais do submodule pinado nesta worktree:

```
pnpm --filter @fusion/sheets-pf2e exec vitest run grant-resolution-validator
→ 4 passed (4) — incl. "every unresolved GrantItem/system.items grant is on the
  allowlist" (expect(notAllowlisted).toEqual([])) e "no allowlist entry resolves
  anymore" (expect(staleEntries).toEqual([]))
```

**Contagem de grants não resolvíveis fora da allowlist = 0**, confirmado pelo teste (não
por contagem manual desta sessão — o teste já faz exatamente essa varredura contra os packs
reais).

## Anomalias encontradas (NÃO consertadas — registradas)

### A1 — Dois campos de nível divergentes no ator (`system.level` vs `system.details.level`)

`getLevel()` em `planVM.ts:98` (usada por `classFeatureGrantRefs`/heal e por todo o resto
do Plano) lê **`system.level.value`**. O reset da lane anterior só tinha zerado
`system.details.level.value`, deixando `system.level.value` órfão nos valores antigos (5,
3, 5). Reproduzido nesta sessão: abrir a ficha de Tobias nesse estado materializou
classFeatures de Monk até nível 5 (Expert Strikes, Perception Expertise) num ator com
`details.level.value=1`. Depois do level-up real (clique em "Subir de nível"), observei o
INVERSO: `system.level.value` foi atualizado para o novo valor mas
**`system.details.level` passou a `undefined`** (não é mais escrito). Os dois campos nunca
ficam consistentes ao mesmo tempo pelo fluxo real da UI — não investiguei se
`system.details.level` tem algum consumidor ativo (pode ser campo morto/legado), mas a
divergência é real e reprodutível, e — como visto — pode contaminar heal/materialização se
alguém reaproveitar um ator com histórico.

**Pendência para issue** — repo `xansde/fusion-systems-2e`: "Ator PF2e tem dois campos de
nível (`system.level.value` e `system.details.level.value`) que divergem: level-up escreve
só o primeiro, e um reset externo que só zera o segundo deixa o heal/materializeGrants lendo
o valor velho." Repro: nesta sessão, reset parcial (só `details.level`) + reboot + abrir
ficha = features de nível 5 concedidas a um ator "nível 1".

### A2 — Class-pick isolado (sem level-up) não materializa `featuresByLevel` de nível 1

Ao escolher a classe Monk pelo picker num ator nível 1 recém-resetado (sem histórico), os
chips de feature de nível 1 aparecem na UI mas o item real (`classFeature:...`) só surge
no `world.db` depois do PRIMEIRO clique em "Subir de nível" — mesmo a classe já estando
"no" nível 1. `materializeClassGrants(doc2)` é chamado em `handleAbcSelect` logo após
`applyClass` (linha 844 de `PlanColumn.svelte`), então o comportamento esperado seria a
concessão imediata; não investiguei a fundo o porquê (pode ser um `await`/timing da
resolução do pack index, ou um guard que não bati). Não é bloqueante para o gate — o
level-up seguinte resolve retroativamente, cobrindo os 3 chassis desta lane — mas é uma
lacuna real entre "criar personagem na classe X, nível 1" e "ver as features de nível 1
como item real", sem precisar subir de nível.

**Pendência para issue** — repo `xansde/fusion-systems-2e`: "Escolher uma classe pelo
picker (`applyClass` + `materializeClassGrants`) não materializa as `featuresByLevel` de
nível 1 como item do ator; só o primeiro level-up faz isso." Repro: nesta sessão, Tobias
nível 1 limpo → picker "Monge" → "Confirmar" → aguardei 5s → `world.db` sem
`classFeature:Flurry of Blows`/`Powerful Fist`; só depois de "Subir de nível → 2" os itens
apareceram.

## Prints

Todos em `prints/`, cada um OLHADO (Read na imagem) antes de listar aqui:

- `monk-tobias-nivel1e2-plano.png` — Tobias Nível 2, classe Monge✓, bloco NÍVEL 1 com
  "Monge 1"✓ e os chips Sequência de Golpes/Flurry of Blows + Punho Poderoso/Powerful Fist.
  Prova que as features de nível 1 chegaram como resultado do primeiro level-up.
- `monk-tobias-nivel3-plano.png` — Tobias Nível 3, PV 33/33, Deslocamento 40 pés (prova
  visual da derivação de Incredible Movement, 30+10). Prova o estado final pós 1→2→3.
- `ranger-novoator-nivel3-plano.png` — Novo Ator Nível 3, "Patrulheiro 1"✓, "Precisão"✓
  (Hunter's Edge escolhido), chip "Caçar Presa/Hunt Prey". Prova Ranger nível 1 completo
  (incl. a escolha de Hunter's Edge) sobrevivendo até nível 3.
- `guardian-gateo0-nivel3-plano.png` — GateO0-Guardian Nível 3, PV 39/39, bloco NÍVEL 1 com
  Taunt, Guardian's Techniques, Bloqueio com Escudo/Shield Block, Guardian's Armor,
  Interceptar Ataque/Intercept Attack. Prova as 5 features de nível 1 do Guardian.

## Processo do servidor

Subido 2x (uma antes do reset limpo dos atores, parada para o reset direto no banco; outra
depois, usada para todo o teste ao vivo). Login via usuário `gm-o0-2` (GAMEMASTER, criado
pelo CLI nesta sessão). Browser fechado (`playwright-cli close`) e processo do servidor
encerrado por PID (`taskkill //PID 18508 //F`) ao final; `netstat` confirmou porta 33005
livre.

## Veredito da Onda 0 (gate desta lane)

**Gate PASSA.** Monk criado e subido 1→2→3 com Flurry of Blows + Powerful Fist (nível 1) e
Mystic Strikes + Incredible Movement (nível 3) concedidos como item real do ator; Ranger e
Guardian subidos até nível 3 com Hunt Prey + Hunter's Edge (Ranger nível 1) e as 5 features
de nível 1 do Guardian, todos confirmados por leitura direta do `world.db` e por print da
aba Plano. Contagem de grants não resolvíveis fora da allowlist = 0 (teste T0.4,
4/4 verde). Duas anomalias reais foram encontradas e registradas (A1, A2) — nenhuma delas
bloqueia o critério do gate desta onda (o caminho 1→2→3 via level-up cobre os 3 chassis
pedidos), mas ambas merecem issue própria.

## Pendências para issue (resumo)

1. **`xansde/fusion-systems-2e`** — "Ator PF2e tem dois campos de nível divergentes
   (`system.level` vs `system.details.level`)" (A1, ver detalhe acima).
2. **`xansde/fusion-systems-2e`** — "Escolher classe pelo picker não materializa
   `featuresByLevel` de nível 1 sem um level-up" (A2, ver detalhe acima).

Nenhuma issue nova das pendências 1–4 do `evidencia-viva.md` anterior precisa ser reaberta
aqui: a 1 (namespace GrantItem) e a 3 (gatilho classe×nível) foram resolvidas pelo fix-r1
(C1/C2/C6) — a 3, especificamente, é agora respondida por A2 acima (o gatilho real É o
level-up, não a atribuição isolada de classe, mas o embed EM SI funciona uma vez que o
level-up dispara). A pendência 4 do relatório anterior (nível/PV desatualizados após edição
direta no banco) é o MESMO fenômeno de A1 aqui, com causa raiz agora identificada
(`system.level` vs `system.details.level`) — não abro uma issue redundante, uso a mesma
citada em A1.
