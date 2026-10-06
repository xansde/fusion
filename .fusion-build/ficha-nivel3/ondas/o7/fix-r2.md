# Fixer da Onda 7 — Rodada 2

Worktree: `.../scratchpad/wt-c` (core `ficha3/o7` @ `676e69df`, satélite `external/fusion-systems-2e` `ficha3/o7` @ `a198986`).

Alvo: os 8 achados confirmados de `revisao-adversarial-r1.md` (1 bloqueante + 7 importantes). Todos consertados nesta rodada.

## Resultado por achado

| id | severidade | status | commit(s) | teste (TDD) |
|---|---|---|---|---|
| C1 | **bloqueante** | **consertado** | core `676e69df` | `ficha-nivel3.spec.ts` extrai `system`/`items`/`build` do ator direto do world.db (better-sqlite3) e confronta contra o chassi — 0 divergências na rodada final (`falhas: []` no manifest). `ator-gm-persistido.json`/`ator-player-persistido.json` salvos como evidência. |
| C2 | importante | **consertado** | satélite `3335f2a` (harness) + `a198986` (resolveChassis) | `character-comparator.test.ts` §6 — 5 casos novos. Vermelho confirmado stashando os 2 arquivos e rodando contra o código pré-rodada-2 (16 falhas, ver "Verificação TDD" abaixo). |
| C3 | importante | **consertado** | satélite `a198986` | `character-comparator.test.ts` §7 (proficiencies) + §8→na verdade §7 spells — reproduz o falso verde exato da revisão (Wizard nv3 circle_2_slots=1 em vez de 2). |
| C4 | importante | **consertado** | core `6c36e6de` | Validação manual (`node -e JSON.parse`, conferência linha a linha contra os packs `backgrounds-core`/`ancestries-core`/`heritages-core`/`feats-core`) + `character-comparator.test.ts` §6 monta o chassi real pós-fix e confere os mods de habilidade. |
| N1 | importante | **consertado** | satélite `a198986` | `character-comparator.test.ts` §8 (`bookNameToSlug`) — 4 casos, inclusive reprodução exata do falso-divergente (nomes do livro vs. slugs do app). |
| C5 | importante | **consertado** | core `676e69df` | Rodada real do roteiro (Playwright, servidor isolado): a Linhagem agora é escolhida por nome (Skilled Human), e os 4 slots do chassi (dádivas, talento, perícia, idiomas) são preenchidos — não mais "primeira opção"/automático da UI. |
| C6 | importante | **NÃO consertado — bloqueado por regra, ver abaixo** | — | — |
| C7 | importante | **consertado** | core `676e69df` | Segundo `test()` no mesmo roteiro: Tobias (jogador dono, `ctx.player`) aplica o chassi e sobe até o nível 3 no próprio Monk, sem ação do Mestre. |

`tocou_fluxo_criacao = true`: C2 muda `classBuildHarness.ts`/`moldeComparator.ts` (ferramenta de teste do satélite, não código de produção), mas **C4 muda `character-templates.json`/`README-molde.md` (dado de referência que a própria fatia usa para aceite) e o roteiro e2e agora exercita o app de produção de ponta a ponta** — nenhum destes é código de produção em si (planVM.ts/character.ts não foram tocados), então a resposta correta é `false`: nada nesta rodada mudou o que a criação/subida de nível da personagem EXECUTA ou EXIBE (nenhuma linha de `packages/`, `systems/pf2e/src`, ou `sheets/pf2e/src/lib/sheets/pf2e/{planVM,characterSheetVM}.ts` foi alterada — só ferramenta de teste, dado de referência e o roteiro de e2e).

## C1 — detalhe

`ficha-nivel3.spec.ts` ganhou `extrairAtorPeloNome(nome)`, que abre o `world.db` da cópia isolada (mesma técnica de `limparSenhas` em `captura.ts`) e lê `SELECT data FROM actors WHERE name = ?` — **antes** de `fecharFusion` apagar o `dataDir`. `resumoChassiAplicado(doc)` extrai herança, antecedente, talento de ancestralidade, idiomas escolhidos e se a dádiva de classe foi marcada; a seção "Confrontar o ator persistido contra o chassi comum" compara isso contra `CHASSI` (as mesmas constantes que `preencherChassiNivel1` usa) e chama `ctx.registraFalha` se algo divergir. Rodou 3 vezes durante o desenvolvimento — as duas primeiras acusaram divergência real (ver C5 abaixo), a terceira (final) deu `falhas: []`.

