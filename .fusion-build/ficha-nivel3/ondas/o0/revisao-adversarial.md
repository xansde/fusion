# Revisão adversarial: Onda 0 (juiz), 2026-09-21

**Veredito: REPROVADA.** A onda tem 4 bloqueantes confirmados. Dois deles deixam o CI vermelho nos dois repos, o terceiro faz o gate da onda falhar pelo motivo central, e o quarto é a prova de entrega que não existe.

Worktree verificada: `scratchpad/wt-o0` (core `f160594a`, satélite `77a31bc`). Nada foi editado. Só rodei arquivos de teste isolados.

## Verificações que rodei

| Verificação | Resultado |
|---|---|
| `vitest run grant-resolution-validator.test.ts grantMaterializer-realPacks.test.ts` (sheets/pf2e) | 1 falhou e 5 passaram: "8 grant(s) do not resolve locally and are NOT on the allowlist" |
| `vitest run traitNames.sync.test.ts` (client) | 2 falharam: faltam necromancer, runesmith, ikon, additive, additive2, apparition, wandering, modification, mindshift, amp e evolution |
| Glossário de traits: e0597c9 (pin de alfa/app) × 77a31bc | 217 → 228. É regressão desta onda, não dívida antiga |
| `gh run view` 35557899943 (satélite) / 35558489316 (core) | as duas terminaram em failure |
| `git branch -r --contains 77a31bc` / tag | só origin/ficha3/onda0, sem tag e sem PR para a main do satélite |
| Pack class-features-core: Vindicator | tem GrantItem "Vindicator Dedication" com predicate `self:level >= 2`; o alvo existe em feats-core |
| Pack: Raging Intimidation → Scare to Death | predicate `skill:intimidation:rank:4`; o alvo existe |
| classes-core i18n | 29 docs, 12 com tradução |

## Confirmados

