# 41 — Token

- **Título:** Token — a manifestação de um ator numa cena
- **Status:** draft v0.2 (2026-08-23) — emenda: §5.12 e DEC-TOK-22 (abrir a ficha pela peça)
- **Nível:** Área (ver DEC-TOK-01)
- **Baseada em:**
  - `45-atores.md` — o que a presença **herda** do ator: facetas, identidade, o ator-base como molde e não como valor vivo (REQ-ATR-070..073, DEC-ATR-14). Esta spec diz o que a presença **é**.
  - `02-modelo-de-dados.md` — a forma do `Token` embedded, o vínculo `actorLink`, o `actorDelta` como merge patch e o default de criação por subtype (REQ-DOC-025, REQ-DOC-031..035, REQ-DOC-061, REQ-DOC-062, DEC-DOC-08, DEC-DOC-11).
  - `06-canvas-e-renderizacao.md` — o desenho da peça: footprint, borda por disposição, barras, nameplate, níveis de exibição, duplicação (REQ-CNV-023, REQ-CNV-025..033, REQ-CNV-041, REQ-CNV-089..093, DEC-CNV-07, DEC-CNV-15).
  - `39-contatos.md` — o modelo de conhecimento: par contato × personagem, estado efetivo do usuário como o maior entre seus personagens, e a redação do degrau `entrevisto` (DEC-CTT-03, DEC-CTT-04, REQ-CTT-070..076).
  - `05-usuarios-e-permissoes.md` — a escala de posse e o papel privilegiado (REQ-USR-013).
  - `04-rede-e-sincronizacao.md` — `token:move`, `token:preview` e a redação nos quatro caminhos de emissão (REQ-NET-024, REQ-NET-044, REQ-NET-096).
  - `15-api-de-sistemas.md` — o contrato pelo qual o sistema declara barras e, agora, a conversão de tamanho em células (REQ-SYS-004).

> **Spec de área.** Esta spec é dona do **conceito de token**: o que ele é, o que ele guarda,
> como nasce, quem o move, quem o vê e o que ele herda. Ela **não** redefine a forma de
> Document (`02`), o pipeline de render (`06`), o modelo de conhecimento (`39`), a política de
> redação por papel (`21`) nem o que é um ator (`45`). Onde ela contraria um requisito existente,
> a emenda está registrada em §12 — nenhuma spec fica contrariada em silêncio.

---

## 1. Objetivo

Dar dona ao conceito mais citado e menos definido do projeto. Hoje **121 requisitos em 21
áreas** falam da peça que representa um ator numa cena, e nenhuma área a define: `02` fixa o
vínculo, `04` move, `06` desenha, `10` põe em iniciativa, e a definição fica no vão entre elas.

A lacuna já cobrou preço fora das specs. A forma do estado quente no banco foi **adiada** por
não existir spec de Token. A spec `40` teve de **banir a palavra** da interface (DEC-CBA-06).
As specs `42`, `44` e `45` cunharam "presença na cena" explicitamente porque a `41` não existia.
E o código acumulou quatro grafias divergentes para o mesmo campo de arte, duas implementações
concorrentes de "controle de token" — uma delas errada — e uma barra de vida desenhada sempre
cheia.

Esta spec responde a uma pergunta e recusa as outras:

> **Token é a manifestação de um ator numa cena: a peça que ocupa um lugar no mapa, que pode
> se mover e que pode ser vista ou ocultada.**

## 2. Escopo

### 2.1 Inclui

- A **definição** de token e a fronteira entre o que é e o que não é token.
- O que a peça **guarda** e — mais importante — o que ela **não guarda**, herdando do ator.
- O **contrato de invocação**: o que uma peça tem de receber para existir, o que aceita como
  sobrescrita e o que recusa.
- As **permissões**: quem cria, quem move, quem copia, quem exclui.
- O **movimento**, e apenas a validação de permissão que ele exige.
- A **ocultação por usuário**, e a diferença entre ocultar e não estar enxergando.
- O que cada usuário **vê** da peça: nome por conhecimento, vida por posse, e a preferência
  de exibição do próprio usuário.
- A **duplicação** em dois modos e o efeito de excluir a peça ou o ator.
- A **ordem de desenho** entre peças sobrepostas.
- O **ponto de extensão** para sistema e addon.

### 2.2 Não inclui

- O que é um **ator**, suas facetas, seu ciclo de vida e sua posse → `45-atores.md`.
- A forma de `Document`, `EmbeddedCollection` e o CRUD → `02-modelo-de-dados.md`.
- O **pipeline de render**, camadas PIXI, grid e snapping → `06-canvas-e-renderizacao.md`.
  Esta spec diz o que se desenha; a `06` diz como.
- **Visão, campo de visão, névoa e iluminação** → `07-visao-iluminacao-fog.md` (ver DEC-TOK-18).
- O **modelo de conhecimento** (quem conhece quem, e como se edita) → `39-contatos.md`.
- A **política de redação** de payload por papel → `21-seguranca.md` (REQ-SEC-020).
- A **marcação de alvo** (targeting) → segue sem dona; ver DEC-TOK-22 e Q-TOK-05.
- **Iniciativa, turno e fila de combate** → `10-combate-e-iniciativa.md`, `40-aba-combate.md`.
- A **concorrência de escrita** entre dois arrastes simultâneos → `04-rede-e-sincronizacao.md`.
- O **deslocamento como regra de jogo** (quantos metros a criatura anda) → `15-api-de-sistemas.md`
  e as specs de sistema. Esta spec define o gesto, nunca o alcance.
- O **saque** do corpo caído ou do baú → spec `46` (Recipientes), reservada pela `45`.

## 3. Conceitos e terminologia

| Conceito                    | Definição                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Token**                   | A manifestação de um ator numa cena. Termo canônico (DEC-TOK-01); "presença na cena" é a tradução de mesa dele, não um sinônimo concorrente. |
| **Ator efetivo**            | O ator que a peça manifesta: o `Actor` base quando vinculada, base + `actorDelta` quando desvinculada (REQ-DOC-032/033).                     |
| **Vínculo**                 | `actorLink`. Vinculada, a peça lê o ator do mundo; desvinculada, carrega estado vivo próprio.                                                |
| **Footprint**               | O conjunto de células que a peça ocupa. Derivado do tamanho do ator pelo sistema (DEC-TOK-03).                                               |
| **Origem**                  | A porta por onde a peça é invocada: arraste do diretório, do compêndio, de uma aba. Cada origem é de sua própria spec (DEC-TOK-05).          |
| **Contrato de invocação**   | O conjunto mínimo de dados que a criação exige, o que ela aceita sobrescrito e o que ela recusa (§7.2).                                      |
| **Ocultação**               | `hidden` + a lista de exceções. Decisão do Mestre, redigida no servidor: a peça oculta **não chega** ao cliente (DEC-TOK-08).                |
| **Conhecimento**            | O estado do par contato × personagem da `39` (REQ-CTT-070). Governa o nome, nunca a presença.                                                |
| **Preferência de exibição** | Escolha do usuário sobre o que desenhar na cena. Só subtrai do que ele já podia ver (DEC-TOK-11).                                            |
| **Cópia crua / idêntica**   | Os dois modos de duplicar: a primeira nasce com o estado vivo zerado, a segunda o preserva (DEC-TOK-14).                                     |

## 4. Decisões

### DEC-TOK-01 — Token é área, e o termo é "token"

Esta spec é de nível **Área**, apesar do número alto — o mesmo caso da `45` (DEC-ATR-01), e pela
regra do `CONVENCOES.md` §3, em que a faixa de número é sinal histórico e o nível é declarado no
cabeçalho. O termo canônico é **token**, e o prefixo é `REQ-TOK-`.

