# Inventário — criação de personagem nível 1→3 (PF2e), estado real

> Levantamento em 2026-09-20, branch `docs/guerreiro-tasks` do core (`xansde/fusion`),
> submodule `external/fusion-systems-2e` pinado em `v0.1.1` (`e0597c9`). Método: leitura
> direta de código/dados + `gh issue list` nos dois repos. Nada foi corrigido.

---

## 1. Onde vive o fluxo de criação

Não existe um "wizard" separado de criação de personagem. O fluxo inteiro roda dentro da
**aba Plano** da própria ficha (`@fusion/sheets-pf2e`, no submodule), que trata criação e
progressão de nível como a mesma coisa: uma coluna com um `LevelCard` por nível (1..20),
cada um com slots preenchíveis.

Caminhos principais (todos em `external/fusion-systems-2e/sheets/pf2e/src/`):

- **Motor/VM**: `lib/sheets/pf2e/planVM.ts` (5.876 linhas) — todos os builders de operação
  (`applyAncestry`, `applyBackground`, `chooseClassLevel`, `levelUp`/`levelSet`,
  `materializeGrants` via `grantMaterializer.ts`, cálculo de slots/elegibilidade).
- **UI da coluna de plano**: `components/sheets/pf2e/plan/` — `PlanColumn.svelte` (1.520
  linhas, orquestra tudo), `LevelCard.svelte`, `ABCCard.svelte` (Ancestralidade/Herança/
  Antecedente/Classe), `PlanSlot.svelte`, `AbilityBoostsDialog.svelte` (522 linhas),
  `SkillTrainingDialog.svelte` (648 linhas), `CompendiumPickerDialog.svelte` (picker
  genérico de talento/classe/ancestralidade), `GateThresholdDialog.svelte` /
  `KineticGateDialog.svelte` (casos especiais do Kineticist).
- **Conjuração**: `components/sheets/pf2e/SpellsTab.svelte` + `SpellPickerDialog.svelte`,
  `lib/sheets/pf2e/spellCastCardVM.ts`.
- **Derivações do sistema (HP, CA, DCs, tabela de classe)**: `systems/pf2e/src/derivations/
  build.ts` — não é um passo da UI, é automático (o motor recalcula ao vivo a partir do
  que está no plano).
- **Não existe** nenhum arquivo de inventário/equipamento inicial no client nem no
  submodule (`choiceSetInventory.ts` é sobre a rule element `ChoiceSet`, não sobre
  inventário do jogador).

## 2. Etapas com UI real acionável

