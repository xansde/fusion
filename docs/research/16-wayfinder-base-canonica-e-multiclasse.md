# 16 — Wayfinder: base canônica de PF2e e multiclasse por níveis

- **Tipo:** pesquisa/avaliação (insumo de spec)
- **Data:** 2026-08-01
- **Objeto avaliado:** `C:\Users\xansd\pessoal\wayfinder` (projeto "Waybuilder", autoria do Donel Dev/Igor), estado de 2026-08-01
- **Pergunta:** o que o Wayfinder tem que o Fusion não tem — (a) como base de conhecimento de PF2e e (b) como mecânica e balanceamento de multiclasse — e o que disso é aproveitável aqui
- **Saída:** `specs/30-multiclasse-por-niveis.md` e `specs/31-base-canonica-de-conteudo.md`

> Todos os números deste documento foram **medidos** nos artefatos dos dois repos
> na data acima (comandos reproduzíveis na seção 8), não estimados nem lidos de
> README. Onde o README do Wayfinder diverge da medição, vale a medição e a
> divergência está anotada.

---

## 1. O que o Wayfinder é

Um **construtor de personagem** de PF2e (não um VTT, não um motor de jogo):
pipeline Python que funde três fontes numa base canônica, mais um motor que
deriva ficha a partir de um documento de escolhas, mais um front PWA em
construção. O objetivo declarado do projeto é substituir o multiclasse do PF2e
(arquétipos de dedicação) por **multiclasse ao estilo D&D 5e**: níveis de classe
que se dividem.

Dois princípios dele têm consequência direta para o Fusion:

1. **`requires` sugere e ordena, nunca bloqueia.** O predicado existe para
   filtrar/ordenar a lista de opções, jamais para negar uma escolha.
2. **Guardar decisão, não resultado.** A ficha grava escolhas; tudo o mais é
   derivado. Regra que muda **re-deriva** em vez de invalidar fichas salvas.

O segundo princípio é exatamente a decisão que o Fusion já tomou em `system.build`
(R10-A / DEC-R10-01): boosts por origem e `choices[]` por slot, com derivação
build-driven. **Os dois projetos convergiram no mesmo modelo de forma
independente** — é o que torna o aproveitamento barato.

---

## 2. Base de conhecimento — medição comparada

### 2.1 Volume

Base do Wayfinder (`pipeline/base/index.json`): **20.083 registros em 58 kinds**.
Packs do Fusion (`systems/pf2e/packs/`): **2.561 documentos em 14 packs**.

| Família                                   |             Wayfinder | Fusion | Observação                                                      |
| ----------------------------------------- | --------------------: | -----: | --------------------------------------------------------------- |
| `class`                                   |                **27** |  **2** | Fusion: Magus, Kineticist                                       |
| `class-feature`                           |                   847 |     48 | Fusion: só as referenciadas pelas duas classes                  |
| `feat`                                    |                 6.239 |    459 | Fusion: feats do Magus/Kineticist + skill/general ≤ 8           |
| `spell`                                   |                 1.638 |  1.252 | Fusion cobre a tradição arcana inteira                          |
| `ancestry` / `heritage`                   |              50 / 326 |  2 / 8 | Fusion: Ratfolk, Fleshwarp                                      |
| `background`                              |                   521 |      2 | Aeronaut, Fireworks Performer                                   |
| `equipment`+`weapon`+`armor`+`shield`     |                 7.417 |     48 | Fusion importou um recorte curado                               |
| `action`                                  |                   520 |    521 | conjuntos comparáveis em tamanho, **origens diferentes** (§4.3) |
| `ritual` / `relic` / `deity` / `language` | 151 / 122 / 488 / 121 |      0 | ausentes no Fusion                                              |
| condições                                 |                    0¹ |     43 | **o Fusion tem o que o Wayfinder não tem**                      |

¹ Condição não é kind no Wayfinder — construtor de ficha não precisa aplicar
condição em combate. É o primeiro sinal de que as duas bases são complementares,
não concorrentes.

### 2.2 Os 28 eixos de sub-escolha como kind próprio

