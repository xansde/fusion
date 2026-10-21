# 30 — Multiclasse por níveis de classe (regra variante)

- **Título:** Multiclasse por divisão de níveis de classe — regra variante do sistema PF2e
- **Status:** draft v0.2 (decisões de 19/10/2026: DEC-MCL-15 a 29)
- **Data:** 2026-08-01
- **Baseada em:**
  - `docs/research/16-wayfinder-base-canonica-e-multiclasse.md` — avaliação do projeto Wayfinder (base canônica + houserule de multiclasse), com medições.
  - `C:\Users\xansd\pessoal\wayfinder\specs\2026-07-26-regras-multiclasse.md` — as 23 regras originais, com o racional e as simulações que as calibraram.
  - `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — mecânicas RAW (TEML, proficiência, spellcasting) sobre as quais a variante se aplica.

> **Aviso clean-room.** Esta spec descreve uma **regra de casa** (houserule) que
> se aplica sobre as regras do PF2e Remaster (ORC/OGL). As fórmulas de PF2e
> citadas são fato de regra publicada; a houserule é design original do **Igor**
> (projeto Wayfinder), incorporada aqui **com autorização do autor** (2026-08-01)
> e com atribuição. Nenhum código ou texto proprietário é reproduzido.

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

| Termo                     | Definição                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **nível de personagem**   | Soma dos níveis de classe. É o que hoje vive em `system.level.value`.                                                                                      |
| **nível de classe**       | Quantos níveis o personagem gastou numa classe específica. Sob RAW é sempre igual ao nível de personagem; sob a variante, não.                             |
| **dip**                   | Ter poucos níveis (tipicamente 1–2) numa classe secundária.                                                                                                |
| **primeira classe**       | A classe escolhida no nível de personagem 1. Fonte única do boost de habilidade-chave (o class feat de nível 1 de classe vem de toda classe — DEC-MCL-14). |
| **recurso de personagem** | Boost de atributo, class feat, orçamento de perícia: vem uma vez, por orçamento fechado.                                                                   |
| **identidade de classe**  | Racket, Instinct, Doctrine, Thesis, Bloodline, Hunter's Edge, perícias assinatura: vem com o nível, sempre, de qualquer classe.                            |
| **rank de dedicação**     | O rank de slot de magia que a rota gratuita de arquétipo entrega naquele nível de **personagem** (1@4, 2@6, 3@8, 4@12, 5@14, 6@16, 7@18, 8@20).            |
| **rank efetivo**          | Rank em que uma magia é lançada sob a variante: `ceil(nível_de_personagem / 2)`, com os tetos da §6.7.                                                     |

---

## 4. Decisões

### DEC-MCL-01 — Regra variante ligável, default desligada, sem migração

> **Substituída por DEC-MCL-09** (2026-08-15) quanto ao **lugar** do toggle: ele deixa
> de morar no ator e passa a ser setting de mundo. O resto desta decisão — variante
> ligável, default desligada, derivação idêntica com ela desligada — continua valendo.

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

### DEC-MCL-04 — **REVOGADA por DEC-MCL-18 (19/10/2026)** — Melhor rank vence; escrita direta vira merge

> **Revogada por DEC-MCL-18 (19/10/2026)**: o modelo de "melhor rank" dá lugar à **fração** do documento da
> mesa (proficiências por fração; "CD é CD" — DEC-MCL-17). Texto original mantido abaixo como histórico.

**Decisão:** quando duas classes concedem a mesma proficiência (armas, armadura,
saves, Percepção, class DC de cada classe), o valor derivado é o **maior rank**
entre as classes, e não o da última classe processada. O passo de derivação que
hoje escreve saves/proficiências passa a **acumular e reduzir por `max`**.

**Racional:** regra 4 da houserule. Além disso, `max` é comutativo — a ordem das
classes não muda o resultado, o que elimina uma classe inteira de bug
"dependente da ordem de itens no ator".

### DEC-MCL-05 — O nível 1 de classe é pacote cheio, e isso é aceito de olho aberto

> **Emenda DEC-MCL-14 (18/10/2026)**: o class feat do nível 1 de classe **sai** da exceção —
> vem de toda classe cuja tabela (`featLevels.class`) lista o nível 1, quando ela recebe o seu
> nível de classe 1. Só o boost de habilidade-chave continua vindo da primeira classe.

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

> **Emenda DEC-MCL-13 (18/10/2026)**: no slot de **talento de classe** da multiclasse
> por níveis, talento de classe com nível **maior** que o nível de classe da classe
> dona do slot **sai da lista** (filtro, não marca). O resto desta decisão continua
> valendo para todos os outros casos (pré-requisito, acesso, exclusão mútua etc.).

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

### DEC-MCL-09 — O toggle é setting de mundo, não campo do ator

**Decisão:** a variante deixa de ser `system.build.variantRules.classLevels` no
personagem e passa a ser uma **setting de escopo `world`**, declarada pelo sistema PF2e
(REQ-SYS-047) e operada apenas na aba Configurações (spec 37, DEC-CFG-08). O mesmo vale
para **arquétipo livre** (`system.build.freeArchetype`). A ficha deixa de ter qualquer
controle de regra variante, e o campo sai do `CharacterBuildSchema`.

**Migração:** ao abrir um mundo pela primeira vez depois da mudança, se **qualquer** ator
tiver a regra ligada, a setting de mundo nasce ligada; depois disso o campo é removido
dos atores (REQ-CFG-034). Nenhuma build montada fica ilegítima pela migração.

**Racional:** regra variante é decisão de campanha. Com o toggle no ator, dois
personagens da mesma mesa podiam derivar sob regras diferentes — e quem ligava era o
jogador, dono da própria ficha, não o mestre, dono da campanha.

**O que esta decisão aceita perder:** DEC-MCL-01 rejeitou "flag por mundo" porque _a
ficha precisa ser interpretável isolada — é exportada, importada e lida por outro
mundo_. Isso continua verdade e passa a ser o custo assumido: uma ficha montada com
arquétipo livre, aberta num mundo sem a regra, tem talentos que aquele mundo não
concederia. O aviso disso é trabalho de quem implementar importação de ator
(`ver 16-compendiums-e-importacao.md`), não desta variante.

### DEC-MCL-10 — **REVOGADA por DEC-MCL-13 (18/10/2026) quanto à cadência** — Talento de classe de nível par é do dono do nível, não de "qualquer classe que o personagem tenha" (decisão do Alexandre, 26/09/2026)

> **Revogada em parte por DEC-MCL-13**: a cadência "a cada nível **par de personagem**"
> deixa de valer; o slot passa a seguir o nível **de classe** da classe dona do nível.
> Continua valendo a parte de propriedade: o talento do slot é da classe dona daquele
> nível (`classOwnerAt`), nunca de outra classe que o personagem tenha.

> **Emenda REQ-MCL-040**: a cláusula original "gastável em qualquer classe que ele
> tenha" é removida. O resto do requisito (cadência em todo nível par de personagem,
> requisito de nível do feat conferido contra o nível daquela classe) continua valendo.

**Decisão:** o class feat de um nível de personagem — inclusive nível **par** —
pertence exclusivamente à classe escolhida **naquele nível** (`classOwnerAt`, a mesma
classe que o slot `classLevel-<nível>` registra), e não a qualquer classe que o
personagem tenha acumulado em níveis anteriores. Um talento de uma classe que o
personagem tem, mas que não é a dona daquele nível específico, é `WrongClass` — não
existe "banco de talentos" compartilhado entre as classes de uma multiclasse.

**Exemplo (o mesmo da revisão que levantou a divergência):** Invocador nos níveis 1–2,
Feiticeiro no nível 3. O slot de talento de classe do nível 2 pertence ao Invocador; um
talento do Feiticeiro não cabe nele, mesmo o personagem já tendo (ou vindo a ter) as
duas classes na ficha.

**Racional:** picker (`pickerConfigFor`, via `classOwnerAt`) e ficha já implementavam
esse comportamento antes de qualquer conserto — a divergência era só textual, entre o
que a spec dizia e o que picker/validador faziam desde antes desta rodada. Formalizar o
comportamento existente evita reabrir a mesma pergunta a cada nova revisão.

**O que esta decisão aceita perder:** a leitura original de REQ-MCL-040 permitia gastar
o talento de nível par de QUALQUER classe do personagem — uma flexibilidade que nunca
chegou a ser implementada e que ninguém pediu de volta nesta revisão.

**Contexto:** achado I3 da revisão adversarial do PR `fix/ficha-feedback-22-09`
(satélite #161 / core #257, 25–26/09/2026) — `.fusion-build/classes-pendentes/
revisao-257-161.md`. Levada ao Alexandre como decisão pendente; confirmada em
26/09/2026.

### DEC-MCL-11 — **REVOGADA por DEC-MCL-12 (17/10/2026)** — PV usa a maior classe entre as TOMADAS, retroativo, sem soma por nível (decisão do Alexandre, 26/09/2026)

> **Emenda REQ-MCL-033**: a fórmula original — cada nível paga o PV da classe que o
> recebeu (`Σ hpDaClasseQueRecebeuOnível_n`) — é substituída por uma casa: todo nível
> paga o **maior** PV de classe entre as classes que o personagem TOMOU até o nível
> atual, e isso é **retroativo**.

**Decisão:** `hpMax = hpAncestralidade + nível × (max_{c ∈ classesTomadas} hpDaClasse_c +
conMod) + bônus`. "Classes tomadas" são as que receberam ao menos um nível de
personagem já alcançado (`levels.assignments`, REQ-MCL-033 original) — não qualquer
item `type:'class'` embutido na ficha (uma classe planejada para um nível futuro, ou a
classe secundária de um ator com a variante desligada, não conta ainda). Um Mago
nível 1 (PV 8) que depois assume Barbaro nos níveis 2–3 (PV 12) passa a pagar 12+conMod
nos **três** níveis, inclusive o Mago já lançado — é o ponto da casa, não uma
regressão. Uma classe tomada depois com PV **menor** que a já presente não abaixa o
máximo (é um `max`, não a última escrita).

**Racional:** casa de mesa do Alexandre — simplifica a conta na hora de jogar (um
único valor de "PV por nível" em vez de rastrear qual nível veio de qual classe) e
evita que uma dip tardia numa classe frágil "congele" o PV dos níveis anteriores.

**O que esta decisão aceita perder:** a leitura por nível de REQ-MCL-033 original
(cada nível carrega o PV da sua própria classe) deixa de valer; `hpByLevel`
(REQ-MCL-082) reporta o PV efetivo aplicado a cada nível, não o dado da classe que o
recebeu — a UI que viesse a consumir esse campo precisa ler `hp`, não inferir a classe
pelo `hp`.

**Contexto:** achado da revisão adversarial de `fix/classlevels-world-variant2` (core
#273) / `fix/hp-max-class-retroactive-dec-mcl-11` (satélite #278), 26/09/2026 —
`.fusion-build/classes-pendentes/revisao-273-278.md`. Decidida com o Alexandre no
mesmo dia.

### DEC-MCL-12 — PV volta a ser pago pela classe que recebeu cada nível (decisão do Alexandre, 17/10/2026; revoga DEC-MCL-11)

**Decisão:** `hpMax = hpAncestralidade + Σ_{n=1..nível} (hpDaClasseQueRecebeuOnível_n + conMod) + bônus`,
a fórmula original de REQ-MCL-033. Um Invocador 1 (PV 10) / Feiticeiro 2–3 (PV 6) com Con +1 paga
11 + 7 + 7, não 3 × 11. `hpByLevel` (REQ-MCL-082) volta a reportar o PV da classe de cada nível.

**Racional:** na mesa de A Queda (17/10/2026) a casa retroativa deixou PJs multiclasse com PV alto
demais (Tormentor: 44 em vez de 36). É também o modelo dos VTTs de referência para multiclasse por
níveis (5e no Foundry e no Roll20: cada nível de classe contribui o próprio dado de vida).

**O que esta decisão aceita perder:** a simplificação de "um único PV por nível" da DEC-MCL-11.

**Contexto:** revisão das fichas de A Queda, 17/10/2026 (satélite `fix/fichas-a-queda`, `b787ff57`).

### DEC-MCL-13 — O slot de talento de classe segue o nível DE CLASSE, não a paridade do nível de personagem (decisão do Alexandre, 18/10/2026; revoga a cadência da DEC-MCL-10)

> "Pessoa de interesse não pode aparecer no slot de nível 2 de personagem, pois é nível 1 de
> investigador. Pessoa de interesse é feat de classe nível 2, então só pode aparecer para ele quando
> for investigador 2+. Os slots de classe devem aparecer de acordo com o nível de classe,
> independente de se nível ímpar de personagem." — Alexandre, 18/10/2026

**Decisão:**

1. Na multiclasse por níveis, o slot de talento de classe de um nível de personagem nasce quando a
   classe **dona daquele nível** (`classOwnerAt`) chega a um nível **de classe** que a tabela da
   própria classe (`featLevels.class`) lista. A paridade do nível de personagem não conta mais.
2. ~~O talento de classe do nível 1 **de classe** continua vindo só da primeira classe
   (REQ-MCL-031)~~ — **revogado pela DEC-MCL-14 (18/10/2026)**: o talento do nível 1 de classe vem
   de toda classe cuja tabela lista o 1 (quem entra no Investigador no nível 2 de personagem ganha
   o primeiro talento de Investigador ali, no Investigador 1).
3. No seletor desse slot, talento de classe com nível maior que o nível de classe da dona do slot
   **não aparece** (filtro — emenda à DEC-MCL-06 só para este caso).
4. Talento já escolhido num slot que deixou de existir **não é apagado**: fica no seu nível,
   marcado como órfão ("sem slot neste nível pela regra atual"), legível e removível, para o
   Mestre resolver. Nada é movido automaticamente.

**Exemplos (as fichas de A Queda):** Huo (Ladino 1 / Investigador 2–3) — slots no nível 1 (Ladino 1)
e no nível 3 (Investigador 2); o `classFeat-2` dele vira órfão (**corrigido pela DEC-MCL-14**: o
Huo também tem slot no nível 2, Investigador 1). C.L.A.U.D.E. (Investigador 1 /
Necromante 2–3) — slots nos níveis 1 e 3. Tormentor (Invocador 1 / Feiticeiro 2–3) — slot só no
nível 3 (Feiticeiro 2; nenhuma das duas lista talento no nível 1 de classe).

**Racional:** a cadência por nível par de personagem dava ao Huo um slot de Investigador quando ele
era Investigador 1 (o talento de nível 2 da classe ficava inalcançável) e nenhum quando ele chegava a
Investigador 2. Seguir o nível de classe é o que a tabela de cada classe diz.

**O que esta decisão aceita perder:** o total de talentos de classe deixa de ser "1 + níveis pares"
fixo — passa a depender de como os níveis foram divididos entre as classes.

### DEC-MCL-14 — Pegar o nível 1 de uma classe é pegar a classe no nível 1, exceto perícias e boost-chave (decisões do Alexandre, 18/10/2026; emenda DEC-MCL-05, DEC-MCL-13 item 2 e REQ-MCL-031)

> "pegar nível 1 da classe é a mesma coisa de pegar a classe no nível 1, exceto pelas perícias.
> use PF WotR como exemplo. Lá tem exatamente onde eu quero chegar (Não o layout, mas as regras
> num todo)" — Alexandre, 18/10/2026
>
> "só a primeira classe dá o aumento de atributo chave" — Alexandre, 18/10/2026

**Decisão:**

1. Na multiclasse por níveis, **toda** classe que recebe o seu nível de classe 1 entrega o pacote
   de nível 1 dela — inclusive o **talento de classe do nível 1**, quando a tabela da própria classe
   (`featLevels.class`) lista o 1. O slot `classFeat-<nível>` nasce no nível de personagem em que a
   classe entrou. Classe cuja tabela não lista o 1 (Feiticeiro, Necromante, Mago, Clérigo…) não
   ganha talento ali — a lista é derivada da progressão (REQ-MCL-032), nunca escrita à mão.
2. **Perícias continuam como hoje** (REQ-MCL-034/035): automáticas sempre, livres pelo `delta`.
3. **Boost de habilidade-chave: só da primeira classe**, por decisão explícita — não é pendência.
   Uma classe que entra depois não aumenta atributo nenhum; a class DC dela usa a habilidade-chave
   declarada da própria classe (REQ-MCL-022).
4. A entrada de conjuração de uma classe nova nasce dimensionada pelo nível **de classe** 1 dela,
   não pelo nível de personagem em que ela entrou.
5. Talento que ficou órfão sob a DEC-MCL-13 e volta a ter slot **reocupa o slot sozinho** (o id
   `classFeat-<nível>` é o mesmo) — sem migração.

**Modelo:** Pathfinder: Wrath of the Righteous (regras, não layout) — ao multiclassar, o 1º nível da
classe nova dá as features, talentos e proficiências do nível 1 dela; o que é reduzido é perícia.

**Efeito nas fichas de A Queda (18/10/2026):** Huo (Ladino 1 / Investigador 2–3) ganha slot no
nível 2 (Investigador 1) além dos níveis 1 e 3. C.L.A.U.D.E. (Investigador 1 / Necromante 2–3),
Tormentor (Invocador 1 / Feiticeiro 2–3) e Bhrotto (Patrulheiro 1–3) não mudam: Necromante e
Feiticeiro não listam talento no nível 1 de classe; o Bhrotto tem classe única.

**O que esta decisão aceita perder:** o dip fica mais forte (um talento de classe a mais por classe
cuja tabela lista o 1). Entra no item 4 dos itens de playtest (§9).

**Contexto:** relato do Alexandre sobre a ficha do Huo Jinwu, 18/10/2026 (satélite
`fix/ficha-ler-talento`).

### Decisões de 19/10/2026 — o documento da mesa vira a fonte (DEC-MCL-15 a DEC-MCL-29)

> **Fonte:** `Mod PF2e — Multiclasse nível a nível` (documento da mesa, 27/09/2026) — "onde diverge da
> spec 30, vale o que está abaixo". **Decisão do Alexandre, 19/10/2026**, tomada ponto a ponto
> (D1 a D13; registro: `.fusion-build/magias-wotr/decisoes-2026-10-19.md`). A numeração é fixa:
> **DEC-MCL-(14 + N) = DN**. A spec 30 descrevia o modelo **"melhor rank por nível de classe"**
> (Wayfinder); o documento da mesa descreve o modelo **"fração"**. Esta seção troca o modelo onde os dois
> divergem e **não apaga** o texto histórico: cada decisão/requisito afetado ganha a marca
> "REVOGADA/emendada por DEC-MCL-NN" no lugar onde nasceu.
>
> Implementação desta rodada (satélite `feat/regras-plano-doc`): **D5, D7, D8, D9, D12, D13**. Ficam
> especificadas aqui, mas implementadas em outras frentes: D1, D3, D4 (proficiências por fração, outra
> frente), D10, D11.

### DEC-MCL-15 — Elevação de magia: toda magia pelo nível do PERSONAGEM; espaços, repertório, assinatura e entrada por CLASSE (D1)

**Decisão:** truque, magia de foco, magia inata e magia de espaço elevam todos pelo **nível de personagem**
(`ceil(nível_de_personagem / 2)`). Espaços, repertório, assinaturas e a entrada de conjuração são **por classe**,
dimensionados pelo nível **da classe** (modelo Pathfinder: Wrath of the Righteous). Mago 2 / Guerreiro 6 tem os
espaços de um mago 2 e eleva magia como personagem de nível 8.

**Efeito nos REQ:** REQ-MCL-060 mantido; REQ-MCL-061 **mantido e ampliado** (a magia inata entra na elevação);
REQ-MCL-062 **revogado** (DEC-MCL-24: sem teto de invocação). REQ-MCL-065 (Free Archetype roda RAW puro, sem
elevação) **conflita** com "elevação de magia inata" do documento — reconciliação em aberto (Q-MCL-07).

### DEC-MCL-16 — Pontos de foco: pool único, teto 3 (D2)

**Decisão:** a spec vence o documento: **um** pool de pontos de foco por personagem, **teto 3** (o documento
dizia "sem o máximo de 3"). **Efeito nos REQ:** REQ-MCL-066 **mantido**.

### DEC-MCL-17 — CD de magia e CD de classe: "CD é CD", por fração (D3)

**Decisão:** a proficiência de CD é **um bloco único**: toda classe soma fração no mesmo patamar; cada classe
mantém a própria CD com o atributo-chave dela; a CD de classe e a de ataque/CD de magia usam o **mesmo patamar**
("CD é CD"). Cada classe contribui com a melhor das suas duas progressões (CD de classe ou de magia; as
conjuradoras, a de magia). Mago 10 / Guerreiro 10 no nível 20 tem 10/15 + 10/19 = 1,19 de mestre.

**Efeito nos REQ:** REQ-MCL-022 (class DC por classe pelo rank da classe) **emendado**: o patamar é o da fração;
a DC continua por classe só no atributo. Ver DEC-MCL-18.

### DEC-MCL-18 — Proficiências por fração: o modelo de "melhor rank" deixa de valer (D4)

**Decisão:** armas, armaduras, Percepção, salvamentos (e CDs, DEC-MCL-17) seguem a **fração**: cada nível de uma
classe vale `1 ÷ (nível em que essa classe chega àquele patamar)`; quando a soma chega a 1, o personagem sobe de
patamar. Contagem **paralela** (um nível soma ao mesmo tempo para todos os patamares); o **excedente se perde**;
por **categoria** (simples, marcial, avançada, desarmado, cada tipo de armadura) usando a progressão geral da
classe; patamar extra em grupo específico é característica de classe, ganho pelo nível **na classe**, fora da
fração. **Bônus de salvamento** (Evasão, Juggernaut e afins) e efeitos presos a patamar (+2 de iniciativa,
especialização de armadura) só vêm pelo nível **da classe** que os dá. Proficiência dada por arquétipo geral vale
1/1 para o patamar que dá, sem avançar.

**Efeito nos REQ:** **REVOGA** DEC-MCL-04 (melhor rank vence), REQ-MCL-021 (`max` entre classes) e REQ-MCL-023
(sem amolecimento de rank — a fração **é** a regra de composição); REQ-MCL-020 **emendado** (o rank vem da fração
das classes; o bônus segue `nível_de_personagem + rank × 2`); REQ-MCL-203 (comutatividade) **continua valendo**
(a soma de frações é comutativa).

### DEC-MCL-19 — Dedicações de multiclasse proibidas (D5)

**Decisão:** sob a multiclasse por níveis, **dedicações de arquétipo multiclasse não são usadas**: somem do
seletor do Arquétipo Livre e de qualquer outro slot de talento. Arquétipos **gerais** (Fan Dancer, Marshal, Pistol
Phenom…) seguem permitidos. O conjunto proibido é **derivado** (REQ-MCL-072, mantido): dedicação com o trait
`multiclass`, ou cujo nome é "<Classe> Dedication" — as duas vias concordam no pack (teste). Ficha que já tem uma
**não é apagada**: o slot continua preenchido e fica **marcado em vermelho como ilegal**, com o motivo em pt-BR (a
mesma postura dos órfãos da DEC-MCL-13); o servidor só recusa a escolha **nova** (diff contra o documento
anterior, `MULTICLASS_ARCHETYPE_FORBIDDEN`). A ficha explica o porquê no slot do Arquétipo Livre.

**Efeito nos REQ:** **REVOGA** REQ-MCL-070 (dedicação como rota paralela) e REQ-MCL-071 (marcação de "classe X +
dedicação de X": a dedicação nem é oferecida); emenda DEC-MCL-06 (neste caso a elegibilidade de slot **filtra**,
não só marca); REQ-MCL-073 passa a valer para a marca de ilegalidade; a rota de dedicação gratuita deixa de ser
termo de comparação — REQ-MCL-200/201/083 perdem o objeto (o teste dos 204 pares fica como histórico até o piso
`dedicationSpellRank` ser retirado do código). Revoga também a regra do satélite que aceitava a dedicação e só a marcava.

### DEC-MCL-20 — Perícia fixa da classe nova: concedida de graça (D6)

**Decisão:** a perícia fixa da classe nova é **concedida** (como a spec já fazia), **não** pré-requisito de
entrada — o documento a tratava como pré-requisito; a mesa mantém a concessão. **Efeito nos REQ:** REQ-MCL-034
**mantido**.

### DEC-MCL-21 — Talento de perícia e aumento de perícia: pela tabela da CLASSE, no nível DA CLASSE (D7)

**Decisão:** o espaço de talento de perícia e o de aumento de perícia nascem quando a **classe dona do nível**
(`classOwnerAt`) chega a um nível **de classe** que a tabela dela lista — como o talento de classe (DEC-MCL-13).
Ladino 1 e 2 ganham; Guerreiro 1 não, Guerreiro 2 sim. A "cadência extra desde a entrada" deixa de existir;
talento ancestral, talento geral e aumento de atributo continuam pelo nível de personagem; o nível mínimo do
talento de perícia segue o do personagem.

**Efeito nos REQ:** **REVOGA** REQ-MCL-043; emenda REQ-MCL-042 (talento de perícia e aumento de perícia saem da
lista da cadência do personagem). Escolha já feita num nível que a tabela da classe dona não oferece mais **não é
apagada**: aparece como **órfã** (talento de perícia e aumento de perícia), para o Mestre resolver.

**Fichas de A Queda (conferidas contra as fichas vivas, só leitura, em 19/10/2026):** Huo Jinwu — `skillFeat-2`
(Distracting Performance) e `skillIncrease-2` (Furtividade) ficam órfãos (Investigador 1 não ganha); C.L.A.U.D.E.
— `skillFeat-2` (Quick Squeeze) e `skillIncrease-2` (Arcanismo) órfãos (Necromante 1); Tormentor — `skillFeat-2`
(Arcane Sense) e `skillIncrease-3` (Intimidação) órfãos (Feiticeiro 1 e 2); abrem slots novos: C.L.A.U.D.E.
`skillFeat-3` e `skillIncrease-3` (Investigador 2), Tormentor `skillFeat-3` (Feiticeiro 2). Bhrotto (classe única)
não muda.

**O que esta decisão aceita perder:** o dip em Ladino/Investigador deixa de render a cadência "todo nível" em
níveis de outra classe (a regra que entrou em 19/10 cedo, no satélite `fix/nivel5-pronto`, foi revertida).

### DEC-MCL-22 — Classe nova só em nível PAR de personagem; validada no servidor (D8)

**Decisão:** o nível 1 é a classe inicial; uma classe **nova** só entra em nível **par** de personagem; continuar
uma classe que já se tem vale em **qualquer** nível. O cliente já recusava (`canTakeNewClassAt`; o seletor de nível
ímpar só lista classes da ficha); agora o **servidor** também: `validateCharacterBuild` recusa um `classLevel` de
classe nova em nível ímpar (`NEW_CLASS_AT_ODD_LEVEL`), pelo nível **mais baixo** em que a classe aparece. A ficha
mostra o porquê no slot vazio ("Classe nova só em nível par…") e no seletor.

**Efeito nos REQ:** **emenda** REQ-MCL-010 (a cada nível, +1 numa classe existente **ou nova** — a nova só em nível
par). **Fichas de A Queda:** todas entram em classe nova no nível 2 (par): nenhuma fica ilegal.

### DEC-MCL-23 — Arquétipo Livre aceita também talento de classe (D9)

**Decisão:** o espaço do Arquétipo Livre ("um talento no nível 2 e em todo nível par") também pode receber um
**talento de classe** de uma classe do personagem, com nível **≤ o nível dele naquela classe** (não no de
personagem). O servidor aceita talento de classe nesse slot. **Efeito nos REQ:** REQ-MCL-041 ganha o caso inverso
ao que cobria (talento de classe no slot de arquétipo, medido pelo nível de classe).

### DEC-MCL-24 — Companheiros: nível do personagem; proficiências só pela classe que dá o companheiro (D10)

**Decisão:** companheiro animal, familiar e eidolon usam o **nível do personagem** como nível; as proficiências
vêm só das características e talentos da classe que os dá, **pelo nível nessa classe**, sem fração.

**Efeito nos REQ:** **REVOGA** REQ-MCL-062 (teto de invocação) e REQ-MCL-063 (`min(class_level + 2,
character_level)`) e, por consequência, REQ-MCL-064 (escopo por trait do 062); REQ-MCL-201 deixa de ter o único
eixo com teto. Q-MCL-03 se resolve no sentido "nível do mestre = nível do personagem".

### DEC-MCL-25 — "Seu nível" em habilidades de classe é o nível da CLASSE (D11)

**Decisão:** "seu nível" no texto de uma habilidade de classe (PV temporários da fúria, fraqueza da antítese, nível
dos itens do alquimista) vale o **nível da classe**; magias seguem DEC-MCL-15.

**Efeito nos REQ:** REQ-MCL-050/051 **emendados**: a regra geral deixa de ser "nível de personagem, exceto o que o
arquétipo equivalente nega/congela/gateia" e passa a ser "nível da classe nas habilidades de classe".

### DEC-MCL-26 — Arquétipos de classe bloqueados por enquanto (D12)

**Decisão:** arquétipos de **classe** (os de traits `archetype` + `class`: Avenger, Battle Harbinger, Spellshot…)
ficam **bloqueados**, por complicarem a implementação; a decidir no futuro. Mesmo tratamento da DEC-MCL-19 (somem
dos seletores; o que já existe na ficha fica marcado ilegal, sem apagar; o servidor recusa o novo).

### DEC-MCL-27 — Perícias adicionais ao entrar em classe nova: diferença contra a mais generosa (D13)

**Decisão:** ao entrar em classe **nova**, o personagem ganha a **diferença** entre o orçamento livre dela
(`additional + Int`) e o da **mais generosa das classes anteriores**, nunca negativa; o `Int` é o modificador do
**nível 1**. Ladino (7 + Int) → Psíquico (3 + Int) não ganha nada; Psíquico → Ladino ganha 4. Os slots nascem no
cartão do nível em que a classe entra, com a conta na nota do slot. _Assumido pelo documento — a confirmar com o
Alexandre._

**Efeito nos REQ:** **emenda** REQ-MCL-035 (`delta = max(0, orçamento(C) − max(orçamentos anteriores))`, não mais
"− total de escolhas livres já concedidas"); o critério "o total independe da ordem" **deixa de valer** (a ordem
das classes muda o delta: é o ponto do documento).

### DEC-MCL-28 — Talento de arquétipo ocupa o slot de talento de classe, pelo nível do PERSONAGEM (decisão do Alexandre, 19/10/2026; mesa A Queda)

**Pedido:** "quero poder pegar feat de dedicação no lugar de qualquer class feat, de acordo com o nível de
personagem." É o RAW do PF2e (Player Core, "Archetypes": a dedicação e os talentos seguintes do arquétipo ocupam
espaços de talento de classe) e vale para o slot de talento de classe **de qualquer classe, em qualquer nível**.

**Decisão:**

1. O slot de talento de classe aceita, além dos talentos da classe que o paga (DEC-MCL-13), qualquer talento com
   trait `archetype` — a dedicação e os talentos do arquétipo, **de qualquer categoria** (Twirl Through do Fan
   Dancer é de perícia) — e a dedicação que o vendor traz sem o `archetype` (Sanguimancer).
2. Esse talento é medido pelo nível do **PERSONAGEM** (documento da mesa: "Nível mínimo dos talentos (gerais, de
   perícia, de arquétipo) | Personagem"), **não** pelo nível da classe dona do slot: o talento de classe comum
   continua medido pelo nível de classe. Investigador 2 (nível de personagem 3) aceita talento de arquétipo de
   nível ≤ 3.
3. **Continuam valendo:** D5/D12 (DEC-MCL-19 e DEC-MCL-26: dedicação de multiclasse e arquétipo de classe não
   entram em slot nenhum; o servidor segue recusando a escolha nova com `MULTICLASS_ARCHETYPE_FORBIDDEN`); os
   pré-requisitos (inclusive os de item); a regra "uma dedicação por vez" e "só depois de 2 talentos do arquétipo
   anterior", **como marca** (DEC-MCL-06: a elegibilidade marca, nunca bloqueia).
4. O seletor do slot de classe lista os talentos de arquétipo elegíveis junto com os de classe, com o contador
   "N disponíveis / M no total" e os filtros compostos de sempre; os de arquétipo trazem o chip ARQUÉTIPO e o
   filtro de trait separa classe × arquétipo. O slot vazio traz a nota "Aceita também talento de arquétipo".
5. O servidor (`matchesFeatSlot`, `classFeat`) aceita o talento de arquétipo no slot de classe; o nível do slot
   no servidor já é o do personagem.

**Fora desta decisão (pendente com o Alexandre):** talento de classe de OUTRA classe no slot de classe. Não é
ativado; o ponto de troca no código é `archetypeInClassSlot` em `isFeatEligible`.

**Efeito nos REQ:** **emenda** REQ-MCL-041 (o talento de arquétipo também pode estar em slot de classe) e
DEC-MCL-19 (a dedicação **geral** deixa de ser oferecida só no Arquétipo Livre: custa um talento de classe, então não
reabre a "rota gratuita" revogada); a observação do satélite "isFeatEligible recusa 'dedication' em classFeat"
(C-6, Onda 5) **deixa de valer**.

### DEC-MCL-29 — Talento de perícia no lugar de talento de classe: regra da casa com TOGGLE (decisão do Alexandre, 19/10/2026)

**Pedido:** "Também gostaria de poder selecionar uma skill feat no lugar de uma class feat (isso através de um
toggle)." Não é RAW: é regra da casa **ligável**, no mesmo mecanismo das regras da casa de A Queda (REQ-CFG-039).

**Decisão:**

1. Setting de mundo `variantRules.skillFeatInClassSlot` (booleana, **desligada por padrão**, só o GAMEMASTER escreve,
   o jogador lê, confirmação ao desligar com a contagem de fichas afetadas). Fica em **Configurações → Mundo**,
   rótulo "Talento de perícia no lugar de talento de classe".
2. Ligada: o slot de talento de classe aceita também talento com `category: skill`, medido pelo nível do
   **PERSONAGEM** (como o de arquétipo, DEC-MCL-28), com os pré-requisitos normais (proficiência na perícia etc.:
   marca). Desligada: nada muda (o servidor recusa com `FEAT_SLOT_MISMATCH`).
3. Cliente (seletor, nota do slot: "…e talento de perícia — nível do personagem"), servidor
   (`validateCharacterBuild`, flag vinda do mundo) e derivação leem a MESMA setting. Talento de perícia que é também
   de arquétipo (Twirl Through) continua legal sem o toggle (DEC-MCL-28).
4. **Não está ligada no mundo a_queda**: o Alexandre liga pela interface.

---

## 5. Modelo de dados

### 5.1 Toggle e escolhas (delta sobre `CharacterBuildSchema`)

```typescript
// systems/pf2e/src/schemas/actor-character.ts (delta)

