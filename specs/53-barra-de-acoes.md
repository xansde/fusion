# 53 — Barra de Ações

- **Título:** Barra de Ações — a barra do personagem no rodapé da mesa: golpes, magias, ações, itens,
  reações e testes a um clique ou a uma tecla
- **Status:** draft v0.1 (2026-10-11)
- **Nível:** Área (teste de corte no §1)
- **Baseada em:**
  - `docs/design/barra-de-acoes/plano.md` — plano v1, aprovado em 11/10/2026: o que já existe (§3), o
    desenho (§4), a arquitetura (§5), as fases e as tarefas `BAR-Fx-yy` (§6), as dependências de outras
    frentes (§7), os riscos (§9) e o fora do escopo (§10).
  - `docs/design/barra-de-acoes/decisoes.md` — as decisões do Alexandre D-BA01..D-BA15 (11/10/2026),
    que viram DEC-BAR-01..15 na mesma ordem.
  - `docs/design/barra-de-acoes/prototipo-barra-fiel.html` — protótipo fiel, telas T1–T7: a fonte
    visual (`docs/design/PROCESSO-UI.md`, P1).
  - `11-ui-framework-e-fichas.md` — o shell e o rodapé (REQ-UIF-001, REQ-UIF-006), a escala de z
    (REQ-UIF-008), o registro de ficha (REQ-UIF-018, REQ-UIF-019) e as preferências de dispositivo
    (DEC-UIF-10).
  - `14-macros-e-automacao.md` — a hotbar por usuário que esta spec substitui (REQ-MAC-012..018,
    DEC-MAC-06).
  - `20-assets-e-midia.md` e `21-seguranca.md` — envio, listagem e apagar de imagem (REQ-AST-011,
    REQ-AST-029..031), diretórios por papel (REQ-SEC-043) e redação por papel (REQ-SEC-020).
  - `23-acessibilidade-e-dispositivos.md` — atalhos e guard (REQ-A11-020, REQ-A11-023), toque e tablet
    (REQ-A11-043..049).
  - `28-hub-do-jogador.md` — a barra de comando do rodapé (REQ-HUB-007); `36-gaveta-lateral.md` — a
    gaveta à direita (REQ-GAV-012, REQ-GAV-013, REQ-GAV-040).
  - `40-aba-combate.md` e `10-combate-e-iniciativa.md` — de quem é a vez e Encerrar turno
    (REQ-CBA-072, REQ-CBA-081, Q-CBA-01), alvos e MAP contado no servidor (REQ-CBT-053..056,
    REQ-CBT-069).
  - `41-token.md`, `45-atores.md` e `05-usuarios-e-permissoes.md` — a posse (REQ-TOK-032, REQ-TOK-034,
    REQ-USR-012..014) e o espaço de condições fora da peça (DEC-TOK-19).
  - `17-sistema-pf2e.md`, `52-cacador-companheiro-e-montaria.md` e `47-fabricacao-e-alquimia.md` — o
    conteúdo PF2e que a barra põe em cena, as linhas executáveis do Bhrotto e o recurso de classe que a
    F7 espera.

> **Spec de área.** Esta spec é dona da **barra de ações**: de quem ela é, como o sistema a alimenta,
> o que ela guarda no ator e como se usa. Ela **não** redefine o ator (`45`), a peça (`41`), a rolagem
> e o MAP (`08`, `10`, `17`), a ficha (`11`), o chat (`09`) nem o envio de arquivo (`20`): cita e, onde
> o texto deles contraria a barra, emenda (§12). A barra é uma **superfície nova sobre os mesmos
> caminhos da ficha**: não cria regra de jogo.

> **Aviso clean-room.** Esta spec descreve o **comportamento observável** de barras de ação de jogos e
> de módulos de mesa virtual (plano §2 e §12) e não copia código, texto nem arte de nenhum deles. Sem
> arte da Paizo: os ícones são genéricos e livres (REQ-AST-048), e os nomes de ação são os do pack
> pt-BR, os mesmos da ficha.

---

## 1. Objetivo

Pôr o que se usa em combate a um clique ou a uma tecla, sempre do personagem que está na mão, sem abrir
a ficha e sem cobrir o mapa — e fazer isso como uma **superfície nova sobre os mesmos caminhos** da
ficha: sem regra nova, com o servidor dono de toda rolagem, de todo grau e de toda validação.

Hoje o jogador abre a ficha numa janela por cima do mapa, acha a aba, acha a linha e clica. Funciona,
mas é lento, esconde o mapa justo quando ele mais importa e não mostra o que interessa no turno: de
quem é a vez, qual é o MAP do próximo ataque, quantos slots restam. Para o Mestre é pior, porque cada
NPC é outra ficha aberta. A barra põe isso no rodapé da mesa.

**Teste de corte** (`CONVENCOES.md` §1). Decidir de quem é a barra obriga a decidir o que o provedor
recebe; o que o provedor devolve obriga a decidir o identificador da entrada; o identificador é o que
o favorito e o ícone customizado guardam; e o que se guarda no ator obriga a decidir quem o escreve e
como a imagem chega a quem vê o ator. As quatro decisões se restringem mutuamente. Já decidir o que é
um ator, uma peça, uma rolagem ou uma ficha **não** é daqui: as áreas `45`, `41`, `08`/`17` e `11` já
decidiram, e esta spec as cita. Por isso a barra é uma área, com dona própria, e não um recorte que
combina decisões que já existem.

**Tags.** Nesta spec, [MVP] marca as fases F1 a F4 do plano (a primeira e a segunda entregas: a barra
do personagem, os favoritos e a barra do Mestre) e [V2] marca as fases F5 a F8 (itens, companheiros,
motor das ações e acabamento). A tag diz em que entrega o requisito nasce; ela não diz se a barra
entra na definição de sessão completa de `00`. A única exceção é REQ-BAR-024, [V2] embora nasça
da F0: depende de a linha `build/app` convergir com a alfa, e o plano não a põe em nenhuma fase.

## 2. Escopo

### 2.1 Inclui

- A **regra de posse**: de quem é a barra, quem a vê e o store do **ator ativo** onde ela é aplicada
  (DEC-BAR-01, DEC-BAR-10).
- O **contrato do registry**: o provedor que o sistema registra, a entrada, a faixa de estado e a
  execução, e a fronteira entre a casca do core e o conteúdo do satélite (DEC-BAR-05).
- A **anatomia**: faixa de estado, abas, Favoritos, slots com o nome curto embaixo, recolher e o lugar
  no rodapé (DEC-BAR-07, DEC-BAR-09, DEC-BAR-15).
- O **custo, o MAP do próximo ataque e de quem é a vez**, dentro da D-15 do plano do Alquimista: sem
  contador de ações.
- A **interação**: clique, menu de contexto, tooltip, alvo e mira, arrastar, atalhos de teclado e o
  guard que os protege.
- Os **favoritos no ator** e a semente da primeira abertura (DEC-BAR-06, DEC-BAR-08).
- O **ícone customizado** por entrada, o envio de imagem aberto ao jogador, a galeria compartilhada de
  ícones e a regra de quem troca (DEC-BAR-02, DEC-BAR-03).
- O **conteúdo PF2e do personagem** (golpes, magias, ações, testes), a **barra de NPC** só do Mestre, os
  itens, os companheiros, o **motor das ações que faltam** e o que ele espera de outras frentes
  (DEC-BAR-11, DEC-BAR-12, DEC-BAR-13), e o alcance, a mira, o tablet e o SF2e.
- A **substituição da hotbar** da spec `14` (DEC-BAR-04).

### 2.2 Não inclui

- **Contador de ações por turno** (pips, orçamento, bloqueio): fora por D-15. Se um dia voltar, o lugar
  dele é a spec `49` (`REQ-ACO-`), já reservada.
- **Token HUD** (REQ-UIF-008a): tem outro propósito, os controles da peça. O botão direito no token é
  a mira.
- **Macros e QuickAction declarativas** como entrada da barra: a macro volta depois como um `kind` de
  entrada, e o assunto retorna à spec `14`.
- **Prévia de caminho com custo em ações**: depende de régua com regra (spec `41` ou frente futura).
- **Chance de acerto na prévia**: vazaria a CA do alvo para o jogador.
- **Sugestão de 3ª ação, presets e várias linhas configuráveis**: luxo; avaliar depois do uso na mesa,
  depois da F8.
- **Endurecimento anti-cheat** (bônus calculado no servidor, dono do `speakerActorId`, conjuração
  autoritativa): defeito anterior à barra, que cabe a uma frente de segurança. A barra não piora nada
  e não conserta isso.
- **A regra de jogo**: golpe, grau, MAP, conjuração, consumo e permissão são do servidor e das specs
  `08`, `10` e `17`. A barra só os chama.
- **A ficha** de personagem e de NPC (`11`, `17`): a barra a chama por "Abrir na ficha" e extrai dela a
  lógica de execução sem mudar o comportamento (REQ-BAR-052).
- **Etmos**: legado, vive na linha `build/app`.

## 3. Conceitos e terminologia

| Conceito              | Definição                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Barra de ações**    | A barra do rodapé da mesa. É sempre de um ator, mostra o que ele pode usar no turno e executa pelos mesmos caminhos da ficha.                                     |
| **Ator ativo**        | O ator cuja barra está na tela. Publicado por um store reativo **depois** do gate de posse (DEC-BAR-01).                                                          |
| **Gate de posse**     | A regra, no store do ator ativo, que impede que um ator alheio chegue ao provedor quando o usuário é jogador.                                                     |
| **Ator alheio**       | Para um jogador, qualquer ator de que ele não é OWNER: um NPC ou o personagem de outro jogador.                                                                   |
| **Casca**             | A parte da barra que mora no core: posição, faixa de estado, abas, slots, tooltip, menu, teclado, favoritos e Encerrar turno. Não conhece nenhum sistema de jogo. |
| **Provedor**          | O objeto que o sistema registra para dizer quais entradas o ator tem, qual é a faixa de estado e como executar cada entrada (`ActionBarProvider`, §7.1).          |
| **Entrada**           | Uma coisa executável da barra: golpe, magia, ação, item, reação, alternável ou teste (`ActionBarEntry`). Tem `id` estável no ator.                                |
| **Variante**          | Uma forma de executar a mesma entrada: o número do ataque (MAP), o número de ações, o patamar de conjuração, o elemento da Rajada.                                |
| **Aba**               | Uma categoria da barra: Favoritos, Golpes, Magias, Ações, Itens, Reações e Testes.                                                                                |
| **Favoritos**         | A linha principal: 12 slots ligados às teclas 1–9, 0, − e =, guardados no ator.                                                                                   |
| **Slot**              | A casa de uma entrada: imagem ou ícone, nome curto embaixo, custo, tecla, selo de quantidade ou de patamar e bônus ou CD final.                                   |
| **Semente**           | Os favoritos iniciais, gravados na primeira abertura da barra de um ator.                                                                                         |
| **Faixa de estado**   | A parte da barra com retrato, nome, PV, recursos, condições, alvo, de quem é a vez e o MAP do próximo ataque.                                                     |
| **Ícone customizado** | Imagem do acervo que o usuário escolhe para uma entrada, guardada em `flags.fusion.actionBar.icons`. Sem ela, vale o ícone genérico.                              |
| **Galeria de ícones** | O conjunto dos envios de imagem marcados como ícone, que qualquer jogador pode listar e carregar.                                                                 |
| **MAP**               | Penalidade de ataque múltiplo. O servidor conta os ataques do turno de cada combatente (REQ-CBT-069); a barra só exibe e usa essa contagem.                       |
| **Área livre**        | A faixa horizontal do canvas entre a borda esquerda e a gaveta lateral, onde a barra se centraliza.                                                               |
| **Modo mira**         | O estado em que o cursor vira mira para escolher o alvo de uma entrada que precisa dele e não tem alvo marcado. Cancela com `Esc`. [V2]                           |

