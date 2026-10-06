# Fixer da Onda 7 — Rodada 1

Worktree: `.../scratchpad/wt-c` (core `ficha3/o7`, satélite `external/fusion-systems-2e` `ficha3/o7`).

## Resultado por achado

| id | severidade | status | commit | teste (TDD) |
|---|---|---|---|---|
| C8 | importante | **consertado** | satélite `c67730c` | `characterSheetVM.test.ts` (2 casos novos: saves + perceção) + `derivations.test.ts` (1 caso novo, pipeline real). Vermelho confirmado revertendo `character.ts` isoladamente antes do fix. |
| C2 | importante | **consertado** | satélite `9cd34b4` | `character-comparator.test.ts` — 3 casos novos (`chassisIsLocked`/`resolveChassis`/`walkMolde` nunca constrói contra chassi "proposta"). Vermelho confirmado revertendo `moldeComparator.ts`+`classBuildHarness.ts`. |
| C3 | importante | **consertado** | satélite `9cd34b4` (mesmo commit de C2, mesma reescrita do comparador) | `character-comparator.test.ts` — 5 casos novos (campo preenchido conta como comparado mesmo com hp/ac/saves nulos; divergência de verdade em talento/perícia). |
| C4 | importante | **consertado** | core `0b188f7b` | Mesmo `character-comparator.test.ts` (o teste "molde real pós C4 está travado" cai direto na estrutura fixada) + validação manual de JSON (`node -e JSON.parse`) + `pnpm format:check`. |
| C1 | **bloqueante** | **NÃO consertado nesta rodada** | — | — |
| C5 | importante | **NÃO consertado nesta rodada** | — | — |
| C6 | importante | **NÃO consertado nesta rodada** (decisão explícita, ver abaixo) | — | — |
| C7 | importante | **NÃO consertado nesta rodada** | — | — |

`tocou_fluxo_criacao = true`: C2/C3 mudam `buildCharacterToLevel`/`moldeComparator` (ferramenta de teste, não código de produção) — mas C8 muda `stepCharSaves`/`stepCharPerception`/`characterSheetVM.ts`, que SÃO o código de produção que a ficha executa e exibe (derivação + VM da sheet). Por isso `true`.

## C8 — detalhe

`system.saves.*.rank` / `system.perception.rank` persistidos nunca são escritos pelo builder (só o `stepCharApplyClass`, fase "base", os corrige — mas num clone que o servidor nunca grava de volta). `total` já lia o rank corrigido; o badge de proficiência lia o rank persistido (stale, preso em 0/"U"). Mesmo padrão do `stepCharSkills` (`CONTRACT C1`, já corrigido antes): o rank agora acompanha o `DerivedStatistic` de saves/percepção (`{...stat, rank}`), e `characterSheetVM.ts` prefere esse rank derivado. `DerivedStatistic` (systems/pf2e/src/derivations/types.ts) ganhou `rank?` opcional — o comentário antigo dizia que saves/percepção nunca precisariam disso; estava errado (é exatamente esse o achado).

AC tem o mesmo bug latente (`stepCharAc` também descarta o rank que usa) mas **não é acionável**: a sheet não expõe badge de rank de CA (`get ac(): number`, sem rank). Fora do escopo de C8 — registrado como pendência de baixa prioridade abaixo, não como achado novo.

## C2/C3 — detalhe

`buildCharacterToLevel` (classBuildHarness.ts) ganhou um 3º parâmetro opcional `ChassisOverride { ancestry?, background? }` — todo consumidor existente (varredura-classes, pregen-parity, o próprio teste de Fighter/Ratfolk do comparador) continua construindo Ratfolk/Aeronaut sem mudança nenhuma. `moldeComparator.ts` ganhou `chassisIsLocked`/`resolveChassis`: enquanto `metadata.chassis_common` estiver "proposta", `walkMolde` força pendência em toda célula (nunca constrói contra um chassi que ainda pode mudar); uma vez travado (agora, pós-C4), resolve Human/Scholar de verdade nos packs e constrói com eles.