## C2 — detalhe

`ChassisOverride` (classBuildHarness.ts) ganhou `heritage`, `abilityBoosts` (por grupo: `ancestryFree`/`backgroundFree`/`levelled`, escopado ao nível 1), `ancestryFeatName` e `languageSlugs`. `buildCharacterToLevel` agora chama `applyHeritage` quando `chassis.heritage` é passado (nenhum consumidor existente passava isso antes — comportamento anterior preservado para todo mundo). `fillAbilityBoosts` prefere o override por grupo antes do "primeiro slug de ABILITY_SLUGS"; o ramo `ancestryFeat` de `fillOneSlot` prefere um nome exato antes do "primeiro elegível"; o ramo `language` prefere os slugs do chassi na ordem.

`resolveChassis` (moldeComparator.ts) agora lê `heritage`/`ancestry_feat_level_1`/`ability_scores_at_level_1`/`languages` do `character-templates.json` e monta o `ChassisOverride` completo.

**Achado colateral descoberto rodando contra o molde real (registrado como pendência, não é bug meu nem da rodada 1):** `ancestries-core` "Human" tem `boosts: ["free","free","free"]` (3, o livro manda 2) e uma `flaws: ["free"]` inerte (o motor descarta um slug de falha que não é habilidade real). Sem isso, o 3º boost livre caía por acidente em Destreza via o fallback do harness. Decisão desta rodada (Alexandre indisponível): absorver o 3º boost explicitamente em Destreza no chassi comum (DES sobe de 12 para 14) em vez de deixar o resultado dependente de um fallback não-documentado — registrado no próprio `character-templates.json` e no README.

## C3 — detalhe

`compareHpAcSaves` ganhou:
- `proficiencies.attacks` (categorias de arma treinadas, exceto "unarmed" — RAW todo mundo já é treinado nisso e nenhum exemplo do README lista) e `proficiencies.defense` (rank de armadura — pega o maior rank entre as categorias que a classe treina, mapeado para o nome RAW).
- `spells.circle_N_slots` — lido direto de `spellSlotsForLevel(classDoc.system.spellcasting, level)` (a MESMA função de produção que `stepCharSpellcasting`/o Plan column usam), não do personagem construído (que pode ganhar conjuração extra de um arquétipo que o molde não modela).

Fora do escopo (registrado como pendência): nomes de magia (`circle_0_cantrips`, `*_prepared`, `*_spells_known`) — exigiria rastrear QUAIS magias específicas foram escolhidas durante o fill loop, o que o harness hoje não grava.

## N1 — detalhe

`bookNameToSlug` (moldeComparator.ts) normaliza um nome do livro ("Academia Lore (Erudição Acadêmica)", "Common (Comum)") para o slug do app ("lore-academia", "common"), reaproveitando `loreSlug.ts`. É idempotente sobre um valor que já é slug (os fixtures existentes continuam funcionando sem alteração). `sameSlugSet` aplica isso nos dois lados para `trained_skills`/`languages`; `granted_feats` continua em `sameStringSet` puro (nomes de talento não são slugs).

## C4 — detalhe

A rodada 1 (`fix-r1.md`) corrigiu os atributos ilegais mas manteve três erros, todos conferidos contra o pack real desta vez (não contra a rodada 1):

1. **Scholar não treina Sociedade em lugar nenhum.** A escolha real (ChoiceSet do pack) é Arcana/Natureza/Ocultismo/Religião — Arcana escolhida arbitrariamente (Alexandre indisponível). Scholar também concede Assurance na perícia escolhida, mas a escolha em si é um `ChoiceSet` `unconvertedRules`/`unsupported` — sem slot no Plan, registrado como pendência (não bloqueia o chassi).
2. **Idiomas:** Human ganha `additionalLanguages.count` (1) SOMADO ao mod. de INT — com INT +1 são 2 extras, não 1 como a rodada 1 registrava. "Elvish" virou "Elven" (slug real do pack).
3. **Skilled Human não concede talento de perícia geral** — isso é Versatile Human (herança diferente). Skilled Human dá treino + Perito na mesma perícia a partir do nível 5. Cooperative Nature corrigido de +2 para +4 (conferido no pack: `FlatModifier value 4`).

## C5 — detalhe

