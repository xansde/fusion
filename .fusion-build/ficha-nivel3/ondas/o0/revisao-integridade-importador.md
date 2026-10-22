# Revisão adversarial da Onda 0: integridade do dado e importador

Revisor: lente INTEGRIDADE DO DADO + IMPORTADOR (opus), 2026-09-21. Nada foi editado em wt-o0.
Mutação feita em wt-o0-grants (satélite com detach em origin/ficha3/onda0 = 77a31bc) e desfeita com `git restore`
(`git status` limpo depois). Scripts de comparação em `scratchpad/rev-integ/`.

## Veredito: NÃO PODE MERGEAR como está (2 bloqueantes)

### B1 (bloqueante): CI vermelho nos dois repos, e o validador nasce sem sinal
- Satélite, run 35557899943 (ficha3/onda0 @77a31bc): o step `Test sheets/pf2e` falha com
  `grant-resolution-validator.test.ts` e a mensagem "8 grant(s) do not resolve locally and are NOT on the allowlist". A run
  anterior da mesma branch (@bb167c1, só T0.2) estava VERDE. O vermelho entra com a própria T0.4.
- Core, run 35558489316 (ficha3/onda0 @e8460b3f): mesmo vermelho do validador, mais o de traitNames (ver B2).
- A permissão da sessão só autoriza o merge com o CI verde.
- Pior: com o teste já vermelho, uma regressão NOVA não muda nada no CI. Mutação real feita no disco: renomeei
  "Hunt Prey" em `actions-core/documents.json`. O validador passou de 8 para 10 não-resolvidos (Avenger e Hunt Prey
  → Hunt Prey). Ele detecta a quebra, mas o job já estava vermelho, então o sinal é nulo. Enquanto os 8 (issues #88/#89)
  não forem tratados (allowlist com categoria `tracked-issue` e o link da issue, ou conserto), o validador não
  protege nada. O gate da execucao.md para a O0 ("tem que dar 0") também não fecha: hoje dá 35, sendo 27 na allowlist e 8 soltos.

### B2 (bloqueante): o bump do pin quebra `traitNames.sync.test.ts` no core. A falha é nova, não "pré-existente"
- `git diff origin/alfa/app..ficha3/onda0 -- external/fusion-systems-2e`: o pin vai de e0597c9 (main do satélite, 12 classes)
  para 77a31bc (29 classes, 10 commits à frente). A última run verde de alfa/app é de 24/08 (5e208936).
- O baseline da T0.2 foi medido com a worktree JÁ pinada em 073fb5e (29 classes). Por isso as 2 falhas de
  `traitNames.sync` aparecem como "dívida pré-existente". Contra `alfa/app`, porém, elas são INTRODUZIDAS por esta onda.
- Cenário: `TRAIT_NAMES_PT` tem 217 chaves e o glossário tem 228. Faltam necromancer, runesmith, ikon, additive, additive2,
  apparition, wandering, modification, mindshift, amp e evolution. Na produção, os chips de traço dessas 11 chaves saem
  sem tradução. Correção: rodar `node tools/translate-packs/gen-client-maps.mjs` (o próprio teste manda) nesta onda.
- A mesma ressalva vale para `actionCategories` e `pregen-parity`. No CI eles não aparecem porque se auto-pulam sem vendor,
  mas localmente também são "baseline" só por causa do pin novo.

### I1 (importante): 4 entradas da allowlist violam a regra escrita no cabeçalho do próprio arquivo
- `grant-resolution-allowlist.mjs` (~l.36) diz: "No entry here may cover a reference a level 1-3 creation path for
  one of the 29 classes ACTUALLY NEEDS". As 4 entradas `archetype-not-imported` (~l.255-290) são opções de subclasse
  escolhidas no NÍVEL 1: Light Mortar Innovation (Inventor), Way of the Spellshot (Gunslinger), Palatine Detective
  (Investigator) e Battle Creed (Cleric). A justificativa chama a dedicação de "de bônus". O cabeçalho fala em
  "multiclass-dedication", mas no vendor os alvos são dedicações de ARQUÉTIPO DE CLASSE (traits archetype, class, dedication; nv 2;
  a Battle Harbinger tem ChoiceSet+GrantItem das auras).
- Cenário: Gunslinger nv 1 com Way of the Spellshot fica sem o item Spellshot Dedication na ficha, e sem os truques dela.
  Cleric Battle Creed nv 1 fica sem as auras de Battle Harbinger. A ficha "criada" até o nv 3 fica incompleta e não sai
  erro nenhum.
- A saída depende de a T5.1 importar esses 4 para `feats-core`, porque `mapVendorToFusionPack("feats-srd")` só olha
  `feats-core`. Se a T5.1 publicar num pack novo, a entrada continua não-resolvida para sempre e o validador aceita.
  Correção: recategorizar como pendência da fatia com issue, nomear os 4 na T5.1 e pôr um gate dizendo que a
  subclasse no nv 1 recebe a dedicação.

### M1 (menor): o validador não cobre as mesmas fontes de grant que a produção
- A produção (`grantMaterializer.ts`, walk ~l.537) lê `parseGrantItems` + `parseMechanicsGrants` + `parseSystemItemsGrants`.
  O validador (l.73) omite `parseMechanicsGrants`.
- `class-features-core/mechanics.json` tem 28 grants `fixed-item`. Hoje os 28 resolvem, conferido por script. Se um deles
  regredir (alvo renomeado ou removido), a ficha perde o item e o validador fica verde. O comentário "the EXACT algorithm"
  (l.6) está errado. O validador também reimplementa o match (l.76-84) em vez de chamar `resolveByName`.

### M2 (menor): a T0.4 pedia "falhar o build do pack" e isso não acontece
- O validador roda só na suíte do sheets-pf2e. `tools/importer-pf2e` não consulta a allowlist, e uma regeneração que
  derrube um alvo termina com exit 0. A pegada só vem depois, no CI (que hoje está vermelho, ver B1). É um desvio do tasks.md
  e merece um OK do Alexandre, junto com a decisão da T0.3 de não converter namespace nenhum (verifiquei o argumento,
  ver abaixo, e ele se sustenta).

### M3 (menor): 1.539 docs novos sem pt-BR
- A cobertura do `i18n.pt-BR.json` antes e depois ficou igual e as entradas antigas continuam intactas. Nada se perdeu,
  mas os 17 classes, 422 features, 952 feats, 131 spells e 17 actions novos têm 0 entradas. A dívida está declarada no
  corpo do PR #57 do satélite. Não verifiquei se existe issue para ela. Se não existir, vira issue.

## Checagens que PASSARAM (com números)
- (a) Packs main → 29 classes, docs existentes: 0 removidos, 0 renomeados, 0 com conteúdo alterado. `_id` estável
  (idShift = 0 por sourceId). O crescimento foi só de append: actions 521→538, class-features 264→686, classes 12→29,
  feats 1807→2759, spells 1262→1393. `index.json` bate 1:1 com `documents.json` (ids e nomes). Não há sourceId duplicado.
  A onda (T0.2-T0.5) não tocou em nenhum pack. `featuresByLevel` nv 1-3 das 29 classes: 149 refs, todas com id
  resolvível. Só 2 divergem no nome ("Deity"/"Deity (Cleric)", "Hexes"/"Hex Spells"), o que é curadoria.
- (b) Homônimos: 0 nomes normalizados duplicados em qualquer pack publicado. 0 sobreposições entre weapons-core e
  equipment-core. Cada pack Fusion vem de um único pack do vendor (os 2 docs authored não têm packName, mas são
  Healing/Harmful Font). O índice de produção (`compendium:search`) serve o nome em inglês e o overlay pt-BR fica num campo
  separado, então o match por nome da produção bate com o do validador. Não consegui construir um caso de grant resolvido
  para o doc errado.
- (c) Não existe conversão para repetir. A idempotência do heal está coberta por `grantMaterializer-realPacks.test.ts`.
  Os ids do importer vêm de hash determinístico (normalize/transform).
- (d) Mutação no disco detectada (8→10). A allowlist bate pela chave inteira (pack+granter+alvo+vendor). A checagem de
  entrada obsoleta existe. O step do CI é real e não tem `continue-on-error`, mas já está vermelho (B1).
