# 39 — Contatos

- **Título:** Aba Contatos — quem está na mesa e quem cada personagem conhece
- **Status:** draft v0.1 (grill concluído em 2026-08-16)
- **Data:** 2026-08-16
- **Baseada em:**
  - `36-gaveta-lateral.md` — spec-mãe; §7 fixa o contrato que esta filha cumpre, e a DEC-GAV-01 batizou a aba.
  - `02-modelo-de-dados.md` — `Actor`, `ownership` e a disciplina de redação no servidor (REQ-DOC-058).
  - `05-usuarios-e-permissoes.md` — papéis, níveis de ownership e `isRolePrivileged`.
  - `11-ui-framework-e-fichas.md` — janelas flutuantes (REQ-UIF-009), drag & drop (REQ-UIF-044), teclado (REQ-UIF-064), fronteira de persistência (DEC-UIF-10).
  - `15-api-de-sistemas.md` — registro declarativo de condições (REQ-SYS-043), que esta spec emenda.
  - Protótipo `packages/client/prototypes/contacts-tab.prototype.html` — estado decidido, 2026-08-16 (as quatro variantes iniciais estão no histórico do arquivo).

> **Spec-filha da 36.** Esta spec é dona do **painel** da aba Contatos e do
> **conhecimento** que um personagem tem de um contato. Ela não define largura,
> posição, gesto de recolher nem persistência de `open`/`activeTab` — tudo isso é
> da 36. E não redefine `Actor`, `ownership` nem condição de jogo: isso é das
> specs 02, 05 e 15, que ela cita.

---

## 1. Objetivo

Trocar o diretório de documentos por uma lista de **pessoas**: quem está na mesa agora,
quem cada personagem já conheceu na história, e nada além disso — sem número de vida à
mostra, sem ficha aberta dentro da gaveta, sem árvore de pastas de arquivo.

## 2. Escopo

### 2.1 Inclui

- A composição do painel: seção **Na mesa**, seção **Conhecidos**, busca e rodapé do Mestre.
- O **conhecimento**: o estado de cada par contato × personagem, sua regra geral e suas exceções.
- A janela **Quem conhece quem**, onde esse estado se edita.
- As **categorias** com que o usuário agrupa seus conhecidos.
- O **título** livre exibido sob o nome do personagem.
- Como **condição** é exibida no cartão (cor, valor, ajuda, ordem, teto).
- O encapsulamento do **sub-personagem** (familiar, companheiro) dentro do dono.

### 2.2 Não inclui

- O contêiner (trilho, gaveta, largura, gesto de recolher, tipos de badge) → `36-gaveta-lateral.md`.
- O modelo de `Actor`, o `ownership` e o CRUD de documentos → `02-modelo-de-dados.md`.
- **Criar e excluir ator** → nenhuma tela desta spec faz isso (DEC-CTT-01); é da futura aba NPCs.
- O que é uma condição, o que ela faz e quem a aplica → `15-api-de-sistemas.md` e a spec do sistema.
- A ficha do personagem, incluindo a **anotação privada** → `11-ui-framework-e-fichas.md` (DEC-CTT-09).
- O diretório completo de não-jogadores, com pastas e autoria → futura spec da aba **NPCs**.
- A regra de vínculo entre companheiro e dono, que continua sendo a do servidor (DEC-CTT-06).
- A política de redação de payload por papel → `21-seguranca.md` (REQ-SEC-020); aqui só se nomeia o que **não pode sair**.

## 3. Conceitos e terminologia

| Conceito              | Definição                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Contato**           | Qualquer ator que apareça na aba: personagem de jogador, sub-personagem ou não-jogador conhecido.                          |
| **Na mesa**           | Seção com os personagens dos jogadores — os seus primeiro, os demais em seguida.                                           |
| **Conhecido**         | Não-jogador que ao menos um personagem do usuário já conheceu ou entreviu.                                                 |
| **Estado**            | O grau de conhecimento de **um personagem** sobre **um contato**: `oculto`, `entrevisto` ou `conhecido`.                   |
| **Regra geral**       | O estado que vale para todo personagem sem exceção registrada naquele contato — inclusive personagem que ainda não existe. |
| **Exceção**           | Estado gravado para um personagem específico, que prevalece sobre a regra geral.                                           |
| **Sub-personagem**    | Ator vinculado a outro como dono (familiar, companheiro animal, montaria), exibido dentro do cartão do dono.               |
| **Título**            | Texto livre exibido sob o nome do personagem ("A Voz do Bosque"). Não é classe, nem nível, nem papel de sistema.           |
| **Categoria**         | Agrupamento que o próprio usuário cria para organizar seus conhecidos (cidade, confiança, o que quiser).                   |
| **Quem conhece quem** | Janela do Mestre com a grade contato × personagem, onde o estado se edita.                                                 |

## 4. Decisões

### DEC-CTT-01 — A aba é gente, não diretório: não cria nem exclui ator

A aba lista, abre e organiza. **Não** cria e **não** exclui ator, para papel nenhum —
nem com botão escondido para o Mestre.

- **Racional:** a DEC-GAV-01 rebatizou "Atores" como Contatos justamente porque a lista
  do jogador não é o diretório de documentos. Um botão de criar traria o diretório de
  volta pela porta dos fundos, e duplicaria o que a aba NPCs vai fazer com autoria de
  verdade (pastas, subtipos, importação).
