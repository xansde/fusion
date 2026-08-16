# 42 — Aba NPCs

- **Título:** Aba NPCs — a casa dos não-jogáveis: criar, organizar e pôr em cena
- **Status:** draft v0.1 (grill concluído em 2026-08-16, três rodadas)
- **Data:** 2026-08-16
- **Baseada em:**
  - `36-gaveta-lateral.md` — spec-mãe; §7 fixa o contrato que esta filha cumpre, e a DEC-GAV-01 batizou a aba.
  - `39-contatos.md` — spec-irmã que **transferiu escopo para cá** (DEC-CTT-01 e §2.2) e de quem esta spec herda o contrato de condição, o encapsulamento de sub-personagem, o título livre e a janela única de conhecimento.
  - `02-modelo-de-dados.md` — `Actor`, `Folder`, `ownership`, subtipos (REQ-DOC-018, REQ-DOC-023, REQ-DOC-028) e a disciplina de redação no servidor (REQ-DOC-058).
  - `16-compendiums-e-importacao.md` — busca e importação de pack (REQ-CMP-013/016/021), que esta aba **consome** em vez de duplicar.
  - `29-pets-companions-familiars.md` — `masterActorId` (REQ-PET-002), o vínculo do sub-personagem.
  - Protótipo `packages/client/prototypes/npcs-tab.prototype.html` — estado decidido, 2026-08-16 (as três variantes iniciais e a rodada 2 estão no histórico do arquivo).

> **Spec-filha da 36.** Esta spec é dona do **painel** da aba NPCs e da **autoria de
> não-jogáveis**: criar, excluir, organizar em pastas e pôr em cena. Ela não define
> largura, posição, gesto de recolher nem persistência de `open`/`activeTab` — tudo isso
> é da 36. E não redefine `Actor`, `Folder`, `ownership`, condição, importação de pack
> nem ficha: isso é das specs 02, 15, 16 e da futura spec de ficha de NPC, que ela cita.

---

## 1. Objetivo

Dar ao Mestre o lugar onde os não-jogáveis do mundo nascem, se organizam e entram em
cena — e só isso. É a aba que paga a dívida que a spec 39 declarou ao tirar "criar" e
"excluir" da lista do jogador, sem trazer de volta o diretório de documentos que ela
matou.

## 2. Escopo

### 2.1 Inclui

- A composição do painel: busca, árvore de **pastas**, linha do não-jogável e rodapé.
- **Criar** e **excluir** não-jogável, com as duas portas de criação (bestiário e do zero).
- As **pastas**: criar, renomear, aninhar, excluir e **fixar** no topo.
- **Mover** um não-jogável entre pastas, pelos dois caminhos.
- A **atitude** do não-jogável diante da party.
- O **baú** posto direto na cena, e por que ele não é ator.
- A leitura do **conhecimento** na linha, e o caminho até a janela que o edita.

### 2.2 Não inclui

- O contêiner (trilho, gaveta, largura, gesto de recolher, badges) → `36-gaveta-lateral.md`.
- O modelo de `Actor`, `Folder` e `ownership` → `02-modelo-de-dados.md`.
- **Criar personagem de jogador** → `37-configuracoes.md`, seção Usuários (DEC-NPC-02).
- **Excluir personagem de jogador** → nenhuma tela, hoje, e isso é aceito (Q-NPC-06).
- O **modelo de conhecimento** e a janela "Quem conhece quem" → `39-contatos.md`
  (REQ-CTT-060..076); esta aba só lê e abre.
- O que é uma condição e quem a aplica → `15-api-de-sistemas.md` e a spec do sistema.
- O **browser de compêndio** como tela, os filtros e o mecanismo de importação →
  `16-compendiums-e-importacao.md`; esta aba consome (DEC-NPC-06).
- A **ficha** do não-jogável → spec futura própria (DEC-NPC-13).
- O que é uma **presença na cena** (vinculada, desvinculada, seus dados) → spec `41`
  (Token), reservada e ainda não escrita.
- A política de redação de payload por papel → `21-seguranca.md` (REQ-SEC-020); aqui só
  se nomeia o que **não pode sair**.

## 3. Conceitos e terminologia

| Conceito             | Definição                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Não-jogável**      | ~~Ator que não é personagem de jogador.~~ Termo **retirado** pela `45` (DEC-ATR-06). Esta aba lista os atores com a faceta `creature` ou `hazard`.                 |
| **Pasta**            | Document `Folder` (REQ-DOC-018), hierárquico por `parentId`. Organização de autoria, do mundo — não é a categoria do jogador.                                      |
| **Pasta fixada**     | Pasta que o usuário mandou subir para o topo do painel. Fixar é estado de exibição, não muda a pasta.                                                              |
| **Preset**           | Escolha feita **na criação** que pré-preenche a ficha do novo ator e não fica gravada nele (mercador, montaria, chefe).                                            |
| **Atitude**          | Postura do não-jogável diante dos jogadores: `inimigo`, `neutro` ou `aliado`. Vale para a **party inteira**.                                                       |
| **Baú**              | Recipiente posto direto na cena como atalho de narração. **É ator** com a faceta `container` (`ver 45-atores.md`, DEC-ATR-09) e continua não aparecendo nesta aba. |
| **Presença na cena** | A manifestação de um ator numa cena. O termo evita "token", cujo conceito só será definido pela spec `41`.                                                         |
| **Sub-personagem**   | Ator vinculado a outro por `masterActorId` (REQ-PET-002), exibido dentro da linha do dono.                                                                         |

## 4. Decisões

### DEC-NPC-01 — Esta aba é a autoria dos não-jogáveis, e é ela que paga a dívida da DEC-CTT-01

A spec 39 tirou "+Novo" e "excluir" da aba Contatos e registrou, com todas as letras, que
o cliente ficaria **sem nenhuma forma de criar ou excluir ator** até esta aba existir. É
aqui que criar e excluir voltam a ter endereço — mas **só para não-jogáveis**.

