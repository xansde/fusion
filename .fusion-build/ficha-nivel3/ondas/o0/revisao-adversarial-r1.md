# Re-verificação adversarial da O0, rodada 1

Worktree `scratchpad/wt-o0`. Core `ficha3/onda0` @ `0433f286` (pin do satélite = `35a56b1`, que está em `origin/ficha3/onda0`). Satélite: `77a31bc..35a56b1`.

## Testes-alvo que rodei (a suíte inteira não)

- satélite `sheets/pf2e`: grant-resolution-validator (4), grantMaterializer-realPacks (6), grantMaterializer (75), planVM (380): **465/465 verdes**
- satélite `systems/pf2e`: derivations-speed: **12/12 verdes**
- core `packages/client`: traitNames.sync: **3/3 verdes**
- issues #88, #89 e #92 existem em xansde/fusion-systems-2e e estão OPEN

## Achados originais

| id | estado | evidência |
|---|---|---|
| C1 | FECHADO | `runClassGrantRefs` (PlanColumn.svelte:476) embute a feature (`buildGrantCreateOp`, marcador grantedBy=classe e grantedSlot=classFeature:<nv>:<nome>) antes de `materializeGrants`. Chamado a partir de applyClass (l.844), levelUp (l.1251) e runHeal (l.613). O teste realPacks tem asserção nominal: Powerful Fist e Flurry no nv1, Incredible Movement e Mystic Strikes no nv3, velocidade 35 via runFullDerivation. A troca de classe já remove os itens com grantedBy=classe antiga (planVM applyClass). |
| C2 | FECHADO | 8 entradas `blocked-by-issue` (#88 x7, #89 x1), com teste de que toda entrada carrega o número da issue; validador verde. |
| C3 | FECHADO | Caminho de saída do gerador corrigido (4x ".."); traitNames.ts com 228 entradas; sync verde. |
| C4 | FECHADO (com ressalva menor) | Asserções nominais e de derivação no lugar de `after>=before`. Ressalva: `healClassGrants` do teste é um **espelho** de `runClassGrantRefs`, não o código de produção. Se o Svelte divergir, o teste continua verde. A prova viva ficou pendente, registrada na T0.6. |
| C5 | FECHADO | `evaluateGrantPredicate` com self:level e skill:rank; `materializeContext` recebe `level` e `getSkillRank`. Testes de fixture Vindicator e Scare to Death nos dois sentidos. (Menor: no level-up, o predicado é avaliado com o `ctx.level` antigo; o grant só entra no próximo heal.) |
| C6 | **ABERTO (parcial)** | Subir de nível pelo botão da Plan materializa. Descer de nível não. A retração foi posta em `levelSet`, mas o único chamador de `levelSet` é `levelUp` (+1): a retração nunca dispara pela UI. O único caminho que desce o nível é o campo de nível do modo edição (CharacterSheet.svelte:814, handleLevelInput → `vm.updateLevel`, characterSheetVM.ts:2485), que grava `system.level.value` direto, sem retrair e sem materializar. `runHeal` só acrescenta. Cenário: Monk nv3 → campo de nível = 2 → Incredible Movement e Mystic Strikes continuam embutidos → velocidade 30 (fórmula a nv2 = 5) em vez de 25. O mesmo campo, usado para subir, não materializa nada até a ficha ser reaberta. |
| C7 | FECHADO | As 4 entradas reclassificadas como `class-archetype-gap` com issue #92. |
| DOC | FECHADO | plano.md: buraco 3 fechado, buraco 1 corrigido (314/349, sem conversão) e buraco 13/T0.6 registrados. A frase "no subir/descer de nível (materializeClassGrantsAtLevel/levelSet)" promete o que o C6 não entrega pela UI. |

## Achados novos

### N1 — importante — o predicate dos flat-modifiers das features de classe, agora embutidas, é ignorado

O C1 passou a embutir as features, e o c57169f passou a avaliar fórmulas. Com isso, os FlatModifiers dessas features chegam a `speed.ts`/`hp.ts` pelo `collectEmbeddedModifiers`. O `modifiersFromItem` (systems/pf2e/src/derivations/embeddedModifiers.ts) **não lê `predicate`** (o `RawRule` nem declara o campo). O `itemAlterations.ts` respeita o predicate; o coletor de FlatModifier não.

Casos concretos, tirados dos packs reais (features não-escolha de nível ≤ 3 do featuresByLevel):
- **Swashbuckler nv1, Stylish Combatant**: `speed` +5 status, com predicate `self:effect:panache` (ou vivacious-speed fora de panache). Passa a valer sempre, então a ficha sem panache mostra velocidade +5.
- **Swashbuckler nv3, Vivacious Speed**: duas regras de `speed` mutuamente exclusivas (panache/não-panache), que agora avaliam 10 e 5. O stacking status fica em +10, quando o RAW fora de panache é +5.
- **Monk nv3, Incredible Movement**: `{"not":"self:armored"}` é ignorado; um Monk de armadura fica com 35.

Antes do conserto, as três features não tinham efeito nenhum (não eram embutidas, e a fórmula degradava a 0). É regressão de valor exibido introduzida pelo diff do fix.

Conserto: `modifiersFromItem` pula (ou avalia) uma regra com `predicate` não vazio, na mesma postura do `hasNoPredicate` de itemAlterations. Teste: Swashbuckler nv1 sem panache mantém a velocidade base, e Monk de armadura fica com 25.

### N2 — menor — acentuação dos 11 traits novos sem issue

O fixer registrou no relatório que `aparicao`, `icone` etc. saíram sem acento (`ACCENT_FIXES` desatualizado), mas não abriu issue. Pela regra "pendência vira issue", falta abrir.

### Observações sem severidade

- `evaluateArithmeticFormula` substitui `@actor.level` antes de `@actor.level.value`, então uma fórmula com `@actor.level.value` vira `(3).value` e degrada a 0. É a postura conservadora anterior, não regressão.
- Um grant com predicate self:level vindo de uma feature de nv1 (Vindicator Dedication, slot `classFeature:1:…`) não é retraído ao descer abaixo do nível do predicate.

## Veredito

APROVADA COM CONSERTOS. Nenhum bloqueante aberto; ficam abertos C6 (parcial) e N1, os dois importantes, e N2 (menor).