- **Lacuna conhecida e aceita:** hoje `ActorDirectory.svelte` é a única UI do cliente que
  cria (`+Novo`) e exclui ator. Quando esta aba o substituir, o cliente fica **sem
  nenhuma forma de criar ou excluir ator** até a aba NPCs existir. Isso é dívida
  declarada, não descuido: não se compensa com andaime.

### DEC-CTT-02 — Vida não aparece nesta aba, para papel nenhum

Nenhum ponto de vida, barra, fração ou percentual aparece no painel — nem do próprio
personagem, nem para o Mestre.

- **Racional:** ver a vida alheia numa lista sempre aberta induz metagame e corrói a
  ficção; e a vida do próprio personagem já tem dois lugares (a ficha e o combate).
- **Ganho colateral:** desfaz a disputa com o painel de Comitiva do Hub, que é quem lista
  pontos de vida (REQ-HUB-044). As duas telas deixam de mostrar o mesmo dado com regras
  diferentes.
- **Condição continua aparecendo** (DEC-CTT-11): condição é o que a mesa vê na ficção —
  alguém sangrando, apavorado ou caído —, não a contabilidade interna da ficha.

### DEC-CTT-03 — Conhecimento é do par contato × personagem, e não é ownership

O estado é gravado por **par** (um contato, um personagem), com regra geral por contato e
exceções por personagem. `ownership` continua sendo apenas o portão de acesso ao
documento: conhecer **nunca** concede acesso a quem o ownership nega.

- **Racional:** o caso que motivou a decisão é real e comum — o Tobias conhece o ferreiro,
  a Fofurinha só o entreviu. `ownership` é um mapa de `userId` (REQ-DOC-028), e usuário
  não conhece ninguém: quem conhece é o personagem. Nenhum arranjo sobre ownership
  representa esse par sem mentir.
- **Preço aceito:** é um segundo eixo de visibilidade, além do ownership. Ele só
  **restringe**, nunca amplia, e sai pelo mesmo funil de redação do servidor
  (`net/redaction.ts`), de modo que não existe caminho de emissão que o ignore.

### DEC-CTT-04 — Três degraus, e "entrevisto" é redigido no servidor

`oculto` — o contato não existe para aquele personagem. `entrevisto` — existe, sem
identidade: nome e título são redigidos; o retrato viaja, e a tela decide se mostra o
retrato ou uma silhueta em seu lugar. `conhecido` — nome, título e categoria.

- **Racional:** a mesa reconhece o degrau do meio ("aquele encapuzado de novo"), e ele é o
  que torna a revelação uma cena em vez de um interruptor.
- **Consequência dura:** o payload enviado a um usuário cujo maior estado é `entrevisto`
  **não pode conter** nome nem título do contato. Esconder no cliente não esconde nada —
  é a mesma lição que a aba Chat fixou sobre a CA do alvo. O retrato (`AssetRef`) **não**
  é redigido: ele sempre viaja no payload do contato, porque uma peça no mapa precisa da
  arte para ser desenhada. A silhueta que o cartão de contato exibe no lugar do retrato é
  escolha de apresentação daquela tela — não é segredo do servidor, e nenhuma outra tela é
  obrigada a repeti-la.
- **Isto não afrouxa `oculto`:** um ator que o usuário não conhece continua sem ser emitido
  a ele — a mudança é só no degrau `entrevisto`. `oculto` só passa a ser emitido quando o
  usuário recebe uma peça daquele ator (`41-token.md`).

  > **Emenda obrigada pela spec 41** (`41-token.md`, DEC-TOK-09 e §12, 2026-08-17): a
  > redação anterior redigia nome, título **e retrato** do payload de um contato
  > `entrevisto`. Mas uma peça no mapa precisa da arte para ser desenhada, e o jogador está
  > olhando a criatura: o segredo é **quem ela é**, não **como ela parece**. A regra que
  > fica de pé nas duas specs: o nome é redigido no servidor, sempre; a arte viaja; a
  > silhueta no cartão de contato passa a ser escolha de apresentação daquela tela. _(A
  > redação acima substitui a proibição de retrato; a redação de nome e título, o racional
  > do degrau intermediário e o corte de `oculto` permanecem inalterados.)_

### DEC-CTT-05 — O conhecimento se edita num lugar só, aberto por um rodapé do Mestre

Nenhum controle de estado ou de "quem conhece" existe nos cartões da lista. A edição vive
inteira na janela **Quem conhece quem**, aberta por um rodapé fixo do painel que só o
Mestre enxerga.

- **Racional:** controle repetido em cada cartão vira ruído para o jogador e desalinha as
  duas telas na cabeça do Mestre. Um lugar só é também o que permite editar em lote —
  linha, coluna e regra geral — que é o gesto real quando entra jogador novo.
- **Rodapé, e não cabeçalho:** o cabeçalho é da busca, que serve aos dois papéis; o rodapé
  existe só quando há Mestre, e não rola com a lista.

### DEC-CTT-06 — Sub-personagem é encapsulado no dono, com o vínculo que o servidor já usa

Familiar, companheiro e afins aparecem **dentro** do cartão do dono, nunca soltos na
lista, e herdam a visibilidade dele.

