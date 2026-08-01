# 31 — Base canônica de conteúdo PF2e (cobertura, taxonomia e proveniência)

- **Título:** Base canônica de conteúdo — segunda fonte, eixos de sub-escolha e portões de qualidade
- **Status:** draft v0.1
- **Data:** 2026-08-01
- **Baseada em:**
  - `docs/research/16-wayfinder-base-canonica-e-multiclasse.md` — medição comparada das duas bases e prova do join determinístico.
  - `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-schema-base.md` — envelope de registro, `prov` por campo, precedência por campo, portões de qualidade.
  - `16-compendiums-e-importacao.md` — pipeline atual do importer (esta spec o **estende**, não o substitui).
  - `26-licencas-e-legal.md` — `REQ-LEG-006/007/010/011`.

> **Aviso clean-room.** Esta spec trata de **dados** de regras publicadas sob
> ORC/OGL e de metadados de proveniência. Nenhum código de terceiro entra no
> runtime do Fusion: a fronteira com o projeto Wayfinder é um **arquivo de dados**,
> não uma biblioteca. Texto de lore continua fora (§4.3).

---

## 1. Objetivo

O builder de personagem do Fusion está pronto e funciona — mas com **2 classes,
2 ancestralidades e 2 antecedentes**. A limitação não é de motor: é de
**conteúdo e de vocabulário**.

Esta spec define como o Fusion passa de um recorte curado à mão para uma **base
canônica ampla**, usando a base do projeto Wayfinder como **segunda fonte** do
importer, sem abrir mão de nada do que já funciona e sem violar a política de
licenciamento.

Três problemas concretos a resolver:

1. **Cobertura.** 2 de 27 classes; 459 de 6.239 feats; 2 de 521 antecedentes.
2. **Vocabulário hardcoded.** Cada eixo de sub-escolha de classe (Estudo Híbrido
   do Magus, Portão Cinético do Kineticist) hoje é literal em `planVM.ts`.
   Escalar para 27 classes por esse caminho são ~28 famílias de hardcode.
3. **Proveniência e elegibilidade.** Os packs atuais não carregam de onde veio
   cada campo, nem um predicado de pré-requisito legível por máquina.

---

## 2. Escopo

### 2.1 Inclui

- Ingestão da base canônica como **segunda fonte** do `tools/importer-pf2e`,
  casada por id do vendor.
- **Eixos de sub-escolha** (racket, instinct, doctrine, bloodline, hybrid study,
  element, …) como dado, com um tipo de documento próprio.
- Campo `requires` (predicado estruturado) nos documentos importados, com
  semântica **ordena-e-marca, nunca bloqueia**.
- Metadados de **proveniência por campo** e **licença por registro**.
- **Portões de qualidade** que quebram o build de packs.
- Ampliação por ondas: das 2 classes atuais até as 27, com critério de parada por
  onda.

### 2.2 Não inclui

- **Prosa.** O texto continua vindo do pipeline atual (vendor + ondas de tradução
  pt-BR das r13/r15). A prosa da base canônica **não é ingerida** (§4.3).
- **Mecânica executável.** A tradução de `system.rules[]` do vendor para
  `modifiers[]` continua sendo do importer atual — a base canônica **não a
  substitui** (§4.2).
- Bestiário, perigos, veículos, conteúdo de aventura.
- A regra variante de multiclasse — `30-multiclasse-por-niveis.md`, que é
  **consumidora** desta spec.
- SF2e/Etmos: os packs deles não são afetados.

---

## 3. Conceitos

