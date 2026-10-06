# Revisão adversarial — Onda 5 — lente DADO + IMPORTADOR + INTEGRIDADE

Satélite `origin/main...ficha3/o5` (86bbe99) · core `origin/alfa/app...ficha3/o5` (só o pin → 86bbe99).
Método: comparação por `_id` do `feats-core/documents.json` antigo e novo, hash do i18n recalculado com
`tools/translate-packs/src/hash.mjs`, `construirGrafo()` rodado nas duas árvores (via `git archive` no
scratchpad `rev5/`), elegibilidade do picker reproduzida a partir de `isFeatEligible`. Nada foi editado.

## O que confere (não é achado)

- 163 docs novos (167 no total, 4 já estavam): todos com nível 2, trait `dedication`, sem `multiclass`,
  com `flags.fusion.sourceId`, licença ORC (111) ou OGL (52), descrição preenchida. Nenhum doc removido.
  Nenhum nome duplicado no pack.
- `injectHandAuthoredClassFeatures`: os 2 docs são byte-idênticos aos que já estão em `class-features-core`
  (mesmo `_id` e texto, então o sourceHash da tradução "Fonte de Cura" continua valendo).
- Allowlist: as 4 entradas do #92 saíram porque os alvos agora resolvem, e as 4 novas estão coerentes com a decisão #3 e com `archetype-not-imported`.
- O pin do vendor confere: HEAD do clone = `98cb84fa…`.

## Achados

### A1 — BLOQUEANTE — o regen do feats-core trouxe 83 mudanças fora do escopo, e 51 traduções pt-BR ficam obsoletas

`systems/pf2e/packs/feats-core/documents.json`: além dos 163 docs adicionados, **83 docs que já existiam mudaram**
(description em 51, publication em 40, rules em 24, prerequisites em 9, traits em 5, name em 1).
É o mesmo drift da issue #123. A lane reverteu esse drift nos outros packs, mas deixou passar dentro do
`feats-core`:
- **pt-BR**: o `i18n.pt-BR.json` não foi tocado. O runtime (`packages/server/src/compendium/service.ts:1052-1060`)
  descarta a entrada cujo `sourceHash` não bate e mostra o texto em inglês. Hoje 1807 entradas batem com o pack
  antigo e só 1756 com o novo. **51 talentos que estavam em pt-BR passam a aparecer em inglês em produção**:
  Anchoring Arrow, Boarding Party, Arcane Fists, 30+ do Magus, Effortless Concentration, Conceal Spell,
  Know-It-All, Streetwise, Tattoo Artist, Paragon Battle Medicine e outros.
  A issue #121 cobre só as 167 dedicações, não essa regressão.
- **Packs em versões diferentes**: os talentos do Magus agora são do remaster (*Impossible Magic*, 49 docs), mas a
  classe Magus e as class features (`Arcane Cascade`, `Spellstrike`) continuam em *Secrets of Magic* no
  `classes-core`/`class-features-core`. O talento `9wX3WV0MpJfoeABQ` foi renomeado de "Cascade Countermeasure"
  para "Conjurer's Countermeasure", e a descrição dele agora aponta para a magia `Conjurer's Countermeasure`, que
  não existe no `spells-core` (lá ela ainda se chama "Cascade Countermeasure"). Resultado: o link fica quebrado.
- **O teste foi rebaixado com justificativa falsa**: em `tools/importer-pf2e/src/__tests__/grafo-de-feats.test.mjs:111-131`
  a trava caiu de 118 para 110, e o comentário atribui a queda às dedicações entrando no universo global.
  Diff real das arestas ambíguas: as 8 que sumiram são **todas do Magus**, por pré-requisito removido no drift
  (`Arcane Cascade` em Dazzling Block, Sustaining Steel, Devastating Spellstrike, Starlit Eyes e Cascade
  Countermeasure; `Spellstrike` em Arcane Shroud, Fused Staff e Standby Spell). Nenhuma aresta nova apareceu.
  A trava que existia para pegar regressão silenciosa foi reajustada para aceitar uma.
- Cenário: jogador abre o picker, vê "Effortless Concentration" e "Magus's Analysis" em inglês onde antes
  estavam em pt-BR. Um Magus nível 2 lê texto remaster num talento que depende de class feature legada.
- Correção: gerar `feats-core` = pack antigo + só os 167 docs selecionados por `isStandardArchetypeDedication`,
  sem re-transformar os existentes. O drift fica para a #123. Também é preciso reverter a trava para 118,
  ou recalcular depois que o drift sair.

### A2 — IMPORTANTE — Sanguimancer Dedication foi importada, mas o picker não oferece

A lane afrouxou o filtro do importador para aceitar o doc sem o trait `archetype` e chegar a 167.
Só que `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2348` (`archetypeFeat`) continua exigindo
`traits.includes("archetype")`. Reproduzi o predicado nos 167 docs e **apenas "Sanguimancer Dedication"
(traits `["dedication"]`) é rejeitado**. Cenário: personagem nível 2 com Arquétipo Livre ligado abre o
slot `archetypeFeat-2` e vê 166 dedicações, não 167. Sanguimancer nunca aparece, mesmo estando no pack.
Correção: normalizar o trait no importador (acrescentar `archetype` em curadoria) ou aceitar `dedication`
no predicado. Falta também um teste que conte as elegíveis a partir do pack.

### A3 — IMPORTANTE — o gate da onda falha: 2 dedicações de multiclasse aparecem no slot de arquétipo

O gate em `tasks.md` (Onda 5) diz: "escolher uma dedicação padrão entre as 167, **sem que nenhuma das 29 de
multiclasse apareça na lista**". Com o predicado da `planVM.ts:2348`, `Alchemist Dedication` e `Rogue Dedication`
(ambas com trait `multiclass`, nível 2, já no pack) aparecem no `archetypeFeat-2`. `gate.md` declarou a onda
fechada sem checar esse critério. Pela regra do PF2e, o Arquétipo Livre permite multiclasse, e a ficha do
Tobias já usa Alchemist Dedication. Então a correção pode ser emendar o critério do gate em vez de bloquear
as duas. Hoje, porém, o critério escrito está violado e não foi verificado.

### A4 — MENOR (issue) — dedicações de arquétipo de classe entram no pool genérico sem trava

10 das 167 têm o trait `class`: Battle Harbinger, Elementalist, Flexible Spellcaster, Munitions Master,
Palatine Detective, Seneschal Witch, Spellshot, War Mage, Warrior of Legend e Wellspring Mage.
`Palatine Detective Dedication` tem `prerequisites: []` no próprio vendor. Então `checkFeatPrerequisites`
(`planVM.ts:~3118`) não marca nada: **um Guerreiro nível 2 escolhe Palatine Detective Dedication e ganha
Mystic Aegis sem nenhum aviso**. Pela regra, é um arquétipo de classe do Investigador.
Além disso, Munitions Master, Spellshot, Palatine Detective e Battle Harbinger já vêm concedidas no nível 1
pela subclasse. O mesmo personagem pode pegá-las de novo no slot e ficar com o talento duplicado.

## Não verificado

- Não rodei o pipeline de regen (a regra é leitura). A idempotência foi inferida pelo código: a injeção
  é por `_id` e os docs são idênticos.
- Não conferi o caso de `checkVendorPin` com clone divergente.
