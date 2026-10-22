# Revisão adversarial — Onda 7 — lente DADO + IMPORTADOR + INTEGRIDADE

## Escopo real do diff integrado
- Satélite `origin/main...ficha3/o7`: **vazio** (ficha3/o7 == origin/main b5990b9; T7.1/T7.2 já entraram pelo PR #150 da 7a).
- Core `origin/alfa/app...ficha3/o7`: 1 arquivo, `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (2,7 MB, 23 prints).
- **Nenhum pack, importador ou validador de pack foi tocado nesta onda** — nada a julgar em tradução, curadoria, ids, sourceId ou idempotência de regeneração. Pin do submodule = b5990b9 (não é achado).
- Como a entrega da onda é o aceite não-circular, revisei também o molde (core, `docs/design/ficha-nivel3/molde/`) e o comparador (satélite, `sheets/pf2e/src/lib/sheets/pf2e/__tests__/{character-comparator.test.ts,helpers/moldeComparator.ts}`) pela pergunta "o validador falha de verdade em produção?".

## Achados

### A1 — importante — comparador ignora o chassi do molde e monta Ratfolk/Aeronaut
`moldeComparator.ts:135` chama `buildCharacterToLevel`, que fixa `applyAncestry(RATFOLK)` + `applyBackground(AERONAUT)` e boosts automáticos (`classBuildHarness.ts:648-649`). `walkMolde`/`compareHpAcSaves` nunca leem `metadata.chassis_common` (Human/Scholar, atributos). O comentário em `moldeComparator.ts:31-34` diz que "funciona no momento em que o T7.4 travar o chassi" — nada no código lê o chassi.
Cenário: Alexandre preenche Bard L1 com o chassi do molde (Human 8 + Bard 8 + Con) → hp=18; o comparador compara contra um Ratfolk (6 HP de ancestralidade) com boosts do harness → divergência em hp/ac/saves em praticamente todas as 87 células. O gate "divergência zero" fica inalcançável, e cada vermelho é artefato do harness, não defeito do produto (ou pior: coincidência numérica dá verde falso).

### A2 — importante — comparador só confronta hp/ac/saves; o resto do molde nunca é comparado
`moldeComparator.ts:116-122` lista só hp, ac e as 3 saves. O molde (T7.1) e a própria tarefa exigem proficiências, perícias treinadas, talentos concedidos, slots/magias por círculo, foco e idiomas (`character-templates.json`, campos `proficiencies`, `trained_skills`, `granted_feats`, `focus_pool`, `spells.circle_*`, `languages`).
Cenário: Alexandre preenche Bard L1 hp=18 e `circle_1_slots=2`; o produto entrega 3 slots → a célula conta como `compared:true` com zero divergências (verde falso, exatamente a lição #48). Se preencher só `spells`, a célula vira "pendente — hp/ac/saves seguem null". Corta o escopo de T7.2 ("confronta com o molde preenchido").

### A3 — importante — chassi proposto do molde é ilegal e incompleto
`character-templates.json` → `metadata.chassis_common.ability_scores_at_level_1`: INT 13 e CHA 11 são inalcançáveis em PF2e (boosts sempre +2 a partir de 10; no Remaster nem existem scores, só modificadores). O README-molde.md ("Ordem de execução", passo 1) oferece "aceitar a proposta". Além disso o molde **não tem heritage**, nem a escolha de perícia do Scholar, nem perícias de classe, nem talento de ancestralidade — e o próprio molde exige `trained_skills`/`granted_feats`/`languages`.
Cenário: RAW, Skilled Human dá uma perícia treinada extra e Versatile Human um talento geral; duas pessoas preenchendo "Human/Scholar" chegam a `trained_skills`/`granted_feats` diferentes, e o builder não tem como reproduzir uma ficha que o molde não determina. O roteiro reforça o erro: `ficha-nivel3.spec.ts:115` + passo 09 do HTML afirmam "qualquer herança de Human serve — o dado não varia por linhagem", e pegam `.picker-row.first()`.

### A4 — importante — o e2e não serve ao gate da onda e não sobrevive à worktree
(a) `ficha-nivel3.spec.ts` existe só em `.../scratchpad/wt-c/.claude/skills/tutorial-e2e/roteiros/` (temp, não versionado, **não copiado** para `~/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/`, onde vivem os outros roteiros). Limpou a worktree → o T7.4 ("executar o e2e", dono Alexandre) não tem roteiro para rodar.
(b) O roteiro não tem nenhum `expect` e deixa abertos os slots de dádivas de atributo, perícias, talento de ancestralidade e idioma. Os prints mostram HP 16/24/32 (Con +0) e CA 13/14/15 (Des +0) — uma ficha que não é a de chassi nenhum do molde (Con 14 daria 18 no L1). Os passos 14 e 20 dizem "conferir aqui contra o molde fecha o aceite" — com a ficha incompleta, a comparação sempre diverge. O "Tudo condiz com o esperado" do relatório T7.3 é raciocínio, não conferência.

### A5 — menor — o HTML afirma um comportamento que o próprio roteiro refuta
Passo 07 do HTML (`ficha-nivel3.spec.ts:98`): "O Actor em branco aparece em 'Na mesa' assim que o usuário é criado". O mesmo roteiro precisa de `gm.reload()` (linha 90) porque isso NÃO acontece (issue #254). Quem ler o tutorial como documentação aprende o contrário do que o app faz.

### A6 — menor — "nenhuma de multiclasse deve aparecer" não é verificado
Passo 17: o roteiro digita "Dedication" e clica na primeira linha; nada confere que as 29 dedicações de multiclasse (fora por decisão do plano) estão ausentes do picker. Se a Onda 5 regredir, o e2e continua "1 passed".

## Não são achados
- Pin do core em b5990b9 (commit do satélite já em main).
- Multiclasse fora do Arquétipo Livre: decisão do plano (plano.md:20), coerente com o recorte.
- `describe.skipIf(!MOLDE_AVAILABLE)` no satélite: o CI standalone monta o core aedda2c2, que não tem o molde, então os blocos 1-2 pulam lá; o bloco 3 (meta-teste) roda sempre, e no mount real (submodule) o molde existe. Aceitável.