- **Racional:** decidir o que a peça guarda obriga a decidir o que ela herda, quem a move, quem
  a vê e quem a cria — todas se restringem mutuamente, que é o teste de corte do §1 das
  convenções. Não é uma feature que combina decisões existentes: é o vão entre elas.
- **Por que "token" e não "presença na cena":** as três specs que adotaram "presença" o fizeram
  **explicitamente porque esta spec não existia** — a `42` escreve no glossário que o termo evita
  "token", cujo conceito só seria definido aqui. Quando a dona existe, a razão do contorno
  desaparece. Do outro lado pesam 121 requisitos que já dizem "token", os eventos `token:move`,
  `token:preview` e `token:targeted` implementados no wire, e os tipos `TokenDocument`,
  `TokenSprite` e `TokenLayer` no código. Consagrar "presença" obrigaria a renomear tudo isso ou
  a conviver com dois vocabulários — o defeito que a `45` veio corrigir.
- **Sem colisão técnica:** token de autenticação vive em `REQ-USR-`/`REQ-SEC-`; design token não
  tem requisito algum. As citações de "presença na cena" em `42`, `44` e `45` permanecem válidas
  e passam a apontar para cá.

### DEC-TOK-02 — A peça é endereço, não identidade

Tudo que descreve **quem** o ator é vem do ator. A peça guarda **onde** ele está e o **estado de
peça**: posição, vínculo, ocultação, rótulo, elevação, rotação.

- **Consequência imediata:** a peça **não tem campo de arte**. A arte exibida é a do ator efetivo,
  sempre. Isso resolve por eliminação as quatro grafias divergentes que hoje convivem (`img` na
  `02`, `textureSrc` na `06`, `Token.texture.src` na `20`, `texture` no código) — não se escolhe
  a grafia certa, apaga-se o campo.
- **Corrige um defeito latente:** hoje a criação **copia** a arte do ator para a peça. Trocar a
  arte do ator não atualiza as peças já postas no mapa.
- **É o que sustenta o caso do corpo caído.** Quando a criatura morre e ganha a faceta `container`
  (`45`, DEC-ATR-03/05), **a peça não muda** — o mesmo token continua no mapa, e o que mudou foi o
  ator. Se a peça carregasse identidade, esse caso exigiria trocar a peça.

### DEC-TOK-03 — O tamanho é do ator; a conversão em células é do sistema

O footprint não é dado da peça. O ator carrega o requisito de tamanho, e o mapeamento
tamanho → células é **declaração do sistema de jogo** (PF2e: Médio 1×1, Grande 2×2).

- **Racional:** a engine não arbitra regra de sistema. É a mesma disciplina de REQ-SYS-004 para
  barras e iniciativa.
- **Consequência coerente com DEC-TOK-02:** identidade e forma vêm ambas do ator. Se a criatura
  cresce por magia, o footprint muda sozinho, porque é derivado.

### DEC-TOK-04 — Toda peça exige um ator, por ora

`actorId` é obrigatório. `null` é recusado, não ignorado.

- **Não é recusa definitiva, é adiamento deliberado.** A liberdade de criar uma peça avulsa
  ("token rápido" com vida, imagem e posição, para montar combate sem cerimônia) é desejável e
  será decidida com calma — fora da pressa desta spec.
- **O que fez adiar:** a vida da peça avulsa é o nó. Sem ator, ela não tem onde morar senão dentro
  da `Scene`, que é estado compartilhado que todo jogador recebe — exatamente o problema que
  obrigou REQ-DOC-062 a redigir o `actorDelta`. Junto caem iniciativa (a fórmula roda sobre o
  ator), condições (são items do ator), facetas (são do ator) e metade do `Combatant`, que
  referencia `tokenId` **e** `actorId` (REQ-CBT-002). São cinco mecanismos paralelos para um caso
  classificado como não incentivado.
- **Quando voltar, a saída provável é o ator descartável:** o gesto de mesa é "criar rápido", e
  por baixo nasce um ator mínimo com a peça vinculada a ele. A `45` já sabe tratar ator que não
  aparece em diretório (DEC-ATR-09, o baú).
- **É esta decisão que torna as demais sem exceção:** herança de arte, herança de tamanho e o
  obrigatório do contrato de invocação só são regras universais porque não existe peça órfã.

### DEC-TOK-05 — Nascimento: herda tudo, e a origem pode sobrescrever

Ao nascer, a peça herda as informações do ator. A **origem** — a porta por onde é invocada — pode
sobrescrever o que precisar: o Mestre que prepara uma emboscada faz o goblin entrar oculto.

Esta spec **não** define quem sobrescreve nem como. Se a porta oferece um toggle, um diálogo ou
nada, é da spec daquela porta. A `41` define o **contrato de invocação** (§7.2): o que a peça tem
de receber, o que aceita, e o que recusa.

- **Encerra a dúvida "molde no ator × derivação na hora":** nenhuma das duas. `prototypeToken`
  deixa de ser pré-requisito desta spec — se um dia existir, é fonte de defaults **do lado da
  origem**, não obrigação do contrato.
- **Recusar, não ignorar em silêncio.** Campo derivado que o servidor recalcula mas aceita no
  payload é campo que alguém vai escrever, e o teste que prova a derivação passa verde enquanto
  isso acontece. Os campos derivados e o recusado precisam de rejeição explícita e de teste que
  reproduza a escrita indevida.

### DEC-TOK-06 — Criar, copiar e excluir são do Mestre; controlar é ser dono do ator

Pôr peça na cena, duplicar e tirar exigem **papel privilegiado**. Mover exige ser **OWNER do
ator** que a peça manifesta. Não existe posse própria de peça, e não existe conceito próprio de
"controle de token".

- **Separa posse de autoridade sobre a cena, e é isso que torna a regra simples.** Ownership
  responde "de quem é esta ficha"; quem povoa a cena é quem dirige a mesa. Sem essa separação,
  cada operação precisaria da própria régua.
- **Consequência assumida:** o jogador **não** arrasta o próprio personagem do diretório para o
  mapa. Quem coloca é o Mestre. É o primeiro caso que alguém vai testar, e por isso está escrito.
- **Uma afirmação única, não um mecanismo novo:** ownership do `Actor` (REQ-DOC-025, DEC-CNV-15)
  já existe e já funciona. O que faltava era um lugar dizendo isso, em vez de três telas
  re-derivando — e uma delas derivou errado, lendo campos que a `02` proíbe.

### DEC-TOK-07 — Movimento: setas e arraste, com validação de permissão e nada mais

O gesto canônico é o **teclado**: as setas movem a peça selecionada, uma célula por vez, sem
diagonal. O **arraste continua movendo**, ao lado delas. A única validação que o movimento faz é
a permissão de DEC-TOK-06.

- **A `23` ganha acessibilidade sem acréscimo.** REQ-A11-036 exige alternativa não-arraste para
  toda ação de arraste; com as setas como gesto canônico, a alternativa é o caminho principal.
- **Sem diagonal, deliberadamente.** Atravessar na diagonal custa duas teclas. Trocado por não
  inventar gesto composto (duas setas simultâneas) num MVP.
- **Colisão sai junto com DEC-TOK-18.** Sem parede, não há o que colidir. Sobra a permissão e a
  posição final: sem elevação como obstáculo, sem distância máxima.
- **Não confundir com passo de regra.** "Uma célula por tecla" é gesto de interface. Quanto a
  criatura pode andar é do sistema e do combate; esta spec não conta deslocamento.

### DEC-TOK-08 — Ocultar é por usuário, e não é o mesmo que não estar enxergando

