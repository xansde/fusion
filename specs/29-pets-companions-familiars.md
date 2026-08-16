# 29 — Pets, Animal Companions e Familiars

- **Título:** Pets, Companheiros Animais e Familiares (PF2e Remaster)
- **Status:** draft v0.1 (pesquisa — sem implementação)
- **Data:** 2026-07-06
- **Baseada em:**
  - `docs/research/10-pf2e-sistema-internals.md` — internals do sistema `foundryvtt/pf2e` (Apache-2.0): tipos de actor, Rule Elements (`GrantItem`, `ActiveEffectLike`, `Sense`, `BaseSpeed`).
  - Vendor `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (Apache-2.0/ORC) — packs `familiar-abilities/`, `feats/class/shared-class-feats/`, `feats/class/druid/`, `feats/class/ranger/`, `feats/general/level-1/pet.json`, `feats/archetype/familiar-master/`, `class-features/animal-order.json`, `class-features/familiar-witch.json`, `actions/archetype/beastmaster/call-companion.json`, `actions/skill/command-an-animal.json` — usados **apenas como referência de comportamento/dados**, sem cópia de texto proprietário.
  - `specs/17-sistema-pf2e.md` — já lista `familiar` como Actor type [V2] (linha "Actor types") e cita `familiar`/`party`/`vehicle` como avançados; esta spec detalha o que ficou pendente lá.
  - `specs/27-roadmap-e-milestones.md` — M6 já menciona actor types `familiar`/`party`/`vehicle` como [V2]; esta spec propõe onde companions/familiars entram nesse roadmap.
  - `specs/02-modelo-de-dados.md`, `specs/11-ui-framework-e-fichas.md`, `specs/15-api-de-sistemas.md` — contratos de Document, sheets e system API que esta spec consome sem redefinir.
  - Código do builder já implementado: `packages/client/src/lib/sheets/pf2e/planVM.ts` (modelo de slots `BuildChoice`, sub-slots de `grantedFeat`).

> **Aviso clean-room.** Esta spec descreve regras mecânicas do PF2e Remaster,
> publicadas sob ORC, e o comportamento observável do sistema `foundryvtt/pf2e`
> (Apache-2.0), estudado apenas como referência de modelagem de dados. Nenhum
> texto de regra proprietário da Paizo é reproduzido literalmente — as
> descrições abaixo são paráfrases funcionais para fins de especificação
> técnica. Nenhum código do Foundry (core, proprietário) é usado; os arquivos
> JSON do vendor `foundryvtt/pf2e` (Apache-2.0) são citados por caminho como
> evidência de modelagem de dados, não copiados.

---

## Objetivo

Preparar o terreno para uma futura **tela de Pets** na ficha PF2e do Fusion,
documentando (a) as regras remaster de familiars, animal companions, pets
genéricos (archetype) e mounts; (b) como o Foundry `pf2e` modela esses
conceitos em Actors/Items (evidência vendorizada); (c) uma proposta de modelo
de dados própria para o Fusion, coerente com `02-modelo-de-dados.md` e
`15-api-de-sistemas.md`; (d) a UI da ficha e a integração com o builder
(coluna Plano); e (e) requisitos `REQ-PET-NNN` numerados e faseados.

Esta spec é **só pesquisa e desenho** — não há implementação nesta rodada.
Nenhum código é alterado; o entregável é este documento (mais a entrada no
índice `specs/README.md`).

---

## Escopo

### O que esta spec inclui

- Resumo das regras remaster de **familiars** (habilidades diárias, master
  abilities, derivação de HP/saves a partir do mestre).
- Resumo das regras remaster de **animal companions** (young/mature/nimble/
  savage/incredible, progressão por feats de classe de Druid e Ranger,
  Command an Animal vs. independência).
- Resumo do **pet genérico** (feat "Pet", archetype Beastmaster) como terceira
  variante do mesmo mecanismo subjacente.
- **Mounts** citados em nível de requisito [V2], sem detalhamento mecânico
  completo (fora do foco desta rodada).
- **Eidolon** (classe Summoner) citado como **fora de escopo** — é um Actor
  fundido ao PC com regras próprias muito mais complexas; não é "um pet".
- Como o `foundryvtt/pf2e` modela isso (Actor type `familiar`, ausência de
  Actor type dedicado para animal companion, rule elements `GrantItem`/
  `ActiveEffectLike`/`Sense`/`BaseSpeed`), citado como referência.
- Proposta de **modelo de dados** do Fusion: companion como Actor próprio
  vinculado ao ator-mestre, sincronização de derivados via `engine-2e`.
- Proposta de **UI de ficha** ("tela de Pets"): aba na ficha do dono + mini-
  ficha do companion.
- Proposta de **integração com o builder** (coluna Plano): feats que concedem
  companion/familiar viram slot/chip, com progressão por nível.
- Requisitos `REQ-PET-NNN` com tags `[MVP]`/`[V2]`.

### O que esta spec NÃO inclui

- Implementação de código (nenhum arquivo `.ts`/`.svelte` é criado ou
  alterado nesta rodada).
- Regras completas de **Eidolon** (Summoner) — citado apenas como referência
  de fora-de-escopo; mereceria spec própria se algum dia entrar em roadmap.
- Regras completas de **mounts em combate** (Mounted Combat, cavalgar em
  batalha naval, etc.) — apenas o suficiente para posicionar como [V2].
- Kingdom-building / army companions (`army` actor type já citado em
  `10-pf2e-sistema-internals.md`) — não são "pets" no sentido desta spec.
- O contrato genérico de Document/Actor (`ver 02-modelo-de-dados.md`) — esta
  spec propõe como o **subtype** `familiar` (e sua generalização) se encaixa
  nesse contrato, sem redefini-lo.
- O framework de sheets (window manager, autosave, tabs) — `ver
11-ui-framework-e-fichas.md`; esta spec propõe o **conteúdo** da aba, não o
  mecanismo de abas em si.
- O motor de effects/rule-elements completo — `ver 15-api-de-sistemas.md` /
  `17-sistema-pf2e.md` DEC-PF2-04; esta spec assume que o motor MVP reduzido
  já existe e propõe como `GrantItem`-like e `Sense`/`BaseSpeed`-like se
  encaixam nele (ou onde ele precisa crescer).

---

## Conceitos e terminologia

| Termo                     | Definição                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Familiar**              | Criatura Tiny que assiste um conjurador (Wizard/Witch/Sorcerer/Magus/Thaumaturge); concedida pelo feat de classe "Familiar"; ganha "familiar abilities" de uma lista compartilhada.                                         |
| **Animal Companion**      | Criatura maior que acompanha Druid (Animal Order) ou Ranger (feat "Animal Companion"); progride por feats (Mature/Incredible/Nimble/Savage) e é comandada via a ação Command an Animal ou age sozinha em níveis mais altos. |
| **Pet (archetype)**       | Variante genérica do familiar concedida pelo feat geral "Pet" (nível 1) ou pelo dedication "Beastmaster"; usa o mesmo contador de "familiar/pet abilities" do familiar clássico.                                            |
| **Master / mestre**       | O Actor (`character`, tipicamente) dono do companion; muitos atributos do companion derivam do nível/estatísticas do mestre.                                                                                                |
| **Familiar/Pet ability**  | Habilidade escolhida de uma lista compartilhada (voar, ver no escuro, falar, etc.); número de escolhas controlado por um contador (`familiarAbilities.value` no vendor).                                                    |
| **Companion progression** | Feats de nível fixo (Druid: 1/4/8; Ranger: 1(dedication)/6/10) que aumentam a independência e o poder do animal companion, sem trocar de Actor.                                                                             |
| **Mount**                 | Criatura montada para fins de deslocamento/combate montado; pode ser um animal companion "cavalgável" ou uma criatura separada; regras próprias de Mounted Combat.                                                          |
| **Eidolon**               | Actor fundido ao Summoner (compartilha turno, HP e ações com o PC); mecanicamente muito diferente de um pet — **fora de escopo** desta spec.                                                                                |
| **`engine-2e`**           | Núcleo de regras 2e compartilhado PF2e/SF2e (`ver 17-sistema-pf2e.md` DEC-PF2-01); os derivados de companion (saves/mods "iguais ao mestre") são um caso de uso natural desse núcleo.                                       |

---

## 1. Regras remaster (resumo funcional)

### 1.1 Familiars

Um personagem que conjura (Wizard, Witch, Sorcerer com certas heranças, Magus,
Thaumaturge) pode obter um familiar pelo feat de classe "Familiar" (nível 1).
Mecanicamente:

- O familiar é uma criatura Tiny com estatísticas **quase inteiramente
  derivadas do mestre**: HP proporcional ao nível do mestre, saves e AC
  espelhando (com uma fórmula própria) o mestre, sem atributos próprios nem
  bônus de item.
- Ao ser criado, o jogador escolhe um número de **familiar abilities** de uma
  lista compartilhada (voar, escalar, ver no escuro, sentidos especiais,
  "falar", carregar itens, etc.). O número de escolhas é um contador que
  cresce com feats (base 2, mais com "Enhanced Familiar", "Incredible
  Familiar") — no vendor isso é literalmente um campo numérico
  `system.attributes.familiarAbilities.value` incrementado por regra
  declarativa, não um novo Actor por habilidade.
- Algumas classes têm um familiar "reforçado" com regras adicionais: a Witch
  ganha um familiar que também é o **repositório de magias** do seu patron
  (aprende spells, "undying" — se morre, o patron manda um substituto no
  próximo preparo diário); o Druid (Leshy Familiar) e o Animist têm variantes
  próprias com sabor distinto mas o mesmo esqueleto mecânico.
- O familiar **não** ocupa uma ação separada relevante na maioria dos casos:
  ele age nos bastidores dando suporte passivo (ex.: sentidos, entrega de
  itens) mais do que atacando.
- Arquétipos como "Familiar Master" (dedication) e "Familiar Sage"
  (dedication) estendem ainda mais o familiar de personagens que não o
  ganhariam pela classe base, reforçando que o "familiar" é um **subsistema
  transversal**, não uma feature isolada de uma classe.

### 1.2 Animal Companions

Concedido primariamente pelo Druid (Animal Order, nível 1) e pelo Ranger
(feat "Animal Companion", nível 1), o animal companion é uma criatura maior
(Small/Medium, às vezes Large) com um statblock mais rico que o familiar:

- **Nível "young"** no início: estatísticas fixas por tipo de companion
  (ex.: bear, wolf, bird), escalando com o nível do mestre via uma tabela de
  progressão (não são atributos livres).
- **Command an Animal**: ação que o mestre gasta para dar 1 ação ao
  companion (Nature check vs. Will DC do animal, no vendor). É a interface
  clássica de "comandar" a criatura durante o combate.
- **Mature Animal Companion** (Druid nível 4 / Ranger nível 6): o companion
  ganha independência parcial — mesmo sem gastar Command an Animal, pode usar
  1 ação por rodada (Strike/Stride/etc.) automaticamente.
- **Incredible Companion** (Druid nível 8 / Ranger nível 10): mais um salto
  de capacidade/independência (ex.: Nimble ou Savage companion, dependendo da
  escolha), aumentando ainda mais a autonomia e o poder do companion.
- **Call Companion** (ação de exploração do arquétipo Beastmaster, e
  disponível de forma similar a Druid/Ranger): trocar qual companion está
  "ativo" quando o personagem tem mais de um.
- O companion mantém sua própria ficha (tipo/família de criatura, HP, AC,
  ataques), mas vários números (ex. modificadores de perícia, em algumas
  variantes) são derivados combinando nível do mestre + tabela do tipo de
  animal — não são digitados livremente pelo jogador.

### 1.3 Pet (archetype genérico)

O feat geral "Pet" (nível 1, qualquer classe) e o arquétipo "Beastmaster"
(dedication) dão acesso a uma versão **mais simples e genérica** do mesmo
conceito: uma criatura Tiny com o traço `minion`, cujas estatísticas
(modificadores de save, AC, perícias) são copiadas quase diretamente do
mestre (`your pet's save modifiers and AC are equal to yours`), HP = 5×nível,
e 2 "pet abilities" escolhidas da **mesma lista de familiar abilities**. No
vendor, o rule element que concede isso (`ActiveEffectLike` sobre
`system.attributes.familiarAbilities.value`) é **idêntico em forma** ao usado
pelo feat "Familiar" — confirmando que familiar e pet genérico compartilham a
mesma máquina de regras, variando apenas o "flavor" e o texto introdutório.

