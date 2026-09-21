# Sonda de criação de ficha — grupo "híbridos, pets, itens" (Magus, Summoner, Alchemist, Inventor, Runesmith)

Fonte: `git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/<pack>/documents.json`
dentro de `external/fusion-systems-2e` (HEAD detached, não escrito). Packs lidos: classes-core,
class-features-core, feats-core, spells-core, equipment-core. As 29 classes existem nessa ref
(vs. 12 no pin atual), inclusive as 5 deste grupo.

## Achado transversal (o mais importante)

**O rule element `ChoiceSet` não existe em NENHUM lugar do dataset.** Contagem de `kind` sobre
todas as `system.rules[]` de `class-features-core` e `feats-core`: apenas
`flat-modifier, grant-item, proficiency, roll-note, roll-option, set-property, strike, base-speed,
sense` aparecem — zero `choice-set`. Isso significa que TODA escolha de subtipo de classe
(híbrido do Magus, eidolon do Summoner, campo de pesquisa do Alchemist, inovação do Inventor)
está com o mecanismo de captura da escolha ausente: os `grant-item` que deveriam ser
resolvidos pela escolha apontam para `uuid: "{item|flags.system.rulesSelections.<slug>}"` — um
placeholder que só um `ChoiceSet` (inexistente) preencheria. Ou seja: a escolha aparece só como
PROSA HTML com links `@UUID[...]` para as opções (sub-features), nunca como dado processável, e
o grant em cascata que ela deveria disparar está estruturalmente quebrado (aponta pra uma flag
que nada escreve).

## Por classe

### Magus — AMARELO
- Features 1-3: 5 (Arcane Spellcasting, Arcane Cascade, Spellstrike, Hybrid Study, Conflux
  Spells). 1 de 5 com rules vazio (Arcane Spellcasting).
- Conjuração: `spellcasting.type = "prepared"`, `ability: int`, slots estruturados por nível em
  `system.spellcasting.slots` (nível 1: `{"1":1}`) — dado existe e é processável.
- Hybrid Study: prosa HTML com 7 `@UUID` para sub-features (Aloof Firmament, Inexorable Iron,
  etc.); `grant-item` aponta para `{item|flags.system.rulesSelections.hybridStudy}` — sem
  ChoiceSet, nada preenche essa flag. Arcane Cascade tem `set-property` de
  `flags.system.arcaneCascade.damageType` — mecanismo de cascade parcialmente modelado, mas
  gatilho de combate (fora de escopo desta sonda).
- Feats nível ≤2: 11, com prerequisites não-vazio: 5.
- Mecanismo faltando: escolha de Hybrid Study (1 mecanismo) → AMARELO.

### Summoner — VERMELHO
- Features 1-3: 7 (Eidolon, Evolution Feat, Summoner Spellcasting, Spell Repertoire, Link
  Spells, Shared Vigilance [nv3], Signature Spells [nv3]). 1 de 7 com rules vazio.
- Eidolon: mesmo padrão quebrado — `grant-item` para
  `{item|flags.system.rulesSelections.eidolon}` sem ChoiceSet, mais 3 grants adicionais
  (Manifest Eidolon, Act Together, Share Senses) que dependem do eidolon existir.
- **Eidolon como segundo ator**: NÃO existe modelo de ator companheiro no repo. Busca por
  `eidolon`/`companion` em `packages/{server,client,shared}/src` não retornou nenhum arquivo de
  produção (só ocorrências acidentais em `dist/` legado e nomes não relacionados como
  `ContactsPanel`, `NpcsPanel`). `packages/shared/src/document.ts` define `type` de documento
  como `z.string().optional()` — subtipo livre, mas nenhum fluxo de criação gera um segundo
  documento Actor. Criação de personagem cria um Actor só.
- Conjuração: espontânea, `ability: cha`, com `traditionByBloodline` mapeando a tradição pelo
  tipo de eidolon — mais um dado que depende da escolha do eidolon (que está quebrada).
- Feats nível ≤2: 14, nenhum com prerequisites.
- Mecanismos faltando: (1) escolha de eidolon quebrada, (2) ausência total de modelo de
  ator companheiro → VERMELHO (2+ mecanismos).

### Alchemist — VERMELHO
- Features 1-3: só 2 no pack (Alchemy nv1, Research Field nv1); Field Discovery/Powerful
  Alchemy aparecem com `level: 5` no dado (não nv2/3 — a tabela de progressão desta ref está
  incompleta/desalinhada para esta classe). 0 de 2 com rules vazio, mas ambas resolvem em
  placeholder quebrado.
