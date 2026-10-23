# Revisão adversarial o4b — rodada 2

Alvo: fixer r2 (`fix-r2.md`), satélite `8203bae` + core `bb7fe458` em `scratchpad/wt-d`.

## N2 — FECHADO
- Diff: `handleLevelUp` (PlanColumn.svelte ~1512) passou a chamar `materializeApparitionSpells(targetLevel)`,
  guardado por `attunedApparitionItems(doc).length > 0`. Usa o nível-ALVO (ctx ainda é o pré-level-up), igual ao
  `materializeClassGrantsAtLevel` ao lado.
- Prova de que falharia sem o conserto: `git show 8203bae~1:.../PlanColumn.svelte` — o corpo de `handleLevelUp` só tem
  `sendAll(levelUp)` + `materializeClassGrantsAtLevel`; os casos 2 e 3 de `planColumn-levelup-apparition.test.ts`
  (regex `materializeApparitionSpells(targetLevel)` e `attunedApparitionItems(doc)`) ficam vermelhos. Rodei o arquivo no
  pin atual: 3/3 verdes.
- Mecânica conferida na leitura: `materializeApparitionSpells` calcula `maxRank` pelo parâmetro `level` (3 → rank 2),
  `apparitionRepertoireOps` cria o Knock mesmo com o doc ainda velho (a criação não depende de `slots["2"]`), e o sync
  de `spellsKnown` roda depois pelo `$effect` do `pendingApparitionSpells`, quando o espelho já trouxe o `slots["2"]`
  que o `levelSet` mandou ANTES pelo mesmo socket (a ordem é mantida).
- Ao vivo: `prints/r2-10-N2-knock-visible-full.png` — nv3, Patamar 2 com Knock, sem reabrir; a query no banco
  (`evidencia-viva-r2.md` §6) diz 4 spells, sem duplicata.

## C7 — FECHADO
- `prints/r2-06` (reabertura ANTES da escolha: "Sintonia de Aparição" vazia) → `r2-08` (nv1, aba Apparition Spells com
  Sigilo + Patamar 1 Mending, logo depois da escolha, sem reabrir) → `r2-09`/`r2-10` (nv3, Sigilo já em Patamar 2,
  Mending + Knock). Ator limpo `Fixer_o4b_r2`, pin atual. Cobre o nv1 e o nv3 que o achado pedia.
- Observação cosmética: `r2-07-C2-rank1-sem-reabrir.png` mostra a sub-aba "divine Spells", não a Apparition. A prova
  real do C2 é o `r2-08`. Não é achado.

## Ataque ao diff — achados novos (nenhum bloqueante nem importante)
- **N3 (menor)**: o campo de nível do modo EDITAR (`CharacterSheet.svelte` `handleLevelCommit` → `vm.updateLevel` →
  `levelSet`) não chama `materializeApparitionSpells`. Quem digita 3 no campo fica sem o Knock até reabrir a ficha; o
  heal de abertura (passo 5) corrige. É a mesma lacuna que esse caminho JÁ tem hoje com os grants de classe
  (`materializeClassGrantsAtLevel` também só roda no botão). O conserto do N2 dizia "e em toda chamada de levelSet",
  mas o dono nomeado era o `handleLevelUp`, e o fixer registrou a decisão em `fix-r2.md`. Vira issue junto com os
  grants de classe do mesmo caminho, não bloqueia a onda.
- Corrida com clique duplo (2→3→4 disparado dentro da janela do espelho) poderia criar o Knock em dobro, porque o
  `byName` ainda não vê o item que não voltou do servidor. A janela é de milissegundos, e o padrão é o mesmo que o
  `materializeClassGrantsAtLevel` já tem. A evidência viva clicou duas vezes seguidas sem gerar duplicata. Não é achado.
- O teste é estrutural (regex sobre o código-fonte do .svelte), que é a convenção do repo (`planColumn-variant-rules.test.ts`).
  A prova de comportamento fica com a evidência viva. Não é achado.

## Veredito: APROVADA