Uma peça pode estar oculta para uns e visível para outros: só um personagem enxerga aquela
armadilha. `hidden` permanece como "está oculta", e ganha ao lado uma lista de exceções — quem,
apesar disso, a recebe.

- **Ocultar é decisão, redigida no servidor:** a peça **não chega** ao cliente. Estar fora do
  campo de visão seria cálculo do cliente (DEC-VIS-02): a peça chega e é escondida na tela. São
  mecanismos diferentes, com garantias diferentes, e a spec precisa dizer isso — senão alguém
  supõe que a névoa protege posição de inimigo, e ela não protege.
- **Custo baixo por sorte de arquitetura:** a emissão de `Scene` já é por socket, então redigir
  por usuário não exige caminho novo — só um predicado que conhece o `userId`, que o socket já tem.
- **A lista é escrita por gesto do Mestre hoje, e por regra de sistema amanhã.** É o gancho da
  percepção passiva: quem passar no teste entra na lista. Esta spec **não** define teste, CD nem
  automação — mas o mecanismo nasce aberto a um escritor que não seja humano.

### DEC-TOK-09 — O nome sai do conhecimento, e por isso esta spec não tem regra de nome

O nome exibido é o do ator, e quem recebe o nome do ator é decidido pelo modelo de conhecimento
da `39`: `conhecido` recebe, `entrevisto` e `oculto` não. O estado efetivo do usuário é o **maior
entre seus personagens**, que é exatamente o que REQ-CTT-071 já determina.

- **A consequência é uma subtração.** Esta spec deixa de ter qualquer regra de nome, e some com
  `displayName`, com o enum de níveis e com a pergunta "qual o default". A peça herda o que
  chegou.
- **A redação muda de objeto.** DEC-TOK-08 redige a **peça**; isto redige o **ator**: o mesmo
  `Actor` chega nomeado para uns e anônimo para outros. É superfície da `21`, não desta spec.
- **A arte não é redigida junto com o nome, e a `39` precisa de emenda por isso.** DEC-CTT-04 diz
  que o payload de um contato `entrevisto` não pode conter nome, título **nem retrato**. Mas uma
  peça no mapa precisa da arte para ser desenhada, e o jogador está olhando a criatura: o segredo
  é **quem ela é**, não **como ela parece**. A regra que fica de pé nas duas specs: o nome é
  redigido no servidor, sempre; a arte viaja, e a silhueta do cartão de contato passa a ser
  escolha de apresentação daquela tela. Ver §12.
- **O rótulo da peça é outra coisa, e a fronteira precisa estar escrita.** Escrever "Encapuzado"
  no nome da peça é escolha de exibição, visível a quem vê a peça; **não** protege a identidade do
  ator. Sem essa separação nascem dois mecanismos concorrentes de "você não sabe quem é este", e
  eles divergem no primeiro caso em que o Mestre renomear achando que está escondendo.
- **Fronteira do que a regra esconde:** com a arte sempre visível, esconder o nome "Kobold" de
  quem está vendo o desenho de um kobold esconde pouco. Onde a regra ganha é no NPC nomeado.

### DEC-TOK-10 — A vida é do dono: o corte é OWNER, em toda superfície

O jogador vê os pontos de vida dos atores de que é OWNER. O Mestre vê os de todos. O corte é
**OWNER (3)** e vale igualmente em toda superfície que mostre vida — não há regra diferente por
tela.

- **Reverte a DEC-CNV-15**, que havia escolhido OBSERVER (2) com o argumento de que ler o HP do
  companheiro não exige poder editá-lo. O argumento continua válido em tese; a régua da mesa é
  outra.
- **O que sustentava OBSERVER caiu junto:** o motivo principal era não esvaziar o painel de
  Comitiva (`28`). Esse painel **não existe nesta linha** — foi substituído pelas telas de
  Combate (`40`) e Contatos (`39`). Sem ele, o corte em OWNER não tira nada de ninguém.
- **"Sub-personagem" não precisa de definição própria:** familiar, companheiro e montaria entram
  em "os meus" porque nascem com a ownership do jogador. É posse simples, sem regra nova de
  vínculo — e por isso nenhum número de spec foi reservado para o conceito.

### DEC-TOK-11 — Exibir nome e barra na cena é preferência do usuário

Três camadas separadas: o **servidor** decide o que se pode ver (conhecimento para nome, posse
para vida), a **peça** guarda posição e vínculo, e o **usuário** escolhe, em configurações, se
quer aquilo desenhado.

- **A preferência só subtrai.** Ela nunca revela o que a redação não mandou: desligar limpa a
  tela, ligar não abre nada. Isso precisa estar escrito, ou alguém a implementa como filtro de
  cliente que "mostra tudo".
- **Não é dado da peça nem do mundo.** É preferência de usuário, e some `displayName`/`displayBars`
  do modelo — que era o que puxava esta spec para uma decisão que nunca foi dela.
- **Os cinco níveis do Foundry saem inteiros**, não por corte, mas por não haver onde encaixá-los:
  `never`/`observer`/`hoverObserver`/`hoverAll`/`always` respondiam a uma pergunta que
  conhecimento e posse já respondem melhor, e os dois de _hover_ nunca tiveram argumento próprio
  em spec nenhuma do Fusion.

### DEC-TOK-12 — Três disposições, e a borda é a exibição delas

Disposição tem três valores: **hostil, neutro, amigo**. `secret` não é disposição — ocultar é
assunto de visibilidade, não de atitude. A borda colorida por disposição **permanece** como a
exibição dessa informação no mapa.

- **Resolve a contradição** entre `-1 | 0 | 1` (`02` e código) e as quatro strings da `06`.
- **A borda fica porque, sem ela, a disposição não teria exibição em lugar nenhum** — hostil e
  amigo ficariam indistinguíveis no mapa, e o dado viraria enfeite.
- **O ring dinâmico continua [V2]** (REQ-CNV-033): camadas dirigidas por estado de jogo voltam
  como protótipo visual mais adiante.

### DEC-TOK-13 — Não há trava nem ajuste visual por peça

`locked`, `scale`, `mirrorX`, `mirrorY`, `tint` e `alpha` saem do modelo. A peça mostra a arte do
ator como ela é; quem quiser um goblin maior e mais escuro faz outro ator.

- **Coerente com DEC-TOK-02:** um campo de ajuste seria uma segunda fonte de verdade sobre
  aparência, e a primeira coisa a divergir.
- **Custo de implementação zero:** nenhum dos seis existe no código hoje; `locked` só existia na
  `02`, e nunca chegou a ser implementado.

### DEC-TOK-14 — Duas cópias: crua e idêntica

Duplicar tem dois modos: a **crua** nasce como se a peça acabasse de ser posta (estado vivo
zerado, vida cheia); a **idêntica** leva o estado vivo como está.

- **A distinção só existe para peça desvinculada.** Uma peça vinculada não tem estado vivo
  próprio: a cópia lê o mesmo ator, com a mesma vida. Nascer com vida cheia exigiria curar o ator
  inteiro — e curaria a outra peça junto. Nesse caso os dois gestos **colapsam num só**.
- **Os modos são desta spec; o gesto é da `06`.** Qual tecla invoca cada um é da tela, e a `23`
  exige alternativa não-arraste para os dois.

### DEC-TOK-15 — Peças sobrepostas desenham em FIFO

Ordem de criação: a mais antiga embaixo, a mais recente por cima. **Sem campo de ordenação** — a
ordem é a da própria coleção.

- **Nada muda no schema:** é o comportamento atual, agora afirmado em vez de acidental. Tiles e
  drawings seguem com `sort` próprio; peça não ganha um.
