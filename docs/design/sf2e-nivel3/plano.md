# Fatia 2 — Criar ficha de Starfinder 2e até o nível 3

**Data:** 2026-09-24
**Pedido do Alexandre:** levar o Starfinder 2e ao mesmo ponto da Fatia 1 do PF2e: criar
personagem de **qualquer classe**, do nível 1 ao 3. As classes em playtest também entram, porque
são a parte que ele mais quer testar.

## Escopo (decisões de 24/09)

- **DENTRO:**
  - **As 9 classes:** as 6 do Player Core (Envoy, Mystic, Operative, Solarian, Soldier,
    Witchwarper) mais as 3 de playtest (Mechanic, Technomancer, Luminary).
  - **Ancestralidades e antecedentes só do Player Core:** 10 ancestralidades e 34 antecedentes,
    com as heranças dessas ancestralidades e as 2 heranças versáteis (Borai e Prismeni).
  - **Talentos até o nível 3:** de ancestralidade, classe, perícia e gerais.
  - **Características de classe dos níveis 1 a 3.**
  - **Magias:** truques e magias até o rank 2, e as magias de foco que as classes ganham até o
    nível 3.
  - **Itens:** só quando a classe os concede, como a arma solar do Solarian.
- **FORA:** arquétipos, itens de compra, créditos, equipamento inicial, nível 4 ou mais, combate e
  dano em alvo (issue #83 do satélite).
- **Idioma:** **inglês primeiro**. A tradução passa por uma revisão completa depois (satélite
  #168), porque o Alexandre não está satisfeito com a tradução atual.
- **Playtest:** Mechanic e Technomancer entram **pelo PDF do playtest agora**. Quando o Tech Core
  sair (07/10/2026), atualizamos para a versão final. O Luminary só tem playtest (o livro ainda não
  foi anunciado).

## Estado verificado (levantamento de 24/09)

Os relatórios estão em `.fusion-build/sf2e-nivel3/`: `inventario-repo.md`, `conteudo-fonte.md` e
`recorte-player-core.md`, com a correção das classes e das licenças na §8.

| Peça                                       | Estado                                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonte dos dados                            | `foundryvtt/pf2e`, branch `v14-dev`, pasta `packs/sf2e/*`. O schema é o mesmo do PF2e e o importador já aceita `--system sf2e`.                                                                |
| Cópia local da fonte (vendor)              | **Defasada:** tem 48 ancestralidades e 285 heranças; a fonte tem 57 e 325.                                                                                                                     |
| Packs SF2e no pin atual                    | 6 packs com 63 documentos (armas, armaduras, aprimoramentos, bestiário, magias, condições). Nenhum dado de classe, ancestralidade, herança, antecedente ou talento.                            |
| Classes, características, talentos e ações | PR #60 do satélite, aberto: a branch está 91 commits atrás de `main`.                                                                                                                          |
| Ancestralidade, herança e antecedente      | Nada, nem PR.                                                                                                                                                                                  |
| Progressão de classe (issue #64)           | O `ClassSystemSchema` do SF2e tem 4 dos 17 campos do PF2e. Faltam `featuresByLevel`, `featLevels`, `skillIncreaseLevels`, `trainedSkills`, `proficiencyUpgrades`, `spellcasting` e outros.     |
| Motor de regras                            | Roda só 44% das regras do recorte (flat-modifier, roll-option, note). Ficam mudas: `set-property`/ItemAlteration (113), `grant-item` (46), `proficiency` (5), `strike` (2) e `base-speed` (1). |
| Ficha                                      | `sheets/sf2e` não existe. Na ficha PF2e, a lista de perícias (`CANONICAL_SKILL_SLUGS`), as 4 tradições e a moeda estão fixas no código.                                                        |
| Perícias                                   | São as 16 do PF2e mais Computers (INT) e Piloting (DEX): 18 no total. Confirmado no `config/index.ts` da fonte.                                                                                |
| Classes de playtest                        | Mechanic e Technomancer (PZO22006, 2025, 34 páginas) e Luminary (PZO22010, 2026, 17 páginas). Os dois PDFs trazem o aviso de licença **ORC** e não há dado estruturado aberto.                 |
| Spec dona                                  | `specs/18-sistema-sf2e.md`, classificada como [V2] e sem as classes de playtest.                                                                                                               |

## Plano em ondas

Cada onda termina com **efeito visível na ficha**, não com "dado importado" (lição da Onda 4b da
Fatia 1). Os testes são **não-circulares**: a asserção vem da regra do livro (por exemplo, "Soldier
nível 1 tem Fortitude expert"), nunca da tabela do próprio pack.

### Onda 0: fundação de dados (satélite)

- **T0.1** Atualizar o vendor para a `v14-dev` atual e registrar o commit usado.
- **T0.2** Rebasear o PR #60 sobre `main`, regerar os 4 packs com o vendor novo e mergear.
- **T0.3** Filtrar o recorte do Player Core por script (`system.publication.title` e nível),
  fechando as contagens pendentes: heranças das 10 ancestralidades, talentos de ancestralidade até
  o nível 3, características por nível das 6 classes e magias de foco até o nível 3.
- **T0.4** Importar os packs novos em inglês: `ancestries`, `heritages`, `ancestry-features`,
  `backgrounds`, os talentos de perícia e gerais até o nível 3, e completar as magias até o rank 2. Os itens concedidos pelas classes seguem as referências dos `grant-item`.
- **T0.5** Emendar a spec 18: tirar o recorte da ficha até o nível 3 de [V2], registrar as
  classes de playtest (fonte PDF ORC, marcadas `playtest`) e a regra de atualizar quando o livro
  final sair.

### Onda 1: progressão de classe (issue #64)

- **T1.1** Completar o `ClassSystemSchema` do SF2e com os campos de progressão.
- **T1.2** A derivação de personagem (`build`) passa a ler a progressão, **reusando o engine-2e**
  (ver a decisão D1).
- **T1.3** Curar as 6 classes do Player Core até o nível 3: características por nível, slots de
  talento, perícias treinadas e proficiências. Segue o molde da curadoria das 27 classes PF2e.

### Onda 2: motor de regras, só o que o recorte 1–3 usa

- **T2.1** `grant-item`: concessão de característica, talento e item da classe.
- **T2.2** `proficiency` (MartialProficiency) e `base-speed`.
- **T2.3** O subconjunto de `set-property`/ItemAlteration que aparece até o nível 3 (medir antes
  de implementar: a maior parte pode ser runa de item, que está fora de escopo).
- **T2.4** `strike` (arma solar do Solarian).

### Onda 3: ficha SF2e

- **T3.1** Perícias, tradições e moeda deixam de ser fixas e passam a vir de configuração por
  sistema na ficha 2e (ver a decisão D2).
- **T3.2** Criação de personagem SF2e: ancestralidade, herança, antecedente, classe, atributos,
  perícias (as 18) e talentos.
- **T3.3** Subida de nível de 1 a 3, com conjuração (Mystic, Witchwarper) e magias de foco.
- **T3.4** Mecânicas próprias de cada classe **visíveis na ficha** até o nível 3: conexão do
  Mystic, sintonia e arma solar do Solarian, mira do Operative, escudo vivo do Soldier, os talentos
  de expertise do Envoy e a probabilidade do Witchwarper (ver a decisão D3).

### Onda 4: classes de playtest

- **T4.1** Montar à mão, a partir dos PDFs (ORC), o Mechanic, o Technomancer e o Luminary até o
  nível 3: classe, características, talentos e magias ou foco. Os dados ficam num pack próprio
  (`sf2e:playtest-classes`), com a origem e a versão do playtest em `publication`.
- **T4.2** Mecânicas novas visíveis na ficha: o exocórtex e o companheiro robô do Mechanic, os
  magic hacks do Technomancer e os holofotes do Luminary.
- **T4.3** Abrir uma issue para trocar Mechanic e Technomancer pela versão do Tech Core depois de
  07/10/2026.

### Onda 5: aceite

- **T5.1** Criar uma ficha de cada uma das **9 classes** até o nível 3, com testes não-circulares
  por classe.
- **T5.2** Roteiro `tutorial-e2e` com prints (criação e subida de nível) e o smoke como GM e como
  player, segundo `docs/design/PROCESSO-UI.md`.

## Decisões abertas (para o Alexandre)

- **D1: onde vive a progressão.** A recomendação é **subir a derivação de progressão do
  `systems/pf2e` para o `engine-2e`** e fazer o PF2e e o SF2e consumirem a mesma. Assim cumpre a
  DEC-SF2-01, que proíbe fork do engine. A alternativa é copiar o `build.ts` para o `systems/sf2e`:
  sai mais rápido, mas duplica toda a manutenção.
- **D2: uma ficha só ou duas.** A recomendação é **uma ficha 2e parametrizada por sistema**,
  isolando as 3 superfícies que divergem (perícias, tradições e moeda). A alternativa é
  `sheets/sf2e` separada: tem menos risco para a ficha PF2e, mas duplica cerca de 17 mil linhas.
- **D3: profundidade das mecânicas de classe.** A recomendação é **o suficiente para aparecer e ser
  escolhível na ficha** até o nível 3 (escolhas, ações e recursos listados), sem automatizar o
  efeito em combate, que está fora de escopo como na Fatia 1.

## Ordem e dependências

A Onda 0 vem primeiro. As Ondas 1 e 2 correm em paralelo, porque tocam arquivos disjuntos. A Onda
3 depende da 1. A Onda 4 depende da 1 e da 3 (os dados podem começar junto com a Onda 1). A Onda 5
vem por último.