### 1.4 Mounts (citado, [V2])

Um mount é uma criatura (frequentemente um animal companion "grande o
bastante para montar", ou uma criatura alugada/possuída separadamente) usada
para deslocamento e Mounted Combat. Regras chave: o cavaleiro e a montaria
compartilham espaço, certas ações do cavaleiro dependem de comandar a
montaria (de novo via Command an Animal ou automação de companion), e há
modificadores específicos de combate montado (ex. flanqueamento, alcance
elevado). Fora do foco desta rodada — apenas registrado como extensão natural
do animal companion (REQ-PET-090+, V2).

### 1.5 Eidolon (fora de escopo)

O Eidolon (classe Summoner) é um Actor que **substitui** o turno do PC
quando manifestado, compartilhando iniciativa e narrativamente "fundindo-se"
ao Summoner. Não usa o mecanismo de familiar/pet/companion acima — tem
progressão própria, HP próprio somado a uma mecânica de "Summoner health
pool" distinta. Mencionado aqui apenas para deixar explícito que esta spec
**não** cobre eidolons; se o Summoner entrar no roadmap do Fusion, merece
spec própria.

---

## 2. Como o `foundryvtt/pf2e` modela isso (referência vendorizada)

> Fonte: `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (Apache-2.0). Citado
> por caminho/estrutura, sem cópia de código-fonte do core do Foundry.

- **Actor type dedicado**: `familiar` (`docs/research/10-pf2e-sistema-internals.md`
  linhas do bloco de actor types: `FamiliarPF2e` estende `CreaturePF2e`, junto
  de `CharacterPF2e`/`NPCPF2e`). **Não existe** um Actor type separado
  `animalCompanion` — animal companions no Foundry pf2e são modelados como
  Actors do tipo **`npc`** (ou `character`, dependendo da implementação
  daquela versão) mantidos soltos no world e vinculados ao PC apenas por
  convenção/flag, não por um schema formal de "companion". Isso é uma lacuna
  conhecida do sistema oficial que o Fusion pode resolver melhor (ver §3).
- **Pet genérico e Familiar compartilham a mesma mecânica de contagem de
  habilidades**: tanto `feats/class/shared-class-feats/level-1/familiar.json`
  quanto `feats/general/level-1/pet.json` manipulam
  `system.attributes.familiarAbilities.value` via rule elements
  `ActiveEffectLike`/regra de grant — evidência direta de que, no dado
  vendorizado, "familiar" e "pet" são a **mesma família de Actor**
  (`type: "familiar"`) com sabor de feat diferente.
- **`GrantItem`**: o feat "Familiar" concede o item
  `Compendium.pf2e.feats-srd.Item.Pet`; a classfeature "Animal Order" do
  Druid concede `Compendium.pf2e.feats-srd.Item.Animal Companion` via
  `GrantItem` condicionado por predicado (`class:druid` OR
  `feat:order-explorer:animal-order`). Isto é o padrão de "feat que concede
  automaticamente outro feat/slot" que o Fusion já tem parcialmente
  modelado no builder como sub-slot de `grantedFeat`
  (`packages/client/src/lib/sheets/pf2e/planVM.ts`, comentário "feats that
  grant a nested pick").
- **Familiar/pet abilities como Items, não como campos hardcoded**: o pack
  `familiar-abilities/` (103 itens) contém abilities como `type: "action"`,
  `system.category: "familiar"`, cada uma com seus próprios rule elements
  (`Sense` para Darkvision/Echolocation/Scent, `BaseSpeed` para
  Climber/Flier/Amphibious/Burrower, etc.). Isso confirma o padrão
  data-driven: uma habilidade de familiar é um Item comum plugado no Actor
  `familiar`, reaproveitando o mesmo motor de rule elements de qualquer outro
  item — não um sistema paralelo.
- **Animal companions não têm pack próprio de "companion stat blocks"** no
  vendor explorado; a progressão (young/mature/incredible) vem inteiramente
  dos **feats de classe** (`feats/class/druid/level-1|4|8/`,
  `feats/class/ranger/level-1|6|10/`), que descrevem a regra em prosa/rule
  elements aplicados ao Actor do companion (fora do escopo desses arquivos de
  feat — presumivelmente resolvido em compêndios de bestiário/NPC
  específicos de companion, não encontrados nos packs enumerados nesta
  pesquisa). **Achado relevante para o Fusion**: isso é uma área onde o
  sistema oficial é fraco/manual, e o Fusion tem oportunidade de fazer melhor
  com um modelo de dados mais explícito (§3).
- **Ações de interface**: `actions/skill/command-an-animal.json` (a ação
  clássica) e `actions/archetype/beastmaster/call-companion.json` (trocar de
  companion ativo) confirmam que a interação com o companion passa por
  Items de ação normais, roláveis como qualquer skill action.

---

## 3. Modelo de dados proposto (Fusion)

### 3.1 Decisão: companion é um **Actor próprio**, vinculado ao mestre por referência, não um item embutido

**Alternativas consideradas:**

1. **Item embutido no Actor do mestre** (ex.: um item `companion` com um
   "mini-schema" de statblock dentro do `system` do PC). Rejeitado: não
   permite ao companion ter seu próprio token na cena, sua própria barra de
   HP visível, seu próprio turno destacável no combat tracker, nem
   ownership independente — tudo isso é modelado no Fusion em nível de
   **Actor** (`ver 02-modelo-de-dados.md`, `10-combate-e-iniciativa.md`).
2. **Actor completamente independente sem vínculo formal** (como o Foundry
   pf2e parece fazer na prática, por convenção/flag solta — §2). Rejeitado:
   perde a chance de sincronizar automaticamente derivados do mestre
   (nível, saves, algumas perícias) sempre que o mestre muda de nível —
   forçaria o GM a atualizar manualmente, replicando a fragilidade
   observada no sistema de referência.
3. **Actor próprio com campo de vínculo formal `system.master` + derivação
   automática via `engine-2e`** — **escolhida**. Um companion (`familiar` ou
   uma futura generalização `companion`) é um Actor completo (token, HP,
   AC, ownership próprios), mas seu `prepareData` lê o Actor do mestre (por
   `_id`) para derivar campos que a regra amarra ao mestre (nível efetivo,
   parte dos saves/perícias, no caso do familiar/pet quase tudo; no caso do
   animal companion, menos campos, principalmente o nível de progressão).

**Justificativa:** o Fusion já tem um mecanismo de **derivação topológica**
(`DeriveStep`, `ver 15-api-de-sistemas.md`) usado para calcular estatísticas
de um Actor a partir de seus itens. Estender esse mesmo mecanismo para
**ler campos de outro Actor** (o mestre) como entrada de um `DeriveStep` do
companion é uma generalização pequena e reaproveita toda a infraestrutura já
especificada, em vez de inventar um pipeline paralelo. Isso também resolve a
lacuna observada no Foundry pf2e (§2): lá a sincronização "companion segue o
nível do mestre" não é automática por schema, é uma convenção manual; no
Fusion queremos que seja um `DeriveStep` declarado.

### 3.2 Schema proposto (resumo)

```typescript
// systems/pf2e — schema resumido do companion (Actor subtype "familiar")
// Cobre familiar (Wizard/Witch/...), pet genérico (feat "Pet") e, com um
// discriminador `companionKind`, a base para animal companion.

type CompanionKind = "familiar" | "pet" | "animalCompanion"; // V2: "mount"

interface CompanionSystem {
  companionKind: CompanionKind;
  masterActorId: string | null; // referência ao Actor do mestre (character)
  // Campos derivados via DeriveStep que LÊ masterActorId:
  attributes: {
    hp: { value: number; max: number }; // familiar/pet: 5×nível do mestre (ou fórmula da classe)
    ac: { value: number }; // familiar/pet: igual ao mestre antes de circumstance/status
    speed: { value: number; otherSpeeds: { type: string; value: number }[] };
  };
  saves: Record<"fortitude" | "reflex" | "will", { mod: number }>; // espelha o mestre (familiar/pet) ou tabela própria (companion)
  perception: { mod: number; senses: SenseData[] };
  skills: Record<string, { mod: number }>; // familiar/pet: fórmula fixa (3+nível / nível); companion: tabela por tipo de criatura
  abilitiesBudget: { value: number; max: number }; // mirrors system.attributes.familiarAbilities.value do vendor
  selectedAbilities: string[]; // slugs dos Items de "companion ability" escolhidos
  progression: {
    stage: "young" | "mature" | "incredible" | "nimble" | "savage"; // relevante só para animalCompanion
  };
}
```

- **`masterActorId`** é o único campo obrigatório de vínculo; tudo o resto é
  recomputado por `prepareData` do companion sempre que o mestre muda (nível,
  certas perícias). Consistente com DEC-PF2-03 (`17-sistema-pf2e.md`) — dados
  derivados nunca são persistidos como fonte de verdade.
- **`selectedAbilities`** referencia Items do tipo `action`/`ability` com
  `category: "familiarAbility"` (mesmo padrão do vendor §2), embutidos no
  Actor companion — não uma lista hardcoded. Isso reaproveita o motor de
  effects/rule-elements MVP (`Sense`-like, `BaseSpeed`-like) já especificado
  em `17-sistema-pf2e.md` DEC-PF2-04, sem exigir feature nova nele além de
  eventualmente adicionar esses dois seletores (`sense`, `baseSpeed`) ao
  motor de effects se ainda não cobertos.
- **`abilitiesBudget.max`** é incrementado por feats do mestre (Enhanced
  Familiar, Incredible Familiar, Mature/Incredible Companion) via o mesmo
  mecanismo de "effect que aumenta um contador no Actor-alvo" — só que agora
  o alvo é **outro Actor** (o companion), não o mestre. Isso é a única
  extensão nova pedida ao motor de effects: hoje (`17-sistema-pf2e.md`) os
  effects mutam o próprio Actor; companion exige mutar um Actor vinculado.
  Registrado como questão em aberto (Q-PET-01).
- **Animal companion vs. familiar/pet**: a diferença mecânica principal é que
  `saves`/`skills` do animal companion vêm de uma **tabela por tipo de
  criatura** (ex. "bear", "wolf") escalada por `progression.stage`, não de
  uma fórmula simples baseada no mestre. Isso implica compendium próprio de
  "companion types" (dados abertos, sem arte — mesma política de todo o
  importer) — ver REQ-PET-040.

### 3.3 Sincronização de nível/stage com o engine-2e

Regra proposta: o `DeriveStep` do companion roda **depois** do `prepareData`
do mestre estar completo (ordem topológica cross-actor), lê
`master.system.level.value` e, para `familiar`/`pet`, recalcula HP/AC/saves
diretamente; para `animalCompanion`, mapeia o nível do mestre + a tabela do
tipo de criatura + `progression.stage` (setado quando o jogador adquire o
feat Mature/Incredible Companion, via grant declarativo — mesmo padrão
`GrantItem` do vendor, adaptado à system API do Fusion). Isso é uma extensão
pequena, mas real, do contrato de derivação de `15-api-de-sistemas.md` — hoje
especificado como derivação **dentro de um único Actor**; aqui precisa
"olhar" para outro Actor read-only. Marcado como questão em aberto
(Q-PET-02) a resolver quando a implementação começar.

---

## 4. UI da ficha — "tela de Pets"

Proposta de aba nova na ficha do dono (`character` sheet, `ver
11-ui-framework-e-fichas.md` para o contrato de tabs):

- **Aba "Pets"** (rótulo i18n `FUSION.Sheet.Character.Tabs.pets`), visível
  apenas quando o personagem tem ao menos um companion vinculado (não polui a
  ficha de quem não usa o subsistema).
- **Lista de companions vinculados**: cards compactos (nome, ícone,
  `companionKind`, HP atual/máx, AC) — um card por companion vinculado a este
  `masterActorId`. Suporta múltiplos companions (ex.: Beastmaster com mais de
  um pet via Call Companion) com indicação de qual está "ativo" no momento
  (`progression`/flag `active`).
- **Mini-ficha expansível**: ao clicar no card, expande para strikes, saves,
  perícias, sentidos e as `selectedAbilities` do companion — reaproveitando
  os mesmos componentes de statblock já usados na NPC sheet enxuta
  (`REQ-PF2-111`), não um componente novo do zero.
- **Ação rápida "Command"**: botão que rola a ação Command an Animal (ou, se
  o companion já é "mature"/"independente", indica que não é necessária) —
  reaproveita o motor de ações declarativas (`14-macros-e-automacao.md` /
  `09-chat-e-mensagens.md` chat cards), não um sistema de UI paralelo.
- **Abrir ficha completa**: botão para abrir a sheet completa do companion
  como uma janela própria do window manager (o companion, sendo um Actor de
  verdade, já tem sheet própria por herdar o contrato geral de sheets).
- **Do lado do companion**: a sheet do companion (`familiar` subtype) ganha
  um cabeçalho "Pertence a: <nome do mestre>" com link de volta.

Esboço de hierarquia de componentes (nomenclatura provisória, sem código
nesta rodada):

```
CharacterSheet
└── tabs/
    └── PetsTab.svelte
        ├── PetCard.svelte (× N companions vinculados)
        │   └── PetMiniStatblock.svelte (reusa NpcStatblock.svelte existente)
        └── PetEmptyState.svelte (quando não há companion ainda, mas há slot disponível no Plano)
```

---

## 5. Integração com o builder (coluna Plano)

O builder nível-a-nível (`packages/client/src/lib/sheets/pf2e/planVM.ts`, r10)
já resolve o padrão geral de "feat que concede algo com escolha aninhada" via
sub-slots de `grantedFeat` (ex.: um feat que concede outro feat/pick vira um
sub-slot filho, com `parentSlotId` apontando para o slot que concedeu).
Companion/familiar se encaixam **exatamente** nesse padrão já existente:

- **Familiar** (feat "Familiar" em nível 1 de Wizard/Witch/Sorcerer/Magus/
  Thaumaturge) → ao ser escolhido no Plano, gera um **sub-slot**
  `companion-familiar-1` (convenção análoga a `<type>-<level>` já usada,
  `planVM.ts` linha ~629) que, quando "preenchido", cria (ou vincula) o Actor
  companion com `companionKind: "familiar"` e abre a escolha das
  `selectedAbilities` iniciais (2, ou mais se o mestre já tiver "Enhanced
  Familiar" resolvido em slot anterior).
- **Animal Companion** (feat "Animal Companion" concedido pela classfeature
  "Animal Order" do Druid via `GrantItem`, ou escolhido como feat de Ranger)
  → mesmo padrão: sub-slot `companion-animalCompanion-1`, que ao preencher
  pede o **tipo de criatura base** (compendium de companion types, REQ-PET- 040) e cria o Actor vinculado com `companionKind: "animalCompanion"`,
  `progression.stage: "young"`.
- **Progressão** (Mature/Incredible Companion, Enhanced/Incredible Familiar)
  → feats normais do Plano em níveis fixos (Druid 4/8, Ranger 6/10, Wizard-
  like 2/8) que, ao serem preenchidos, **não criam novo Actor** — apenas
  emitem um effect que altera `progression.stage` ou `abilitiesBudget.max`
  no companion já vinculado (mesma extensão cross-actor citada em §3.2/3.3).
- **Chip visual no Plano**: um slot de companion preenchido mostra um chip
  com o nome do companion (quando já nomeado) ou "Escolher companion" —
  mesmo padrão visual de `PlanSlot.svelte`/`PlanAutoChip.svelte` já
  existentes, sem componente novo de chip.
- **Pet (archetype)**: como feat geral de nível 1 disponível para qualquer
  classe (não preso a uma progressão de classe), aparece no Plano como
  qualquer feat geral escolhível — ao preencher, mesmo fluxo do Familiar
  (sub-slot + criação de Actor `companionKind: "pet"`).

---

## 6. Requisitos funcionais (REQ-PET)

### Modelo de dados e derivação

- **REQ-PET-001** [MVP] O Fusion DEVE modelar companions (familiar, pet
  genérico, animal companion) como **Actors próprios** (subtype `familiar`,
  campo `companionKind` discriminando `familiar`/`pet`/`animalCompanion`),
  nunca como item embutido no Actor do mestre.
- **REQ-PET-002** [MVP] Todo companion DEVE ter um campo `masterActorId`
  apontando para o Actor que o possui — **qualquer** ator, sem restrição de
  subtype ou faceta (`ver 45-atores.md`, DEC-ATR-16); um companion sem mestre
  válido é considerado órfão e a sheet DEVE sinalizar isso ao GM, e é um estado
  legítimo, não um erro.
- **REQ-PET-003** [MVP] O `prepareData` do companion DEVE derivar HP, AC e
  saves lendo o nível (e, quando aplicável, outros campos) do Actor mestre
  via `masterActorId`, nunca aceitando esses valores como entrada manual
  persistida (consistente com DEC-PF2-03 de não persistir derivados).
- **REQ-PET-004** [MVP] Para `companionKind: "familiar"` e `"pet"`, a fórmula
  de HP (5×nível do mestre) e a cópia de saves/AC do mestre (antes de
  circumstance/status) DEVEM ser implementadas como `DeriveStep` no
  `engine-2e` ou `systems/pf2e`, reaproveitando o mesmo pipeline de derivação
  já especificado em `17-sistema-pf2e.md`.
- **REQ-PET-005** [V2] Para `companionKind: "animalCompanion"`, saves/
  perícias/ataques DEVEM derivar de uma tabela de "tipo de companion" (Actor
  de bestiário próprio ou compendium `companion-types`) escalada por
  `progression.stage`, não de uma cópia direta do mestre.
- **REQ-PET-006** [MVP] O sistema DEVE suportar `abilitiesBudget.{value,max}`
  no companion, incrementável por effects declarados em feats do **mestre**
  (ex.: Enhanced Familiar) — exigindo que o motor de effects (`17-sistema-
pf2e.md` DEC-PF2-04) suporte um effect cujo alvo é um Actor vinculado, não
  o próprio Actor portador do item (extensão registrada em Q-PET-01).
- **REQ-PET-007** [MVP] `selectedAbilities` do companion DEVEM ser Items
  embedded no Actor companion (subtype `action`/`ability`, `category:
"familiarAbility"`), cada um com seus próprios effects (`Sense`-like,
  `BaseSpeed`-like), replicando o padrão observado no vendor (§2) sem copiar
  seu texto.
- **REQ-PET-008** [V2] O motor de effects DEVE ganhar (ou confirmar que já
  cobre) os seletores `sense` e `baseSpeed` necessários para as familiar/pet
  abilities mais comuns (Darkvision, Echolocation, Scent, Climber, Flier,
  Amphibious, Burrower, Fast Movement).

### Compendium e importação

- **REQ-PET-020** [MVP] O importer (`ver 16-compendiums-e-importacao.md`)
  DEVE converter o pack `familiar-abilities` do vendor (mecânica apenas —
  zero arte/lore/marca, mesma política de todo o importer) para o formato-
  alvo de Item `familiarAbility` do Fusion.
- **REQ-PET-021** [MVP] O importer DEVE converter os feats-chave do
  subsistema (Familiar, Enhanced Familiar, Incredible Familiar, Pet, Animal
  Companion [Druid/Ranger], Mature/Incredible Companion [Druid/Ranger],
  Animal Order) preservando os rule elements equivalentes de grant
  (`GrantItem`-like) já suportados pelo motor de effects MVP.
- **REQ-PET-040** [V2] O Fusion DEVE ter (importado ou curado à mão) um
  compendium de **tipos de animal companion** (ex.: bear, wolf, bird, ox,
  camel — nomes genéricos, sem arte da Paizo) com a tabela de progressão
  young→mature→incredible usada por `DeriveStep` (REQ-PET-005).
- **REQ-PET-041** [V2] O importer DEVE converter os feats de arquétipo
  relacionados a companion/familiar mais usados (Beastmaster dedication +
  Call Companion; Familiar Master dedication) quando o pipeline de
  arquétipos genérico (`17-sistema-pf2e.md`) estiver pronto para consumi-los.

### UI de ficha

- **REQ-PET-050** [MVP] A character sheet DEVE exibir uma aba **Pets**
  quando o personagem tiver ao menos um companion com `masterActorId`
  apontando para ele; a aba DEVE ficar oculta quando não houver companion
  nem slot de companion disponível no Plano.
- **REQ-PET-051** [MVP] A aba Pets DEVE listar todos os companions
  vinculados como cards com nome, `companionKind`, HP atual/máx e AC.
- **REQ-PET-052** [MVP] Cada card DEVE expandir para uma mini-ficha
  (strikes, saves, perícias, sentidos, `selectedAbilities`) reaproveitando o
  componente de statblock já usado na NPC sheet (REQ-PF2-111), sem
  duplicar UI.
- **REQ-PET-053** [V2] A aba Pets DEVE oferecer uma ação rápida "Command"
  que dispara a ação Command an Animal via o motor de ações declarativas,
  desabilitada/anotada quando o companion já é independente
  (`progression.stage` ≥ mature).
- **REQ-PET-054** [V2] Quando o dono tiver mais de um companion vinculado
  (ex. via Beastmaster + Call Companion), a UI DEVE indicar qual está ativo
  e permitir alternar, sem apagar os companions inativos.
- **REQ-PET-055** [MVP] A sheet do próprio companion (Actor `familiar`) DEVE
  exibir um cabeçalho "pertence a `<mestre>`" com link de volta para a ficha
  do mestre.

### Integração com o builder (Plano)

- **REQ-PET-070** [MVP] O feat "Familiar" (Wizard/Witch/Sorcerer/Magus/
  Thaumaturge, nível 1) e o feat geral "Pet" (nível 1, qualquer classe),
  quando preenchidos no Plano, DEVEM gerar um sub-slot `companion-<kind>-
<level>` seguindo a mesma convenção de sub-slot de `grantedFeat` já
  implementada em `planVM.ts`.
- **REQ-PET-071** [MVP] Preencher o sub-slot de companion DEVE criar (ou
  vincular, se já existir um companion "solto" compatível) o Actor
  companion com `masterActorId` setado para o Actor sendo construído no
  Plano.
- **REQ-PET-072** [MVP] O feat "Animal Companion" concedido pela classfeature
  "Animal Order" do Druid (nível 1) DEVE ser tratado no Plano como o
  `GrantItem` observado no vendor (§2) — um grant condicional que preenche
  automaticamente o sub-slot de companion sem exigir escolha extra de feat
  slot (apenas a escolha do tipo de criatura, REQ-PET-040).
- **REQ-PET-073** [MVP] O feat "Animal Companion" do Ranger (quando escolhido
  como feat de classe) DEVE seguir o mesmo fluxo de sub-slot que qualquer
  outro feat de classe do Plano, sem tratamento especial de grant.
- **REQ-PET-074** [V2] Feats de progressão (Mature/Incredible Companion,
  Enhanced/Incredible Familiar), ao serem preenchidos no Plano, DEVEM emitir
  o effect cross-actor que atualiza `progression.stage` ou
  `abilitiesBudget.max` no companion já vinculado (REQ-PET-006), sem criar
  um novo Actor companion.
- **REQ-PET-075** [V2] O Plano DEVE exibir um chip com o nome do companion
  (ou "Escolher companion" se ainda não nomeado) no slot preenchido,
  reaproveitando `PlanSlot.svelte`/`PlanAutoChip.svelte` existentes.

### Mounts e fora de escopo

- **REQ-PET-090** [V2] Mounts DEVEM ser suportados como um `companionKind`
  adicional (`"mount"`) reaproveitando a mesma infraestrutura de Actor
  vinculado + tabela de tipo, sem subsistema paralelo. Regras detalhadas de
  Mounted Combat ficam fora desta rodada de pesquisa.
- **REQ-PET-091** [V2] O Eidolon (classe Summoner) **NÃO** DEVE ser
  modelado com o mecanismo `companionKind`; se entrar em roadmap, requer
  spec própria (fora desta spec).

---

## 7. Critérios de aceitação desta spec

- **CA-PET-01** As regras remaster de familiar, animal companion e pet
  genérico estão resumidas de forma funcional (não copiada literalmente),
  com eidolon e mounts corretamente marcados fora-de-escopo/[V2].
- **CA-PET-02** A modelagem observada no `foundryvtt/pf2e` (Actor type
  `familiar`, ausência de type dedicado para animal companion, rule elements
  `GrantItem`/`Sense`/`BaseSpeed`, pack `familiar-abilities`) está registrada
  com caminhos de arquivo como evidência, sem cópia de texto/código.
  proprietário.
- **CA-PET-03** O modelo de dados proposto (Actor próprio + `masterActorId`
  - derivação cross-actor) está justificado contra pelo menos uma alternativa
    rejeitada, e é consistente com DEC-PF2-03/DEC-PF2-04 de `17-sistema-pf2e.md`.
- **CA-PET-04** A UI de "tela de Pets" está descrita como aba na ficha do
  dono + mini-ficha reaproveitando componentes existentes (não introduz UI
  paralela desnecessária).
- **CA-PET-05** A integração com o builder referencia o mecanismo real já
  implementado (`planVM.ts`, sub-slots de `grantedFeat`) em vez de propor um
  mecanismo novo.
- **CA-PET-06** Todos os requisitos estão numerados `REQ-PET-NNN` com tag
  `[MVP]`/`[V2]`, e o MVP proposto é enxuto (familiar do Wizard/Witch +
  animal companion de Druid/Ranger), com mounts/pet-archetype-avançado/
  eidolon corretamente adiados.
- **CA-PET-07** `specs/README.md` lista esta spec no índice, no mesmo
  padrão das demais linhas da tabela.

---

## 8. Questões em aberto

- **Q-PET-01** O motor de effects MVP (`17-sistema-pf2e.md` DEC-PF2-04) hoje
  assume que um effect muta o próprio Actor portador do item. Companions
  exigem effects cujo alvo é **outro Actor** (o companion vinculado ao
  mestre). Precisa decidir, na hora da implementação, se isso é uma extensão
  pequena do motor existente (um seletor `target: "linkedCompanion"`) ou um
  mecanismo separado. Esta spec assume a extensão pequena, mas não a
  especifica em detalhe (fora do escopo de uma spec de pesquisa).
- **Q-PET-02** A ordem de derivação cross-actor (companion lê o mestre já
  preparado) precisa se encaixar na derivação topológica `DeriveStep` de
  `15-api-de-sistemas.md`, que hoje é especificada dentro de um único Actor.
  Precisa avaliar se isso vira uma fase extra do boot/recalc (recalcular
  mestres antes de companions) ou um hook pós-`prepareData` do mestre que
  dispara recomputo do(s) companion(s) vinculado(s).
- **Q-PET-03** Não foi encontrado, nos packs enumerados nesta pesquisa, um
  compendium pronto de "tipos de animal companion" com a tabela
  young/mature/incredible por criatura — pode existir em outro pack não
  varrido (ex. dentro de bestiários) ou pode ser responsabilidade do GM
  configurar manualmente no sistema oficial. Precisa investigação adicional
  antes de comprometer REQ-PET-040 a um formato de importação específico.
- **Q-PET-04** Vínculo companion↔mestre quando o companion "morre" e é
  substituído (ex. regra "Undying" do familiar da Witch, ou perda de animal
  companion) — este documento não especifica o fluxo de "substituir
  companion mantendo histórico"; precisa decisão de produto (soft-delete +
  novo Actor vs. reset de campos no mesmo Actor) antes da implementação.
- **Q-PET-05** Em qual marco do roadmap (`27-roadmap-e-milestones.md`) este
  subsistema entra. O roadmap atual já cita `familiar` como actor type [V2]
  agrupado em M6 (linha "actor types `familiar`/`party`/`vehicle`"); dado que
  o MVP proposto aqui (familiar de Wizard/Witch + animal companion de
  Druid/Ranger) é sensivelmente menor que "tela completa de Pets com
  mounts", pode valer a pena fatiar: um subconjunto mínimo em M3/M4 (junto
  do PF2e MVP) e o resto (mounts, pet archetype avançado, UI rica) em M6.
  Fica registrado como questão de fase, não decidido nesta spec.

---

## 9. Fontes e atribuição

- Regras mecânicas do Pathfinder 2e Remaster são publicadas sob a
  **ORC License** pela Paizo/Azora Law; esta spec parafraseia comportamento
  mecânico, sem citar texto de regra literal.
- O repositório `foundryvtt/pf2e` (vendorizado em
  `tools/importer-pf2e/vendor/pf2e/`) é licenciado **Apache-2.0**; os
  arquivos JSON de dados citados nesta spec (`familiar-abilities/*.json`,
  `feats/class/shared-class-feats/*.json`, `feats/class/druid/*.json`,
  `feats/class/ranger/*.json`, `feats/general/level-1/pet.json`,
  `feats/archetype/familiar-master/*.json`, `class-features/animal-
order.json`, `class-features/familiar-witch.json`,
  `actions/archetype/beastmaster/call-companion.json`,
  `actions/skill/command-an-animal.json`) foram usados como **evidência de
  modelagem de dados** (estrutura de campos, rule elements), não copiados
  literalmente para o Fusion. Qualquer implementação futura desta spec deve
  reescrever a automação do zero em `systems/pf2e`/`engine-2e`, seguindo a
  postura clean-room já registrada em `26-licencas-e-legal.md`.
- Nenhuma arte, ícone ou texto de lore da Paizo foi referenciado ou será
  importado — consistente com a política geral do importer
  (`16-compendiums-e-importacao.md`).

---

## Dependências (specs irmãs)

- `02-modelo-de-dados.md` — contrato de Document/Actor que o subtype
  `familiar` (companion) estende.
- `11-ui-framework-e-fichas.md` — contrato de tabs/sheets que a aba Pets
  consome.
- `15-api-de-sistemas.md` — contrato de derivação (`DeriveStep`) e motor de
  effects que precisam da extensão cross-actor (Q-PET-01/02).
- `16-compendiums-e-importacao.md` — pipeline de importação que converterá
  `familiar-abilities` e os feats do subsistema.
- `17-sistema-pf2e.md` — já lista `familiar` como actor type [V2]; esta spec
  é o detalhamento que faltava.
- `27-roadmap-e-milestones.md` — marco de implementação a definir (Q-PET-05).
- `26-licencas-e-legal.md` — postura clean-room/ORC/Apache-2.0 aplicada aqui.

---

## Referências

- `docs/research/10-pf2e-sistema-internals.md`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/familiar-abilities/`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/class/shared-class-feats/`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/class/druid/`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/class/ranger/`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/general/level-1/pet.json`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/archetype/familiar-master/`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/class-features/animal-order.json`
- `tools/importer-pf2e/vendor/pf2e/packs/pf2e/class-features/familiar-witch.json`
- `packages/client/src/lib/sheets/pf2e/planVM.ts`