- **Vínculo:** a aba lê o mesmo par que o servidor já lê para autorizar criação de
  companheiro (`type` de companheiro + `system.masterActorId`, em
  `packages/server/src/net/handlers/doc-handlers.ts`). Esta spec **não** abstrai isso na
  API de sistemas.
- **Racional:** o dado existe e já é autoridade de permissão no servidor; inventar um
  segundo caminho agora custaria migração para não mudar nenhum comportamento. Se um dia a
  API de sistemas passar a declarar o vínculo, esta spec é atualizada.

### DEC-CTT-07 — O que aparece sob o nome é um título livre, editável na aba

Cada personagem tem um campo de texto livre exibido sob o nome. Vazio, a linha cai para
classe e nível (ou o equivalente que o sistema já exibe).

- **Racional:** "Druida 5" é ficha; "A Voz do Bosque" é quem a pessoa é na mesa. O título
  também é o que dá identidade a contatos de sistemas que não têm classe nem nível.
- **Quem edita:** quem tem posse do personagem, e o Mestre. A edição é no próprio cartão —
  é o gesto mais curto, e não justifica abrir a ficha.

### DEC-CTT-08 — Categorias são do usuário, moram no aparelho, e ele manda na ordem

Cada usuário cria, renomeia, exclui, ordena e preenche as **suas** categorias. Ninguém vê
nem administra a categorização de outro. Um contato está em **uma** categoria.

- **Onde mora:** no cliente, por mundo + usuário — a mesma fronteira dos dados favoritos da
  aba Chat e de DEC-UIF-10.
- **Uma categoria por contato:** em 300px, o mesmo contato repetido em duas listas é
  confusão garantida; mover é a operação, marcar não é.
- **Ordem é manual:** a lista de categorias segue a ordem que o usuário definiu, não a
  alfabética nem a de criação. Alfabetizar à força tira dele o controle de qual grupo
  aparece primeiro.
- **Preço aceito:** trocar de computador ou limpar o navegador perde a organização.
  Exportar, ou promover para o servidor, é trabalho futuro — registrado em Q-CTT-02.

### DEC-CTT-09 — Anotação não vive nesta aba

A aba não exibe nem edita anotação sobre contato. A anotação é privada de quem a escreveu
e vive na ficha.

- **Racional:** a gaveta mostra quem é; o que você pensa sobre a pessoa é conteúdo, e
  conteúdo tem um lugar só. Um resumo de anotação no cartão criaria um segundo lugar de
  edição e um segundo dado a redigir por usuário, sem ganho na hora do jogo.

### DEC-CTT-10 — Badge é ponto de estado, e apaga ao abrir

A aba fornece um **ponto de estado** (REQ-GAV-020), aceso quando algum contato sobe de
estado para qualquer personagem do usuário desde a última abertura da aba.

- **Racional:** conhecer alguém novo é evento raro e narrativamente forte — merece
  chamado, não número. Contador ainda competiria visualmente com o contador de mensagens
  do Chat, logo acima no trilho.
- **Assimetria proposital:** o Mestre nunca vê esse ponto, porque a novidade é sempre obra
  dele.
- **Condição crítica não acende badge aqui.** Alarme de combate é da aba Combate, que já
  tem ponto de estado próprio.

### DEC-CTT-11 — Condição se exibe por contrato, e o sistema é quem declara

A aba não conhece condição nenhuma: ela pinta o que o sistema declarou (REQ-SYS-043), como
a aba Configurações faz com a seção Mundo (REQ-SYS-047).

- **Cor por efeito sobre quem carrega**, nunca por gravidade: verde ajuda, vermelho
  atrapalha, roxo é situação (detecção, atitude, controle). Gravidade é julgamento que
  nenhum dado declarado sustenta.
- **Ênfase, não quarta cor:** condição marcada como crítica pinta o chip preenchido, e só
  para o que tira o personagem da cena.
- **Valor faz parte do rótulo** ("Amedrontado 2"), colado ao nome, em fonte tabular.
- **Ajuda no hover**, com texto vindo do sistema, em tooltip desenhado.
- **Falha aberta:** declaração incompleta degrada a exibição, nunca esconde a condição.
- **Sem ícone nesta aba:** o `img` do registro aponta para arte do sistema, e arte da Paizo
  é proibida no projeto.
- **Emenda que isso obriga:** `ConditionDefinition` (REQ-SYS-043) ganhou `tone`, `help` e
  `critical`, aplicados em `15-api-de-sistemas.md` em 2026-08-16 — ver §12.

### DEC-CTT-12 — Só o Mestre arrasta um contato para o mapa

Arrastar um cartão para o canvas, criando token (REQ-UIF-044), é gesto exclusivo do Mestre.
O cartão do jogador não oferece o gesto — não o oferece e falha.

- **Racional:** quem povoa a cena é o Mestre. O servidor permitiria mais (ele aceita que o
  dono do ator crie o token), mas ampliar aqui abriria uma segunda porta de encenação sem
  ninguém ter pedido. O Mestre, além disso, quase não vive nesta aba: é [MVP] mínimo, sem
  refinamento de arraste.

### DEC-CTT-13 — Duplo-clique abre a ficha, e há botão explícito para quem não usa mouse

O cartão abre a ficha no duplo-clique, como o diretório de hoje, e todo cartão traz um
botão de ficha alcançável por teclado e por toque.