### C1 · BLOQUEANTE: features de classe que não são escolha nunca viram item do ator
- Prova no código: `planVM.ts:3147` `applyClass` só emite o item de classe e as entradas de conjuração e de foco. O comentário em `planVM.ts:5417` diz literalmente: "featuresByLevel features are NOT embedded on the actor". As derivações (`speed.ts`, `itemAlterations`, `actionsVM`) só leem `doc.items`.
- A evidência viva bate com isso: Flurry of Blows e Powerful Fist não estão no world.db. A ressalva sobre o gatilho não se sustenta, porque nenhum caminho embute essas features.
- Consequência: Powerful Fist, Incredible Movement (Monk nv 3 com velocidade 25 em vez de 35), Mystic Strikes, Guardian's Armor, Sneak Attack e Panache (cerca de 40 features de nv 1-3) ficam mortas. O gate da onda ("concedidas de fato, não só listadas") falha.
- Dono: satélite, `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (`applyClass`, `levelUp`/`levelSet`) + `PlanColumn.svelte`.
- Conserto: embutir as classFeature de `featuresByLevel` até o nível atual (com o marcador `grantedSlot classFeature:<nv>:<nome>`) em applyClass e na subida de nível, e removê-las na descida. O teste deve verificar por nome no ator: Powerful Fist e Incredible Movement, velocidade 35 no nv 3. Isso não estava no plano, então vira tarefa nova (T0.6) antes do fecho da O0.

### C2 · BLOQUEANTE: o validador T0.4 nasce vermelho (vale para B1 das lentes dado-importer, testes-contratos e costura-ci)
- Reproduzido: 8 grants fora da allowlist (Battle Creed ×7 e Undead Creator → Create Undead). Os CIs do satélite e do core estão vermelhos, e com o teste sempre vermelho uma regressão nova passa despercebida.
- Dono: satélite, `tools/importer-pf2e/src/curation/grant-resolution-allowlist.mjs` + `grant-resolution-validator.test.ts`.
- Conserto: criar a categoria explícita `blocked-by-issue` com o nº da issue para os 8, e deixar o teste de entrada stale cobrando a remoção. A alternativa é consertar os 2 casos.

### C3 · BLOQUEANTE: o pin novo quebra traitNames.sync no core (vale para B2 das três lentes)
- Reproduzido: 217 × 228. Contra `origin/alfa/app` é regressão, porque o baseline da T0.5 foi medido com o pin já adiantado.
- Dono: core, `packages/client/src/lib/compendium/traitNames.ts`.
- Conserto: rodar `node external/fusion-systems-2e/tools/translate-packs/gen-client-maps.mjs` e commitar o mapa no mesmo commit do pin.

### C4 · BLOQUEANTE (processo): a prova de entrega da O0 não existe (A4 + I2)
- A evidência viva ficou PARCIAL: só o Monk nv 1 foi testado, e falhou. Monk nv 2-3, Ranger e Guardian não foram testados, e existe 1 print, não 3.
- O teste do Monk em `grantMaterializer-realPacks.test.ts:134` é vácuo: `after >= before` é sempre verdade e ele não nomeia nenhum item. A contagem de grant não resolvível é 8 (mais 27 na allowlist), não 0.
- Dono: orquestração (gate-runbook) + satélite (teste).
- Conserto: depois do C1, reescrever o teste para verificar itens e derivações por nome e rodar o runbook inteiro (Monk 1/2/3, Ranger, Guardian) com prints.

### C5 · IMPORTANTE: GrantItem ignora o predicate (A2)
- Prova no código: `grantMaterializer.ts:136-160` não lê `predicate`. No dado: Vindicator Dedication (`self:level >= 2`) é concedida no nv 1, e Scare to Death (predicate de rank lendário) vem junto com Raging Intimidation.
- Dono: satélite, `grantMaterializer.ts` (parseGrantItems/materializeGrants).
- Conserto: avaliar o predicate contra o ator. No caso mínimo, adiar grants com `self:level` ou rank e re-materializar na subida de nível. Para predicado não suportado, falhar de forma explícita no validador.

### C6 · IMPORTANTE: subir de nível não materializa os grants do nível novo e descer não os remove (A3)
- Prova no código: `PlanColumn.svelte` `handleLevelUp` só faz `sendAll(levelUp)`. O heal roda uma vez por actorId (`healedActorId`). `levelSet` não mexe em itens concedidos.
- Dono: satélite, `PlanColumn.svelte` + `planVM.ts` (`levelSet`).
- Conserto: chamar `materializeClassGrants` depois do levelUp e remover os itens com `grantedSlot classFeature:<nv>` acima do nível novo na descida. Resolver junto com o C1.

### C7 · IMPORTANTE: a allowlist esconde 4 subclasses de nv 1 como `archetype-not-imported` (I1 das lentes dado-importer e testes-contratos)
- Confirmado em `grant-resolution-allowlist.mjs:255-290`: Light Mortar Innovation, Way of the Spellshot, Palatine Detective e Battle Creed. São dedicações de arquétipo de classe concedidas no nv 1 e contradizem o cabeçalho do arquivo, que fala em multiclasse. A T5.1 importa só dedicações padrão, então essas entradas talvez nunca fiquem stale.
- Dono: satélite, allowlist + importer.
- Conserto: mudar para a categoria `class-archetype-gap` com issue, ou importar essas 4 dedicações já nesta fatia (são mecanismo de subclasse de nv 1).

### C8 · IMPORTANTE: o core pina um SHA que só existe numa branch de feature do satélite (I3 + I1 da costura-ci)
- Confirmado: 77a31bc só é alcançável por origin/ficha3/onda0, sem tag e sem PR.
- Dono: core (gitlink) + satélite.
- Conserto: ordem de merge #57 → #65 → PR da onda (merge commit) → tag v0.1.2 → re-pin do core no commit tagueado → merge do core.

### Menores
- **C9**: o validador não chama `parseMechanicsGrants`, que a produção usa (`grantMaterializer.ts:541`), então o comentário "EXACT algorithm" é falso. Dono: `grant-resolution-validator.test.ts`. Conserto: incluir a chamada.
- **C10**: a T0.4 roda como teste, não quebra o build do importer. É desvio do tasks.md e precisa de OK do Alexandre, ou então um passo no importer.
- **C11**: faltam traduções pt-BR das 17 classes (classes 12/29). A #58 cobre 15 classes. Atualizar a #58 com Necromancer e Runesmith.
- **C12**: o caso (e) de `classFeatLeakGuard.test.ts` replica a lógica em vez de chamar `isFeatEligible`, então é tautológico. Chamar a função real.
- **C13**: `checkSlotRequirement` (`planVM.ts:2241`) pega o primeiro traço de classe, e Reach Spell no Wizard aparece como WrongClass: Bard. É pré-existente. Precisa de issue.
- **C14**: pregen-parity e actionCategories são pulados no CI (vendor gitignored). Confirmar que a #91 lista os casos pelo nome.

## Refutados (1)
- O diagnóstico da evidência viva ("350/471 grant-item ainda apontando para Compendium.pf2e.* é a causa") está errado. `parseGrantUuid` + `resolveByName` resolvem pelo nome no pack local, e o validador mostra que 314 de 349 resolvem. A causa real do Monk sem Flurry/Powerful Fist é o C1, porque a feature em si não é embutida. A decisão da T0.3 de não converter se sustenta.

## Observação
- Não há UI para criar personagem-jogador (DEC-NPC-02, T6.1). O runbook do gate precisa documentar o caminho de ator pré-existente como procedimento oficial até a O6.
