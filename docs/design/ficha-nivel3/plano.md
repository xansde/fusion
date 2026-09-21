# Fatia 1 — Criar qualquer ficha até o nível 3

**Data:** 2026-09-20
**Decisão do Alexandre:** abandonar o recorte por classe (Alquimista → Animista → Guerreiro) e
atacar a **criação de personagem**, para todas as classes, do nível 1 ao 3.

## Por que este recorte

A criação de ficha é a única fatia vertical do Fusion com **usuário real hoje**: o jogador monta o
personagem antes da sessão, sem depender do Mestre, de token no mapa ou de dano entrando no alvo.
As três frentes de classe anteriores terminavam todas em "e aí nada acontece na mesa".

O corte no nível 3 é deliberado: obriga a atravessar a **subida de nível** (talento de classe no 2,
talento geral + aumento de proficiência no 3, 2º círculo de magia) sem pagar o aumento de atributo,
que só chega no nível 5.

### Escopo

- **DENTRO:** as 29 classes PF2e, níveis 1 a 3, incluindo conjuradores; arquétipos **padrão**.
- **FORA:** arquétipos de **multiclasse** (dinâmica diferente; e, com todas as classes funcionando
  até o 3, o mecanismo sai quase de graça numa fatia futura — falta só o dado das 27 dedicações
  ausentes). Nível 4+. Combate, dano e efeito em alvo.

## Estado verificado (sondas de 2026-09-20)

Relatórios em `.fusion-build/ficha-nivel3/` (`inventario.md` + `classes/*.md`).

### O que já existe e funciona