// DEC-MCL-09 (2026-08-15): o toggle NÃO mora mais no ator. As duas regras variantes
// são settings de escopo `world` declaradas pelo sistema pf2e (REQ-SYS-047):
//   "pf2e.variantRules.classLevels"   (boolean, default false) — spec 30
//   "pf2e.variantRules.freeArchetype" (boolean, default false) — regra do GMG
// `CharacterBuildSchema` NÃO ganha `variantRules` e PERDE `freeArchetype`; a derivação
// lê o valor do mundo. O bloco abaixo é o formato anterior, mantido só como rastro:
//
// const VariantRulesSchema = z.object({ classLevels: z.boolean().default(false) })
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

- **REQ-MCL-001** [MC] O sistema DEVE declarar a variante como setting de escopo
  `world` (boolean, default `false`, REQ-SYS-047) e só aplicar qualquer regra desta
  spec quando ela for `true` no mundo aberto (DEC-MCL-09). O ator NÃO DEVE carregar o
  toggle em `system.build`.
- **REQ-MCL-002** [MC] Com o toggle `false`, a derivação de um ator DEVE produzir
  resultado **idêntico** ao produzido antes desta spec. Critério verificável: para
  o conjunto de fichas-fixture existentes (Tobias, Finn), o objeto `derived` é
  igual campo a campo antes e depois da implementação.
