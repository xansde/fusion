# Revisão adversarial — Onda 5 (Arquétipos padrão, Arquétipo Livre) — lente REGRA PF2e + CAMINHO DE PRODUÇÃO

Revisor: somente leitura em `wt-c` (core `ficha3/o5` @88e1f8a0, satélite `ficha3/o5` @86bbe99).
Caminho seguido: vendor → `build-mvp-subset.mjs` → `feats-core/{documents,index}.json` → `CompendiumService`
(lê o pack do disco em runtime, então mundo/ator existentes enxergam o pack novo sem migração) →
`PlanColumn.pickerConfigFor` → `featDocFromIndex` → `isFeatEligible`.

Veredito: **não mergear como está** — 1 bloqueante, 4 importantes, 1 menor.

---

## B1 (bloqueante) — `grantMaterializer.test.ts` fica vermelho POR CAUSA desta onda, e foi classificado como "pré-existente"

- Arquivo: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/grantMaterializer.test.ts:1745`
  (lista `expectedRemainingGap`, linhas ~1724-1730).
- Evidência: rodado isolado agora → `3 failed | 72 passed`; a falha real de asserção é o diff
  `- Munitions Master Dedication, - Palatine Detective Dedication, - Spellshot Dedication, + Razmiri Mask, + Storied Skin`.
  (as outras 2 são timeout de carga). No baseline da O0 (`o0/test-sheets-pf2e.log`, `o0/T0.5-test.log`)
  o arquivo está **verde** (`✓ grantMaterializer.test.ts (59 tests)`).
- Por que o "pré-existente" está errado: o `git stash` da lane T5.2/T5.3 só guardou o diff dela; o pack
  `feats-core` regenerado pela T5.1 continuou no disco. A causa é exatamente a T5.1: as 3 dedicações que o
  teste esperava como *não-resolvidas* agora existem no pack (resolvem — é melhora), e 2 grants de item novos
  (Razmiran Priest → Razmiri Mask, Tattooed Historian → Storied Skin) viraram gaps.
- Cenário: merge → CI do satélite roda `sheets-pf2e` → vermelho. O gate.md declara "única falha nova real era
  choice-sets" — falso.
- Conserto: atualizar `expectedRemainingGap` (remover as 3 dedicações, adicionar os 2 itens com a justificativa
  da decisão #3) e corrigir o gate.md / pendência de issue (não é issue: é conserto desta onda).

## I1 (importante) — T5.3 implementa a regra errada: libera nova dedicação com 1 talento de seguimento; o PF2e exige 2 OUTROS

- Arquivo: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:3414-3440` (`getIncompleteDedications`, `hasFollowUp = archetypeFeatItems.some(...)`);
  testes em `__tests__/planVM.test.ts:5258` ("returns [] once a follow-up feat naming the dedication is also picked").
- Regra (Player Core, Archetypes; texto idêntico no vendor pinado, ex. `feats/archetype/jalmeri-heavenseeker/...dedication.json`,
  `journals/archetypes.json`): "You can't select another dedication feat until you've gained **two other feats** from
  that archetype." = dedicação + 2 seguimentos.
- O próprio doc-comment da função diz "2 feats total — the dedication plus one follow-up": interpretou "até pegar 2
  talentos dela" como 2 no total.
- Cenário (nível 6, Arquétipo Livre): Acrobat Dedication no `archetypeFeat-2`, 1 talento de seguimento no `archetypeFeat-4`
  → `getIncompleteDedications` = [] → o picker do `archetypeFeat-6` oferece Sentinel Dedication. PF2e: proibido
  até o 3º talento do Acrobat. O teste de nível 4+ exigido pela T5.3 trava o comportamento errado.
- Conserto: contar seguimentos (`filter(...).length >= 2`) e ajustar os testes.

## I2 (importante) — a regeneração do `feats-core` arrastou drift em 83 talentos JÁ EXISTENTES; 51 traduções pt-BR caem para inglês em produção

- Arquivo: `systems/pf2e/packs/feats-core/documents.json` (diff +166k linhas; não é só +163 docs).
- Medido (origin/main × ficha3/o5, por `_id`): 0 removidos, 163 adicionados, **83 existentes alterados**
  (`system.description` 51, `system.rules` 24, `flags` 15, `publication` 40, `prerequisites` 9, `traits` 5, `name` 1).
  Exemplos: `Cascade Countermeasure` → renomeado `Conjurer's Countermeasure`; Magus `Dazzling Block`/`Sustaining Steel`/
  `Devastating Spellstrike`/`Starlit Eyes` perdem o pré-requisito `Arcane Cascade`; `Fused Staff`/`Standby Spell` perdem
  `Spellstrike`; `Steal Essence` funde dois pré-requisitos num só; `Steady Spellcasting` ganha traits `magus`+`necromancer`;
  `Living Weapon`/`Hard Tail`/`Tusks (Orc)` ganham regras `strike` novas.
- Produção: o `CompendiumService._getI18nPtBR` descarta entrada cujo hash (nome+descrição) mudou. Recalculei com
  `computeI18nSourceHash`: antes 1807 traduções vivas / 0 stale; depois **1756 vivas / 51 stale**. Num mundo existente
  (grupo pt-BR), Streetwise, Conceal Spell, Effortless Concentration, Paragon Battle Medicine, Tattoo Artist e ~35
  talentos de Magus passam a aparecer em inglês na ficha e no compêndio.
