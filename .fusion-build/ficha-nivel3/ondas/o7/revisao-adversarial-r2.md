# Revisão adversarial da Onda 7, rodada 2

Alvo: `fix-r2.md` mais os commits do fixer na wt-c. No core: `6c36e6de`, `623dbbf2` e `676e69df`. No satélite: `3335f2a` e `a198986`.
Nada foi editado. Rodei só `character-comparator.test.ts` (33/33). Li o diff dos dois repos, os dois `ator-*-persistido.json`, o roteiro `ficha-nivel3.spec.ts` (só existe na wt-c) e os prints embutidos no `roteiro-e2e-ficha-nivel3.html`, extraídos como p14, p28, p46 e p47. Conferi o pack `classes-core`/`ancestries-core`.

**Veredito: REPROVADA.** Ficou 1 bloqueante novo e 5 importantes abertos.

## Por achado

| id | status | por quê |
|---|---|---|
| C1 | **ABERTO** (rebaixado a importante) | O ator agora é extraído do world.db, e isso é bom. Mas `resumoChassiAplicado` captura `abilityChoices` e **nunca o compara**. A dádiva de classe só é checada com `length > 0`. Nada confronta hp, ranks ou slots dos níveis 2/3 com os prints. Consequência concreta: o `ator-gm-persistido.json` tem `classBoost: ["str"]` num **Bardo** (chave CHA), e o confronto disse "bate com o chassi". |
| C2 | FECHADO | O `ChassisOverride` leva herança, boosts por grupo, talento e idiomas. A §6 do teste constrói o Fighter pelo `resolveChassis` real e confere os mods de CON, SAB, INT e CAR, a herança Skilled Human e Cooperative Nature. A escolha de perícia de Scholar e de Skilled Human ficou como pendência, porque o `ChoiceSet` é unsupported e não tem slot no app. Aceito. |
| C3 | FECHADO | `proficiencies.attacks`/`defense` e `spells.circle_N_slots` passam a ser comparados via `spellSlotsForLevel`. O teste do Wizard nível 3 com `circle_2_slots=1` diverge (o pack dá 3/2, que é o RAW: rank novo começa com 2 slots). Os nomes de magia são escolha do jogador, não regra; adiá-los com issue é aceitável. |
| N1 | FECHADO | `bookNameToSlug` usa `loreSlug`, tira o parêntese pt-BR e filtra Perception nos dois lados. Os testes da §8 reproduzem o falso divergente. |
| C4 | **ABERTO** (parcial) | Scholar, Skilled Human, Cooperative Nature +4 e "1 + mod INT" ficaram corretos. A regra de idioma por classe de chave INT, porém, lista 4 classes: Wizard, Investigator, Inventor e Witch. O pack tem **8**: faltam Alchemist, Commander, Necromancer e Runesmith. Além disso, o `resolveChassis` **ignora** `list_classes_chave_int` e sempre usa `list` (3 idiomas). Na T7.4, um Alchemist preenchido pelo README fica com 2 idiomas extras quando o RAW dá 3. Num Wizard, o 3º idioma cai no primeiro candidato em vez de Draconic, e isso gera uma falsa divergência. |
| C5 | **ABERTO** | Três problemas. (a) O roteiro marca "a primeira opção" da Dádiva de Classe. Para classe com chave única, o app oferece os 6 atributos (`classKeyAbilityOptions`), então o Bardo ficou com FOR 16 e CAR 10 (print p14). A legenda diz "Dádivas do chassi marcadas... inclusive a dádiva de classe", e o molde manda o boost ir para a habilidade-chave. (b) O print p28 "Ficha completa nível 3 — estado final para conferir contra o molde" mostra **Talento de Classe e Talento de Perícia do nível 2 vazios**. O ledger só tem `archetypeFeat-2`, e o nível 3 não tem talento geral nem aumento de perícia. (c) Diplomacia e Arcana saem do pool genérico da classe (o Bardo fica 5/5), o que esconde que herança e antecedente não concedem perícia no app, e a legenda afirma "Diplomacia da Skilled Human". |
| C6 | **ABERTO** | O próprio fixer declarou que não consertou. O arquivo continua só na wt-c: não existe `ficha-nivel3*` em `C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/`. O conserto é o `cp` do fix-r2.md no fecho da onda, antes de remover a wt-c. |
| C7 | **ABERTO** | O teste do player existe, mas no print p46 o Monk do Tobias está com o **Talento de Classe do nível 1 vazio** (o Monk ganha talento de classe no nível 1). Tobias sobe para 2 e 3 sem preencher slot nenhum: o ledger termina no nível 1 e não há talento de nível 2. O print final p47, "Ficha do Tobias completa até o nível 3", é **a tela do Mestre com o Bardo**, porque o `passo` foi chamado sem `"player"`. O confronto do player não chama `registraFalha`, então uma divergência passaria em silêncio. |

## Achado novo

### N2: bloqueante. O molde absorve um defeito do pack e torna o aceite circular

`character-templates.json` e `README-molde.md` (`6c36e6de`) põem um 3º boost de ancestralidade em DES e fixam **DES 14**, porque `ancestries-core` Human tem `boosts: ["free","free","free"]`. Conferi: Dwarf, Elf e outras ancestralidades têm 2 boosts fixos mais 1 livre, mas o Human do livro tem **2 livres**. O `source_of_truth` do molde diz "Player Core Remaster". O RAW dá DES 12.

- Cenário: com o chassi em DES 14, toda célula da T7.4 derivada de DES sai 1 ponto acima do RAW (CA, Reflexos, perícias de DES e ataque à distância) nas 29 classes. O comparador e o confronto do e2e dão verde **porque** o app tem o mesmo defeito. É o padrão da #48 (teste circular).
- O teste da §6 fixa `ancestryFree: ["str","con","dex"]`, o que consolida o defeito como esperado.
- Conserto: devolver o chassi ao RAW (2 boosts de ancestralidade, DES 12) e tirar DES do grupo `ancestryFree` no roteiro. O comparador deve acusar a divergência (o 3º boost do app cai no fallback), ou o pack deve ser corrigido primeiro (issue já redigida no fix-r2 §Pendências 1). A pendência não pode morar no valor esperado.

## Regressões no diff do conserto

Não encontrei nenhuma em consumidores existentes: sem `chassis`, o harness continua igual, e há teste disso.
