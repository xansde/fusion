# 52 — Caçador, Companheiro e Montaria

- **Título:** Caçador, Companheiro e Montaria — marca no token, efeito em outro ator, estado montado,
  alteração de item, limite de tamanho, editor de runas e campos do Mestre
- **Status:** draft v0.1 (2026-10-05)
- **Nível:** Área (ver DEC-BHR-23)
- **Baseada em:**
  - `docs/design/bhrotto/decisoes.md` — decisões do Alexandre D-B01..D-B23 e respostas às DC-01..DC-12.
  - `docs/design/bhrotto/tasks.md` — plano consolidado; §1 (decisões), §2 (contratos canônicos), §4 (fichas).
  - `docs/design/bhrotto/dados/` — regras curadas (companheiros, montaria, talentos, itens, Wildborne), com fonte e página.
  - `docs/design/bhrotto/dependencias-importadas.md` — o que esta frente importa dos planos do Guerreiro e do Alquimista (N1–N8) e as lacunas que nascem aqui (G1–G10).
  - `29-pets-companions-familiars.md` — dona do companheiro (`REQ-PET-`); esta spec não define ids de pet, só os emenda lá.
  - `17-sistema-pf2e.md`, `15-api-de-sistemas.md`, `10-combate-e-iniciativa.md`, `06-canvas-e-renderizacao.md`, `41-token.md`, `09-chat-e-mensagens.md` — áreas emendadas por esta frente (§12).

> **Spec de área.** Esta spec é dona dos mecanismos que tornam o Patrulheiro com companheiro e
> montaria jogável e que **nenhuma** outra área tinha: a **marca persistida num token** (a Presa),
> o **efeito aplicado em outro ator** com permissão por vínculo, a expiração **depois da rolagem**,
> o **leitor de alteração de item**, o **estado montado**, o **limite de tamanho** das manobras, o
> **editor de runas** e os **campos que só o Mestre escreve**. Ela **não** redefine o companheiro
> (`29`), a peça (`41`), o combate (`10`) nem o motor de efeitos (`15`): cita e emenda (§12).

> **Aviso clean-room.** As regras PF2e citadas aqui são paráfrases funcionais das fontes listadas
> em `docs/design/bhrotto/dados/` (Player Core, Player Core 2, Howl of the Wild, Tian Xia Character
> Guide — ORC; Lost Omens World Guide — OGL 1.0a). Nenhum texto ou arte da Paizo é reproduzido; o
> `foundryvtt/pf2e` (Apache-2.0) é referência de modelagem, com atribuição.

---

## 1. Objetivo

Tornar o Bhrotto Raiz-funda (Patrulheiro 3 Leshy Raiz, Astúcia, Animal de Companhia + Dedicação de
Domador de Bestas) **100% jogável**: ficha com os números do livro, dois companheiros derivados com
ficha própria, montaria, Presa marcada no token, rolagens que sabem o alvo e runa na arma — e fazer
isso com mecanismos genéricos, que valem para qualquer personagem que use as mesmas regras.

## 2. Escopo

### 2.1 Inclui

- A **marca persistida num token** (`TokenMark`) e os predicados `target:mark:<slug>` /
  `origin:mark:<slug>` avaliados no servidor.
- A **expiração `after-roll`** no mesmo resolvedor de expiração da base do Alquimista.
- A **op `effect:apply`**: efeito de pack aplicado em outro ator, com permissão por vínculo.
- O **leitor de `item-alteration`** (traços e passo do dado) e o interruptor do Alcance Prênsil.
- O **estado montado** (`MountState`) e o Combate Montado: montar, andar junto, penalidades, MAP
  compartilhado, alcance a partir da montaria, Apoio montado.
- A **linha executável** da aba Ações (`ExecutableActionRow`), no recorte que o Bhrotto consome.
- A **faixa compacta de estados de combate** (`CombatStatesStrip`).
- O **limite de tamanho** de Agarrar, Empurrar e Derrubar (`ManeuverSizeLimit`).
- O **editor de runas** genérico da arma (`WeaponRunes`) e os **campos só do Mestre**
  (`GmOnlyActorFields`), com a exceção de talento no Plano e o ajuste de carteira.
- As correções de dado e conteúdo que a ficha do Bhrotto expôs (PV de herança, Natureza do
  Patrulheiro, Mangual de Guerra, efeitos do Patrulheiro, Wildborne, Medicina Natural, pt-BR).
- O **recorte da ALQ-F4-01** de que esta frente depende: fases do motor de regras, contexto de
  rolagem e `onRollResolved`.

### 2.2 Não inclui

- **Companheiro como modelo**: ator, vínculo, derivação, criação e ativo são da `29` (emendas
  `REQ-PET-098` em diante, §12). Esta spec só fixa o que o companheiro **consome** daqui.
- **O que o Guerreiro completa depois** (DC-02): flanqueio, cobertura, reações, escudo, estado de
  mãos, grupo de arma, Desarmar e Reposicionar, golpe de NPC com MAP.
- **O que fica com o Alquimista**: preparação diária, recurso de ator, consumíveis,
  `adjust-degree-of-success`, `damage-alteration`, `adjust-strike`.
- **Lista de runas de propriedade** e validação de runa (DEC-BHR-18).
- **Riqueza automática por nível** (DEC-BHR-21).
- **Talentos de Domador de Bestas de nível 4+** e o limite de quatro companheiros (Q-BHR-05).
- **Contador de ações do turno** (decisão D-15 do Alquimista): Comandar, Apoio e as ações da
  montaria são registro, não orçamento.

## 3. Conceitos e terminologia

| Termo                  | Significado aqui                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Presa**              | Criatura marcada pela ação Caçar Presa. É uma **marca persistida** (`TokenMark`, slug `hunted-prey`), distinta da mira. |
| **Mira**               | Seleção efêmera de alvo do usuário (`TargetSelection`, ALQ-F1-05), limpa no fim do turno do dono (REQ-CBT-055).         |
| **Dono**               | O ator que tem o companheiro (`masterActorId` do companheiro).                                                          |
| **Companheiro ativo**  | O único companheiro de um dono que age, apoia e herda a Presa (DEC-BHR-10).                                             |
| **Concessão**          | Talento ou dedicação que dá direito a um companheiro (Animal de Companhia, Dedicação de Domador de Bestas).             |
| **Estágio**            | `young`, `mature`, `nimble`, `savage`, `specialized` — o avanço do companheiro (`dados/companheiros.md` b).             |
| **Apoio**              | Ação do companheiro que dá ao dono o benefício do tipo até o início do próximo turno do dono.                           |
| **Montado**            | Estado do par cavaleiro/montaria gravado nos dois tokens (`MountState`).                                                |
| **Estado de combate**  | Qualquer coisa ativa que mude números de combate: efeito, condição, interruptor ligado.                                 |
| **Linha executável**   | Linha da aba Ações que, além de descrever, executa (checa requisito, rola, aplica, posta).                              |
| **Campo só do Mestre** | Caminho de documento de ator que o servidor recusa a jogador.                                                           |

## 4. Decisões

Rastreio das decisões do Alexandre e das respostas às DC para as decisões desta spec:

| Origem (`decisoes.md` / `tasks.md` §1) | Decisão desta spec |
| -------------------------------------- | ------------------ |
| D-B01                                  | DEC-BHR-01         |
| D-B02                                  | DEC-BHR-02         |
| D-B03                                  | DEC-BHR-03         |
| D-B04                                  | DEC-BHR-04         |
| D-B05, DC-03                           | DEC-BHR-05         |
| DC-04                                  | DEC-BHR-06         |
| DC-08                                  | DEC-BHR-07         |
| DC-05                                  | DEC-BHR-08         |
| DC-06                                  | DEC-BHR-09         |
| D-B09, DC-07                           | DEC-BHR-10         |
| D-B10                                  | DEC-BHR-11         |
| D-B14, D-B15, D-B22                    | DEC-BHR-12         |
| D-B11                                  | DEC-BHR-13         |
| D-B17                                  | DEC-BHR-14         |
| D-B16                                  | DEC-BHR-15         |
| D-B23                                  | DEC-BHR-16         |
| D-B18                                  | DEC-BHR-17         |
| D-B06, D-B19, D-B20                    | DEC-BHR-18         |
| D-B21, DC-11                           | DEC-BHR-19         |
| D-B12                                  | DEC-BHR-20         |
| D-B13, DC-10                           | DEC-BHR-21         |
| D-B07, DC-12                           | DEC-BHR-22         |
| D-B08, DC-01, DC-02                    | DEC-BHR-23         |
| DC-09                                  | DEC-BHR-24         |

### DEC-BHR-01 — Os números do companheiro são derivados por tipo, estágio e nível do dono