`compareHpAcSaves` passou a comparar `focus_pool`, `trained_skills`, `granted_feats` e `languages` — cada um conta como "comparado" independente dos outros campos da mesma célula ainda estarem nulos. **Fora do escopo**: `proficiencies.attacks`/`proficiencies.defense` e `spells` — o formato desses campos no molde é ambíguo/heterogêneo por classe (ver `spells` no README: preparado × espontâneo × foco têm chaves totalmente diferentes) e não há nenhum valor preenchido ainda para fixar um contrato contra — registrado como pendência abaixo em vez de arriscar uma extração errada sem como testar.

## C4 — detalhe

Chassi comum estava ilegal (INT 13 / CAR 11 são inatingíveis a partir de 10 pela regra de boosts do Player Core Remaster: +2 por boost, só vira +1 acima de 18) e deixava herança/perícias/talento de ancestralidade/idioma em aberto. Alexandre indisponível — decidido pela regra do livro e registrado no próprio arquivo (`chassis_common.status: "fixado — ..."`), não reaberto:

- Ancestralidade: **Human**, herança **Skilled Human** (perícia à escolha treinada + talento de perícia geral), talento de ancestralidade nível 1 **Cooperative Nature** (não altera nenhum campo numérico já derivado, ao contrário de Natural Ambition).
- Antecedente: **Scholar** (Sociedade + Erudição Acadêmica).
- Idiomas: Comum + Élfico (1 extra por INT +1).
- Atributos nível 1 (antes do boost de habilidade-chave da classe, que varia e fica para T7.4): FOR 14 / DES 12 / CON 14 / INT 12 / SAB 14 / CAR 10 — todos pares e alcançáveis, com o trilho de boosts (ancestralidade FOR/CON, antecedente INT obrigatório + SAB livre, 4 boosts livres FOR/DES/CON/SAB) documentado no próprio JSON.

## C1, C5, C6, C7 — por que não foram consertados nesta rodada

Os quatro formam uma única operação indivisível: refazer o roteiro `tutorial-e2e` de ponta a ponta (servidor isolado + browser real), agora aplicando o chassi INTEIRO que C4 fixou — o que exige ensinar ao roteiro fluxos de UI que ele hoje não tem (escolher talento de ancestralidade, treinar a perícia da Herança Habilidosa, escolher o idioma bônus), rodar como Mestre E como o jogador dono (C7), guardar o data-dir e extrair `system` do ator para confrontar com os prints (C1), e só então redesenhar as legendas/relatório (C5). Nenhum desses 4 passos é testável isoladamente por unidade — o "teste" É o roteiro e2e inteiro, e um roteiro reescrito às pressas sem verificar cada seletor de UI novo (talento de ancestralidade, diálogo de treino de perícia, escolha de idioma — nenhum documentado em nenhum outro roteiro existente para copiar) tem risco real de produzir prints tão errados quanto os que a revisão já reprovou, o que seria pior que não mexer.

Decisão: registrar como pendência para uma rodada dedicada (idealmente via skill `tutorial-e2e` numa sessão própria, com servidor+browser), em vez de arriscar um resultado que pareça consertado sem estar verificado — na linha do que a própria revisão adversarial da Onda 7 cobra (nada de "parece que passou" sem prova).

**C6 especificamente**: o `ficha-nivel3.spec.ts` está excluído do git por `.git/info/exclude` (linha `.claude/skills/tutorial-e2e/`) — não é ignorado por acidente, é proposital (ferramenta de sessão local, confirmado em `ficha3-reports/o7/gate.md`). O conserto sugerido ("copiar para o repo principal antes de remover a wt-c") exigiria escrever na árvore compartilhada `C:\Users\xansd\pessoal\fusion`, que a regra desta rodada proíbe sem exceção ("NUNCA faça checkout/edição na árvore principal... compartilhada"). Não fiz essa cópia. Ação recomendada para quem fechar a onda (fora desta worktree):
```
cp "<wt-c>/.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts" \
   "C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts"
```

## Pendências para issue

