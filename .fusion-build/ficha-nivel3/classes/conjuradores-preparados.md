# Sonda de criação de ficha — grupo "conjuradores-preparados"

Escopo: Wizard, Cleric, Druid, Witch, Necromancer — nível 1 a 3, só construção de personagem.

Fonte dos packs: `git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/<pack>/documents.json`
dentro de `external/fusion-systems-2e` (HEAD detached, leitura apenas — nenhum checkout/branch/escrita
feitos no submodule). JSONs intermediários ficaram no scratchpad da sessão.

## Achado transversal nº 1 — ChoiceSet de criação está marcado `_conversionState: "unsupported"`

Toda escolha de criação estruturante deste grupo (Doctrine do Cleric, Deity do Cleric, Arcane School
do Wizard, Druidic Order do Druid, Patron da Witch, Fatal Method do Necromancer) segue o MESMO padrão
no pack `class-features-core`:

- `system.rules` só tem um `grant-item` com uuid-template
  `{item|flags.system.rulesSelections.<chave>}` — ele espera que a flag JÁ exista.
- A ChoiceSet real (a pergunta que o jogador responderia) vive em
  `flags.fusion.unconvertedRules[].key === "ChoiceSet"` com `_conversionState: "unsupported"` —
  ou seja, o pipeline de import marcou explicitamente que essa regra NÃO foi convertida para nada
  processável pelo motor do Fusion. Não existe rule-kind `choice-set` em nenhum documento do pack
  (`grep` nos 7 kinds usados: grant-item, flat-modifier, roll-option, set-property, strike,
  roll-note, proficiency — nenhum é escolha).
- As opções concretas em si existem como documentos separados no pack (ex.: `Animal Order`,
  `Flame Order` etc. para Druidic Order; `School of Battle Magic` etc. para Arcane School;
  `Faith's Flamekeeper`, `Silence in Snow`, `Wilding Steward` etc. para Patron da Witch) — então o
  dado-fonte da escolha não está ausente, só não está cabeado a nenhuma pergunta processável.
- Exceção pior: **Deity do Cleric** não tem nem isso — `itemType: "deity"` no ChoiceSet, mas
  **não existe pack `deities-*` nenhum** entre os 15 packs do submodule (`actions-core,
  ancestries-core, ancestry-features-core, backgrounds-core, bestiary-core, class-features-core,
  classes-core, conditions, equipment-core, familiar-abilities-core, feats-core, heritages-core,
  spells-core, weapons-core`). Divindade não tem de onde vir.
- **Fatal Method do Necromancer**: nem o `_conversionState: unsupported` chega a ter opções óbvias
  no pack — busquei nomes prováveis de subclasse (Vivisection, etc.) e não achei; só achei
  `Fatal Method` (o placeholder) e `Methodology` (Investigator, outra classe).

## Achado transversal nº 2 — nenhum modelo de dados para conjuração preparada, proficiência ou foco

- `grep -r "preparedSpell|focusPoint|focusPool"` em `packages/` inteiro: **zero ocorrências** de
  estrutura de dados. A única menção a "focus pool" é um comentário em
  `packages/shared/src/mechanics.ts:119` explicando que o materializador de grants deveria um dia
  colocar a magia lá — não há campo, contador ou schema de pontos de foco em lugar nenhum.
- `proficiencyUpgrades` (progressão trained→expert→master, incluindo `"stat":"spellcasting"` nos
  níveis 7/15/19 para Wizard/Druid/Witch/Necromancer) **existe no pack de classe como dado
  declarativo**, mas `grep -r "proficiencyUpgrades" packages/` retorna **zero arquivos** — nada no
  motor de derivação lê ou aplica esse campo.
- Slots por círculo (`system.spellcasting.slots[]` por nível) e cantrips conhecidos
  (`cantripsKnown[]`) **estão estruturados no pack**, não em prosa — isso é o único pedaço deste
  bloco que já está pronto como dado.
- Nenhum arquivo em `packages/` ou `external/fusion-systems-2e` implementa "lista preparada do dia"
  (slot vazio vs. slot preenchido com uma magia específica, re-preparo diário). Não há
  `arquivo:linha` para citar porque a busca não encontrou nenhum candidato.

## Por classe