- **Racional:** manter o gesto que a mesa já tem evita reaprendizado, e o botão explícito
  cobre teclado e tablet sem depender de um gesto que toque não tem.

## 5. Requisitos funcionais

> Blocos de dezena: 001–009 identidade e badge; 010–019 cabeçalho, busca e ordem; 020–029
> seção Na mesa; 030–039 condições; 040–049 conhecidos e estados; 050–059 categorias;
> 060–069 janela Quem conhece quem; 070–079 modelo de conhecimento; 080–089 permissão e
> redação; 090–099 estado vazio e acessibilidade. Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-CTT-001** [MVP] A aba DEVE se registrar por `registerSidebarTab` (REQ-GAV-030) com
  `id: "contacts"`, `group: "all"`, ícone próprio e rótulo por chave i18n, na segunda posição
  do grupo de todos (REQ-GAV-003).
- **REQ-CTT-002** [MVP] A aba DEVE fornecer um badge do tipo **ponto de estado**
  (REQ-GAV-020), sem número.
- **REQ-CTT-003** [MVP] O ponto DEVE acender quando qualquer contato subir de estado
  (REQ-CTT-070) para qualquer personagem do usuário enquanto a aba não estiver aberta, e
  DEVE apagar ao abrir a aba.
- **REQ-CTT-004** [MVP] O ponto NÃO DEVE acender para papel privilegiado, nem por condição
  aplicada, nem por conexão ou desconexão de usuário.

### 5.2 Cabeçalho, busca e ordem

- **REQ-CTT-010** [MVP] O painel DEVE exibir no topo uma barra fixa com um campo de busca
  ocupando a largura disponível, sem título textual da aba e sem ✕ (DEC-GAV-03).
- **REQ-CTT-011** [MVP] A busca DEVE filtrar por **nome e título**, no cliente, aplicando-se
  às duas seções ao mesmo tempo.
- **REQ-CTT-012** [MVP] Categoria sem resultado DEVE desaparecer enquanto durar a busca, e
  reaparecer quando o campo for limpo.
- **REQ-CTT-013** [MVP] Contato cujo maior estado é `entrevisto` NÃO DEVE ser encontrável
  por nome — consequência de REQ-CTT-081, não regra de tela.
- **REQ-CTT-014** [MVP] Na seção **Na mesa**, os personagens do próprio usuário DEVEM vir
  primeiro, e cada bloco DEVE ser ordenado alfabeticamente com `localeCompare` em pt-BR.
- **REQ-CTT-015** [MVP] Presença (conectado ou não) DEVE alterar apenas a apresentação do
  cartão, NUNCA a posição na lista.
- **REQ-CTT-016** [MVP] Na seção **Conhecidos**, as categorias DEVEM seguir a ordem definida
  pelo usuário (REQ-CTT-054), com "Sem categoria" sempre por último; dentro de cada
  categoria a ordem DEVE ser alfabética.

### 5.3 Seção Na mesa

- **REQ-CTT-020** [MVP] Cada personagem de jogador DEVE ser exibido em um cartão com
  retrato, nome, título (REQ-CTT-023), indicação de presença e suas condições.
- **REQ-CTT-021** [MVP] O cartão NÃO DEVE exibir pontos de vida em nenhuma forma — número,
  fração, barra ou percentual — para papel nenhum (DEC-CTT-02).
- **REQ-CTT-022** [MVP] O cartão do próprio personagem DEVE ser distinguível dos demais sem
  depender de cor apenas.
- **REQ-CTT-023** [MVP] O cartão DEVE exibir sob o nome o **título** do personagem; quando
  vazio, DEVE exibir a identificação de sistema já disponível (classe e nível ou
  equivalente), visualmente distinta de um título preenchido.
- **REQ-CTT-024** [MVP] O título DEVE ser editável no próprio cartão por quem tem posse do
  personagem e por papel privilegiado, confirmando com `Enter` e cancelando com `Esc`.
- **REQ-CTT-025** [MVP] Sub-personagens DEVEM ser exibidos **dentro** do cartão do dono,
  identificados por nome e tipo, e NÃO DEVEM aparecer como item solto da lista.
- **REQ-CTT-026** [MVP] Sub-personagem DEVE herdar a visibilidade do dono: se o dono não é
  visível ao usuário, o sub-personagem também não é.
- **REQ-CTT-027** [MVP] O duplo-clique no cartão DEVE abrir a ficha em janela flutuante
  (REQ-UIF-009), e cada cartão DEVE oferecer um botão de ficha alcançável por teclado.
- **REQ-CTT-028** [MVP] Arrastar um cartão para o canvas DEVE criar token (REQ-UIF-044)
  apenas para papel privilegiado; para os demais o cartão NÃO DEVE ser arrastável.

### 5.4 Condições

- **REQ-CTT-030** [MVP] O cartão DEVE exibir as condições ativas do ator como etiquetas de
  texto, sem ícone.
- **REQ-CTT-031** [MVP] A cor da etiqueta DEVE derivar do `tone` declarado pelo sistema:
  benefício, penalidade ou situação (DEC-CTT-11).
- **REQ-CTT-032** [MVP] Condição declarada como crítica DEVE ser exibida com ênfase de
  preenchimento, e essa ênfase NÃO DEVE introduzir uma quarta cor.