- **Racional:** a 39 §2.2 nomeou o que é desta aba (diretório de não-jogadores, pastas,
  autoria, subtipos, importação). Trazer personagem junto ressuscitaria o diretório de
  documentos que a DEC-GAV-01 recusou ao rebatizar "Atores" como Contatos.
- **A dívida fica paga pela metade, e de propósito:** criar personagem passa a ser da 37
  (DEC-NPC-02); **excluir personagem continua sem tela nenhuma**, e isso é aceito por ora
  (Q-NPC-06).

### DEC-NPC-02 — Personagem não nasce aqui: nasce colado ao player

Criar um player cria, junto, **um personagem em branco associado a ele**. Esta aba não
oferece criar personagem em lugar nenhum.

- **Racional:** "a aba é de NPC, ou seja, personagens NÃO jogáveis; aqui não é a casa de
  personagens". E personagem sem dono é documento órfão: ninguém o opera, ninguém o vê na
  aba Contatos, que lista por plateia. Nascer com o player resolve criação e `ownership`
  no mesmo gesto.
- **O que isso obriga:** emenda em REQ-CFG-051 e REQ-USR-025 — ver §12.
- **Segundo personagem:** um jogador com dois personagens é caso previsto pela 39
  (CA-CTT-010), mas o gesto de criar o segundo fica **[V2]** (REQ-NPC-055a).

### DEC-NPC-03 — Diretório de pastas, com pastas fixáveis; fixar é reversível sem resíduo

O painel é uma árvore de pastas de verdade (`Folder`, servidor), que o Mestre cria,
renomeia, aninha e exclui. Ele pode **fixar** pastas: as fixadas sobem para um bloco
próprio no topo, **fora do lugar delas na árvore**, exibindo o caminho da pasta-mãe.

- **Desafixar devolve a pasta à ordenação que ela teria se nunca tivesse sido fixada.**
  Nenhuma posição anterior é guardada, e não existe "última posição" a restaurar.
- **Onde mora a fixação:** no cliente, por mundo e usuário — a mesma fronteira de
  DEC-UIF-10 e o mesmo precedente da DEC-CTT-08. Fixar é curadoria de quem olha, não
  autoria do mundo, e por isso **não altera o document `Folder`**.
- **Racional:** a árvore é o que sobrevive a centenas de atores importados; a fixação é o
  que impede que o Mestre tenha que caçar as três pastas que ele usa toda sessão dentro
  de uma árvore que cresce sozinha (REQ-CMP-018 importa para o mundo durante o jogo).

### DEC-NPC-04 — Mover tem dois caminhos, e os dois são obrigatórios

Mover um não-jogável de pasta acontece por **arraste** sobre a pasta de destino **e** por
um controle explícito na própria linha. Não é um ou outro.

- **Racional:** o arraste é o gesto curto de quem está com o mouse na mão; o controle
  explícito é o único caminho que existe para teclado e toque (REQ-UIF-064, spec 23).
  Escolher só um deles exclui metade das formas de operar a mesa.

### DEC-NPC-05 — A aba cria `npc` e `hazard`; o resto entra por outra porta — e veículo não existe

O sistema pf2e declara `character`, `npc`, `hazard`, `loot` e `familiar`
(`systems/pf2e/src/index.ts`). A janela de criação oferece **apenas `npc` e `hazard`**.

- `character` → nasce com o player (DEC-NPC-02).
- `familiar` → nasce colado a um dono, por `masterActorId` (REQ-PET-002).
- `loot` → é o baú, que não é ator desta aba (DEC-NPC-08, Q-NPC-04).
- **Veículo não existe no Fusion.** Não é subtipo cortado: nunca foi declarado por sistema
  nenhum e não aparece em lugar algum do repositório. Fica registrado para que ninguém o
  reintroduza achando que foi esquecimento.
- **Consequência de contrato:** a aba **não** pinta todo subtipo que o sistema declara —
  ela declara quais subtipos são autorais aqui. É a diferença entre esta lista e a de
  condições (DEC-CTT-11), onde quem manda é a declaração do sistema.

### DEC-NPC-06 — Criar tem duas portas na mesma janela: do bestiário ou do zero

A janela de criação abre com dois caminhos lado a lado: **do bestiário**, com busca sobre
os packs de ator, e **do zero**, com subtipo e nome.

- **Racional:** a pergunta real do Mestre é "me dá um goblin", não "eu já importei este
  goblin?". Obrigá-lo a sair da aba, achar o Compêndio, importar e voltar é três telas
  para uma intenção.
- **Sem segundo importador:** a importação é a da spec 16 (REQ-CMP-016, REQ-CMP-021),
  consumida daqui. A aba Compêndio continua sendo a **fonte** e a tela de navegação
  completa; esta aba é o **destino** e oferece só a busca por nome (REQ-CMP-013).

### DEC-NPC-07 — "Tipo de NPC" é preset de criação, não capacidade do ator

Mercador, montaria, chefe e afins **pré-preenchem a ficha** do ator que está sendo criado
e **não ficam gravados** nele.

- **Consequência visível:** não há etiqueta de "mercador" na lista, porque não há nada
  gravado para etiquetar. O preset só existe dentro da janela de criação.
- **Racional:** preset é atalho de autoria; capacidade seria contrato de sistema, com
  estoque de mercador e conteúdo de baú a modelar. Nada disso é necessário para a aba
  funcionar, e assumir o contrato agora comprometeria a futura spec de ficha de NPC.
- **Os presets ainda não existem, e vão existir.** Esta spec fixa o **conceito** e o
  **ponto de extensão** (REQ-NPC-048), não o catálogo. Quem declara o catálogo é Q-NPC-02.