- Research Field (campo de pesquisa): mesmo padrão — `grant-item` para
  `{item|flags.system.rulesSelections.researchField}`, sem ChoiceSet.
- Fórmulas conhecidas / itens alquímicos diários: NÃUCLEO É INVENTÁRIO. Busca por conceito de
  "fórmula conhecida" em `packages/server/src`, `packages/client/src`, `packages/shared/src`
  não achou nada — os únicos hits de "formula" no repo são fórmula de rolagem de dado
  (`combat/system-formula-adapter.ts`, `chat/roll-service.ts`), não crafting. `equipment-core`
  tem só 6 itens `consumable` no pack inteiro — sem marcação de "alchemical item conhecido por
  fórmula". Não existe modelo de "fórmula conhecida" nem de advanced alchemy.
- Feats nível ≤2: 13, com prerequisites: 1.
- Mecanismos faltando: (1) escolha de Research Field quebrada, (2) fórmulas conhecidas / advanced
  alchemy inexistentes E dependem da etapa de equipamento que não existe → VERMELHO.

### Inventor — VERMELHO
- Features 1-3: 7 (Peerless Inventor, Shield Block, Explode, Overdrive, Innovation nv1,
  Reconfigure nv3, Expert Overdrive nv3). 0 de 7 com rules vazio.
- Innovation (o item arma/armadura/construto que a criação concede e modifica): mesmo padrão —
  `grant-item` para `{item|flags.system.rulesSelections.innovation}`, sem ChoiceSet. Não há
  modelo de item "innovation" modificável (upgrades) em `packages/shared`/`server` — apenas o
  placeholder quebrado no pack.
- Feats nível ≤2: 13, com prerequisites: 6 (a maior taxa do grupo — cadeia de talentos mais
  dependente de pré-requisito).
- Mecanismos faltando: (1) escolha/criação de Innovation quebrada, (2) Innovation é um ITEM que
  precisaria da etapa de equipamento (inexistente) para ser instanciado e modificado
  → VERMELHO.

### Runesmith — AMARELO
- Features 1-3: 4 (Runic Repertoire nv1, Runes nv1, Shield Block nv1, Runic Crafter nv2). 0 de
  4 com rules vazio. Runic Repertoire (a "lista de runas conhecidas") tem `rules: []` — dado
  existe mas sem estrutura de progressão de runas conhecidas por nível.
  Runes: 2 `grant-item` diretos (Invoke Rune, Trace Rune), SEM depender de placeholder de
  escolha — diferente das outras 4 classes, aqui não há uma escolha de "arquétipo" na criação;
  a lista de runas conhecidas cresce por feats/nível, não por um ChoiceSet quebrado.
- Runesmith é classe nova (pós-remaster), e o dado EXISTE nesta ref (`origin/feat/classes-
  necromancer-runesmith` — o nome do branch é literalmente por causa dela): 13 feats nível ≤2,
  3 com prerequisites.
- Mecanismo faltando: Runic Repertoire sem estrutura de progressão de runas conhecidas por
  nível (1 mecanismo, menos grave que os outros porque não depende de ChoiceSet nem de ator
  companheiro) → AMARELO.

## Veredito

(a) O eidolon do Summoner exige ator companheiro: **SIM**, por regra (é uma criatura separada
com suas próprias ações, PV e evoluções) — e o repo **NÃO tem esse modelo**: nenhum arquivo em
`packages/{server,client,shared}/src` implementa um segundo documento Actor vinculado/controlado
por outro personagem; `document.ts` só define `type` como string livre, sem fluxo de criação de
ator companheiro.

(b) Dependem da etapa de equipamento inexistente (confirmada pela ausência de qualquer
`equipment`/`gear` step em `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/plan/`,
que só tem `AbilityBoostsDialog`, `SkillTrainingDialog`, `LevelCard`, `GateThresholdDialog`,
`KineticGateDialog`, `CompendiumPickerDialog`): **Alchemist** (fórmulas conhecidas / itens
alquímicos diários são inventário) e **Inventor** (Innovation é um item de arma/armadura/
construto que a criação precisa instanciar e modificar). Magus, Summoner e Runesmith não
dependem diretamente dessa etapa para os 3 primeiros níveis.

Arquivo: `C:\Users\xansd\pessoal\fusion\.fusion-build\ficha-nivel3\classes\hibridos-pets-itens.md`