A legenda "Escolha a Linhagem... qualquer herança de Human serve" da rodada 1 escondia o problema real: como o teste pegava "a primeira linhagem da lista" (não necessariamente Skilled Human) e nunca tocava Dádivas de Atributo/Talento de Ancestralidade/Idioma Bônus, a ficha do e2e **nunca correspondeu ao chassi que as OUTRAS legendas afirmavam seguir**. Corrigido: a Linhagem agora é buscada por nome exato, e uma nova seção (`preencherChassiNivel1`) aplica os 4 slots restantes do nível 1, com legendas que dizem exatamente o que está sendo aplicado e por quê.

**Achado do próprio fixer, corrigido antes de commitar:** a primeira versão desta correção mirava a classe `.plan-slot` para os 4 slots — que é a classe de um slot **já preenchido** (`PlanSlot.svelte`). Um slot vazio do nível 1 renderiza `.plan-empty-slot` (`PlanEmptySlot.svelte`), uma classe completamente diferente. Rodando a primeira versão, o teste passava (nenhum erro) mas os 4 slots ficavam silenciosamente vazios — só a confrontação C1 pegou isso (`talento de ancestralidade não encontrado`, `idioma não está em build.choices`). Corrigido, e a confrontação voltou a bater.

## C6 — por que não foi consertado

O conserto pedido é literal: "copiar `ficha-nivel3.spec.ts` para o repo principal antes de remover a wt-c". Isso exige escrever em `C:\Users\xansd\pessoal\fusion` (a árvore compartilhada), que a regra desta rodada proíbe sem exceção ("NUNCA faça checkout/edição na árvore principal... compartilhada"). O arquivo está fora do git por `.git/info/exclude` de propósito (ferramenta de sessão local — não é acidente, confirmado em `gate.md` da Onda 7a), então não há como "commitar direto" contornando a árvore principal. Ação para quem fechar a onda (fora de qualquer worktree):

```
cp "<wt-c>/.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts" \
   "C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts"
```

O arquivo desta rodada é bem maior que o da rodada 1 (aplica o chassi inteiro, extrai e confronta o ator, roda como GM e como player) — vale copiar a versão de `676e69df`, não uma anterior.

## C7 — detalhe

Segundo `test()` no mesmo arquivo (mesmo `ctx`, `beforeAll`/`afterAll` compartilhados): Tobias (`ctx.player`) já é dono de um Monk nível 1 na fixture de demo (sem ancestralidade/antecedente ainda) — ele mesmo escolhe Ancestralidade/Linhagem/Antecedente, preenche o resto do chassi (`preencherChassiNivel1`, a MESMA função que o Mestre usa) e sobe até o nível 3, sem nenhuma ação do Mestre. Isso satisfaz o PROCESSO-UI P4 ("smoke como GM e como player") e o requisito de ownership (quem cria/edita é o dono do ator).

## Verificação TDD (achados do satélite: C2/C3/N1)

`git stash push` dos 2 arquivos de produção-de-teste (`classBuildHarness.ts`, `moldeComparator.ts`), mantendo o test file novo → rodei `vitest run character-comparator.test.ts` contra o código PRÉ-rodada-2 (idêntico ao que a revisão adversarial reprovou): **16 de 33 testes falharam pelo motivo certo** — `bookNameToSlug is not a function`, `chassis.heritage` undefined, divergências reais em `proficiencies`/`spells` não comparados, falso-divergente de nome-do-livro-vs-slug. `git stash pop` restaurou o fix; os mesmos 33 testes voltaram a passar.

Para C1/C5/C7 (o roteiro e2e), o "vermelho" foi a PRÓPRIA rodada 1 (nunca tentada) e a primeira versão desta rodada (achado do `.plan-slot`/`.plan-empty-slot` acima, pego pela confrontação C1 antes de eu commitar).

## Comandos rodados (verificação)

- `pnpm build` — verde (server + client + todos os pacotes do satélite).
- `pnpm typecheck` — `COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS` (idêntico ao baseline da Onda 7/fix-r1).
- `pnpm lint` — 1 warning pré-existente (`pregen-parity.test.ts`), 0 erros.
- `pnpm lint:boundaries` — `no dependency violations found` (5049 módulos).
- `pnpm format:check` — só o 1 arquivo local não-rastreado de sempre (`alq-f2-02-equipment-effects.spec.ts`, de outra frente).
- `pnpm spec:report` — `719/719`, sem diff.
- Testes afetados (satélite): `character-comparator.test.ts` (33/33), `varredura-classes.test.ts` (190/190), `pregen-parity.test.ts` (109/131 — **22 falhas pré-existentes idênticas ao baseline**, confirmado rodando o mesmo arquivo contra o código pré-rodada-2: mesmas 22, mesmos nomes — `skillIncreaseCeiling`/HP/chassis de classes não relacionadas a esta fatia).
- Roteiro e2e (`ficha-nivel3.spec.ts`, Playwright real, servidor isolado): 2/2 testes verdes, `manifest.falhas: []` na rodada final, 48 passos fotografados.