- **Aceita o custo:** o Mestre não tem como trazer uma peça para frente sem recriá-la. Trocado de
  propósito por simplicidade.
- **A ordem tem de ser estável e igual em todos os clientes.** Como a coleção é persistida como
  array, isso já vale — mas o caminho genérico de update substitui a coleção inteira com a ordem
  que o requisitante mandar, e é mais uma razão para essa guarda existir.

### DEC-TOK-16 — Distinguir peças do mesmo ator é setting de mundo

O Mestre escolhe se peças do mesmo ator ganham numeração ("Esqueleto 1..6") ou ficam todas com o
mesmo nome. É **setting de mundo** (`37`), não regra fixa da engine.

- **Age no nascimento:** a numeração é o valor inicial do rótulo, não um campo separado. Como o
  rótulo é sobrescrevível, o Mestre renomeia depois se quiser.
- **O contador só cresce.** Morto o Esqueleto 3, o próximo nasce 7 — o buraco não é reaproveitado,
  e a mesa nunca vê dois "Esqueleto 3" na mesma sessão.

### DEC-TOK-17 — A peça não some sozinha; excluir o ator apaga as peças dele

Nada nesta spec faz uma peça desaparecer por conta própria. Morrer é assunto do ator. Excluir o
**ator**, ao contrário, apaga **todas as peças dele, em todas as cenas**.

- **Morrer não mexe na peça:** o corpo caído ganha a faceta `container` (`45`) e continua sendo a
  mesma peça, com o mesmo `_id`, no mesmo lugar. Sumir é gesto de alguém, não consequência.
- **A cascata decorre de DEC-TOK-04:** peça sem ator é proibida, logo peça órfã não é estado
  possível. Deixá-la apontando para o nada criaria por construção o caso que acabou de ser banido.
- **É exceção deliberada à DEC-DOC-11**, e está escrita como tal. A regra geral de soft reference
  com degradação graciosa **continua valendo para o chat**: a mensagem é histórico de algo que
  aconteceu, e tolera referência pendente; a peça é afirmação presente de que aquele ator está
  ali, e com o ator fora a afirmação é falsa.
- **Custo de implementação a registrar:** a exclusão passa a varrer as cenas do mundo, não só a
  ativa, e cada cena tocada emite broadcast. Não é deleção de uma linha só.

### DEC-TOK-18 — Visão, névoa e colisão ficam fora; só o lugar fica reservado

Visão, campo de visão, névoa, iluminação e colisão com parede **saem do escopo**. A peça declara
que **pode** ter visão e luz; o que isso faz é de uma spec de visão que hoje não vale.

- **O que fica:** `vision` e `light` no modelo como declaração inerte, sem comportamento definido,
  sem citar `REQ-VIS-*` como requisito desta spec. O nome do campo é `vision` — `sight` (grafia da
  `02`) é abandonado, satisfazendo REQ-VIS-093, que já exigia ausência de divergência entre as
  duas specs.
- **A definição de token não depende de enxergar.** A armadilha que não vê e o baú que não anda
  são tokens; ser fonte de visão é opcional, não constitutivo.
- **Alcance maior que esta spec, e por isso registrado e não decidido aqui:** visão/névoa está
  escrita como [MVP] na `07` inteira, no MVP global da `00`, no marco M2 da `27` e no `CLAUDE.md`
  do projeto. Tirar de verdade significa emendar os quatro. Esta spec apenas não a herda.

### DEC-TOK-19 — Ícones de status ficam fora da peça

Esta spec não define ícones de condição na peça. A direção é um espaço dedicado na HUD, e a
decisão é de quem for dono dessa tela.

- **Não afeta o registro de condição:** REQ-SYS-043 continua registrando `img`, `tone` e `help` —
  o que muda é **onde** isso aparece, não que exista.
- **O que motivou tirar:** uma peça de 1×1 com nome, duas barras, indicador de elevação, borda de
  disposição e até seis ícones de condição não é legível em nenhum zoom de mesa.

### DEC-TOK-20 — O sistema estende a peça por `flags` namespaced, e a engine não lê

Um sistema — e, no futuro, um addon — pode pendurar dado próprio numa peça. O mecanismo é o que já
existe: `flags` com namespace (REQ-DOC-009). A engine **não interpreta** o que está lá dentro.

- **Nada de campo novo no schema.** `flags` é exatamente o ponto de extensão para isso, é
  namespaced por design, e o não-interpretar é a garantia de que um addon não quebra o núcleo.
- **Tensão registrada, não resolvida:** REQ-ESC-012 fixa sistemas como pacotes compilados e trata
  plugin dinâmico como [V2], e a API de Módulos é lacuna sem número. Esta spec só garante que a
  peça não fecha a porta.

### DEC-TOK-21 — A forma persistida continua embutida, e o gatilho da revisão fica escrito

A peça permanece embutida na cena (JSON na linha do pai, `03` DEC-PER-02). Esta spec **não** decide
tabela própria: herda o adiamento registrado no plano de banco de dados, e escreve a condição que
o destrava.

- **O plano de banco não decidiu — adiou, com gatilho explícito**, sob o princípio de que decisão
  irreversível só se toma onde o conceito está fechado. O gatilho: destrava quando a spec de Token
  existir **e** os números de amplificação de escrita estiverem medidos. **A primeira metade é
  esta spec.**
- **Falta a segunda metade.** Há medição de bancada — o movimento reescreve a coleção inteira de
  tokens, com cerca de 58× de amplificação com uma peça —, não de sessão real.
- **Escrever o gatilho é o que impede o adiamento de virar esquecimento**, que foi exatamente o
  que produziu esta lacuna.

### DEC-TOK-22 — Targeting e concorrência de escrita não são desta spec

- **Marcação de alvo** fica fora. Ela é gesto de canvas e hoje está especificada em dois lugares
  sem citação cruzada — REQ-CNV-039 e as regras de combate —, e alvo marcado fora de combate não
  tem dona. Esta spec não a adota; registra a lacuna (Q-TOK-05).
- **Arraste simultâneo, trava efêmera e last-writer-wins** são problema de servidor e rede. Esta
  spec não os herda nem os cita como requisito seu.

### DEC-TOK-22 — A peça abre a ficha do ator, com a mesma régua que a move

Dois cliques numa peça abrem a ficha do **ator efetivo** dela. O gesto é da peça; a ficha continua
sendo do ator, e esta spec não define nenhuma "ficha de token".

- **O vão que isto fecha.** A `06` já exigia, em REQ-CNV-094, o que a ficha aberta **a partir de um
  token** deve mostrar — o ator efetivo, com as edições roteadas por token quando a peça é
  desvinculada. O que nunca esteve escrito em spec alguma é **por qual gesto** ela abre: a `23` cita
  `double-tap em token → abrir sheet` como linha de uma tabela de toque marcada [MVP-stretch], e
  nada mais. O código do cliente carregava a lacuna à vista: `sheetRegistry.ts` documenta-se como
  "chamado pelo duplo clique no token" e esse chamador nunca existiu.
- **Por que duplo clique, e não um clique.** O clique simples já é **seleção** (REQ-CNV-034), e a
  seleção é o que precede mover, duplicar e excluir. Um clique que abrisse janela tornaria
  impossível selecionar sem abrir. É também o gesto que a aba de NPCs (REQ-NPC-035) e a de
  Contatos (REQ-CTT-027) já usam para a mesma ação — a mesa aprende um gesto, não três.
- **Por que a régua é a mesma de mover, e não uma nova.** REQ-TOK-034 e DEC-TOK-06 proíbem
  qualquer predicado sobre a peça que não seja "OWNER do ator". Além disso a ficha de um ator que o
  jogador não possui exibiria pontos de vida que o servidor **redigiu** para fora da cópia dele
  (REQ-TOK-070/071): o gesto não pode ser porta lateral para dado que o fio nunca entregou.