- **REQ-MCL-003** [MC] Ligar o toggle num ator já montado NÃO PODE perder
  escolhas: as escolhas existentes são interpretadas como "todos os níveis na
  classe atual" e o ator continua derivando o mesmo resultado até que uma entrada
  `classLevel` diferente seja gravada.
- **REQ-MCL-004** [MC] O toggle DEVE aparecer na seção Mundo da aba Configurações
  (REQ-CFG-030/032), ao lado do de Arquétipo Livre, com rótulo pt-BR e subtítulo EN
  (regra r14 de i18n). NÃO DEVE existir controle de regra variante na ficha de
  personagem (REQ-CFG-033).

### 6.2 Estrutura de níveis

- **REQ-MCL-010** [MC] (emendado por DEC-MCL-22, 19/10/2026: classe **nova** só em nível par de personagem; o nível 1 é a classe inicial) O nível de personagem DEVE ser `Σ` das entradas
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

- **REQ-MCL-020** [MC] (emendado por DEC-MCL-18, 19/10/2026: o rank vem da **fração**, não do nível de uma classe) O bônus total de proficiência DEVE ser
  `nível_de_personagem + rank*2` (rank > 0), com o **rank** determinado pelo
  nível **da classe que o concede**.
- **REQ-MCL-021** [MC] ~~Quando duas ou mais classes concedem a mesma proficiência,
  o rank derivado DEVE ser o **maior**, e `derived.proficiencyOrigin` DEVE
  registrar de qual classe ele veio.~~ — **REVOGADO por DEC-MCL-18 (19/10/2026)**: a composição entre classes é a fração.