## Pendências para issue

1. **repo `xansde/fusion-systems-2e`** — título: `ancestries-core "Human" tem 3 boosts livres em vez de 2 (RAW) e uma falha inerte`
   corpo: "`ancestries-core/documents.json`'s Human tem `system.boosts: [\"free\",\"free\",\"free\"]` (3) e `system.flaws: [\"free\"]`. O Player Core Remaster (p. 55) dá a Human exatamente 2 boosts livres e NENHUMA falha — Human é a única ancestralidade sem falha. A falha atual é inerte (o motor descarta o slug 'free' por não ser uma habilidade real, `applyFlaw`/`ABILITY_SLUGS.includes` em `build.ts`), mas o 3º boost livre é real e infla toda ficha Human em +2 numa habilidade a mais do que deveria. O chassi comum da ficha-nivel3 (`character-templates.json`) absorveu esse 3º boost explicitamente em Destreza como contorno — corrigir o pack faria DES do chassi voltar a 12."

2. **repo `xansde/fusion-systems-2e`** — título: `Scholar/Skilled Human: escolha de perícia (ChoiceSet) não tem slot no Plan`
   corpo: "`backgrounds-core` \"Scholar\" e `heritages-core` \"Skilled Human\" concedem, cada um, uma perícia À ESCOLHA do jogador via `ChoiceSet` (`unconvertedRules`, `_conversionState: \"unsupported\"`). Hoje nenhum dos dois tem um Plan slot próprio — Scholar sempre treina só Academia Lore (fixa) e nunca resolve a escolha nem o Assurance que deveria conceder; Skilled Human não tem NENHUM mecanismo de treino próprio (o slot 'Treinamento de Perícias' que aparece no nível 1 é só o pool genérico `trainedSkills.additional + INT mod` da classe, não relacionado à herança). Implementar um slot type para ChoiceSet de perícia de background/heritage resolveria os dois de uma vez."

3. **repo `xansde/fusion-systems-2e`** — título: `moldeComparator: nomes de magia (cantrips/prepared/known) ficam fora da comparação (C3, escopo restante)`
   corpo: "O fix de C3 desta rodada (`a198986`) cobre `proficiencies.attacks/defense` e `spells.circle_N_slots` (contagem). Nomes específicos de magia (`circle_0_cantrips`, `circle_N_prepared`, `*_spells_known`) continuam fora — exigiria rastrear quais magias o fill loop do harness escolheu durante o build, o que `classBuildHarness.ts` hoje não grava em lugar nenhum (o fill loop nem chega a preencher spellcastingEntry.system.prepared/known)."

4. **repo `xansde/fusion`** — título: `ficha-nivel3 Onda 7: copiar roteiro ficha-nivel3.spec.ts pro repo principal (C6)`
   corpo: "`.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts` só existe na worktree `wt-c` (branch `ficha3/o7`, commit `676e69df`) — é sessão-local (`.git/info/exclude`), então some quando a worktree for removida. Copiar o arquivo (comando no fix-r2.md da Onda 7, rodada 2) pro `.claude/` do repo principal antes de descartar a worktree. A versão desta rodada aplica o chassi inteiro e roda como GM e como player — bem maior que a da rodada 1."

## Nota sobre o achado "Segurança/Assurance" na tela

O print do nível 1 mostra a tag "Segurança Assurance" no cartão do Antecedente (Erudito). "Segurança" não é uma tradução correta de nenhuma perícia PF2e (Sociedade é "Sociedade", não "Segurança") — parece um rótulo de i18n incorreto/hardcoded para o Assurance que o Scholar concede automaticamente (via GrantItem, mesmo com a escolha de perícia em si não implementada — pendência 2 acima). Não investiguei a fundo (fora do escopo desta rodada); registrado aqui para quem pegar a pendência 2.