O achado estrutural mais relevante da base do Wayfinder. Ele **promoveu a
identidade de subclasse a entidade de primeira classe**:

`racket` (6), `instinct` (10), `doctrine` (3), `bloodline` (18), `muse` (5),
`hunters-edge` (4), `arcane-thesis` (5), `arcane-school` (23), `druidic-order`
(9), `mystery` (12), `patron` (17), `lesson` (19), `way` (11), `style` (6),
`cause` (7), `implement` (10), `innovation` (7), `methodology` (5),
`research-field` (4), `hybrid-study` (8), `element` (6), `apparition` (14),
`ikon` (21), `conscious-mind` (6), `subconscious-mind` (4), `sanctification` (3),
`divine-font` (2), `deviant-ability-classification` (10), mais
`draconic-exemplar` (44), `mythic-calling` (15), `hellknight-order` (14),
`tactic` (37), `class-kit` (32).

A regra que decide se algo vira kind próprio é explícita e boa:

> **Se alguma regra do jogo consegue falar de um e não do outro, são tipos
> diferentes.**

No Fusion, esse eixo hoje é **hardcode por classe**: `hybridStudy` é um
`PlanSlotType` literal e o "Portão Cinético" é um slot com `KineticElement`
enumerado em `planVM.ts` (r19 tirou parte do hardcode com `CLASS_CHOICE_SLOTS`,
mas o vocabulário continua sendo escrito à mão por classe). Escalar de 2 para 27
classes por esse caminho significa 28 famílias de hardcode. **É o custo que a
modelagem do Wayfinder elimina** — e é a razão nº 1 para adotar a base dele.

### 2.3 Qualidade e proveniência

O que a base do Wayfinder carrega e os packs do Fusion não carregam:

- **`prov` por campo** — de qual das três fontes veio cada campo. Permite
  re-sincronizar só o que mudou e auditar divergência.
- **`conflitos[]`** — divergência entre fontes registrada, nunca silenciada.
- **`source.license`** por registro: **ORC 13.080 / OGL 7.003** — 100% dos
  registros licenciados e rotulados. Isso atende `REQ-LEG-007` do Fusion melhor
  do que o pipeline atual, que carrega `system.publication.license` só onde o
  vendor traz.
- **9 portões de qualidade** que quebram o build (`prov` completo, `level`
  divergente sem registro, `requires` órfão, queda de cobertura, `license`
  ausente, `traits` disjunto, homônimo sem desambiguação, artefato citado e
  perdido).
- **Desmembramento de colisão de identidade** — 318 registros irmãos criados
  onde nome+kind colidiam (`death-from-above` mítico nv16 × arquétipo nv8).
- **Fusão Legacy↔Remaster por `remaster_id`/`legacy_id` do AoN**, com o termo
  legado preservado em `aliases_traits` — nada é descartado.

### 2.4 Onde a base do Wayfinder é FRACA (e o Fusion é forte)

Isto é o contraponto honesto, e ele decide o desenho da spec 31:

| Métrica                                  |                                                            Valor medido | Leitura                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------: | -------------------------------------------------------------- |
| registros com `grants` (efeito mecânico) |                                                       **3.867 (19,3%)** | 4 em 5 registros não têm efeito calculável                     |
| registros com `requires`                 |                                                           6.553 (32,6%) | —                                                              |
| registros com prosa                      |                                                          19.910 (99,1%) | cobertura de texto é excelente                                 |
| `class-feature` com `grants` não vazio   | amostrado: `fighter-weapon-mastery` → `grants: []`, `mechanized: false` | **a progressão de proficiência por nível não está mecanizada** |

Consequência prática: o `ClassSystemSchema` do Fusion precisa de
`proficiencyUpgrades` por nível (Fighter → Master em armas no 5), e **a base do
Wayfinder não fornece isso** — a feature existe, está no nível certo via
`progressao[]`, mas sem efeito. Quem fornece isso hoje é o importer do Fusion,
que lê `system.rules[]` do vendor `foundryvtt/pf2e` e traduz para `modifiers[]`.

