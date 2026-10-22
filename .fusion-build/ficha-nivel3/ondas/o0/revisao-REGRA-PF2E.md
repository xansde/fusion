# Revisão adversarial — Onda 0 — lente REGRA PF2e + CAMINHO DE PRODUÇÃO (2026-09-21)

Base: wt-o0, satélite `ficha3/onda0` (77a31bc) + `feat/classes-necromancer-runesmith`; core `ficha3/onda0` (e8460b3f).
Método: leitura do caminho real (PlanColumn.svelte → planVM.ts → grantMaterializer.ts → derivations/*) +
sondas node sobre os packs publicados (scripts em scratchpad/rev-*.mjs). Não rodei a suíte nem subi servidor.

## Veredito

O diff em si (3 testes + allowlist + export) é inofensivo e mergeável. O que NÃO se sustenta é a
conclusão da onda: "o grant funciona, 314/349 resolvem, Monk/Ranger/Guardian destravados". Resolver
por nome é condição necessária, não suficiente. Três furos de regra no caminho de produção.

## A1 — BLOQUEANTE (para o gate da onda): features de classe não-escolha nunca chegam ao ator

- `applyClass` (planVM.ts:3147) só cria o item de classe. As features de `featuresByLevel` NÃO são
  embutidas (comentário explícito em planVM.ts:~5417 e PlanColumn.svelte:411-417). O heal só
  materializa os ALVOS dos GrantItem delas.
- Toda derivação lê só `doc.items` embutidos: speed.ts:13-30, itemAlterations.ts:95-105
  (`collectDamageDiceFacesUpgradeTargets`), embeddedModifiers.ts:43, hp.ts:63; actionsVM.ts:292
  idem. `featuresByLevel` só tem consumidor em spellcasting.ts. Server (packages/server) não lê.
- Cenário: criar Monk nível 1 → Punho continua 1d4 (Powerful Fist não aplica; o teste
  derivations-equipment.test.ts:509 só passa porque injeta Powerful Fist EMBUTIDO); Flurry of Blows
  (classFeature com actionType=action) não aparece em Ações; subir ao 3 → velocidade 25, não 35
  (Incredible Movement, FlatModifier land-speed); Mystic Strikes não aplica. Guardian: resistência de
  Guardian's Armor não aplica. Kinetic Aura (ItemAlteration), Arcane Cascade idem.
- Medido: 40 features não-escolha de nível 1-3, nas 29 classes, carregam regra não-GrantItem ou são
  ação — todas mortas no ator (Rogue Sneak Attack, Swashbuckler Panache/Precise Strike, Gunslinger
  Slinger's Precision, Investigator Strategic Strike, Thaumaturge Implement's Empowerment...).
- O teste que "prova" o Monk é vácuo: grantMaterializer-realPacks.test.ts:134-155 só afirma
  "não lança e é idempotente" — as 4 features do Monk têm ZERO GrantItem (sonda: Flurry [] ,
  Powerful Fist set-property, Mystic Strikes set-property×2, Incredible Movement flat-modifier).
  Também constrói até o nível 20, não 3.
- O plano (buracos 1-12) não lista este buraco. Gate "features de 1, 2 e 3 concedidas de fato"
  falha para o Monk, que é justamente a classe do gate.

## A2 — IMPORTANTE: GrantItem ignora `predicate` → concede coisa errada / no nível errado

- grantMaterializer.ts:136-160 (`parseGrantItems`) não lê `predicate`; o validador T0.4
  (grant-resolution-validator.test.ts) conta como OK qualquer grant que resolva, com ou sem predicado.
- Cenários concretos, todos alcançáveis hoje no nível 1 (picker já cabeado → PlanColumn.svelte:1037
  materializa na hora; heal repete ao abrir):
  - Ranger escolhe Hunter's Edge **Vindicator** → recebe `Vindicator Dedication` (talento nível 2)
    no nível 1 (predicado `self:level >= 2` ignorado) e ainda fica com o slot de talento de classe do
    2 livre. Ranger é gate desta onda.
  - Rogue racket **Avenger** → Avenger Dedication no 1. Barbarian instinct **Bloodrager** → idem.
    Wizard school **Runelord** → idem.
  - Barbarian pega talento **Raging Intimidation** (nível 1) → recebe Intimidating Glare E
    **Scare to Death** (talento nível 15, predicado `skill:intimidation:rank:4`).
  - Antecedente **Martial Disciple** → recebe Cat Fall E Quick Jump (predicados de escolha
    `martial-disciple:acrobatics|athletics`); RAW é um dos dois.
  - Depois da Onda 1 (Prática do Animist cabeada): **Shaman** → Enhanced Familiar (nível 2) e
    Incredible Familiar (Animist) (nível 10) já no nível 1.
- Lista completa: 78 GrantItem fixos com predicado não-trivial (sonda rev-pred.mjs); os `class:<x>`
  e `or[class:champion, ...]` são inofensivos para a própria classe.
- Conserto mínimo: avaliar `self:level`/`gte` + opções de escolha conhecidas, ou pular (e reportar)
  grant com predicado não avaliável, e o validador passar a acusar predicado ignorado.

## A3 — IMPORTANTE: subir de nível não concede as features do nível novo

- `handleLevelUp` (PlanColumn.svelte:1185-1187) só manda `levelSet`, que (planVM.ts:5195-5226) mexe
  em nível e slots de magia, nunca em grants. O heal roda UMA vez por ator aberto
  (`healedActorId`, PlanColumn.svelte:465-473).
- Cenário: Guardian 2→3 na mesma sessão → Diehard (Tough To Kill) não aparece; Kineticist 2→3 →
  Extract Element não aparece; só depois de fechar e reabrir a ficha. Inverso: 3→2 mantém Diehard
  (nenhuma limpeza por `grantedSlot=classFeature:3:*`).
- É exatamente o roteiro do gate ("criar e subir até o 3").

## A4 — IMPORTANTE (processo): o gate vivo da onda não foi executado

- `ficha3-reports/o0/prints/` vazio; T0.5 não sobe mundo. O "Monk até o 3" só foi "provado" pelo
  teste vácuo de A1. Precisa rodar no mundo real antes de declarar a onda, e A1 vai reprovar.

## O que verifiquei e está OK

- Mundo existente / ator antigo: packs são servidos do diretório do sistema (compendium/service.ts
  discoverPacks), não copiados para o mundo. Entre `origin/main` e as 29 classes, as 12 classes
  antigas mantêm `_id`, `sourceId` e `featuresByLevel` idênticos, e 0 de 264 docs de
  class-features-core mudaram `rules` — ator criado antes não quebra; heal ao abrir cobre grants.
- Duplicata feature×grant: `featuresByLevel` e GrantItem não se sobrepõem no recorte amostrado
  (Champion's Aura/Deific Weapon vêm só por grant; Spellstrike ação×feature já deduplicado no chip).
  Idempotência do heal por (grantedBy, sourceId) confere.
- Amostra 1-3 vs remaster (listas de featuresByLevel): Monk, Ranger, Guardian, Champion,
  Kineticist, Magus têm as features nominais esperadas; o problema é A1/A2/A3, não a lista.
  Não verifiquei texto de regra das features (descrições vazias no pack) nem Devotion Spells (sem
  rules) contra o Player Core 2.