- **O que fica em aberto, declarado.** Enquanto `token:updateActor` (REQ-DOC-034) não existir no
  servidor, a ficha aberta a partir de peça **desvinculada com delta** abre em leitura: gravar dali
  escreveria no ator-base e alteraria em silêncio todas as outras peças dele, exatamente o que
  REQ-CNV-094 proíbe. Ler é a metade honesta do gesto; a outra metade destrava com REQ-DOC-034.

## 5. Requisitos funcionais

### 5.1 Existência e identidade

- **REQ-TOK-001** [MVP] Um token DEVE existir apenas embedded numa cena, e a cena a que pertence
  DEVE ser dada pelo embedding, nunca por um campo do próprio token.
- **REQ-TOK-002** [MVP] Um token DEVE referenciar exatamente um ator por `actorId`; o servidor
  NÃO DEVE aceitar criação nem update com `actorId` nulo, ausente ou apontando para ator
  inexistente (DEC-TOK-04).
- **REQ-TOK-003** [MVP] Vários tokens do mesmo ator PODEM coexistir na mesma cena, e um mesmo ator
  PODE ter tokens em cenas diferentes; nenhum dos dois casos DEVE ser tratado como erro.
- **REQ-TOK-004** [MVP] Um ator PODE existir sem token algum, e isso NÃO DEVE ser tratado como
  estado incompleto (REQ-ATR-073).

### 5.2 O que a peça não guarda

- **REQ-TOK-010** [MVP] O `TokenDocument` NÃO DEVE possuir campo de arte, textura ou imagem; a
  arte exibida DEVE ser lida do ator efetivo a cada render (DEC-TOK-02).
- **REQ-TOK-011** [MVP] Trocar a arte de um ator DEVE alterar o desenho de **todos** os tokens
  dele, em todas as cenas, sem qualquer operação sobre os tokens.
- **REQ-TOK-012** [MVP] O `TokenDocument` NÃO DEVE possuir `width`/`height` nem qualquer campo de
  footprint; as células ocupadas DEVEM ser derivadas do tamanho do ator efetivo pela conversão
  declarada pelo sistema (DEC-TOK-03).
- **REQ-TOK-013** [MVP] O `TokenDocument` NÃO DEVE possuir `ownership` nem qualquer campo de
  usuário; a posse DEVE ser resolvida sobre o `Actor` referenciado (REQ-DOC-025, DEC-TOK-06).
- **REQ-TOK-014** [MVP] O `TokenDocument` NÃO DEVE possuir `locked`, `scale`, `tint`, `alpha`,
  `mirrorX` nem `mirrorY` (DEC-TOK-13).
- **REQ-TOK-015** [MVP] O `TokenDocument` NÃO DEVE possuir `displayName`, `displayBars` nem
  qualquer nível de exibição (DEC-TOK-11).
- **REQ-TOK-016** [MVP] O `TokenDocument` NÃO DEVE possuir campo de ordenação de desenho
  (DEC-TOK-15).
- **REQ-TOK-017** [MVP] Uma criatura que muda de tamanho em jogo DEVE ter o footprint dos seus
  tokens alterado sem qualquer escrita nos tokens.

### 5.3 Nascimento

- **REQ-TOK-020** [MVP] A criação de token DEVE exigir `actorId`, `x` e `y`; a cena vem do
  embedding.
- **REQ-TOK-021** [MVP] Todo campo não informado na criação DEVE ser herdado conforme §7.2, nunca
  deixado vazio ou zerado sem regra.
- **REQ-TOK-022** [MVP] O servidor DEVE **recusar** — com erro, não em silêncio — um payload de
  criação que traga campo derivado (footprint, arte, posse) ou `actorDelta` (DEC-TOK-05).
- **REQ-TOK-023** [MVP] O default de `actorLink` na criação DEVE seguir o subtype do ator
  (REQ-DOC-061), e esse default NÃO DEVE ser derivado em tempo de leitura nem travar o valor
  depois de criado.
- **REQ-TOK-024** [MVP] A origem PODE sobrescrever, no ato da criação, os campos listados como
  sobrescrevíveis em §7.2 — em particular `hidden`, para a peça que entra oculta.
- **REQ-TOK-025** [MVP] Esta spec NÃO DEVE definir a interface de nenhuma origem; cada porta de
  invocação é de sua própria spec (DEC-TOK-05).

### 5.4 Permissões

- **REQ-TOK-030** [MVP] Criar um token DEVE exigir papel privilegiado; o servidor DEVE recusar a
  criação pedida por qualquer outro papel, inclusive pelo OWNER do ator manifestado (DEC-TOK-06).
- **REQ-TOK-031** [MVP] Duplicar e excluir um token DEVEM exigir papel privilegiado, com a mesma
  régua de REQ-TOK-030.
- **REQ-TOK-032** [MVP] Mover um token DEVE exigir OWNER (3) sobre o ator efetivo, ou papel
  privilegiado (REQ-USR-013).
- **REQ-TOK-033** [MVP] A avaliação de permissão DEVE ser feita no servidor em todos os casos; a
  interface PODE antecipar o resultado, mas NÃO DEVE ser a única guarda.
- **REQ-TOK-034** [MVP] Não DEVE existir, em spec nem em código, um predicado de "controle de
  token" distinto de "OWNER do ator" (DEC-TOK-06).

### 5.5 Movimento

- **REQ-TOK-040** [MVP] As setas do teclado DEVEM mover o token selecionado uma célula por
  acionamento, nas quatro direções ortogonais; movimento diagonal NÃO DEVE ser oferecido por
  acionamento único (DEC-TOK-07).
- **REQ-TOK-041** [MVP] O arraste DEVE mover o token, com o mesmo efeito e a mesma validação do
  movimento por teclado.
- **REQ-TOK-042** [MVP] O movimento DEVE validar **apenas** a permissão de REQ-TOK-032 e a
  permanência dentro dos limites da cena; NÃO DEVE validar colisão, elevação nem distância
  percorrida (DEC-TOK-07, DEC-TOK-18).
- **REQ-TOK-043** [MVP] O token com footprint maior que uma célula DEVE encaixar no conjunto de
  células ocupadas (REQ-CNV-023), inclusive ao ser movido pelo teclado.
- **REQ-TOK-044** [MVP] Esta spec NÃO DEVE definir limite de deslocamento por regra de jogo.

### 5.6 Ocultação

- **REQ-TOK-050** [MVP] Um token DEVE poder estar oculto, e a ocultação DEVE admitir uma lista de
  usuários que, apesar dela, recebem o token (DEC-TOK-08).
- **REQ-TOK-051** [MVP] O token oculto NÃO DEVE ser emitido ao cliente de um usuário que não seja
  privilegiado nem esteja na lista de exceções — em **nenhum** dos quatro caminhos de emissão
  (REQ-NET-096).
- **REQ-TOK-052** [MVP] A lista de exceções DEVE ser gravável por gesto do Mestre e PODE ser
  gravada por regra de sistema; esta spec NÃO DEVE definir teste, dificuldade nem automação de
  percepção.
- **REQ-TOK-053** [MVP] A documentação da ocultação DEVE distinguir explicitamente ocultar
  (servidor, o token não chega) de não estar enxergando (cliente, o token chega e não é
  desenhado).

### 5.7 Nome

- **REQ-TOK-060** [MVP] O nome exibido de um token DEVE ser o do ator efetivo, salvo quando a peça
  carrega rótulo próprio, que prevalece (DEC-TOK-09).