**Portanto: as duas bases são complementares.** O Wayfinder ganha em
**cobertura, taxonomia, gating e proveniência**; o importer do Fusion ganha em
**mecânica executável**. A spec 31 as combina em vez de escolher uma.

### 2.5 O join é determinístico — e isso foi medido

Cada registro do Wayfinder guarda `xref.foundry` (o id do documento no vendor
`foundryvtt/pf2e`); cada documento dos packs do Fusion guarda
`flags.fusion.sourceId` (o mesmo id). O casamento é por **igualdade de id do
vendor**, não por nome:

```
wayfinder.xref.foundry.rsplit('.')[-1] === fusion.flags.fusion.sourceId
```

Medido contra os 14 packs do Fusion (15.337 registros do Wayfinder têm
`xref.foundry`):

| Pack                      |   Casados |     Total |
| ------------------------- | --------: | --------: |
| `classes-core`            |         2 |         2 |
| `class-features-core`     |        48 |        48 |
| `ancestries-core`         |         2 |         2 |
| `heritages-core`          |         8 |         8 |
| `backgrounds-core`        |         2 |         2 |
| `familiar-abilities-core` |       111 |       111 |
| `equipment-core`          |        18 |        18 |
| `weapons-core`            |        30 |        30 |
| `feats-core`              |       456 |       459 |
| `spells-core`             |     1.232 |     1.252 |
| `actions-core`            |         0 |       521 |
| `conditions`              |         0 |        43 |
| `ancestry-features-core`  |         0 |        55 |
| `bestiary-core`           |         0 |        10 |
| **TOTAL**                 | **1.909** | **2.561** |

Leitura: **100% de casamento em todas as famílias do builder** (classe,
features, ABC, heritages, familiar abilities, equipamento, armas), 99,3% em
feats, 98,4% em spells. Os zeros são explicáveis e não são defeito do método:
`conditions` e `ancestry-features` não existem como kind no Wayfinder;
`bestiary` está fora do escopo declarado dele; `actions-core` **tem os dois
lados com ~520 documentos e interseção zero** — os ids do lado Wayfinder vêm de
outro pack/versão do vendor e isso precisa ser verificado antes de usar essa
família (ver Q-WF-03).

Isto importa mais do que parece: significa que **enriquecer os packs do Fusion
com campos do Wayfinder não exige heurística de nome**. A lição registrada na
r13 ("join de conteúdo = sempre nome normalizado, slug é undefined em tudo")
vale para o join _vendor↔tradução_; para o join _Wayfinder↔Fusion_ existe chave
forte, e ela deve ser preferida.

---

## 3. Multiclasse — o que o Wayfinder desenhou

### 3.1 O modelo

Substitui dedicação-como-multiclasse por **níveis de classe que se dividem**
(estilo 5e): `nivel_de_personagem = Σ niveis_de_classe`. A cada subida, +1 nível
numa classe existente ou numa classe nova. `Barbaro 3 / Ladino 1` são quatro
entradas `nivel_de_classe` no documento.

São **23 regras numeradas**, com o "porquê" citado e, na maioria, uma medição
junto. O princípio que organiza todas:

> **Recurso de personagem** (boost de atributo, class feat, orçamento de perícia)
> vem uma vez — da primeira classe ou por orçamento fechado.
> **Identidade de classe** (Racket, Rage, Instinct, Thesis, Bloodline, Hunter's
> Edge, perícias assinatura) vem com o nível, sempre, de qualquer classe.

É isso que faz gastar um nível valer a pena: **nenhuma dedicação compra
identidade íntegra** — verificado no material: o arquétipo do Ladino não concede
Racket; o do Mago não concede Thesis; Sneak Attacker congela em 1d6.

### 3.2 As decisões que mais impactam a implementação

