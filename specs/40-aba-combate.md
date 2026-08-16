# 40 — Aba Combate

- **Título:** Aba Combate — a cabeça de turno e a fila do encontro
- **Status:** draft v0.1 — **WIP declarado** (grill de 2026-08-16; ver §11)
- **Data:** 2026-08-16
- **Baseada em:**
  - `36-gaveta-lateral.md` — spec-mãe; §7 fixa o contrato que esta filha cumpre, e a DEC-GAV-01 batizou a aba.
  - `10-combate-e-iniciativa.md` — área dona do encontro: `Combat`/`Combatant`, iniciativa, turnos, eventos de ciclo de vida.
  - `05-usuarios-e-permissoes.md` — papéis, ownership e `isRolePrivileged`.
  - `11-ui-framework-e-fichas.md` — janela flutuante (REQ-UIF-009), drag & drop (REQ-UIF-044), teclado (REQ-UIF-064), fronteira de persistência (DEC-UIF-10).
  - `39-contatos.md` — contrato de exibição de condição (DEC-CTT-11) e a decisão de tirar vida da gaveta (DEC-CTT-02), que esta spec delimita.
  - Protótipo `packages/client/prototypes/combat-tab.prototype.html` — variante "cabeça de turno", decidida em 2026-08-16 (as três variantes iniciais estão no histórico do arquivo).
  - `packages/client/src/components/combat/CombatPanel.svelte` — o painel de hoje, que esta spec passa a definir como alvo.

> **Spec-filha da 36.** Esta spec é dona do **painel** da aba Combate: o que ele
> mostra, para quem, e com que gesto. Ela não define largura, posição, gesto de
> recolher nem persistência de `open`/`activeTab` — isso é da 36. E não define o
> que é um encontro, como a iniciativa é rolada ou como o turno avança: isso é da
> 10, que ela cita.

---

## 1. Objetivo

Dar à mesa, em 300px, a única pergunta que o combate faz o tempo todo — **de quem
é a vez, e o que essa pessoa está sofrendo** — sem que o Mestre precise caçar o
botão de avançar e sem entregar ao jogador informação que ele não deveria ter.

## 2. Escopo

### 2.1 Inclui

- A **cabeça de turno**: quem age agora, sua vida, suas condições e os controles de turno.
- A **fila**: quem vem depois, quem já agiu na rodada, quem está oculto ou derrotado.
- A **montagem** do encontro: adicionar participantes, rolar iniciativa, começar.
- O que cada papel vê de **vida**, de **iniciativa** e de **condição**.
- O **badge** da aba e o aviso de vez.
- O que abre **fora** da gaveta.

### 2.2 Não inclui

- O contêiner (trilho, gaveta, largura, gesto de recolher, tipos de badge) → `36-gaveta-lateral.md`.
- O modelo do encontro, a fórmula de iniciativa, a ordem da fila, os eventos de turno e o marcador no canvas → `10-combate-e-iniciativa.md`.
- **Targeting** (marcar alvo) → sai desta aba por DEC-CBA-05; segue na spec 10 (REQ-CBT-053..055) e no canvas.
- O que é uma condição, o que ela faz e quem a aplica → `15-api-de-sistemas.md` e a spec do sistema.
- A ficha do participante → `11-ui-framework-e-fichas.md`; esta aba apenas a abre.
- **O que é um token**, de onde vem a lista de candidatos e como ele se liga ao ator → lacuna estrutural declarada em DEC-CBA-06.
- Automação de dano, efeitos de fim de turno, `Delay`/`Ready` → `10` e `15`; esta spec só reserva o lugar (§11).

## 3. Conceitos e terminologia

| Conceito            | Definição                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Participante**    | Quem está na fila do encontro. É o `Combatant` da spec 10 visto pela tela; esta spec nunca o chama de "token" (DEC-CBA-06).       |
| **Cabeça de turno** | Bloco fixo no topo do painel com o participante da vez, sua vida, suas condições e os controles de turno.                         |
| **Fila**            | O resto da ordem, rotacionada a partir do turno atual: primeiro quem falta agir nesta rodada, depois quem já agiu.                |
| **Montagem**        | Estado do painel entre criar o encontro e começá-lo (`started: false`): é onde a iniciativa tem número e a ordem se define.       |
| **Criatura**        | Ator com a faceta `creature` (`ver 45-atores.md`, DEC-ATR-03). É a palavra usada nas regras de visibilidade de vida (DEC-CBA-03). |
| **Aviso de vez**    | Faixa no topo do painel e cor do badge quando o participante da vez pertence ao usuário.                                          |
| **Encontro ativo**  | O `Combat` da cena ativa, criado e ainda não encerrado — inclui a montagem (DEC-CBT-06 mantém um por cena).                       |

## 4. Decisões

### DEC-CBA-01 — A aba é a tela do encontro, não o motor dele

O painel exibe e comanda o que a spec 10 já define; ele **não** decide ordem,
fórmula, desempate, expiração de condição ou o que acontece na virada de rodada.
Toda ação do painel é uma mensagem para o servidor (REQ-CBT-004, REQ-CBT-010..017).