### DEC-NPC-08 — Baú é ferramenta de narração, e não entra no diretório

O rodapé oferece pôr um **baú** direto na cena ativa. O baú não aparece no diretório, na
busca, em contagem alguma nem na janela de conhecimento.

> **Emendada pela `45`** (DEC-ATR-09): o baú **é ator**, com a faceta `container`. O que
> esta decisão recusou — e continua recusando — é o baú **no diretório**, com o cerimonial
> de autoria descrito abaixo. Ausência de aba não é ausência de registro.

- **Racional:** "é uma ferramenta para ajudar na agilidade do GM narrar". Um baú que
  virasse ator entraria na árvore de pastas, pediria pasta, atitude e conhecimento — todo
  o cerimonial de autoria — para uma coisa cuja vida útil é a cena em que foi posta.
- **Ponta solta, resolvida:** o pf2e declara o subtipo `loot`, que é exatamente o
  recipiente — ele é o subtype de faceta `container` (Q-NPC-04, fechada). O conteúdo do baú
  vive em `items`, como o de qualquer ator (Q-NPC-05, fechada). Quem pode **abrir** um
  recipiente é da spec `46`, não desta.

### DEC-NPC-09 — Atitude é atributo do ator e vale para a party inteira

Cada não-jogável pode ter uma atitude diante dos jogadores: `inimigo`, `neutro` ou
`aliado`. É **uma só para toda a party** — não existe atitude por personagem.

- **O contraste com a 39, que é o ponto:** conhecimento é do **par** contato × personagem
  (DEC-CTT-03), porque o Tobias pode conhecer o ferreiro enquanto a Fofurinha só o
  entreviu. Atitude não tem esse problema: o ferreiro é hostil **ao grupo**, não a um
  personagem. Duas granularidades diferentes, cada uma pelo que o dado realmente é — e
  fazer atitude por personagem custaria uma segunda grade que ninguém pediu.
- **Onde se edita:** na própria linha, percorrendo os três valores a cada acionamento —
  o mesmo gesto da célula da grade da 39 (REQ-CTT-062), para não ensinar dois hábitos.
- **Atributo simples, consumo futuro.** Ela ainda não muda nada no jogo; passa a importar
  quando combate e comportamento a consumirem. Está aqui agora porque é o Mestre quem a
  preenche, e é aqui que ele está.
- **Nem todo não-jogável tem:** perigo não tem atitude, e nesse caso nada é exibido.

### DEC-NPC-10 — Vida não aparece aqui, e por um motivo diferente do da 39

Nenhum ponto de vida, barra, fração ou percentual aparece nesta aba.

- **Racional próprio:** a 39 (DEC-CTT-02) barrou vida por metagame e ficção, argumento que
  não se aplica a uma aba só-Mestre. O motivo aqui é outro e mais duro: quando a presença
  na cena não é vinculada ao ator (REQ-DOC-033), a vida do ator-base é **molde**, não valor
  vivo — os cinco goblins no mapa têm cada um a sua. Exibir "a vida do ator" seria exibir
  um número que não descreve ninguém.
- **A vida de criatura continua existindo onde ela é verdade:** na aba Combate, para o
  Mestre (spec 40), e na ficha.

### DEC-NPC-11 — Revelar continua num lugar só

A linha **lê** o conhecimento (quantos conhecem, quantos entreviram) e não oferece
controle algum que o altere. Alterar é só na janela "Quem conhece quem" (REQ-CTT-061),
alcançável pelo rodapé desta aba e pelo da aba Contatos — a **mesma** janela.

- **Racional:** é a DEC-CTT-05 aplicada, e o preço dela é conhecido: o gesto natural do
  Mestre ("criei o NPC → a mesa encontrou → revelo") passa por um desvio. Aceito, porque
  a alternativa — um "revelar a todos" na linha — recria o segundo lugar de edição que a
  39 matou, e desalinha as duas telas na cabeça de quem opera as duas.

### DEC-NPC-12 — Excluir mostra o que cai junto, e é recusado com combate ativo

A exclusão de um não-jogável exibe antes o que será removido com ele — presenças em cena,
conhecimento gravado, ficha e itens embutidos — e é **recusada** enquanto o ator
participar de um combate ativo.

- **Racional:** apagar um ator apaga coisas que estão em outras telas; a recusa em combate
  evita arrancar um combatente da fila no meio do turno de alguém.
- **Preenche uma lacuna real:** a REQ-CTT-076 cobriu só o caso espelho (excluir personagem
  remove as exceções que o citam). Excluir não-jogável não estava em spec nenhuma.

### DEC-NPC-13 — A ficha do não-jogável não é definida aqui

A aba abre a ficha em janela flutuante e não diz nada sobre o conteúdo dela.

- **Racional:** a ficha de não-jogável será **muito mais maleável** que a de personagem, e
  merece spec própria. Definir qualquer parte dela aqui criaria uma segunda dona.

## 5. Requisitos funcionais

> Blocos de dezena: 001–009 identidade e badge; 010–019 cabeçalho, busca e ordem; 020–029
> pastas e mover; 030–039 linha do não-jogável e atitude; 040–049 criação; 050–059
> exclusão; 060–069 baú e presença na cena; 070–079 conhecimento; 080–089 permissão e
> redação; 090–099 estado vazio e acessibilidade. Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-NPC-001** [MVP] A aba DEVE se registrar por `registerSidebarTab` (REQ-GAV-030) com
  `id: "npcs"`, `group: "gm"`, ícone próprio e rótulo por chave i18n, na primeira posição
  do grupo GM (REQ-GAV-003).
- **REQ-NPC-002** [MVP] A aba NÃO DEVE fornecer badge algum — nem contador, nem ponto de
  estado (REQ-GAV-020). Nada acontece nela que não tenha sido o próprio Mestre que fez.