- **REQ-MCL-022** [MC] (emendado por DEC-MCL-17, 19/10/2026: patamar compartilhado, "CD é CD"; a DC continua por classe só no atributo-chave) A Class DC DEVE ser calculada **por classe**, com o rank
  pelo nível daquela classe. Efeito que diz "your class DC" sem especificar qual
  DEVE usar a **maior** class DC do personagem.
- **REQ-MCL-023** [MC] ~~NÃO DEVE existir fórmula de amolecimento de rank (nada de
  `floor((char+classe)/2)`): o rank é o da classe, cru.~~ — **REVOGADO por DEC-MCL-18 (19/10/2026)**: a fração é a regra de composição.

### 6.4 Nível 1 de classe, HP e perícias

- **REQ-MCL-030** [MC] Ganhar o **primeiro** nível de uma classe DEVE conceder o
  pacote completo de nível 1 daquela classe: saves, Percepção, proficiências de
  arma e armadura e as features de identidade — sujeito ao `max` do REQ-MCL-021.
- **REQ-MCL-031** [MC] (emendado por DEC-MCL-14, 18/10/2026) O boost de
  habilidade-chave DEVE vir **apenas** da primeira classe. O class feat do nível 1 de
  classe DEVE vir de **toda** classe cuja tabela (`featLevels.class`) lista o 1, no
  nível de personagem em que ela recebe o seu nível de classe 1.