- **Racional:** é a mesma disciplina das outras filhas — a gaveta é vitrine da
  área dona. Duplicar regra de turno na tela é o caminho mais curto para o
  cliente e o servidor discordarem no meio de uma sessão.

### DEC-CBA-02 — Cabeça de turno com altura fixa, e o botão que não sai do lugar

O bloco do participante da vez tem **altura fixa**, definida por token de tema, e
o controle de avançar é **ancorado no rodapé desse bloco**. Passar cinco turnos
seguidos é clicar cinco vezes no mesmo pixel.

- A cabeça **pode crescer** por um gesto explícito do usuário (expandir a lista
  de condições, REQ-CBA-052).
- **Avançar ou recuar o turno devolve a cabeça à altura padrão**, sempre. O
  estado expandido é do turno, não do painel.
- **Racional:** a operação mais repetida do Mestre numa sessão é "próximo". Um
  botão que se move conforme o participante tem duas ou sete condições transforma
  a operação mais repetida na mais imprecisa. Altura fixa é o que compra isso;
  crescer sob demanda é o que evita a informação sumir.
- **Alternativa rejeitada:** _cabeça de altura livre com o botão fixo no rodapé do
  painel_ — libera o conteúdo, mas separa o comando do sujeito e devolve à fila o
  espaço que ela não usa bem em 300px.

### DEC-CBA-03 — Vida: o jogador nunca vê a de criatura; o Mestre precisa ver, com barra e número

- **Papel privilegiado** vê, de **todos** os participantes, **barra e número**
  (`atual/máximo`) — na cabeça e na fila.
- **Jogador** vê a vida dos **personagens de jogador** e **nunca** a de criatura,
  em forma nenhuma: sem número, sem barra, sem fração, sem degrau qualitativo.
- **Racional:** o Mestre administra o encontro e precisa saber quanto falta para
  o goblin cair — negar isso a ele é obrigá-lo a abrir ficha no meio do turno. O
  jogador sabendo o mesmo transforma decisão de ficção em aritmética, que é
  exatamente o que a DEC-CTT-02 quis evitar na aba Contatos.
- **Relação com a DEC-CTT-02:** ela tirou vida da aba Contatos, para papel nenhum.
  Isto não a contraria: vida aparece **onde o combate acontece**, e a vida dos
  personagens de jogador é a mesma que o painel de Comitiva do Hub já exibe
  (REQ-HUB-044). O que não existe é vida de criatura fora do controle do Mestre.
- **Fronteira honesta:** esconder no cliente não é proteger. Ver DEC-CBA-11 e
  Q-CBA-02 — hoje o dado de vida de criatura chega ao cliente por outro caminho
  (barras de recurso do token, REQ-CNV-090), e fechar isso é decisão da área dona.

### DEC-CBA-04 — O número da iniciativa serve para montar a ordem, e some quando ela está montada

Na **montagem**, cada participante exibe seu valor de iniciativa: é o que explica
e permite ajustar a ordem. **Com o encontro em andamento, o número não é exibido
para papel nenhum** — a ordem é a própria lista.

- Reordenar continua existindo, por **arraste** (REQ-CBT-017, REQ-UIF-044), não
  por edição de número.
- O jogador **nunca** vê o valor de iniciativa de uma criatura, nem na montagem.
- **Racional:** depois de rolada, a iniciativa não é mais informação — é posição.
  Mantê-la à mostra gasta a largura mais escassa da tela com um número que
  ninguém consulta, e convida à comparação ("o goblin tirou 17?") que a mesa não
  precisa fazer.
- **Alternativa rejeitada:** _manter o número só para o Mestre_ — ele é quem menos
  precisa, porque é ele quem monta a fila; e duas telas diferentes por papel na
  mesma lista custam mais do que valem.

### DEC-CBA-05 — Marcar alvo não é assunto desta aba

O painel **não** oferece marcar ou limpar alvo. Targeting continua existindo como
mecanismo (REQ-CBT-053..055), operado onde os alvos estão: no canvas.

- **Racional:** mirar é gesto espacial. Fazê-lo por uma lista de nomes é uma
  segunda porta para a mesma coisa, com menos informação — e alvo tem dono
  (`userId`) e ciclo de vida próprios, que não são desta tela.

### DEC-CBA-06 — A aba fala em participantes; "token" não é vocabulário dela, porque não é conceito definido

Nenhuma tela desta spec usa a palavra **token**, e o modelo desta spec não
depende de nenhuma definição de token.

- **Fato que motiva a decisão:** não existe spec dona de Token. O conceito está
  repartido entre a `02` (REQ-DOC-031..034, DEC-DOC-08 — `actorLink` e herança
  token→actor), a `06` (REQ-CNV-025..033, REQ-CNV-089/090 — footprint, ring,
  barras, ícones de status) e a `04` (movimento otimista), e nenhuma delas o
  define como documento com dono. Isso já custou uma decisão de banco de dados
  (a forma do estado quente foi adiada por falta dessa spec) e, pela regra
  `prefixo-com-dono` do `CONVENCOES.md` §4, é uma área sem dona.
- **Consequência aceita:** a lista de candidatos a entrar no encontro
  (REQ-CBA-060) é definida **por enquanto** como "o que a cena ativa oferece", e
  a spec de Token, quando existir, é quem passa a dizer o que é aquilo. O gesto
  não muda; a fonte pode mudar.
