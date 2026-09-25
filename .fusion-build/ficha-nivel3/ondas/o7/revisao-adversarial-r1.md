# Onda 7 — re-verificação adversarial, rodada 1

Alvo: fix-r1.md + commits `c67730c`, `9cd34b4` (satélite) e `0b188f7b` (core) em `scratchpad/wt-c`.
Veredito: **REPROVADA** — 1 bloqueante e 7 importantes continuam abertos (6 herdados, 1 novo).

## Por achado

| id | status | evidência |
|---|---|---|
| C1 (bloq.) | ABERTO | O fixer não tentou (fix-r1 §"C1, C5, C6, C7"). Nenhum data-dir extraído, nenhum confronto com os prints. |
| C2 | ABERTO | O override só troca a ancestralidade e o antecedente. Herança, dádivas, talento de ancestralidade, escolha de perícia e idioma continuam no automático do harness (primeiro da lista). A sonda (`probe.test.ts` no scratchpad deste revisor) montou Fighter nível 1 com `resolveChassis(molde)` e obteve: mods `{str:3,dex:4,con:2,int:1,wis:0,cha:0}` (o molde diz FOR14/DES12/CON14/INT12/SAB14/CAR10 + boost-chave), **herança nenhuma**, talento de ancestralidade **Adapted Cantrip** (o molde diz Cooperative Nature), idiomas `common,draconic,dwarven` (o molde diz Élfico), **sem Assurance**, perícias `acrobatics,arcana,athletics,crafting,lore-academia`. Com a T7.4 preenchida pelo livro, SAB 0 em vez de +2 faz Vontade divergir e DES +4 em vez de +1 faz Reflexo e CA divergirem: o comparador reprova um app correto. Hoje ele só acerta o chassi no nome. |
| C3 | ABERTO (parcial) | Entraram focus_pool, trained_skills, granted_feats e languages. `proficiencies.attacks/defense` e `spells`/slots ficaram de fora com a justificativa de "formato ambíguo", mas o README-molde.md §"Campos Específicos" já define os dois (`attacks: ["simple","martial"]`, `defense: "trained"`, `circle_N_slots`, listas preparadas e conhecidas), e a T7.1 lista "slots e magias por círculo". O resultado é um falso verde concreto: Wizard nível 3 com `hp` preenchido e `circle_2_slots: 1`, builder devolvendo 0 slots de 2º círculo → célula `compared: true`, `divergences: []`. É corte de escopo da tarefa. |
| C4 | ABERTO | Os atributos agora são legais (conta conferida: FOR 10+2+2, DES +2, CON +2+2, INT +2, SAB +2+2; boosts distintos em cada grupo). Mas o chassi continua ilegal pela regra e pelo próprio pack em três pontos: (a) **Scholar** não treina Sociedade. O pack (`backgrounds-core` Scholar, `unconvertedRules` ChoiceSet) oferece Arcana/Natureza/Ocultismo/Religião + Erudição Acadêmica, e a regra concede **Assurance** (GrantItem no pack), que o molde omite. (b) **Idiomas**: Humano recebe 1 + mod. de INT (`additionalLanguages.count: 1` no pack; `ancestryAdditionalLanguagesCount` em character.ts soma esse 1 aos slots de INT). Com INT +1 são 2 idiomas extras, não 1, e nas classes de chave INT (Wizard, Investigator, Inventor, Witch…) são 3. Uma lista única "Comum + Élfico" para as 29 classes é ilegal. (c) **Skilled Human** (Humano Habilidoso) dá treinado + Expert no nível 5 (regra do pack: `ternary(gte(@actor.level,5),2,1)`), **não** talento de perícia geral (esse é o Versatile Human). Menor: Cooperative Nature dá +4, não +2. |
| C5 | ABERTO | Não tentado. As legendas e o HTML seguem afirmando o aceite contra o molde. |
| C6 | ABERTO | `ficha-nivel3.spec.ts` continua só em `wt-c/.claude/skills/tutorial-e2e/roteiros/`. O repo principal não tem o arquivo (conferido com `ls`). A justificativa do fixer (não escrever na árvore compartilhada) é legítima. O fecho da onda tem que fazer a cópia antes de remover a wt-c. |
| C7 | ABERTO | Não tentado. |
| C8 | **FECHADO** | `stepCharSaves`/`stepCharPerception` anexam o `rank` usado no `base`, e o VM prefere o rank derivado. Os testes novos do VM montam rank persistido 0 com derivado 2/1 e esperam "E"/"T": falhariam na versão anterior, que lia `savesSource.rank`. Verde: `characterSheetVM.test.ts` + `character-comparator.test.ts` (262), `systems/pf2e derivations.test.ts` (79). Consumidores do shape derivado no core também verdes: `derive-wiring`, `combat-unit`, `npc-import-initiative` (42). |

## Novo

- **N1 (importante): a comparação de listas confronta o slug do app com o nome do livro e gera falsa divergência.** `trainedSkillSlugs`/`languageSlugs` devolvem slugs (`lore-academia`, `common`), enquanto `sameStringSet` só aplica lower+trim. O README manda escrever "nomes exatos" (`["Athletics", "Perception"]`) e o próprio chassi usa `"Common (Comum)"` e `"Academia Lore (Erudição Acadêmica)"`. Cenário: a T7.4 copia `languages: ["Common (Comum)","Elvish (Élfico)"]` ou `trained_skills: ["Academia Lore"]` → divergência com o app correto. "Perception" nem existe em `derived.skills`. Conserto: normalizar dos dois lados (nome do livro → slug, descartando o parêntese pt-BR) e cobrir com teste de nome vs. slug.

## Menores (não bloqueiam)

- `c67730c` sozinho não typecheca (o `rank?` só entra em `9cd34b4`): quebra o `git bisect`. Squash no merge resolve.
- `resolveChassis` volta a Ratfolk/Aeronaut sem avisar quando o nome não bate no pack.

## Hipóteses refutadas

- O campo `rank` novo em `DerivedStatistic` quebraria deep-equal de consumidores no core: refutado (42 testes do server verdes).
- C8 regrediria a derivação: refutado (79 verdes).

Nada foi editado na wt-c. Sonda em `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/f93e1369-2b29-4884-8a39-cf076bcda837/scratchpad/probe.test.ts`.