- **REQ-NPC-003** [MVP] A aba NÃO DEVE ser renderizada para usuário sem papel privilegiado
  (REQ-GAV-004); esconder NÃO é proteção (REQ-GAV-034), e toda escrita é verificada no
  servidor (REQ-NPC-080).

### 5.2 Cabeçalho, busca e ordem

- **REQ-NPC-010** [MVP] O painel DEVE exibir no topo uma barra fixa com um campo de busca
  ocupando a largura disponível e um controle de criação, sem título textual da aba e sem
  ✕ (DEC-GAV-03).
- **REQ-NPC-011** [MVP] A busca DEVE filtrar por **nome e título**, no cliente.
- **REQ-NPC-012** [MVP] Durante a busca, pasta sem resultado DEVE desaparecer e pasta com
  resultado DEVE ser exibida expandida; limpar o campo DEVE devolver a árvore ao estado de
  recolhimento anterior.
- **REQ-NPC-013** [MVP] Dentro de cada pasta, os não-jogáveis DEVEM ser ordenados
  alfabeticamente com `localeCompare` em pt-BR.
- **REQ-NPC-014** [MVP] Não-jogáveis sem pasta DEVEM ser exibidos em um grupo **"Sem
  pasta"**, sempre por último, que NÃO DEVE ser renomeável nem excluível.

### 5.3 Pastas e mover

- **REQ-NPC-020** [MVP] O painel DEVE exibir os não-jogáveis do mundo em árvore de pastas,
  usando o document `Folder` (REQ-DOC-018) e sua hierarquia por `parentId`.
- **REQ-NPC-021** [MVP] Papel privilegiado DEVE poder criar, renomear, aninhar e excluir
  pasta a partir do painel.
- **REQ-NPC-022** [MVP] Excluir uma pasta NÃO DEVE excluir ator algum: seus atores DEVEM
  ir para "Sem pasta" e suas subpastas DEVEM subir para o nível da pasta excluída.
- **REQ-NPC-023** [MVP] O usuário DEVE poder **fixar** e desafixar uma pasta; as fixadas
  DEVEM ser exibidas em um bloco próprio no topo do painel, fora da posição delas na
  árvore, com o caminho da pasta-mãe quando houver.
- **REQ-NPC-024** [MVP] Desafixar uma pasta DEVE devolvê-la à ordenação que ela teria se
  nunca tivesse sido fixada; nenhuma posição anterior DEVE ser guardada.
- **REQ-NPC-025** [MVP] A fixação DEVE ser gravada no cliente, por mundo e usuário
  (DEC-UIF-10), e NÃO DEVE alterar o document `Folder` nem ser visível a outro usuário.
- **REQ-NPC-026** [MVP] Cada pasta DEVE exibir a contagem de não-jogáveis da sua subárvore.
- **REQ-NPC-027** [MVP] O estado recolhido/expandido de cada pasta DEVE ser gravado no
  cliente por mundo e usuário, e sobreviver à troca de aba (REQ-GAV-017).
- **REQ-NPC-028** [MVP] Mover um não-jogável entre pastas DEVE ser possível por **arraste**
  sobre a pasta de destino (REQ-UIF-044) **e** por um controle explícito na própria linha,
  alcançável por teclado (REQ-UIF-064). Os dois caminhos DEVEM existir.
- **REQ-NPC-029** [MVP] "Sem pasta" DEVE ser destino válido dos dois caminhos de
  REQ-NPC-028.

### 5.4 Linha do não-jogável

- **REQ-NPC-030** [MVP] Cada não-jogável DEVE ser exibido em uma linha com retrato, nome,
  título (REQ-NPC-032), nível ou identificação equivalente do sistema, e atitude quando
  houver.
- **REQ-NPC-031** [MVP] A linha NÃO DEVE exibir pontos de vida em nenhuma forma — número,
  fração, barra ou percentual — para papel nenhum (DEC-NPC-10).
- **REQ-NPC-032** [MVP] A linha DEVE exibir sob o nome o **título** livre do ator
  (DEC-CTT-07), editável na própria linha por papel privilegiado, confirmando com `Enter` e
  cancelando com `Esc`; vazio, DEVE cair para subtipo e nível, visualmente distinto de um
  título preenchido.
- **REQ-NPC-033** [MVP] As condições ativas DEVEM ser exibidas pelo mesmo contrato da spec
  39 (REQ-CTT-030..038): tom declarado, ênfase de crítica, valor colado ao rótulo, ajuda em
  tooltip desenhado, ordem fixa, teto de duas etiquetas mais indicador, sem ícone. Esta
  spec NÃO redefine nada disso.
- **REQ-NPC-034** [MVP] Sub-personagens (REQ-PET-002, `masterActorId`) DEVEM ser exibidos
  **dentro** da linha do dono e NÃO DEVEM aparecer como item solto (DEC-CTT-06).
- **REQ-NPC-035** [MVP] O duplo-clique na linha DEVE abrir a ficha em janela flutuante
  (REQ-UIF-009), e cada linha DEVE oferecer um controle de ficha alcançável por teclado.
- **REQ-NPC-036** [MVP] A linha DEVE exibir quantas **presenças na cena** o ator tem, e em
  quais cenas, sem exibir dado algum da presença individual.

### 5.5 Atitude

- **REQ-NPC-037** [MVP] Um não-jogável PODE ter uma **atitude** — `inimigo`, `neutro` ou
  `aliado` — gravada no próprio ator e válida para toda a party; não-jogável sem atitude
  aplicável NÃO DEVE exibir indicação alguma.
- **REQ-NPC-038** [MVP] A atitude DEVE ser alterável na própria linha, percorrendo
  ciclicamente os três valores a cada acionamento, e DEVE ser operável por teclado.
- **REQ-NPC-039** [MVP] A atitude NÃO DEVE admitir exceção por personagem: ela é uma só
  para a party, ao contrário do conhecimento (DEC-CTT-03).