## 4. Decisões

As quinze decisões do Alexandre em `docs/design/barra-de-acoes/decisoes.md` (D-BA01..D-BA15) viram
DEC-BAR-01..15, **na mesma ordem**. As três primeiras vieram uma a uma, durante o protótipo, em
11/10/2026; as doze seguintes eram as questões abertas DC-01..DC-12 do plano e foram aceitas todas
como recomendadas no mesmo dia ("Concordo com os DCs ditos e pode seguir para a execução!").

| Origem (`decisoes.md`) | Decisão desta spec |
| ---------------------- | ------------------ |
| D-BA01                 | DEC-BAR-01         |
| D-BA02                 | DEC-BAR-02         |
| D-BA03                 | DEC-BAR-03         |
| D-BA04 (DC-01)         | DEC-BAR-04         |
| D-BA05 (DC-02)         | DEC-BAR-05         |
| D-BA06 (DC-03)         | DEC-BAR-06         |
| D-BA07 (DC-04)         | DEC-BAR-07         |
| D-BA08 (DC-05)         | DEC-BAR-08         |
| D-BA09 (DC-06)         | DEC-BAR-09         |
| D-BA10 (DC-07)         | DEC-BAR-10         |
| D-BA11 (DC-08)         | DEC-BAR-11         |
| D-BA12 (DC-09)         | DEC-BAR-12         |
| D-BA13 (DC-10)         | DEC-BAR-13         |
| D-BA14 (DC-11)         | DEC-BAR-14         |
| D-BA15 (DC-12)         | DEC-BAR-15         |

**Decisão herdada: D-15 (plano do Alquimista).** O Alexandre decidiu, na frente do Alquimista, que o
contador de ações por turno está fora do escopo — ele precisa desfazer, desistir e planejar sem nada
contar nem bloquear — e que `ActionCost` fica só como dado exibido (`docs/design/alquimista/tasks.md`,
D-15 e ALQ-F7-02). `decisoes.md` registra que ela continua valendo sobre tudo aqui. A barra mostra o
custo, o MAP do próximo ataque (contado no servidor), de quem é a vez e Encerrar turno; não tem pips,
não conta e não bloqueia (§5.4). Não é uma DEC desta spec porque a decisão é de outra frente; é uma
restrição que esta spec não pode contrariar.

### DEC-BAR-01 — A barra é só do dono: o jogador nunca vê a de um ator alheio

O jogador **nunca** vê a barra de um ator que não é dele. Selecionar o token de um NPC, ou de outro
jogador, não muda a barra, que continua no personagem do jogador. Só o Mestre vê a barra de NPC. A
regra é um **gate de posse no store do ator ativo**, antes do provedor, com teste negativo; o chip de
alvo usa o nome redigido, o mesmo que o jogador já vê no token.