- **O que isso não é:** não é adiar a aba. Nada do que esta spec decide depende
  de como Token será modelado — a aba lida com o `Combatant` da spec 10.

### DEC-CBA-07 — Badge: ponto de estado desde que o encontro existe, âmbar quando é a sua vez

A aba fornece um **ponto de estado** (REQ-GAV-020), aceso enquanto houver
encontro ativo na cena — **inclusive durante a montagem**, porque é lá que o
jogador tem o que fazer (rolar a própria iniciativa). Quando o participante da vez
pertence ao usuário, o ponto muda para **âmbar**.

- **Racional:** a 36 já previa "é a sua vez" como caso futuro do ponto (DEC-GAV-06);
  isto o concretiza sem criar um segundo badge nem virar contador. Combate ativo e
  "é a sua vez" são o mesmo fato em intensidades diferentes, e o trilho continua
  sem regra de negócio: quem acende é esta spec.
- **Sem som e sem piscar** (REQ-GAV-024). O aviso sonoro, se um dia existir, é
  preferência do usuário na spec 37, não decisão desta aba.

### DEC-CBA-08 — O jogador encerra o próprio turno, e nada além disso

Quando é a vez de um participante do usuário, o painel oferece a ele **encerrar o
próprio turno**. O jogador **não** avança o turno alheio, não recua, não encerra o
encontro.

- **Racional:** o Mestre não é despachante de "acabei". A ação é do dono do turno,
  e é a única ação de turno que um jogador pode ter sem virar co-mestre.
- **Servidor manda:** a permissão é verificada no servidor (REQ-CBA-080); esconder
  o botão não é a proteção.

### DEC-CBA-09 — Encontro encerrado some na hora; resumo é trabalho futuro

Ao encerrar, o painel volta imediatamente ao **estado vazio**, para os dois papéis.

- **Racional:** a aba mostra o que está acontecendo. Um resumo pós-combate exige
  saber se o `Combat` é apagado ou arquivado — pergunta que a própria spec 10 tem
  em aberto. Sem essa decisão, um resumo não teria de onde ler.
- Resumo (quantas rodadas, quem caiu) fica **[V2]** e amarrado àquela decisão
  (REQ-CBA-016, Q-CBA-04).

### DEC-CBA-10 — A ficha abre fora da gaveta, e o ownership decide de quem

Duplo-clique no participante — e um botão alcançável por teclado — abre a **ficha**
em janela flutuante (REQ-UIF-009), para quem já tem acesso ao documento.

- Papel privilegiado abre a de qualquer participante; o jogador abre a dos atores
  sobre os quais tem posse. Para os demais, **não há gesto**.
- **Racional:** é o mesmo par de gestos que a DEC-CTT-13 fixou em Contatos — a mesa
  não deveria reaprender abrir ficha por aba. E é o que resolve "preciso ver a ficha
  do monstro no turno dele" sem esticar a gaveta (DEC-GAV-04).

### DEC-CBA-11 — Esconder na tela não é proteger, e esta spec diz onde está a diferença

O que o painel **não exibe** e o que o servidor **não envia** são coisas distintas,
e esta spec as separa por escrito:

- **Redigido no servidor** (não sai no payload): participante com `hidden: true`
  para papel não privilegiado — a regra é da spec 10 (REQ-CBT-031/033) e passa pelo
  módulo único de redação (REQ-DOC-058, REQ-SEC-020).
- **Decisão de tela** (o dado pode estar no cliente por outro caminho): a vida de
  criatura, que hoje o cliente conhece porque o token pode desenhá-la
  (REQ-CNV-090). Esta spec **não** finge que escondê-la aqui é segurança; ela
  registra a divergência em Q-CBA-02.
- **Racional:** a 38 e a 39 pagaram para aprender isso. Declarar qual das duas
  proteções está em jogo é o que impede um requisito de tela ser lido como
  garantia de sigilo.

### DEC-CBA-12 — A montagem é um estado do próprio painel

Criar o encontro, escolher quem entra e rolar iniciativa acontecem **dentro da
gaveta**, no mesmo painel, sem janela flutuante e sem mudar a largura (DEC-GAV-04).
A lista de candidatos aparece como bloco recolhível no topo do painel.

- **Racional:** montar é operação de lista, e a gaveta é boa em lista. Uma janela
  para isso obrigaria o Mestre a alternar contexto justamente no momento em que
  ele está olhando o mapa para escolher quem entra.

## 5. Requisitos funcionais

> Blocos de dezena por tema: 001–009 identidade e badge; 010–019 estados do painel
> e cabeçalho; 020–029 cabeça de turno; 030–039 fila; 040–049 vida; 050–059
> condições; 060–069 montagem; 070–079 turno e permissão de ação; 080–089 permissão
> e redação; 090–099 estado vazio e acessibilidade. Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-CBA-001** [MVP] A aba DEVE se registrar por `registerSidebarTab`
  (REQ-GAV-030) com `id: "combat"`, `group: "all"`, ícone próprio e rótulo por
  chave i18n, na terceira posição do grupo de todos (REQ-GAV-003).
