# 30 — Multiclasse por níveis de classe (regra variante)

- **Título:** Multiclasse por divisão de níveis de classe — regra variante do sistema PF2e
- **Status:** draft v0.1
- **Data:** 2026-08-01
- **Baseada em:**
  - `docs/research/16-wayfinder-base-canonica-e-multiclasse.md` — avaliação do projeto Wayfinder (base canônica + houserule de multiclasse), com medições.
  - `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-regras-multiclasse.md` — as 23 regras originais, com o racional e as simulações que as calibraram.
  - `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — mecânicas RAW (TEML, proficiência, spellcasting) sobre as quais a variante se aplica.

> **Aviso clean-room.** Esta spec descreve uma **regra de casa** (houserule) que
> se aplica sobre as regras do PF2e Remaster (ORC/OGL). As fórmulas de PF2e
> citadas são fato de regra publicada; a houserule é design original do projeto
> Wayfinder, incorporada aqui com atribuição. Nenhum código ou texto proprietário
> é reproduzido.

---

## 1. Objetivo

Especificar a regra variante **"multiclasse por níveis de classe"**: em vez de
multiclassar por arquétipo de dedicação (RAW), o personagem divide seus níveis
entre classes — `Bárbaro 3 / Ladino 1` num personagem de nível 4 — ao estilo de
D&D 5e.

A variante existe para uma mesa específica (o grupo do usuário) e **nunca** é o
comportamento padrão: um mundo com a variante desligada deriva exatamente como
hoje.

O que esta spec entrega:

1. O modelo de dados que representa a divisão de níveis, sem quebrar fichas
   existentes.
2. A tradução das 23 regras da houserule em requisitos verificáveis.
3. O par de números `(class_level, character_level)` como conceito de primeira
   classe no `systems/engine-2e`, e o que cada regra do PF2e passa a ler.
4. Os **invariantes de balanceamento** — em especial a regra 21 — como teste
   exaustivo, não como comentário.

---

## 2. Escopo

### 2.1 Inclui

- Toggle da variante em `system.build` e a compatibilidade retroativa integral.
- Representação da divisão de níveis como `choices[]` de tipo `classLevel`.
- Derivação: HP, proficiências, saves, class DC, perícias, slots de feat,
  conjuração e focus points sob a variante.
- Elegibilidade de feat com os dois níveis (`class_level` / `character_level`).
- Regras de teto para invocação e para atores concedidos (companheiro, familiar,
  eidolon).
- Exclusão mútua classe X ↔ dedicação de X.
- Suíte de invariantes de balanceamento.
- Apresentação mínima na ficha e no Plano (a divisão precisa ser legível).

### 2.2 Não inclui

- **Retraining** de nível de classe — decisão de mesa, não de app (§7.3).
- Rebalanceamento de encontros/DC por causa do teto de poder mais alto
  (item de playtest, §9).
- **SF2e**: a variante nasce em `systems/pf2e`; a fundação `(class_level,
character_level)` vai para `systems/engine-2e` e o SF2e pode adotá-la depois
  (Q-MCL-05).
- Conteúdo: as 27 classes que tornam a variante interessante vêm da
  `31-base-canonica-de-conteudo.md`. Esta spec funciona com 2 classes; só não
  vale muito a pena.
- Alteração do motor de effects/modifiers (`17-sistema-pf2e.md` DEC-PF2-04).

---

## 3. Conceitos

| Termo                     | Definição                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **nível de personagem**   | Soma dos níveis de classe. É o que hoje vive em `system.level.value`.                                                                           |
| **nível de classe**       | Quantos níveis o personagem gastou numa classe específica. Sob RAW é sempre igual ao nível de personagem; sob a variante, não.                  |
| **dip**                   | Ter poucos níveis (tipicamente 1–2) numa classe secundária.                                                                                     |
| **primeira classe**       | A classe escolhida no nível de personagem 1. Fonte única do boost de habilidade-chave e do class feat de nível 1.                               |
| **recurso de personagem** | Boost de atributo, class feat, orçamento de perícia: vem uma vez, por orçamento fechado.                                                        |
| **identidade de classe**  | Racket, Instinct, Doctrine, Thesis, Bloodline, Hunter's Edge, perícias assinatura: vem com o nível, sempre, de qualquer classe.                 |
| **rank de dedicação**     | O rank de slot de magia que a rota gratuita de arquétipo entrega naquele nível de **personagem** (1@4, 2@6, 3@8, 4@12, 5@14, 6@16, 7@18, 8@20). |
| **rank efetivo**          | Rank em que uma magia é lançada sob a variante: `ceil(nível_de_personagem / 2)`, com os tetos da §6.7.                                          |

---

## 4. Decisões

### DEC-MCL-01 — Regra variante ligável, default desligada, sem migração

**Decisão:** a variante é um toggle em `system.build.variantRules.classLevels`
(default `false`), no mesmo lugar e com a mesma natureza de
`build.freeArchetype`. Com o toggle desligado, **toda a derivação é a de hoje** —
não há caminho novo, não há campo novo lido, não há migração de mundo.

**Racional:** o sistema `pf2e` do Fusion é público e distribuído (`22-instalacao-
e-distribuicao.md`); uma houserule de uma mesa não pode virar comportamento
padrão de todos. E a compatibilidade tem de ser demonstrável, não prometida —
daí `REQ-MCL-002`.

**Alternativas rejeitadas:**

- _Sistema separado `systems/pf2e-houserules`_: duplicaria schemas, packs e
  fichas para mudar quatro conceitos de derivação.
- _Flag por mundo, fora do ator_: a ficha precisa ser interpretável isolada (é
  exportada, importada e lida por outro mundo); a variante muda o significado do
  documento e portanto pertence a ele.

### DEC-MCL-02 — Divisão de níveis como `choices[]` de tipo `classLevel`, não como campo novo

**Decisão:** cada nível de personagem gera uma entrada em
`system.build.choices[]` com `type: "classLevel"`, `level: N`,
`slot: "classLevel-N"` e `ref` apontando para a classe daquele nível. `Bárbaro 3
/ Ladino 1` são quatro entradas. Os itens `type: 'class'` embutidos no ator
continuam existindo — **um por classe distinta**, não um por nível.

**Racional:** o `BuildChoiceSchema` já é uma lista aberta de escolhas por nível
com `type` deliberadamente aberto (`z.string()`, não `z.enum`) exatamente para
isso. Reusar o mecanismo mantém o princípio "guardar decisão, não resultado":
remover o nível 4 é remover a entrada `em: 4`, e o resto re-deriva.

**Alternativas rejeitadas:**

- _`build.classLevels: Record<classSlug, number>`_: guarda o **agregado**, não a
  decisão — perde a ordem (a primeira classe importa, regra 8) e perde a
  correspondência nível↔classe (HP por nível, regra 11).
- _Um item `class` embutido por nível_: 20 itens `class` num ator nível 20,
  duplicando descrição e progressão; quebra `findClassItem` de forma pior.

### DEC-MCL-03 — `(class_level, character_level)` é fundação do engine-2e; a houserule fica no pf2e

**Decisão:** `systems/engine-2e` passa a expor um contexto de níveis
`LevelContext { characterLevel: number; classLevels: Record<string, number> }` e
as funções de proficiência/DC passam a recebê-lo em vez de um `level: number`
solto. **A semântica da houserule** (quais regras leem qual número) fica em
`systems/pf2e`.

**Racional:** o número que entra no bônus de proficiência é o de personagem
(regra 3), mas o **rank** vem do nível da classe — a distinção é estrutural e
qualquer sistema 2e que ganhe uma variante parecida precisa dela. Sob RAW os dois
números são iguais e a mudança é inócua, o que a torna barata de introduzir.

**Alternativas rejeitadas:**

- _Manter `level: number` e passar o nível "certo" em cada chamada_: espalha a
  decisão de qual nível usar por dezenas de call sites — é exatamente o tipo de
  erro que não aparece em teste de classe única, porque lá os dois são iguais.

### DEC-MCL-04 — Melhor rank vence; escrita direta vira merge

**Decisão:** quando duas classes concedem a mesma proficiência (armas, armadura,
saves, Percepção, class DC de cada classe), o valor derivado é o **maior rank**
entre as classes, e não o da última classe processada. O passo de derivação que
hoje escreve saves/proficiências passa a **acumular e reduzir por `max`**.

**Racional:** regra 4 da houserule. Além disso, `max` é comutativo — a ordem das
classes não muda o resultado, o que elimina uma classe inteira de bug
"dependente da ordem de itens no ator".

### DEC-MCL-05 — O nível 1 de classe é pacote cheio, e isso é aceito de olho aberto

**Decisão:** ganhar o primeiro nível de qualquer classe concede o pacote completo
daquela classe no nível 1 — saves, Percepção, proficiências de arma e armadura e
as **features de identidade** —, exceto o boost de habilidade-chave e o class
feat de nível 1, que vêm **só da primeira classe**.

**Racional:** é o que faz gastar um nível valer a pena; nenhuma dedicação compra
identidade íntegra. O custo é conhecido e aceito: Monge 1 / Guerreiro 1 no nível
de personagem 2 tem o melhor perfil defensivo do jogo. O nível fica gasto para
sempre.

**Nota de implementação:** "16 classes concedem class feat no nível 1" é uma
lista que **erra**. A lista tem de ser derivada da progressão da classe
(`31-base-canonica-de-conteudo.md` §progressão), nunca escrita à mão — o
Summoner concede "evolution feat", que é class feat com outro nome. Feat
concedido **por dentro** de uma feature de identidade (order feat do Druida)
acompanha a feature e não cai na exceção.

### DEC-MCL-06 — Elegibilidade marca, nunca bloqueia

**Decisão:** requisito não atendido — inclusive o veto de exclusão mútua da
regra 23 — **marca** a opção com o motivo e a mantém na lista, ordenada depois
das atendidas. O que **filtra** a lista é a elegibilidade de _slot_ (um feat sem
trait `archetype` não é candidato ao slot de arquétipo), não o requisito.

**Racional:** o Fusion não arbitra a mesa; e a distinção
"elegibilidade de slot FILTRA / requisito ORDENA e marca" é a que impede o
builder de esconder escolha legal. É a mesma postura já adotada em
`isFeatEligible` no `planVM.ts`.

### DEC-MCL-07 — O invariante de balanceamento é teste, não comentário

**Decisão:** a regra 21 ("um nível de classe nunca rende menos que a rota de
dedicação no mesmo nível de personagem") é implementada como **varredura
exaustiva dos 204 pares** `(nível de classe 1..20 × nível de personagem 4..20,
class_level ≤ character_level)`, e o CI falha se um único par violar.

**Racional:** no projeto de origem, a primeira versão da regra de teto de
invocação passava em revisão humana e **violava o invariante em 50 dos 204
pares** — com o dip entregando 0% da dedicação gratuita no nível 20. Amostra não
teria pego. Invariante vale em todo par ou não é invariante.

### DEC-MCL-08 — Três casos ficam com o mestre, de propósito

**Decisão:** **retraining** de nível de classe, **conjurar abaixo do rank
efetivo** e o abuso de **dedicação da própria classe via feats de "metade do nível
de personagem"** não são modelados. O app nunca **impede** esses casos — só não
os automatiza.

**Racional:** critério explícito e reusável — _quando o custo de modelar supera o
custo de um mestre dizer "não", não modela_.

---

## 5. Modelo de dados

### 5.1 Toggle e escolhas (delta sobre `CharacterBuildSchema`)

```typescript
// systems/pf2e/src/schemas/actor-character.ts (delta)