- **REQ-MCL-032** [MC] A lista de classes que concedem class feat no nível 1 DEVE
  ser **derivada da progressão da classe**, nunca de lista escrita à mão. Feat
  concedido por dentro de uma feature de identidade acompanha a feature e não é
  afetado pelo REQ-MCL-031.
- **REQ-MCL-033** [MC] (restaurado por DEC-MCL-12, 17/10/2026; DEC-MCL-11 revogada) O HP
  máximo DEVE ser `hpAncestralidade + Σ por nível (hpDaClasseQueRecebeuOnível + conMod) + bônus`:
  cada nível de personagem paga o PV da classe que o recebeu. O HP de ancestralidade entra
  uma vez, no nível 1.
- **REQ-MCL-034** [MC] As perícias **automáticas** de uma classe nova DEVEM ser
  sempre concedidas (são identidade).
- **REQ-MCL-035** [MC] (emendado por DEC-MCL-27, 19/10/2026: o delta é contra a **mais generosa** das anteriores, Int do nível 1; o critério de ordem-independência deixa de valer) O orçamento de perícias **livres** DEVE seguir
  `delta = max(0, orçamento_livre(C) − total_de_escolhas_livres_já_concedidas)`,
  gastas dentro da lista de C; as perícias do REQ-MCL-034 não entram nessa conta
  de nenhum dos dois lados. **Critério verificável:** o total independe da ordem
  em que as classes foram tomadas.

