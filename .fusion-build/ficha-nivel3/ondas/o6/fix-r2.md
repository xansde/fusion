# O6 — Fixer, rodada 2

Worktree: `wt-o0` (core branch `ficha3/o6`; satélite `external/fusion-systems-2e` branch `ficha3/o6`).
Alvo: os 2 achados confirmados da revisão adversarial r1 (`revisao-adversarial-r1.md`).

## Tabela achado → commit → teste

| id | severidade | commit | teste (vermelho→verde) |
|---|---|---|---|
| C4 | importante | satélite `3939aa1` fix(system-pf2e) | `systems/pf2e/src/__tests__/build-validation.test.ts` — "rejects a skill-category feat embedded straight into an ancestryFeat slot, with NO matching choice at all (C4 bypass)" + core `10ebb270` test(server) — "DENIES the embedded doc:create itself of a skill-category feat filed into the ancestryFeat slot, with NO choice sent at all" (integração, porta real `handleEmbeddedCreate`) |
| N1 | importante | satélite `3939aa1` fix(system-pf2e) | `build-validation.test.ts` — "rejects a level-20 class feat filed into a level-1 classFeat slot" / "rejects a level-4 feat filed into a level-2 classFeat slot" + core `10ebb270` — "DENIES the embedded doc:create of a level-4 class feat filed into a level-2 classFeat slot" (integração) |

Pin do core atualizado no mesmo commit `10ebb270` (`external/fusion-systems-2e` → `3939aa1`).

## C4 — conserto

`checkChoices` (build-validation.ts) só resolvia o item embutido via `findItemByBuildSlot`
quando já existia uma `system.build.choices` entry casando o mesmo slot — mas o `chooseFeat`
real (`planVM.ts`) manda o `doc:create` do item **antes** do `doc:update` das choices, e um
payload forjado a mão pode nunca mandar a segunda op. Um item com slot ilegal e zero choice
passava (`ok:true`) sem qualquer checagem.

Conserto: nova função `checkItemSlots` que itera **todo item embutido** com
`flags.fusion.build.slot`, infere o tipo do slot pelo prefixo `<type>-<level>` (a mesma
convenção que `resolveSlot`/`pushFeatSlotWithGrant` usam no client) e valida
`FEAT_SLOT_MISMATCH` a partir do item — independente de existir choice casando. `checkChoices`
manteve só `DUPLICATE_SLOT` (não depende de item nenhum). `handleEmbeddedCreate`
(`doc-handlers.ts`) já chamava `rejectIllegalCharacterBuild` no ato do embed (fixado no r1) —
não precisou mudar; o item embutido em si agora é o gatilho certo.

Reproduzido e fechado em dois níveis:
- unitário (`validateCharacterBuild` isolado, `build-validation.test.ts`);
- integração, na porta real (`player-character-create.test.ts`, `doc:create` embutido via
  socket contra o servidor de verdade).

## N1 — conserto

O r1 (C2) removeu por inteiro a checagem "nível do talento excede nível do personagem" para
não quebrar a descida de nível — mas foi longe demais: nenhum limite de nível restou, e um
talento de nível 20 em `classFeat-1` era aceito.

Conserto: `checkItemSlots` reintroduz um invariante mais estreito —
`FEAT_LEVEL_EXCEEDS_SLOT_LEVEL`: o nível mínimo do talento (`system.level`) não pode exceder o
**nível do slot** em que foi arquivado (`flags.fusion.build.level`, com fallback pro nível
parseado do próprio id do slot). Isso é fixo no momento da escolha e nunca muda com
subida/descida — diferente do check removido pelo C2, que comparava contra o nível ATUAL do
personagem. Teste dedicado prova que não reabre o C2: um talento de nível 2 num slot
`classFeat-2` continua legal mesmo depois do personagem descer para nível 1.

## Achado novo durante a reprodução (registrado, não corrigido — fora de escopo desta rodada)