- **REQ-CBA-002** [MVP] A aba DEVE fornecer um badge do tipo **ponto de estado**
  (REQ-GAV-020), sem número.
- **REQ-CBA-003** [MVP] O ponto DEVE estar aceso enquanto houver encontro ativo na
  cena ativa, inclusive antes de o encontro começar (`started: false`), e DEVE
  apagar quando o encontro for encerrado.
- **REQ-CBA-004** [MVP] O ponto DEVE ser exibido em **realce âmbar** quando o
  participante da vez pertencer ao usuário, e voltar ao realce comum quando o turno
  passar; abrir a aba NÃO DEVE alterá-lo (REQ-GAV-022).
- **REQ-CBA-005** [MVP] O badge NÃO DEVE emitir som nem piscar (REQ-GAV-024).

### 5.2 Estados do painel e cabeçalho

- **REQ-CBA-010** [MVP] O painel DEVE ter exatamente três estados: **vazio** (sem
  encontro), **montagem** (encontro criado, `started: false`) e **em andamento**
  (`started: true`).
- **REQ-CBA-011** [MVP] O cabeçalho DEVE exibir, em andamento, o número da rodada
  (REQ-CBT-043) e, na montagem, a contagem de participantes e quantos ainda estão
  sem iniciativa.
- **REQ-CBA-012** [MVP] O cabeçalho NÃO DEVE conter ✕ de fechar (DEC-GAV-03) nem
  qualquer controle de largura.
- **REQ-CBA-013** [MVP] Na montagem, papel privilegiado DEVE ter no cabeçalho a
  ação de **começar o encontro** (REQ-CBT-004); os demais papéis NÃO DEVEM tê-la.
- **REQ-CBA-014** [MVP] Trocar de aba e voltar NÃO DEVE alterar o estado do
  encontro; o painel DEVE se remontar a partir do estado do servidor (REQ-GAV-017).
- **REQ-CBA-015** [MVP] Ao encerrar o encontro, o painel DEVE passar imediatamente
  ao estado vazio para todos os usuários, sem etapa intermediária de confirmação de
  leitura (DEC-CBA-09).
- **REQ-CBA-016** [V2] O painel PODE exibir um resumo do encontro encerrado
  (rodadas, participantes derrotados); depende da decisão de arquivamento da spec 10
  (Q-CBA-04).

### 5.3 Cabeça de turno

- **REQ-CBA-020** [MVP] Em andamento, o painel DEVE exibir no topo, fora da área
  rolável, a **cabeça de turno** com o participante da vez: retrato, nome, vida
  (conforme §5.5) e condições (conforme §5.6).
- **REQ-CBA-021** [MVP] A cabeça DEVE ter **altura fixa**, definida por token de
  tema, igual para qualquer participante, e o controle de avançar turno DEVE ficar
  **ancorado no rodapé da cabeça**, na mesma posição em todos os turnos.
- **REQ-CBA-022** [MVP] A cabeça PODE crescer além da altura fixa **apenas** por
  ação explícita do usuário (REQ-CBA-052); nenhuma mudança de dado — condição nova,
  nome longo, vida — DEVE alterar sua altura.
- **REQ-CBA-023** [MVP] Avançar ou recuar o turno DEVE devolver a cabeça à altura
  padrão, descartando qualquer expansão do turno anterior.
- **REQ-CBA-024** [MVP] A cabeça DEVE identificar o participante da vez como sendo
  do usuário quando for o caso, sem depender apenas de cor.
- **REQ-CBA-025** [MVP] Conteúdo que não couber na altura fixa DEVE ser truncado de
  forma legível (reticências no nome, teto de condições de REQ-CBA-051), NUNCA
  cortado no meio de um controle.

### 5.4 Fila

- **REQ-CBA-030** [MVP] Abaixo da cabeça, o painel DEVE listar os demais
  participantes na ordem da fila (REQ-CBT-016), **rotacionada a partir do turno
  atual**: primeiro quem ainda age nesta rodada, depois quem já agiu.
- **REQ-CBA-031** [MVP] O grupo de quem já agiu DEVE ser visualmente distinto e
  rotulado, e NÃO DEVE ser omitido da lista.
- **REQ-CBA-032** [MVP] Cada linha DEVE exibir retrato, nome, condições (§5.6) e a
  vida que aquele papel pode ver (§5.5).
- **REQ-CBA-033** [MVP] Participante derrotado DEVE ser exibido com marcação
  explícita (não só opacidade) e permanecer na fila, coerente com `skipDefeated`
  (DEC-CBT-07).
- **REQ-CBA-034** [MVP] Participante oculto (`hidden: true`) DEVE ser exibido a
  papel privilegiado com indicação de que está oculto, e NÃO DEVE aparecer para os
  demais (REQ-CBT-031..033).
- **REQ-CBA-035** [MVP] Papel privilegiado DEVE poder reordenar a fila por arraste
  (REQ-CBT-017, REQ-UIF-044), com alça visível ao apontar e alternativa por teclado
  (REQ-CBA-093).
- **REQ-CBA-036** [MVP] A fila DEVE permanecer utilizável com pelo menos **20
  participantes**, com rolagem própria e sem que a cabeça de turno role junto.