- **REQ-TOK-061** [MVP] Um usuário só DEVE receber o nome do ator quando seu estado efetivo de
  conhecimento sobre ele for `conhecido` (REQ-CTT-070, REQ-CTT-071); nos demais estados o token
  DEVE ser exibido sem nome.
- **REQ-TOK-062** [MVP] O rótulo próprio da peça DEVE ser tratado como exibição, e NÃO DEVE ser
  usado como mecanismo de ocultação de identidade (DEC-TOK-09).
- **REQ-TOK-063** [MVP] Esta spec NÃO DEVE definir regra de nome própria; ela apenas herda o ator
  já redigido.
- **REQ-TOK-064** [MVP] A numeração de tokens do mesmo ator DEVE ser controlada por setting de
  mundo, aplicada como valor inicial do rótulo no nascimento (DEC-TOK-16).
- **REQ-TOK-065** [MVP] O contador de numeração NÃO DEVE reaproveitar número de token removido.

### 5.8 Vida e exibição

- **REQ-TOK-070** [MVP] Os pontos de vida do ator efetivo só DEVEM ser emitidos a usuários com
  OWNER (3) sobre ele, ou com papel privilegiado (DEC-TOK-10).
- **REQ-TOK-071** [MVP] O corte de REQ-TOK-070 DEVE valer igualmente em toda superfície que exiba
  vida; NÃO DEVE existir régua diferente por tela.
- **REQ-TOK-072** [MVP] O corte DEVE ser lido do `Actor` base mesmo quando o token é desvinculado:
  um delta descreve o que o token tem, nunca quem pode olhar (REQ-CNV-091).
- **REQ-TOK-073** [MVP] A barra DEVE refletir o valor real do atributo no ator efetivo, e DEVE ser
  **ausente** quando o caminho não resolve ou quando o máximo é zero — nunca desenhada cheia como
  placeholder (REQ-CNV-090).
- **REQ-TOK-074** [MVP] O usuário DEVE poder escolher, em configurações, se nomes e barras são
  desenhados na cena (DEC-TOK-11).
- **REQ-TOK-075** [MVP] A preferência de REQ-TOK-074 DEVE apenas subtrair do que o usuário já
  podia ver; ligá-la NÃO DEVE revelar nada que a redação do servidor não tenha emitido.
- **REQ-TOK-076** [MVP] O payload emitido a um usuário DEVE ser idêntico com a preferência de
  REQ-TOK-074 ligada ou desligada.

### 5.9 Aparência

- **REQ-TOK-080** [MVP] A disposição de um token DEVE ter exatamente três valores — hostil, neutro
  e amigo — e DEVE ser herdada do ator quando não sobrescrita (DEC-TOK-12).
- **REQ-TOK-081** [MVP] O token DEVE indicar sua disposição por borda colorida, com esquema
  consistente e configurável no tema (REQ-CNV-027).
- **REQ-TOK-082** [MVP] O token com elevação diferente de zero DEVE exibir indicador legível de
  elevação (REQ-CNV-032).
- **REQ-TOK-083** [MVP] O token NÃO DEVE exibir ícones de condição (DEC-TOK-19).
- **REQ-TOK-084** [MVP] Tokens sobrepostos DEVEM ser desenhados na ordem da coleção — o mais
  antigo embaixo —, e essa ordem DEVE ser estável e idêntica em todos os clientes (DEC-TOK-15).
- **REQ-TOK-085** [MVP] Um token que o usuário não controla NÃO DEVE ser desenhado de forma
  degradada (esmaecido, dessaturado ou parcial) por causa disso: ou o token chega e é desenhado
  como qualquer outro, ou não chega (REQ-TOK-051).

### 5.10 Cópia e exclusão

- **REQ-TOK-090** [MVP] Duplicar um token DEVE oferecer dois modos: **cru** (estado vivo zerado) e
  **idêntico** (estado vivo preservado), conforme DEC-TOK-14.
- **REQ-TOK-091** [MVP] Ao duplicar um token **vinculado**, os dois modos DEVEM produzir o mesmo
  resultado, e a interface NÃO DEVE oferecer uma escolha sem efeito.
- **REQ-TOK-092** [MVP] Excluir um token NÃO DEVE alterar o ator que ele manifestava.
- **REQ-TOK-093** [MVP] Excluir um **ator** DEVE remover todos os tokens dele, em todas as cenas
  do mundo, emitindo o broadcast de cada cena afetada (DEC-TOK-17).
- **REQ-TOK-094** [MVP] Nenhuma regra desta spec DEVE remover um token por consequência de estado
  do ator — morte, fuga ou perda de faceta (DEC-TOK-17).
- **REQ-TOK-095** [MVP] Um ator que ganha ou perde faceta em jogo NÃO DEVE ter seus tokens
  recriados, substituídos ou reidentificados (REQ-ATR-070).

### 5.11 Extensão e persistência

- **REQ-TOK-100** [MVP] O token DEVE aceitar dado próprio de sistema em `flags`, sob namespace
  (REQ-DOC-009), e a engine NÃO DEVE interpretar o conteúdo desse namespace (DEC-TOK-20).
- **REQ-TOK-101** [MVP] O token DEVE declarar `vision` e `light` como campos inertes: presentes no
  modelo, sem comportamento definido por esta spec (DEC-TOK-18).
- **REQ-TOK-102** [MVP] O campo de visão do token DEVE chamar-se `vision`; a grafia `sight` NÃO
  DEVE ser usada (REQ-VIS-093).
- **REQ-TOK-103** [MVP] O token DEVE permanecer embutido na cena; a revisão dessa forma fica
  condicionada ao gatilho de DEC-TOK-21.

### 5.12 Abrir a ficha pela peça _(emenda de 2026-08-23, DEC-TOK-22)_

- **REQ-TOK-110** [MVP] Dois cliques sobre uma peça, próximos no tempo, DEVEM abrir a ficha do ator
  efetivo dela; um clique isolado DEVE continuar significando apenas seleção (REQ-CNV-034), e um
  toque que virou arraste NÃO DEVE contar como metade do gesto.
- **REQ-TOK-111** [MVP] O gesto DEVE exigir a **mesma** permissão do movimento (REQ-TOK-032): papel
  privilegiado ou OWNER sobre o ator efetivo; NÃO DEVE existir régua própria de "ver ficha"
  (REQ-TOK-034, DEC-TOK-06).
- **REQ-TOK-112** [MVP] A ficha aberta pelo gesto DEVE mostrar o **ator efetivo** daquela peça —
  nunca o ator-base quando há delta (REQ-CNV-094, REQ-DOC-033).
- **REQ-TOK-113** [MVP] A janela aberta a partir de peça **desvinculada com delta** DEVE ser
  identificada pela **peça**, não pelo ator (REQ-CNV-094), e DEVE abrir sem escrita enquanto
  REQ-DOC-034 (`token:updateActor`) não existir; NÃO DEVE, em nenhuma hipótese, gravar a edição no
  ator-base (DEC-TOK-22).
- **REQ-TOK-114** [MVP] O gesto DEVE estar ligado à cena que está no ar — não basta existir como
  função: a peça na tela DEVE ser o gatilho (REQ-UIF-046 e a lição do #194, em que a interação com
  peças existia em código e não estava instanciada em tela alguma).

## 6. Requisitos não-funcionais

- **RNF-TOK-01** A resolução de arte, footprint, nome e vida a partir do ator efetivo DEVE usar
  **uma única** função compartilhada entre servidor e cliente; uma segunda implementação em
  qualquer das pontas é defeito, não otimização.
- **RNF-TOK-02** Toda regra de redação desta spec (ocultação, nome, vida) DEVE passar pelo mesmo
  funil de redação do servidor, sem caminho de emissão que a ignore.