const VariantRulesSchema = z
  .object({
    /** Free Archetype (já existia como build.freeArchetype — mantido lá por compat). */
    /** Multiclasse por divisão de níveis de classe (spec 30). */
    classLevels: z.boolean().default(false),
  })
  .default({});

// CharacterBuildSchema ganha:
//   variantRules: VariantRulesSchema
//
// BuildChoiceSchema NÃO muda de forma: a divisão usa o `type` aberto.
//   { level: 3, slot: "classLevel-3", type: "classLevel", ref: "<uuid da classe>" }
```

### 5.2 Contexto de níveis (engine-2e)

```typescript
// systems/engine-2e — novo

export interface LevelContext {
  /** Σ dos níveis de classe. Sob RAW, igual a system.level.value. */
  characterLevel: number;
  /** Níveis por slug de classe. Sob RAW, { <classe>: characterLevel }. */
  classLevels: Readonly<Record<string, number>>;
}

/** Bônus de proficiência: o NÍVEL é o de personagem; o RANK vem de quem concede. */
export function proficiencyBonus(rank: ProficiencyRank, ctx: LevelContext): number;

/** Constrói o contexto RAW (uma classe) — caminho usado com a variante desligada. */
export function singleClassContext(classSlug: string, level: number): LevelContext;
```

### 5.3 Visão derivada (pf2e)

```typescript
// systems/pf2e — derived (nunca persistido)