- **REQ-CTT-033** [MVP] Condição com valor DEVE exibir o valor como parte do rótulo, colado
  ao nome e em numeral tabular; NÃO DEVE usar parênteses, etiqueta separada ou duplicação
  de etiqueta.
- **REQ-CTT-034** [MVP] Ao apontar uma etiqueta, o painel DEVE exibir o texto de ajuda
  declarado pelo sistema em tooltip próprio (desenhado), não em `title` nativo.
- **REQ-CTT-035** [MVP] Condição sem `help` declarado DEVE ser exibida sem tooltip;
  condição sem `tone` DEVE ser exibida como situação. Declaração incompleta NUNCA DEVE
  ocultar a condição.
- **REQ-CTT-036** [MVP] A ordem das etiquetas DEVE ser: críticas, penalidades, situações,
  benefícios; e alfabética dentro de cada grupo.
- **REQ-CTT-037** [MVP] O cartão DEVE exibir no máximo duas etiquetas mais um indicador
  "+N"; acionar o indicador DEVE expandir a lista no próprio cartão, sem abrir janela e sem
  alterar a largura da gaveta (DEC-GAV-04).
- **REQ-CTT-038** [MVP] Etiqueta com rótulo maior que o espaço DEVE ser truncada com
  reticências, e o rótulo íntegro DEVE constar do tooltip.

### 5.5 Conhecidos e estados

- **REQ-CTT-040** [MVP] A seção **Conhecidos** DEVE listar os não-jogadores cujo estado para
  o usuário (REQ-CTT-071) seja `entrevisto` ou `conhecido`.
- **REQ-CTT-041** [MVP] Contato `entrevisto` DEVE ser exibido sem nome ou título, com
  marcação explícita de não identificado; o retrato do contato PODE ser exibido, e a tela
  DECIDE se mostra o retrato ou uma silhueta em seu lugar — essa escolha é apresentação,
  não redação de servidor (DEC-CTT-04).

  > **Emenda obrigada pela spec 41** (`41-token.md`, DEC-TOK-09 e §12, 2026-08-17): a
  > redação anterior incluía "ou retrato" na lista do que é redigido do payload. O retrato
  > deixou de ser redigido — o servidor sempre o envia; só nome e título continuam
  > redigidos. Ver DEC-CTT-04.

- **REQ-CTT-042** [MVP] Contato `entrevisto` NÃO DEVE oferecer categorização nem abertura de
  ficha.
- **REQ-CTT-043** [MVP] Contato `oculto` NÃO DEVE aparecer na lista, em contagem, em busca
  ou em qualquer indicador da aba.
- **REQ-CTT-044** [MVP] Para papel privilegiado, cada contato DEVE exibir de forma discreta
  quantos personagens o conhecem e quantos o entreviram.

### 5.6 Categorias

- **REQ-CTT-050** [MVP] O usuário DEVE poder criar, renomear e excluir categorias próprias,
  a partir do cabeçalho da seção Conhecidos ou do próprio contato.
- **REQ-CTT-051** [MVP] Cada contato DEVE pertencer a no máximo uma categoria; movê-lo para
  outra DEVE removê-lo da anterior.
- **REQ-CTT-052** [MVP] Excluir uma categoria NÃO DEVE excluir contato algum: seus contatos
  DEVEM voltar para "Sem categoria".
- **REQ-CTT-053** [MVP] "Sem categoria" DEVE aparecer somente quando contiver ao menos um
  contato, e NÃO DEVE ser renomeável nem excluível.
- **REQ-CTT-054** [MVP] O usuário DEVE poder reordenar suas categorias, e a ordem escolhida
  DEVE persistir junto com elas.
- **REQ-CTT-055** [MVP] Categorias e a associação contato → categoria DEVEM ser gravadas no
  cliente, por mundo e usuário (DEC-UIF-10), e NUNCA no servidor.
- **REQ-CTT-056** [MVP] A categorização de um usuário NÃO DEVE ser visível a outro, em
  nenhum papel.
- **REQ-CTT-057** [V2] O usuário PODE exportar e importar suas categorias, para levá-las a
  outro aparelho.

### 5.7 Janela Quem conhece quem

- **REQ-CTT-060** [MVP] O painel DEVE exibir, apenas para papel privilegiado, um rodapé fixo
  que abre a janela **Quem conhece quem**; o rodapé NÃO DEVE rolar com a lista e NÃO DEVE
  existir para os demais papéis.
- **REQ-CTT-061** [MVP] A janela DEVE abrir fora da gaveta, pelo `windowManager`
  (REQ-UIF-009), como grade de contatos (linhas) por personagens (colunas).
- **REQ-CTT-062** [MVP] Cada célula DEVE percorrer ciclicamente os três estados a cada
  acionamento, na ordem `oculto → entrevisto → conhecido`, e DEVE distinguir visualmente
  uma célula que é exceção (REQ-CTT-072).
- **REQ-CTT-063** [MVP] Acionar o nome do contato DEVE percorrer a **regra geral** daquele
  contato e alinhar a linha inteira, descartando suas exceções.
- **REQ-CTT-064** [MVP] Acionar o nome do personagem DEVE percorrer o estado daquele
  personagem em todos os contatos; quando a coluna estiver com estados mistos, o primeiro
  acionamento DEVE uniformizá-la em `conhecido`.
- **REQ-CTT-065** [MVP] A janela DEVE exibir a regra geral vigente de cada contato em texto,
  e a legenda dos três estados.