Um pack homebrew de **tipos de companheiro** (urso e antílope agora, extensível por documento) e
uma função pura de derivação calculam PV, CA, salvamentos, Percepção, perícias e golpes a partir do
tipo, do estágio e do nível do dono (`dados/companheiros.md` a/b). Nada disso é digitado nem
persistido como entrada.

- **Racional:** o levantamento conferiu as fórmulas contra o Pathbuilder no nível 3 (tabela d) sem
  divergência; número digitado diverge no primeiro nível que o dono sobe.
- **Extensível sem código:** tipo novo é documento novo no pack (`CompanionType`, §7.4).
- Emendas na `29`: REQ-PET-005 e REQ-PET-040 passam a [MVP]; REQ-PET-098..106 (§12).

### DEC-BHR-02 — O recálculo do companheiro é do servidor

Mudou o dono, o **servidor** re-deriva os companheiros ligados a ele e os inclui no mesmo
broadcast. Não há recálculo no cliente.

- **Racional:** fecha a Q-PET-02 pelo lado mais simples — gatilho depois da atualização do dono,
  sem ordem topológica entre atores no `DeriveStep`. Mantém a autoridade do servidor.
- Emenda na `29`: REQ-PET-107..108 e Q-PET-02 fechada.

### DEC-BHR-03 — Combate Montado completo, com o estado montado nos tokens

Montar grava um estado nos **dois tokens** (`MountState`, §7.6); o cavaleiro anda com a montaria
no mesmo write; valem as regras de Combate Montado de `dados/montaria.md`: −2 circunstância em
Reflexos, Montar como única ação de movimento do cavaleiro, MAP compartilhado, alcance a partir da
montaria, restrições da montaria companheira (que o tipo com `mount` ignora) e o Apoio montado.

- **Racional:** o estado montado é **posicional** — pertence à cena, não ao ator: o mesmo ator
  pode ter duas peças, e desmontar acontece numa cena específica.
- **Montaria é companheiro, não espécie à parte:** o antílope é `animalCompanion` com
  `special: ["mount"]`. O `companionKind: "mount"` próprio (montaria não companheira) segue
  recusado ao jogador (REQ-PET-111).

### DEC-BHR-04 — O companheiro tem ficha própria; o dono só tem os vínculos

Cada companheiro é um ator com **ficha própria** (cabeçalho "pertence a …"). A ficha do dono
mostra só os vínculos (qual é qual, qual está ativo). Companheiro animal **não** abre a aba Pets.

- **Racional:** decisão do Alexandre (D-B04). A mini-ficha da aba Pets (REQ-PET-052) cabe a
  familiar e pet; o companheiro animal age, rola e apoia sozinho, e precisa de ficha inteira.
- Emenda na `29`: REQ-PET-050 e REQ-PET-053 (§12).

### DEC-BHR-05 — A Presa é uma marca persistida no ator que caçou, separada da mira

Caçar Presa grava um `TokenMark` (§7.1) em `Actor.flags.fusion.tokenMarks` do **ator que caçou**.
A mira continua efêmera (REQ-CBT-055); a Presa sobrevive ao fim do turno e à troca de cena. Os
bônus da Astúcia e do Caçador de Monstros só valem contra o token marcado, e é o **servidor** que
decide, na hora da rolagem, se o alvo está marcado.

- **Rejeitado:** emendar a REQ-CBT-055 para mira persistente — mexe num comportamento testado e
  mistura "em quem estou mirando agora" com "quem é minha presa" (DC-03).
- **Não é da peça:** a marca não é gravada no token (DEC-TOK-22 continua valendo); ela aponta para o
  token e para o ator alvo, para sobreviver à troca do token.

### DEC-BHR-06 — A Presa sai por substituição ou remoção; a frequência diária é exibida, não imposta

A Presa sai por **nova Caçar Presa** (a marca `hunted-prey` é exclusiva: substitui), por
**remoção** (dono ou Mestre) ou quando o Mestre a remove porque o alvo saiu da cena ou morreu. Não há
`daily-prep` automático enquanto a preparação diária não existir (decisão D-05 do Alquimista: sem
relógio de mundo). O "1×/dia por criatura" do Caçador de Monstros é **exibido** no card, não
imposto (DC-04).

- **Rejeitado:** importar recurso de ator e preparação diária do Alquimista só para isso — arrasta a
  fase F3 inteira daquele plano.

### DEC-BHR-07 — O companheiro ativo herda a Presa e a Astúcia do dono

`target:mark:hunted-prey` e `origin:mark:hunted-prey` valem também para o companheiro **ativo**
quando a marca é do dono, venha o companheiro de qual concessão vier (DC-08).

- **Rejeitado:** o texto estrito (`dados/talentos.md`, "NÃO CONFIRMADO": só o companheiro do talento
  Animal de Companhia) — exigiria gravar a concessão de origem e checá-la no predicado, e a mesa
  decidiu pela leitura simples.

### DEC-BHR-08 — "Depois da rolagem" é um valor de expiração, no mesmo resolvedor

`FusionExpiry.on` ganha `"after-roll"` com `rollPredicate` opcional (§7.2). O **mesmo**
`resolveExpirations` da base do Alquimista é chamado por um ouvinte de `onRollResolved`: o efeito
vale na rolagem que casa com o predicado e sai **depois** dela.

- **Rejeitado:** campo à parte (`consumeOnRoll`) — seria um segundo resolvedor de expiração, contra
  a DF-08 do Alquimista ("um só resolvedor").

### DEC-BHR-09 — Efeito em outro ator é uma op própria, com permissão por vínculo

A op `effect:apply` (§7.3) copia um efeito de pack para outros atores como item embutido com
origem, início e expiração (DF-06 do Alquimista). Permissão no servidor (DC-06): Mestre sempre;
jogador se possui o ator de origem **e** cada alvo é (a) ele mesmo, (b) ligado a ele por vínculo de
companheiro, nos dois sentidos, ou (c) está na foto de alvos da mensagem citada e o efeito tem
`allowOnTarget`.

- **Rejeitado:** reusar `actor:applyCondition` (contrato `ApplyCondition`, plano do Alquimista §2.4) —
  só serve para condição, e o Apoio do urso é dano extra, não condição.

### DEC-BHR-10 — Companheiro criado pelo Plano; limite pelo número de concessões; um ativo

O talento Animal de Companhia abre no Plano o sub-slot "escolher companheiro"; a Dedicação de
Domador de Bestas abre um segundo; o jogador faz sozinho. O limite do grupo `animalCompanion` deixa
de ser 1 e passa a ser o **número de concessões** (DC-07). Um só companheiro é **ativo**
(`system.companion.active`); o inativo continua ator, com ficha legível e sem token em cena; Chamar
Companheiro troca o ativo (exploração, sem cronômetro).

- **Racional:** a regra do Domador permite mais de um companheiro com um só ativo
  (`dados/talentos.md`); contar o teto de quatro só faz sentido com talentos de nível 4+ (Q-BHR-05).
- Emenda na `29`: DEC-PET-03, REQ-PET-092, REQ-PET-093 e REQ-PET-109..114, REQ-PET-120..121.

### DEC-BHR-11 — Comandar e Apoio são automáticos

Na ficha do companheiro, **Comandar** posta o card (sem teste de Natureza para o companheiro
animal); **Apoio** aplica no dono, via `effect:apply`, o efeito do tipo, que expira sozinho no
início do próximo turno do **dono** (`expiry.ownerActorId` = dono).

- **Racional:** decisão do Alexandre (D-B10). A expiração ancorada no dono é o caso que nenhum plano
  testou: o efeito é aplicado em nome do companheiro, mas conta pelo turno de outro ator.

### DEC-BHR-12 — O seletor de tipo mostra o futuro, aceita repetição e não cita nível de classe

O seletor de tipo de companheiro mostra o que o companheiro ganha **a partir de Maduro** e nos
estágios seguintes, mesmo sem o requisito (D-B14); permite escolher o **mesmo tipo** mais de uma
vez (D-B15); e **não cita nível de classe** (D-B22), porque Maduro vem de um talento opcional.

### DEC-BHR-13 — O limite de tamanho das manobras é checado contra o alvo

Agarrar, Empurrar e Derrubar contra um alvo checam o tamanho: até 1 acima do executante; com
Lutador de Titãs, até 2 (3 com Atletismo lendário) — `dados/talentos.md`. A regra entra como handler
de rule element (`fusion-maneuver-size-limit`, §7.8), não como exceção codificada por talento.

### DEC-BHR-14 — As manobras de Atletismo ficam na aba Ações, fora da tela de combate

Agarrar, Empurrar e Derrubar executam pela aba Ações (onde já existem), não na tela de combate do
protótipo (D-B17). A checagem de tamanho (DEC-BHR-13) continua valendo nelas.

### DEC-BHR-15 — Texto de estado nunca fica preso ao nome de uma arma