- **Origem:** D-BA01 (Alexandre, 11/10/2026: "não será aceitável que um player veja a barra de ações
  de um NPC ao selecionar ele").
- **Racional:** hoje qualquer clique seleciona qualquer token, inclusive o de um NPC. Sem o gate, a
  barra mostraria ao jogador os golpes, a CA, os PV e as magias do NPC. O gate mora **no store**, antes
  do provedor, para que o provedor nunca seja chamado com ator alheio. O teste de posse é o que o
  cliente já usa (REQ-TOK-032); não nasce predicado novo (REQ-TOK-034).
- **Tarefas:** BAR-F1-01, BAR-F2-06, BAR-F4-02.

### DEC-BAR-02 — Cada entrada aceita uma imagem customizada

Cada entrada da barra aceita uma **imagem customizada**, se o usuário quiser; sem imagem, vale o ícone
genérico. A escolha fica no ator, em `flags.fusion.actionBar.icons`: um mapa do `id` da entrada para
um caminho `/assets/…` do acervo do mundo — sem URL externa —, com **teto de entradas**. O campo é
registrado em `server/assets/asset-fields.ts`.

- **Origem:** D-BA02 (Alexandre, 11/10/2026: "quero que tenha como adicionar imagem customizada para
  cada ícone, se eu quiser").
- **Racional:** o `FilePicker` aceita URL, mas a imagem precisa obedecer à CSP e ao grant de leitura.
  Sem o registro em `asset-fields.ts`, a imagem não carrega para os outros que veem o ator. O teto
  existe porque um jogador que escrevesse milhares de caminhos no mapa do próprio ator geraria milhares
  de grants assinados numa só requisição — o caso que o próprio `asset-fields.ts` documenta.
- **Tarefas:** BAR-F3-05.

### DEC-BAR-03 — O jogador troca só os ícones do próprio personagem; o envio de imagem é aberto

O jogador **só altera os ícones do próprio personagem** — os atores de que é dono; o servidor recusa a
escrita em ator alheio, com teste negativo. O Mestre altera em qualquer um. O **envio de imagem fica
aberto a todo jogador** (emenda da REQ-AST-011, spec `20`), e há uma **galeria compartilhada** só com
os envios marcados como ícone: o jogador também pode escolher um ícone que outro já enviou. Mapas,
retratos e handouts seguem fora da lista do jogador.

- **Origem:** D-BA03 (Alexandre, 11/10/2026: "Não vamos limitar o upload dos jogadores. Qualquer um
  pode trocar ícones que consigam alcançar" e "Deixa o player escolher ícones que outros já enviaram
  também. A questão que eu demandei ali é que ele só consiga alterar os ícones do seu próprio
  personagem").
- **Racional:** o risco que o plano registra é "mais arquivos no acervo; um ícone enviado por um
  jogador fica visível a todos". A mitigação é que a validação de tipo e tamanho do pipeline vale igual
  para todos; só os envios marcados como ícone entram na galeria; mapas, retratos e handouts ficam fora
  da lista do jogador porque **o nome do arquivo pode ser spoiler**; o Mestre apaga o que quiser
  (apagar já é só dele); e não há cota, por decisão.
- **Tarefas:** BAR-F0-02, BAR-F3-05.

### DEC-BAR-04 — A barra substitui a hotbar

A barra **substitui a hotbar** da spec `14` (REQ-MAC-012..018) e a de REQ-UIF-006: é **contextual ao
personagem**, não por usuário. A macro vira, no futuro, mais um `kind` de entrada.

- **Origem:** D-BA04 (DC-01, aceita como recomendada).
- **Racional:** a spec `14` pede uma hotbar por usuário, com 5 páginas de 10 slots de macro, e o
  servidor já tem `UserSchema.hotbar` e `MacroSchema` sem UI, sem rota e sem execução. A barra é a
  versão contextual disso: segue o **personagem**. Assim não convivem dois modelos de barra.
- **Rejeitado:** manter as duas (hotbar de macros por usuário e barra do ator).
- **Tarefas:** BAR-F0-02, BAR-F1-04, BAR-F1-05.

### DEC-BAR-05 — Casca no core, conteúdo pelo sistema

A **casca** mora no core e o **conteúdo** vem do sistema, por um registry no padrão do
`registerPf2eSheets` — o mesmo que a ficha e o card de chat já usam. O core só importa o satélite por
`sat/index.ts`.

- **Origem:** D-BA05 (DC-02, aceita como recomendada).
- **Racional:** o core não sabe o que é um golpe PF2e. O sistema diz quais entradas o ator tem e como
  executar cada uma, chamando as **mesmas funções** da ficha; nenhuma regra é reescrita na barra.
- **Rejeitado:** a barra inteira no satélite — é mais rápido, mas a casca fica presa ao PF2e.
- **Tarefas:** BAR-F1-02, BAR-F2-01..BAR-F2-07.

### DEC-BAR-06 — Os favoritos vivem no ator

Os favoritos ficam **no ator**: seguem o personagem em qualquer dispositivo, e o Mestre os vê.

- **Origem:** D-BA06 (DC-03, aceita como recomendada).
- **Rejeitado:** por usuário — cada um arruma a sua, inclusive para o mesmo ator.
- **Tarefas:** BAR-F3-01.

### DEC-BAR-07 — Favoritos de 12 slots mais abas por categoria

A composição é **Favoritos** (12 slots, teclas 1–9, 0, − e =) mais **abas por categoria**: Golpes,
Magias, Ações, Itens, Reações e Testes.

- **Origem:** D-BA07 (DC-04, aceita como recomendada).
- **Rejeitado:** grade única com filtros (como no BG3) ou só slots manuais (como no WotR).
- **Tarefas:** BAR-F1-04, BAR-F1-05, BAR-F3-01.

### DEC-BAR-08 — Os favoritos nascem de uma semente; depois só o jogador mexe

Os favoritos recebem uma **semente na primeira abertura** (golpes, magias e ações mais usadas). Depois
disso **só o jogador mexe**: nada novo entra sozinho.

- **Origem:** D-BA08 (DC-05, aceita como recomendada).
- **Racional:** a barra se encher sozinha e mexer no que o jogador arrumou é a crítica comum ao BG3 e
  ao DOS2 (plano §2.2). O que é novo vai para as abas.
- **Rejeitado:** auto-adicionar tudo que for novo.
- **Tarefas:** BAR-F3-01.

### DEC-BAR-09 — Na alfa, a barra é dona do centro-inferior

Na linha alfa, **a barra é dona do centro-inferior** do rodapé. Se as linhas convergirem, a barra de
comando do Hub (spec `28`, que só existe em código na `build/app`) vira um **grupo compacto na ponta**
da barra de ações, como os botões de menu do BG3 e do WotR.

- **Origem:** D-BA09 (DC-06, aceita como recomendada).
- **Rejeitado:** empilhar as duas barras.
- **Tarefas:** BAR-F0-02, BAR-F1-04.

### DEC-BAR-10 — Mestre sem seleção: barra oculta

O Mestre sem seleção não vê a barra: ela fica **oculta**.

- **Origem:** D-BA10 (DC-07, aceita como recomendada).
- **Rejeitado:** mostrar a barra do último NPC usado.
- **Tarefas:** BAR-F1-01, BAR-F1-04, BAR-F4-02.

### DEC-BAR-11 — Ação sem motor aparece e posta o card

Desmoralizar, Fintar e as demais ações sem motor **aparecem e postam o card da ação**, sem rolagem
automática, até a F7.

- **Origem:** D-BA11 (DC-08, aceita como recomendada).
- **Rejeitado:** ficar de fora até ter motor.
- **Tarefas:** BAR-F2-04, BAR-F7-01.

### DEC-BAR-12 — Absorver os recortes que a barra precisa; esperar só três peças

A frente **absorve os recortes de que a barra precisa**, como o Bhrotto fez com as peças dos planos do
Guerreiro e do Alquimista (D-B08 do Bhrotto): o consumo de item, o golpe de NPC, as manobras que
faltam (Desarmar, Reposicionar, Escapar), Erguer um Escudo com o bônus de CA e Bloqueio com Escudo.
**Espera** só três peças: o pool de reação (GUE-F4-01), as posturas com estado (ANI-F3-03 ou
GUE-F6-01) e o **contador** genérico de recurso de classe na faixa de estado, como "Frascos versáteis
6/6" (ALQ-F3-02/04, spec `47`). Ação de classe que já funciona na ficha, como Caçar Presa (frente
Bhrotto), entra na F2 com o "Usar" de hoje.

- **Origem:** D-BA12 (DC-09, aceita como recomendada). Perguntado se "recurso de classe" deixava Caçar
  Presa de fora, o Alexandre ouviu que não: o que espera a frente Alquimista é só o contador ("ah
  entendi. Beleza então.").
- **Rejeitado:** esperar cada frente entregar a sua parte.
- **Tarefas:** BAR-F4-01, BAR-F5-01, BAR-F5-02, BAR-F7-02..BAR-F7-06.

### DEC-BAR-13 — As rolagens de NPC se consertam já, avulso

As rolagens da ficha de NPC são **consertadas já, avulso** (BAR-F4-01), antes da frente: a ficha de NPC
não rola nada hoje (`roll:check` não existe no protocolo). A tarefa sai da fila da frente e volta por
PR próprio para a `main` do satélite e para a `alfa/app`.

- **Origem:** D-BA13 (DC-10, aceita como recomendada).
- **Rejeitado:** esperar a F4.
- **Tarefas:** BAR-F4-01.

### DEC-BAR-14 — A barra entra antes das frentes de classe

A **barra entra antes** do resto do Alquimista, do Animista e do Guerreiro. F1 a F4 não dependem deles,
e é o que mais muda a mesa agora.

- **Origem:** D-BA14 (DC-11, aceita como recomendada).
- **Rejeitado:** depois das três frentes de classe.
- **Tarefas:** BAR-F0-03.

### DEC-BAR-15 — Ícone, ou imagem, com o nome curto embaixo

O slot mostra o **ícone (ou a imagem) com o nome curto embaixo**.

- **Origem:** D-BA15 (DC-12, aceita como recomendada).
- **Racional:** sem a arte da Paizo, os ícones genéricos se repetem — no protótipo, o NPC tem duas
  espadas iguais lado a lado — e o nome desfaz a dúvida.
- **Rejeitado:** só ícone e bônus, como no BG3 (o nome ficaria no tooltip).
- **Tarefas:** BAR-F1-04, BAR-F3-05.

## 5. Requisitos funcionais

Cada requisito cita, entre parênteses no fim, a decisão que o origina e as tarefas do plano
(`BAR-Fx-yy`) que o entregam; o rastreio inverso, tarefa por tarefa, está no §5.17.

### 5.1 De quem é a barra (DEC-BAR-01)

- **REQ-BAR-001** [MVP] A barra DEVE mostrar apenas o ator de que o usuário é **dono** — OWNER (3)
  sobre o ator efetivo do token (REQ-USR-013, REQ-TOK-032). O papel privilegiado (`isRolePrivileged`)
  DEVE poder ver a barra de qualquer ator. _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-002** [MVP] O jogador NUNCA DEVE ver a barra de um ator que não é dele. Selecionar o
  token de um NPC, ou de outro jogador, NÃO DEVE mudar a barra: ela continua no personagem do jogador.
  _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-003** [MVP] O gate de posse DEVE ficar no store do ator ativo (REQ-BAR-007),
  **antes** do provedor. O store só DEVE publicar ator de que o usuário é dono, ou qualquer ator se o
  papel for privilegiado. Para um jogador, o provedor NUNCA DEVE ser chamado — em `entries`, `status`,
  `details` ou `execute` — com ator alheio, e nenhum dado do ator selecionado DEVE chegar a ele.
  _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-004** [MVP] O teste de posse DEVE ser o que o cliente já usa (`ownedActorIdsOf`,
  que lê o OWNER pelo `getUserLevel`, REQ-TOK-032). NÃO DEVE nascer predicado novo de "controle de
  token" (REQ-TOK-034). _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-005** [MVP] DEVE existir teste negativo: um jogador seleciona o token de um NPC e,
  em outro caso, o de outro jogador; o ator ativo continua sendo o personagem dele e o provedor não
  recebe o ator alheio. O mesmo caso DEVE entrar no roteiro `tutorial-e2e` e no smoke como jogador
  (`docs/design/PROCESSO-UI.md`, P4). _(DEC-BAR-01; BAR-F1-01, BAR-F2-07)_
- **REQ-BAR-006** [MVP] O chip de alvo da faixa de estado DEVE usar o nome que o jogador já vê no
  token (a mesma redação do nameplate, REQ-CNV-031) e NUNCA o nome real de um NPC oculto ou
  desconhecido. _(DEC-BAR-01; BAR-F2-06)_

### 5.2 O ator ativo (DEC-BAR-01, DEC-BAR-10)

- **REQ-BAR-007** [MVP] O core DEVE ter um store reativo de **ator ativo**, alimentado pelo
  `TokenInteractionManager`: o manager passa a publicar a seleção, em vez de guardá-la num `Set`
  privado e não reativo, e a seleção DEVE sobreviver à troca de cena. _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-008** [MVP] Se o usuário selecionou exatamente um token cujo ator é dele (ou se
  é o Mestre), o ator ativo DEVE ser o desse token. _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-009** [MVP] Fora desse caso, o ator ativo de um jogador que tem personagem DEVE
  ser o personagem dele — mesmo sem token na cena e mesmo que ele tenha selecionado um token alheio.
  Com mais de um personagem, vale o último usado (Q-BAR-01). _(DEC-BAR-01; BAR-F1-01)_
- **REQ-BAR-010** [MVP] O Mestre sem seleção DEVE ter a barra **oculta**. Sem ator
  ativo — o Mestre sem seleção, ou o usuário sem ator próprio —, a barra NÃO DEVE ser desenhada.
  _(DEC-BAR-10; BAR-F1-01, BAR-F1-04)_

### 5.3 O registro e o provedor (DEC-BAR-05)

- **REQ-BAR-011** [MVP] O core (`packages/client`) DEVE ser dono da **casca**: posição na tela,
  faixa de estado, abas, slots, tooltip, menu, teclado, favoritos e Encerrar turno. A casca NÃO DEVE
  saber o que é um golpe, uma magia ou uma ação de nenhum sistema. _(DEC-BAR-05; BAR-F1-02, BAR-F1-04)_
- **REQ-BAR-012** [MVP] O sistema DEVE registrar um **provedor** (`ActionBarProvider`, §7.1)
  no `actionBarRegistry` do core (`packages/client/src/lib/actionbar/actionBarRegistry.ts`), no padrão
  em que `registerPf2eSheets` já preenche o `sheetRegistry`, o `chatCardExtensionRegistry` e o
  `skillNameRegistry`. O registro DEVE resolver o provedor pelo `documentType` e pelo `subtype` do ator,
  como a ficha (REQ-UIF-019); ator sem provedor registrado NÃO DEVE ter barra.
  _(DEC-BAR-05; BAR-F1-02, BAR-F2-07)_
- **REQ-BAR-013** [MVP] O core NÃO DEVE importar o satélite de sistema senão pelo ponto de entrada
  publicado do pacote (`src/index.ts` de `@fusion/sheets-pf2e`, o `sat/index.ts` do plano).
  `pnpm lint:boundaries` (`dependency-cruiser`) e o `boundary-test` DEVEM continuar verdes com o
  registry e um provedor stub de teste. _(DEC-BAR-05; BAR-F1-02)_
- **REQ-BAR-014** [MVP] `entries` DEVE ser função **pura** do contexto — documento do ator,
  valores derivados e contexto de combate — e NÃO DEVE abrir a ficha nem depender de componente
  montado. _(DEC-BAR-05; BAR-F1-02)_
- **REQ-BAR-015** [MVP] `execute` DEVE chamar as **mesmas funções** que a ficha chama e
  emitir as mesmas ops; a barra NÃO DEVE reescrever regra de jogo (golpe, conjuração, ação, consumo).
  _(DEC-BAR-05; BAR-F2-02, BAR-F2-03, BAR-F2-04)_
- **REQ-BAR-016** [MVP] A barra NÃO DEVE ganhar autoridade nova nem criar op de servidor nas
  fases F1 a F3. Favoritos e ícones usam `doc:update` no ator, com `expectedVersion` (REQ-NET-026), e
  as demais escritas usam as ops que a ficha já usa. _(DEC-BAR-05; BAR-F1-02, BAR-F3-01, BAR-F3-05)_
- **REQ-BAR-017** [MVP] Todo `ActionBarEntry` DEVE ter `id` estável no ator, na forma
  `<kind>:<origem>`, derivado da origem da entrada (item, magia, ação, perícia) e NÃO da posição na
  lista. É o `id` que o favorito e o ícone customizado guardam. _(DEC-BAR-05; BAR-F1-02, BAR-F3-01)_
- **REQ-BAR-018** [MVP] O `ActionBarEntry` DEVE trazer o que a casca precisa para desenhar e
  comandar sem conhecer o sistema (§7.1): a aba e o grupo, o rótulo, o ícone, o custo, os traços, a
  quantidade, o estado e o motivo, as variantes, a necessidade de alvo e o alcance.
  _(DEC-BAR-05; BAR-F1-02)_
- **REQ-BAR-019** [MVP] `status` DEVE devolver o que a faixa de estado mostra do ator: nome,
  classes e retrato; PV com o temporário; os recursos que importam no turno; as condições ativas; o
  alvo marcado; e o MAP do próximo ataque. _(DEC-BAR-05; BAR-F1-02, BAR-F2-06)_
- **REQ-BAR-020** [MVP] `details`, quando o provedor o declara, DEVE abrir o painel de detalhe
  do sistema — o mesmo da ficha — a partir do tooltip. _(DEC-BAR-05; BAR-F1-02, BAR-F1-03)_
- **REQ-BAR-021** [MVP] Os rótulos das entradas DEVEM ser os do pack pt-BR e os mesmos da ficha
  (Investigar, Deslocar, Esgueirar, Rememorar Conhecimento, Arquitetar uma Estratégia, Golpe Reativo,
  Erguer um Escudo, Comandar um Animal…). A barra lê os dados de onde a ficha lê e NÃO DEVE ter nomes
  próprios. _(DEC-BAR-05; BAR-F2-02, BAR-F2-03, BAR-F2-04, BAR-F2-05)_

### 5.4 Anatomia e rodapé (DEC-BAR-07, DEC-BAR-09, DEC-BAR-15)

- **REQ-BAR-022** [MVP] A barra DEVE ficar centralizada na **área livre** do canvas — entre a borda
  esquerda e a gaveta —, acima do canvas e abaixo das janelas e da gaveta, num nível declarado da
  escala de z (REQ-UIF-008), sem z-index avulso. O estado aberto da gaveta DEVE passar a ser exportado
  para que a barra calcule a área livre (REQ-GAV-012, REQ-GAV-013). A barra DEVE conviver com o aviso
  `ScenePrepareNotice`, do centro-inferior, sem cobri-lo. _(DEC-BAR-09; BAR-F1-04)_
- **REQ-BAR-023** [MVP] Na linha alfa, a barra DEVE ser dona do centro-inferior do rodapé.
  _(DEC-BAR-09; BAR-F1-04)_
- **REQ-BAR-024** [V2] Quando as linhas convergirem — a barra de comando do Hub só existe em
  código na `build/app` — e a barra de comando (REQ-HUB-007) coexistir com a barra de ações, ela DEVE
  virar um grupo compacto na ponta da barra de ações e NÃO DEVE ser empilhada sobre ela. A emenda na
  spec `28` é a entrega desta tarefa de spec. _(DEC-BAR-09; BAR-F0-02)_
- **REQ-BAR-025** [MVP] Com a área livre abaixo de um limiar da ordem de 1000 px, fixado na
  BAR-F1-04, a barra DEVE recolher-se sozinha para a faixa de estado. _(DEC-BAR-09; BAR-F1-04)_
- **REQ-BAR-026** [MVP] A barra DEVE ter **Favoritos**, a linha principal, e as abas **Golpes**,
  **Magias**, **Ações**, **Itens**, **Reações** e **Testes**. Aba sem entradas NÃO DEVE sumir nem
  quebrar: mostra o estado vazio. _(DEC-BAR-07; BAR-F1-04)_
- **REQ-BAR-027** [MVP] A faixa de estado DEVE mostrar o retrato, o nome e as classes do ator
  ativo; o PV, com o temporário; os recursos que importam no turno; as condições ativas; o alvo
  marcado; e, à direita, de quem é a vez e o MAP do próximo ataque. _(DEC-BAR-07; BAR-F1-04, BAR-F2-06)_
- **REQ-BAR-028** [MVP] As condições ativas DEVEM aparecer como chips **só com o nome**; o
  efeito aparece ao clicar no chip e recolhe ao clicar de novo (padrão D-B23, DEC-BHR-16,
  REQ-BHR-064..066). A faixa de estado é, para o ator ativo, o espaço dedicado de que DEC-TOK-19 deixou
  a decisão para o dono da tela; a peça no canvas NÃO DEVE ganhar ícones de condição (REQ-TOK-083).
  _(DEC-BAR-07; BAR-F2-06)_
- **REQ-BAR-029** [MVP] O slot DEVE mostrar a **imagem escolhida pelo usuário** para a entrada
  (REQ-BAR-067) ou, sem ela, um ícone livre — nunca arte da Paizo — e, **embaixo, o nome curto** da
  entrada, que desfaz a dúvida entre ícones iguais; o nome completo fica no tooltip. Sobre a imagem,
  legíveis, DEVEM aparecer o custo no canto, a tecla, o selo de quantidade ou de patamar e o bônus ou a
  CD final. _(DEC-BAR-15; BAR-F1-04, BAR-F3-05)_
- **REQ-BAR-030** [MVP] O slot DEVE distinguir quatro estados: disponível; esmaecido, **com o
  motivo** no tooltip; gasto até recarregar; e alternável ligado, com borda de destaque e marca de
  ligado. _(DEC-BAR-07; BAR-F1-04, BAR-F2-04)_
- **REQ-BAR-031** [MVP] A entrada indisponível DEVE ficar no lugar, esmaecida, com o motivo
  (`reason`) no tooltip; esmaecer sem dizer por quê NÃO DEVE acontecer. Só o impossível some da lista —
  por exemplo, a ação de perícia que exige um treino que o ator não tem.
  _(DEC-BAR-07; BAR-F1-04, BAR-F2-04)_
- **REQ-BAR-032** [MVP] O estado `unavailable` e o `reason` DEVEM vir de recurso ou estado
  real do ator — slot, foco, quantidade, uso já registrado no turno, requisito não cumprido — e NUNCA
  de uma contagem de ações do turno (REQ-BAR-036). _(DEC-BAR-07; BAR-F1-04, BAR-F2-04)_
- **REQ-BAR-033** [MVP] A barra DEVE poder ser **recolhida** à faixa de estado, e o botão de
  expandir a devolve. O estado recolhido DEVE ficar salvo no dispositivo (REQ-BAR-034). A
  barra DEVE começar enxuta. _(DEC-BAR-07; BAR-F1-04, BAR-F3-04)_
- **REQ-BAR-034** [MVP] As preferências do dispositivo — barra recolhida e última aba — DEVEM
  usar o padrão que já existe, a chave `fusion:actionBar:<worldId>:<userId>` (DEC-UIF-10), e NÃO DEVEM
  ir ao servidor. _(DEC-BAR-07; BAR-F3-04)_
- **REQ-BAR-035** [MVP] O botão **Encerrar turno** DEVE aparecer só no turno do próprio usuário — o
  participante da vez é dele — ou para o papel privilegiado. Ele DEVE avançar o turno pela mesma
  operação da aba Combate (`combat:nextTurn`, REQ-CBA-072); quem pode é decidido pelo servidor
  (REQ-CBA-080, REQ-CBA-081), e esconder o botão não é proteção. _(DEC-BAR-07; BAR-F1-04, BAR-F2-06)_

### 5.5 Turno, custo e MAP, dentro da D-15

- **REQ-BAR-036** [MVP] A barra NÃO DEVE ter contador de ações por turno: nem pips de "ações
  restantes", nem orçamento, nem bloqueio de entrada por custo, por turno ou por MAP. _(D-15; BAR-F1-04,
  BAR-F2-06)_
- **REQ-BAR-037** [MVP] O **custo** de cada entrada DEVE ser mostrado no slot e no tooltip, só
  como dado exibido (`ActionCost`, ALQ-F7-02): as ações (◆, ◆◆, ◆◆◆), a reação (⟳), a ação livre (◇) e o
  custo variável. _(D-15; BAR-F1-04, BAR-F2-02, BAR-F2-03, BAR-F2-04)_
- **REQ-BAR-038** [MVP] A faixa de estado DEVE mostrar o **MAP do próximo ataque**, lido da contagem
  que o servidor mantém (`combat.attackCount`, REQ-CBT-069); o cliente NÃO DEVE decidir o índice. O
  golpe DEVE usar esse MAP como variante padrão, com "forçar MAP" no menu, igual à ficha.
  _(D-15; BAR-F2-02, BAR-F2-06)_
- **REQ-BAR-039** [MVP] Passar o mouse num golpe DEVE mostrar **o que muda** no ataque seguinte
  ("depois deste: MAP −10"), no tooltip e na faixa de estado. _(D-15; BAR-F1-03, BAR-F2-02)_
- **REQ-BAR-040** [MVP] A faixa de estado DEVE mostrar **de quem é a vez**, fora da gaveta: "Seu
  turno · Rodada N" quando o participante da vez é do usuário; a vez de outro participante; e "Fora de
  combate" quando não há encontro. O dado é o da aba Combate, com a mesma redação: participante oculto
  NÃO DEVE ser revelado (REQ-CBA-082). Isso responde, em parte, à Q-CBA-01. _(D-15; BAR-F1-04,
  BAR-F2-06)_

### 5.6 Interação

- **REQ-BAR-041** [MVP] O clique no slot DEVE executar a **variante padrão**: o golpe no MAP
  corrente, a magia no patamar e custo padrão, a ação com o teste certo. O resultado DEVE sair no card
  de chat que já existe, com ataque, dano e salvamentos aninhados.
  _(DEC-BAR-05; BAR-F2-02, BAR-F2-03, BAR-F2-04)_
- **REQ-BAR-042** [MVP] A entrada que precisa de alvo DEVE usar os alvos marcados pelo
  botão direito no token (`getMyTargets()`, REQ-CBT-056). Sem alvo marcado, até a F8 a entrada DEVE se
  comportar como a ficha: o golpe sai sem grau, e a ação que a ficha só aceita com alvo (Caçar Presa,
  REQ-BHR-092) fica esmaecida com o motivo. O modo mira é da F8 (REQ-BAR-099).
  _(DEC-BAR-05; BAR-F2-02, BAR-F2-04)_
- **REQ-BAR-043** [MVP] O tooltip/popover e o menu de contexto DEVEM ser componentes
  **genéricos** de `components/common/`, com clique fora, `Esc`, foco e `aria`, reutilizáveis pelo
  resto do app; NÃO DEVEM conhecer a barra. _(DEC-BAR-05; BAR-F1-03)_
- **REQ-BAR-044** [MVP] O tooltip curto, ao passar o mouse, DEVE mostrar nome, custo, traços, bônus
  ou CD, alcance e uma linha de efeito; `Alt` DEVE abrir o painel completo, o mesmo da ficha
  (`details`). _(DEC-BAR-05; BAR-F1-03, BAR-F2-02, BAR-F2-03, BAR-F2-04)_
- **REQ-BAR-045** [MVP] O botão direito no slot DEVE abrir o menu da entrada: as variantes (1º,
  2º ou 3º ataque; 1, 2 ou 3 ações; patamar de conjuração; elemento da Rajada), Fixar ou Desafixar,
  Ver detalhes e Abrir na ficha. O menu é a alternativa sem arrastar (REQ-A11-036).
  _(DEC-BAR-07; BAR-F1-03, BAR-F3-02)_
- **REQ-BAR-046** [MVP] O custo variável (a Cura de 1, 2 ou 3 ações) DEVE aparecer como
  **seletor no próprio botão**, com o efeito de cada custo. _(DEC-BAR-07; BAR-F3-02)_
- **REQ-BAR-047** [MVP] Arrastar DEVE funcionar assim: de qualquer aba para Favoritos, fixa; dentro de
  Favoritos, reordena; para fora de Favoritos, desafixa. O arrastar é interno à barra.
  _(DEC-BAR-07; BAR-F3-03)_

### 5.7 Atalhos e guard

- **REQ-BAR-048** [MVP] As teclas **1–9, 0, − e =** DEVEM executar os 12 slots de Favoritos, na ordem.
  `Esc` DEVE cancelar a mira ou o menu. _(DEC-BAR-07; BAR-F1-05)_
- **REQ-BAR-049** [MVP] Os atalhos da barra NUNCA DEVEM disparar com o foco em campo de texto
  (`<input>`, `<textarea>`, `[contenteditable]`), em botão ou em diálogo (`<dialog>`).
  _(DEC-BAR-07; BAR-F1-05)_
- **REQ-BAR-050** [MVP] Os atalhos DEVEM ser registrados num registro central de ações
  nomeadas, com os defaults fixos: o começo do `KeybindingRegistry` de REQ-A11-020, e não um segundo
  registro. O guard do registro DEVE cobrir o que REQ-A11-023 lista e o botão em foco.
  _(DEC-BAR-07; BAR-F1-05)_
- **REQ-BAR-051** [MVP] O guard DEVE ter teste para cada alvo da lista: campo de texto,
  `contenteditable`, diálogo e botão em foco. _(DEC-BAR-07; BAR-F1-05)_

### 5.8 Conteúdo PF2e do personagem (DEC-BAR-05, DEC-BAR-11, DEC-BAR-12)

- **REQ-BAR-052** [MVP] A lógica da ficha de que a barra precisa DEVE ser extraída do componente
  **sem mudança de comportamento**: o `CharacterSheetVM` construível sem montar a ficha; a
  orquestração do "Usar", o `emitAbility` e o `emitCast` como funções de `lib/`, chamadas pela ficha e
  pela barra. A suíte da ficha e a catraca `pathbuilder-parity` DEVEM continuar verdes **antes** de
  qualquer conteúdo da barra, e nada DEVE mudar na tela. _(DEC-BAR-05; BAR-F2-01)_
- **REQ-BAR-053** [MVP] O provedor de **Golpes** DEVE listar os golpes do personagem com o MAP
  corrente (lido de `attacksThisTurn`), as variantes de MAP, a munição exibida e as bombas, e executar
  pelo caminho da ficha (`strikeCard` com os alvos marcados), com o grau decidido pelo servidor contra a
  CA do alvo lida do banco. _(DEC-BAR-05; BAR-F2-02)_
- **REQ-BAR-054** [MVP] O provedor de **Magias** DEVE listar truques e magias por patamar, com x/y de
  slots no cabeçalho do grupo e o foco em pips, preparadas e espontâneas, e a elevação que a ficha já
  tem. Conjurar DEVE gastar slot ou foco pelo mesmo caminho da ficha (`castSpell`), com o salvamento
  graduado pelo servidor. _(DEC-BAR-05; BAR-F2-03)_
- **REQ-BAR-055** [MVP] O provedor de **Ações** DEVE listar as ações relevantes — básicas, de perícia
  agrupadas por perícia e de classe —, filtradas e ordenadas como a aba Ações da ficha; as executáveis
  rodam pelo "Usar" de hoje, e as demais postam o card da ação (REQ-BAR-057). Os Impulsos e a
  Rajada (custo variável) e os alternáveis de `flags.fusion.toggles` DEVEM entrar.
  _(DEC-BAR-05; BAR-F2-04)_
- **REQ-BAR-056** [MVP] As ações que a ficha já executa — Agarrar, Empurrar e Derrubar (CD
  do alvo lida do banco, limite de tamanho, MAP), Investigar, Rastrear, Tratar Ferimentos, Caçar Presa,
  Comandar um Animal, Apoio e Montar — DEVEM entrar na barra com o "Usar" de hoje, sem esperar a F7.
  _(DEC-BAR-12; BAR-F2-04)_
- **REQ-BAR-057** [MVP] As ações sem motor — Desmoralizar, Fintar, Rememorar Conhecimento, Esconder,
  Desarmar, Reposicionar, Escapar, Erguer um Escudo, Passo, Deslocar e recarregar — DEVEM **aparecer**
  e **postar o card da ação**, sem rolagem automática, até a F7. _(DEC-BAR-11; BAR-F2-04)_
- **REQ-BAR-058** [MVP] O provedor de **Testes** DEVE listar Percepção, salvamentos, perícias e saberes
  e rolar pelo mesmo caminho da ficha. _(DEC-BAR-05; BAR-F2-05)_
- **REQ-BAR-059** [MVP] O provedor PF2e DEVE preencher a faixa de estado com PV, temporário,
  foco, herói, os slots do patamar em foco, as condições compactas, o alvo e o MAP do próximo ataque.
  _(DEC-BAR-05; BAR-F2-06)_
- **REQ-BAR-060** [MVP] O satélite PF2e DEVE registrar o provedor em `registerPf2eSheets`, com
  tag do satélite e bump do pin no core. A entrega da F2 DEVE passar por um roteiro `tutorial-e2e` com
  os 4 PJs de A Queda — como jogador e como Mestre, incluindo o jogador clicando num NPC sem ver a
  barra dele — e por relatório protótipo × tela (`docs/design/PROCESSO-UI.md`, P1–P4).
  _(DEC-BAR-05; BAR-F2-07)_

### 5.9 Favoritos (DEC-BAR-06, DEC-BAR-07, DEC-BAR-08)

- **REQ-BAR-061** [MVP] Os favoritos DEVEM viver **no ator**, em `flags.fusion.actionBar`, com
  schema Zod no pacote `shared` (§7.2): seguem o personagem em qualquer dispositivo, e o Mestre os vê.
  _(DEC-BAR-06; BAR-F3-01)_
- **REQ-BAR-062** [MVP] A linha Favoritos DEVE ter **12 slots**, ligados às teclas 1–9, 0, − e =
  (REQ-BAR-048). _(DEC-BAR-07; BAR-F3-01)_
- **REQ-BAR-063** [MVP] Fixar, desafixar e reordenar DEVEM escrever no ator com `expectedVersion`,
  pelo `makeSendOpFn`; uma escrita sobre versão velha DEVE ser recusada (`STALE_WRITE`, REQ-NET-026) e
  refeita sobre o estado fresco, sem sobrescrever. _(DEC-BAR-06; BAR-F3-01)_
- **REQ-BAR-064** [MVP] Na primeira abertura da barra de um ator sem favoritos gravados, a barra DEVE
  semear os Favoritos com golpes, magias e ações mais usadas, até 12 (critério em Q-BAR-02), e
  DEVE gravar que a semente foi aplicada. _(DEC-BAR-08; BAR-F3-01)_
- **REQ-BAR-065** [MVP] Depois da semente, só o jogador DEVE mexer nos favoritos: a barra NÃO DEVE
  adicionar, remover nem reordenar favorito sozinha. O que é novo — magia aprendida, item achado —
  DEVE ir para a aba correspondente. _(DEC-BAR-08; BAR-F3-01)_
- **REQ-BAR-066** [MVP] Um favorito cuja entrada sumiu (item vendido, magia trocada) DEVE aparecer
  esmaecido como "não está mais na ficha", com **Desafixar**. Isso responde à questão 2 de "Questões em
  Aberto" da spec `14`. _(DEC-BAR-06; BAR-F3-01)_

### 5.10 Ícone customizado e galeria compartilhada (DEC-BAR-02, DEC-BAR-03)

- **REQ-BAR-067** [MVP] Cada entrada da barra DEVE aceitar uma imagem customizada, se o usuário
  quiser. A escolha DEVE ficar em `flags.fusion.actionBar.icons`, um mapa do `id` da entrada para o
  caminho da imagem; sem imagem, vale o ícone genérico. _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-068** [MVP] Cada valor do mapa DEVE ser um caminho `/assets/…` do acervo do
  mundo, inteiro. O schema DEVE recusar URL externa: a imagem precisa obedecer à CSP e ao grant de
  leitura. _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-069** [MVP] O mapa DEVE ter **teto de entradas** no schema, e cada valor DEVE carregar um
  único caminho (Q-BAR-03). _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-070** [MVP] O campo DEVE ser registrado em `server/assets/asset-fields.ts`,
  seguindo as regras do arquivo — um caminho por valor, casado inteiro —, para que quem vê o ator
  receba o grant da imagem; sem isso, a imagem não carrega para os outros. O arquivo hoje só conhece os
  caminhos `campo` e `lista[].campo` e proíbe `flags.*` (regra de manutenção 2): a BAR-F3-05 DEVE
  estender a gramática e documentar a exceção no próprio arquivo (Q-BAR-04).
  _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-071** [MVP] A BAR-F3-05 DEVE passar por **revisão adversarial do grant**: o jogador
  que escreve milhares de caminhos no mapa de ícones do próprio ator NÃO DEVE conseguir que uma
  requisição gere milhares de grants assinados. _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-072** [MVP] O jogador DEVE poder alterar **só** os ícones do próprio personagem — os
  atores de que é dono. O servidor DEVE recusar a escrita de `flags.fusion.actionBar.icons` em ator
  alheio (`PERMISSION_DENIED`), com teste negativo. _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-073** [MVP] O Mestre DEVE poder alterar os ícones de qualquer ator.
  _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-074** [MVP] O menu da entrada DEVE oferecer **Trocar ícone…**, que abre o seletor de
  imagem do acervo (o mesmo do retrato), e **Restaurar ícone padrão**, que volta ao genérico.
  _(DEC-BAR-02; BAR-F3-05)_
- **REQ-BAR-075** [MVP] O envio de imagem DEVE estar aberto a todo jogador, sem exigir papel
  Confiável nem `STORAGE_UPLOAD` (emenda da REQ-AST-011). A validação de tipo e tamanho do pipeline
  (REQ-AST-007, REQ-AST-008) DEVE valer igual para todos. _(DEC-BAR-03; BAR-F0-02, BAR-F3-05)_
- **REQ-BAR-076** [MVP] O servidor DEVE decidir o destino do envio de quem não tem
  `STORAGE_UPLOAD`; o cliente NÃO DEVE escolher pasta nem caminho (REQ-SEC-043, REQ-AST-031).
  _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-077** [MVP] Esse envio NÃO DEVE ter cota por usuário. _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-078** [MVP] Todo envio feito por **Trocar ícone…** DEVE ficar marcado como ícone no
  registro de assets. _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-079** [MVP] A galeria compartilhada DEVE listar, para qualquer jogador, **só** os
  assets marcados como ícone. Mapas, retratos e handouts do Mestre DEVEM seguir fora da lista do
  jogador, porque o nome do arquivo pode ser spoiler. Quem tem `STORAGE_BROWSE` mantém a navegação de
  REQ-AST-032..037. _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-080** [MVP] O jogador DEVE poder escolher na galeria um ícone que outro já enviou e
  carregar a imagem (grant de leitura), mas só DEVE poder aplicá-lo às entradas do próprio personagem
  (REQ-BAR-072). _(DEC-BAR-03; BAR-F3-05)_
- **REQ-BAR-081** [MVP] Apagar um asset DEVE continuar sendo só do GM (`STORAGE_DELETE`,
  REQ-AST-029): o Mestre apaga da galeria o que quiser. _(DEC-BAR-03; BAR-F3-05)_

### 5.11 O Mestre e os NPCs (DEC-BAR-01, DEC-BAR-10, DEC-BAR-13)

- **REQ-BAR-082** [MVP] A barra de **NPC** DEVE existir só para o papel privilegiado. O jogador
  NUNCA DEVE vê-la (REQ-BAR-002). _(DEC-BAR-01; BAR-F4-02)_
- **REQ-BAR-083** [MVP] O provedor de **NPC** DEVE listar golpes, ações, reações e magias inatas
  do NPC com CD, e a faixa de estado DEVE mostrar a CA e os PV exatos. _(DEC-BAR-01; BAR-F4-02)_
- **REQ-BAR-084** [MVP] A ficha de NPC DEVE rolar golpe, salvamento, Percepção e perícia pelo
  caminho de chat da ficha de personagem, com o golpe levando MAP, alvo e grau decididos pelo servidor.
  Ela NÃO DEVE emitir mensagem fora do protocolo — hoje emite `roll:check`, que não existe, e o
  servidor a descarta como "Malformed envelope". _(DEC-BAR-13; BAR-F4-01)_
- **REQ-BAR-085** [MVP] O conserto das rolagens de NPC DEVE sair **avulso**, antes da
  frente, por PR próprio para a `main` do satélite e para a `alfa/app`, e NÃO DEVE esperar a F4.
  _(DEC-BAR-13; BAR-F4-01)_
- **REQ-BAR-086** [MVP] Com **seleção múltipla** (só o Mestre; hoje a seleção é única), a barra DEVE
  mostrar uma barra-resumo ("N tokens") com testes em grupo: salvamentos, Percepção e iniciativa.
  _(DEC-BAR-10; BAR-F4-03)_

### 5.12 Itens e consumíveis (DEC-BAR-12)

- **REQ-BAR-087** [V2] A aba Itens DEVE listar os consumíveis com selo de quantidade e usar o
  `item:consume` que o servidor já tem (OWNER, `expectedVersion`, baixa de quantidade e de usos,
  efeito, cura e dano). A mesma ligação DEVE existir no inventário da ficha. Quantidade zero DEVE
  ficar esmaecida, com o motivo. Absorve a ALQ-F2-12. _(DEC-BAR-12; BAR-F5-01)_
- **REQ-BAR-088** [V2] A bomba DEVE consumir a unidade ao ser arremessada, e a munição DEVE baixar
  no disparo. Absorve a ALQ-F2-14. _(DEC-BAR-12; BAR-F5-02)_

### 5.13 Companheiros e vínculos

- **REQ-BAR-089** [V2] Com um companheiro, eidolon ou servo selecionado, a barra DEVE ser a
  dele **se ele for do jogador** — a posse do companheiro já é forçada à do dono —, o que cobre o urso
  e o antílope do Bhrotto. Se não for do jogador, vale REQ-BAR-002. _(DEC-BAR-01; BAR-F6-01)_
- **REQ-BAR-090** [V2] A barra do dono DEVE mostrar Comandar um Animal ou Agir Juntos,
  esmaecido com o motivo quando já usado no turno (`commandMark`). _(DEC-BAR-01; BAR-F6-01)_

### 5.14 O motor das ações que faltam (DEC-BAR-11, DEC-BAR-12)

- **REQ-BAR-091** [V2] Desmoralizar, Fintar, Rememorar Conhecimento e Esconder DEVEM ficar
  executáveis: teste contra a Vontade ou a Percepção do alvo, **sem** contar MAP.
  _(DEC-BAR-11; BAR-F7-01)_
- **REQ-BAR-092** [V2] Desarmar, Reposicionar e Escapar DEVEM ficar executáveis (traço ataque,
  contam MAP). Recorte da GUE-F5-03. _(DEC-BAR-12; BAR-F7-02)_
- **REQ-BAR-093** [V2] Erguer um Escudo DEVE ter estado (+CA até o próximo turno) e Bloqueio com Escudo
  DEVE existir. Recorte da GUE-F5-01 e da GUE-F5-02. _(DEC-BAR-12; BAR-F7-03)_
- **REQ-BAR-094** [V2] Posturas e Fúria DEVEM ser alternáveis com estado. Espera ANI-F3-03 ou
  GUE-F6-01. _(DEC-BAR-12; BAR-F7-04)_
- **REQ-BAR-095** [V2] A aba Reações DEVE mostrar a disponibilidade da reação. Espera o pool de
  reação (GUE-F4-01). _(DEC-BAR-12; BAR-F7-05)_
- **REQ-BAR-096** [V2] Os recursos de classe genéricos DEVEM aparecer na faixa de estado como
  contador ("Frascos versáteis 6/6"). Espera ALQ-F3-02 e ALQ-F3-04 (spec `47`).
  _(DEC-BAR-12; BAR-F7-06)_
- **REQ-BAR-097** [V2] A barra NÃO DEVE implementar as três peças que esperam outras frentes — o
  pool de reação, as posturas com estado e o contador genérico de recurso de classe: ela as consome
  quando chegarem. _(DEC-BAR-12; BAR-F7-04, BAR-F7-05, BAR-F7-06)_

### 5.15 Alcance, mira, tablet e SF2e

- **REQ-BAR-098** [V2] Ao passar o mouse num golpe ou magia com alcance, um **anel de alcance**
  DEVE aparecer em volta do token, com a geometria de `shared/grid` e vermelho fora de alcance.
  _(plano §4.3; BAR-F8-01)_
- **REQ-BAR-099** [V2] Sem alvo marcado, a entrada que precisa de alvo DEVE entrar em **modo mira**:
  cursor de mira, clique no token, e `Esc` cancela. A mira por botão direito, que já existe, não muda.
  _(plano §4.3; BAR-F8-02)_
- **REQ-BAR-100** [V2] No modo tablet (spec `23`), os slots DEVEM ter alvos de toque de 44×44 px
  (REQ-A11-044), respeitar `env(safe-area-inset-bottom)` (REQ-A11-049) e mostrar o tooltip sem depender
  de hover (REQ-A11-046), e a barra DEVE ser navegável por Tab (REQ-A11-005). _(plano §4.3; BAR-F8-03)_
- **REQ-BAR-101** [V2] No SF2e, a barra DEVE mostrar munição e cargas e a ação de recarregar, ligando o
  `consumeCharge` que hoje existe sem chamador. _(plano §6; BAR-F8-04)_

### 5.16 A hotbar substituída (DEC-BAR-04)

- **REQ-BAR-102** [MVP] A barra de ações **substitui** a hotbar da spec `14`: a hotbar por
  usuário (5 páginas de 10 slots) NÃO DEVE existir ao lado dela. REQ-MAC-012..018 e REQ-UIF-006 ficam
  aposentados (§12), e REQ-UIF-001 passa a nomear a barra de ações no rodapé. A macro e a QuickAction
  voltam depois como `kind` de entrada, a cargo da spec `14`. _(DEC-BAR-04; BAR-F0-02, BAR-F1-04,
  BAR-F1-05)_

### 5.17 Rastreio das tarefas do plano

Tabela derivada dos requisitos acima: cada tarefa `BAR-Fx-yy` do plano (§6) e os requisitos que a
entregam. BAR-F0-01 (o protótipo) é a fonte visual, e BAR-F0-03 (o `tasks.md`, a entrada em
`frentes.json` e a skill `/barra-de-acoes`) vem depois desta spec; nenhuma das duas gera requisito
(DEC-BAR-14 só fixa a fila).

| Tarefa    | Entrega                                                                       | Requisitos                                                                                                                         |
| --------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| BAR-F0-01 | Protótipo fiel (T1–T7), revisado pelo Alexandre                               | —                                                                                                                                  |
| BAR-F0-02 | Esta spec e as emendas nas specs 11, 14, 20, 23, 28, 40 e 41                  | REQ-BAR-024, REQ-BAR-075, REQ-BAR-102                                                                                              |
| BAR-F0-03 | `tasks.md` no formato das frentes, `frentes.json` e a skill `/barra-de-acoes` | —                                                                                                                                  |
| BAR-F1-01 | Store de ator ativo e gate de posse                                           | REQ-BAR-001..005, REQ-BAR-007..010                                                                                                 |
| BAR-F1-02 | `actionBarRegistry` e tipos, com provedor stub                                | REQ-BAR-011..014, REQ-BAR-016..020                                                                                                 |
| BAR-F1-03 | Tooltip, popover e menu de contexto genéricos                                 | REQ-BAR-020, REQ-BAR-039, REQ-BAR-043..045                                                                                         |
| BAR-F1-04 | Componente `ActionBar`: faixa de estado, abas, slots, recolher                | REQ-BAR-010, REQ-BAR-011, REQ-BAR-022, REQ-BAR-023, REQ-BAR-025..027, REQ-BAR-029..033, REQ-BAR-035..037, REQ-BAR-040, REQ-BAR-102 |
| BAR-F1-05 | Registro mínimo de atalhos e guard                                            | REQ-BAR-048..051, REQ-BAR-102                                                                                                      |
| BAR-F2-01 | Extração da lógica da ficha, sem mudança de comportamento                     | REQ-BAR-052                                                                                                                        |
| BAR-F2-02 | Provedor de Golpes                                                            | REQ-BAR-015, REQ-BAR-021, REQ-BAR-037..039, REQ-BAR-041, REQ-BAR-042, REQ-BAR-044, REQ-BAR-053                                     |
| BAR-F2-03 | Provedor de Magias                                                            | REQ-BAR-015, REQ-BAR-021, REQ-BAR-037, REQ-BAR-041, REQ-BAR-044, REQ-BAR-054                                                       |
| BAR-F2-04 | Provedor de Ações                                                             | REQ-BAR-015, REQ-BAR-021, REQ-BAR-030..032, REQ-BAR-037, REQ-BAR-041, REQ-BAR-042, REQ-BAR-044, REQ-BAR-055..057                   |
| BAR-F2-05 | Provedor de Testes                                                            | REQ-BAR-021, REQ-BAR-058                                                                                                           |
| BAR-F2-06 | Faixa de estado do PF2e                                                       | REQ-BAR-006, REQ-BAR-019, REQ-BAR-027, REQ-BAR-028, REQ-BAR-035, REQ-BAR-036, REQ-BAR-038, REQ-BAR-040, REQ-BAR-059                |
| BAR-F2-07 | Registro em `registerPf2eSheets`, tag, pin e roteiro `tutorial-e2e`           | REQ-BAR-005, REQ-BAR-012, REQ-BAR-060                                                                                              |
| BAR-F3-01 | Favoritos no ator, semente e entrada órfã                                     | REQ-BAR-016, REQ-BAR-017, REQ-BAR-061..066                                                                                         |
| BAR-F3-02 | Menu de contexto completo e seletor de variantes                              | REQ-BAR-045, REQ-BAR-046                                                                                                           |
| BAR-F3-03 | Arrastar e soltar dentro da barra                                             | REQ-BAR-047                                                                                                                        |
| BAR-F3-04 | Preferências do dispositivo                                                   | REQ-BAR-033, REQ-BAR-034                                                                                                           |
| BAR-F3-05 | Ícone customizado, galeria compartilhada e envio de imagem                    | REQ-BAR-016, REQ-BAR-029, REQ-BAR-067..081                                                                                         |
| BAR-F4-01 | Rolagens da ficha de NPC                                                      | REQ-BAR-084, REQ-BAR-085                                                                                                           |
| BAR-F4-02 | Provedor de NPC, só para o Mestre                                             | REQ-BAR-082, REQ-BAR-083                                                                                                           |
| BAR-F4-03 | Seleção múltipla do Mestre e barra-resumo                                     | REQ-BAR-086                                                                                                                        |
| BAR-F5-01 | `item:consume` na aba Itens e no inventário                                   | REQ-BAR-087                                                                                                                        |
| BAR-F5-02 | Bomba consome a unidade; munição baixa no disparo                             | REQ-BAR-088                                                                                                                        |
| BAR-F6-01 | Barra do companheiro, do eidolon e do servo                                   | REQ-BAR-089, REQ-BAR-090                                                                                                           |
| BAR-F7-01 | Desmoralizar, Fintar, Rememorar Conhecimento e Esconder executáveis           | REQ-BAR-091                                                                                                                        |
| BAR-F7-02 | Desarmar, Reposicionar e Escapar                                              | REQ-BAR-092                                                                                                                        |
| BAR-F7-03 | Erguer um Escudo com estado e Bloqueio com Escudo                             | REQ-BAR-093                                                                                                                        |
| BAR-F7-04 | Posturas e Fúria como alternáveis com estado                                  | REQ-BAR-094, REQ-BAR-097                                                                                                           |
| BAR-F7-05 | Aba Reações com disponibilidade                                               | REQ-BAR-095, REQ-BAR-097                                                                                                           |
| BAR-F7-06 | Recursos de classe genéricos na faixa de estado                               | REQ-BAR-096, REQ-BAR-097                                                                                                           |
| BAR-F8-01 | Anel de alcance                                                               | REQ-BAR-098                                                                                                                        |
| BAR-F8-02 | Modo mira                                                                     | REQ-BAR-099                                                                                                                        |
| BAR-F8-03 | Tablet, toque e navegação por Tab                                             | REQ-BAR-100                                                                                                                        |
| BAR-F8-04 | SF2e: munição, cargas e recarga                                               | REQ-BAR-101                                                                                                                        |

## 6. Requisitos não-funcionais

- **RNF-BAR-01** Toda rolagem, grau, MAP, consumo e permissão desta spec é decidida no
  servidor; o cliente só pede. A barra não ganha autoridade nova.
- **RNF-BAR-02** A redação de visibilidade usa SEMPRE `packages/server/src/net/redaction.ts` e
  `isRolePrivileged` (`documents/ownership.ts`), sem predicado duplicado (REQ-SEC-020).
- **RNF-BAR-03** O cálculo das entradas é memoizado por versão do documento do ator, só para o ator
  ativo: recalcular a cada mudança engasgaria com muitos NPCs.
- **RNF-BAR-04** Teste de servidor reserva porta por `packages/server/src/__tests__/helpers/ports.ts`;
  nunca porta fixa.
- **RNF-BAR-05** Toda tarefa de UI da barra segue `docs/design/PROCESSO-UI.md`: lente protótipo
  na revisão, roteiro `tutorial-e2e` com os prints olhados, print protótipo × tela no PR e smoke como
  Mestre e como jogador.
- **RNF-BAR-06** Código de produção da barra nasce com teste antes. A extração de REQ-BAR-052
  mantém a suíte da ficha e a catraca `pathbuilder-parity` verdes antes do primeiro conteúdo.
- **RNF-BAR-07** Sem arte nem ícone da Paizo: ícones livres (REQ-AST-048) e rótulos do pack
  pt-BR.
- **RNF-BAR-08** Todo recorte absorvido de outra frente (DEC-BAR-12) confere o código atual antes
  de virar código: os planos de 16/09 citam linhas que já mudaram.

## 7. Modelo de dados e API

### 7.1 O contrato do registry

O contrato abaixo fecha o esboço da §5.1 do plano. A BAR-F1-02 pode ajustar o nome dos campos
auxiliares; as invariantes dos requisitos do §5 não mudam.

```ts
// core: packages/client/src/lib/actionbar/actionBarRegistry.ts
interface ActionBarRegistry {
  /** Chamado por `registerPf2eSheets()` no boot (REQ-BAR-012). */
  register(documentType: string, subtype: string, provider: ActionBarProvider): void;
  /** Resolução como a da ficha (REQ-UIF-019). `null`: o ator não tem barra. */
  resolve(documentType: string, subtype: string): ActionBarProvider | null;
}

interface ActionBarProvider {
  /** Entradas do ator, puras: doc + derived + contexto de combate. Sem abrir a ficha. */
  entries(ctx: ActionBarContext): ActionBarEntry[];
  /** Faixa de estado: PV, foco, herói, slots, condições, recursos de classe. */
  status(ctx: ActionBarContext): ActionBarStatus;
  /** Executa emitindo as mesmas ops da ficha; o servidor valida tudo. */
  execute(
    entry: ActionBarEntry,
    choice: ActionBarChoice,
    services: ActionBarServices,
  ): Promise<void>;
  /** Painel de detalhe do sistema (o mesmo da ficha), aberto pelo tooltip. */
  details?: Component<{ entry: ActionBarEntry }>;
}

interface ActionBarEntry {
  id: string; // estável no ator ("<kind>:<origem>"): é o que o favorito e o ícone guardam
  kind: "strike" | "spell" | "action" | "item" | "reaction" | "toggle" | "check";
  tab: string; // aba onde aparece (uma das de DEC-BAR-07)
  group?: string; // "2º patamar", "Atletismo"…
  label: string; // pt-BR, o do pack
  icon?: string; // ícone genérico livre; a imagem customizada vem de flags.fusion.actionBar.icons
  cost?: ActionCost; // 1–3 ações, reação, livre ou variável: só exibido (D-15)
  traits?: string[];
  uses?: { value: number; max?: number }; // quantidade, slots, cargas
  state?: "ready" | "unavailable" | "spent-until-recharge" | "active";
  reason?: string; // por que está esmaecida
  variants?: ActionBarVariant[]; // MAP, nº de ações, patamar, elemento
  target?: "none" | "one" | "many";
  range?: { kind: "reach" | "range"; feet: number };
}

interface ActionBarContext {
  actor: ActorDocument; // o ator ativo, já filtrado pelo gate de posse (REQ-BAR-003)
  derived: Readonly<Record<string, unknown>>; // valores derivados do sistema; nunca persistidos
  combat: ActionBarCombatContext; // turno, ataques do turno (MAP) e alvos marcados
}
```

Os tipos auxiliares têm o conteúdo mínimo abaixo, tirado do §4 e do §5 do plano:

| Tipo                     | Conteúdo mínimo                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ActionBarCombatContext` | Se há encontro; se o participante da vez é do usuário; a rodada; a contagem de ataques do turno do ator ativo (a que o servidor publica em `combat.attackCount`); os alvos marcados (`getMyTargets()`, com o nome já redigido). |
| `ActionBarStatus`        | Nome, classes e retrato; PV com o temporário; os recursos (foco, herói, slots do patamar em foco, recursos de classe); as condições (nome e efeito); o alvo; o MAP do próximo ataque.                                           |
| `ActionBarVariant`       | Uma forma de executar a entrada: o número do ataque (MAP), o número de ações, o patamar ou o elemento, com rótulo, custo e o efeito de cada uma.                                                                                |
| `ActionBarChoice`        | A variante escolhida pelo usuário, ou a padrão (REQ-BAR-041).                                                                                                                                                                   |
| `ActionBarServices`      | O que o core empresta ao provedor para executar pelos mesmos caminhos da ficha: enviar op com `expectedVersion` (`makeSendOpFn`), ler os alvos marcados (`getMyTargets()`), abrir a ficha (`openActorSheet`) e postar no chat.  |
| `ActionCost`             | O custo exibido: ações (1 a 3), reação, livre, atividade, passivo ou nenhum. Forma de ALQ-F7-02 (plano do Alquimista §2.11); só dado, nada conta nem bloqueia (D-15). Ver Q-BAR-06.                                             |

### 7.2 O que a barra guarda no ator

```ts
// flags.fusion.actionBar — Actor. Schema Zod no pacote shared (BAR-F3-01, BAR-F3-05).
// Esboço: a BAR-F3-01 fixa os nomes exatos; as invariantes são as dos requisitos.
interface ActorActionBarFlags {
  favorites: (string | null)[]; // até 12 posições: `id` da entrada, ou vazio; a posição é a tecla
  seeded: boolean; // a semente da primeira abertura já foi aplicada
  icons?: Record<string, string>; // `id` da entrada → "/assets/…", com teto de entradas
}
```

### 7.3 O que a barra guarda no dispositivo

```ts
// chave `fusion:actionBar:<worldId>:<userId>` (DEC-UIF-10); nunca vai ao servidor
interface ActionBarDevicePrefs {
  collapsed: boolean; // barra recolhida à faixa de estado
  tab: string; // última aba aberta
}
```

### 7.4 Escritas e rotas

- **Favoritos e ícones:** `doc:update` no `Actor`, com `expectedVersion` (REQ-NET-026). A posse é a do
  próprio `doc:update` (REQ-USR-014): OWNER ou papel privilegiado. O servidor valida o conteúdo de
  `flags.fusion.actionBar` (teto de ícones, só `/assets/…` inteiro), como já recusa escritas inválidas
  em outros campos de `flags.fusion`. Não há op nova (REQ-BAR-016).
- **Execução das entradas:** as ops e os caminhos que a ficha já usa (chat, `doc:update` de slot e foco,
  `item:consume`, `combat:nextTurn`).
- **Envio e listagem de imagem:** a rota de upload e a de listagem do pipeline de assets (spec `20`),
  com a permissão da emenda de REQ-BAR-075 e REQ-BAR-079. São rotas HTTP, não ops de
  socket.

## 8. Dependências

| Spec | O que esta spec consome / não pode contrariar                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `02` | `flags.<namespace>.<key>` (REQ-DOC-009). O campo `hotbar` do usuário fica sem consumidor (Q-BAR-09).                                                               |
| `04` | `doc:update` com `expectedVersion` (REQ-NET-026): único caminho de escrita dos favoritos e dos ícones.                                                             |
| `05` | Escala de ownership (REQ-USR-012, REQ-USR-013) e checagem no servidor (REQ-USR-014).                                                                               |
| `06` | Mira por botão direito (REQ-CNV-039); nome e barras da peça conforme conhecimento e posse (REQ-CNV-031).                                                           |
| `09` | O resultado sai no card de chat que a ficha já posta (DEC-CHT-03).                                                                                                 |
| `10` | Alvos (REQ-CBT-053..056) e MAP contado no servidor (REQ-CBT-069). A mira é por usuário e some no fim do turno (REQ-CBT-055).                                       |
| `11` | Shell, escala de z (REQ-UIF-008), registro de ficha (REQ-UIF-018, REQ-UIF-019), preferências de dispositivo (DEC-UIF-10). Emendada em REQ-UIF-001 e REQ-UIF-006.   |
| `14` | A hotbar substituída (REQ-MAC-012..018, DEC-MAC-06). A macro e a QuickAction voltam como `kind`, a cargo desta spec.                                               |
| `17` | O conteúdo PF2e: MAP (REQ-PF2-031, REQ-PF2-035) e as regras que o provedor chama.                                                                                  |
| `18` | O SF2e e o `consumeCharge` (BAR-F8-04).                                                                                                                            |
| `20` | Envio, listagem e apagar de imagem (REQ-AST-011, REQ-AST-029..031), `AssetRef` (REQ-AST-043) e o catálogo de ícones livres (REQ-AST-048). Emendada em REQ-AST-011. |
| `21` | Redação por papel (REQ-SEC-020) e upload (REQ-SEC-040..045). Emenda registrada para a BAR-F3-05 (§12).                                                             |
| `23` | Atalhos e guard (REQ-A11-020, REQ-A11-023), toque e tablet (REQ-A11-043..049). Emendada.                                                                           |
| `28` | A barra de comando do rodapé (REQ-HUB-007), que só existe em código na `build/app`. Emendada.                                                                      |
| `29` | O vínculo do companheiro com o dono (`masterActorId`), que a F6 usa.                                                                                               |
| `36` | A gaveta: 44 px de trilho e 300 px de painel, sobreposta ao canvas (REQ-GAV-012, REQ-GAV-013), e o breakpoint de 900 px (REQ-GAV-040).                             |
| `40` | De quem é a vez e Encerrar turno (REQ-CBA-072, REQ-CBA-081), redação do participante oculto (REQ-CBA-082), Q-CBA-01. Emendada.                                     |
| `41` | Posse (REQ-TOK-032, REQ-TOK-034) e o espaço de condições fora da peça (DEC-TOK-19, REQ-TOK-083). Emendada.                                                         |
| `45` | O que é um ator e a posse do companheiro, forçada à do dono.                                                                                                       |
| `47` | O recurso de classe genérico que a F7 espera (BAR-F7-06).                                                                                                          |
| `49` | Reservada (`REQ-ACO-`): o lugar do contador de ações, se um dia voltar. Esta spec não a escreve.                                                                   |
| `52` | As linhas executáveis do Bhrotto (Caçar Presa, Comandar, Montar, Apoio) e os padrões de card e de estado compacto (REQ-BHR-064..066, REQ-BHR-092).                 |

**Outras frentes** (plano §7). "Absorve" segue o precedente do Bhrotto (D-B08): a peça entra neste plano
com o contrato que o plano de origem fixou, e a ficha de origem é marcada como absorvida (DEC-BAR-12).
"Espera" é o que a barra não implementa (REQ-BAR-097).

| A barra precisa de                   | Situação em 11/10/2026  | Fonte                           | Como a barra trata       |
| ------------------------------------ | ----------------------- | ------------------------------- | ------------------------ |
| Mira, grau do golpe, MAP             | entregue                | BHR-F3-01..05 (= GUE-F1-01..05) | usa                      |
| Dano, cura e condição pelo card      | entregue                | ALQ-F1-06..10, BHR-F6-02        | usa                      |
| Comandar, Montar, Caçar Presa        | entregue                | BHR-F3-06..08, F4-07, F5-02     | usa                      |
| Consumo de item                      | servidor pronto, sem UI | ALQ-F2-11 (feito), ALQ-F2-12    | absorve a UI (BAR-F5-01) |
| Bomba consome a unidade              | não existe              | ALQ-F2-14                       | absorve (BAR-F5-02)      |
| Golpe de NPC com MAP                 | não existe              | GUE-F1-06                       | absorve (BAR-F4-01)      |
| Manobras restantes                   | 3 de 6                  | GUE-F5-03                       | recorte (BAR-F7-02)      |
| Escudo erguido e Bloqueio com Escudo | não existe              | GUE-F5-01/02                    | recorte (BAR-F7-03)      |
| Pool de reação                       | não existe              | GUE-F4-01 (← ALQ-F7-05, F6-10)  | espera (BAR-F7-05)       |
| Posturas                             | não existe              | ANI-F3-03, GUE-F6-01            | espera (BAR-F7-04)       |
| Recurso de classe genérico           | não existe              | ALQ-F3-02/04 (spec 47)          | espera (BAR-F7-06)       |
| Slot de canto (estados temporizados) | não existe              | ALQ-F6-10 (D-16)                | convive; não é a barra   |

## 9. Critérios de aceitação

- **CA-BAR-01** O jogador seleciona o token de um NPC: a barra continua no personagem dele, nenhum
  golpe, CA, PV, magia ou nome real do NPC aparece, e o provedor não é chamado com o NPC. O mesmo vale
  para o token de outro jogador. (REQ-BAR-001..006)
- **CA-BAR-02** O Mestre seleciona um NPC e vê a barra dele, com CA e PV exatos na faixa de estado;
  desmarca tudo e a barra some. (REQ-BAR-010, REQ-BAR-083)
- **CA-BAR-03** O jogador faz um golpe pela barra com um alvo marcado: o card de chat sai com o grau
  decidido pelo servidor contra a CA do alvo; a faixa de estado mostra o MAP do próximo ataque; no
  início do turno dele o MAP volta a zero. (REQ-BAR-041, REQ-BAR-038, REQ-BAR-053)
- **CA-BAR-04** Depois de quatro golpes e três magias no mesmo turno, nenhuma entrada está
  bloqueada por custo, e a faixa de estado mostra só o MAP do próximo ataque. Não há pips de ações.
  (REQ-BAR-036, REQ-BAR-032)
- **CA-BAR-05** Um personagem sem `flags.fusion.actionBar` abre a barra e recebe a semente. Ele
  fixa uma magia, desafixa um golpe e reordena; ao recarregar em outro dispositivo, a ordem é a mesma.
  Uma magia nova que ele aprende vai para a aba Magias e não entra nos favoritos.
  (REQ-BAR-064, REQ-BAR-065, REQ-BAR-061, REQ-BAR-063)
- **CA-BAR-06** Um item vendido que era favorito aparece esmaecido como "não está mais na ficha",
  com Desafixar. (REQ-BAR-066)
- **CA-BAR-07** A tecla 1 executa o favorito 1. Com o foco no chat, num diálogo ou num botão, a tecla
  não executa nada. (REQ-BAR-048, REQ-BAR-049, REQ-BAR-051)
- **CA-BAR-08** O jogador troca o ícone de uma entrada do próprio personagem por uma imagem enviada
  por ele, e outro jogador vê a imagem. A escrita do mapa de ícones num ator alheio é recusada pelo
  servidor; o Mestre troca o ícone de qualquer ator. (REQ-BAR-067..073)
- **CA-BAR-09** O servidor recusa um mapa de ícones com URL externa, com valor que não seja um
  caminho `/assets/…` inteiro e com mais entradas que o teto. (REQ-BAR-068,
  REQ-BAR-069, REQ-BAR-071)
- **CA-BAR-10** Um jogador sem papel de Confiável envia uma imagem e a vê na galeria. A galeria
  lista só os envios marcados como ícone, e não os mapas, retratos e handouts do Mestre. O jogador não
  consegue apagar; o Mestre apaga. (REQ-BAR-075..081)
- **CA-BAR-11** Encerrar turno só aparece no turno do próprio usuário, ou para o Mestre, e o
  servidor recusa o pedido de quem não é dono do participante da vez. (REQ-BAR-035)
- **CA-BAR-12** Desmoralizar aparece na aba Ações; o clique posta o card da ação e não rola nada
  sozinho. (REQ-BAR-057)
- **CA-BAR-13** A ficha de NPC rola golpe, salvamento, Percepção e perícia; o golpe sai com MAP,
  alvo e grau. (REQ-BAR-084)
- **CA-BAR-14** O `dependency-cruiser` e o `boundary-test` passam com o registry e o provedor stub,
  e o core não importa o satélite além do ponto de entrada publicado. (REQ-BAR-013)
- **CA-BAR-15** Depois da extração, a suíte da ficha e a catraca `pathbuilder-parity` passam e
  nada muda na tela. (REQ-BAR-052)
- **CA-BAR-16** A barra recolhida mostra só a faixa de estado, e o estado persiste no dispositivo;
  com a área livre abaixo do limiar, a barra recolhe sozinha. (REQ-BAR-033,
  REQ-BAR-025, REQ-BAR-034)

## 10. Questões em aberto

- **Q-BAR-01** Como se decide "o último usado" quando o jogador tem mais de um personagem
  (REQ-BAR-009)? Os candidatos são o último ator ativo publicado pelo store, guardado no
  dispositivo, ou o último que agiu em combate. A BAR-F1-01 fixa.
- **Q-BAR-02** Qual é o critério de "mais usadas" na semente (DEC-BAR-08)? Não há contagem de uso. As
  opções são a ordem de relevância que o provedor já devolve (a da aba Ações da ficha) ou uma ordem
  fixa por tipo: golpes, depois magias, depois ações. A BAR-F3-01 fixa.
- **Q-BAR-03** Qual é o teto de entradas do mapa de ícones? O plano exige o teto (DEC-BAR-02) e não
  fixa o valor. Ele precisa cobrir as entradas que um jogador de fato customiza sem reabrir o vetor de
  amplificação de grants. A BAR-F3-05 fixa o número, com teste de borda.
- **Q-BAR-04** Como estender `asset-fields.ts` para um campo em `flags.*` cujo valor é um mapa?
  O arquivo só aceita os caminhos `campo` e `lista[].campo` e proíbe `flags.*` e `system.*` (regra de
  manutenção 2), porque são registros livres que o dono do ator escreve. O mapa de ícones é o primeiro
  caso. A BAR-F3-05 decide a gramática nova e documenta a exceção no arquivo; a revisão adversarial
  confere (REQ-BAR-071).
- **Q-BAR-05** O envio deduplicado de um jogador devolve o caminho do asset que já existe
  (REQ-AST-009). Se o existente não for um ícone — por exemplo, um handout do Mestre com a mesma
  imagem —, a resposta revelaria o nome de um arquivo que a galeria esconde (REQ-BAR-079). O
  envio deduplicado do jogador marca o existente como ícone, ou devolve um caminho novo? A revisão
  adversarial da BAR-F3-05 decide.
- **Q-BAR-06** `ActionCost` tem dono no plano do Alquimista (ALQ-F7-02, §2.11), parado em
  33/125 e sem o tipo entregue, e a barra precisa dele agora (DEC-BAR-14). Quem o declara primeiro — a
  BAR-F1-02, com a forma de §2.11, ou a ALQ-F7-02 — e como o outro passa a importá-lo?
- **Q-BAR-07** Clicar num slot com o mouse deixa o foco no botão, e o guard (REQ-BAR-049)
  suspende as teclas com botão em foco: quem clica e em seguida aperta uma tecla não vê nada
  acontecer. A BAR-F1-04 e a BAR-F1-05 devolvem o foco ao canvas depois do clique, ou há outra saída
  que respeite REQ-BAR-049?
- **Q-BAR-08** O Encerrar turno do Mestre aparece só no turno do ator selecionado, ou em
  qualquer turno em andamento? O plano diz "só aparece no seu turno, ou para o Mestre"
  (REQ-BAR-035); o protótipo mostra o botão no turno do NPC selecionado (T6).
- **Q-BAR-09** `UserDocument.hotbar` e `MacroSchema` (spec `02`) ficam sem consumidor com a
  hotbar aposentada. Remover o campo, ou mantê-lo até a macro voltar como `kind` (spec `14`)?
- **Q-BAR-10** Quando a lista de jogadores (REQ-UIF-007, canto inferior esquerdo) e o avatar (spec
  `35`, canto inferior direito) existirem na linha, a barra os cobre em área livre estreita? O plano
  resolve pelo recolher abaixo de cerca de 1000 px (REQ-BAR-025); a BAR-F1-04 confere com
  cada um.

## 11. Referências

- `docs/design/barra-de-acoes/plano.md` (§3 a §10), `docs/design/barra-de-acoes/decisoes.md` e
  `docs/design/barra-de-acoes/prototipo-barra-fiel.html` (telas T1–T7).
- `docs/design/PROCESSO-UI.md` (P1–P4).
- `docs/design/alquimista/tasks.md` (D-15, §2.11 `ActionCost`, ALQ-F7-02); `docs/design/bhrotto/decisoes.md`
  (D-B08, D-B23).
- `packages/server/src/assets/asset-fields.ts` (as regras de manutenção do arquivo) e
  `packages/server/src/assets/routes.ts` (permissões do pipeline de assets hoje).
- `.dependency-cruiser.cjs` (regra `client-core-must-not-import-system-sheets`).

## 12. Emendas que esta spec obriga

Registradas aqui para que nenhuma spec fique contrariada em silêncio (`CONVENCOES.md` §2). Nenhum id é
renumerado. As emendas de `11`, `14`, `20`, `23`, `28`, `40` e `41` foram aplicadas nos próprios
arquivos em 2026-10-11, pela BAR-F0-02, e cada uma aponta de volta para esta spec.

| Spec        | O que muda                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` | A linha `REQ-BAR-` entra no registro de prefixos, a 53 entra no índice e o parágrafo dos números reservados registra que a 53 também nasceu nesta faixa. Sem isso o `spec-lint` reprova a definição de qualquer id desta spec.                                                                                                                  |
| `11`        | **REQ-UIF-001** troca "a hotbar centralizada na parte inferior" pela barra de ações na área livre (DEC-BAR-04, DEC-BAR-09). **REQ-UIF-006** é aposentado e passa de [MVP] a [V2]; as menções que sobram à hotbar (o conceito de Shell, REQ-UIF-046 (d) e `hotbarPage`) leem-se como a barra.                                                    |
| `14`        | **REQ-MAC-012..018** são aposentados e passam de [MVP] a [V2]; DEC-MAC-06 ganha a nota do que a substitui (DEC-BAR-07); as menções à hotbar em REQ-MAC-005, REQ-MAC-021, REQ-MAC-024, REQ-MAC-028, REQ-MAC-NF-003 e CA-MAC-01, CA-MAC-03 e CA-MAC-10 leem-se conforme a nota; a questão 2 de "Questões em Aberto" é respondida por REQ-BAR-066. |
| `20`        | **REQ-AST-011** passa a permitir o envio de imagem a todo jogador (DEC-BAR-03); a listagem do jogador mostra só os envios marcados como ícone (REQ-BAR-079); apagar segue só do GM (REQ-AST-029).                                                                                                                                               |
| `21`        | **Registrada, não aplicada nesta passagem.** **REQ-SEC-043** (diretórios por papel) precisa da exceção do destino do envio de ícone (REQ-BAR-076), e **REQ-SEC-044** (cota por usuário configurável) fica desligada para esse envio (REQ-BAR-077). A emenda é aplicada no PR da BAR-F3-05, junto com a revisão adversarial do grant.            |
| `23`        | **REQ-A11-020** recebe as ações nomeadas da barra (REQ-BAR-048) e o registro mínimo da BAR-F1-05 como começo do `KeybindingRegistry`; **REQ-A11-023** passa a cobrir também o botão em foco nos atalhos da barra (REQ-BAR-049); REQ-A11-044, REQ-A11-046 e REQ-A11-049 valem para a barra em modo tablet (REQ-BAR-100).                         |
| `28`        | **REQ-HUB-007**: o rodapé central é da barra de ações; a barra de comando do Hub vira grupo compacto na ponta quando as linhas convergirem (REQ-BAR-024).                                                                                                                                                                                       |
| `40`        | **Q-CBA-01** respondida em parte: a faixa de estado mostra de quem é a vez fora da gaveta (REQ-BAR-040). O título da janela do navegador segue em aberto.                                                                                                                                                                                       |
| `41`        | **DEC-TOK-19**: a faixa de estado da barra é, para o ator ativo, o espaço dedicado de condições fora da peça (REQ-BAR-028). REQ-TOK-083 não muda.                                                                                                                                                                                               |