1. **repo `xansde/fusion`** — título: `ficha-nivel3 Onda 7: refazer o roteiro e2e com o chassi fixado (C1/C5/C7)`
   corpo: "A revisão adversarial da Onda 7 (revisao-adversarial.md) reprovou o aceite porque a ficha do e2e não seguia o chassi (Human/Skilled Human/Cooperative Nature/Scholar, ver C4, já fixado) e porque o smoke só rodou como Mestre (PROCESSO-UI P4 exige também como player). Refazer `roteiros/ficha-nivel3.spec.ts` aplicando o talento de ancestralidade, o treino de perícia da herança e a escolha de idioma explicitamente (hoje nenhum dos três é selecionado no roteiro), acrescentar uma seção em que o jogador dono cria a própria ficha nível 1→3, rodar com data-dir preservado e extrair `system` do ator (ranks, build.choices, hp) para confrontar com os prints antes de reescrever as legendas do HTML."

2. **repo `xansde/fusion`** — título: `ficha-nivel3 Onda 7: copiar roteiro ficha-nivel3.spec.ts pro repo principal (C6)`
   corpo: "`.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts` só existe na worktree `wt-c` (branch `ficha3/o7`) — é sessão-local (`.git/info/exclude`), então some quando a worktree for removida. Copiar o arquivo (comando no fix-r1.md da Onda 7) pro `.claude/` do repo principal antes de descartar a worktree."

3. **repo `xansde/fusion-systems-2e`** — título: `moldeComparator: proficiencies.attacks/defense e spells ficam fora da comparação (C3, escopo restante)`
   corpo: "O fix de C3 (PR/commit 9cd34b4) cobre hp/ac/saves/focus_pool/trained_skills/granted_feats/languages. `proficiencies.attacks`/`proficiencies.defense` e `spells` ficaram de fora porque o molde ainda não tem nenhum valor preenchido para fixar um contrato de formato (preparado × espontâneo × foco têm chaves diferentes) — quando T7.4 preencher a primeira classe, decidir o formato e estender `compareHpAcSaves`."

4. **repo `xansde/fusion-systems-2e`** — título: `stepCharAc também descarta o rank que usa (mesmo padrão de C8, mas não visível na UI)`
   corpo: "`stepCharAc` (systems/pf2e/src/derivations/character.ts) computa `rank` localmente para a proficiência de armadura e não o anexa ao `DerivedStatistic` retornado — mesmo bug que C8 corrigiu em saves/percepção. Não é acionável hoje porque a sheet não renderiza badge de rank de CA (`characterSheetVM.ts get ac(): number`), mas se um dia a UI ganhar esse badge, vai repetir o mesmo defeito. Baixa prioridade — registrar para quando/se a UI expuser rank de CA."

## Comandos rodados (verificação)

- `pnpm build` — verde (todos os pacotes, incluindo client).
- `pnpm typecheck` — `COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS` (idêntico ao baseline do gate da Onda 7).
- `pnpm lint` — 1 warning pré-existente (`pregen-parity.test.ts`, mesmo do baseline).
- `pnpm lint:boundaries` — `no dependency violations found` (5049 módulos).
- `pnpm format:check` — só os 2 arquivos locais não-rastreados de sempre (`.claude/skills/tutorial-e2e/roteiros/*.spec.ts`); `character-templates.json` reformatado com `prettier --write` antes de commitar.
- `pnpm spec:report` — `719/719`, sem diff.
- Testes afetados: `characterSheetVM.test.ts`, `derivations.test.ts` (systems/pf2e), `character-comparator.test.ts` — todos verdes. Suíte completa de `sheets/pf2e` + `systems/pf2e` rodada como sanity extra: **23 falhas pré-existentes idênticas ao baseline** (`pregen-parity.test.ts` skillIncreaseCeiling/HP/chassis + `actionCategories.test.ts`), zero novas.

## Nota sobre bisecção

O commit `c67730c` (C8, satélite) sozinho não passa em `tsc` isolado — o campo `rank?` em `DerivedStatistic` (systems/pf2e/src/derivations/types.ts) só foi adicionado no commit seguinte (`9cd34b4`, C2/C3), quando o erro apareceu rodando o typecheck completo pela primeira vez. A ponta da branch (`9cd34b4`) typecheca limpo; não fiz `amend` para não reescrever histórico sem pedido explícito — registrando aqui para quem for revisar commit a commit.