| Etapa | UI existe? | Valida pré-requisito? | Grava no ator? |
|---|---|---|---|
| Ancestralidade | Sim — `ABCCard` abre `CompendiumPickerDialog` | Parcial (issue #7/#6: pré-requisito ausente só marca depois de escolher, não no seletor) | Sim, via `applyAncestry` |
| Herança | Sim — mesmo card, sub-slot | Sim, mas com bug conhecido: issue satélite ainda não fechada de heranças versáteis (r22 histórico, já corrigido lá); requisito de ancestralidade cruzada vira `issueText` no card (DEC-BC-05), não bloqueio | Sim |
| Antecedente (background) | Sim — `ABCCard` | Não há pré-requisito de background no PF2e | Sim |
| Classe | Sim — `ABCCard` + `chooseClassLevel` (picker restrito por nível par/ímpar) | Sim | Sim |
| Atributos/boosts | Sim — `AbilityBoostsDialog.svelte` (522 linhas), grid 3×2 renderizado no `LevelCard` | Sim (limite de boosts por linha) | Sim |
| Perícias (treinamento) | Sim — `SkillTrainingDialog.svelte` (648 linhas) | **Falho**: issue satélite #41 (teto medido no nível errado — `charLevel` vs `choice.level`) e #40 (aumento não força perícia destreinada) ambas OPEN | Sim |
| Talentos (ancestralidade/classe/perícia/geral) | Sim — `CompendiumPickerDialog.svelte` (735 linhas) genérico para os 4 tipos de slot | Parcial — issues satélite OPEN: #35 (picker esconde o inelegível sem mostrar motivo, contra REQ-BC-032), #25 (137 sub-escolhas dentro do eixo de classe ainda não oferecidas) | Sim |
| Equipamento inicial | **Não existe UI nenhuma** — nenhum componente de inventário/loja/gold inicial no client nem no submodule | N/A | N/A |
| Conjuração/preparação de magias | Sim — `SpellsTab.svelte` + `SpellPickerDialog.svelte` | Parcial — issue satélite #31 OPEN (filtro de magia de foco por classe deixa passar 85 magias sem trait certo) | Sim |

## 3. Subida de nível (1→2→3)

Mecanismo real e **wired a um botão**: `PlanColumn.svelte:1186` — `handleLevelUp()` chama
`sendAll(levelUp(opCtx))`, ligado a um clique de UI (confirmado lendo o handler e a
declaração do `levelSet`/`levelUp` em `planVM.ts:5181-5223`, que faz bump de
`system.level.value` + `system.details.level`).

O que a subida de nível **aplica automaticamente**, por ser recalculado ao vivo pela
derivação (`systems/pf2e/src/derivations/build.ts`), não por um botão dedicado de "aplicar
nível":
- HP máximo (soma ancestralidade + classe × nível, automático).
- Aumento de proficiência de classe (tabela `classSystem.proficiencyUpgrades`), com a
  ressalva do achado histórico r22 P-01: **sem teto de nível** (Mestre exige 7, Lendário
  15 nas regras — o código só limita `rank <= 4`); não verificado se foi corrigido desde
  02/08 (não achei issue satélite aberta ou fechada citando esse teto especificamente —
  merece checagem pontual antes de confiar).

O que a subida de nível **não faz sozinha** — precisa do jogador preencher o slot que
aparece no `LevelCard` daquele nível: talentos de classe/perícia/geral/ancestralidade do
nível 2 e 3 (dependem de quais a classe concede em cada nível), boost de atributo (nível
5 em diante — não entra no recorte 1-3, corretamente ausente).

## 4. Dados — cobertura das 27 classes PF2e

- **12 classes** estão de fato jogáveis nos packs do submodule
  (`external/fusion-systems-2e/systems/pf2e/packs/classes-core/documents.json`):
  Barbarian, Bard, Champion, Cleric, Fighter, Kineticist, Magus, Monk, Ranger, Rogue,
  Sorcerer, Wizard. `class-features-core` tem 264 documentos de feature para essas 12.
- **13 classes têm curation** em
  `external/fusion-systems-2e/tools/importer-pf2e/src/curation/classes/` (as 12 acima +
  Alchemist) — mas Alchemist **não está** no pack `classes-core` (confere memória: "nada
  jogável" para o Alquimista).
- **27/27 classes já passaram pela etapa de transform** num diretório de trabalho local
  não versionado no core (`tools/importer-pf2e/out/classes/transformed.json`, listado
  integralmente: Alchemist, Animist, Barbarian, Bard, Champion, Cleric, Commander, Druid,
  Exemplar, Fighter, Guardian, Gunslinger, Inventor, Investigator, Kineticist, Magus,
  Monk, Oracle, Psychic, Ranger, Rogue, Sorcerer, Summoner, Swashbuckler, Thaumaturge,
  Witch, Wizard) — mas essa pasta é `??` no `git status` (não commitada) e não corresponde
  ao estado publicado no submodule. Ou seja: **dado bruto existe para as 27, dado jogável
  (curado + integrado ao pack + pt-BR) só para 12**, e nem essas 12 estão livres de bug de
  progressão (achado histórico V-01/P-01 do r22, ver abaixo).
- O relatório `.fusion-build/r22/varredura-jogabilidade.md` (02/08/2026, HEAD `dcb02b3`)
  documenta que a suíte de 80 testes que validava as 12 classes era **circular**
  (comparava a derivação contra a própria tabela do pack, não contra fonte externa) — não
  encontrei, no tempo disponível, o `ACHADOS-TRANSVERSAIS.md` do r29 citado na memória do
  projeto (não está em `.fusion-build/` nem no submodule na árvore atual); as 24 issues do
  r22 relacionadas a classe/talento já aparecem CLOSED no repo core, então parte do achado
  já foi corrigida — mas a taxa de correção não foi re-medida com um teste não-circular
  (issue #48, fechada, pedia exatamente esse teste contra pregens oficiais).

## 5. Issues abertas (`gh issue list`) tocando criação/classe/nível

**Repo core `xansde/fusion`** (17 issues abertas no total; só 2 tocam o escopo, e
tangencialmente): #220 (motor de efeitos só recebe condição — afeta talentos com regra
mecânica, não a criação em si), #229 (condição "dead" não marca defeated — combate, fora
de escopo).

**Repo satélite `xansde/fusion-systems-2e`** (79 issues abertas, a maioria tocando o
escopo — agrupadas por tema):

- **Perícias/talentos (builder+sheet)**: #41 (teto de perícia no nível errado), #40
  (aumento não força destreinada→treinada), #35 (picker esconde inelegível sem motivo),
  #36 (aba Talentos não agrupa por categoria), #25 (137 sub-escolhas de classe não
  oferecidas), #34 (Additional Lore não concede nada).