- É o mesmo drift que a lane identificou e reverteu nos OUTROS packs (issue #123), mas não isolou dentro do próprio
  `feats-core` — o relatório chama o diff de "cirúrgico". E fica inconsistente: `class-features-core` (Magus) foi revertido
  ao HEAD enquanto os talentos de Magus vieram da regeneração.
- Conserto: montar o `feats-core` = pack do HEAD + os 163 docs novos (merge por `_id`), deixando o drift para a #123;
  ou regenerar as traduções dos 51 no mesmo PR, com o drift revisado explicitamente.

## I3 (importante) — Sanguimancer Dedication: some do picker de arquétipo E vaza para o slot de talento de CLASSE de toda classe

- Arquivos: `planVM.ts:2347-2348` (`archetypeFeat` exige trait `archetype`) e `planVM.ts:2365-2373` (`classFeat`).
  Importer: `tools/importer-pf2e/src/build-mvp-subset.mjs:910` (inclui a dedicação de propósito, sem trait `archetype`).
- Índice real: `{"name":"Sanguimancer Dedication","system.level":2,"system.category":"class","system.traits.value":["dedication"]}`.
- Cenário A: personagem nível 2 com Arquétipo Livre → picker do `archetypeFeat-2` → Sanguimancer não aparece (166, não 167).
  A lane fez a exceção no importer justamente para "bater 167", mas ela é inalcançável na UI.
- Cenário B (pior): Guerreiro nível 2, variante ligada OU desligada → picker de talento de classe → `classFeat`: categoria
  `class`, sem trait `archetype`, sem trait de classe (`looksClassTagged` = false) → **elegível como talento de classe
  compartilhado**. Viola a regra do projeto "dedicação não cabe em slot de classe" (planVM `classFeat` rejeita `archetype`)
  e a T5.3 nem enxerga (só lê `archetypeFeat-N`).
- Conserto: normalizar no importer (injetar trait `archetype` em quem tem `dedication`) ou tratar `dedication` como
  `archetype` nos dois ramos de `isFeatEligible`; teste com o doc real do pack.

## I4 (importante) — gate da onda falha: 2 das 29 dedicações de multiclasse aparecem no picker do Arquétipo Livre; o gate vivo não foi executado

- Arquivos: `planVM.ts:2347-2348`; pack via `build-mvp-subset.mjs:876` (`GRANT_TARGET_DEDICATION_NAMES`: Alchemist, Rogue).
- Gate literal (`tasks.md`, Onda 5): "escolher uma dedicação padrão entre as 167, **sem que nenhuma das 29 de multiclasse
  apareça na lista**". No pack: `Alchemist Dedication@2` e `Rogue Dedication@2` têm `category: class` + traits
  `archetype`,`dedication`,`multiclass` → `isFeatEligible(..., "archetypeFeat", 2)` = true → aparecem no picker do nível 2.
- O `gate.md` só roda build/lint/test; não há personagem criado nem evidência viva (a O4 teve `evidencia-viva.md`). Se o gate
  tivesse rodado, o critério falharia.
- Conserto: rejeitar trait `multiclass` no ramo `archetypeFeat` (as duas continuam servindo à cadeia que as concede por
  GrantItem, que não passa por `isFeatEligible`) — ou, se a exposição for desejada, emendar o gate em `tasks.md`. E executar
  o gate vivo.

## M1 (menor, issue) — pré-requisitos e raridade das dedicações não são aplicados

- Contagem no pack: 138 das 166 dedicações padrão têm `system.prerequisites` (ex.: Bastion → "Shield Block",
  Blackjacket → "trained in medium armor and martial weapons", Acrobat → "trained in Acrobatics"); 108 são
  `uncommon`/`rare` (Red Mantis Assassin, Hellknight etc. exigem acesso do Mestre no RAW).
- `isFeatEligible` não olha nenhum dos dois, e `checkFeatPrerequisites` (planVM.ts:3114) só resolve pré-requisito de eixo de
  subclasse — proficiência vira "unknown" sem marca. Cenário: Mago nível 2 escolhe Bastion Dedication sem Shield Block, sem
  aviso. Comportamento geral pré-existente, mas esta onda multiplica a superfície de ~5 para 166 dedicações. Registrar issue.

---

## O que está certo

- Pack é lido do disco em runtime (`packages/server/src/compendium/service.ts`): mundo e ator existentes veem as dedicações
  novas sem migração; os `_id` dos docs existentes não mudaram (0 removidos).
- Filtro do importer por trait `multiclass` (não por nome) está correto; 166 com `archetype` + Sanguimancer = 167 no pack.
- T5.2 já existia (setting de mundo + slot só em nível par); confirmei o wiring no `PlanColumn`.
- Troca de dedicação no nível 2 não trava: slot preenchido abre detalhes, a remoção recalcula `getIncompleteDedications`.
- Efeito colateral bom (a registrar no teste, ver B1): Way of the Spellshot, Light Mortar Innovation e Palatine Detective agora
  concedem de fato a dedicação da subclasse.
- 27 ChoiceSets como "pendente": dívida declarada, coerente com a família existente.