interface DerivedClassLevels {
  characterLevel: number;
  classLevels: Record<string, number>; // { fighter: 3, rogue: 1 }
  firstClass: string; // regra 8
  /** Origem do rank final de cada proficiência, para auditoria na ficha. */
  proficiencyOrigin: Record<string, { rank: ProficiencyRank; from: string }>;
  /** Decomposição do HP por nível, para a ficha explicar o número. */
  hpByLevel: Array<{ level: number; class: string; hp: number; con: number }>;
}
```

---

## 6. Requisitos funcionais

> **[MC]** = necessário para a variante funcionar. **[V2]** = pós.
> A variante inteira é opcional; nenhum requisito daqui é MVP global.

### 6.1 Toggle e compatibilidade

- **REQ-MCL-001** [MC] O sistema DEVE expor `system.build.variantRules.classLevels`
  (boolean, default `false`) e só aplicar qualquer regra desta spec quando ele for
  `true`.
- **REQ-MCL-002** [MC] Com o toggle `false`, a derivação de um ator DEVE produzir
  resultado **idêntico** ao produzido antes desta spec. Critério verificável: para
  o conjunto de fichas-fixture existentes (Tobias, Finn), o objeto `derived` é
  igual campo a campo antes e depois da implementação.
- **REQ-MCL-003** [MC] Ligar o toggle num ator já montado NÃO PODE perder
  escolhas: as escolhas existentes são interpretadas como "todos os níveis na
  classe atual" e o ator continua derivando o mesmo resultado até que uma entrada
  `classLevel` diferente seja gravada.
- **REQ-MCL-004** [MC] O toggle DEVE aparecer na ficha ao lado do toggle de
  Arquétipo Livre, com rótulo pt-BR e subtítulo EN (regra r14 de i18n).

### 6.2 Estrutura de níveis

- **REQ-MCL-010** [MC] O nível de personagem DEVE ser `Σ` das entradas
  `type: "classLevel"`; a cada subida de nível, o builder DEVE oferecer +1 nível
  numa classe existente **ou** numa classe nova.
- **REQ-MCL-011** [MC] O sistema DEVE materializar **um** item `type: 'class'`
  por classe distinta do personagem, e a derivação DEVE ler todos eles.
- **REQ-MCL-012** [MC] `system.level.value` DEVE continuar sendo o nível de
  personagem e DEVE permanecer consistente com a soma (divergência = erro de
  validação, não correção silenciosa).
- **REQ-MCL-013** [MC] A **primeira classe** DEVE ser a classe da entrada
  `classLevel` de nível 1, e DEVE ser exposta em `derived.firstClass`.

### 6.3 Proficiência

- **REQ-MCL-020** [MC] O bônus total de proficiência DEVE ser
  `nível_de_personagem + rank*2` (rank > 0), com o **rank** determinado pelo
  nível **da classe que o concede**.
- **REQ-MCL-021** [MC] Quando duas ou mais classes concedem a mesma proficiência,
  o rank derivado DEVE ser o **maior**, e `derived.proficiencyOrigin` DEVE
  registrar de qual classe ele veio.
- **REQ-MCL-022** [MC] A Class DC DEVE ser calculada **por classe**, com o rank
  pelo nível daquela classe. Efeito que diz "your class DC" sem especificar qual
  DEVE usar a **maior** class DC do personagem.
- **REQ-MCL-023** [MC] NÃO DEVE existir fórmula de amolecimento de rank (nada de
  `floor((char+classe)/2)`): o rank é o da classe, cru.

### 6.4 Nível 1 de classe, HP e perícias

- **REQ-MCL-030** [MC] Ganhar o **primeiro** nível de uma classe DEVE conceder o
  pacote completo de nível 1 daquela classe: saves, Percepção, proficiências de
  arma e armadura e as features de identidade — sujeito ao `max` do REQ-MCL-021.
- **REQ-MCL-031** [MC] O boost de habilidade-chave e o class feat concedido no
  nível 1 de classe DEVEM vir **apenas** da primeira classe.
- **REQ-MCL-032** [MC] A lista de classes que concedem class feat no nível 1 DEVE
  ser **derivada da progressão da classe**, nunca de lista escrita à mão. Feat
  concedido por dentro de uma feature de identidade acompanha a feature e não é
  afetado pelo REQ-MCL-031.
- **REQ-MCL-033** [MC] O HP máximo DEVE ser
  `hpAncestralidade + Σ_{n=1..nível} (hpDaClasseQueRecebeuOnível_n + conMod) + bônus`.
  O HP de ancestralidade entra uma vez, no nível 1.
- **REQ-MCL-034** [MC] As perícias **automáticas** de uma classe nova DEVEM ser
  sempre concedidas (são identidade).
- **REQ-MCL-035** [MC] O orçamento de perícias **livres** DEVE seguir
  `delta = max(0, orçamento_livre(C) − total_de_escolhas_livres_já_concedidas)`,
  gastas dentro da lista de C; as perícias do REQ-MCL-034 não entram nessa conta
  de nenhum dos dois lados. **Critério verificável:** o total independe da ordem
  em que as classes foram tomadas.

### 6.5 Feats e cadência

- **REQ-MCL-040** [MC] O personagem DEVE receber um class feat a cada nível
  **par de personagem**, gastável em qualquer classe que ele tenha; o requisito de
  nível do feat DEVE ser conferido contra o nível **daquela classe**.
- **REQ-MCL-041** [MC] Feat de arquétipo (trait `archetype`) DEVE ser conferido
  contra o nível de **personagem**, mesmo quando pago com um slot de class feat.
- **REQ-MCL-042** [MC] A cadência básica do personagem (ancestry feat, general
  feat, skill feat, boosts de 5/10/15/20, skill increase) DEVE seguir o nível de
  personagem, sem alteração.
- **REQ-MCL-043** [MC] Quando uma **classe** concede cadência extra ("ganha X todo
  nível" — Ladino: skill feat e skill increase; Investigador: skill increase), o
  extra DEVE valer a partir do nível de personagem em que aquela classe entrou.
  A fonte DEVE ser a progressão da classe, não uma lista curada.
- **REQ-MCL-044** [MC] A elegibilidade de uma opção DEVE ser avaliada com o par
  `(class_level, character_level)` e, quando não atendida, DEVE aparecer marcada
  com o motivo legível — nunca omitida (DEC-MCL-06).

### 6.6 "Your level"

- **REQ-MCL-050** [MC] Em texto de regra, "your level" DEVE significar **nível de
  personagem**, exceto onde o arquétipo equivalente do PF2e **nega, congela,
  modifica ou gateia atrás de feat** a feature — nesses casos vale o nível
  **daquela classe**.
- **REQ-MCL-051** [MC] A lista de exceções do REQ-MCL-050 DEVE ser **derivada**
  do conteúdo do arquétipo correspondente, não escrita à mão. Casos conhecidos, a
  título ilustrativo e não normativo: advanced alchemy (congela), reação de causa
  do Campeão (gateia atrás de feat), elemental blast do Kineticist (gateia),
  Exploit Vulnerability do Thaumaturge (modifica).

### 6.7 Conjuração

- **REQ-MCL-060** [MC] O **número de slots** e o **rank base acessível** DEVEM vir
  da tabela nativa da classe, indexada pelo **nível de classe cru** — sem
  houserule.
- **REQ-MCL-061** [MC] O **rank efetivo** de truque, focus spell e magia de slot
  DEVE ser `ceil(nível_de_personagem / 2)`.
- **REQ-MCL-062** [MC] Para magia com trait `summon` **ou** `incarnate`, o rank
  DEVE ser
  `min( max( ceil(class_level/2) + 2 , rank_de_dedicação(character_level) ) , ceil(character_level/2) )`.
- **REQ-MCL-063** [MC] Para ator concedido (companheiro animal, familiar,
  eidolon), o nível DEVE ser `min( class_level + 2 , character_level )`.
- **REQ-MCL-064** [MC] O escopo do REQ-MCL-062 DEVE ser determinado **por trait**
  (`summon`, `incarnate`), nunca por lista curada de magias.
- **REQ-MCL-065** [MC] A elevação dos REQ-MCL-061/062 NÃO DEVE valer para slots
  vindos de arquétipo: Free Archetype e tudo que vem por ele roda RAW puro.
- **REQ-MCL-066** [MC] Focus points DEVEM ser um pool único do personagem, teto 3,
  independentemente do número de classes.
- **REQ-MCL-067** [MC] A ficha DEVE exibir, por spellcasting entry, o nível de
  classe, o rank máximo do slot, o **rank efetivo** e a elevação ganha — a
  houserule tem de ser legível na ficha, não só verdadeira no cálculo.

### 6.8 Arquétipos e exclusão mútua

- **REQ-MCL-070** [MC] Dedicações DEVEM continuar existindo como rota paralela,
  rodando RAW.
- **REQ-MCL-071** [MC] O sistema DEVE marcar como fora-do-requisito, nos **dois
  sentidos**, a combinação "nível de classe X + dedicação de X": não se toma a
  dedicação de uma classe que já se tem, nem nível de uma classe cuja dedicação já
  se tem. A marcação NÃO bloqueia (DEC-MCL-06).
- **REQ-MCL-072** [MC] O conjunto de arquétipos de multiclasse DEVE ser
  **derivado** (arquétipo cujo nome é nome de classe, ou dono de feat com trait
  `multiclass` — as duas vias devem concordar), nunca uma lista escrita à mão.
- **REQ-MCL-073** [MC] O motivo da marcação DEVE ser legível na UI ("a mesma
  magia sairia em dois ranks na mesma ficha"), não um booleano mudo.

### 6.9 Apresentação

- **REQ-MCL-080** [MC] A ficha DEVE exibir a divisão de níveis na identidade do
  personagem (`Guerreiro 3 / Mago 2`), em pt-BR com subtítulo EN.
- **REQ-MCL-081** [MC] O Plano DEVE ter, em cada nível, um slot "Nível de classe"
  preenchível com qualquer classe (existente ou nova), e a remoção dele DEVE
  cascatear as escolhas dependentes daquele nível.
- **REQ-MCL-082** [MC] O HP e cada proficiência DEVEM ser auditáveis na ficha:
  qual classe deu, em que nível (via `derived.hpByLevel` e
  `derived.proficiencyOrigin`).
- **REQ-MCL-083** [V2] Comparador na UI entre a rota de nível e a rota de
  dedicação equivalente, para o jogador ver o custo da escolha.

---

## 7. Requisitos não-funcionais e invariantes

### 7.1 Balanceamento (o coração desta spec)

- **REQ-MCL-200** [MC] **Invariante da regra 21.** Para todo par
  `(class_level, character_level)` com `1 ≤ class_level ≤ character_level` e
  `4 ≤ character_level ≤ 20` — os **204 pares** —, a rota de nível de classe NÃO
  PODE entregar menos, no eixo medido, que a rota de dedicação **gratuita** no
  mesmo nível de personagem. O teste DEVE ser exaustivo, jamais amostrado, e DEVE
  rodar no CI.
- **REQ-MCL-201** [MC] O invariante do REQ-MCL-200 vale **por eixo medido**; hoje
  o único eixo com teto explícito é invocação (REQ-MCL-062/063). Qualquer teto
  novo introduzido por esta spec DEVE vir acompanhado da varredura dos 204 pares
  para o seu eixo.
- **REQ-MCL-202** [MC] **Autoproteção do RAW.** Para classe única
  (`class_level == character_level`), todas as fórmulas desta spec DEVEM produzir
  exatamente o resultado RAW. Critério verificável: Summoner 20 puro → rank 10;
  Ranger 12 puro → companheiro nível 12; Mago 5 puro → elevação zero.
- **REQ-MCL-203** [MC] As fórmulas DEVEM ser **comutativas na ordem das classes**:
  montar `Guerreiro 3 → Mago 2` e `Mago 2 → Guerreiro 3` produz o mesmo `derived`,
  exceto no que depende explicitamente da primeira classe (REQ-MCL-031).
- **REQ-MCL-204** [V2] Reproduzir no repo o harness de simulação (Monte Carlo) que
  calibrou os tetos, para que uma mudança futura de regra possa ser medida em vez
  de argumentada.

### 7.2 Corretude e desempenho

- **REQ-MCL-210** [MC] A derivação sob a variante DEVE continuar **determinística
  e pura** (REQ-PF2-200) e caber no orçamento de 16 ms de recálculo
  (REQ-PF2-201) para um personagem de nível 20 com 3 classes.
- **REQ-MCL-211** [MC] Toda determinação canônica continua no **servidor**
  (REQ-PF2-203): a variante não introduz cálculo autoritativo no cliente.
- **REQ-MCL-212** [MC] O `derived` DEVE ser auditável: para cada número afetado
  pela variante, a origem (classe, nível) fica registrada.

### 7.3 O que o app não arbitra

| Caso                                                   | Por que fica fora                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Retraining de nível de classe                          | é negociação de ficha, não regra de construção                         |
| Conjurar abaixo do rank efetivo                        | é escolha tática no momento do lance                                   |
| Abuso de dedicação da própria classe via feats de gate | é abuso reconhecível, mais barato de coibir socialmente que de modelar |

---

## 8. Impacto no código existente

Levantado contra o código real (`docs/research/16-…` §4.2). Nenhum item é
reescrita; são quatro trocas de conceito propagadas.

| Alvo                                            | Arquivo                                         | Mudança                                                     |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `findClassItem(doc)` → `findClassItems(doc)`    | `systems/pf2e/src/derivations/build.ts`         | devolve lista; call sites passam a iterar                   |
| `stepCharApplyClass`                            | `build.ts`                                      | acumula por `max` (REQ-MCL-021) em vez de escrever direto   |
| `stepCharBuildHp`                               | `build.ts`                                      | soma por nível (REQ-MCL-033) em vez de multiplicar          |
| `stepCharBuildSkills`                           | `build.ts`                                      | orçamento por `delta` (REQ-MCL-035)                         |
| `proficiencyBonus(rank, level)`                 | `systems/engine-2e`                             | passa a receber `LevelContext` (DEC-MCL-03)                 |
| `spellSlotsForLevel`                            | `build.ts` / `planVM.ts`                        | indexa por nível de classe; expõe rank efetivo              |
| `isFeatEligible`                                | `packages/client/src/lib/sheets/pf2e/planVM.ts` | avalia com o par de níveis (REQ-MCL-044)                    |
| `derivePlan`                                    | `planVM.ts`                                     | slot "Nível de classe" por nível (REQ-MCL-081)              |
| `CharacterBuildSchema`                          | `systems/pf2e/src/schemas/actor-character.ts`   | `variantRules` (REQ-MCL-001)                                |
| `ARCHETYPE_KEY_ABILITY` / class DC de arquétipo | `systems/pf2e/src/derivations/archetypes.ts`    | vira caso particular de "class DC por classe" (REQ-MCL-022) |

---

## 9. Itens de playtest (registrados, não resolvidos)

Herdados do projeto de origem e ainda válidos aqui:

1. **Dip tardio compensa mais que dip cedo** — Guerreiro 19 / Clérigo 1 no nível
   20 quase não paga nada (o ataque usa nível de personagem).
2. **Conjurador 50/50 fica −4 no DC** — proficiência de conjuração tem quatro
   degraus (1/7/15/19) contra três dos marciais.
3. **Homogeneização** — se todo marcial quiser um dip de Clérigo no fim,
   encarecer o dip tardio; **não** mexer na elevação.
4. **Teto de poder acima do baseline** — pacote cheio + Free Archetype +
   best-of; encontros pedem ~+1 de dificuldade efetiva.
5. **Faixa achatada pelo piso** — no personagem 20, níveis de classe 1..12 dão
   todos rank 8 de invocação; a diferenciação volta no 13.

Nenhum destes é bug: são consequências medidas e aceitas. Viram issue se a mesa
reclamar, não antes.

---

## 10. Critérios de aceitação

- **CA-MCL-01** Com `variantRules.classLevels = false`, o `derived` das fichas
  fixture é idêntico ao de antes da implementação (REQ-MCL-002).
- **CA-MCL-02** Um `Guerreiro 3 / Mago 2` (personagem 5) deriva: HP decomposto
  por nível, proficiências com origem, slots de mago pelo nível de classe 2 e
  rank efetivo 3 (`ceil(5/2)`), com "elevação ganha +2" legível na ficha.
- **CA-MCL-03** A varredura dos 204 pares roda no CI e falha se um par violar o
  invariante da regra 21 (REQ-MCL-200).
- **CA-MCL-04** Classe única bate exatamente com o RAW nos três casos-canário do
  REQ-MCL-202.
- **CA-MCL-05** Montar as mesmas classes em ordens diferentes produz o mesmo
  `derived`, exceto os efeitos de primeira classe (REQ-MCL-203).
- **CA-MCL-06** Nenhuma lista de classes/arquétipos/exceções desta spec está
  escrita à mão no código: todas são derivadas de dado (REQ-MCL-032, 043, 051,
  064, 072).
- **CA-MCL-07** A dedicação da própria classe aparece na lista, marcada, com
  motivo legível — não some (REQ-MCL-071/073).
- **CA-MCL-08** Todos os requisitos estão numerados `REQ-MCL-NNN` e nenhum é
  marcado MVP global.

---

## 11. Questões em aberto

- **Q-MCL-01** Free Archetype: no projeto de origem a variante pressupõe
  **sempre ligado** (regra 2), e as simulações de balanceamento assumem isso. No
  Fusion é toggle independente. Decidir: (a) a variante de multiclasse **exige**
  Free Archetype ligado, (b) permite desligar e o invariante da regra 21 passa a
  comparar contra a rota paga. Esta spec assume (a) para efeito do REQ-MCL-200 e
  **não** força o toggle — precisa de decisão antes da implementação.
- **Q-MCL-02** Nível 20+ / mítico: fora de escopo, mas a soma de níveis torna
  fácil ultrapassar 20 por engano. Definir se o schema trava em 20 (hoje
  `z.number().max(20)`) ou se a variante abre.
- **Q-MCL-03** Interação com `29-pets-companions-familiars.md`: REQ-MCL-063
  define o nível do ator concedido; a spec 29 assume que o companion escala com o
  nível do mestre. As duas precisam concordar sobre qual número é "o nível do
  mestre" sob a variante.
- **Q-MCL-04** Export/import: uma ficha com a variante ligada não é
  representável em formatos de terceiros (Pathbuilder tem `class`/`level`
  únicos). Definir a projeção com perda declarada.
- **Q-MCL-05** SF2e herda? Ver Q-WF-05 da pesquisa 16.
- **Q-MCL-06** Marco no roadmap (`27-roadmap-e-milestones.md`) — hoje inexistente.

---

## 12. Dependências (specs irmãs)

- `31-base-canonica-de-conteudo.md` — fornece as 27 classes com `progressao[]`,
  os eixos de subclasse e os `requires` que os REQ-MCL-032/043/051/072 exigem
  como **dado derivado**. **Deve vir antes.**
- `17-sistema-pf2e.md` — consumidor: DEC-PF2-03 (derivação), REQ-PF2-011
  (proficiência), REQ-PF2-021 (HP), REQ-PF2-080..083 (spellcasting).
- `15-api-de-sistemas.md` — `DeriveStep`, ordem topológica; o `LevelContext`
  entra como leitura de mais um passo, sem mudar o contrato.
- `11-ui-framework-e-fichas.md` — Plano e ficha (REQ-MCL-080..082), i18n.
- `25-testes-e-qualidade.md` — a varredura dos 204 pares é um golden test 2e.
- `29-pets-companions-familiars.md` — Q-MCL-03.
- `26-licencas-e-legal.md` — postura clean-room; a houserule é design de
  terceiro incorporado com atribuição (Q-WF-01).

---

## 13. Referências

- `docs/research/16-wayfinder-base-canonica-e-multiclasse.md`
- `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-regras-multiclasse.md` (as 23 regras)
- `…\docs\simulacoes\2026-07-27_simulacao-17b.md` (os 50 pares violando; o piso)
- `…\docs\simulacoes\2026-07-27_balanceamento.md` (Monte Carlo 200k)
- `…\motor\teste_motor.py` (a varredura dos 204 pares, no projeto de origem)
- `systems/pf2e/src/derivations/build.ts`, `…/schemas/actor-character.ts`,
  `packages/client/src/lib/sheets/pf2e/planVM.ts`
- Regras de PF2e Remaster sob ORC License (Paizo/Azora Law) — parafraseadas,
  nunca copiadas.