| Termo                     | Definição                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **base canônica**         | O `index.json` do projeto Wayfinder: ~20.083 registros PF2e reconciliados de três fontes, com proveniência e licença por registro. |
| **fonte primária**        | O clone vendorizado `foundryvtt/pf2e` — de onde vem a mecânica executável (`rules[]`) e a prosa.                                   |
| **segunda fonte**         | A base canônica — de onde vêm cobertura, taxonomia, progressão, `requires` e metadados.                                            |
| **join por id do vendor** | Casamento determinístico `wayfinder.xref.foundry` (cauda) ↔ `fusion.flags.fusion.sourceId`.                                        |
| **eixo de sub-escolha**   | Família de opções que define a identidade de uma classe e é escolhida uma vez (Racket, Instinct, Doctrine, Bloodline, …).          |
| **predicado `requires`**  | Expressão booleana estruturada de pré-requisito (`all`/`any`/`not` + termos), usada para **ordenar e marcar**.                     |
| **`prov`**                | Mapa campo → fonte que forneceu aquele valor.                                                                                      |
| **portão**                | Verificação que **quebra o build de packs** quando falha.                                                                          |

---

## 4. Decisões

### DEC-BC-01 — Segunda fonte, casada por id do vendor, nunca por nome

**Decisão:** a base canônica entra como **enriquecimento** dos documentos que o
importer já produz, casando `wayfinder.xref.foundry` (última componente) com
`fusion.flags.fusion.sourceId`. Onde não há casamento, o documento é importado
sem enriquecimento e o fato é **relatado**, nunca resolvido por heurística de
nome.

**Evidência (medida, pesquisa 16 §2.5):** 1.909 casamentos sobre os 2.561
documentos dos packs atuais — **100% em classes, class-features, ABC, heritages,
familiar abilities, equipamento e armas**, 456/459 em feats, 1.232/1.252 em
spells. Os zeros são famílias que não existem na base canônica (`conditions`,
`ancestry-features`), fora do escopo dela (`bestiary`) ou com id divergente
(`actions` — ver REQ-BC-092).

**Alternativas rejeitadas:**

- _Casar por nome normalizado_: a r13 já provou que nome é chave frágil para
  conteúdo (`slug` é `undefined` em tudo, homônimos legítimos existem — `Death
from Above` são dois feats distintos). Quando existe chave forte, usar a fraca é
  escolher o bug.
- _Substituir o importer pela base canônica_: perderia `rules[]`, prosa e as
  ondas de tradução (§4.2 e §4.3).

### DEC-BC-02 — A mecânica executável continua vindo do vendor

**Decisão:** `system.rules[]` do vendor → `modifiers[]` continua sendo a única
fonte de efeito mecânico. A base canônica fornece **taxonomia, progressão,
elegibilidade e metadados**.

**Racional (medido):** só **19,3%** dos registros da base canônica têm `grants`
(efeito calculável), e amostras críticas vêm vazias — `fighter-weapon-mastery`
tem `grants: []`, `mechanized: false`, apesar de estar no nível certo da
progressão. O `ClassSystemSchema` do Fusion precisa de `proficiencyUpgrades` por
nível, e isso a base canônica não fornece. **As duas bases são complementares, e
esta decisão é o reconhecimento disso.**

**Consequência:** conflito entre as duas fontes num campo mecânico resolve-se
**pelo vendor**, e a divergência é **registrada** (REQ-BC-051), nunca silenciada.

### DEC-BC-03 — Prosa não atravessa

**Decisão:** o campo `text`/prosa da base canônica **não é ingerido**. A
descrição dos documentos continua a do vendor, com as ondas de tradução pt-BR já
existentes.

**Racional:** a prosa da base canônica vem do dump do Archives of Nethys (99,1%
dos registros). O `REQ-LEG-010` manda importar apenas dado mecânico e descartar
texto de lore, e o `stripRuleProse` do importer já materializa essa política
(REQ-LEG-010 gerou reprocessamento de packs inteiros na r12). Abrir uma segunda
porta de prosa desfaria esse trabalho.

**Alternativas rejeitadas:**

- _Ingerir prosa só onde o vendor não tem_: cria conteúdo cuja política de
  licença difere por documento — exatamente o que o portão de arte/prosa existe
  para impedir.

### DEC-BC-04 — Eixo de sub-escolha é dado, não código

**Decisão:** cada eixo de sub-escolha vira um **tipo de item** (`choiceAxis`) num
pack próprio, e a classe declara quais eixos oferece e em que nível. O builder lê
isso; `CLASS_CHOICE_SLOTS` e o enum `KineticElement` deixam de ser a fonte de
verdade e passam a ser, no máximo, fallback.