### 5.5 Vida

- **REQ-CBA-040** [MVP] Papel privilegiado DEVE ver, de todos os participantes,
  **barra e número** (`atual/máximo`), na cabeça e na fila.
- **REQ-CBA-041** [MVP] Usuário sem papel privilegiado DEVE ver a vida dos
  **personagens de jogador** e NÃO DEVE ver a vida de criatura em forma alguma —
  número, fração, barra, percentual ou degrau qualitativo (DEC-CBA-03).
- **REQ-CBA-042** [MVP] A barra DEVE comunicar o nível também por texto ou forma,
  nunca só por cor (REQ-CBA-094).
- **REQ-CBA-043** [MVP] Quando o valor de vida não for resolvível para um
  participante, o painel DEVE **omitir** a vida daquele participante, NUNCA exibir
  barra cheia ou zero como marcador (mesma disciplina de REQ-CNV-090).
- **REQ-CBA-044** [V2] O painel PODE exibir um segundo recurso rastreado ao lado da
  vida, fornecido pela system API (REQ-CBT-047); o MVP exibe apenas vida.

### 5.6 Condições

- **REQ-CBA-050** [MVP] Cabeça e fila DEVEM exibir as condições ativas do
  participante como etiquetas de texto, sem ícone, seguindo o contrato declarado
  pelo sistema (REQ-SYS-043 com a emenda de DEC-CTT-11): cor por `tone`, ênfase
  preenchida para crítica, valor colado ao rótulo em numeral tabular, ajuda em
  tooltip desenhado, e degradação aberta quando a declaração for incompleta.
- **REQ-CBA-051** [MVP] A ordem das etiquetas DEVE ser críticas, penalidades,
  situações, benefícios; alfabética dentro de cada grupo. A cabeça e a fila DEVEM
  exibir no máximo **duas** etiquetas mais um indicador "+N".
- **REQ-CBA-052** [MVP] Acionar o indicador "+N" na cabeça DEVE expandir a lista
  no próprio painel, crescendo a cabeça (REQ-CBA-022), e NÃO DEVE abrir janela nem
  alterar a largura da gaveta.
- **REQ-CBA-053** [MVP] Condição de um participante cuja vida o usuário não pode
  ver **continua sendo exibida**: condição é o que a mesa enxerga na ficção
  (DEC-CTT-11), vida é contabilidade.
- **REQ-CBA-054** [MVP] Mudança de condição em participante visível DEVE se
  refletir no painel em tempo real, sem reabrir a aba.

### 5.7 Montagem

- **REQ-CBA-060** [MVP] Na montagem, papel privilegiado DEVE poder abrir, dentro do
  painel, a lista de candidatos a entrar no encontro oferecidos pela cena ativa, e
  adicionar cada um como participante (REQ-CBT-002).
- **REQ-CBA-061** [MVP] A lista de candidatos DEVE ser um bloco do próprio painel,
  recolhível, sem janela flutuante e sem alterar a largura da gaveta (DEC-CBA-12).
- **REQ-CBA-062** [MVP] Nenhuma tela desta spec DEVE usar a palavra "token" na
  interface (DEC-CBA-06).
- **REQ-CBA-063** [MVP] Papel privilegiado DEVE poder, na montagem, rolar iniciativa
  de todos, rolar apenas das criaturas e zerar todas (REQ-CBT-011, REQ-CBT-015).
- **REQ-CBA-064** [MVP] Na montagem, cada participante DEVE exibir seu valor de
  iniciativa, ou marca explícita de que ainda não rolou; papel privilegiado DEVE
  poder defini-lo manualmente (REQ-CBT-014).
- **REQ-CBA-065** [MVP] O jogador DEVE poder rolar a iniciativa dos seus próprios
  participantes a partir do painel, e apenas dela (REQ-CBT-034).
- **REQ-CBA-066** [MVP] Quando o sistema oferecer escolha de estatística de
  iniciativa (REQ-CBT-035), o painel DEVE oferecê-la no mesmo gesto de rolar, e
  registrar a escolha no participante; a forma exata está em Q-CBA-03.
- **REQ-CBA-067** [MVP] O jogador NÃO DEVE ver o valor de iniciativa de criatura
  em momento algum, nem na montagem.
- **REQ-CBA-068** [MVP] Papel privilegiado DEVE poder remover um participante do
  encontro (REQ-CBT-003), na montagem e em andamento.

### 5.8 Turno e permissão de ação

- **REQ-CBA-070** [MVP] Em andamento, o valor de iniciativa NÃO DEVE ser exibido
  para papel algum (DEC-CBA-04); a ordem é comunicada pela posição na lista.
- **REQ-CBA-071** [MVP] Papel privilegiado DEVE poder avançar e recuar o turno e
  encerrar o encontro a partir da cabeça de turno (REQ-CBT-004).
- **REQ-CBA-072** [MVP] Quando o participante da vez pertencer ao usuário sem papel
  privilegiado, o painel DEVE oferecer **encerrar o próprio turno**, que avança o
  turno pela mesma operação do servidor (REQ-CBT-021).
- **REQ-CBA-073** [MVP] Usuário sem papel privilegiado NÃO DEVE ter controle de
  avançar, recuar ou encerrar quando a vez não for de um participante seu.