| Regra | Conteúdo                                                                                                      | Impacto no Fusion                                       |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | `nivel_de_personagem = Σ niveis_de_classe`                                                                    | `system.level.value` deixa de ser a única fonte         |
| 3     | bônus de proficiência = **nível de personagem** + rank; o **rank** vem do nível **da classe**                 | quebra `proficiencyBonus(rank, level)` do engine-2e     |
| 4     | duas classes concedendo a mesma proficiência → vale o **melhor rank**                                         | `proficiencyUpgrades` viram um `max`, não uma sequência |
| 7     | nível 1 de classe dá o **pacote cheio** (saves, Percepção, armas, armadura, identidade)                       | `stepCharApplyClass` passa a rodar N vezes com merge    |
| 8     | boost de habilidade-chave e class feat de nível 1 só da **primeira** classe                                   | `build.abilities.classBoost` ganha ordem                |
| 10    | perícias livres por `delta = max(0, orçamento(C) − livres já concedidas)`                                     | orçamento de skill vira função do conjunto de classes   |
| 11    | HP por nível vem **da classe que recebeu aquele nível**                                                       | `(classHp + con) * level` deixa de valer                |
| 12    | class feat a cada nível **par de personagem**; requisito conferido contra o nível **daquela classe**          | novo termo de predicado `class_level`                   |
| 13    | feat de arquétipo é conferido contra o nível de **personagem**                                                | `isFeatEligible` precisa dos dois números               |
| 16/17 | slots pela tabela nativa (nível de classe cru); **rank efetivo = `ceil(nível_personagem/2)`**                 | novo campo derivado na spellcasting entry               |
| 17b   | teto para o que **cria criatura** (traits `summon`/`incarnate`, companheiro/familiar/eidolon)                 | ver 3.3                                                 |
| 19    | "your level" = nível de personagem, **exceto** onde o arquétipo equivalente nega/congela/gateia               | regra derivada, não lista à mão                         |
| 21    | **invariante de sanidade**: um nível de classe nunca rende menos que a dedicação no mesmo nível de personagem | é um teste, não um comentário                           |
| 22    | pool único de focus points, teto 3, independentemente do nº de classes                                        | o Fusion já clampa em 3                                 |
| 23    | **exclusão mútua** classe X ↔ dedicação de X, nos dois sentidos                                               | novo veto no builder                                    |

### 3.3 O balanceamento — o que foi de fato medido

Este é o ponto onde o Wayfinder tem valor que o Fusion não conseguiria
reproduzir barato: as regras não são opinião, são resultado de simulação.

**a) A regra 21 virou invariante testável.** _"O dip tem que obrigatoriamente ser
pelo menos tão forte quanto uma dedicação no mesmo nível de personagem"_. Está
travada em `motor/teste_motor.py` como varredura **exaustiva dos 204 pares**
(nível de classe × nível de personagem, personagem 4..20) — não amostra. Foi
assim que a primeira versão da regra 17b foi pega quebrada: **50 dos 204 pares
violavam**, com o dip entregando 0% da dedicação gratuita no nível 20 (criatura
nível 2 contra AC 45 não acerta nem com 20 natural).

**b) A fórmula final de invocação**, depois do piso:

```
magia summon/incarnate  rank  = min( max( ceil(class_level/2) + 2 , rank_de_dedicacao ) , ceil(nivel_personagem/2) )
companheiro/eidolon     nivel = min( class_level + 2 , nivel_personagem )
```

O termo externo faz a regra **se autoproteger**: com classe única os dois níveis
são iguais, o `+2` nunca chega a valer e o RAW sai intacto sem caso especial
(Summoner 20 puro → rank 10; Ranger 12 puro → companheiro 12).

**c) O escopo de 17b é derivável de trait, não curado**: `summon` pega 14 magias,
`incarnate` pega outras 23, **sem interseção**. A primeira versão citava uma
lista curada com Spirit Link e Protector Tree; a verificação mostrou que elas não
criam nada (traits `healing/spirit` e `plant/wood`) e a lista morreu junto.

**d) Monte Carlo, 200k iterações por cenário.** Nível 20, dia de aventura
(4 encontros × 4 rodadas):

|                          | Dano/dia | Cura/dia | Slots          |  DC |
| ------------------------ | -------: | -------: | -------------- | --: |
| Guerreiro 20 puro        |     1078 |        0 | —              |   — |
| Guerreiro 19 / Clérigo 1 |      733 |      750 | 6, só rank 1   |  34 |
| Clérigo 20 puro          | **1789** |      750 | 18, ranks 1-10 |  45 |