### 5.6 Criação

- **REQ-NPC-040** [MVP] A aba DEVE oferecer criar não-jogável a partir do cabeçalho do
  painel e do cabeçalho de cada pasta.
- **REQ-NPC-041** [MVP] A criação DEVE oferecer, na mesma janela, dois caminhos: **do
  bestiário** e **do zero**.
- **REQ-NPC-042** [MVP] O caminho do bestiário DEVE oferecer busca por nome sobre os packs
  de ator disponíveis (REQ-CMP-013) e importar o escolhido pelo mecanismo da spec 16
  (REQ-CMP-016, REQ-CMP-021); esta aba NÃO DEVE implementar um segundo importador.
- **REQ-NPC-043** [MVP] O caminho do zero DEVE pedir subtipo e nome.
- **REQ-NPC-044** [MVP] Os subtipos oferecidos DEVEM ser os que o sistema ativo declara
  com a faceta `creature` ou `hazard` (`ver 45-atores.md`, REQ-ATR-014) — o que inclui
  `familiar`, que **passa a ser oferecido e listado** (DEC-ATR-18). Subtipos de faceta
  `player` ou apenas `container` NÃO DEVEM ser oferecidos por esta aba (DEC-NPC-02,
  DEC-NPC-08).
- **REQ-NPC-045** [MVP] A criação PODE oferecer um **preset**, que pré-preenche a ficha do
  ator criado e NÃO DEVE ser gravado nele (DEC-NPC-07).
- **REQ-NPC-046** [MVP] Nenhuma tela DEVE exibir o preset de um ator já criado, nem
  permitir filtrá-lo por preset: não há preset gravado a exibir.
- **REQ-NPC-047** [MVP] A criação DEVE permitir escolher a pasta e a atitude iniciais do
  ator, e a criação a partir de uma pasta DEVE trazê-la pré-selecionada.
- **REQ-NPC-048** [V2] Um preset novo DEVE poder ser acrescentado sem alterar esta aba;
  quem declara o catálogo é Q-NPC-02.

### 5.7 Exclusão

- **REQ-NPC-050** [MVP] A aba DEVE permitir excluir um não-jogável, apenas a papel
  privilegiado.
- **REQ-NPC-051** [MVP] Antes de excluir, a aba DEVE exibir o que será removido junto: as
  presenças em cena (quantas e em quais cenas), o conhecimento gravado sobre o ator, e a
  ficha com seus itens embutidos.
- **REQ-NPC-052** [MVP] A exclusão DEVE ser **recusada** enquanto o ator participar de um
  combate ativo (REQ-CBT-001, REQ-CBT-002), e a recusa DEVE dizer o que fazer para
  destravar (REQ-CBT-003).
- **REQ-NPC-053** [MVP] Excluído o ator, todas as presenças dele nas cenas DEVEM ser
  removidas.
- **REQ-NPC-054** [MVP] Excluir um não-jogável DEVE remover o conhecimento gravado sobre
  ele — regra geral e exceções (REQ-CTT-070, REQ-CTT-072). É o caso espelho de REQ-CTT-076.
- **REQ-NPC-055** [MVP] A aba NÃO DEVE excluir personagem de jogador, em papel nenhum
  (DEC-NPC-02).
- **REQ-NPC-055a** [V2] O Fusion DEVE oferecer um caminho para criar um **segundo**
  personagem para um jogador que já tem um (CA-CTT-010); o gesto não é desta aba.

### 5.8 Baú e presença na cena

- **REQ-NPC-060** [MVP] O painel DEVE oferecer, no rodapé, um controle que põe um **baú** na
  cena ativa.
- **REQ-NPC-061** [MVP] O baú NÃO DEVE ser ator: NÃO DEVE aparecer no diretório desta aba,
  na busca, em contagem alguma nem na janela de conhecimento (DEC-NPC-08).
- **REQ-NPC-062** [MVP] O rodapé DEVE ser fixo: NÃO DEVE rolar com a lista, e DEVE conter o
  controle do baú e o que abre a janela de conhecimento (REQ-NPC-072).
- **REQ-NPC-063** [MVP] Arrastar uma linha para o canvas DEVE criar uma presença do ator na
  cena (REQ-UIF-044). Esta spec NÃO DEFINE se essa presença nasce vinculada ou desvinculada
  do ator (REQ-DOC-031..033): a decisão é da spec `41` (Q-NPC-03).

### 5.9 Conhecimento

- **REQ-NPC-070** [MVP] Cada linha DEVE exibir, apenas em leitura, quantos personagens
  conhecem e quantos entreviram o ator (REQ-CTT-070, REQ-CTT-071).
- **REQ-NPC-071** [MVP] Nenhuma linha DEVE oferecer controle que altere conhecimento
  (DEC-CTT-05, REQ-CTT-067).
- **REQ-NPC-072** [MVP] O rodapé DEVE abrir a **mesma** janela "Quem conhece quem" da aba
  Contatos (REQ-CTT-061); esta spec NÃO DEVE definir uma segunda janela nem um segundo
  modelo de conhecimento.
- **REQ-NPC-073** [MVP] Alterar conhecimento por essa janela DEVE propagar a cada usuário
  afetado como REQ-CTT-075 exige, independentemente de qual aba a abriu.

### 5.10 Permissão e redação

- **REQ-NPC-080** [MVP] Criar, excluir, mover de pasta, criar e excluir pasta, editar
  título e alterar atitude DEVEM ser verificados no servidor por `isRolePrivileged`
  (spec 05); esconder a aba NÃO é proteção (REQ-GAV-034).
- **REQ-NPC-081** [MVP] Esta spec NÃO DEVE introduzir `ownership` próprio de pasta: `Folder`
  segue sem ownership no MVP, e `inherit` resolve subindo até a raiz (REQ-DOC-028).