- **REQ-CTT-066** [MVP] A janela NÃO DEVE oferecer criação, exclusão ou edição de ator
  (DEC-CTT-01).
- **REQ-CTT-067** [MVP] Nenhum controle de estado ou de conhecimento DEVE existir nos
  cartões da lista (DEC-CTT-05).

### 5.8 Modelo de conhecimento

- **REQ-CTT-070** [MVP] O conhecimento DEVE ser gravado por par contato × personagem, em três
  estados ordenados: `oculto` (0), `entrevisto` (1) e `conhecido` (2).
- **REQ-CTT-071** [MVP] O estado efetivo de um **usuário** sobre um contato DEVE ser o
  **maior** estado entre os personagens que ele possui.
- **REQ-CTT-072** [MVP] Cada contato DEVE ter uma **regra geral** e um conjunto de
  **exceções** por personagem; a exceção prevalece, e gravar exceção igual à regra geral
  DEVE removê-la em vez de duplicá-la.
- **REQ-CTT-073** [MVP] Personagem criado após o registro DEVE receber, para cada contato, a
  regra geral vigente — sem qualquer operação do Mestre.
- **REQ-CTT-074** [MVP] O conhecimento NÃO DEVE conceder acesso que o `ownership` do
  documento negue: ele apenas restringe (DEC-CTT-03).
- **REQ-CTT-075** [MVP] Alterar conhecimento DEVE propagar, a cada usuário afetado, o delta
  correspondente (criação, atualização ou remoção lógica do contato), como REQ-DOC-058 exige
  para Notes — sem depender de recarregar a página.
- **REQ-CTT-076** [MVP] Excluir um personagem DEVE remover as exceções que o citam, sem
  alterar a regra geral de contato algum.

### 5.9 Permissão e redação

- **REQ-CTT-080** [MVP] Esconder um controle no cliente NÃO É proteção (REQ-GAV-034):
  alterar conhecimento e alterar título DEVEM ser verificados no servidor.
- **REQ-CTT-081** [MVP] O payload de um contato entregue a usuário cujo estado efetivo seja
  `entrevisto` NÃO DEVE conter nome, título nem dado de sistema do contato; o retrato
  (`AssetRef`) NÃO É redigido e DEVE viajar normalmente (DEC-CTT-04).

  > **Emenda obrigada pela spec 41** (`41-token.md`, DEC-TOK-09 e §12, 2026-08-17): a
  > redação anterior incluía "retrato" entre os campos redigidos do payload — a mesma
  > mudança de REQ-CTT-041. Ver DEC-CTT-04.

- **REQ-CTT-082** [MVP] O payload de um contato `oculto` NÃO DEVE ser entregue de forma
  alguma ao usuário — nem em snapshot, nem em broadcast, nem em replay de operações.
- **REQ-CTT-083** [MVP] A redação de REQ-CTT-081 e REQ-CTT-082 DEVE ocorrer no **módulo
  único de redação do servidor**, o mesmo usado para tokens ocultos e roll modes
  (REQ-DOC-058, REQ-SEC-020), e NÃO DEVE existir caminho de emissão que a contorne.
- **REQ-CTT-084** [MVP] O mapa de conhecimento de um contato (regra geral e exceções) NÃO
  DEVE ser entregue a usuário sem papel privilegiado: ele revela o que os outros
  personagens sabem.
- **REQ-CTT-085** [MVP] Alterar o **título** DEVE ser permitido a papel privilegiado e a
  quem tenha `OWNER` sobre o personagem; qualquer outro DEVE ser recusado pelo servidor.

### 5.10 Estado vazio e acessibilidade

- **REQ-CTT-090** [MVP] Sem personagem algum visível, o painel DEVE exibir estado vazio
  próprio a cada papel: para o jogador, que ele ainda não tem personagem na mesa; para o
  Mestre, que nenhum personagem de jogador existe ainda.
- **REQ-CTT-091** [MVP] Com personagens na mesa e nenhum conhecido, a seção Conhecidos DEVE
  exibir estado vazio dizendo que nomes aparecem conforme a história os apresenta.
- **REQ-CTT-092** [MVP] O estado vazio NÃO DEVE oferecer criação de ator (DEC-CTT-01).
- **REQ-CTT-093** [MVP] Todo controle do painel e da janela DEVE ser operável por teclado com
  foco visível (REQ-UIF-064), incluindo etiquetas de condição, edição de título, reordenação
  de categorias e as células da grade.
- **REQ-CTT-094** [MVP] Estado, presença e distinção do próprio personagem NÃO DEVEM ser
  comunicados só por cor: DEVEM ter forma, texto ou rótulo acessível associado.

## 6. Requisitos não-funcionais

- **RNF-CTT-01** [MVP] Abrir a aba NÃO DEVE carregar ficha alguma: o painel se monta apenas
  com os dados já sincronizados dos atores visíveis.
- **RNF-CTT-02** [MVP] A busca DEVE responder sem consultar o servidor (DEC-CTT-01 mantém a
  lista na escala de dezenas, não de milhares).
- **RNF-CTT-03** [MVP] Uma mudança de condição em ator visível DEVE se refletir no cartão em
  tempo real, sem reabrir a aba.
- **RNF-CTT-04** [MVP] A janela Quem conhece quem DEVE permanecer legível com toda a mesa e
  todos os contatos do mundo, com rolagem própria e cabeçalhos fixos.