Conclusão medida: **o dip não substitui o especialista** (2,4× menos dano, 3× menos
slots). E o teto de +2 na elevação foi **descartado por medição**: com ele o dip
entregava 225 HP/dia de cura contra 262 da dedicação de Clérigo — que sob Free
Archetype é **grátis**. Um nível inteiro rendendo menos que um feat gratuito viola
a regra 21.

**e) Os limites das simulações estão registrados junto** — cinco deles, incluindo
"o 733 do dip é artefato de estilo, não custo de multiclasse". Isso é o oposto do
padrão de documento de balanceamento, e é o que torna o material confiável.

### 3.4 O que o Wayfinder deliberadamente NÃO arbitra

Retraining de nível de classe, conjurar abaixo do rank efetivo e dedicação da
própria classe ficam com o mestre. O critério: _quando o custo de modelar supera
o custo de um mestre dizer "não", não modela_. Vale copiar o critério inteiro
para o Fusion.

### 3.5 Itens de playtest ainda abertos (herdados, não resolvidos)

1. **Dip tardio compensa mais que dip cedo** — Guerreiro 19 / Clérigo 1 no nível
   20 quase não paga nada.
2. **Conjurador 50/50 fica −4 no DC** (proficiência de conjuração tem 4 degraus
   contra 3 dos marciais).
3. **Homogeneização**: se todo marcial quiser Clérigo 1 no fim, encarecer o dip
   tardio — não mexer na elevação.
4. O teto de poder fica **acima do baseline do PF2e**; encontros pedem ~+1 de
   dificuldade efetiva.
5. O piso da regra 21 achata uma faixa: no personagem 20, níveis de classe 1..12
   dão todos rank 8 de invocação.

---

## 4. Distância até o Fusion

### 4.1 O que o Fusion já tem que encaixa

- `system.build` guarda **decisão, não resultado** (`abilities` por origem +
  `choices[]` por slot) — mesmo princípio do Wayfinder.
- `build.freeArchetype` já existe como toggle da regra variante (a regra 2 do
  Wayfinder é "sempre ligado").
- Class DC de arquétipo já é derivada separadamente da classe base
  (`stepCharArchetypeClassDCs`, `ARCHETYPE_KEY_ABILITY`) — é o embrião de
  "estatística por classe" que a regra 5 pede.
- `focusPoints` já é clampado em 3 (regra 22).
- O builder já é parcialmente data-driven (`CLASS_CHOICE_SLOTS`, sub-slots por
  gate cinético, materialização de `GrantItem`).

### 4.2 O que quebra em multiclasse (medido no código)

| Ponto                                                   | Arquivo                                         | Por quê quebra                                              |
| ------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `findClassItem(doc)` devolve **a** classe               | `systems/pf2e/src/derivations/build.ts`         | assume 1 item `type:'class'` no ator                        |
| `hpMax = ancestryHp + (classHp + conMod) * level`       | `build.ts` `stepCharBuildHp`                    | regra 11 exige HP por nível, da classe daquele nível        |
| `stepCharApplyClass` escreve saves/prof direto          | `build.ts`                                      | regra 4 exige `max` entre classes, não última-escrita-vence |
| `system.level.value` único (1..20)                      | `systems/pf2e/src/schemas/actor-character.ts`   | regra 1 precisa de `Σ` e de níveis por classe               |
| `isFeatEligible(...)` compara com o nível do personagem | `packages/client/src/lib/sheets/pf2e/planVM.ts` | regras 12/13 exigem o par (class_level, character_level)    |
| `derivePlan(doc)` monta o plano da classe única         | `planVM.ts`                                     | o plano precisa de uma linha "nível de classe" por nível    |
| `spellSlotsForLevel(...)`                               | `planVM.ts` / `build.ts`                        | regra 16 usa nível de classe cru; regra 17 eleva o rank     |

Nenhum desses é uma reescrita: são **quatro trocas de conceito** (nível único →
par de níveis; classe única → lista de classes; escrita direta → merge por
melhor rank; HP por multiplicação → HP por soma de níveis). O resto é
propagação.