- **RNF-TOK-03** Uma decisão desta spec que mude vira **nova decisão** com nota do que substitui;
  a antiga não é apagada sem rastro.

## 7. Modelo de dados

### 7.1 O documento

```ts
export interface TokenDocument {
  _id: DocumentId;
  actorId: DocumentId; // obrigatório — REQ-TOK-002
  x: number;
  y: number;
  rotation: number;
  elevation: number;

  actorLink: boolean;
  actorDelta: ActorDeltaPatch | null; // só quando actorLink = false

  name: string | null; // rótulo próprio; null = herda do ator
  disposition: -1 | 0 | 1 | null; // null = herda do ator
  hidden: boolean;
  seenBy: DocumentId[]; // exceções à ocultação — REQ-TOK-050

  bar1: { attribute: string | null };
  bar2: { attribute: string | null };

  vision: TokenVisionConfig; // inerte — REQ-TOK-101
  light: TokenLightConfig; // inerte — REQ-TOK-101

  flags: FlagsRecord; // extensão namespaced — REQ-TOK-100
}
```

Campos que **deixam de existir** em relação ao que a `02` descreve hoje: `img`, `width`, `height`,
`displayName`, `locked`, `alpha`, `ownership` — e, do que a `06` descreve, `textureSrc`, `scale`,
`tint`, `mirrorX`, `mirrorY`, `displayBars`. `sight` é renomeado para `vision`.

### 7.2 Contrato de invocação

**Obrigatório — sem isto não há token:**

| Dado      | Por quê                                              |
| --------- | ---------------------------------------------------- |
| `actorId` | quem está sendo manifestado; nulo DEVE ser recusado. |
| `x`, `y`  | onde.                                                |
| cena      | vem do embedding, não do payload.                    |

**Aceito como sobrescrita — se ausente, herda:**

| Dado                    | Herda de                                               |
| ----------------------- | ------------------------------------------------------ |
| `actorLink`             | default por subtype (REQ-DOC-061), configurável depois |
| `hidden`, `seenBy`      | default visível — a emboscada sobrescreve              |
| `disposition`           | do ator                                                |
| `name`                  | do ator, com a numeração de DEC-TOK-16                 |
| `rotation`, `elevation` | zero                                                   |
| `vision`, `light`       | do ator                                                |
| `bar1`, `bar2`          | do sistema (REQ-SYS-004)                               |

**Derivado — o servidor calcula e NÃO aceita do requisitante:**

| Dado      | Regra                                         |
| --------- | --------------------------------------------- |
| footprint | do ator, convertido pelo sistema (DEC-TOK-03) |
| arte      | do ator efetivo — o campo nem existe          |
| posse     | não existe no token; deriva do ator           |

**Recusado explicitamente:**

| Dado         | Por quê                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `actorDelta` | só entra pelo caminho de mutação do TokenActor (REQ-DOC-034), nunca na criação |

### 7.3 As três camadas de exibição

| Camada      | Quem decide | O que decide                                       | Onde vive        |
| ----------- | ----------- | -------------------------------------------------- | ---------------- |
| Redação     | servidor    | se o token chega; se o nome chega; se a vida chega | `21`, `39`, aqui |
| Documento   | a peça      | posição, vínculo, rótulo, ocultação                | aqui             |
| Preferência | usuário     | se nome e barra são desenhados na cena             | `37`             |

A ordem é estrita: a preferência opera **sobre** o que a redação emitiu, e nunca ao contrário.

## 8. Dependências

| Spec | O que esta spec depende dela                                                                  |
| ---- | --------------------------------------------------------------------------------------------- |
| `45` | O que é ator, facetas, e o que a presença herda (REQ-ATR-070..073).                           |
| `02` | Forma do embedded, `actorLink`, `actorDelta`, default por subtype, redação do delta.          |
| `06` | Pipeline de render, snapping multi-célula, borda por disposição, indicador de elevação.       |
| `39` | Modelo de conhecimento e o estado efetivo do usuário (REQ-CTT-070/071).                       |
| `05` | Escala de posse e papel privilegiado (REQ-USR-013).                                           |
| `04` | Eventos de movimento e a redação nos quatro caminhos de emissão (REQ-NET-096).                |
| `15` | Declaração de barras pelo sistema e, por emenda, a conversão de tamanho em células.           |
| `21` | Política de redação por papel (REQ-SEC-020) — em particular a do nome, que esta spec não faz. |
| `37` | Hospeda o setting de mundo da numeração e as preferências de exibição do usuário.             |
| `03` | Forma persistida embutida (DEC-PER-02) e o adiamento herdado por DEC-TOK-21.                  |

## 9. Critérios de aceitação

- **CA-TOK-001** Trocar a arte de um ator com três tokens em duas cenas muda o desenho dos três,
  sem nenhuma escrita em token.
- **CA-TOK-002** Um ator Grande do PF2e posto na cena ocupa 2×2 células, e nenhum campo de
  largura foi enviado na criação.
- **CA-TOK-003** Uma criação com `actorId` nulo é recusada pelo servidor com erro explícito.
- **CA-TOK-004** Uma criação que traga `actorDelta` no payload é recusada, e existe teste que
  reproduz a tentativa.
- **CA-TOK-005** Um jogador OWNER do próprio personagem tenta pôr o token dele na cena e é
  recusado; o Mestre faz o mesmo e é aceito.
- **CA-TOK-006** Esse mesmo jogador move o token do seu personagem pelas setas e pelo arraste, e
  é recusado ao tentar mover o token de um NPC.
- **CA-TOK-007** Um token de armadilha oculto com exceção para um jogador não aparece no payload
  recebido pelos demais, em snapshot de join, broadcast, replay e eco de ack.
- **CA-TOK-008** Um usuário cujo maior estado de conhecimento sobre um NPC é `entrevisto` recebe
  o token e a arte dele, e **não** recebe o nome.
- **CA-TOK-009** Esse mesmo usuário passa a `conhecido` e o nome aparece nos tokens já em cena,
  sem que nenhum token tenha sido escrito.
- **CA-TOK-010** Um jogador não vê a barra de vida do NPC nem a do personagem de outro jogador, e
  vê a do seu; o Mestre vê todas.
- **CA-TOK-011** Desligar a exibição de barras nas preferências não altera um byte do payload
  recebido.
- **CA-TOK-012** Seis tokens desvinculados do mesmo ator têm vidas independentes; dois tokens
  vinculados do mesmo ator mostram a mesma vida, e o dano num aparece no outro.
- **CA-TOK-013** Duplicar um token desvinculado ferido em modo cru produz um token com vida
  cheia; em modo idêntico, com a mesma vida. Duplicar um token vinculado oferece um gesto só.
- **CA-TOK-014** Uma criatura morre, ganha a faceta `container` e continua sendo o mesmo token, no
  mesmo lugar, com o mesmo `_id`.
- **CA-TOK-015** Excluir um ator presente em três cenas remove os três tokens e emite broadcast
  das três cenas.
- **CA-TOK-016** Dois tokens na mesma célula desenham na ordem de criação, e a ordem é a mesma em
  dois clientes distintos.
- **CA-TOK-017** Com a numeração ligada, seis esqueletos nascem "Esqueleto 1..6"; morto o 3, o
  próximo nasce "Esqueleto 7".
- **CA-TOK-018** Nenhum token na tela aparece esmaecido por não ser controlável pelo usuário.
- **CA-TOK-019** Um sistema grava dado próprio em `flags` de um token, e nenhum caminho da engine
  lê esse namespace.

## 10. Questões em aberto