### Wizard — VERMELHO
- Features N1–3: 4 (Wizard Spellcasting, Arcane School, Arcane Bond, Arcane Thesis) — 0 com
  `rules` realmente vazio, mas todas as 4 só têm 1 grant-item placeholder cada (nenhuma resolve
  sozinha).
- Arcane School (escolha de criação) = ChoiceSet `unsupported`; concede foco/magia em cascata que
  não acontece. Slots por círculo estruturados (1:2 no N1, 1:3/2:2 no N3). Proficiência de
  conjuração progride só no dado, sem código. Sem modelo de foco.

### Cleric — VERMELHO
- Features N1–3: 6 (Deity, Cleric Spellcasting, Doctrine, First Doctrine, Divine Font, Second
  Doctrine no N3) — Cleric Spellcasting e Divine Font com `rules` vazio (2 de 6).
- Deity: ChoiceSet `unsupported` **e sem pack de divindades** — pior caso do grupo; sem deidade,
  Divine Font (que deveria conceder Heal/Harm extra) fica com `rules: []`, sem efeito nenhum.
  Doctrine também `unsupported`. Slots estruturados igual Wizard/Druid/Witch.

### Druid — VERMELHO
- Features N1–3: 8 (Anathema, Druid Spellcasting, Druidic Order, Wildsong, Shield Block, Voice of
  Nature no N1; Perception/Fortitude Expertise no N3) — 3 de 8 com `rules` vazio (Anathema,
  Druid Spellcasting, Wildsong, Perception Expertise = 4 na verdade).
- Druidic Order: ChoiceSet `unsupported`; a ordem deveria conceder magia focal e, para Animal/Leaf,
  companheiro animal — nada disso é automatizado (não achei modelo de companheiro no repo além do
  familiar de player, que é para outra mecânica).

### Witch — VERMELHO
- Features N1–3: 4 (Witch Spellcasting, Familiar (Witch), Hexes, Patron) — 2 de 4 com `rules`
  vazio (Witch Spellcasting, Hexes).
- Patron: ChoiceSet `unsupported`, mas as opções concretas existem no pack (Faith's Flamekeeper,
  Silence in Snow, Wilding Steward, etc.). Familiar é obrigatório no N1: existe o gate de
  ownership para criar/deletar um Actor tipo `familiar` vinculado a um mestre com o feat
  "Familiar" (`packages/server/src/__tests__/player-familiar-create.test.ts`), mas isso é só
  posse/anti-cheat — não achei nenhum código que use `familiar-abilities-core` para o jogador
  escolher as habilidades do familiar na criação.

### Necromancer — VERMELHO
- Features N1–3: 8 (Fatal Method, Necromancer Spellcasting, Grave Spells, Undead Lore, Mastery of
  Life and Death, Grim Fascination no N1; Inevitable Return, Mental Wards no N3) — 2 de 8 com
  `rules` vazio (Necromancer Spellcasting, Undead Lore, Mental Wards = 3 na verdade).
- Fatal Method (subclasse no N1): ChoiceSet `unsupported` e, diferente de Witch/Druid/Wizard, não
  encontrei documentos-opção óbvios no pack (busquei "Vivisection" e nomes prováveis, zero match) —
  é o caso mais incerto: pode ser dado ausente, não só desconectado.

## Veredito

1. **Conjuração preparada (slots diários)**: os SLOTS POR CÍRCULO estão estruturados no pack para
   as 5 classes (níveis 1–3 batem: Cleric/Wizard/Druid/Witch = 2/3/3+2; Necromancer = 1/2/2+1), mas
   não existe em `packages/` nenhum modelo de "lista preparada do dia" (slot vazio × magia
   escolhida) — dado pronto, motor ausente.
2. **Proficiência de conjuração**: a progressão trained→expert→master está no pack
   (`proficiencyUpgrades[].stat === "spellcasting"`), mas `grep -r "proficiencyUpgrades"
   packages/` não acha nenhum consumidor — dado pronto, motor ausente (mesmo padrão do item 1).
3. **Magia focal / pontos de foco**: AUSENTE por completo — `grep -ri "focusPoint|focusPool"
   packages/` não retorna nenhuma estrutura de dados, só um comentário em
   `packages/shared/src/mechanics.ts:119` apontando a intenção futura.

Arquivo: `C:\Users\xansd\pessoal\fusion\.fusion-build\ficha-nivel3\classes\conjuradores-preparados.md`