```jsonc
// pack choice-axes-core — um doc por opção
{ "type": "choiceAxis", "name": "Ruffian",
  "system": { "axis": "racket", "class": "rogue", "level": 1, "grants": [...] } }

// no doc de classe
"system": { "choiceAxes": [ { "axis": "racket", "level": 1, "choose": 1 } ] }
```

**Racional:** a regra que decide se algo é um eixo próprio é publicada e boa —
_se alguma regra do jogo consegue falar de um e não do outro, são tipos
diferentes_. A base canônica já promoveu **28 eixos** a kind próprio (racket 6,
instinct 10, doctrine 3, bloodline 18, muse 5, hybrid-study 8, element 6,
apparition 14, ikon 21, …). Trazer isso como dado é o que permite ir de 2 para 27
classes sem 28 famílias de hardcode.

**Alternativas rejeitadas:**

- _Manter `PlanSlotType` literal por eixo_: cresce linearmente em código com o
  número de classes; foi o que a r19 já começou a desfazer com
  `CLASS_CHOICE_SLOTS`.
- _Tratar todo eixo como "class feature comum"_: perde a distinção que o
  predicado precisa fazer ("só para Warpriest" ≠ "pegou este feat"), que é
  justamente o que um `has` genérico não expressa.

### DEC-BC-05 — `requires` é predicado estruturado, e ele ordena e marca

**Decisão:** os documentos ganham `system.requires`: predicado estruturado com
operadores `all`/`any`/`not`/`>=`/`<=`/`==` e termos `class_level`,
`character_level`, `ability`, `proficiency`, `has`, `trait`,
`spellcasting_tradition`, `subclass`, `sense`, `focus_pool`, `has_actor`.

Semântica **obrigatória**: o predicado **ordena a lista e marca o que não
atende**; ele **nunca remove** uma opção. O que filtra é a **elegibilidade de
slot** (um feat sem trait `archetype` não é candidato ao slot de arquétipo) —
conceito distinto, e o único com poder de filtrar.

**Racional:** é o contrato que o builder do Fusion já pratica (`isFeatEligible`
marca, não some) e o que a spec 30 (DEC-MCL-06) exige. Ter o predicado
estruturado é o que permite que `class_level` exista como termo — sem ele, a
variante de multiclasse não tem como perguntar nada.

**Nota:** o gate de nível de um feat é **derivado**, não lido: no PF2e o
pré-requisito de um feat nunca menciona nível — o nível do feat _é_ o gate. A
regra de derivação (trait de classe → `class_level`; trait `archetype` →
`character_level`; trait de ancestria → `character_level` + ter a ancestria;
nenhum → `character_level`) é dado, e `archetype` vence trait de classe.

### DEC-BC-06 — Proveniência por campo e licença por registro

**Decisão:** todo documento enriquecido carrega
`flags.fusion.prov: Record<campo, fonte>` e `flags.fusion.license`
(`ORC` | `OGL`), e o build **falha** se um documento emitido não tiver licença.

**Racional:** `REQ-LEG-007` já exige metadado de licença por pack; por
**registro** é estritamente melhor e a base canônica já entrega (medido: ORC
13.080 / OGL 7.003, 100% dos registros). Proveniência por campo é o que permite
re-sincronizar só o que mudou e auditar divergência em vez de descobrir por
sintoma.

### DEC-BC-07 — Pin do vendor é acordo, não coincidência

**Decisão:** a base canônica declara o commit do `foundryvtt/pf2e` em que foi
construída; o importer compara com o pin do clone vendorizado do Fusion e
**falha** se divergirem sem uma entrada de exceção registrada.

**Racional:** o join de DEC-BC-01 depende de os ids do vendor coincidirem. Hoje
coincidem (1.909/1.909 possíveis), mas isso é propriedade dos pins atuais, não
uma garantia. Sem portão, a próxima atualização de vendor degradaria o
enriquecimento em silêncio.

### DEC-BC-08 — Ampliação por ondas, com critério de parada