O texto de um estado de combate descreve o **efeito genérico** ("reduz em um o passo do dado da
arma"), nunca o nome de uma arma, que pode ser trocada (D-B16).

### DEC-BHR-16 — A faixa de estados de combate é compacta: nome, e o clique revela o efeito

Cada estado ativo aparece **só pelo nome**; clicar revela o efeito, clicar de novo recolhe (D-B23).
É o padrão para **todos** os estados de combate de qualquer ficha (personagem, companheiro, NPC),
não um caso do Bhrotto.

### DEC-BHR-17 — "Contra a presa", nunca o nome do alvo

Bônus condicionado à Presa aparece como "Contra a presa", nunca como "Contra o ogro" (D-B18). O
predicado cru (`target:mark:*`, `origin:mark:*`) nunca chega ao texto que o jogador vê.

### DEC-BHR-18 — O editor de runas é genérico e livre

Qualquer arma tem o editor de runas: potência, runa de ataque e runas de propriedade (D-B06). O
nome de cada campo diz o que se escolhe e o grau da runa não fica escondido só no selecionável
(D-B19). **Sem aviso nem bloqueio** (D-B20): o Mestre confia nos jogadores.

- **Fora:** lista de runas de propriedade (texto livre por vaga) e validação de nível/preço.

### DEC-BHR-19 — _Striking_ é "Runa de ataque"; o campo mostra o efeito em dados

"Runa de ataque", "Runa de ataque maior", "Runa de ataque suprema" (D-B21); "Runa de potência
+1/+2/+3"; campos "Potência (bônus de ataque)", "Runa de ataque (dados de dano)", "Runas de
propriedade (N vagas)" (DC-11). "Golpeadora" foi rejeitado.

### DEC-BHR-20 — A exceção do Mestre no Plano é um campo só do Mestre

O Plano reconhece **Acesso** (requisito de acesso de talento incomum). O Mestre pode marcar um
talento como **liberado** para um ator (`system.build.gmExceptions`), e o slot mostra o selo
"liberado pelo Mestre" (D-B12, Floração Nobre do Bhrotto).

### DEC-BHR-21 — A carteira continua do jogador; o Mestre ganha o ajuste

Sem regra automática de riqueza por nível. O jogador **continua** editando a própria carteira
(DC-10, que refina a D-B13 contra a recomendação do plano); o Mestre ganha "Ajustar carteira" na
ficha de qualquer personagem. Não há chave `walletGmOnly`.

### DEC-BHR-22 — Wildborne é curado da fonte aberta, sem texto da Paizo

O antecedente Wildborne entra num pack homebrew do mundo, com origem declarada, a partir de
`dados/wildborne.md`: Pathfinder Lost Omens World Guide (OGL 1.0a). Sem texto nem arte da Paizo.

- **Substitui** a menção a "fonte ORC (Howl of the Wild)" da D-B07: o antecedente foi achado no Lost
  Omens World Guide, e a DC-12 foi desbloqueada pelo Alexandre (escolhas do jogador, 2026-10-05).

### DEC-BHR-23 — As peças de outras frentes entram com os contratos de origem

O que o Bhrotto precisa de motor e já foi desenhado no Guerreiro e no Alquimista entra **neste**
plano com os contratos que os planos de origem fixaram, citados por nome e não reescritos (D-B08).
A base do Alquimista (ondas 1–5) chega a `alfa/app` por merge antecipado (DC-01, opção A). O Bhrotto
implementa primeiro as fichas do Guerreiro que importa e fixa `AttackCheckContext`, `TargetGesture`,
`MapCounter`, `SkillCheckContext` e `PositionQuery`; o Guerreiro, quando rodar, confere o que existe
(DC-02).

- **Nível desta spec:** área — ela é dona de mecanismos novos que se restringem mutuamente (a marca
  é lida pelo predicado de alvo, que é resolvido na rolagem, que dispara a expiração, que remove o
  efeito aplicado em outro ator), não uma combinação de decisões que já existem
  (`CONVENCOES.md` §1).
- **Rejeitado:** reimplementar a partir das fichas do Alquimista (duas verdades) e transplante por
  tarefa (código duplicado que conflita no merge final da `feat/alquimista`).

### DEC-BHR-24 — O Patrulheiro treina Natureza; a causa é o espelho do Plano, não o pack

O Patrulheiro treina Natureza e Sobrevivência, como o livro. O documento da classe no pack (igual ao
vendor) traz só Sobrevivência em `trainedSkills.value` e concede Natureza por uma **regra própria**
(`system.skills.nature.rank = 1`, com predicate `not feature:vindicator`: o arquétipo de classe
Vindicator troca Natureza por Religião). O servidor já julgava esse predicate; o **espelho do Plano**
(`planVM`) descartava toda regra de classe com predicate, então a ficha mostrava Natureza sem
treino e o jogador gastava uma escolha livre nela. A correção é o espelho avaliar os termos
`feature:` do predicate, não um remendo no pack nem na curadoria do importer. O Vindicator segue sem
Natureza. Personagem existente que gastou uma escolha livre com Natureza a recebe de volta como
livre aberta, pelo mesmo caminho da colisão da regra 2 da casa (DC-09).

---

## 5. Requisitos funcionais

### 5.1 Base importada e expiração ancorada no dono (B-F0)

- **REQ-BHR-001** [MVP] A integração da base do Alquimista (ondas 1–5) NÃO DEVE alterar os números
  derivados de personagem existente: a ficha do Bhrotto nível 3 DEVE mostrar os mesmos CA, salvamentos
  e ataque antes e depois da integração.
- **REQ-BHR-002** [MVP] Onde a integração conflitar com comportamento de `alfa/app` que o Alquimista
  não pretendia mudar (ex.: regras da casa), o comportamento de `alfa/app` DEVE prevalecer.
- **REQ-BHR-003** [MVP] Os testes-oráculo das tarefas importadas do Alquimista (runner de hooks de
  turno, regressão de rule elements, seleção de alvo, aplicação de condição, expiração de efeito)
  DEVEM passar sobre `alfa/app` integrada.
- **REQ-BHR-004** [MVP] Nenhuma tarefa desta frente DEVE reimplementar peça já entregue pela base do
  Alquimista; consome os contratos de origem (DEC-BHR-23).
- **REQ-BHR-005** [MVP] O resolvedor de expiração DEVE decidir o vencimento pelo
  `expiry.ownerActorId` do efeito, nunca pelo ator de origem do item nem pelo ator que o carrega.
- **REQ-BHR-006** [MVP] Um efeito aplicado em nome do ator X no ator Y com
  `expiry { on: "turn-start", ownerActorId: Y }` DEVE sair no início do turno de Y e NÃO DEVE sair no
  início do turno de X.
- **REQ-BHR-007** [MVP] A expiração DEVE remover o efeito de **todos** os atores que carregam cópia
  dele (DF-07 do Alquimista).
- **REQ-BHR-008** [MVP] A remoção por expiração DEVE estar no estado transmitido do avanço de turno:
  nenhum cliente DEVE ver o turno do dono começar com o efeito vencido ainda ativo.
- **REQ-BHR-009** [MVP] Fora de combate nenhum efeito DEVE expirar sozinho (decisão D-05 do Alquimista).
- **REQ-BHR-010** [MVP] O `ownerActorId` DEVE ser gravado no momento em que o efeito é aplicado, pela
  op que aplica; NÃO DEVE ser inferido depois.

### 5.2 Dado e conteúdo (B-F1)

- **REQ-BHR-011** [MVP] O PV de ancestralidade DEVE respeitar o override de `ancestryhp` vindo de
  herança, ou de qualquer item com o mesmo `ActiveEffectLike`; o Leshy Raiz dá 10. Com isso o PV
  máximo do Bhrotto (Patrulheiro, Con +2) DEVE ser 22/34/46 nos níveis 1/2/3.
- **REQ-BHR-012** [MVP] Herança sem o override de `ancestryhp` NÃO DEVE mudar o PV derivado.
- **REQ-BHR-013** [MVP] A classe Patrulheiro DEVE treinar Natureza e Sobrevivência (DEC-BHR-24);
  o Patrulheiro com a característica Vindicator NÃO DEVE treinar Natureza; nenhuma outra
  classe DEVE mudar de perícias treinadas com essa correção.
- **REQ-BHR-014** [MVP] Personagem Patrulheiro que já gastou uma escolha livre de perícia com
  Natureza DEVE ganhar essa escolha de volta como **livre aberta** na próxima abertura do Plano, sem
  perder treino.
- **REQ-BHR-015** [MVP] O pack de armas DEVE ter o Mangual de Guerra (`dados/itens.md`): marcial,
  grupo mangual, 1d10 contundente, duas mãos, traços desarmar/varrer/derrubar, 2 po, volume 2,
  nível 0, nome pt-BR, sem arte da Paizo.
- **REQ-BHR-016** [MVP] O pack de efeitos do Patrulheiro DEVE ter o efeito **Presa**: +2
  circunstância em Percepção ao Buscar e em Sobrevivência ao Rastrear, condicionado a
  `target:mark:hunted-prey`.
- **REQ-BHR-017** [MVP] O pack DEVE ter o efeito **Astúcia**: +2 circunstância em Enganação,
  Intimidação, Furtividade e Rememorar Conhecimento contra a Presa, e +1 circunstância na CA com
  `origin:mark:hunted-prey`.
- **REQ-BHR-018** [MVP] O pack DEVE ter o efeito **Caçador de Monstros**: +1 circunstância no próximo
  ataque contra a Presa, com `expiry.on = "after-roll"` (DEC-BHR-08).
- **REQ-BHR-019** [MVP] O pack DEVE ter os efeitos de **Apoio do urso** (+1d8 cortante em golpe que
  acerta criatura ao alcance do urso, `turn-start` do dono), **Apoio do antílope** (+1d6 sangramento
  persistente, só montado) e **Montado** (−2 circunstância em Reflexos).
- **REQ-BHR-020** [MVP] As regras desses efeitos DEVEM ser registradas em kebab-case (DF-15 do
  Alquimista) e seus textos DEVEM ser redação própria em pt-BR, sem texto da Paizo.
- **REQ-BHR-021** [MVP] Caçar Presa DEVE ter **um nome só** em pt-BR, na ação e na característica de
  classe; a Dedicação de Domador de Bestas, a Medicina Natural e a Floração Nobre DEVEM ter nome e
  texto em pt-BR, com "Acesso" separado do corpo.
- **REQ-BHR-022** [MVP] Nenhuma nota situacional DEVE mostrar predicado cru (`target:mark:*`,
  `origin:mark:*`); a marca DEVE virar "contra a presa" (DEC-BHR-17).
- **REQ-BHR-023** [MVP] A linha da aba Ações vinda de item embutido DEVE mostrar o nome traduzido do
  item, não o nome original em inglês.
- **REQ-BHR-024** [MVP] O antecedente Wildborne DEVE existir num pack homebrew com origem declarada,
  concedendo (`dados/wildborne.md`) dois aumentos de atributo (um de Destreza ou Sabedoria, outro
  livre), Natureza treinada, Conhecimento: Floresta treinado e o talento Medicina Natural por
  `GrantItem` (DEC-BHR-22).
- **REQ-BHR-025** [MVP] Tratar Ferimentos DEVE oferecer **Medicina ou Natureza** quando o ator tem a
  regra `fusion-skill-substitution { action: "treat-wounds", skill: "nature" }`; sem a regra, a opção
  NÃO DEVE existir.
- **REQ-BHR-026** [MVP] Com a substituição, a CD disponível de Tratar Ferimentos DEVE respeitar o rank
  da perícia usada, incluindo as CDs maiores.
- **REQ-BHR-027** [MVP] O +2 circunstância da Medicina Natural em ambiente selvagem DEVE aparecer como
  opção a ligar (`fresh-ingredients`, a critério do Mestre), não como texto cru.

### 5.3 Motor de regras (B-F2)

- **REQ-BHR-041** [MVP] Um `flat-modifier` DEVE chegar ao número de `ac`, `strike-damage`,
  `melee-strike-attack-roll`, `ranged-strike-attack-roll`, `saving-throw`, `skill-check`, `perception`
  e `initiative`.
- **REQ-BHR-042** [MVP] Um `flat-modifier` sem predicado num desses seletores DEVE mudar exatamente
  aquele número e nenhum outro.
- **REQ-BHR-043** [MVP] Ligar esses seletores NÃO DEVE mudar a derivação de personagem sem regra
  nova (snapshot de regressão por classe intacto).
- **REQ-BHR-044** [MVP] A avaliação de predicado DEVE receber as opções do ator **e** do alvo da
  rolagem, com o vocabulário `target:mark:<slug>`, `origin:mark:<slug>` e `target:condition:<slug>`.
- **REQ-BHR-045** [MVP] Modificador com predicado de alvo DEVE ficar **condicional** na ficha (fora
  do número base) e ser resolvido no momento da rolagem, no servidor.
- **REQ-BHR-046** [MVP] `origin:mark:<slug>` DEVE valer só na defesa contra um atacante marcado pelo
  ator que defende (ou pelo dono dele, DEC-BHR-07).
- **REQ-BHR-047** [MVP] O importer DEVE converter `ItemAlteration` em `item-alteration` completo
  (`traits`, `damage-dice-faces`, `other-tags`, `damage-type`, com predicado); nenhum talento usado
  pelo Bhrotto DEVE ficar com `ItemAlteration` não convertido.
- **REQ-BHR-048** [MVP] O handler `item-alteration` DEVE aplicar `traits` e `damage-dice-faces` na fase
  `item`, avaliando o predicado contra as opções do item-alvo e do ator.
- **REQ-BHR-049** [MVP] Com o leitor de alteração de item, o interruptor `grasping-reach` DEVE ser
  considerado lido e oferecido na ficha; ligado, o golpe da arma elegível DEVE ganhar `reach` e o dado
  DEVE cair um passo (Mangual de Guerra com runa de ataque: `2d10+4` → `2d8+4`); desligado, volta;
  arma de uma mão ou que já tem `reach` NÃO DEVE mudar.
- **REQ-BHR-050** [MVP] O texto do estado do Alcance Prênsil NÃO DEVE citar a arma (DEC-BHR-15).
- **REQ-BHR-051** [MVP] Na resolução de uma rolagem, o servidor DEVE re-derivar o ator, resolver as
  notas e os modificadores condicionais contra as opções do ator e do alvo (incluindo
  `target:mark:*` lido do `TokenMark`) e gravar `flags.fusion.rollNotes` na mensagem.
- **REQ-BHR-052** [MVP] Bônus enviado pelo cliente no payload da rolagem DEVE ser ignorado: notas,
  grau e ajustes são resolvidos no servidor (DF-17 do Alquimista).
- **REQ-BHR-053** [MVP] O servidor DEVE emitir `onRollResolved({ message, rollContext, degree,
targets })` **uma vez** por rolagem resolvida.
- **REQ-BHR-054** [MVP] Efeito com `expiry.on = "after-roll"` DEVE sair depois da primeira rolagem que
  casa com o `rollPredicate`, e o bônus dele DEVE valer **nessa** rolagem.
- **REQ-BHR-055** [MVP] Rolagem que não casa com o `rollPredicate` NÃO DEVE consumir o efeito, e efeito
  sem `after-roll` NÃO DEVE ser tocado pelo ouvinte de `onRollResolved`.
- **REQ-BHR-056** [MVP] A ficha DEVE ter a seção "Efeitos ativos" com origem, duração restante
  rotulada pelo `expiry.on` ("até o início do seu próximo turno", "até a próxima rolagem de ataque",
  "até nova Caçar Presa") e o botão de remover.
- **REQ-BHR-057** [MVP] O Apoio ativo e a Presa DEVEM aparecer também na anotação do canto do dono e do
  Mestre (decisão D-16 do Alquimista).
- **REQ-BHR-058** [MVP] O botão de remover efeito DEVE existir só para o dono do ator e o Mestre.
- **REQ-BHR-059** [MVP] Uma linha da aba Ações com registro `ExecutableActionRow` DEVE checar os
  requisitos declarados (`target`, `mounted`, `not-mounted`, `companion`) e, sem eles, ficar
  desabilitada com o motivo.
- **REQ-BHR-060** [MVP] Com os requisitos cumpridos, o clique DEVE rolar no servidor quando a linha
  declara rolagem, aplicar `selfEffect`/marca quando declarados e postar o card.
- **REQ-BHR-061** [MVP] Linha sem registro DEVE continuar só descritiva e navegável (decisão D-G08 do
  Guerreiro).
- **REQ-BHR-062** [MVP] Ações de exploração e passivas concedidas por item embutido (ex.: Chamar
  Companheiro) DEVEM aparecer na lista da aba Ações.
- **REQ-BHR-063** [MVP] Todo rule element dos documentos que o Bhrotto usa DEVE ser lido por algum
  handler; um teste de varredura DEVE falhar listando a regra inerte (nenhuma no `unsupportedLog`,
  nenhuma só como texto de exibição).
- **REQ-BHR-064** [MVP] A faixa "Estados de combate" DEVE mostrar só o nome de cada estado ativo;
  clicar no nome DEVE revelar o texto do efeito, e clicar de novo DEVE recolhê-lo, só naquele item
  (DEC-BHR-16).
- **REQ-BHR-065** [MVP] A lista da faixa DEVE vir dos efeitos ativos, das condições e dos interruptores
  ligados; o texto de nenhum estado DEVE conter nome de arma.
- **REQ-BHR-066** [MVP] O mesmo componente de faixa DEVE ser usado nas fichas de personagem,
  companheiro e NPC.
- **REQ-BHR-067** [MVP] O motor de regras DEVE aplicar os handlers por fase, na ordem
  `pre-base → synthetics → item → strike → roll` (contrato `RuleElementRegistry`, plano do Alquimista
  §2.8); chave de regra desconhecida DEVE ir ao `unsupportedLog`, sem erro.
- **REQ-BHR-068** [MVP] Handler novo desta frente (`item-alteration`, `fusion-skill-substitution`,
  `fusion-maneuver-size-limit`) DEVE registrar em kebab-case e ter teste de escopo: só atores com
  aquele `kind` mudam.
- **REQ-BHR-069** [MVP] O contexto da rolagem (`actorId`, `itemId?`, `selectors`, `options`) DEVE ir no
  op e ser gravado em `flags.fusion.rollContext`; o servidor DEVE resolver com ele, nunca com valores
  calculados no cliente (DF-16/DF-17 do Alquimista).
- **REQ-BHR-070** [MVP] O sistema DEVE poder registrar ouvintes de `onRollResolved` com id
  (`registrar.onRollResolved(id, fn)`), chamados em série no servidor.

### 5.4 Alvo, golpe e Presa (B-F3)

- **REQ-BHR-081** [MVP] Clique direito num token DEVE alternar a mira do usuário e `Esc` DEVE limpar só
  a mira dele; o clique esquerdo DEVE continuar selecionando e arrastando (contrato `TargetGesture`,
  plano do Guerreiro §2.2). O gesto provisório de clique esquerdo em token alheio DEVE sair.
- **REQ-BHR-082** [MVP] O golpe da ficha com alvo mirado DEVE enviar `payload.target` e o
  `checkContext` de ataque; sem alvo, o payload DEVE ser idêntico ao de antes.
- **REQ-BHR-083** [MVP] Com `AttackCheckContext` (plano do Guerreiro §2.1), o servidor DEVE decidir o
  grau contra a CA lida do banco (REQ-ACH-070), sem alvo resolvível NÃO DEVE haver grau (REQ-ACH-071),
  e o card DEVE mostrar o grau e **um** botão de dano coerente com ele.
- **REQ-BHR-084** [MVP] O servidor DEVE contar os ataques do turno (`MapCounter`, plano do Guerreiro
  §2.3), zerar no `turnStart` e expor o ponto de extensão `mapGroupOf(combatantId)`.
- **REQ-BHR-085** [MVP] O botão de golpe DEVE mostrar a penalidade de MAP corrente; as variantes
  ficam num seletor recolhido "forçar MAP", e o card DEVE gravar qual foi usada.
- **REQ-BHR-086** [MVP] A marca DEVE ser persistida em `Actor.flags.fusion.tokenMarks` do ator que
  marcou, no shape `TokenMark` (§7.1), pelas ops `mark:set` e `mark:clear`.
- **REQ-BHR-087** [MVP] O servidor DEVE aceitar `mark:set` do Mestre em qualquer ator e do jogador só
  no ator que possui (OWNER) e só sobre token que está na própria seleção de alvo no momento do set;
  fora disso DEVE responder `PERMISSION_DENIED`.
- **REQ-BHR-088** [MVP] Marca `exclusive` (a `hunted-prey`) DEVE substituir a anterior do mesmo slug
  no mesmo ator.
- **REQ-BHR-089** [MVP] Marca sobre token oculto DEVE ser removida do payload de não privilegiados,
  pela redação de `net/redaction.ts` com `isRolePrivileged`.
- **REQ-BHR-090** [MVP] A marca DEVE sobreviver ao `turnEnd` e à troca de cena, e o servidor DEVE
  expor a leitura `getMarksOn(targetTokenId)` ao resolvedor de rolagem.
- **REQ-BHR-091** [MVP] Token marcado como Presa DEVE ganhar um selo próprio, distinto da retícula de
  mira, visto pelo dono, pelos donos do companheiro e pelo Mestre (os demais conforme REQ-BHR-089),
  com dica que nomeia quem caçou; o selo DEVE sumir quando a marca sai.
- **REQ-BHR-092** [MVP] Caçar Presa DEVE exigir alvo mirado; sem alvo, a linha DEVE ficar desabilitada.
- **REQ-BHR-093** [MVP] Usar Caçar Presa DEVE fazer `mark:set` (`hunted-prey`, exclusiva) no token
  mirado e aplicar o efeito Presa como item embutido com origem.
- **REQ-BHR-094** [MVP] Caçar Presa DEVE postar **um** card com o alvo e o efeito aplicado dentro dele,
  não uma segunda mensagem.
- **REQ-BHR-095** [MVP] Com o talento Caçador de Monstros, o card de Caçar Presa DEVE incluir um
  Rememorar Conhecimento sobre a Presa, com a perícia escolhida pelo jogador, rolado no servidor.
- **REQ-BHR-096** [MVP] Em sucesso crítico nesse Rememorar, o card DEVE aplicar o efeito Caçador de
  Monstros (`after-roll`, `rollPredicate` com `target:mark:hunted-prey`); ataque contra outro alvo
  NÃO DEVE somar nem consumir o efeito.
- **REQ-BHR-097** [MVP] O "1×/dia por criatura" do Caçador de Monstros DEVE ser exibido no card e NÃO
  DEVE ser imposto (DEC-BHR-06).
- **REQ-BHR-098** [MVP] Com Presa marcada, o golpe DEVE mostrar a linha "Contra a presa" com os bônus
  condicionais; o texto NUNCA DEVE conter o nome do alvo (DEC-BHR-17).
- **REQ-BHR-099** [MVP] A CA DEVE mostrar "+1 contra a presa (Astúcia)", com a origem, só enquanto
  existir a marca.
- **REQ-BHR-100** [MVP] Quando o alvo mirado **é** a Presa, o botão de golpe e a perícia DEVEM mostrar o
  total já com o bônus condicional (o servidor confirma na rolagem); quando não é, o número normal.
- **REQ-BHR-101** [MVP] Sem marca, nenhuma linha "contra a presa" DEVE aparecer na ficha.
- **REQ-BHR-102** [MVP] A op `effect:apply` (§7.3) DEVE copiar o efeito do pack para cada ator-alvo como
  item embutido com origem, início e `expiry` (DF-06 do Alquimista).
- **REQ-BHR-103** [MVP] O servidor DEVE aceitar `effect:apply` do Mestre em qualquer ator e do jogador
  só quando ele possui `sourceActorId` e cada alvo é ele mesmo ou ligado a ele por vínculo de
  companheiro, ou está na `targetSnapshot` de `messageId` (DEC-BHR-09); fora disso, `PERMISSION_DENIED`.
- **REQ-BHR-104** [MVP] No caso da foto de alvos da mensagem, o efeito DEVE ter
  `system.fusion.allowOnTarget = true`; sem isso, o servidor DEVE negar.
- **REQ-BHR-105** [MVP] O efeito aplicado DEVE chegar ao alvo com o `expiry.ownerActorId` enviado na op.

### 5.5 Combate montado (B-F5)

- **REQ-BHR-171** [MVP] O servidor DEVE mapear tamanho em células de lado (minúsculo, pequeno, médio,
  grande, enorme, imenso → 1/1/1/2/3/4, com minúsculo ocupando 1 célula para efeito de distância) e
  expor `sizeRank` (recorte do contrato `PositionQuery`, plano do Guerreiro §2.8).
- **REQ-BHR-172** [MVP] `distanceBetween(tokenA, tokenB)` DEVE contar a partir de qualquer célula
  ocupada por cada token.
- **REQ-BHR-173** [MVP] `areAdjacent(tokenA, tokenB)` DEVE considerar adjacência diagonal.
- **REQ-BHR-174** [MVP] Montar (1 ação, movimento) DEVE exigir adjacência e montaria pelo menos 1
  tamanho maior que o cavaleiro, e montaria voluntária: companheiro ligado ao cavaleiro, ou o Mestre
  faz; fora disso o servidor DEVE recusar com o motivo.
- **REQ-BHR-175** [MVP] Montar DEVE gravar `MountState` (§7.6) nos dois tokens no mesmo write.
- **REQ-BHR-176** [MVP] Montar, já montado, DEVE desmontar para uma célula adjacente vazia; célula
  ocupada DEVE ser recusada.
- **REQ-BHR-177** [MVP] Montado, o cavaleiro DEVE ter −2 circunstância em Reflexos, aplicado como
  efeito pelo seletor `saving-throw`; desmontar DEVE devolver o número.
- **REQ-BHR-178** [MVP] Montado, a única ação de movimento do cavaleiro DEVE ser Montar; a montaria
  companheira carregando cavaleiro DEVE usar só a Velocidade terrestre e NÃO DEVE mover e Apoiar no
  mesmo turno — salvo se o tipo tem `mount`, que ignora as duas restrições.
- **REQ-BHR-183** [MVP] "Mesmo turno" da REQ-BHR-178 DEVE ser o combate que o carimbo `movedTurn` nomeia
  (§7.6), no `round` e no `turnIndex` atuais dele, seja quem for o combatente ativo: o companheiro animal
  age no turno do dono e NÃO DEVE precisar ser combatente para o bloqueio valer.
- **REQ-BHR-184** [MVP] O servidor DEVE recusar (`CONFLICT`, com o motivo) o `effect:apply` do Apoio de um
  companheiro bloqueado — inativo (REQ-PET-121) ou montaria que andou (REQ-BHR-178) —, para o jogador e
  para o Mestre; a ficha do dono e a do companheiro DEVEM mostrar o mesmo motivo, calculado pelo mesmo
  predicado (`companionSupportBlockReasons`, `@fusion/shared`).
- **REQ-BHR-185** [MVP] Chamar Companheiro é atividade de exploração: o servidor DEVE recusar
  `companion:setActive` (`CONFLICT`, com o motivo) com combate iniciado e não encerrado numa cena que
  contém o token do companheiro ativo, e a aba Ações DEVE mostrar a linha desabilitada com o motivo.
- **REQ-BHR-186** [MVP] Comandar um Animal custa 1 ação (◆) para o dono; as 2 ações do card
  ("`<dono>` comanda `<companheiro>`: 2 ações") são as que o companheiro ganha, e o custo mostrado no card e
  no botão DEVE ser ◆.
- **REQ-BHR-187** [MVP] Em token **não vinculado**, o efeito "Montado" DEVE ser gravado na
  `actorDelta.items` do token (DEC-DOC-08) e retirado de lá ao desmontar; o ator-base compartilhado NÃO
  DEVE receber o −2 (REQ-BHR-177).
- **REQ-BHR-188** [MVP] Ao desmontar no meio do turno, cavaleiro e montaria DEVEM ficar cada um com a
  contagem de MAP que o grupo tinha naquele momento (o MAP não diminui dentro do turno); os ataques
  seguintes somam separados (REQ-CBT-071).
- **REQ-BHR-179** [MVP] "Montado" e "Reflexos −2" DEVEM aparecer como itens da faixa compacta de
  estados (DEC-BHR-16) na ficha do cavaleiro; o token NÃO ganha selo desses estados (DEC-TOK-19
  mantida; Q-BHR-01 fechada pelo Alexandre em 2026-10-05).
- **REQ-BHR-180** [MVP] Enquanto montados, o botão de golpe do cavaleiro e o da montaria DEVEM mostrar
  o MAP do **grupo** (REQ-CBT-070).
- **REQ-BHR-181** [MVP] Montado, a distância e o alcance dos ataques do cavaleiro DEVEM ser medidos a
  partir de qualquer célula ocupada pela montaria (`dados/montaria.md`).
- **REQ-BHR-182** [MVP] O Apoio do antílope DEVE aplicar no dono, via `effect:apply`, o efeito de +1d6
  sangramento persistente em golpe que causa dano a criatura ao alcance do antílope, e esse efeito
  DEVE valer **só** enquanto o dono estiver montado nele (`requiresMounted`).

### 5.6 Atletismo contra o alvo (B-F6)

- **REQ-BHR-201** [MVP] Perícia rolada contra outra criatura DEVE usar `SkillCheckContext` (plano do
  Guerreiro §2.6), com a CD lida no servidor de `system.derived.saves.<n>.dc` ou `perception.dc` do
  alvo; CD no payload DEVE ser ignorada; sem alvo resolvível, só o total, sem grau.
- **REQ-BHR-202** [MVP] O card DEVE oferecer aplicar a condição do resultado no alvo da foto da
  mensagem, aplicada por clique humano; jogador só nos alvos da `targetSnapshot`, Mestre em qualquer.
- **REQ-BHR-203** [MVP] Agarrar, Empurrar e Derrubar DEVEM ser linhas executáveis da aba Ações (não da
  tela de combate, DEC-BHR-14) e exigir alvo mirado.
- **REQ-BHR-204** [MVP] Essas manobras DEVEM rolar Atletismo no servidor contra a CD de Fortitude
  (Agarrar, Empurrar) ou de Reflexos (Derrubar) do alvo, e o card DEVE oferecer o efeito do grau
  (`ManeuverOutcome`, plano do Guerreiro §2.6).
- **REQ-BHR-205** [MVP] Essas manobras DEVEM contar para o MAP.
- **REQ-BHR-206** [MVP] Agarrar, Empurrar e Derrubar DEVEM aceitar alvo até 1 tamanho acima do
  executante.
- **REQ-BHR-207** [MVP] Com a regra `fusion-maneuver-size-limit { maneuvers, maxSizeDelta }` (Lutador
  de Titãs: 2; 3 com Atletismo lendário), o limite DEVE ser o `maxSizeDelta` da regra.
- **REQ-BHR-208** [MVP] Alvo acima do limite DEVE deixar a linha desabilitada com o motivo (ex.: "alvo
  Enorme: até Grande").

### 5.7 Runas, carteira e exceções do Mestre (B-F7)

- **REQ-BHR-221** [MVP] Toda arma DEVE oferecer o botão "Runas", que abre o editor (DEC-BHR-18), só para
  quem pode editar a arma; arma de outro dono NÃO DEVE abrir o editor.
- **REQ-BHR-222** [MVP] O editor DEVE ter o campo "Potência (bônus de ataque)" (+0 a +3) e o campo "Runa
  de ataque (dados de dano)" (nenhuma, de ataque, maior, suprema), cujo valor mostra o efeito em dados
  (DEC-BHR-19).
- **REQ-BHR-223** [MVP] O editor DEVE oferecer tantas vagas de "Runas de propriedade" quanto a potência,
  em texto livre (`dados/itens.md`).
- **REQ-BHR-224** [MVP] O editor DEVE mostrar a prévia com ataque e dados já derivados e NÃO DEVE avisar
  nem bloquear combinação nenhuma (DEC-BHR-18).
- **REQ-BHR-225** [MVP] O editor DEVE escrever `system.runes` pelo `doc:update` do dono, sem op própria.
- **REQ-BHR-226** [MVP] O servidor DEVE recusar a jogador a escrita de `system.build.gmExceptions` em
  qualquer ator e aceitar a do Mestre (`GmOnlyActorFields`, §7.9).
- **REQ-BHR-227** [MVP] O jogador DEVE continuar podendo editar a carteira (`system.currency`) do
  próprio ator (DEC-BHR-21).
- **REQ-BHR-228** [MVP] A validação de moeda existente DEVE continuar valendo para toda escrita de
  carteira.
- **REQ-BHR-229** [MVP] Atualização que não toca campo só do Mestre DEVE ter o mesmo resultado de antes.
- **REQ-BHR-230** [MVP] O Mestre DEVE ter "Ajustar carteira" na ficha de qualquer personagem, com
  entrada por moeda e total em po.
- **REQ-BHR-231** [MVP] O Plano DEVE reconhecer o requisito de **Acesso** de um talento: sem o Acesso, o
  talento DEVE ficar inelegível com o motivo.
- **REQ-BHR-232** [MVP] Talento listado em `system.build.gmExceptions` do ator DEVE ficar elegível no
  slot, com as regras da casa que valem para aquele slot, e o slot DEVE mostrar o selo "liberado pelo
  Mestre".
- **REQ-BHR-233** [MVP] Personagem que cumpre o Acesso DEVE ter o talento elegível sem exceção.

## 6. Requisitos não-funcionais

- **RNF-BHR-01** Toda rolagem, permissão, marca, montagem e aplicação de efeito desta spec é decidida no
  servidor; o cliente só pede.
- **RNF-BHR-02** Teste de regra assere pelo número do livro escrito no teste (`dados/`), nunca pela
  tabela do próprio pack.
- **RNF-BHR-03** Teste de servidor reserva porta por `packages/server/src/__tests__/helpers/ports.ts`.
- **RNF-BHR-04** Redação de visibilidade só por `packages/server/src/net/redaction.ts` +
  `isRolePrivileged` (`documents/ownership.ts`), sem predicado duplicado.

## 7. Modelo de dados e API

Os contratos abaixo são os da §2 de `docs/design/bhrotto/tasks.md`, fixados pelo nome e pelo shape.
Os contratos **importados** valem como estão nos planos de origem e não são reescritos aqui:

| Contrato importado                                     | Origem                                                     | Onde pesa                          |
| ------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------- |
| `AttackCheckContext`                                   | plano do Guerreiro §2.1 (GUE-F1-03)                        | REQ-BHR-083                        |
| `TargetGesture`                                        | plano do Guerreiro §2.2 (GUE-F1-01)                        | REQ-BHR-081                        |
| `MapCounter`                                           | plano do Guerreiro §2.3 (GUE-F1-04)                        | REQ-BHR-084, REQ-CBT-069           |
| `ManeuverAction` / `SkillCheckContext`                 | plano do Guerreiro §2.6 (GUE-F5-03, GUE-F5-05)             | REQ-BHR-201..208                   |
| `PositionQuery` (recorte)                              | plano do Guerreiro §2.8 (GUE-F3-01)                        | REQ-BHR-171..173                   |
| `TargetSelection` / `targetSnapshot`                   | plano do Alquimista §2.3 (ALQ-F1-05)                       | REQ-BHR-087, REQ-BHR-103           |
| `ApplyCondition`                                       | plano do Alquimista §2.4 (ALQ-F1-09)                       | REQ-BHR-202                        |
| `EffectItem` e `FusionExpiry`                          | plano do Alquimista §2.5 (ALQ-F2-01, ALQ-F2-09)            | §7.2                               |
| `RuleElementRegistry` / `RollNotes` / `onRollResolved` | plano do Alquimista §2.8 (ALQ-F4-01, ALQ-F4-02, ALQ-F4-09) | REQ-BHR-051..053, REQ-BHR-067..070 |

### 7.1 `TokenMark` — a Presa no token (BHR-F3-06)

```ts
// packages/shared/src/combat/token-mark.ts
interface TokenMark {
  slug: "hunted-prey" | "monster-hunter" | (string & {}); // vocabulário do predicado target:mark:<slug>
  targetTokenId: string;
  targetActorId: string; // para sobreviver à troca do token
  sceneId: string;
  createdAt: number;
  exclusive: boolean; // hunted-prey: uma por ator (nova Caçar Presa substitui)
}
// Actor.flags.fusion.tokenMarks: TokenMark[]
// ops: "mark:set" { sourceActorId, mark } · "mark:clear" { sourceActorId, slug, targetTokenId? }
```

Predicados injetados pelo servidor nas opções da rolagem: `target:mark:<slug>` quando o alvo do
`checkContext` tem marca do ator que rola **ou do dono, se quem rola é o companheiro ativo**
(DEC-BHR-07); `origin:mark:<slug>` quando quem ataca o ator está marcado por ele.

### 7.2 `FusionExpiry` com `"after-roll"` (BHR-F2-06)

```ts
// systems/pf2e/src/schemas/item-effect.ts (dono do FusionExpiry desde a ALQ-F2-01)
type FusionExpiryOn =
  | "turn-start"
  | "turn-end"
  | "round-end"
  | "combat-end"
  | "daily-prep"
  | "never"
  | "after-roll";
interface FusionExpiry {
  on: FusionExpiryOn;
  ownerActorId: string;
  remainingRounds?: number;
  rollPredicate?: string[]; // after-roll: só a rolagem que casa (ex.: ["attack-roll", "target:mark:monster-hunter"])
}
// resolvido pelo MESMO resolveExpirations (DF-08), chamado também por um ouvinte de onRollResolved.
```

### 7.3 `EffectApply` — efeito em outro ator (BHR-F4-08)

```ts
// packages/shared/src/protocol.ts
"effect:apply": {
  sourceActorId: string;
  targetActorIds: string[];
  effect: { packId: string; docId: string }; // cópia embutida com origem e início (DF-06)
  expiry?: FusionExpiry;                       // ex.: Apoio → { on: "turn-start", ownerActorId: dono }
  messageId?: string;                          // quando o alvo vem da foto da mensagem (DF-03)
}
```

### 7.4 `CompanionType`, `deriveAnimalCompanion` e `CompanionLink`

Dono do modelo: `29` (REQ-PET-098..106, REQ-PET-109..111). O shape é fixado aqui porque três
contratos desta spec o leem (`effect:apply` pelo vínculo, `TokenMark` pelo ativo, `MountState` pelo
`special`).

```ts
// systems/engine-2e/src/companions/types.ts
type CompanionStage = "young" | "mature" | "nimble" | "savage" | "specialized";
interface CompanionType {
  slug: string; // "bear", "antelope"
  sizes: Size[]; // antílope: ["med", "lg"]
  attributes: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  ancestryHp: number;
  skill: SkillSlug;
  senses: string[];
  speeds: Record<string, number>;
  strikes: { slug: string; die: DieFace; damageType: string; traits: string[] }[];
  support: { effectRef: { packId: string; docId: string }; requiresMounted?: boolean };
  advancedManeuver: { slug: string; summary: string };
  special: ("mount")[];
  stagePreview: Record<Exclude<CompanionStage, "young">, string[]>; // sem nível de classe (DEC-BHR-12)
}
deriveAnimalCompanion(input: { type: CompanionType; stage: CompanionStage; masterLevel: number; size?: Size }):
  { level; hp; ac; saves; perception; skills; strikes; size; speeds; breakdown: Record<string, string> };

// Ator familiar (schemas/actor-familiar.ts) — CompanionLink
// system.companionKind = "animalCompanion"; system.masterActorId; system.companion = {
//   typeSlug, stage, grantSlotId /* slot do Plano que o criou */, active: boolean, size }
```

> **Emenda (revisão da onda 2, I-5/I-4/I-6).**
>
> - **Estágio e trilha.** `specialized` vem **depois** de `nimble` ou `savage` e inclui as vantagens da trilha de onde veio. O estágio continua um valor único; quem indexa por estágio (multiplicador de dados do Apoio, `deriveAnimalCompanion`) DEVE ler por `companionStageIncludes` / `stageDiceMultiplier` (`systems/pf2e/src/schemas/companion-type.ts`), nunca pelo nome cru do estágio. O `stageDiceMultiplier` do efeito traz também `specialized`.
> - **Alcance e montaria do Apoio.** Não existem predicados `target:within-companion-reach` nem `self:mounted`. O alcance do companheiro é o campo `system.fusion.gate = { withinReachOf: "companion" }` do efeito, avaliado no servidor por `PositionQuery.distanceBetween`; "só montado" é `support.requiresMounted` do tipo.
> - **Crítico.** O dano extra do Apoio do urso é dano do urso: a regra do efeito carrega `doubleOnCrit: false`. O motor de dano ainda não consome `damage-dice`; a BHR-F4-09 DEVE honrar o campo e cobrir o crítico no teste. _(Confirmado na revisão da onda 13, RAW: o texto diz que a criatura sofre o dano "do urso", dano separado do Golpe, então o golpe dobra e o 1d8 do urso não. O teste `extra-damage-pack.test.ts` liga o efeito real do pack ao servidor.)_

### 7.5 `CombatStatesStrip` (BHR-F2-10)

Componente reutilizável de ficha com VM puro: recebe os estados ativos (efeitos, condições,
interruptores ligados) e devolve itens `{ nome, texto, expandido }`, um expandido por vez por clique
(REQ-BHR-064..066).

### 7.6 `MountState` (BHR-F5-02)

```ts
// Scene.tokens[].flags.fusion.mount = { riderTokenId?: string; mountTokenId?: string }
// ops: "mount:mount" { riderTokenId, mountTokenId } · "mount:dismount" { riderTokenId, to: {x,y} }
// mapGroupOf(combatantId): cavaleiro e montaria compartilham o MapCounter enquanto montados.
// Na peça da montaria o servidor também carimba, ao mover o par durante um combate em andamento:
//   movedTurn?: { combatId: string; round: number; turn: number }   // turn = turnIndex do combate
// Escrito pelo servidor no mesmo write do movimento e limpo com o resto da flag (REQ-TOK-116, REQ-BHR-183).
// op: "companion:setActive" { companionActorId } — troca o companheiro ativo (REQ-PET-120, REQ-BHR-185).
```

### 7.7 `ExecutableActionRow` (BHR-F2-08, recorte da GUE-F5-01)

```ts
// sheets/pf2e/src/lib/sheets/pf2e/actions/executableRows.ts
interface ExecutableActionRow {
  slug: string; // "hunt-prey", "command-an-animal", "support", "mount", "trip", ...
  requires?: ("target" | "mounted" | "not-mounted" | "companion" | "inactive-companion")[];
  roll?: {
    kind: "skill" | "attack";
    skill?: SkillSlug;
    against?: "fortitude" | "reflex" | "will" | "ac" | "perception";
  };
  onUse: { selfEffect?: EffectRef; mark?: TokenMark["slug"]; card: string; op?: string };
}
// registro dirigido por slug; a linha sem registro continua navegável (D-G08).
// "inactive-companion": há outro companheiro animal (inativo) para chamar. O contexto da aba ganhou
// `inactiveCompanions`, `supportBlock` (motivos de `supportBlockReasons`) e `inEncounter` (REQ-BHR-185); o uso
// ganhou `companionOp`.
```

### 7.8 `ManeuverSizeLimit` e `WeaponRunes`

```ts
// engine-2e/src/maneuvers.ts — limite padrão +1 tamanho; handler kebab-case
// "fusion-maneuver-size-limit" { maneuvers: [...], maxSizeDelta: 2 } (Lutador de Titãs; 3 se lendário)
// item-weapon.ts (existe) — system.runes = { potency: 0..3, striking: 0..3, property: string[] }; o editor só escreve
```

`striking` 0..3 = nenhuma, de ataque (2 dados), maior (3 dados), suprema (4 dados) — `dados/itens.md`.

### 7.9 `GmOnlyActorFields` (BHR-F7-02)

```ts
// packages/server/src/documents/doc-handlers.ts (rejectUnwritableField)
// GmOnlyActorFields = ["system.build.gmExceptions"]; // string[] de ids de talento liberados pelo Mestre
// a carteira (system.currency) NÃO é campo só do Mestre (DEC-BHR-21)
```

## 8. Dependências

| Spec | O que esta spec consome / não pode contrariar                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `29` | O companheiro como ator vinculado (DEC-PET-01), a autorização de criação pelo servidor (DEC-PET-03). Esta spec emenda, não redefine.                                  |
| `41` | A peça não guarda a marca (DEC-TOK-22); extensão por `flags` (DEC-TOK-20); permissão de movimento (REQ-TOK-032); sem ícones de status na peça (DEC-TOK-19, Q-BHR-01). |
| `10` | Mira efêmera (REQ-CBT-055), eventos de turno (REQ-CBT-026, REQ-CBT-027).                                                                                              |
| `38` | CA/CD/alvo lidos do banco (REQ-ACH-070), sem alvo sem grau (REQ-ACH-071).                                                                                             |
| `40` | Mirar é gesto de canvas (DEC-CBA-05, REQ-CBA-076).                                                                                                                    |
| `17` | Derivação da ficha, runas fundamentais (REQ-PF2-130), MAP (REQ-PF2-031, REQ-PF2-035).                                                                                 |
| `15` | Motor de effects (REQ-SYS-080, REQ-SYS-090), predicados avaliados tarde (DEC-SYS-05).                                                                                 |

## 9. Critérios de aceitação

- **CA-BHR-01** A ficha do Bhrotto nível 3 bate com o PDF do jogador: CA 19, Fort +9, Ref +7 (+5
  montado), Von +9, ataque +9, dano `2d10+4`, PV 46 (sem o talento geral pendente).
- **CA-BHR-02** O urso e o antílope do nível 3 batem com a tabela d de `dados/companheiros.md`.
- **CA-BHR-03** Caçar Presa num alvo mirado marca o token, posta um card, e a Astúcia só soma contra ele.
- **CA-BHR-04** O Caçador de Monstros soma +1 no primeiro ataque contra a Presa e some depois dele.
- **CA-BHR-05** O Apoio do urso some no início do próximo turno do dono, não no do urso.
- **CA-BHR-06** Montado no antílope, o cavaleiro anda com ele, tem Reflexos −2 e compartilha o MAP.
- **CA-BHR-07** Derrubar contra alvo grande demais fica desabilitado com o motivo; com Lutador de
  Titãs, o limite sobe.
- **CA-BHR-08** O editor de runas aceita qualquer combinação e a prévia mostra os números derivados.
- **CA-BHR-09** O jogador não grava exceção de talento; o Mestre grava, e o Plano a mostra com selo.
- **CA-BHR-10** O teste de varredura das regras do Bhrotto passa sem regra inerte.

## 10. Questões em aberto

- **Q-BHR-01** A ficha BHR-F5-04 pede selos "Reflexos −2" e "Montado" **no token**, o que colide com a
  DEC-TOK-19 (ícones de status ficam fora da peça). Até o Alexandre decidir, esses estados aparecem só
  na faixa compacta (REQ-BHR-179), e o "montado" fica visível pela pilha dos tokens (REQ-CNV-106).
- **Q-BHR-02** Caçar Presa também ignora a penalidade da segunda faixa de alcance contra a Presa
  (`dados/talentos.md`). Nenhuma ficha do plano a cobre; não afeta o Bhrotto (arma corpo a corpo).
- **Q-BHR-03** No sucesso crítico do Caçador de Monstros, aliados avisados ganham o mesmo bônus
  (`dados/talentos.md`). O plano aplica só no caçador; estender pede `effect:apply` com alvos aliados.
- **Q-BHR-04** A página do Wildborne no Lost Omens World Guide não foi confirmada (`dados/wildborne.md`).
- **Q-BHR-05** O Domador de Bestas permite até 4 companheiros com 1 ativo; o limite desta frente conta
  só concessões (DEC-BHR-10). O teto de quatro entra com os talentos de nível 4+.
- **Q-BHR-06** Penalidade de ataque múltiplo reduzida por efeito (Rajada / Borda do Caçador, lacuna G9)
  não tem contrato: `calculateMapPenalty` só conhece −5/−10 e −4/−8.
- **Q-BHR-07** Queda ou desmonte forçado da montaria (GM Core: Reflexos CD 20, `dados/montaria.md`) está
  "NÃO CONFIRMADO" e fora das fichas.

## 11. Referências

- `docs/design/bhrotto/decisoes.md`, `docs/design/bhrotto/tasks.md` (§1, §2, §4).
- `docs/design/bhrotto/dados/companheiros.md`, `montaria.md`, `talentos.md`, `itens.md`, `wildborne.md`.
- `docs/design/bhrotto/dependencias-importadas.md` (N1–N8, G1–G10).
- Plano do Guerreiro (`origin/docs/guerreiro-tasks`, `docs/design/guerreiro/tasks.md` §2) e do
  Alquimista (`origin/docs/alquimista-tasks`, `docs/design/alquimista/tasks.md` §2).
- `docs/design/bhrotto/prototipo-bhrotto-fiel.html` (telas T1–T6).

## 12. Emendas que esta spec obriga

Registradas aqui para que nenhuma spec fique contrariada em silêncio (`CONVENCOES.md` §2). Nenhum id
é renumerado.

**Faixas reservadas e não usadas.** A ficha BHR-F0-01 reservou faixas maiores do que esta versão
escreveu, para que nenhuma outra frente as ocupe: `REQ-BHR-` 001 a 250 (blocos por fase; o bloco F4,
121 a 170, fica vazio de propósito — o companheiro é da `29`), `REQ-PF2-` 284 a 298, `REQ-CNV-` 108,
`REQ-TOK-` 119 e `REQ-SYS-` 165. Ficam reservadas para esta frente e só nascem por emenda desta spec.
As citações de ids de planos ainda não escritos (Guerreiro, Alquimista) nas fichas do plano são
referências declaradas, não ids desta spec.

| Spec        | O que muda                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` | Linha `REQ-BHR-` no registro de prefixos; a 52 entra no índice; 47–51 entram nos números reservados.                                                                                                                                                                                                 |
| `29`        | REQ-PET-005, REQ-PET-040, REQ-PET-053 e REQ-PET-090 passam de [V2] a [MVP], com redação ajustada; REQ-PET-050, REQ-PET-092 e REQ-PET-093 ganham a regra do companheiro animal; DEC-PET-03 ganha detector de concessão para `animalCompanion`; Q-PET-02 fechada (DEC-BHR-02); novos REQ-PET-098..125. |
| `17`        | REQ-PF2-021 ganha o override de PV de ancestralidade (REQ-PF2-279); novos REQ-PF2-279..283.                                                                                                                                                                                                          |
| `10`        | REQ-CBT-055 inalterada (a Presa não é mira, DEC-BHR-05); novos REQ-CBT-068..071; REQ-CBT-071 diz que o MAP não diminui no turno ao desmontar (REQ-BHR-188).                                                                                                                                          |
| `06`        | Novos REQ-CNV-105..107 (selo da Presa, pilha de tokens montados, arraste do cavaleiro).                                                                                                                                                                                                              |
| `41`        | REQ-TOK-042 ganha a exceção do cavaleiro montado (REQ-TOK-117); novos REQ-TOK-115..118 e REQ-TOK-117a; REQ-TOK-116 ganha o carimbo `movedTurn` e o desmonte do Mestre.                                                                                                                               |
| `09`        | Novos REQ-CHT-061..064 (cards de Caçar Presa, Caçador de Monstros, Comandar, Apoio).                                                                                                                                                                                                                 |
| `15`        | Novos REQ-SYS-161..164 (handlers e expiração `after-roll`, `effect:apply`).                                                                                                                                                                                                                          |