- **Q-TOK-01** O que o gesto de cópia faz num token **vinculado**: colapsa nos dois modos num só
  (REQ-TOK-091) ou recusa o modo cru com explicação? _Posição atual: colapsa — oferecer uma escolha
  sem efeito é pior que não oferecer._
- **Q-TOK-02** A numeração de DEC-TOK-16 é por cena ou por mundo? _Posição atual: por cena, que é
  onde a mesa lê os nomes; falta confirmar contra o caso do mesmo grupo de esqueletos perseguindo
  os jogadores por três salas._
- **Q-TOK-03** Token sem ator ("token rápido") volta como ator descartável ou como exceção no
  modelo? _Posição atual: ator descartável (DEC-TOK-04). Enquanto não voltar, o `TokenAddDialog`
  precisa exigir ator._
- **Q-TOK-04** A remoção de visão, névoa e colisão vale para o projeto inteiro ou só para esta
  spec? _Posição atual: só para esta spec. Estendê-la emenda `00`, `07`, `27` e o `CLAUDE.md`, e
  transforma dois defeitos abertos em código a remover — é decisão de escopo do projeto._
- **Q-TOK-05** Quem é dona da marcação de alvo? Hoje REQ-CNV-039 e as regras de combate
  especificam o mesmo gesto sem citação cruzada, e alvo marcado fora de combate não tem dona.
- **Q-TOK-06** Um token vinculado e outro desvinculado do mesmo ator na mesma cena é caso legítimo
  ou defeito de configuração? _Posição atual: legítimo — REQ-TOK-003 não o proíbe —, mas a mesa
  não tem como distinguir os dois na tela._

## 11. Referências

- `specs/45-atores.md` — REQ-ATR-070..073, DEC-ATR-03, DEC-ATR-05, DEC-ATR-09, DEC-ATR-14.
- `specs/02-modelo-de-dados.md` — REQ-DOC-009, REQ-DOC-025, REQ-DOC-031..035, REQ-DOC-061,
  REQ-DOC-062, DEC-DOC-08, DEC-DOC-11.
- `specs/06-canvas-e-renderizacao.md` — REQ-CNV-023, REQ-CNV-025..033, REQ-CNV-039, REQ-CNV-041,
  REQ-CNV-089..093, DEC-CNV-07, DEC-CNV-15.
- `specs/39-contatos.md` — DEC-CTT-03, DEC-CTT-04, REQ-CTT-070..076.
- `specs/04-rede-e-sincronizacao.md` — REQ-NET-024, REQ-NET-044, REQ-NET-096.
- `specs/07-visao-iluminacao-fog.md` — REQ-VIS-093, DEC-VIS-02.
- `specs/40-aba-combate.md` — DEC-CBA-06, Q-CBA-02.
- `docs/design/spec-41-token/decisoes.md` — o registro da sessão de decisão que originou esta
  spec, com o racional completo de cada uma.
- `docs/design/spec-41-token/prototipo-token.html` — protótipo executável do modelo, com um
  contrato de 19 expectativas verificadas contra ele.

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2). Nenhum id é renumerado: a regra `id-unico` proíbe, e os ids abaixo já são
citados por código e teste.

| Spec            | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`     | A linha `REQ-TOK-` entra no registro de prefixos e o item "41" sai da lista de números reservados. Sem isso o `spec-lint` reprova a definição de qualquer id desta spec.                                                                                                                                                                                                                                                                                                  |
| `02`            | `TokenData` perde `img`, `width`, `height`, `displayName`, `locked`, `alpha`; `sight` vira `vision`; `actorId` deixa de ser anulável; entram `seenBy` e `disposition` anulável. A tabela de campos passa a ser desta spec (§7.1) — o resto do documento segue dono da forma de Document.                                                                                                                                                                                  |
| `06`            | **REQ-CNV-025** perde a textura de sujeito e a `scale`; **REQ-CNV-026** perde `alpha`, `tint`, `mirrorX`, `mirrorY`; **REQ-CNV-027** perde `secret`; **REQ-CNV-029** perde a base e é aposentado (DEC-TOK-19); **REQ-CNV-031** e **REQ-CNV-089** perdem os cinco níveis; **REQ-CNV-041** passa de [V2] a [MVP] com dois modos e deixa de ser só gesto de arraste. **DEC-CNV-07** perde a metade da escala visual independente; **DEC-CNV-15** é revertida por DEC-TOK-10. |
| `39`            | **DEC-CTT-04** e **REQ-CTT-041** deixam de incluir o **retrato** na redação de payload de contato `entrevisto`: a arte viaja, o nome não. A silhueta no cartão de contato passa a ser escolha de apresentação daquela tela. Motivo em DEC-TOK-09 — sem isso, um token de contato `entrevisto` não pode ser desenhado.                                                                                                                                                     |
| `07`            | Nada muda na spec. Registra-se que esta spec **não** herda visão nem névoa, e que `vision`/`light` do token são declaração inerte até a `07` valer (DEC-TOK-18, Q-TOK-04).                                                                                                                                                                                                                                                                                                |
| `09`            | **REQ-CHT-022** resolve hoje o falante de uma mensagem por "token controlado pelo usuário na cena ativa". Quem fala é o **jogador**, nunca a peça: o requisito precisa ser reescrito, e os chat bubbles que existem para aparecer acima da peça de quem falou perdem a âncora. Não é decisão desta spec — é sinalização para a `09`.                                                                                                                                      |
| `15`            | Ponto de extensão novo: o sistema declara o mapeamento **tamanho → células** (DEC-TOK-03). A engine não arbitra, na mesma disciplina de REQ-SYS-004.                                                                                                                                                                                                                                                                                                                      |
| `20`            | **REQ-AST-043** passa a dizer que o `AssetRef` de arte de criatura vive no `Actor`, nunca no token (DEC-TOK-02).                                                                                                                                                                                                                                                                                                                                                          |
| `37`            | Hospeda o **setting de mundo** da numeração (DEC-TOK-16) e as **duas preferências de usuário** de exibição de nome e barras (REQ-TOK-074).                                                                                                                                                                                                                                                                                                                                |
| `42`            | **REQ-NPC-061** ainda diz que o baú NÃO DEVE ser ator, contra a DEC-ATR-09 da `45`, que decidiu o oposto. A emenda é da `45`; esta spec apenas registra que depende dela para que o baú tenha token.                                                                                                                                                                                                                                                                      |
| `06`            | **REQ-CNV-094** já dizia o que a ficha aberta a partir de um token mostra e como identifica a janela; ganha agora o **gesto** que a abre (REQ-TOK-110) e o registro de que, sem REQ-DOC-034, a ficha de peça desvinculada com delta abre em leitura (REQ-TOK-113) — emenda registrada em 2026-08-23 por DEC-TOK-22. Nada em REQ-CNV-094 é revogado.                                                                                                                       |
| `23`            | A linha `Double-tap em token → Abrir sheet do token`, hoje [MVP-stretch] na tabela de gestos de toque, deixa de ser a única menção ao gesto no corpo de specs: o gesto passa a ser [MVP] por REQ-TOK-110 no ponteiro/mouse, e a linha da `23` segue valendo apenas para o **equivalente em toque**, que continua [MVP-stretch] — emenda registrada em 2026-08-23.                                                                                                         |
| `44`, `45`      | As citações de "presença na cena" permanecem válidas e passam a apontar para esta spec (DEC-TOK-01). Nenhum requisito delas muda.                                                                                                                                                                                                                                                                                                                                         |
| `CONVENCOES.md` | O item "41 — Token" sai de §7 (lacunas conhecidas). A lacuna **Ficha de não-jogável** e a **API de Módulos** continuam abertas.                                                                                                                                                                                                                                                                                                                                           |