- **REQ-CBA-074** [MVP] O painel DEVE exibir, para usuário sem papel privilegiado,
  um aviso de vez quando for a vez de um participante seu e, caso contrário, quantos
  turnos faltam até ela.
- **REQ-CBA-075** [MVP] Papel privilegiado DEVE poder marcar e desmarcar um
  participante como derrotado e como oculto a partir da fila (REQ-CBT-024/025,
  REQ-CBT-031).
- **REQ-CBA-076** [MVP] O painel NÃO DEVE oferecer marcar ou limpar alvo
  (DEC-CBA-05).
- **REQ-CBA-077** [MVP] Duplo-clique em um participante DEVE abrir a ficha em janela
  flutuante (REQ-UIF-009), e cada linha e a cabeça DEVEM oferecer um controle de
  ficha alcançável por teclado; para quem não tem acesso ao ator, o gesto NÃO DEVE
  existir (DEC-CBA-10).

### 5.9 Permissão e redação

- **REQ-CBA-080** [MVP] Esconder um controle no cliente NÃO É proteção
  (REQ-GAV-034): avançar turno, encerrar encontro, rolar iniciativa de terceiros,
  ocultar, marcar derrotado e remover participante DEVEM ser verificados no
  servidor, pelo predicado da área dona (`isRolePrivileged`, spec 05).
- **REQ-CBA-081** [MVP] Encerrar o próprio turno DEVE ser aceito pelo servidor
  somente quando o solicitante for dono do participante da vez; qualquer outro caso
  DEVE ser recusado (DEC-CBA-08).
- **REQ-CBA-082** [MVP] Participante com `hidden: true` NÃO DEVE ser entregue a
  usuário sem papel privilegiado — nem em snapshot, nem em broadcast, nem em replay
  —, pela redação única do servidor (REQ-DOC-058, REQ-SEC-020, REQ-CBT-031).
- **REQ-CBA-083** [MVP] A ausência de vida de criatura para o jogador (REQ-CBA-041)
  DEVE ser implementada como regra de exibição desta aba, e a spec NÃO DEVE
  descrevê-la como garantia de sigilo enquanto o dado chegar ao cliente por outro
  caminho (DEC-CBA-11, Q-CBA-02).

### 5.10 Estado vazio e acessibilidade

- **REQ-CBA-090** [MVP] Sem encontro ativo, papel privilegiado DEVE ver estado
  vazio com as ações de criar encontro e adicionar participantes.
- **REQ-CBA-091** [MVP] Sem encontro ativo, usuário sem papel privilegiado DEVE ver
  estado vazio informativo, sem ação alguma.
- **REQ-CBA-092** [MVP] Com encontro criado e nenhum participante, o painel DEVE
  exibir estado vazio próprio da montagem, distinto do estado sem encontro.
- **REQ-CBA-093** [MVP] Todo controle do painel DEVE ser operável por teclado com
  foco visível (REQ-UIF-064), incluindo avançar turno, expandir condições, abrir
  ficha e reordenar a fila.
- **REQ-CBA-094** [MVP] Vez, derrota, ocultação e nível de vida NÃO DEVEM ser
  comunicados só por cor: DEVEM ter forma, texto ou rótulo acessível associado.

## 6. Requisitos não-funcionais

- **RNF-CBA-01** [MVP] Abrir a aba NÃO DEVE carregar ficha alguma: o painel se monta
  com o estado do encontro e os dados já sincronizados dos atores visíveis.
- **RNF-CBA-02** [MVP] Avançar o turno DEVE refletir no painel dentro do orçamento
  de REQ-CBT-NFR-001 (≤ 200 ms em LAN), e a cabeça NÃO DEVE piscar ou remontar por
  inteiro entre turnos.
- **RNF-CBA-03** [MVP] A altura da cabeça NÃO DEVE variar com o dado exibido: dois
  turnos seguidos com participantes diferentes DEVEM manter o controle de avançar na
  mesma coordenada.
- **RNF-CBA-04** [MVP] O painel DEVE permanecer legível na largura fixa da gaveta
  (REQ-GAV-012) e em viewport estreita (REQ-GAV-040).

## 7. Onde cada coisa é gravada