- **Classe/mecânica de classe**: #30 (multiclasse sem lado de dedicação definido), #29
  (multiclasse por nível sem UI), #22 (Champion: deidade/causa inertes), #21 (Sorcerer:
  linhagens não propagam dano/tradição), #20 (Bárbaro: 7 instintos inertes), #18 (Cleric:
  doutrina não gera proficiência — mesmo achado do r22 P-02, ainda OPEN), #12 (Divine Font
  do Cleric não oferecido), #11 (tradição do Sorcerer só em prosa), #10 (pré-requisitos de
  efeito do Ranger), #9/#8 (Kineticist: gate/impulso de elemento quebrados), #33 (Powerful
  Fist do Monk não faz nada).
- **Conjuração**: #23 (78 documentos concedem magia só por prosa, sem automação), #1
  (254 regras GrantItem de magia não apontam para spells-core), #31 (filtro de magia de
  foco vaza 85 magias).
- **Pré-requisito/integridade de pack**: #7, #6 (pré-requisito não marcado no seletor /
  aponta para talento inexistente, 458 entradas medidas), #24 (AdjustDegreeOfSuccess
  inerte em 123 instâncias), #19 (1.259 regras `unconvertedRules` sem consumidor).
- **15 classes novas (Player Core 2/Rage of Elements etc.)**: #59 (mecanismos faltando
  para jogabilidade), #58 (~1.231 documentos sem tradução pt-BR), #61/#62/#63/#64 (mesma
  frente, mas para SF2e).
- **Epic guarda-chuva**: #27 ("varredura de jogabilidade das 12 classes r22 — 43/60
  fechados, 17 abertos" — o próprio issue confirma que 17 dos 60 achados do r22 SEGUEM
  abertos).

## 6. Os 3 maiores bloqueadores concretos

1. **Só 12 das 27 classes têm dado jogável e curado**; as outras 15 têm transform bruto
   sem curation, sem integração ao pack, sem pt-BR (issues #58/#59) — criar qualquer uma
   delas hoje não é possível pela ficha, só pelas 12 do `classes-core`.
2. **Mesmo nas 12 curadas, a progressão de classe (proficiência/features condicionais)
   tem furos abertos e não re-verificados**: doutrina do Cleric ainda gera proficiência
   incompleta (#18, aberta desde antes do r22 e não fechada), Bárbaro/Kineticist/Sorcerer/
   Champion têm mecânicas centrais da classe inertes (#20, #21, #22, #8, #9) — a ficha
   "parece" completa (ABC + talentos preenchidos) mas os números derivados (CD, proficiência,
   dano) ficam errados em pelo menos 5 das 12 classes.
3. **Sem equipamento inicial**: não existe UI de inventário/compra/gold na criação em
   nenhum dos dois repos — um personagem nasce sem arma, armadura ou kit de aventureiro;
   isso não aparece como issue dedicada (é ausência de feature, não bug catalogado), o
   que por si é um sinal de que a etapa nunca foi sequer especificada para o builder.
