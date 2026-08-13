# Validar — wi-mapa-alvo-01

**Item:** Marcar e desmarcar alvo por clique direito no token do mapa
**Branch:** `feat/wi-mapa-alvo-01` (base: `feat/wi-mapa-grid-01`, do M1)
**Commit examinado:** `720a78f` — 8 arquivos, +739/−7
**Risco classificado:** **sensível**
**Data:** 2026-08-07

> Nota de rastreio: a fase Implementar declarou o commit `4b90946`; o commit que
> está na ponta da branch é `720a78f`, com a mesma mensagem e o mesmo conteúdo
> (reescrito, provavelmente por amend). Não há divergência de conteúdo, só de hash.

---

## 1. O que foi rodado (e o que deu)

| Verificação | Comando | Resultado |
|---|---|---|
| Suíte completa | `pnpm test` | 4058 passaram, **1 falhou** (não relacionada — ver §2), 1 pulada, 182 arquivos, 308 s |
| Teste que falhou, isolado | `npx vitest run --root packages/server src/update/__tests__/boot-nonblocking.test.ts` | **2 passaram** em 2,1 s |
| Tipos | `pnpm typecheck` | **0 erros** (1444 arquivos, 50 warnings de a11y/`state_referenced_locally`, todos pré-existentes e fora do diff) |
| Lint | `pnpm lint` | **1 erro** em `planVM.ts:2779` — **pré-existente**, ver §2 |
| Testes do gesto | `token-target-gesture.test.ts` | 10 passaram |
| Mutação A — remover o handler `rightdown` | manual | **6 de 10 vermelhos** — confere com o declarado pela fase Implementar |
| Mutação B — trocar o toggle por `targeted = true` (o defeito original) | manual | **1 vermelho** — o defeito que o item existe para corrigir É pego |
| Mutação C — remover a porta `targeting` do `TableScreen` | manual | **321 testes de canvas verdes** — ver §3, achado |

## 2. As duas falhas que NÃO são deste item