## 7. Onde cada coisa é gravada

| O quê                                   | Onde                              | Quem escreve | Referência               |
| --------------------------------------- | --------------------------------- | ------------ | ------------------------ |
| Conhecimento (regra geral + exceções)   | no próprio contato, no `world.db` | servidor     | REQ-CTT-070/072          |
| Título do personagem                    | no próprio ator, no `world.db`    | servidor     | REQ-CTT-023, REQ-CTT-085 |
| Categorias e ordem delas                | cliente, por **mundo + usuário**  | o próprio    | REQ-CTT-055, DEC-UIF-10  |
| Associação contato → categoria          | cliente, por **mundo + usuário**  | o próprio    | REQ-CTT-055              |
| Seções recolhidas, "+N" expandido       | cliente, em memória de sessão     | o próprio    | REQ-CTT-037              |
| Ponto de estado (marca do último visto) | cliente, por **mundo + usuário**  | o próprio    | REQ-CTT-003              |
| Anotação sobre contato                  | na ficha, privada do autor        | —            | DEC-CTT-09               |
| `open` / `activeTab` da gaveta          | cliente (`ClientUIPreferences`)   | o próprio    | REQ-GAV-014              |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "contacts"`, grupo `all`, segunda do grupo, rótulo por chave i18n,
   ícone próprio (REQ-CTT-001).
2. **Badge** — ponto de estado, aceso quando um contato sobe de estado para um personagem do
   usuário, apagado ao abrir a aba (REQ-CTT-002..004).
3. **Cabeçalho do painel** — barra com busca, sem título e sem ✕ (REQ-CTT-010). O Mestre
   ganha, além dele, um **rodapé fixo** com a janela Quem conhece quem (REQ-CTT-060).
4. **Estado vazio** — um por papel para a mesa, e um próprio para os conhecidos, nenhum
   oferecendo criação de ator (REQ-CTT-090..092).
5. **O que abre fora da gaveta** — a ficha (duplo-clique ou botão) e a janela Quem conhece
   quem (REQ-CTT-027, REQ-CTT-061).
6. **Permissão de conteúdo** — `ownership` como portão de acesso e conhecimento como filtro
   adicional, ambos aplicados no módulo único de redação do servidor
   (REQ-CTT-080..085, REQ-DOC-058).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), ordem no trilho (REQ-GAV-003), largura
  (REQ-GAV-012), contrato de badge (REQ-GAV-020..024), preferências locais (REQ-GAV-014),
  fronteira de segurança (REQ-GAV-034), e a DEC-GAV-01, que batizou a aba.
- `02` — `Actor`, `ownership` e resolução (REQ-DOC-028..030); disciplina de redação no
  servidor (REQ-DOC-058), que esta spec estende ao conhecimento.
- `05` — papéis e níveis; `isRolePrivileged` como único predicado de privilégio.
- `11` — janela flutuante (REQ-UIF-009), drag & drop (REQ-UIF-044), teclado (REQ-UIF-064),
  fronteira de persistência (DEC-UIF-10); e REQ-UIF-002, cuja aba "Actors" esta spec
  substitui.
- `15` — registro de condições (REQ-SYS-043) e o princípio de a UI renderizar só o que o
  sistema declarou (REQ-SYS-047).
- `21` — redação de payload por papel (REQ-SEC-020), que sustenta REQ-CTT-081..083.
- `28` — painel de Comitiva (REQ-HUB-043..045): esta spec não exibe vida justamente para não
  duplicá-lo com regra diferente.
- `38` — precedente de fronteira de persistência para curadoria do usuário (dados favoritos
  no aparelho) e de redação de payload que a tela esconde.
- Futura spec da aba **NPCs** — dona da autoria de não-jogadores: criar, excluir, pastas,
  importar.

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-CTT-001 | Jogador abre a aba e vê seu personagem primeiro, os demais em ordem alfabética, e nenhum ponto de vida em nenhum cartão; o Mestre abre a mesma aba e também não vê vida alguma.                       |
| CA-CTT-002 | O familiar do próprio personagem aparece dentro do cartão dele e em nenhum outro lugar da lista; ocultando o dono para aquele usuário, o familiar some junto.                                         |
| CA-CTT-003 | Um personagem com sete condições mostra duas etiquetas e "+5"; acionar expande no próprio cartão; a primeira etiqueta é a crítica, preenchida, e a última é o benefício.                              |
| CA-CTT-004 | Uma condição com valor aparece como "Amedrontado 2" em etiqueta única; ao mudar o valor para 3, a mesma etiqueta passa a "Amedrontado 3", sem surgir uma segunda.                                     |
| CA-CTT-005 | Apontar uma etiqueta mostra o texto de ajuda do sistema; uma condição declarada sem `help` aparece igual, sem tooltip, e uma sem `tone` aparece como situação.                                        |
| CA-CTT-006 | O Mestre põe o ferreiro em `conhecido` para o Tobias e `entrevisto` para a Fofurinha; o jogador da Fofurinha vê "Não identificado" sem nome, e o payload recebido por ele não contém o nome.          |
| CA-CTT-007 | Buscar pelo nome do ferreiro no cliente da Fofurinha não retorna nada; no cliente do Tobias retorna o contato.                                                                                        |
| CA-CTT-008 | O Mestre aciona o nome do contato na grade: a linha inteira vira `conhecido` e a regra geral passa a `conhecido`; um personagem criado depois já enxerga o contato sem nova operação.                 |
| CA-CTT-009 | O Mestre aciona o nome de um personagem recém-chegado na grade e a coluna inteira vira `conhecido` num gesto; as demais colunas permanecem como estavam.                                              |
| CA-CTT-010 | Um jogador com dois personagens, um que conhece e outro que entreviu o mesmo contato, vê o contato identificado (estado maior).                                                                       |
| CA-CTT-011 | O jogador cria duas categorias, move um conhecido para a segunda, reordena a segunda para o topo e recarrega a página: ordem e associação permanecem; outro usuário no mesmo mundo não vê nada disso. |
| CA-CTT-012 | Excluir uma categoria com dois contatos devolve os dois para "Sem categoria" e não remove ator algum.                                                                                                 |
| CA-CTT-013 | Com a aba fechada, o Mestre revela um contato para um personagem do jogador: o ícone da aba ganha o ponto de estado; abrir a aba apaga o ponto; o Mestre nunca vê ponto algum.                        |
| CA-CTT-014 | O painel não oferece criar nem excluir ator em nenhum papel, nem no estado vazio; o rodapé com "Quem conhece quem" aparece só para o Mestre e não rola com a lista.                                   |
| CA-CTT-015 | O jogador não consegue arrastar cartão algum para o mapa; o Mestre arrasta um contato e o token é criado.                                                                                             |
| CA-CTT-016 | Duplo-clique no cartão abre a ficha em janela; o mesmo é alcançável por `Tab` até o botão de ficha e `Enter`, sem depender do duplo-clique.                                                           |

## 11. Questões em aberto

- **Q-CTT-01** — O estado `entrevisto` deve guardar **como** o personagem entreviu o contato
  (cena, data, apelido dado pela mesa)? Hoje é só um degrau, sem memória; a mesa pode querer
  "o encapuzado da ponte".
- **Q-CTT-02** — Categorias no aparelho se perdem ao trocar de máquina. O caminho é exportar
  e importar (REQ-CTT-057) ou promovê-las ao servidor quando existir mecanismo de dado
  privado por usuário? A decisão foi adiada de propósito.
- **Q-CTT-03** — Um personagem pode conhecer outro **personagem de jogador** em grau
  diferente? Hoje a seção Na mesa mostra todos a todos; o conhecimento só se aplica a
  não-jogadores.
- **Q-CTT-04** — Quando um contato é rebaixado (de `conhecido` para `oculto`), o cliente
  deve avisar o jogador de que alguém sumiu da lista, ou o sumiço é silencioso? A posição
  provável é silencioso, como a queda de aba salva na 36.
- **Q-CTT-05** — O título (DEC-CTT-07) vale também para não-jogadores, editável pelo Mestre,
  ou só para personagens de jogador? O protótipo mostra o título do contato vindo do próprio
  ator, o que sugere valer para os dois.
  > **Fechada em 2026-08-16 pela spec 42** (`42-aba-npcs.md`, REQ-NPC-032 e §12): o título
  > vale também para não-jogador e é editável pelo Mestre. Mantida aqui como registro da
  > pergunta e de onde ela foi respondida, não como decisão pendente.

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio (`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `15` | **REQ-SYS-043** já ganhou, em `ConditionDefinition`, os campos `tone` (`"benefit" \| "harm" \| "special"`), `help` (texto curto, traduzido pelo sistema) e `critical?` (booleano) — emenda aplicada na `15` em 2026-08-16, junto de DEC-SYS-10 e do bloco de modelo de dados. São opcionais no schema e têm degradação definida em REQ-CTT-035, para não invalidar sistema já registrado. |
| `11` | **REQ-UIF-002** já teve sua lista de abas substituída pela DEC-GAV-01, na nota que a `36` deixou sob o requisito: a aba "Actors" é a aba **Contatos**, e perde criação e exclusão de ator (DEC-CTT-01) — que não migram para cá nem para lugar nenhum até a aba NPCs existir.                                                                                                             |
| `02` | Nada muda no modelo; registra-se que a redação de REQ-DOC-058 passa a ter um segundo consumidor além de Notes e tokens ocultos: o conhecimento de contato (REQ-CTT-083).                                                                                                                                                                                                                  |
| `05` | Nada muda, e é preciso dizer por quê: a questão em aberto da `05` sobre o nível `LIMITED` cobrir "identificado pelo nome, sem stats" **continua aberta** — esta spec não a responde, porque conhecimento é por personagem e ownership é por usuário (DEC-CTT-03).                                                                                                                         |

## 13. Referências

- Protótipo decidido: `packages/client/prototypes/contacts-tab.prototype.html` (as quatro variantes iniciais estão no histórico do arquivo).
- Grill de 2026-08-16 (sessão de spec-filha da 36).
- Implementação atual, que esta spec passa a definir como alvo:
  `packages/client/src/components/actors/ActorDirectory.svelte` e
  `packages/client/src/lib/actors/actorDirectory.ts` (lista, busca e arraste de hoje);
  `packages/server/src/net/handlers/doc-handlers.ts` (autorização de ator e de companheiro);
  `packages/server/src/net/redaction.ts` (módulo único de redação).