| O quê                                  | Onde                            | Quem escreve | Referência               |
| -------------------------------------- | ------------------------------- | ------------ | ------------------------ |
| Encontro, participantes, turno, rodada | `world.db`                      | servidor     | REQ-CBT-001/005          |
| Iniciativa e estatística escolhida     | no participante, no `world.db`  | servidor     | REQ-CBT-012..018         |
| `hidden` e `defeated`                  | no participante, no `world.db`  | servidor     | REQ-CBT-024, REQ-CBT-031 |
| Condições                              | no ator, pela system API        | servidor     | REQ-SYS-043              |
| Expansão do "+N" da cabeça             | cliente, memória de sessão      | o próprio    | REQ-CBA-023              |
| `open` / `activeTab` da gaveta         | cliente (`ClientUIPreferences`) | o próprio    | REQ-GAV-014              |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "combat"`, grupo `all`, terceira do grupo, rótulo por chave
   i18n, ícone próprio (REQ-CBA-001).
2. **Badge** — ponto de estado, aceso enquanto houver encontro ativo, em realce
   âmbar quando for a vez do usuário; abrir a aba não o altera (REQ-CBA-002..005).
3. **Cabeçalho do painel** — rodada em andamento, contagem na montagem, e a ação de
   começar para papel privilegiado; sem ✕ (REQ-CBA-011..013).
4. **Estado vazio** — um por papel sem encontro, e um próprio para encontro sem
   participantes (REQ-CBA-090..092).
5. **O que abre fora da gaveta** — apenas a ficha do participante, por duplo-clique
   ou controle de teclado (REQ-CBA-077).
6. **Permissão de conteúdo** — `isRolePrivileged` da spec 05 para as ações de
   comando, e a redação única do servidor para participante oculto
   (REQ-CBA-080..083).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), ordem no trilho (REQ-GAV-003), largura
  (REQ-GAV-012), contrato de badge (REQ-GAV-020..024), preferências locais
  (REQ-GAV-014), fronteira de segurança (REQ-GAV-034), viewport estreita
  (REQ-GAV-040).
- `10` — dona do encontro: modelo, iniciativa, turnos, visibilidade e o marcador no
  canvas. Esta spec exibe e comanda; não redefine. Emendas em §12.
- `05` — papéis e ownership; `isRolePrivileged` como único predicado de privilégio.
- `11` — janela flutuante (REQ-UIF-009), arraste (REQ-UIF-044), teclado
  (REQ-UIF-064), fronteira de persistência (DEC-UIF-10).
- `15` — registro declarativo de condições (REQ-SYS-043), com a emenda de `tone`,
  `help` e `critical` que a 39 obrigou.
- `21` / `02` — redação de payload por papel (REQ-SEC-020, REQ-DOC-058), que sustenta
  REQ-CBA-082.
- `28` — painel de Comitiva (REQ-HUB-044): é a referência de que vida de personagem
  de jogador já é visível à mesa; esta aba não inventa um segundo critério.
- `39` — contrato de exibição de condição (DEC-CTT-11) e a delimitação de DEC-CTT-02.
- `06` — vida de criatura chega ao cliente pelas barras de recurso do token
  (REQ-CNV-090); é o que impede REQ-CBA-041 de ser lido como sigilo (Q-CBA-02).
- Futura spec de **Token** — dona do conceito que hoje não tem dona (DEC-CBA-06).

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-CBA-001 | O Mestre avança cinco turnos seguidos clicando no mesmo ponto da tela: a cabeça não muda de altura entre participantes com 0, 2 e 7 condições.                                                  |
| CA-CBA-002 | O Mestre expande o "+N" de um participante com sete condições, vê todas, avança o turno e a cabeça volta à altura padrão, sem expansão herdada.                                                 |
| CA-CBA-003 | O Mestre vê barra e número de vida de todos os participantes; o jogador, na mesma cena, não vê vida alguma de criatura — nem barra, nem número, nem degrau — e vê a dos personagens de jogador. |
| CA-CBA-004 | Na montagem, cada participante mostra o valor de iniciativa; ao começar o encontro, nenhum valor de iniciativa aparece na tela de nenhum papel, e a ordem continua a mesma.                     |
| CA-CBA-005 | O jogador não vê o valor de iniciativa de criatura nem durante a montagem.                                                                                                                      |
| CA-CBA-006 | Com o encontro em andamento e a gaveta recolhida, o ícone da aba mostra o ponto; quando chega a vez do personagem do jogador, o ponto fica âmbar; abrir a aba não apaga nem muda o ponto.       |
| CA-CBA-007 | Na vez do seu personagem, o jogador encerra o próprio turno e a fila avança; na vez de outro, ele não tem controle de turno algum, e uma tentativa forjada é recusada pelo servidor.            |
| CA-CBA-008 | Um participante oculto pelo Mestre não aparece no painel do jogador, e o payload recebido por ele não contém aquele participante.                                                               |
| CA-CBA-009 | O painel não oferece marcar alvo em lugar nenhum, para papel nenhum.                                                                                                                            |
| CA-CBA-010 | Duplo-clique no participante abre a ficha em janela; o mesmo é alcançável por `Tab` até o controle de ficha e `Enter`; para ator sem acesso, não há gesto nem erro.                             |
| CA-CBA-011 | O Mestre encerra o encontro: os dois papéis voltam ao estado vazio imediatamente, sem resumo e sem resíduo na fila.                                                                             |
| CA-CBA-012 | Com 20 participantes, a fila rola e a cabeça de turno permanece fixa no topo; a lista mostra quem falta agir antes de quem já agiu.                                                             |
| CA-CBA-013 | Nenhuma tela da aba usa a palavra "token"; a lista de candidatos aparece dentro do painel e a gaveta não muda de largura ao abri-la.                                                            |
| CA-CBA-014 | Uma condição declarada como crítica aparece preenchida e em primeiro lugar, com valor colado ao rótulo, e a ajuda do sistema aparece em tooltip desenhado ao apontar.                           |

## 11. O que esta spec ainda NÃO decide

Esta é a parte WIP, declarada em vez de fingida. Nada aqui é requisito sem tag: é
questão em aberto ou trabalho de outra spec.

| Assunto                                              | Por que ainda não                                            | Onde vai ser decidido |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| Economia de ações (as três ações do PF2e no painel)  | Sem uso real: só uma sessão jogada mostra se cabe em 300px   | Q-CBA-05, spec 17/15  |
| Aplicar dano e cura a partir do painel               | É automação, não exibição; a 10 e a 15 são as donas          | spec 10, spec 15      |
| Efeitos de fim de turno e expiração de condição      | Rodam no servidor por evento (REQ-CBT-029); a aba só reflete | spec 10, spec 15      |
| `Delay` e `Ready`                                    | Já são [V2] na área dona                                     | REQ-CBT-030           |
| Resumo do encontro encerrado                         | Depende de apagar ou arquivar o `Combat`                     | REQ-CBA-016, Q-CBA-04 |
| De onde vem a lista de candidatos, e o que ela lista | Token não tem spec dona                                      | futura spec de Token  |
| Múltiplos encontros na mesma sessão                  | [V2] na área dona                                            | REQ-CBT-007           |

## 12. Emendas que esta spec obriga

Registradas para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `10` | **REQ-CBT-041** já foi reescrito: a exigência de exibir valor de iniciativa e HP em toda linha do tracker deu lugar a iniciativa **só na montagem** (DEC-CBA-04, REQ-CBA-064/067/070) e vida **conforme o papel** (DEC-CBA-03, REQ-CBA-040/041/043) — emenda aplicada na `10` em 2026-08-16, junto da nota sob **REQ-CBT-040** ("aba da sidebar"), que passa a registrar que é concretizado por esta spec, e da linha de `40` na tabela de dependências da `10`. **REQ-CBT-053..055** (targeting) continuam válidos e inalterados, com o registro de que o painel não oferece o gesto (DEC-CBA-05, REQ-CBA-076). **REQ-CBT-047** também já foi reescrito: a exigência de exibir o recurso rastreado "ao lado do HP" ficava ancorada num HP que a reescrita de REQ-CBT-041 não garante mais; o contrato de `trackedResource` e o fornecimento do valor pela system API seguem [MVP], mas a exibição passa a ser condicionada à vida ser exibível ao papel (REQ-CBA-040/041/043) e, no painel desta spec, é [V2] por REQ-CBA-044 — emenda aplicada na `10` em 2026-08-16. |
| `11` | **REQ-UIF-002** já teve sua lista de abas substituída pela DEC-GAV-01; nada muda além de registrar que o painel de combate é definido aqui.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `39` | Nada muda. Registra-se que a **DEC-CTT-02** (vida fora da aba Contatos) não veta vida no combate: as duas telas passam a ter regras explícitas e não concorrentes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `15` | Nada muda. Esta spec é o segundo consumidor do contrato de condição emendado pela 39 (`tone`, `help`, `critical`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| —    | **Token vira lacuna registrada**: `specs/README.md` e `CONVENCOES.md` §7 passam a listar o número **41** como reservado para a spec de Token, hoje repartida entre `02`, `04` e `06` sem dona (DEC-CBA-06).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 13. Questões em aberto

- **Q-CBA-01** — O aviso de vez deve ter alguma manifestação fora da gaveta (faixa no
  canvas, título da janela do navegador) quando o jogador está com a aba recolhida e
  olhando o mapa? Som está fora por REQ-GAV-024.
- **Q-CBA-02** — A vida de criatura chega ao cliente do jogador pelas barras de
  recurso do token (REQ-CNV-090). Enquanto isso for verdade, REQ-CBA-041 é regra de
  tela, não sigilo. Fechar isso é decisão da área dona — e provavelmente da spec de
  Token, quando existir.
- **Q-CBA-03** — A escolha da estatística de iniciativa (REQ-CBT-035, ex.: Furtividade
  em Avoid Notice) aparece como menu no botão de rolar, como campo por participante,
  ou fora da aba, na ficha? O protótipo não a desenhou.
- **Q-CBA-04** — Encerrar o encontro apaga ou arquiva o `Combat`? A spec 10 tem a
  pergunta em aberto; a resposta destrava REQ-CBA-016.
- **Q-CBA-05** — A mesa vai querer a economia de ações (as três ações do PF2e) na
  cabeça de turno? Só decidir depois de uma sessão inteira jogada com esta aba.
- **Q-CBA-06** — Quando o encontro está em montagem e o jogador ainda não rolou, o
  ponto de estado basta, ou a mesa precisa de um chamado mais forte ("role sua
  iniciativa")?

## 14. Referências

- Protótipo decidido: `packages/client/prototypes/combat-tab.prototype.html` (as três
  variantes iniciais estão no histórico do arquivo).
- Grill de 2026-08-16 (sessão de spec-filha da 36, quarta filha).
- Implementação atual, que esta spec passa a definir como alvo:
  `packages/client/src/components/combat/CombatPanel.svelte`,
  `packages/client/src/lib/combat/{combatStore.svelte.ts,combatTracker.ts,combatVisibility.ts}`,
  `packages/client/src/lib/canvas/combat/CombatTurnMarker.ts`,
  `packages/server/src/net/redaction.ts` (módulo único de redação).