| Peça                                                                                          | Onde                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fluxo de criação inteiro                                                                      | `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (~5.900 linhas) + `components/sheets/pf2e/plan/*.svelte` (~11k) |
| Criação e level-up são o MESMO mecanismo                                                      | — (não há wizard separado)                                                                                                             |
| Botão de subir de nível, ligado de verdade                                                    | `PlanColumn.svelte:1186` → `planVM.ts:5181` (`levelUp`/`levelSet`)                                                                     |
| UI de ancestralidade, herança, antecedente, classe, atributos, perícias, talentos, conjuração | `plan/*.svelte` (ABCCard, AbilityBoostsDialog, SkillTrainingDialog, CompendiumPickerDialog, SpellsTab)                                 |
| **Picker genérico de escolha de classe, por tag**                                             | `CLASS_CHOICE_SLOT_OPTIONS` em `planVM.ts:2094` — já cabeado para 12 escolhas                                                          |
| Diálogo dedicado do Kineticist                                                                | `KineticGateDialog.svelte` (enum fixo, por design)                                                                                     |
| Rastreador de escolhas pendentes                                                              | `choiceSetInventory.ts`                                                                                                                |
| Resolvedor de pré-requisito free-text                                                         | `planVM.ts:2559-2677`                                                                                                                  |
| Pool de foco no schema + derivação (clampa em 3)                                              | `actor-character` + `derivations/build`                                                                                                |
| Slots de magia preparada por círculo, estruturados no pack                                    | `system.spellcasting.slots[]`, corretos nos níveis 1-3                                                                                 |

As 12 escolhas já cabeadas: `hybridStudy`, `instinct`, `racket`, `huntersEdge`, `arcaneThesis`,
`arcaneSchool`, `bloodline`, `muse`, `cause`, `doctrine`, `divineFont`, `blessing`.

### Os buracos reais

1. **Namespace dos grants não convertido.** Em `class-features-core` + `feats-core` (3.445
   documentos na branch das 29 classes) existem **471 regras `GrantItem`**, das quais **350 (74%)**
   apontam para UUIDs `Compendium.pf2e.*` do Foundry, nunca remapeados para o `_id` local. A
   concessão automática de feature está morta **mesmo quando o item existe localmente**
   (ex.: Hunt Prey). Quebra até classe sem escolha nenhuma (Guardian).

   > **Correção de 2026-09-20 (auditoria):** a primeira versão deste plano dizia "2.541 ocorrências
   > de `GrantItem`". Era contagem de **substring** `Compendium.pf2e.` no JSON bruto, não de regras
   > `GrantItem`. O número real de regras quebradas é **350**. A substring aparece 5.805 vezes
   > porque a maioria está em **links `@UUID` na prosa das descrições** — que é um defeito separado
   > e bem menos grave (link quebrado no texto, não concessão morta). Ver a issue da nota 13.

2. **17 das 29 classes não estão integradas.** O pin (`v0.1.1`) e o `main` do satélite têm 12. As 29
   vivem em `origin/feat/classes-necromancer-runesmith`, não mergeada.
3. **Guard de traits de classe não está na ref das 29.** O commit que adiciona as classes novas a
   `KNOWN_CLASS_TRAITS` **não é ancestral** dessa branch (verificado com `merge-base --is-ancestor`):
   trazer as 17 classes reintroduz o vazamento de talentos de Psychic e Animist para o picker de
   toda classe.
4. **15 escolhas de classe não cabeadas** em `CLASS_CHOICE_SLOT_OPTIONS`: Estilo (Swashbuckler),
   Way (Gunslinger), Metodologia (Investigator), Implemento (Thaumaturge), Ikon e Epíteto
   (Exemplar), Patrono (Witch), Ordem (Druid), Research Field (Alchemist), Innovation (Inventor),
   Eidolon (Summoner), Fatal Method (Necromancer), Mistério (Oracle), Mente Consciente (Psychic),
   Prática (Animist). O Exemplar mostra o tamanho: os dados já estão tagueados (21 ikons, 6
   epítetos) — faltam duas linhas na tabela.
5. **Repertório de conjuração espontânea não existe.** `schema-primitives.ts:223` (`SpellSlotSchema`)
   só tem `max` + `prepared[]`; o pack tem `cantripsKnown` e `slots` mas nenhum `spellsKnown`; o
   `SpellPickerDialog` só tem modo "preparar slot". Trava Bard, Sorcerer, Oracle, Psychic, Animist.
6. **Lista preparada do dia não existe.** Dado pronto, motor ausente. Trava os 5 preparados.
7. **Proficiência de conjuração não progride.** `proficiencyUpgrades[]` está no dado; `grep` em
   `packages/` não acha **nenhum consumidor**.
8. **Pool de foco não é alimentado.** O pool existe e é clampado, mas Composition Spells (Bard),
   Bloodline Spells (Sorcerer) e Revelation Spells (Oracle) têm `rules: []` — o máximo fica em 0.
   Só o Psychic mecaniza.
9. **Etapa de equipamento inicial não existe** em lugar nenhum do builder, e `equipment-core` tem
   **18 itens**: zero escudos, zero armas de fogo, nenhum implemento de Thaumaturge, nenhum item
   com traço `tactic` (Commander).
10. **Pack de divindades não existe.** Trava Champion (Sanctification) e Cleric (divindade é escolha
    obrigatória de nível 1). Já registrado no código: `choiceSetInventory.ts:110` marca
    `"class-features-core/Deity (Champion)/deity": "pendente"`.
11. **Eidolon é um segundo ator** e não há modelo de ator companheiro no repo.
12. **Animist tem a pior cobertura:** 17 das 23 features de nível 1-3 sem `rules`.

### O que NÃO é problema (verificado, contrariando suposições anteriores)

- **Elfo Ancião não fura o corte de multiclasse.** A herança está em `heritages-core` com
  `system.rules` vazio; o GrantItem de dedicação foi movido para `flags.fusion.disabledRules`
  (DEC-MC-01), desativado na fonte em `tools/importer-pf2e/src/curation/disabled-rules.mjs:59-64`
  com teste, e replicado para mundos antigos pela migration
  `packages/server/src/db/migrations/010_dec_mc_01_ancient_elf.ts`.
- **O picker de subclasse não precisa ser criado** — existe e cobre 12 casos.
- **Pool de foco não precisa ser criado** — existe, só não é alimentado.

### Arquétipos padrão

- 5 dedicações padrão no pack: Avenger, Bloodrager, Runelord, Vindicator (nível 2) e **Unassuming
  (nível 1, de ancestralidade halfling)**.
- 119 talentos com trait `archetype`, pertencendo a ~68 arquétipos distintos → **~63 órfãos** (os
  talentos existem, a dedicação não). A maioria dos talentos órfãos é nível 4+, fora do recorte.
- No recorte de nível 2-3 existem **16 talentos de arquétipo**, e **16/16 têm pré-requisito** — o
  resolvedor free-text já existe.
- **O COMPORTAMENTO de `dedicacao-nao-cabe-em-slot-de-classe` EXISTE** — o identificador com esse
  nome não aparece em código nem em spec (a sonda acertou nisso, e errou ao concluir daí que a
  regra não tem enforcement). O enforcement está em
  `planVM.ts:2008`, dentro de `isFeatEligible` — um talento com trait `archetype` é rejeitado do
  slot `classFeat`. Arquétipo entra por um slot separado, `archetypeFeat`, que só é gerado quando a
  variante **Arquétipo Livre** (`freeArchetype`) está ligada, em níveis pares (`planVM.ts:1442`).
  Consequência: com a variante desligada, **não há como pegar dedicação nenhuma** — divergência
  consciente do RAW, onde a dedicação consome o slot de talento de classe.
- Ausente: a regra "só uma dedicação por vez até pegar 2 talentos dela". No recorte 1-3 ela **nunca
  dispara**: com Arquétipo Livre, o único slot de arquétipo até o nível 3 é o do nível 2.

## Plano em ondas

Cada onda tem um gate: só passa com verificação executada e vista.

### Onda 0 — Dado das 29 classes

1. Mergear `feat/classes-necromancer-runesmith` no satélite e **re-aplicar o guard de
   `KNOWN_CLASS_TRAITS`** (senão Psychic e Animist voltam a vazar).
2. Novo pin do submodule no core.
3. **Converter o namespace dos 2.541 `GrantItem`** para os `_id` locais, no importer.

**Gate:** importar um mundo e verificar que as features de nível 1-3 são concedidas de fato.
**Destrava:** Monk, Fighter, Barbarian, Rogue, Magus, Runesmith, Kineticist — as classes cuja
escolha já tem picker e cujo único defeito era o grant morto.

### Onda 1 — Cabear as 15 escolhas restantes

Estender `CLASS_CHOICE_SLOT_OPTIONS` e taguear os documentos-opção que ainda não têm `otherTags`.
Padrão já provado (r21-W1); o Exemplar é a prova de que é cabeamento, não arquitetura.

**Destrava:** Swashbuckler, Gunslinger, Investigator, Exemplar, Witch, Druid, Oracle, Psychic,
Necromancer (se o dado das opções existir), Thaumaturge e Alchemist parcialmente.

### Onda 2 — Conjuração

1. **Repertório espontâneo:** `spellsKnown` por círculo no schema + modo "conhecidas" no
   `SpellPickerDialog`.
2. **Lista preparada do dia:** motor sobre os slots que já estão estruturados.
3. **Proficiência de conjuração:** consumir `proficiencyUpgrades[]`.
4. **Alimentar o pool de foco:** escrever as `rules` das features que concedem magia focal.

**Destrava:** Bard, Sorcerer, Wizard, Cleric (parcial), Druid, Witch, Oracle, Psychic, Animist.

### Onda 3 — Equipamento inicial

1. Etapa de equipamento no builder (não existe hoje).
2. Popular `equipment-core`: escudos, armas de fogo, implementos de Thaumaturge, itens `tactic`.

**Destrava:** Guardian, Gunslinger, Thaumaturge, Commander, Inventor, Alchemist.

### Onda 4 — Dados ausentes

1. Pack de divindades (→ Champion e Cleric).
2. `rules` das 17 features do Animist.
3. Opções do Fatal Method (Necromancer).

### Onda 5 — Arquétipos padrão (variante Arquétipo Livre ligada)

**Nota de vocabulário:** não existe arquétipo "sem dedicação". A dedicação É a porta de entrada de
todo arquétipo — inclusive dos padrão (Firework Technician tem a sua). O corte do Alexandre é entre
dedicação **de multiclasse** (fora) e dedicação **padrão** (dentro), não entre "dedicação" e
"não-dedicação".

**Simplificação que encolhe muito esta onda:** no recorte 1-3, com Arquétipo Livre, existe **um
único slot de arquétipo — o do nível 2**. E todo talento de seguimento exige a própria dedicação
como pré-requisito (16/16 dos talentos de arquétipo de nível 2-3 do pack têm `prerequisites`). Logo
o slot do nível 2 **só pode receber uma dedicação**. Para esta fatia, só as dedicações importam; os
talentos de seguimento só passam a valer no nível 4.

**O material existe localmente**, em `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/archetype/`:

|                                  |                                                                        |
| -------------------------------- | ---------------------------------------------------------------------- |
| Arquétipos (pastas)              | 251                                                                    |
| Talentos de arquétipo            | 1.713                                                                  |
| Dedicações                       | **232** — sendo **29 de multiclasse** (fora) e **203 padrão** (dentro) |
| **Dedicações padrão de nível 2** | **167** ← o que esta fatia precisa                                     |

> **Correção de 2026-09-20 (auditoria):** a primeira versão dizia 179/21/158/**129**. A varredura
> original só desceu um nível de diretório e perdeu parte da árvore. Os números corretos, conferidos
> com varredura recursiva completa, são os da tabela acima. As **29** dedicações de multiclasse
> batem com as 29 classes, o que é o sanity check esperado.

Tarefas: importar as 129 dedicações padrão de nível 2 (as outras 29 padrão são nível 4+ e ficam para
depois), garantir que a variante seja ligável como setting de mundo e que o slot `archetypeFeat`
apareça no nível 2, e implementar a regra "uma dedicação até 2 talentos dela" — que **nunca dispara
dentro de 1-3**, mas fica coberta por teste para o nível 4+.

> ⚠️ `tools/importer-pf2e/` está **untracked** no git. A base do vendor existe só nesta máquina —
> confirmar a política (commitar, submodular ou documentar como pré-requisito local) antes da onda.

### Onda 6 — Verificação não-circular

Build de referência por classe, montada à mão contra o livro, conferida contra a ficha gerada.
**A lição #48 manda:** conferir a derivação contra a tabela do próprio pack é teste circular —
80 testes verdes conviveram com 60 defeitos.

## Decisões do Alexandre (2026-09-20)

0. **Elfo Ancião** — segue FORA. A dedicação concedida pela herança não será implementada nesta
   fatia. Estado atual já é esse (DEC-MC-01); nada a fazer.
1. **Summoner/eidolon — ENTRA.** Exige modelo de ator companheiro, que não existe no repo. Vira
   item próprio de onda (ver Onda 3b).
2. **Quem cria — O JOGADOR.** O Mestre pode criar se quiser, mas o jogador tem autonomia sobre o
   próprio ator. Traz ownership e validação no servidor (spec 28) para dentro da fatia.
3. **Equipamento inicial — FORA da fatia.** O jogador anota os itens no papel num primeiro momento.
   Critério do Alexandre: **"se pudermos criar a ficha, está valendo"**. Alchemist, Inventor,
   Thaumaturge, Gunslinger, Commander e Guardian criam a ficha; o item inicial fica fora do app.
   A Onda 3 sai do caminho crítico.
4. **Divindades — PUXAR.** Autorar/importar o pack de divindades, destravando Champion e Cleric.
5. **Aceite não-circular — o Alexandre monta as fichas de referência à mão**, e se responsabiliza
   por executar o e2e. Divisão: o time entrega o arquivo-molde (campos a preencher) e o teste que
   compara; ele entrega os números lidos do livro. Isso resolve a circularidade da #48 — a fonte da
   verdade passa a ser externa ao pack.
6. **Integração — `alfa/app`.**
7. **Arquétipo — a variante Arquétipo Livre fica LIGADA**, e precisa ser alimentada com todos os
   arquétipos **não-multiclasse** da base (ver "Onda 5" e a nota de vocabulário abaixo).
8. **Classes novas com dado incompleto — ENTRAM.** A fatia fecha em 29 classes.
