# Fixer O4 — rodada 1 (2026-09-21)

Worktree `wt-c` (core branch `ficha3/o4`, satélite `external/fusion-systems-2e` branch
`ficha3/o4`). Todos os 4 achados confirmados (`revisao-adversarial.md` + `revisao-*.md`) foram
tratados: 3 consertados com TDD, 1 investigado a fundo e **provado que não reproduz** num build
fresco (registrado em vez de "consertado", conforme instrução da tarefa para achado errado).

## Tabela achado → commit → teste

| Achado | Severidade | Veredito | Commit(s) | Teste |
| --- | --- | --- | --- | --- |
| **C1** — slot `deity` sempre marcado `WrongClass` (Cleric/Champion) | bloqueante | CONFIRMADO, consertado | satélite `cff0dbd`; core `5d3b278f` (pin) | `planVM.test.ts` — 2 casos novos ("deity slot on Cleric/Champion has NO requirementIssue"); suíte completa 463→ok |
| **C2** — features de classe não embutidas no fluxo real (Champion sem Deific Weapon/Champion's Aura) | importante | **NÃO REPRODUZ** num build fresco (`pnpm build` antes) — timing + provável `dist` desatualizado na lane original, não defeito de código | nenhum (nada a consertar) | 2 roteiros Playwright ad-hoc fora do repo (`<scratch>/e2e-o4/roteiros/`), rodados contra `wt-c` pós-C1: `champion-deity.spec.ts` (fluxo completo, 1/1 verde) e `champion-timing.spec.ts` (isola timing: Deific Weapon + Champion's Aura aparecem no `world.db` em ~4.5s, sem nenhuma ação extra) |
| **C3** — Divine Font não filtrado/marcado contra o `font` da divindade | importante | CONFIRMADO, consertado | satélite `728dc78`; core `94c23e04` (pin) | `planVM.test.ts` — 5 casos novos (Asmodeus+Healing marcado, Asmodeus+Harmful ok, deidade com os dois fonts ok, sem deidade ok, deidade sem dado de font ok); `svelte-check` 0 erros (filtro do picker em `PlanColumn.svelte`) |
| **C4** — gate do Animist trocado sem registro + referência falsa a "buracos 5/6/8" | importante | CONFIRMADO, consertado (documentação + issues) | satélite `5c28dcb` (nota #18 do `animist.json`); core `5851e6aa` (tasks.md/execucao.md + pin) | `animist-rule-coverage.test.mjs` 2/2 verde (inalterado); `python3 -c "json.load(...)"` + `prettier --check` no JSON |

## Detalhe por achado

### C1 — `deity` sempre `WrongClass`

`CHOICE_SLOT_REQUIRED_CLASS` derivava a classe exigida do prefixo da categoria otherTags
(`"magus-hybrid-study"` → `"magus"`), mas a categoria de `deity` é a string bare `"deity"` (sem
prefixo) — a classe "derivada" nunca batia com um `classSlug` real, então um slot de divindade
PREENCHIDO no Cleric ou no Champion era **sempre** marcado `WrongClass`, mesmo já sido T4.1 quem
introduziu o eixo.

Conserto: `requiredClass` agora aceita `string | string[]`; `deity` declara explicitamente
`["cleric", "champion"]`. `CHOICE_SLOT_REQUIRED_CLASS` normaliza tudo para array;
`checkSlotRequirement` testa `includes()` em vez de igualdade.

TDD: reproduzido primeiro (WrongClass "Deity" em ambos), depois verde.

### C2 — investigado, não reproduz

A revisão adversarial suspeitava de divergência entre o teste committed
(`grantMaterializer-realPacks.test.ts`, que usa resolvers disk-backed) e o fluxo real de UI
(`materializeClassGrants` em `PlanColumn.svelte`, socket-backed). Reproduzi ao vivo com Playwright
contra um `pnpm build` fresco desta worktree (pós-C1):

- Fluxo completo (classe → escolher divindade): `Champion, Focus Spells, Deity (Champion), Deific
  Weapon, Champion's Aura, Devotion Spells, Shield Block×2, Iomedae` no `world.db` — os dois
  grants ESTÃO lá.
- Isolando timing (só aplicar a classe, nenhuma ação extra, leitura do `world.db` a cada 1s):
  t=1263ms (0 itens) → t=2334ms (2) → t=3420ms (3) → **t=4479ms (5, os dois grants presentes)**.
  `materializeClassGrants` é fire-and-forget (`void`) — o round-trip por socket até
  `class-features-core` leva ~4-5s reais, não é instantâneo, mas converge sozinho.

Corrigi `evidencia-viva.md` (também confirmei que o teste dela chamou de "ad-hoc descartado" um
teste que na verdade está commitado em `52fc0ab` e roda 11/11 verde) e retirei a pendência de
issue de código — não há defeito de código a corrigir. Nenhum commit de código; só o relatório de
evidência (scratchpad, não versionado) foi corrigido.

### C3 — Divine Font vs. divindade

`checkSlotRequirement` nunca cruzava o slot `divineFont` contra o item `deity` já embutido no
ator — um Clérigo de Asmodeus (`system.font: ["harm"]`) podia escolher "Healing Font" sem
nenhuma marca, embora RAW só tenha acesso ao font que a própria divindade concede.

Conserto (DEC-BC-05 — marca, nunca bloqueia):
- `planVM.ts`: `checkDivineFontDeityMatch` cruza `deity`×`divineFont` e marca
  `requirementIssue` quando divergem (reaproveita `translatePrerequisite`/`axisCoreName`
  já existentes). Só marca quando a divindade concede EXATAMENTE um font.
- `PlanColumn.svelte`: o picker do slot `divineFont` filtra a lista pelas mesmas regras,
  na divindade já escolhida.

### C4 — gate trocado sem registro + referência falsa

`execucao.md:119` define o gate Mecânico da Onda 4 como "Animist: 23/23 features de nv 1-3 com
`rules`" — literal. A T4.2 aceitou `rules` **OU** `ruleJustifications` (decisão correta —
fabricar `rules` sem fonte violaria a lição #48), mas nunca registrou a troca em lugar nenhum. A
nota #18 do `animist.json` também citava "buracos 5/6/8 do plano.md" para três lacunas — errado:
só repertório de conjuração (buraco 5) e pool de foco (buraco 8) têm buraco registrado; buraco 6
é "lista preparada do dia", sem relação com Lore skill. O grant dinâmico de Lore skill por
apparition não tinha buraco nem issue.

Conserto: nota #18 corrigida; nota de rodapé em `execucao.md` + coluna nota do T4.2 em
`tasks.md` registram a troca do critério; duas issues novas abertas.

## Verificação (gate completo, rodado no fim, não pulado)

- `pnpm build` — exit 0.
- `pnpm typecheck` — exit 0 (`svelte-check`: 0 erros, 24 warnings pré-existentes).
- `pnpm lint` — exit 0 (1 warning pré-existente, não relacionado).
- `pnpm lint:boundaries` — exit 0 (0 violações, 5031 módulos).
- `pnpm format:check` — exit 0.
- `pnpm spec:report` — exit 0, cobertura MVP 710 (piso 710, sem mudança).
- Testes afetados: `planVM.test.ts` (397/397), `ficha-nivel3-onda1.test.ts` (71/71),
  `grantMaterializer-realPacks.test.ts` (11/11), `planColumn-variant-rules.test.ts` (6/6),
  `animist-rule-coverage.test.mjs` (2/2) — todos verdes.
- `pregen-parity.test.ts`: 22 falhas, **idênticas em contagem e causa ao baseline da Onda 0**
  (`ficha3-reports/o0/baseline.md` linha 22 — `CLASSES_WITHOUT_PREGEN` sem Necromancer/Runesmith
  + divergências de `attacks.other`/HP em Alchemist/Gunslinger/Commander, nada relacionado a esta
  rodada). Não é regressão; confirmado por comparação com o baseline, não apenas suposição.
- Suíte completa **não** rodada aqui (roda no gate/CI do fecho, por instrução da tarefa).

## Commits (core e satélite intercalados, um par por achado tocado)

Satélite (`xansde/fusion-systems-2e`, branch `ficha3/o4`, todos pushados):
1. `cff0dbd` — fix(sheets-pf2e): deity slot compartilhado Cleric/Champion (C1)
2. `728dc78` — fix(sheets-pf2e): Fonte Divina respeita o font da divindade (C3)
3. `5c28dcb` — docs(curation): corrige referência falsa a buracos 5/6/8 (C4)

Core (`xansde/fusion`, branch `ficha3/o4`, todos pushados):
1. `5d3b278f` — chore: pina satélite pós C1
2. `94c23e04` — chore: pina satélite pós C3
3. `5851e6aa` — docs: registra troca do critério do gate + pina satélite pós C4

Nenhum PR aberto (fica para o fechamento da onda, por instrução da tarefa). Merge continua ato
humano.

## Pendências para issue (novas nesta rodada)

1. `xansde/fusion-systems-2e#114` — "Animist: grant dinâmico de Lore skill por apparition sem
   motor (sem rule kind suportado)". Aberta, corpo completo com contexto/escopo.
2. `xansde/fusion-systems-2e#115` — "Animist: repertório de apparition com 16 magias faltando em
   spells-core (todas as 13/14 apparitions ficam incompletas)". Aberta, corpo completo com a
   lista das 16 magias.

Ambas já linkadas em `tasks.md` (T4.2) e na nota #18 corrigida de `animist.json`.

## O que NÃO foi tocado

- `tools/importer-pf2e/` na raiz do core (resíduo, fora de escopo — só dado, código real vive no
  satélite).
- Árvore principal `C:/Users/xansd/pessoal/fusion` — nunca tocada; toda reprodução Playwright do
  C2 rodou contra a worktree `wt-c` usando o playwright instalado da skill `tutorial-e2e` via
  `FUSION_E2E_REPO_ROOT`, com config/roteiros próprios em `<scratch>/e2e-o4/` (nunca escritos no
  repo compartilhado).
- Servidor de teste manual usado na primeira tentativa do C2 (porta 33044, `world teste_o4`,
  data-dir `<scratch>/data-o4`): processo morto e `data-dir` apagado antes de prosseguir para o
  método passwordless da skill `tutorial-e2e` — a senha de GM efêmera gerada nunca foi persistida
  em lugar nenhum (mundo descartado no mesmo turno).
