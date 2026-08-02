# r21 — Ampliação da base: 5 classes ausentes (plano da rodada)

> Rodada de **conteúdo**, executada sob `specs/31-base-canonica-de-conteudo.md`.
> Feedback do usuário (2026-08-01), literal nos pontos que valem como restrição:
> "comece pela ampliação da base canônica, só tenha cuidado para não gerar
> redundâncias"; "foque em conseguir trazer as classes e as class feats"; "se uma
> classe herda algo, como um Shield Block que não é class feat, adapte para a
> nossa base, no mesmo modelo que já temos"; "cruze com os compêndios que já tem
> e priorize o que existir na nossa base"; "5 classes ausentes primeiro, um
> subagente para cada"; "ter uma classe conjuradora é importante"; mapa de nós
> por classe ao final; e os cadastros já feitos **pensando no multiclasse futuro**.

## 1. Escopo

**As 5 classes:** Fighter, Rogue, Ranger, Barbarian, **Wizard**.

Wizard é a conjuradora da leva por um motivo medido: `spells-core` já contém a
**tradição arcana inteira** (1.252 docs, todas as ranks + cantrips) e **todas as
458 focus spells** do vendor (curadoria da r12). Nenhuma outra classe conjuradora
entra sem importar ~1.000 magias novas. Divine/primal/occult ficam para a onda
seguinte, junto de Cleric/Druid/Bard.

