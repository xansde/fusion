# Fixer da o1 — rodada 1 (relatório)

Worktree: `scratchpad/wt-o0`. Core `ficha3/o1` @ `a71e2a83` (push ok). Satélite
`external/fusion-systems-2e` `ficha3/o1` @ `4b2301c` (push ok).

Fonte dos achados: `scratchpad/ficha3-reports/o1/revisao-adversarial.md` (C1 bloqueante;
C2/C3/C4 importantes). Metodologia: TDD por achado — teste vermelho pelo motivo certo
(reproduz o defeito real, não um proxy) antes do conserto, depois verde.

## Tabela achado → commit → teste

| Achado | Severidade | Status | Commit(s) | Teste que prova |
|---|---|---|---|---|
| C1 — wrappers de eixo (Eidolon, Divine Spark and Ikons) perderam os grants fixos | bloqueante | **CONSERTADO** | satélite `21c564a` | `grantMaterializer-realPacks.test.ts`: "Summoner level 1: Manifest Eidolon, Act Together and Share Senses materialize…" e "Exemplar level 1: Shift Immanence materializes…" (vermelho→verde); guarda de não-regressão "Champion level 1: Cause stays UNMATERIALIZED…" (issue #22, já verde antes e depois) |
| C2 — fólio do Commander aceitava táticas de tier superior (37 em vez de 14) no nível 1 | importante | **CONSERTADO** | satélite `cb34809` | `ficha-nivel3-onda1.test.ts`: "Commander's tacticKnown pool is EXACTLY the 14 level-1 mobility/offensive tactics…" (vermelho 37→verde 14), com asserção derivada do próprio pack (não da primeira opção) |
| C3 — pin do submodule (`ad991ba`) só existe na branch de feature do satélite | importante | **PENDÊNCIA REGISTRADA (bloqueado por regra de merge)** | satélite `4b2301c` (re-pinado dentro da mesma branch de feature, não resolve a causa) | não aplicável — é um achado de processo git, não de código; ver seção "Pendências" |
| C4 — T1.8 entregue parcial sem decisão (idiomas bônus) | importante | **CONSERTADO** (decisão aceita explicitamente, corte agora visível) | satélite `4b2301c`; core `a71e2a83` (chave i18n) | `derivations.test.ts`: 3 casos novos de `languagesPendingCount` (mod 0/+3/negativo clampado); `characterSheetVM.test.ts`: 2 casos novos do getter `languagesPendingCount` |

## Detalhe por achado

### C1 [bloqueante] — CONSERTADO
- Causa: `classGrantRefsFromClassDoc` (`planVM.ts`) pula TODO nome em `CLASS_CHOICE_SLOTS`
  incondicionalmente. Eidolon e "Divine Spark and Ikons" viraram slots de escolha na Onda 1, mas
  seus próprios docs em `class-features-core` carregam GrantItem FIXOS (não-placeholder) ao lado
  do placeholder da opção escolhida — medido diretamente no pack: Eidolon tem Manifest Eidolon
  (incondicional) + Act Together/Share Senses (predicado `class:summoner`); Divine Spark and Ikons
  tem Shift Immanence (incondicional).
- Conserto: conjunto curado `CHOICE_WRAPPERS_WITH_FIXED_GRANTS = {"Eidolon", "Divine Spark and
  Ikons"}` — `classGrantRefsFromClassDoc` só pula um eixo se ele NÃO estiver nesse conjunto.
  Medido contra TODO outro nome de `CLASS_CHOICE_SLOTS`: nenhum outro wrapper tem GrantItem
  não-placeholder, então o conjunto é exaustivo nesta rodada.
- Não-regressão: o teste da issue #22 (Champion's "Cause" NÃO deve ser re-scaneado — seu grant é
  só placeholder, aplicado via a opção escolhida) segue verde, e ganhou um teste espelho dedicado
  no `grantMaterializer-realPacks.test.ts`.
- 380 testes de `planVM.test.ts` + 9 de `grantMaterializer-realPacks.test.ts` verdes.

### C2 [importante] — CONSERTADO
- Causa dupla: (a) `isClassChoiceOption` filtrava `tacticKnown` só pelo trait ordinário "tactic"
  (37 candidatos, todo tier); (b) mesmo se o filtro certo existisse, `actions-core`'s `index.json`
  não indexava `system.traits.otherTags`, então o picker do client (que lê do índice, não do doc
  completo) não teria como aplicar um filtro por otherTags de qualquer forma.
- Conserto: `CLASS_CHOICE_SLOT_OPTIONS.tacticKnown` ganha `categories: ["commander-mobility-tactic",
  "commander-offensive-tactic"]` (14 táticas — 7+7, medido no pack); `isClassChoiceOption` ganha
  suporte a OR de múltiplas categorias; `build-mvp-subset.mjs` passa a indexar
  `system.traits.otherTags` em `actions-core`; `systems/pf2e/packs/actions-core/index.json`
  regenerado a partir do `documents.json` já publicado (que já tinha os dados corretos) — só esse
  UM pack, sem rodar o pipeline completo (o `out/` do extract/normalize/transform não existe nesta
  worktree e não era necessário: os dados de origem já estavam certos).
- Teste novo afirma o conjunto de 14 a partir do próprio pack e exclui nominalmente uma tática de
  tier (o typo do vendor "vcommander-master-tactic" em "Ready, Aim, Fire!") e duas AP sem tag.