Ao montar o repro de integração do C4, descobri que a checagem inteira (`validateCharacterBuild`)
é no-op para um personagem sem `system.build` (modo manual r9, comportamento já documentado no
docstring do módulo desde antes deste fixer). O personagem auto-criado pelo REQ-USR-025 nasce
sem `system.build` — então, teoricamente, um jogador poderia embutir um item com slot ilegal
ANTES de qualquer escolha de ancestralidade/antecedente (que são o que primeiro escreve em
`system.build.abilities`), e nada validaria. Na prática, o client real sempre inicializa
`system.build` no primeiro passo do builder guiado (ancestralidade), bem antes do primeiro
talento — então a janela real de exposição é pequena, mas existe. Corrigido nos meus testes
adicionando um passo de inicialização antes do repro (mesma ordem do jogo real); NÃO alterei o
comportamento do módulo (fora do escopo dos achados C4/N1 desta rodada, e mudar a semântica do
"modo manual r9" é decisão de produto, não bugfix).

### Pendência para issue

Repo: `xansde/fusion-systems-2e`.
Título: `build-validation: personagem sem system.build (modo r9) fica isento de checagem de slot/nível de item`
Corpo:
```
validateCharacterBuild (systems/pf2e/src/build-validation.ts) é um no-op completo — incluindo
a checagem de slot/nível de item (checkItemSlots, O6 fixer r2) — para qualquer Actor character
cujo system.build seja null/ausente ("modo manual r9"). O personagem auto-criado pelo
REQ-USR-025 nasce exatamente nesse estado.

Na prática o client real inicializa system.build no primeiro passo do builder guiado
(chooseAncestryBoosts/chooseBackgroundBoosts, planVM.ts), bem antes de qualquer embed de
talento — então a janela de exposição real é pequena. Mas nada no servidor impede um
doc:create embutido de Item com flags.fusion.build.slot ilegal enquanto system.build ainda
não existe: o item embutido fica sem qualquer validação de slot/nível até (e a menos que)
system.build seja inicializado depois.

Decisão pendente: (a) manter como está (r9 = "fora do builder guiado, GM decide", coerente
com o resto do módulo) e documentar explicitamente essa janela; ou (b) fazer checkItemSlots
rodar mesmo sem system.build, já que o slot é uma convenção do item, não do build ledger.
Achado durante o fixer r2 da O6 (ficha-nivel3), não corrigido — fora do escopo dos achados
C4/N1 que motivaram a rodada.
```

## Verificação rodada

- `external/fusion-systems-2e`: `npx vitest run systems/pf2e/src/__tests__` → 23 arquivos,
  698 testes verdes (inclui os 28 de `build-validation.test.ts`, 5 novos).
- core: `npx vitest run packages/server/src/__tests__/player-character-create.test.ts
  packages/server/src/__tests__/embedded-item-actor.test.ts
  packages/server/src/__tests__/documents.test.ts` → 94 testes verdes (14 + 10 + 70).
- `pnpm build` (root, topológico) → verde, sem erro (só os warnings pré-existentes do
  bundler do client, chunk grande e dynamic-import misto).
- `pnpm --filter @fusion/system-pf2e typecheck` e `pnpm --filter @fusion/server typecheck` →
  verdes.
- `npx eslint` nos 2 arquivos do core tocados (`doc-handlers.ts` não mudou de fato — só recebeu
  e perdeu debug temporário — e `player-character-create.test.ts`) → sem warning/erro. Satélite
  não tem script de lint próprio (não é gate desta rodada).
- `pnpm lint:boundaries` (root) → verde, sem violação (5032 módulos cruzados).
- `npx prettier --check` (via `format:check` do root, mesmos arquivos) → verde.
- `pnpm spec:report` (root) → `cobertura [MVP] com teste: 710 (piso 710)`, sem regressão.

## Não fiz

- Não toquei em `doc-handlers.ts` — a chamada de `rejectIllegalCharacterBuild` dentro de
  `handleEmbeddedCreate` já existia (obra do r1) e já era o ponto certo; só precisava que
  `validateCharacterBuild` enxergasse o item sem depender da choice.
- Não rodei a suíte completa do core (fora do escopo desta rodada — gate da onda/CI faz isso).

## Commits

Satélite (`external/fusion-systems-2e`, branch `ficha3/o6`, push feito):
- `3939aa1` — `fix(system-pf2e): valida slot/nivel do talento pelo item embutido, nao pela choice (C4, N1)`

Core (branch `ficha3/o6`, push feito):
- `10ebb270` — `test(server): embed real denega item com slot/nivel ilegal sem choice (C4, N1) + pin do submodule`