### 6.5 Feats e cadência

- **REQ-MCL-040** [MC] (emendado por DEC-MCL-13, 18/10/2026) O personagem DEVE receber um
  class feat em cada nível de personagem em que a classe **dona daquele nível**
  (`classOwnerAt` — a mesma classe do slot `classLevel-<nível>`) atinge um nível **de
  classe** listado em `featLevels.class` dela — independente da paridade do nível de
  personagem — inclusive o nível 1 de classe de uma classe que entra depois (DEC-MCL-14). O talento
  DEVE pertencer a essa classe, nunca a outra que o personagem também tenha (DEC-MCL-10);
  talento de classe de nível maior que o nível daquela classe NÃO DEVE ser oferecido no
  seletor; talento já escolhido num slot que deixou de existir DEVE continuar na ficha,
  marcado como órfão.
- **REQ-MCL-041** [MC] (ampliado por DEC-MCL-28, 19/10/2026: o talento de arquétipo também ocupa slot de talento de classe, pelo nível do personagem; e por DEC-MCL-23, 19/10/2026: o slot do Arquétipo Livre também recebe talento de classe, medido pelo nível de **classe**) Feat de arquétipo (trait `archetype`) DEVE ser conferido
  contra o nível de **personagem**, mesmo quando pago com um slot de class feat.