- Comentário falso em `planVM.ts` ("all level 1, no expert…") corrigido.
- `pregen-parity.test.ts` segue com as mesmas 22 falhas pré-existentes (ver seção "Falhas
  pré-existentes confirmadas") — confirmado com `git stash` que o conserto de C2 não muda esse
  conjunto.

### C3 [importante] — PENDÊNCIA (não é um conserto de código)
- O achado é de PROCESSO: o core está pinado em `ad991ba` (satélite), que só existe na branch
  `ficha3/o1` do satélite — inalcançável a partir de `main` até um merge.
- **Por que não mergeei**: mergear PR para `main`/`master`/produção de QUALQUER repo (core ou
  satélite) exige instrução LITERAL do Alexandre (regra global, `squad-szi-baseline.md`), que esta
  sessão não tem — o Alexandre está indisponível para este fixer. Abrir PR *contra* `main` também
  não é "PR livre" (a liberação de PR vale só para a branch de integração — `staging/dev`; o
  satélite não tem uma, `main` É seu trunk). Fazer isso mesmo assim seria contornar o gate, não
  cumpri-lo.
- O que fiz: re-pinei o core em `4b2301c` (o commit mais recente da MESMA branch `ficha3/o1` do
  satélite, depois de C1/C2/C4) — mantém as duas branches de feature consistentes entre si dentro
  desta rodada, mas **não resolve C3**: `4b2301c` também só existe em `ficha3/o1`, não em `main`.
- **Pendência para issue** (xansde/fusion-systems-2e): título "Merge de `ficha3/o1` para `main` —
  desbloqueia o pin do core" — corpo: "`ficha3/o1` (tip `4b2301c`) está pronta (build/typecheck/
  lint/testes afetados verdes) mas nunca foi mergeada em `main`. O core (`xansde/fusion`,
  `ficha3/o1`) está pinado em `4b2301c`, que fica órfão de `main` até esse merge. Ação: abrir PR
  `ficha3/o1` → `main` neste repo, merge (COM merge commit, sem squash — o core precisa do SHA do
  merge commit para re-pinar), depois abrir PR equivalente no core e mergear também. Ordem importa:
  satélite primeiro, core depois."

### C4 [importante] — CONSERTADO (decisão registrada)
- Decisão tomada (Alexandre indisponível; decidido pelo plano + regra do PF2e, registrada no
  código): aceitar o corte de T1.8 (mesmo precedente da Onda 3 — "se pudermos criar a ficha, está
  valendo"), mas parar de escondê-lo. O picker de fato (escolher QUAIS idiomas) segue fora — o pack
  nem carrega `additionalLanguages.value` ainda (confirmado ausente em TODO doc de
  `ancestries-core/documents.json`), então as OPÇÕES do picker não existem nem para ele funcionar.
- O que É computável sem o picker: a CONTAGEM de idiomas bônus. RAW = idiomas fixos da ancestralidade
  + 1 por ponto positivo de modificador de Inteligência. `stepCharLanguages` passa a derivar
  `languagesPendingCount = max(0, mod(Int))`; a VM expõe o getter; a ficha mostra "N idioma(s) a
  escolher" ao lado dos idiomas fixos (span com classe `--pending`, cor de warning) em vez de nada.
- `CharacterDerived.languages`/`languagesPendingCount` tipados (a `languages` também estava sem
  tipo — corrigido de passagem, já que eu estava tipando o campo irmão novo no mesmo lugar; não é
  um conserto do C8 do relatório adversarial, que cobre outro sintoma do mesmo campo).
- **Pendência para issue** (xansde/fusion-systems-2e): título "Picker de idiomas bônus (T1.8,
  escopo completo)" — corpo: "`stepCharLanguages` (`systems/pf2e/src/derivations/character.ts`)
  deriva `languagesPendingCount` mas não deixa o jogador ESCOLHER quais idiomas. Falta: (1) curar
  `additionalLanguages.value` no importador a partir do vendor (ancestries-core hoje só carrega
  `languages.value`, os fixos); (2) um diálogo de picker dedicado (não é um pack de documentos,
  é uma lista de strings por ancestralidade); (3) persistir a escolha e computar `languages` a
  partir dela em vez de só das fixas."

## Gate da rodada (core, `wt-o0`)

Todos os comandos abaixo rodaram na raiz do core após o build (`pnpm build` primeiro, conforme
regra da worktree) — exit 0 em todos, logs em `scratchpad/ficha3-reports/o1/fix-r1-*.log`:

- `pnpm build` — ok
- `pnpm typecheck` — ok
- `pnpm lint` — ok
- `pnpm lint:boundaries` — ok
- `pnpm format:check` — ok
- `pnpm spec:report` — ok (cobertura MVP 710/710, piso mantido)

Testes AFETADOS (não a suíte inteira — essa roda no CI do fecho), via `vitest --workspace
vitest.workspace.ts`: `derivations.test.ts` (71), `ficha-nivel3-onda1.test.ts` (70),
`grantMaterializer-realPacks.test.ts` (9), `planVM.test.ts` (380), `characterSheetVM.test.ts`
(221) — **751/751 verdes**.

## Falhas pré-existentes confirmadas (não são regressão desta rodada)

Rodei `pregen-parity.test.ts` (22 falhas) e `actionCategories.test.ts` (1 falha) com e sem os
consertos de C2 aplicados (`git stash` das mudanças não commitadas de C2 e re-rodei) — o conjunto
de falhas é IDÊNTICO nos dois casos. São dívida documentada em
`scratchpad/ficha3-reports/o0/baseline.md` (22 já existiam no tip da Onda 0; o tip da Onda 1 que
herdei já tinha 2 a mais — `Necromancer`/`Runesmith` skillIncreaseCeiling — antes de eu tocar em
qualquer coisa). Fora do escopo desta rodada (nenhum dos 4 achados aponta para esses arquivos).

## Achados refutados (nenhum — os 4 que recebi todos se confirmaram)

Nenhum dos 4 achados (C1/C2/C3/C4) estava errado; C3 é o único que não vira "conserto de código"
por ser um bloqueio de processo genuíno, documentado como pendência acima.