**Decisão:** o conteúdo cresce em ondas, cada uma com um conjunto fechado de
classes e o mesmo gate de qualidade; uma onda só fecha quando todos os portões
passam e uma ficha real da nova classe é montada ponta a ponta.

**Ordem sugerida** (por dependência de mecânica, da menor para a maior):

| Onda | Classes                                                                                                  | Motivo                                                        |
| ---- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1    | Fighter, Rogue, Ranger, Barbarian                                                                        | marciais; eixos simples (instinct, racket, hunter's edge)     |
| 2    | Wizard, Cleric, Druid, Sorcerer, Bard                                                                    | conjuradores clássicos; exercita `spellcasting` por subclasse |
| 3    | Champion, Monk, Investigator, Swashbuckler, Alchemist, Witch, Oracle                                     | cadência extra (regra 15) e eixos incomuns                    |
| 4    | as demais (Summoner, Thaumaturge, Psychic, Gunslinger, Inventor, Exemplar, Animist, Commander, Guardian) | atores concedidos, ikons, apparitions                         |

Magus e Kineticist já estão dentro e servem de linha de base de regressão.

---

## 5. Modelo de dados

### 5.1 Enriquecimento nos documentos existentes

```typescript
// flags.fusion (delta)
interface FusionCanonFlags {
  /** id na base canônica, para rastreio (não é a identidade do Fusion). */
  canonId?: string; // "wb:class-feature/fighter-weapon-mastery"
  /** licença do registro. REQ-BC-050 */
  license?: "ORC" | "OGL";
  /** origem por campo. REQ-BC-051 */
  prov?: Record<string, string>; // { level: "vendor", requires: "canon", traits: "canon+vendor" }
  /** divergências entre fontes, quando houver. REQ-BC-052 */
  conflicts?: Array<{ field: string; vendor: unknown; canon: unknown; chosen: "vendor" | "canon" }>;
}
```

### 5.2 Predicado

```typescript
export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { class_level: Record<string, Comparison> }
  | { character_level: Comparison }
  | { ability: Record<AbilitySlug, Comparison> }
  | { proficiency: Record<string, Comparison> }
  | { has: string } // referência a outro documento
  | { trait: string }
  | { spellcasting_tradition: string }
  | { subclass: Record<string, string> } // { cleric: "warpriest" }
  | { sense: string }
  | { focus_pool: Comparison }
  | { has_actor: string };

type Comparison = { ">=": number | string } | { "<=": number | string } | { "==": number | string };
```

`class_level` e `character_level` são **termos separados sempre**, mesmo sob RAW,
onde os dois números são iguais — é o que permite a spec 30 existir sem migração
de dados.

### 5.3 Classe e eixos

```typescript
// system do doc de classe (delta sobre ClassSystemSchema)
interface ClassSystemDelta {
  /** Eixos de sub-escolha oferecidos por esta classe. DEC-BC-04 */
  choiceAxes: Array<{ axis: string; level: number; choose: number }>;
  /** Já existente: featLevels, skillIncreaseLevels, trainedSkills,
   *  proficiencyUpgrades, spellcasting, featuresByLevel — inalterados. */
}

// novo item type
interface ChoiceAxisSystem {
  axis: string; // "racket" | "instinct" | "doctrine" | ...
  class: string; // slug da classe dona
  level: number;
  requires?: Predicate;
  /** Efeitos: mesma estrutura de modifiers/grants já usada por classFeature. */
}
```

### 5.4 O que NÃO muda

`_id`, `name`, `type`, `img`, `system.description`, `system.rules`/`modifiers`,
e todo o pipeline de tradução. Um documento não enriquecido continua válido.

---

## 6. Requisitos funcionais

> **[BC]** = necessário para a base ampliada. **[V2]** = pós.

### 6.1 Ingestão

- **REQ-BC-001** [BC] O importer DEVE aceitar a base canônica como entrada
  opcional; sem ela, o pipeline atual roda inalterado e produz packs idênticos.
- **REQ-BC-002** [BC] O casamento DEVE ser por id do vendor
  (`xref.foundry` cauda ↔ `flags.fusion.sourceId`); casamento por nome é
  **proibido** neste pipeline.
- **REQ-BC-003** [BC] Documento sem casamento DEVE ser importado normalmente e
  contabilizado num relatório de cobertura de enriquecimento.
- **REQ-BC-004** [BC] O importer DEVE verificar o pin do vendor declarado pela
  base canônica contra o do clone vendorizado e falhar quando divergirem sem
  exceção registrada (DEC-BC-07).
- **REQ-BC-005** [BC] A prosa da base canônica NÃO PODE ser lida nem escrita em
  nenhum campo de saída (DEC-BC-03). **Critério verificável:** um teste que
  garante que nenhum campo de texto dos packs muda quando a segunda fonte é
  ligada.

### 6.2 Cobertura de conteúdo

- **REQ-BC-010** [BC] Cada onda (DEC-BC-08) DEVE emitir, para cada classe:
  o doc de classe com progressão completa (1..20), suas class features, seus
  eixos de sub-escolha e seus class feats.
- **REQ-BC-011** [BC] Ancestralidades, heranças e antecedentes DEVEM ser
  importados em massa (50 / 326 / 521 na base canônica), com boosts, perícias
  treinadas e feats concedidos estruturados.
- **REQ-BC-012** [BC] O pack de magias DEVE cobrir as quatro tradições, não só
  arcana.
- **REQ-BC-013** [V2] `ritual`, `relic`, `deity`, `domain` e `language` como
  packs próprios.
- **REQ-BC-014** [BC] Nenhum documento importado PODE conter arte, ícone ou path
  de asset da Paizo (`REQ-LEG-011`/`014` continuam valendo integralmente).

### 6.3 Eixos de sub-escolha

- **REQ-BC-020** [BC] O sistema DEVE registrar o item type `choiceAxis` com
  schema Zod e o pack `choice-axes-core`.
- **REQ-BC-021** [BC] O doc de classe DEVE declarar `choiceAxes[]` com eixo,
  nível e quantidade a escolher.
- **REQ-BC-022** [BC] O builder DEVE derivar os slots de sub-escolha **do dado**;
  nenhum eixo novo PODE exigir código novo. **Critério verificável:** adicionar
  a onda 1 (racket, instinct, hunter's edge) não altera nenhum arquivo `.ts`
  além de fixtures/testes.
- **REQ-BC-023** [BC] Os eixos hoje hardcoded (`hybridStudy`, portão cinético)
  DEVEM ser migrados para dado, mantendo o comportamento atual das fichas reais
  (Tobias, Finn) byte a byte no `derived`.
- **REQ-BC-024** [BC] Escolha aninhada (um eixo que abre sub-slots, como o portão
  cinético que concede impulsos por elemento) DEVE ser expressável em dado.

### 6.4 Predicado e elegibilidade

- **REQ-BC-030** [BC] Os documentos DEVEM carregar `system.requires` quando a
  fonte fornecer, no formato da §5.2.
- **REQ-BC-031** [BC] O gate de nível DEVE ser **derivado** por trait (regra em
  DEC-BC-05) e entrar como cláusula adicional de um `all`, sem sobrescrever o
  `requires` declarado nem duplicar cláusula já presente.
- **REQ-BC-032** [BC] O predicado DEVE ordenar a lista de candidatos e **marcar**
  o não atendido com motivo legível; ele NUNCA PODE remover uma opção da lista.
- **REQ-BC-033** [BC] A elegibilidade de **slot** DEVE continuar filtrando
  (é conceito distinto do requisito) e DEVE ser derivada de trait/campo, nunca de
  lista escrita à mão.
- **REQ-BC-034** [BC] Cláusula de pré-requisito que não é mecanizável (condição de
  ficção, filiação, alinhamento legado) DEVE ser preservada como **texto de
  requisito** exibido ao jogador, nunca convertida em predicado inventado.
- **REQ-BC-035** [BC] `class_level` e `character_level` DEVEM existir como termos
  distintos mesmo com a variante da spec 30 desligada.

### 6.5 Proveniência, licença e conflito

- **REQ-BC-050** [BC] Todo documento emitido DEVE ter `flags.fusion.license`.
- **REQ-BC-051** [BC] Todo campo enriquecido DEVE ter entrada em
  `flags.fusion.prov`.
- **REQ-BC-052** [BC] Divergência entre vendor e base canônica num campo comum
  DEVE ser resolvida pelo vendor nos campos mecânicos (DEC-BC-02) e **registrada**
  em `flags.fusion.conflicts`.
- **REQ-BC-053** [BC] `traits` DEVE ser tratado como **união** das fontes (com
  normalização legado→remaster e absorção por granularidade), nunca por escolha de
  uma fonte vencedora. Racional medido na fonte: escolher uma fonte destruía dado
  (`bastard-sword` perdia `two-hand-d12`) e 88% dos conflitos de base eram
  `traits` sem divergência real.
- **REQ-BC-054** [BC] O termo legado normalizado DEVE ser preservado num campo de
  alias; nada é descartado.

### 6.6 Portões de qualidade

O build de packs **falha** quando:

- **REQ-BC-060** [BC] Um documento emitido não tem licença (REQ-BC-050).
- **REQ-BC-061** [BC] Um documento enriquecido tem campo sem `prov`.
- **REQ-BC-062** [BC] Um `requires` referencia um documento que não existe nos
  packs emitidos.
- **REQ-BC-063** [BC] A cobertura (documentos por família, e % de enriquecimento)
  **cai** em relação ao build anterior sem justificativa registrada.
- **REQ-BC-064** [BC] Dois documentos do mesmo type têm o mesmo nome normalizado
  sem desambiguação explícita (homônimos legítimos existem e precisam ser
  **desmembrados**, não fundidos).
- **REQ-BC-065** [BC] Um nível declarado diverge entre as fontes sem entrada em
  `conflicts`.
- **REQ-BC-066** [BC] O pin do vendor diverge (REQ-BC-004).
- **REQ-BC-067** [BC] Um doc de classe tem `choiceAxes[]` citando um eixo sem
  nenhuma opção no pack correspondente.
- **REQ-BC-068** [BC] Qualquer portão que falhe DEVE nomear os documentos
  afetados; contagem sem lista não fecha o portão.

### 6.7 Compatibilidade e regressão

- **REQ-BC-090** [BC] Os packs atuais (Magus, Kineticist e conteúdo das r10–r20)
  DEVEM continuar válidos; as fichas reais existentes derivam igual.
- **REQ-BC-091** [BC] O tamanho do bundle embutido no executável DEVE ser medido
  por onda; crescimento além do orçamento de distribuição vira decisão explícita
  (packs sob demanda) e não um efeito colateral.
- **REQ-BC-092** [BC] A família `actions` NÃO PODE ser enriquecida até que a
  divergência de ids seja explicada (Q-WF-03 / interseção zero medida).

---

## 7. Requisitos não-funcionais

- **REQ-BC-200** [BC] O pipeline de enriquecimento DEVE ser **determinístico**:
  mesma entrada → mesma saída byte a byte (packs entram no git).
- **REQ-BC-201** [BC] O build completo de packs DEVE continuar rodando offline,
  a partir de fontes fixadas por pin.
- **REQ-BC-202** [BC] O relatório de cobertura DEVE ser um artefato versionado,
  comparável entre builds (é o que alimenta o portão REQ-BC-063).
- **REQ-BC-203** [BC] O carregamento dos packs pelo servidor DEVE continuar
  dentro do orçamento de boot atual com a base ampliada; se não couber, indexar
  sob demanda em vez de carregar tudo.

---

## 8. Critérios de aceitação

- **CA-BC-01** Ligar a segunda fonte não altera nenhum campo de texto dos packs
  (REQ-BC-005) e não altera o `derived` das fichas reais (REQ-BC-090).
- **CA-BC-02** O relatório de enriquecimento reproduz a tabela da pesquisa 16
  §2.5 e explica cada não-casamento.
- **CA-BC-03** Onda 1 fechada: Fighter, Rogue, Ranger e Barbarian montáveis no
  builder ponta a ponta, com eixo de sub-escolha vindo de dado.
- **CA-BC-04** Adicionar uma classe da onda 2 não exige alteração de código fora
  de fixtures (REQ-BC-022).
- **CA-BC-05** Todos os oito portões da §6.6 existem, falham o build e nomeiam os
  documentos afetados.
- **CA-BC-06** Um feat cujo requisito o personagem não atende **aparece na lista**,
  marcado, com motivo legível (REQ-BC-032).
- **CA-BC-07** Nenhum documento emitido carrega prosa da segunda fonte, arte da
  Paizo ou licença ausente.
- **CA-BC-08** `class_level` e `character_level` existem como termos distintos
  com a variante da spec 30 desligada (REQ-BC-035).

---

## 9. Questões em aberto

- **Q-BC-01** **Acordo sobre a base.** A base canônica é trabalho autoral de
  terceiro sobre dados ORC/OGL. Usá-la no Fusion exige acordo explícito de uso da
  base derivada (Q-WF-01 da pesquisa 16). É bloqueante para a implementação, não
  para a spec.
- **Q-BC-02** **Licença do `Pf2eToolsOrg/Pf2eTools`**, que alimenta o `requires`
  da base canônica. Se incompatível, `requires` é re-derivado do vendor — a perda
  seria pequena, porque o gate de nível já é derivado por trait (Q-WF-02).
- **Q-BC-03** **Formato de troca.** Consumir `index.json` diretamente ou definir
  um artefato de intercâmbio menor (só os campos que atravessam)? A segunda opção
  reduz o acoplamento e torna o portão de prosa trivial de provar.
- **Q-BC-04** **Sincronização.** A base canônica é um projeto vivo. Definir se o
  Fusion fixa um snapshot versionado (recomendado) ou acompanha o HEAD.
- **Q-BC-05** **Orçamento do executável.** Hoje ~128 MB com 11 packs. As 27
  classes + ABC completo + 4 tradições mudam a ordem de grandeza; decidir entre
  bundle maior e download de packs sob demanda (REQ-BC-091).
- **Q-BC-06** **Tradução.** Cada onda multiplica o volume a traduzir para pt-BR.
  A QA automatizada de tradução da r13 é pré-requisito de escala, não opcional.
- **Q-BC-07** Marco no roadmap (`27-roadmap-e-milestones.md`) — hoje inexistente.

---

## 10. Dependências (specs irmãs)

- `16-compendiums-e-importacao.md` — pipeline que esta spec estende; o estágio de
  enriquecimento entra entre `transform` e `build-mvp-subset`.
- `26-licencas-e-legal.md` — `REQ-LEG-006/007/010/011/014`; DEC-BC-03 e
  REQ-BC-014/050 são a aplicação direta deles.
- `17-sistema-pf2e.md` — consumidor: schemas de class/ancestry/background e o
  item type novo `choiceAxis`.
- `11-ui-framework-e-fichas.md` — o builder passa a montar slots a partir de dado.
- `30-multiclasse-por-niveis.md` — **consumidora**: precisa das 27 classes, dos
  eixos e do termo `class_level`.
- `25-testes-e-qualidade.md` — os portões da §6.6 são gates de CI.
- `22-instalacao-e-distribuicao.md` — Q-BC-05 (tamanho do executável).

---

## 11. Referências

- `docs/research/16-wayfinder-base-canonica-e-multiclasse.md`
- `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-schema-base.md`
- `…\specs\2026-07-27-slots-e-candidatos.md` (elegibilidade de slot × requisito)
- `…\pipeline\base\index.json`, `…\pipeline\base\_cobertura.json`
- `tools/importer-pf2e/src/{extract,normalize,transform,build-mvp-subset}.mjs`
- `systems/pf2e/packs/*`, `packages/client/src/lib/sheets/pf2e/planVM.ts`
- Dados de regras de PF2e Remaster sob ORC License (Paizo/Azora Law) e conteúdo
  legado sob OGL; nenhum texto literal reproduzido nesta spec.