- **REQ-MCL-042** [MC] (emendado por DEC-MCL-21, 19/10/2026: talento de perícia e aumento de perícia saem desta lista — seguem a tabela da classe no nível da classe) A cadência básica do personagem (ancestry feat, general
  feat, skill feat, boosts de 5/10/15/20, skill increase) DEVE seguir o nível de
  personagem, sem alteração.
- **REQ-MCL-043** [MC] **REVOGADO por DEC-MCL-21 (19/10/2026)** — texto histórico: ~~Quando uma **classe** concede cadência extra ("ganha X todo
  nível" — Ladino: skill feat e skill increase; Investigador: skill increase), o
  extra DEVE valer a partir do nível de personagem em que aquela classe entrou.
  A fonte DEVE ser a progressão da classe, não uma lista curada.~~
- **REQ-MCL-044** [MC] A elegibilidade de uma opção DEVE ser avaliada com o par
  `(class_level, character_level)` e, quando não atendida, DEVE aparecer marcada
  com o motivo legível — nunca omitida (DEC-MCL-06).

### 6.6 "Your level"

- **REQ-MCL-050** [MC] (emendado por DEC-MCL-25, 19/10/2026: nas habilidades de classe, "seu nível" é o nível da **classe**; magias seguem DEC-MCL-15) Em texto de regra, "your level" DEVE significar **nível de
  personagem**, exceto onde o arquétipo equivalente do PF2e **nega, congela,
  modifica ou gateia atrás de feat** a feature — nesses casos vale o nível
  **daquela classe**.
- **REQ-MCL-051** [MC] (emendado por DEC-MCL-25, 19/10/2026: a regra geral mudou; a lista de exceções derivada só vale para o que o doc não cobre) A lista de exceções do REQ-MCL-050 DEVE ser **derivada**
  do conteúdo do arquétipo correspondente, não escrita à mão. Casos conhecidos, a
  título ilustrativo e não normativo: advanced alchemy (congela), reação de causa
  do Campeão (gateia atrás de feat), elemental blast do Kineticist (gateia),
  Exploit Vulnerability do Thaumaturge (modifica).

### 6.7 Conjuração

- **REQ-MCL-060** [MC] O **número de slots** e o **rank base acessível** DEVEM vir
  da tabela nativa da classe, indexada pelo **nível de classe cru** — sem
  houserule.
- **REQ-MCL-061** [MC] (mantido e ampliado por DEC-MCL-15, 19/10/2026: a magia inata também eleva) O **rank efetivo** de truque, focus spell e magia de slot
  DEVE ser `ceil(nível_de_personagem / 2)`.
- **REQ-MCL-062** [MC] **REVOGADO por DEC-MCL-24 (19/10/2026)** — texto histórico: ~~Para magia com trait `summon` **ou** `incarnate`, o rank
  DEVE ser
  `min( max( ceil(class_level/2) + 2 , rank_de_dedicação(character_level) ) , ceil(character_level/2) )`.~~
- **REQ-MCL-063** [MC] **REVOGADO por DEC-MCL-24 (19/10/2026)** — texto histórico: ~~Para ator concedido (companheiro animal, familiar,
  eidolon), o nível DEVE ser `min( class_level + 2 , character_level )`.~~
- **REQ-MCL-064** [MC] **REVOGADO por DEC-MCL-24 (19/10/2026)** — texto histórico: ~~O escopo do REQ-MCL-062 DEVE ser determinado **por trait**
  (`summon`, `incarnate`), nunca por lista curada de magias.
- **REQ-MCL-065** [MC] A elevação dos REQ-MCL-061/062 NÃO DEVE valer para slots
  vindos de arquétipo: Free Archetype e tudo que vem por ele roda RAW puro.
- **REQ-MCL-066** [MC] (mantido por DEC-MCL-16, 19/10/2026: o teto 3 da spec vence o documento) Focus points DEVEM ser um pool único do personagem, teto 3,
  independentemente do número de classes.
- **REQ-MCL-067** [MC] A ficha DEVE exibir, por spellcasting entry, o nível de
  classe, o rank máximo do slot, o **rank efetivo** e a elevação ganha — a
  houserule tem de ser legível na ficha, não só verdadeira no cálculo.

### 6.8 Arquétipos e exclusão mútua

- **REQ-MCL-070** [MC] **REVOGADO por DEC-MCL-19 (19/10/2026)** — texto histórico: ~~Dedicações DEVEM continuar existindo como rota paralela,
  rodando RAW.
- **REQ-MCL-071** [MC] **REVOGADO por DEC-MCL-19 (19/10/2026)** — texto histórico: ~~O sistema DEVE marcar como fora-do-requisito, nos **dois
  sentidos**, a combinação "nível de classe X + dedicação de X": não se toma a
  dedicação de uma classe que já se tem, nem nível de uma classe cuja dedicação já
  se tem. A marcação NÃO bloqueia (DEC-MCL-06).
- **REQ-MCL-072** [MC] (mantido por DEC-MCL-19/DEC-MCL-26, 19/10/2026: agora define o conjunto PROIBIDO) O conjunto de arquétipos de multiclasse DEVE ser
  **derivado** (arquétipo cujo nome é nome de classe, ou dono de feat com trait
  `multiclass` — as duas vias devem concordar), nunca uma lista escrita à mão.
- **REQ-MCL-073** [MC] (aplica-se, por DEC-MCL-19, à marca de ilegalidade da ficha que já tem uma dedicação proibida) O motivo da marcação DEVE ser legível na UI ("a mesma
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

- **REQ-MCL-200** [MC] (sem objeto desde DEC-MCL-19, 19/10/2026: a rota de dedicação gratuita não é mais usada; o teste fica como histórico) **Invariante da regra 21.** Para todo par
  `(class_level, character_level)` com `1 ≤ class_level ≤ character_level` e
  `4 ≤ character_level ≤ 20` — os **204 pares** —, a rota de nível de classe NÃO
  PODE entregar menos, no eixo medido, que a rota de dedicação **gratuita** no
  mesmo nível de personagem. O teste DEVE ser exaustivo, jamais amostrado, e DEVE
  rodar no CI.
- **REQ-MCL-201** [MC] (sem objeto desde DEC-MCL-24, 19/10/2026: o teto de invocação foi revogado) O invariante do REQ-MCL-200 vale **por eixo medido**; hoje
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

| Alvo                                            | Arquivo                                         | Mudança                                                                 |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `findClassItem(doc)` → `findClassItems(doc)`    | `systems/pf2e/src/derivations/build.ts`         | devolve lista; call sites passam a iterar                               |
| `stepCharApplyClass`                            | `build.ts`                                      | acumula por `max` (REQ-MCL-021) em vez de escrever direto               |
| `stepCharBuildHp`                               | `build.ts`                                      | soma o PV da classe de cada nível (REQ-MCL-033/DEC-MCL-12)              |
| `stepCharBuildSkills`                           | `build.ts`                                      | orçamento por `delta` (REQ-MCL-035)                                     |
| `proficiencyBonus(rank, level)`                 | `systems/engine-2e`                             | passa a receber `LevelContext` (DEC-MCL-03)                             |
| `spellSlotsForLevel`                            | `build.ts` / `planVM.ts`                        | indexa por nível de classe; expõe rank efetivo                          |
| `isFeatEligible`                                | `packages/client/src/lib/sheets/pf2e/planVM.ts` | avalia com o par de níveis (REQ-MCL-044)                                |
| `derivePlan`                                    | `planVM.ts`                                     | slot "Nível de classe" por nível (REQ-MCL-081)                          |
| `CharacterBuildSchema`                          | `systems/pf2e/src/schemas/actor-character.ts`   | perde `freeArchetype`; nada de `variantRules` (REQ-MCL-001, DEC-MCL-09) |
| `ARCHETYPE_KEY_ABILITY` / class DC de arquétipo | `systems/pf2e/src/derivations/archetypes.ts`    | vira caso particular de "class DC por classe" (REQ-MCL-022)             |

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
- **Q-MCL-07** (19/10/2026) REQ-MCL-065 (a elevação não vale para slots vindos de arquétipo; Free Archetype roda RAW puro) e o
  documento da mesa ("elevação de magia, inclusive inata, é do personagem", DEC-MCL-15) precisam ser reconciliados: dizer se a
  magia inata concedida por talento de arquétipo eleva ou não.
- **Q-MCL-03** (resolvida por DEC-MCL-24, 19/10/2026) Interação com `29-pets-companions-familiars.md`: REQ-MCL-063
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
- `26-licencas-e-legal.md` — postura clean-room; a houserule é design do **Igor**
  (projeto Wayfinder), incorporado **com autorização do autor** (2026-08-01) e
  com atribuição obrigatória.

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
