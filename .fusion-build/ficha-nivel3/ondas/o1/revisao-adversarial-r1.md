# Re-verificação adversarial da o1, rodada 1

Alvo: core `ficha3/o1` @ `a71e2a83` (gitlink → satélite `4b2301c`); satélite `ficha3/o1`
(`21c564a` C1, `cb34809` C2, `4b2301c` C4). Nada foi editado. Rodei só os arquivos afetados:
`grantMaterializer-realPacks` + `ficha-nivel3-onda1`, 79/79 verdes.

## Veredito: APROVADA COM CONSERTOS

Nada bloqueante ficou aberto. Continuam abertos C3 e C4, e há um achado novo importante (N1)
no próprio conserto do C4.

## Achados originais

### C1 [bloqueante]: FECHADO
- `classGrantRefsFromClassDoc` agora deixa de pular Eidolon e Divine Spark and Ikons
  (`CHOICE_WRAPPERS_WITH_FIXED_GRANTS`).
- Por que o teste falharia sem o conserto: no pack, Manifest Eidolon aparece como GrantItem
  **só** no doc "Eidolon", e Shift Immanence **só** em "Divine Spark and Ikons". Os dois
  wrappers são as features de nível 1 da classe. Sem a ref do wrapper, nada materializa
  essas ações. Os testes novos passam.
- Guarda da #22: os uuids placeholder (`{item|…}`) do wrapper não parseiam
  (`parseGrantUuid` recusa `{`), então a opção escolhida não é aplicada duas vezes. O slot
  de escolha usa o id `eidolon-1`, e o wrapper embutido usa `classFeature:1:eidolon`. Os
  dois não colidem.
- Resíduo menor (N3): os placeholders têm `inMemoryOnly: false`, então cada heal de
  Summoner/Exemplar gera um `console.warn` "unresolved-placeholder" (1 a 3 entradas). É só
  ruído de console.
- Resíduo menor (N4): o comentário diz que o conjunto é "exaustivo", mas a varredura dos
  36 nomes de `CLASS_CHOICE_SLOTS` acha também "Gate's Threshold" (e as versões
  Second/Third/Fourth) com GrantItem fixo de "Gate Junction". Esse comportamento vem de
  antes (issue #8, caminho próprio) e não é regressão, mas a afirmação está errada.

### C2 [importante]: FECHADO
- `tacticKnown` usa `categories: [commander-mobility-tactic, commander-offensive-tactic]`.
  O teste afirma exatamente 14 a partir do pack; antes eram 37 (o teste antigo filtrava
  pelo trait "tactic").
- `actions-core/index.json` regenerado: 14 entradas com o otherTags certo. Comparei
  `otherTags` do índice com `documents.json` nas 538 entradas, com 0 divergências. O
  servidor lê `index.json` primeiro (`compendium/service.ts:1368`) e o picker do client lê
  `e.index["system.traits.otherTags"]` (`PlanColumn.svelte:1001`), então o filtro chega à UI.
- Resíduo menor (N2): `packs/actions-core/pack.json` → `indexFields` não ganhou
  `system.traits.otherTags`. O fallback do servidor (reconstruir o índice a partir de
  `documents.json` quando `index.json` não existe) perderia o filtro. Some na próxima
  execução do pipeline.

### C3 [importante]: ABERTO
- O core agora está pinado em `4b2301c`, que também só existe em `ficha3/o1` do satélite
  (`git branch -a --contains` retorna só a branch de feature). O fixer não consertou e
  deixou como pendência de processo. A ordem continua obrigatória no merge: satélite com
  merge commit, re-pin do core, merge do core.

### C4 [importante]: ABERTO
- O conserto pedia que **o Alexandre** aceitasse o corte. Foi o fixer que se declarou
  aceito ("Alexandre indisponível"). A decisão continua pendente.
- A premissa do corte é falsa: o comentário de `stepCharLanguages`, o commit e a issue
  proposta dizem que `additionalLanguages.value` está "ausente em TODO doc de
  ancestries-core". Medido: **9 de 10** ancestralidades carregam a lista. Exemplos: Dwarf
  `[gnomish, goblin, jotun, orcish, petran, sakvroth]`, Elf, Ratfolk… Human tem
  `value: []` e `count: 1`. As opções do picker **existem** no pack, então o motivo dado
  para não fazer o slot não se sustenta, e a issue proposta ("curar additionalLanguages no
  importador") pede um trabalho que já está feito.

## Achados novos

### N1 [importante]: `languagesPendingCount` ignora `additionalLanguages.count`
- `character.ts` calcula `max(0, mod(Int))`. A regra (e o próprio dado do pack) soma
  também o `additionalLanguages.count` da ancestralidade: Human tem `count: 1`.
- Cenário: um Human com Int +0 aparece sem idioma pendente (o certo é 1). Com Int +2
  aparece 2 (o certo é 3). Human é a ancestralidade mais comum, e a ficha mostra um número
  errado justamente no aviso que o C4 criou para tornar o corte visível.
- Conserto: `pending = max(0, mod(Int)) + (ancestry.system.additionalLanguages.count ?? 0)`,
  com um teste de Human (Int 10 → 1).

### N2, N3, N4 [menor]
Descritos acima (indexFields do pack.json, warn de placeholder, comentário de
exaustividade).

## O que não foi verificado
- A suíte inteira e o `pnpm build`/`typecheck` (rodei só os 2 arquivos afetados; o gate do
  fixer diz exit 0).
- Os testes de C4 (`derivations`, `characterSheetVM`) não foram re-rodados. Li o código.
- Não reproduzi o vermelho do C1/C2 revertendo o código (não posso editar). A prova do C1
  é pelo dado do pack; a do C2 é pelo teste antigo, que contava 37.