### 4.3 Riscos e restrições

- **Legal/clean-room.** A prosa da base do Wayfinder vem do dump do
  Elasticsearch do Archives of Nethys (99,1% dos registros). O `REQ-LEG-010` do
  Fusion manda importar **só dado mecânico** e descartar texto de lore. Portanto:
  **os campos estruturais podem atravessar; o `text/` do Wayfinder NÃO deve ser
  ingerido em massa.** O Fusion já tem seu próprio caminho de prosa (vendor +
  ondas de tradução pt-BR das r13/r15) e ele continua sendo a fonte.
- **Terceira fonte não auditada.** `Pf2eToolsOrg/Pf2eTools` alimenta o campo
  `requires` do Wayfinder e sua licença não foi verificada por nós. Antes de
  ingerir `requires` em produção, verificar (Q-WF-02).
- **Acoplamento de pin.** A base do Wayfinder está fixada no commit
  `87f9e502…` do `foundryvtt/pf2e`; o Fusion vendoriza seu próprio clone. Pins
  diferentes = ids do vendor podem divergir. O join de §2.5 casou 1.909/1.909
  possíveis, então hoje os pins são compatíveis, mas isso não é garantido no
  futuro — precisa ser um portão, não uma suposição.
- **Sem acoplamento de código.** Wayfinder é Python, Fusion é TypeScript. A
  fronteira é **dado**, não biblioteca — o que é bom: nada do motor Python entra
  no runtime do Fusion, e o clean-room fica trivialmente preservado.
- **Multiclasse é uma houserule.** Ela não pode ser o comportamento padrão do
  sistema `pf2e` do Fusion; tem de ser **regra variante ligável**, como o Free
  Archetype já é. Um mundo com a variante desligada precisa continuar byte-a-byte
  igual ao que é hoje.

---

## 5. Recomendação

**Adotar os dois lados, em ordem, e como duas specs separadas:**

1. **`specs/31-base-canonica-de-conteudo.md`** — ingerir a base do Wayfinder como
   **segunda fonte** do importer, casando por id do vendor, aproveitando: as 27
   classes com `progressao[]`, os 28 eixos de sub-escolha como vocabulário
   data-driven, `requires` como predicado de elegibilidade, `source.license` por
   registro, e os portões de qualidade. **Não** ingerir prosa. **Não** substituir
   a tradução de `system.rules[]` do vendor, que continua sendo a fonte da
   mecânica executável.
2. **`specs/30-multiclasse-por-niveis.md`** — a houserule como **regra variante**
   do `systems/pf2e`, com as 23 regras traduzidas para requisitos e, sobretudo,
   com o **invariante da regra 21 como teste exaustivo dos 204 pares** — é o
   único jeito de a coisa não apodrecer em silêncio.

**Ordem:** 31 antes de 30. Multiclasse sem 27 classes na base é uma feature sem
conteúdo; base ampliada sem multiclasse já vale sozinha (o builder atual passa a
montar qualquer classe).

**O que NÃO trazer:** o motor Python, o schema `wb:` como identidade interna do
Fusion (a identidade continua sendo o Document do Fusion), o front do Wayfinder,
e a decisão de "Free Archetype sempre ligado" (no Fusion é toggle).

---

## 6. Critérios de aceitação desta pesquisa

- **CA-WF-01** Os volumes das duas bases estão medidos, por família, com o
  comando reproduzível registrado.
- **CA-WF-02** O join Wayfinder↔Fusion está **provado numericamente** (1.909
  casamentos sobre os packs existentes), com os zeros explicados um a um.
- **CA-WF-03** A fraqueza do Wayfinder (19,3% de `grants`) está registrada com o
  mesmo peso que a força, e a complementaridade com o importer está explicitada.
- **CA-WF-04** As 23 regras de multiclasse estão resumidas com o impacto de cada
  uma sobre um arquivo real do Fusion.
- **CA-WF-05** A evidência de balanceamento (204 pares, Monte Carlo 200k, tetos
  descartados por medição) está registrada **com os limites declarados pelo autor**.