**Entra:** doc de classe (progressão 1–20), class features (inclusive as
**compartilhadas**, tipo Shield Block), class feats, eixos de sub-escolha
(Instinct/Racket/Hunter's Edge/Arcane Thesis/Arcane School), focus spells do
Wizard (já presentes), e a integração no builder até a ficha montar ponta a ponta.

**Não entra:** ancestralidades/antecedentes novos, magias novas, bestiário,
arquétipos de multiclasse, a variante da spec 30 (só a **preparação** dela — §4).

## 2. As três regras duras da rodada

### R1 — Redundância zero por construção

Ninguém escreve `documents.json` à mão e **nenhum agente gera pack**. A curadoria
vira **configuração por classe** (arquivos disjuntos, um por agente) e os packs
são gerados **uma única vez, no fim, pelo pipeline determinístico**.

Mecanismos de dedupe, todos já existentes ou triviais de derivar:

| Risco                                                   | Mecanismo                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Feature compartilhada (Shield Block em N classes)       | conjunto de nomes é **união** (Set) das `items{}` das classes curadas        |
| Feature que já temos (Alertness, Weapon Specialization) | mesmo Set + mesmo `sourceId` do vendor ⇒ o doc já existente é reusado        |
| Feat pego por dois critérios                            | seleção é predicado sobre o conjunto único de docs transformados             |
| Magia já presente                                       | `isSpellsCoreDoc` já tem o ramo `existingSourceIds.has(sourceId)`            |
| Homônimo entre classes                                  | resolução por **nome canônico da uuid** do `items{}`, nunca por `entry.name` |

> A armadilha do `entry.name`: no `magus.json`, a entrada exibida como
> "Lightning Reflexes" aponta para `Compendium.pf2e.classfeatures.Item.Reflex
Expertise`. Quem casar por `entry.name` cria um documento fantasma. O nome
> canônico é **sempre** o segmento final da uuid.

### R2 — Prioridade ao que já existe

Antes de propor qualquer inclusão, o agente **cruza com os packs atuais** por
`flags.fusion.sourceId` e reporta o que já está lá. O que já existe é **reusado**;
o relatório do agente tem de listar explicitamente o conjunto reusado — é o
artefato que prova que a regra foi obedecida.

Features compartilhadas **já presentes** hoje (48 docs em `class-features-core`):
Alertness, Weapon Expertise, Weapon Mastery, Weapon Specialization, Greater
Weapon Specialization, Juggernaut, Resolve, Perception Expertise, Reflex
Expertise, Will Expertise, Light/Medium Armor Expertise, Light/Medium Armor
Mastery, Expert/Master Spellcaster.

Faltam (previsão a confirmar por agente): Shield Block, Armor Expertise, Armor
Mastery, Bravery, Evasion, Battle Hardened, Improved Flexibility, Greater
Resolve, Incredible Senses, e as exclusivas de cada classe.

### R3 — Nada de hardcode por classe

O vendor já publica os eixos de sub-escolha como **dado**, em
`system.traits.otherTags`:

| Eixo          | Tag do vendor                                           | Opções |
| ------------- | ------------------------------------------------------- | -----: |
| Instinct      | `barbarian-instinct`                                    |     10 |
| Racket        | `rogue-racket`                                          |      6 |
| Hunter's Edge | `ranger-hunters-edge`                                   |      4 |
| Arcane School | `wizard-arcane-school`                                  |     14 |
| Arcane Thesis | `wizard-arcane-thesis`                                  |      5 |
| _(já usados)_ | `magus-hybrid-study` (8), `kineticist-kinetic-gate` (6) |        |

Fighter não tem eixo. A derivação `otherTags: "<classe>-<eixo>"` → `system.category`
é **genérica**: o `CLASS_CHOICE_SLOTS` do `planVM.ts` já acende o slot a partir do
`featuresByLevel` da classe (r19), sem `if (className === ...)`.

`proficiencyUpgrades` também deixa de ser tabela autoral: deriva-se de
`subfeatures.proficiencies` de cada feature × o nível do `items{}` da classe
(fonte de verdade — o nível genérico do arquivo mente: `armor-expertise.json` diz
7, o Fighter concede no 11). **Teste de regressão obrigatório:** a derivação tem
de reproduzir as tabelas atuais de Magus e Kineticist item a item; se não
reproduzir, a derivação está errada, não as tabelas.

## 3. Divisão do trabalho

### 3.1 O que cada subagente faz (5 em paralelo, arquivos disjuntos)

Cada agente entrega **dois arquivos**, e só eles:

- `tools/importer-pf2e/src/curation/classes/<slug>.json` — a configuração da classe.
- `.fusion-build/r21/<slug>-relatorio.md` — evidência, decisões e riscos.

Conteúdo da configuração (schema fechado, definido em §3.3): identificação da
classe, eixos de sub-escolha, regra de seleção de class feats, features extras
fora do `items{}`, tabela de conjuração (só Wizard), focus spells, e as listas de
**dedupe** (o que já existe nos packs).

**Nenhum agente**: roda o importer, gera pack, edita `transform.mjs`,
`build-mvp-subset.mjs`, schema Zod, `planVM.ts` ou qualquer arquivo compartilhado.

### 3.2 O que a integração central faz (uma vez, sequencial)

1. Loader de curadoria: `curation/index.mjs` agrega os JSON e substitui os
   predicados ad-hoc de `build-mvp-subset.mjs`.
2. Derivação genérica de `proficiencyUpgrades` + regressão contra Magus/Kineticist.
3. Derivação genérica de `system.category` do eixo por `otherTags`.
4. Emissão dos campos de preparação para multiclasse (§4).
5. Geração dos packs, tradução pt-BR do delta, QA de acentos/enrichers.
6. Wiring do builder: `PlanSlotType` + `CLASS_CHOICE_SLOTS` + pickers.
7. Verificação adversarial e verificação viva.
8. Mapa de nós por classe (§5).

### 3.3 Schema da configuração por classe

```jsonc
{
  "class": "fighter", // slug
  "displayName": "Fighter",
  "vendorClassFile": "classes/fighter.json",
  "keyAbilityOptions": ["str", "dex"], // conferido contra o vendor
  "hp": 10,
  "choiceAxes": [
    // [] quando a classe não tem
    {
      "otherTag": "barbarian-instinct",
      "featureNameInItemsMap": "Instinct", // nome canônico da uuid
      "level": 1,
      "choose": 1,
      "optionCount": 10,
      "slotType": "instinct", // sugestão; o wiring central confirma
    },
  ],
  "classFeats": {
    "trait": "fighter",
    "includeSharedClassFeats": true, // feats de shared-class-feats com o trait
    "levelMax": 20,
    "extraNames": [], // exceções com justificativa no relatório
    "excludeNames": [],
  },
  "classFeatures": {
    "fromItemsMap": true, // sempre true
    "extraNames": [], // features referenciadas fora do items{}
    "sharedWithOtherClasses": ["Shield Block", "Alertness"],
    "alreadyInPacks": ["Alertness", "Weapon Specialization"],
    "missingFromPacks": ["Shield Block", "Armor Expertise"],
  },
  "spellcasting": null, // Wizard preenche (ver §3.4)
  "focusSpells": { "names": [], "alreadyInPacks": [] },
  "prerequisites": {
    "internalChains": [["Power Attack", "Furious Focus"]],
    "referencesOutsideSelection": [], // pré-requisito que aponta pra fora — decidir
  },
  "dedupe": {
    "featsAlreadyInPacks": [],
    "collisionsDetected": [], // homônimos, entry.name ≠ nome da uuid
  },
  "notes": [],
}
```

### 3.4 A exceção do Wizard

A tabela de conjuração **não existe estruturada no vendor** (a do Magus foi
transcrita do journal oficial na r10-B, e o batch errou na primeira tentativa —
a checagem contra o Pathbuilder pegou). Portanto, para o Wizard:

- A tabela de slots por nível é **fato de regra** (ORC, Player Core) e precisa ser
  transcrita com **fonte citada** e **conferida contra duas referências
  independentes** (o journal do vendor e uma ficha real de Wizard).
- Regra que já mordeu antes: **cantrips e slots por rank sobem em pares**, e
  slots de rank descartado **não persistem** no level-up.
- O slot extra da escola arcana (Arcane School / Curriculum) é um slot **por
  rank** adicional e não pode ser confundido com os slots normais.

## 4. Preparação para o multiclasse (spec 30) — obrigatória nesta rodada

Pedido explícito do usuário: os cadastros já têm de nascer prontos para um
multiclasse diferente do que o PF2e suporta. Sem isso, ampliar a base agora
significa **re-importar tudo depois**. Três adaptações, todas aditivas:

### 4.1 `system.requires` — predicado com os dois níveis

Todo feat e toda feature emitida ganha um predicado estruturado
(`specs/31` §5.2), derivado por trait — **nunca lido de texto**:

| O documento tem                      | Gate emitido                                                        |
| ------------------------------------ | ------------------------------------------------------------------- |
| trait de classe X + `category:class` | `{"class_level": {"X": {">=": N}}}`                                 |
| trait `archetype`                    | `{"character_level": {">=": N}}`                                    |
| trait de ancestria Y                 | `{"all": [{"character_level": {">=": N}}, {"has": "<ancestria>"}]}` |
| nenhum dos anteriores                | `{"character_level": {">=": N}}`                                    |

`archetype` vence trait de classe. O `prerequisites` textual do vendor
**continua existindo e sendo exibido** — o predicado é adição, não substituição
(REQ-BC-034: requisito não mecanizável fica como texto, nunca vira predicado
inventado).

Com a variante desligada os dois números são iguais e nada muda no
comportamento — é exatamente o REQ-BC-035.

### 4.2 `system.grantedBy` — de qual classe, em que nível **de classe**

Feature compartilhada não tem "um nível": Armor Expertise é 11 no Fighter e 7 em
outra classe. O doc da feature passa a carregar a lista de concessões conhecidas:

```jsonc
"grantedBy": [ { "class": "fighter", "level": 11 }, { "class": "ranger", "level": 11 } ]
```

Derivado dos `items{}` das classes curadas. Isso mata na origem o bug de ler o
`system.level` genérico do arquivo (que mente) e é o dado que o multiclasse por
níveis precisa para saber **qual** nível conta.

### 4.3 Semântica de nível declarada

`featuresByLevel[].level` e `proficiencyUpgrades[].level` são **níveis de
classe**. Hoje isso é indistinguível do nível de personagem; sob a spec 30 deixa
de ser. Fica declarado no schema (comentário normativo + campo
`levelBasis: "class"` no doc de classe) para que a leitura futura não dependa de
arqueologia.

## 5. O artefato final — mapa de nós por classe

Pedido do usuário: **um nó por feat, arestas = pré-requisitos, 20 colunas = níveis
de personagem**, por classe.

- **Dado:** gerado dos packs já construídos (script determinístico, versionado),
  não da cabeça de ninguém. Nó = feat (id, nome pt-BR + EN, nível, traits,
  categoria). Aresta = pré-requisito resolvido para outro nó.
- **Resolução de aresta:** casar o texto de `prerequisites` contra os nomes
  (normalizados, sem acento) do conjunto da classe + features + feats
  compartilhados. Pré-requisito que **não** resolve para um nó vira **atributo do
  nó** (ex.: "Trained em Atletismo"), nunca aresta inventada — e o relatório conta
  quantos ficaram sem resolver.
- **Forma:** página HTML autocontida, uma aba por classe, 20 colunas fixas
  (nível 1..20), nó posicionado na coluna do seu nível, arestas em curva; hover
  acende a cadeia inteira de pré-requisitos; clique abre o detalhe.
- **Serve para:** ver a densidade por nível, achar feat órfão (sem porta de
  entrada) e — o que interessa para a spec 30 — enxergar quais cadeias um dip de
  poucos níveis alcança.

## 6. Portões da rodada

Nenhum destes é opcional; a rodada não fecha sem todos.

1. `pnpm build` + typecheck + lint + boundaries verdes.
2. Suítes: client, pf2e, sf2e, importer, server — sem teste vermelho.
3. `packs-validation` verde com os packs novos (todo doc contra o Zod).
4. **Derivação de `proficiencyUpgrades` reproduz Magus e Kineticist item a item.**
5. **Zero duplicata**: nenhum `sourceId` repetido dentro de um pack nem entre
   packs; nenhum nome normalizado repetido dentro do mesmo pack sem desambiguação.
6. **Fichas reais intactas**: Tobias (Magus) e Finn (Kineticist) derivam
   exatamente igual — comparação campo a campo do `derived`.
7. Política legal: sem prosa de lore, sem arte da Paizo, `license` em todo doc
   novo (REQ-LEG-010/011, REQ-BC-050).
8. pt-BR principal + EN subtítulo em todo conteúdo novo, com a QA de acentos e de
   enrichers da r13/r15.
9. **Verificação viva**: montar uma ficha de cada classe nova no app real, até o
   nível em que o eixo de sub-escolha aparece, e conferir os números.
10. Mapa de nós gerado para as 7 classes (as 5 novas + Magus + Kineticist).

## 7. Ordem de execução

1. ~~Mapeamento do pipeline~~ (workflow `mapear-pipeline-conteudo-pf2e`).
2. **Fan-out: 5 agentes, um por classe** → configuração + relatório.
3. Integração central: loader, derivações, campos de multiclasse, packs.
4. Wiring do builder + tradução + QA.
5. Verificação adversarial (agentes independentes) + verificação viva.
6. Mapa de nós + artefato publicado.
7. Commit por entrega verde (entregas pequenas — regra do usuário), exe só no fim.