- **REQ-NPC-082** [MVP] A **atitude** NÃO DEVE ser entregue a usuário sem papel
  privilegiado, e a supressão DEVE ocorrer no módulo único de redação do servidor
  (REQ-DOC-058, REQ-SEC-020): saber que o ferreiro é hostil antes de a cena dizer é
  metagame.
- **REQ-NPC-083** [MVP] O mapa de conhecimento continua não sendo entregue a usuário sem
  papel privilegiado (REQ-CTT-084); esta aba NÃO DEVE abrir exceção.

### 5.11 Estado vazio e acessibilidade

- **REQ-NPC-090** [MVP] Sem não-jogável algum no mundo, o painel DEVE exibir estado vazio
  que oferece os dois caminhos de criação (REQ-NPC-041) e informa que personagem de jogador
  não nasce aqui.
- **REQ-NPC-091** [MVP] Busca sem resultado DEVE informar o termo procurado; limpar o campo
  DEVE devolver a árvore intacta.
- **REQ-NPC-092** [MVP] Todo controle do painel DEVE ser operável por teclado com foco
  visível (REQ-UIF-064), incluindo fixar pasta, mover de pasta, ciclar atitude, editar
  título, criar e excluir.
- **REQ-NPC-093** [MVP] Atitude, subtipo e estado de conhecimento NÃO DEVEM ser comunicados
  só por cor: DEVEM ter forma, texto ou rótulo acessível associado.
- **REQ-NPC-094** [MVP] Nenhum ícone desta aba DEVE ser emoji: todos DEVEM ser desenhados,
  pelo princípio já fixado em DEC-ACH-04 — emoji muda de desenho e de cor por sistema
  operacional e não acompanha o tema.

## 6. Requisitos não-funcionais

- **RNF-NPC-01** [MVP] Abrir a aba NÃO DEVE carregar ficha alguma: o painel se monta apenas
  com os dados já sincronizados dos atores.
- **RNF-NPC-02** [MVP] A lista DEVE permanecer utilizável com **centenas** de não-jogáveis
  no mundo — o estado normal depois de um bestiário importado. É a diferença deliberada
  para RNF-CTT-02, que pôde assumir a escala de dezenas.
- **RNF-NPC-03** [MVP] Mudança de condição ou de atitude em ator visível DEVE se refletir na
  linha em tempo real, sem reabrir a aba.
- **RNF-NPC-04** [MVP] Mover um ator entre pastas NÃO DEVE exigir recarregar a lista nem
  perder a posição de rolagem.

## 7. Onde cada coisa é gravada