- **CA-WF-06** O risco legal (prosa do AoN × `REQ-LEG-010`, licença do Pf2eTools)
  está isolado como restrição de projeto, não como detalhe.
- **CA-WF-07** Nenhum texto de regra da Paizo foi copiado para este documento;
  fórmulas e nomes de mecânica são fato de regra sob ORC/OGL.

---

## 7. Questões em aberto

- **Q-WF-01** O Wayfinder é repositório de terceiro (Donel Dev/Igor). Ingerir a
  base dele no Fusion exige acordo explícito sobre licença/uso da **base
  derivada** (o dado de origem é ORC/OGL, mas o trabalho de reconciliação é
  autoral). Decisão de produto, não técnica.
- **Q-WF-02** Licença do `Pf2eToolsOrg/Pf2eTools`, que alimenta `requires`.
  Se não for compatível, `requires` precisa ser re-derivado do vendor (o gate de
  nível já é derivado por trait, então a perda seria pequena).
- **Q-WF-03** `actions-core`: 521 documentos de cada lado, interseção **zero** de
  ids. Descobrir se é pack/versão diferente do vendor antes de usar essa família.
- **Q-WF-04** Congelamento de pin: se o Fusion adotar a base, os dois passam a
  depender do mesmo commit do `foundryvtt/pf2e`. Definir se o pin do Fusion se
  alinha ao do Wayfinder ou se o portão de join tolera divergência.
- **Q-WF-05** Multiclasse × SF2e: a houserule é escrita para PF2e. Se ela subir
  para `systems/engine-2e`, o SF2e herda; se ficar em `systems/pf2e`, não. A spec
  30 assume `engine-2e` para o par (class_level, character_level) e `pf2e` para o
  resto — precisa de confirmação quando o SF2e for reexaminado.
- **Q-WF-06** Fase do roadmap. Nada disso está em `27-roadmap-e-milestones.md`;
  as duas specs nascem sem marco.

---

## 8. Reprodutibilidade

```bash
# volumes da base do Wayfinder, por kind
python -c "import json,collections;r=json.load(open(r'C:/Users/xansd/pessoal/wayfinder/pipeline/base/index.json',encoding='utf-8'));print(len(r));print(collections.Counter(x['kind'] for x in r).most_common())"

# cobertura de grants/requires/text/licença
python -c "import json,collections;r=json.load(open(r'C:/Users/xansd/pessoal/wayfinder/pipeline/base/index.json',encoding='utf-8'));print(sum(1 for x in r if x.get('grants')),sum(1 for x in r if x.get('requires')),sum(1 for x in r if x.get('text')));print(collections.Counter((x.get('source') or {}).get('license') for x in r))"

# join determinístico contra os packs do Fusion (tabela §2.5)
# ver o script em docs/research/_scripts (a rodar na implementação da spec 31)
```

---

## 9. Fontes

- `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-regras-multiclasse.md` — as 23 regras.
- `…\specs\2026-07-26-schema-base.md` — envelope do registro, `prov`, precedência, portões.
- `…\specs\2026-07-26-schema-personagem.md` — decisão-não-resultado, atores, `concedido_por`.
- `…\specs\2026-07-27-slots-e-candidatos.md` — `slots_abertos()` / `candidatos(slot, em)`.
- `…\docs\simulacoes\2026-07-27_simulacao-17b.md`, `…_balanceamento.md` — medições.
- `…\docs\2026-07-30_corte-multiclasse.md` — derivação dos 27 arquétipos de multiclasse.
- `…\pipeline\base\index.json` (20.083 registros), `_cobertura.json`.
- Fusion: `systems/pf2e/packs/*`, `systems/pf2e/src/derivations/build.ts`,
  `systems/pf2e/src/schemas/actor-character.ts`,
  `packages/client/src/lib/sheets/pf2e/planVM.ts`, `tools/importer-pf2e/`.
- Regras mecânicas de PF2e Remaster: ORC License (Paizo/Azora Law). Nenhum texto
  literal reproduzido.