**`boot-nonblocking.test.ts` — `expected 5249 to be less than 2000`.** É
literalmente a lição já registrada em `docs/lessons.md` ("Teste com teto de tempo
absoluto mede a máquina, não o código"), escrita na fase Validar do M1 no dia
anterior. Rodado isolado, passa em 2,1 s. Reincidência da flakiness, não
regressão — e o item não toca em `packages/server`.

**`planVM.ts:2779` — `@typescript-eslint/no-unnecessary-condition`.** Confirmado
pré-existente: dei checkout em `724192f` (a ponta da base, antes do commit deste
item) e o mesmo erro aparece. O diff do item não toca `planVM.ts`. Origem:
`dcb02b3` (*fix(builder): pool de foco do Bard e do Champion*). **`pnpm lint`
está vermelho na branch**, e isso vai barrar CI se houver — mas o dono do
conserto é outro item, não este.

## 3. Achado do review — a porta opcional escapa do guarda mecânico

**Severidade:** médio. Não é bug hoje; é o defeito que este item existe para
corrigir, reintroduzido como armadilha para depois.

`TargetingPort` foi declarada **opcional** em `TokenInteractionOptions`
(`targeting?: TargetingPort`), com a justificativa — boa — de manter o manager
construtível sem ela. A consequência é que a fiação em `TableScreen.svelte` pode
sumir sem nada ficar vermelho:

- o tipo continua válido (o campo é opcional, `tsc` fica verde);
- `canvasWiring.test.ts` — o guarda mecânico que o repo criou **exatamente**
  contra "peça implementada ≠ peça alcançável" — assere 5 coisas do fonte do
  `TableScreen` e **nenhuma delas é a porta de targeting**;
- verificado por mutação: removi o bloco `targeting: { … }` do `TableScreen` e
  rodei `src/lib/canvas` → **18 arquivos, 321 testes, todos verdes**. Com o gesto
  do botão direito virado um no-op silencioso.

É o mesmo formato do defeito original do M1 (`TokenInteractionManager` com suíte
verde e nunca construído), um nível acima: agora a peça é construída, mas o
argumento que a torna alcançável é dispensável.

**Conserto sugerido (item novo, não emenda desta fase):** uma asserção em
`canvasWiring.test.ts` no formato das outras 5 — "alimenta o token interaction com
a porta de targeting, senão o botão direito não marca nada". Uma linha, mesmo
padrão feio-de-propósito do arquivo.

## 4. O que o review NÃO achou de errado

Confirmei, lendo o código e não só o diff:

- **`rightdown` é evento próprio do PIXI** — o handler de `pointerdown` mantém
  seu `if (e.button !== 0) return` intocado; a máquina de estados de arrasto
  nunca é entrada pelo gesto novo. O caminho do botão esquerdo é literalmente o
  mesmo de antes.
- **Cleanup**: `destroy()` chama `tokenContainer.removeAllListeners()` (linha 344),
  então o listener novo é removido junto com os outros. Sem vazamento.
- **Reatividade do painel**: `void targetingStore.version` dentro de `isTargeted()`
  é o padrão já usado no repo (o reducer muta o `Map` in place e incrementa o
  contador `$state` na linha 150 de `combatStore.svelte.ts`, sob `if (changed)`).
  Chamado de dentro de um `{@const}` no `{#each}`, a dependência é estabelecida.
- **Ausência de checagem de permissão no cliente é correta**: conferi
  `target-handler.ts` — o servidor não exige papel nem posse para mirar, e
  resolve o `userId` pelo socket. Um gate no cliente inventaria uma regra que o
  servidor não tem.
- **Sem estado otimista** é coerente: a retícula só aparece com o broadcast, e
  `combatActions.target` já documenta essa escolha. Diferente de arrasto, nada
  precisa seguir o ponteiro.
- **Fronteiras respeitadas**: zero alteração em servidor, protocolo e
  `TargetingMarkerLayer`, como o desenho prometia.

## 5. Lacuna de cobertura declarada (e confirmada)

O toggle do **`CombatPanel`** — que é metade do escopo do item, e o defeito
nomeado pelo Plano (`targeted=true` fixo na linha 446) — **não tem teste
automatizado próprio**. A fase Implementar declarou isso e a razão confere: o
repo não tem infra de teste de componente Svelte (`vitest` roda em ambiente
`node`, sem `@testing-library/svelte`). O predicado `isTargetedByUser` está
coberto por `targeting.test.ts` e a mesma regra está coberta no caminho do mapa,
mas o **botão** só é provado pela prova jogada.

## 6. Roteiro da prova jogada — PENDENTE de veredito do dono

O repo não tem infra de e2e automatizado (sem Playwright, sem
`.claude/skills/tutorial-e2e/`). A convenção estabelecida no M1 é a **sessão de
prova jogada com o mundo aberto**, registrada em `docs/lessons.md`. Não rodei
esta prova: ela exige duas telas e um segundo humano.

Roteiro mínimo, na ordem do DoD do Plano:

1. **Pré-requisito de build**: `pnpm build` do client **e reiniciar o servidor**
   (lição já registrada: o servidor lê o `index.html` no boot).
2. **Tela do GM** — botão direito no token A → retícula aparece (cor de alvo
   próprio).
3. **Tela do GM** — botão direito no token B → **dois** alvos marcados, o
   primeiro **não** some.
4. **Tela do GM** — botão direito de novo no token A → só a retícula de A some.
   *(Este é o passo que não existia: era aqui que "marcar errado" não tinha desfazer.)*
5. **Tela do jogador** — o token B aparece com a cor de "alvo de outro"
   (REQ-CBT-054), distinta da de alvo próprio.
6. **Painel de combate** — com combate ativo, clicar o botão ◎ de uma linha
   marca (vira ◉, `aria-pressed=true`); clicar de novo desmarca. Cobre a §5.
7. **Não-regressão do botão esquerdo** — arrastar um token continua funcionando
   e o botão direito nunca inicia arrasto; nenhum menu de contexto do navegador
   aparece sobre o mapa.

**Bloqueio de sequenciamento (já registrado pelo Design e pela Implementação):**
esta branch parte de `feat/wi-mapa-grid-01`, não de `origin/build/app`. Em
`build/app` o `TokenInteractionManager` nem é construído e o `TokenSprite` não
tem `hitArea` — a prova só roda com o M1 junto. **O PR do M2 tem que vir depois
do PR do M1, ou empilhado nele.**

## 7. Veredito

O código está correto, as fronteiras foram respeitadas, o defeito que o item
nomeia é pego por teste verificado por mutação, e tipos estão limpos. O que
sobra para o humano: o veredito da prova jogada (§6), o achado do guarda de
fiação (§3, item novo) e o lint pré-existente da branch (§2, item novo).