| O quê                                 | Onde                              | Quem escreve | Referência               |
| ------------------------------------- | --------------------------------- | ------------ | ------------------------ |
| Pasta (nome, hierarquia)              | document `Folder`, no `world.db`  | servidor     | REQ-NPC-020, REQ-DOC-018 |
| Pasta de um ator                      | `folderId` do ator, no `world.db` | servidor     | REQ-NPC-028              |
| Título do não-jogável                 | no próprio ator, no `world.db`    | servidor     | REQ-NPC-032              |
| Atitude                               | no próprio ator, no `world.db`    | servidor     | REQ-NPC-037              |
| Conhecimento (regra geral + exceções) | no próprio ator, no `world.db`    | servidor     | REQ-CTT-070/072          |
| Pastas fixadas                        | cliente, por **mundo + usuário**  | o próprio    | REQ-NPC-025, DEC-UIF-10  |
| Pastas recolhidas/expandidas          | cliente, por **mundo + usuário**  | o próprio    | REQ-NPC-027              |
| Preset escolhido na criação           | **em lugar nenhum**               | —            | DEC-NPC-07, REQ-NPC-046  |
| Baú posto na cena                     | na cena — não é ator              | servidor     | DEC-NPC-08, Q-NPC-05     |
| `open` / `activeTab` da gaveta        | cliente (`ClientUIPreferences`)   | o próprio    | REQ-GAV-014              |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "npcs"`, grupo `gm`, primeira do grupo, rótulo por chave i18n,
   ícone próprio (REQ-NPC-001).
2. **Badge** — nenhum, e o porquê está na DEC do item: não há novidade que o Mestre não
   tenha produzido (REQ-NPC-002).
3. **Cabeçalho do painel** — barra com busca e o controle de criação, sem título e sem ✕
   (REQ-NPC-010). Mais um **rodapé fixo** com o baú e a janela de conhecimento
   (REQ-NPC-062).
4. **Estado vazio** — um para o mundo sem não-jogáveis, que oferece as duas portas de
   criação e diz o que não nasce ali (REQ-NPC-090).
5. **O que abre fora da gaveta** — a ficha (REQ-NPC-035), a janela de criação
   (REQ-NPC-041), a confirmação de exclusão (REQ-NPC-051) e a janela "Quem conhece quem"
   (REQ-NPC-072).
6. **Permissão de conteúdo** — `isRolePrivileged` no servidor para toda escrita
   (REQ-NPC-080), com redação de atitude e de conhecimento no módulo único
   (REQ-NPC-082/083).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), ordem no trilho (REQ-GAV-003), visibilidade do
  grupo GM (REQ-GAV-004), largura (REQ-GAV-012), contrato de badge (REQ-GAV-020),
  desmontagem ao trocar de aba (REQ-GAV-017), fronteira de segurança (REQ-GAV-034).
- `39` — de quem esta spec recebeu escopo (DEC-CTT-01) e de quem herda o contrato de
  condição (REQ-CTT-030..038), o sub-personagem (DEC-CTT-06), o título (DEC-CTT-07) e todo
  o modelo de conhecimento (REQ-CTT-060..076, REQ-CTT-084).
- `02` — `Actor`, `Folder` e subtipos (REQ-DOC-018, REQ-DOC-023), resolução de ownership
  com `inherit` por pasta (REQ-DOC-028), vínculo de presença ao ator (REQ-DOC-031..033) e a
  disciplina de redação no servidor (REQ-DOC-058).
- `05` — papéis e `isRolePrivileged`; administração de usuários (REQ-USR-025..031), que a
  DEC-NPC-02 emenda.
- `10` — combate ativo e combatentes (REQ-CBT-001..003), que a REQ-NPC-052 consulta.
- `11` — janela flutuante (REQ-UIF-009), drag & drop (REQ-UIF-044), teclado (REQ-UIF-064),
  fronteira de persistência (DEC-UIF-10); e REQ-UIF-002, cuja aba "Actors" as specs 39 e 42
  substituem juntas.
- `15` — registro declarativo de condições (REQ-SYS-043), consumido pela REQ-NPC-033.
- `16` — busca e importação de pack (REQ-CMP-013, REQ-CMP-016, REQ-CMP-018, REQ-CMP-021),
  consumidas pela REQ-NPC-042.
- `21` — redação de payload por papel (REQ-SEC-020), que sustenta REQ-NPC-082/083.
- `29` — `masterActorId` (REQ-PET-002), o vínculo que a REQ-NPC-034 lê.
- `37` — seção Usuários (REQ-CFG-050..052), que a DEC-NPC-02 emenda para fazer o personagem
  nascer com o player.
- `40` — aba Combate, que é onde a vida de criatura aparece; esta aba não a duplica.
- `41` — **Token**, reservada e não escrita. Dela dependem o vocabulário de "presença na
  cena" (REQ-NPC-036), o vínculo no arraste (REQ-NPC-063) e o conteúdo do baú (Q-NPC-05).
- Futura spec da **ficha de não-jogável** — dona do conteúdo que REQ-NPC-035 abre.

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-NPC-001 | O Mestre abre a aba e vê a árvore de pastas do mundo; o jogador não vê a aba no trilho, e a gaveta dele não abre nela nem com a preferência salva apontando para ela.           |
| CA-NPC-002 | O Mestre cria a pasta "Taverna", arrasta um NPC para dentro dela e o mesmo NPC muda de pasta pelo controle da linha; os dois caminhos funcionam e a lista não recarrega.        |
| CA-NPC-003 | O Mestre fixa "Goblinoides": ela sobe para o bloco do topo com o caminho da pasta-mãe. Ao desafixar, ela volta exatamente para onde estaria se nunca tivesse sido fixada.       |
| CA-NPC-004 | Outro Mestre entra no mesmo mundo em outro aparelho e **não** vê as pastas fixadas do primeiro; o document `Folder` está inalterado.                                            |
| CA-NPC-005 | Excluir a pasta "Taverna" com dois NPCs devolve os dois para "Sem pasta" e não remove ator algum; uma subpasta dela sobe para o nível da pasta excluída.                        |
| CA-NPC-006 | A janela de criação oferece "do bestiário" e "do zero"; a busca do bestiário acha "Goblin Piromaníaco" e importá-lo cria o ator no mundo pelo mesmo caminho da spec 16.         |
| CA-NPC-007 | A criação oferece os subtipos de faceta `creature` ou `hazard` do sistema ativo — incluindo familiar (DEC-ATR-18) — e nenhuma opção de criar personagem, recipiente ou veículo. |
| CA-NPC-008 | Criar um NPC com o preset "Mercador" pré-preenche a ficha; a linha criada **não** exibe "mercador" em lugar nenhum, e não há como filtrar por preset.                           |
| CA-NPC-009 | A atitude do Ferreiro Bram cicla aliado → neutro → inimigo com um acionamento cada, também por teclado; o valor é o mesmo para todos os personagens da party.                   |
| CA-NPC-010 | Um Perigo não exibe indicação de atitude alguma, e não há como atribuir uma a ele.                                                                                              |
| CA-NPC-011 | O payload recebido por um jogador não contém a atitude de NPC algum, nem mesmo dos que ele conhece.                                                                             |
| CA-NPC-012 | Nenhuma linha exibe pontos de vida, em nenhum formato; o mesmo NPC aberto na aba Combate mostra a vida para o Mestre.                                                           |
| CA-NPC-013 | Excluir um NPC lista antes as presenças em cena, quem o conhece e a ficha; confirmado, as presenças somem das cenas e o conhecimento sobre ele deixa de existir.                |
| CA-NPC-014 | Excluir um NPC que está num combate ativo é recusado, com a mensagem dizendo como destravar; encerrado o combate, a mesma exclusão passa.                                       |
| CA-NPC-015 | A linha mostra "2 conhecem, 1 entreviu" e não oferece nenhum controle para mudar isso; o rodapé abre a mesma janela que o rodapé da aba Contatos abre.                          |
| CA-NPC-016 | O botão do rodapé põe um baú na cena ativa, e esse baú não aparece na árvore, na busca, em contagem de pasta nem na janela "Quem conhece quem".                                 |
| CA-NPC-017 | Com o bestiário completo importado, buscar por "goblin" filtra a árvore sem travar, e as pastas sem resultado desaparecem enquanto durar a busca.                               |
| CA-NPC-018 | Nenhum ícone da aba é um caractere emoji; todos são desenhados e mudam de cor com o tema.                                                                                       |

## 11. Questões em aberto

- **Q-NPC-01** — Importar do bestiário cai em **qual pasta** (a escolhida na criação, uma
  pasta "Importados", ou a que espelha o pack)? E o ator importado guarda **vínculo com o
  pack de origem**, para poder ser atualizado quando o pack mudar, ou vira cópia solta?
  Deixada explicitamente sem resposta no grill de 2026-08-16.
- **Q-NPC-02** — Quem declara o catálogo de **presets** (REQ-NPC-048): o sistema de jogo,
  como faz com as condições (REQ-SYS-043), ou o Mestre cria os presets do mundo dele?
- **Q-NPC-03** — A presença criada pelo arraste (REQ-NPC-063) nasce **vinculada** ou
  **desvinculada** do ator? Depende da spec `41` (Token) e não se decide antes dela.
- **Q-NPC-04** — ~~O subtipo `loot`, declarado pelo pf2e, fica **sem consumidor** com o baú
  fora de ator (DEC-NPC-08). Ele é usado por baixo do baú sem nunca ser listado, ou sai da
  declaração do sistema?~~ **Fechada pela `45`** (DEC-ATR-09): `loot` é o subtype de faceta
  `container`. O baú é ator, e continua fora desta aba exatamente como a DEC-NPC-08 exigiu
  — o que ela recusou foi o baú no diretório, não o baú como registro.
- **Q-NPC-05** — ~~Onde vive o **conteúdo do baú** (os itens saqueáveis), já que ele não é
  ator? É assunto da spec de Token/Cenas, e esta spec não o antecipa.~~ **Fechada pela `45`**
  (DEC-ATR-09): vive em `items`, como o conteúdo de qualquer ator (REQ-DOC-020). Com
  presença desvinculada, o conteúdo vivo é o da presença, pela regra geral (DEC-ATR-14).
- **Q-NPC-06** — **Excluir personagem de jogador** não tem tela em lugar nenhum do app.
  Aceito por ora (decisão de 2026-08-16). Quando o mundo precisar, o gesto é da seção
  Usuários da 37 — apagando a ficha junto com o usuário — ou de uma tela nova?
- **Q-NPC-07** — A redação da atitude (REQ-NPC-082) atrapalha algum consumo futuro? Quando
  o combate passar a usá-la, ele pode precisar dela no cliente do jogador; a posição atual
  é redigir e reabrir quando houver um consumidor concreto.

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio (`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `36` | A tabela de specs-filhas (§8) da `36` **já aponta** para esta spec, em vez de marcar **NPCs** como "_a criar_" — emenda aplicada na `36` em 2026-08-16.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `37` | **REQ-CFG-051** já exige que criar um usuário crie também um **personagem em branco** associado a ele — emenda aplicada na `37` em 2026-08-16, junto de **REQ-CFG-051a** (a criação não abre ficha nem janela e a seção não vira tela de personagem), da linha nova em §7 ("Onde cada coisa é gravada") e de CA-CFG-012. É o que dá endereço à criação de personagem, que a DEC-CTT-01 tirou da aba Contatos e a DEC-NPC-02 recusa aqui.                                                                                                                          |
| `05` | **REQ-USR-025** já ganhou o mesmo efeito — emenda aplicada na `05` em 2026-08-16: o usuário de papel não privilegiado nasce com um personagem, e esse personagem nasce com o usuário como `OWNER` (REQ-USR-025a, exceção declarada a REQ-DOC-029, com REQ-DOC-027/028 inalterados). Acompanham **REQ-USR-025b** ("em branco"), **REQ-USR-025c** (gesto atômico) e **REQ-USR-025d** (nenhuma outra ação de administração cria ou remove personagem), mais CA-USR-11/12. A administração de usuários passa a ter consequência sobre documents, o que ela não tinha. |
| `39` | **Q-CTT-05 já está fechada**: o título vale para não-jogador e é editável pelo Mestre (REQ-NPC-032) — emenda aplicada na `39` em 2026-08-16, como blockquote sob a própria Q-CTT-05, que fica no lugar como registro da pergunta e de onde ela foi respondida. E a lacuna declarada em **DEC-CTT-01** fica **paga pela metade**: criar e excluir não-jogável é desta aba, criar personagem é da 37, e **excluir personagem segue sem tela** — aceito em Q-NPC-06.                                                                                                 |
| `38` | Nada muda. Registra-se que **DEC-ACH-04**, escrita no contexto do seletor de modo do chat, passa a ser citada como princípio de toda a gaveta (REQ-NPC-094).                                                                                                                                                                                                                                                                                                                                                                                                      |
| `15` | Nada muda: a emenda de `tone`/`help`/`critical` em REQ-SYS-043 já foi obrigada pela 39; esta spec é apenas o segundo consumidor dela (REQ-NPC-033).                                                                                                                                                                                                                                                                                                                                                                                                               |
| `02` | Nada muda no modelo. Registra-se que a redação de REQ-DOC-058 ganha um terceiro consumidor, além de Notes/tokens ocultos e do conhecimento de contato: a **atitude** (REQ-NPC-082).                                                                                                                                                                                                                                                                                                                                                                               |
| `41` | Nada muda — ela não existe. Registra-se que três pontos desta spec (REQ-NPC-036, REQ-NPC-063 e Q-NPC-05) ficam pendurados nela, e que esta spec usa "presença na cena" em vez de "token" justamente por isso.                                                                                                                                                                                                                                                                                                                                                     |

## 13. Referências

- Protótipo decidido: `packages/client/prototypes/npcs-tab.prototype.html` (as três
  variantes iniciais e a rodada 2 estão no histórico do arquivo).
- Grill de 2026-08-16, três rodadas (sessão de spec-filha da 36).
- Subtipos de ator declarados hoje: `systems/pf2e/src/index.ts` — `character`, `npc`,
  `hazard`, `loot`, `familiar`. **`vehicle` não existe no repositório** (DEC-NPC-05).
- Implementação atual, que esta spec passa a definir como alvo:
  `packages/client/src/components/actors/ActorDirectory.svelte` e
  `packages/client/src/lib/actors/actorDirectory.ts` (lista, pastas, criação e exclusão de
  hoje); `packages/server/src/net/handlers/doc-handlers.ts` (autorização de ator);
  `packages/server/src/net/redaction.ts` (módulo único de redação).
