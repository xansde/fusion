# 38 — Aba Chat

- **Título:** Aba Chat — o painel onde se conversa e se rola dado
- **Status:** draft v0.1 (grill concluído em 2026-08-16)
- **Data:** 2026-08-16
- **Baseada em:**
  - `36-gaveta-lateral.md` — spec-mãe; §7 fixa o contrato que esta filha cumpre.
  - `09-chat-e-mensagens.md` — área dona do conteúdo: `ChatMessage`, tipos, comandos, roll modes, chat cards, log e busca. Esta spec **cita**; nunca redefine.
  - `08-motor-de-rolagens.md` — REQ-ROL-004/006/013/014/015 (sintaxe), REQ-ROL-024 (`roll:request`), REQ-ROL-028..030 (breakdown), REQ-ROL-031..033 (roll modes), REQ-ROL-038/039 (grau de sucesso).
  - Protótipo `packages/client/prototypes/chat-tab.prototype.html` — estado decidido, 2026-08-16 (as quatro variantes iniciais estão no histórico do arquivo).

> **Spec-filha da 36.** Esta spec é dona do **painel** da aba Chat: o que aparece
> nele, em que ordem, quem opera o quê e o que abre fora dele. Ela não define
> largura, posição, gesto de recolher nem persistência de `open`/`activeTab` —
> tudo isso é da 36. E não define o que é uma mensagem, um comando ou um roll
> mode — isso é da 09.

---

## 1. Objetivo

Dar à mesa o lugar onde se conversa e se rola dado sem sair do mapa: um painel que
mostra o que aconteceu com detalhe suficiente para ninguém precisar perguntar "quanto
deu?", e que põe rolar um dado a um clique de distância.

## 2. Escopo

### 2.1 Inclui

- A composição do painel: barra superior, log, fileira de dados, caixa de escrita e seletor de modo.
- Os **dados favoritos** do usuário e a **janela de montagem** de rolagem.
- Como uma rolagem é exibida (detalhe dos dados, rolagens filhas, salvaguardas, alvo).
- A **pesquisa** e a leitura de contexto de um resultado.
- A **invalidação** de mensagem, que substitui a deleção.
- A regra de **não-lidas** desta aba (o contrato de badge da 36).

### 2.2 Não inclui

- O contêiner (trilho, gaveta, largura, gesto de recolher, tipos de badge) → `36-gaveta-lateral.md`.
- O modelo de mensagem, os tipos, os comandos, os chat cards, o log persistente, o export e o flush → `09-chat-e-mensagens.md`.
- A sintaxe de fórmula, o RNG, o breakdown e o cálculo de grau de sucesso → `08-motor-de-rolagens.md`.
- Macros e hotbar → `14-macros-e-automacao.md` (favorito **não** é macro — DEC-ACH-05).
- Seleção de tokens no canvas, que é a origem do alvo → `06-canvas-e-renderizacao.md`.
- Balões de fala sobre o token (chat bubbles) → `09-chat-e-mensagens.md` (REQ-CHT-041..043).
- A política de redação de payload por papel → `21-seguranca.md` (REQ-SEC-020); esta spec só nomeia o que **não pode sair**.

## 3. Conceitos e terminologia

| Conceito               | Definição                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Painel**             | O conteúdo da aba Chat dentro da gaveta: barra superior, log, fileira de dados, caixa de escrita e seletor de modo.                                   |
| **Dado favorito**      | Rolagem guardada pelo usuário: rótulo + fórmula em texto + modo (travado ou "segue o seletor"). Três aparecem na fileira.                             |
| **Seletor de modo**    | A faixa de quatro ícones abaixo da caixa de escrita que define **quem vê** o resultado das rolagens (os quatro roll modes de REQ-CHT-007/DEC-CHT-02). |
| **Janela de montagem** | Janela flutuante que compõe uma rolagem avulsa (quantidade, faces, modificador, rótulo, vantagem, explosão, manter maiores).                          |
| **Rolagem filha**      | Rolagem gerada a partir de um card e exibida dentro dele: ataque, dano, cura, e a salvaguarda de cada alvo.                                           |
| **Alvo**               | Retrato (nome, e a CA usada) do token que estava selecionado no instante da rolagem. Nunca uma referência viva ao token.                              |
| **Invalidar**          | Marcar uma mensagem como sem efeito, mantendo-a no log, acinzentada e riscada. Substitui apagar.                                                      |
| **Janela de contexto** | Janela flutuante que mostra a vizinhança de uma mensagem achada na pesquisa (±5 mensagens visíveis).                                                  |

## 4. Decisões

### DEC-ACH-01 — O painel é log e escrita; o que não couber abre janela, nunca uma tela interna

O painel tem uma única tela: barra superior, log, fileira de dados, caixa de escrita e
seletor de modo. Ele **não** tem navegação interna (nada de índice → seção, nada de "‹
voltar"). Tudo que precisa de mais espaço — montar uma rolagem, ler o contexto de um
resultado, editar os favoritos — abre **janela flutuante** do window manager
(REQ-UIF-009).

- **Racional:** o chat é o único painel que se lê enquanto se joga; trocar o log por
  outra tela apaga a conversa no meio da sessão. Janela sobrepõe, some, e devolve o log
  intacto.
- **Relação com a 37:** a aba Configurações decidiu o contrário (DEC-CFG-04: nada abre
  janela, tudo é drill-in). Não há contradição: aquela aba é um formulário que se visita,
  esta é uma conversa que se acompanha. A 36 permite as duas — §7, item 5, manda cada
  filha declarar o que abre fora da gaveta, e é isso que cada uma está fazendo.

### DEC-ACH-02 — Barra superior fixa: pesquisa e "⋯", nas duas telas

O topo do painel é uma barra com o **campo de pesquisa** ocupando a largura e um botão
**⋯** à direita. A barra existe sempre, para qualquer papel. Não há título "Chat" escrito:
o ícone ativo do trilho já diz onde se está, e a linha de título custa altura que o log usa.

- **Racional:** pesquisa escondida atrás de ícone é pesquisa que ninguém usa; e o "⋯" é o
  endereço fixo do que não se faz todo dia — editar os dados favoritos e, para o Mestre,
  exportar e limpar o log.

### DEC-ACH-03 — A caixa de escrita ocupa a largura toda, cresce com o texto, e Enter envia

A caixa não divide a linha com controle nenhum. Nasce com uma linha, **cresce conforme o
texto** até cinco linhas e só então rola. **Enter envia; Shift+Enter quebra linha.** O texto
de exemplo é curto ("Digite aqui…").

- **Racional:** a caixa é o único lugar do painel onde se produz alguma coisa; tudo o que
  ficava ao lado dela roubava largura de quem escreve. Instrução de teclado mora no
  tooltip do botão de enviar: lê-se uma vez, e nunca mais.

### DEC-ACH-04 — O modo de rolagem é um seletor persistente, e ele manda em todas as rolagens

Abaixo da caixa há uma faixa com **quatro ícones desenhados** (público · ao Mestre · cega ·
só eu), indicador deslizante e texto de ajuda ao passar o mouse ou focar. O modo escolhido
**persiste por mundo e usuário, no aparelho**, e **vale para todas as rolagens** — as da
fileira, as da janela, as de ficha e de card, e as digitadas.

Precedência, do mais forte para o mais fraco:

1. **comando que nomeia o modo** (`/gmroll`, `/blindroll`, `/selfroll`) — vale só para aquela mensagem;
2. **favorito com modo travado** (DEC-ACH-05);
3. **seletor**.

- **Racional:** um lugar só decide a plateia, e ele está visível o tempo todo. O risco
  assumido é rolar em modo privado sem perceber; o seletor persistente e visível é a
  mitigação escolhida, contra a alternativa de resetar para público a cada entrada
  (que trocaria o susto por perder a configuração toda sessão).
- **O que isso muda na 09:** REQ-CHT-017 diz que `/roll` produz **sempre** rolagem pública,
  ignorando o seletor. Essa regra cai: `/roll` passa a obedecer o seletor, porque `/roll`
  não nomeia modo nenhum. Reescrita registrada em §12.
- **Ícones, nunca emoji:** emoji muda de desenho e de cor em cada sistema operacional e não
  acompanha o tema — os quatro modos usam ícones desenhados, como o trilho da 36.

### DEC-ACH-05 — Dados favoritos são do chat, ficam no aparelho e valem por mundo

O usuário guarda **dados favoritos**: rótulo + fórmula em texto + modo (travado num dos
quatro, ou "segue o seletor"). Três aparecem na fileira, acima da caixa de escrita; o quarto
botão abre a janela de montagem.

- **Não são macros** (spec 14). Macro é Document do mundo, tem permissão, hotbar e pode ser
  script; favorito é atalho pessoal de rolagem, sem documento e sem permissão.
- **Ficam no aparelho** (`localStorage`), **por mundo e por usuário** — nunca no servidor.
  Chave é a identidade do mundo, não o endereço: trocar LAN por túnel não perde nada, e dois
  jogadores no mesmo navegador não herdam os favoritos um do outro.
- **Consequências aceitas:** não seguem entre dispositivos (é a mesma fronteira de DEC-UIF-10
  e da DEC-CFG-06), e mundo apagado deixa favorito órfão no aparelho, sem expurgo no MVP.
- **Fórmula:** no MVP, **pura** — dados e números, a sintaxe de REQ-ROL-001..013. Referência a
  atributo (`1d20 + Força + percepção`) é [V2] e depende de um **vocabulário nomeado declarado
  pelo sistema** (e, depois, acrescentado por mods) sobre a resolução que REQ-ROL-014/015 já faz.
  O chat nunca resolve nome nenhum: ele manda a fórmula ao servidor.
- **Racional:** fórmula pura funciona sem ator, o que faz o mesmo favorito servir ao jogador e
  ao Mestre no MVP. E guardar no servidor exigiria dar a primeira UI ao `preferences` de
  REQ-USR-003, que a 37 deliberadamente deixou sem tela.

### DEC-ACH-06 — A janela de montagem compõe a rolagem; ela não escolhe a plateia

A janela monta **o que** se rola: quantidade, faces, modificador, rótulo, vantagem/desvantagem,
explosão, manter maiores, com prévia da fórmula resultante. Ela **não** tem seletor de modo —
apenas informa em que modo a rolagem vai sair, apontando para o seletor do painel. Salvar
a montagem como favorito cria um favorito "segue o seletor".

- **Racional:** dois lugares decidindo quem vê é o começo de todo vazamento. A janela responde
  "o que rolo"; o seletor responde "quem vê".

### DEC-ACH-07 — A pesquisa é do servidor, é de todos, e o resultado abre contexto

O campo da barra superior pesquisa **no log inteiro do mundo** (FTS5, REQ-CHT-036), não no que
está carregado na tela. Vale para **qualquer papel**, e o servidor devolve apenas o que aquele
usuário poderia ver no histórico — mesmo predicado, sem segunda regra de visibilidade.

Clicar num resultado abre uma **janela de contexto**: a mensagem achada com **±5 mensagens que o
pesquisador pode ver**, e "mais 5" para cada lado, sob demanda. Uma janela por vez; o log ao vivo
continua correndo atrás, sem perder posição.

- **±5 do que é visível, não ±5 do log:** contar mensagem invisível — mesmo sem exibi-la —
  deixaria deduzir que houve conversa privada ali.
- **Racional:** filtrar só o bloco carregado acharia nas últimas 50 mensagens e calaria sobre o
  resto, o que é pior que não ter busca. E ler o contexto numa janela evita o pior efeito da
  alternativa (mandar o log ao passado): perder o lugar no meio da sessão.

### DEC-ACH-08 — Nada é apagado do log: invalida-se, com autoria

Mensagem não é deletada. Ela é **invalidada**: continua no lugar, acinzentada e riscada, com
selo dizendo quem invalidou.

- **Quem invalida:** o Mestre, ou o **autor** da mensagem.
- **Quem revalida:** o Mestre, sempre; o autor, **só o que ele mesmo invalidou**. Invalidação do
  Mestre é palavra final.
- **Registra-se quem e quando** (`invalidatedBy`, `invalidatedAt`).
- **Invalidar é anotação, não desfazimento:** dano já aplicado, iniciativa já lançada e efeito já
  criado continuam onde estão. Quem decide o que fazer a seguir é o narrador.
- **Racional:** o log é o registro do que aconteceu na mesa; apagar uma rolagem ruim é reescrever
  a história e é exatamente o que gera a discussão que ninguém quer ter. Riscar resolve o caso
  real ("essa não valeu") sem abrir a porta para o caso ruim.
- **O que isso substitui:** REQ-CHT-005 (o Mestre deleta mensagens individuais) — reescrito em §12.
  O flush do log inteiro (REQ-CHT-006) continua existindo: é operação de manutenção do mundo,
  não moderação de mensagem.

### DEC-ACH-09 — Alvo é retrato do momento, e o jogador vê o grau, nunca a CA

Uma rolagem de ataque **pode** carregar alvo: quando há token selecionado no instante da rolagem,
o card guarda um **retrato** do alvo — nome, e a CA usada para graduar — nunca uma referência viva
ao token.

- **Sem alvo selecionado, não existe grau:** a rolagem sai com o total e nada mais. Grau sem CA
  seria chute apresentado como regra.
- **O payload entregue a quem não é Mestre NÃO DEVE conter a CA.** O jogador vê o nome do alvo e o
  grau ("Sucesso Crítico"); a CA fica no payload do Mestre. Esconder na tela não esconde nada:
  quem lê o socket lê o número.
- **Racional:** o grau é a informação que faz a mesa andar; a CA do monstro é informação que o
  Mestre decide dar ou não. Retrato em vez de referência porque o log tem que continuar
  verdadeiro depois que o token morre, sai da cena ou é renomeado.
- **Mecânica de seleção é futura:** hoje não há alvo no Fusion. Esta spec fixa a forma do campo e
  o que aparece na tela, para que ligar a seleção seja preencher um campo opcional, não redesenhar
  o card.

### DEC-ACH-10 — Os dados individuais aparecem sempre, sem clique

Toda rolagem exibida mostra a fórmula e **os valores de cada dado** (`2d4+4 → [3, 2] + 4`),
inclusive as rolagens filhas de dano e cura e **cada salvaguarda de alvo**. Não há breakdown
escondido atrás de clique no MVP.

- **Racional:** o que a mesa pergunta em voz alta é "quanto deu no dado?", não "qual era a
  fórmula". O `RollResult` já carrega isso (REQ-ROL-028..030); esconder era decisão de tela, não
  falta de dado.
- **Custo assumido:** cada mensagem fica uma linha mais alta. É o motivo de a seção de
  salvaguardas continuar colapsando acima de quatro alvos.

### DEC-ACH-11 — Abrir o Chat marca como lido e leva você ao ponto onde parou

Abrir a aba Chat **zera o contador** de não-lidas do trilho. O log abre posicionado na **primeira
mensagem não lida**, não no fim, com a linha "N novas" marcando o ponto; a linha some quando o
usuário chega ao fim do log.

- Com a aba **aberta** e o usuário rolado para cima lendo o passado, mensagem nova **não rouba o
  scroll**: aparece o aviso flutuante "↓ N novas", e o contador do trilho não acende.
- **Racional:** abrir é o gesto de ler; contador que sobrevive à abertura vira número que ninguém
  acredita. Abrir no fim faria perder exatamente as mensagens que o contador prometia.
- **Relação com a 36:** REQ-GAV-022 delega à filha a regra que zera o contador; esta spec é a filha
  e a regra é esta. A redação da 36 ("abrir a aba não altera badge nenhum") é ajustada em §12 para
  dizer o que ela quer dizer: **o trilho** não mexe no badge sozinho.

### DEC-ACH-12 — Sem dados 3D no painel

O painel **não** hospeda canvas de dados 3D nem o interruptor dele. Animação de dado é assunto de
um **mod futuro**, e é ele que decidirá onde os dados rolam.

- **Racional:** dado 3D rolando em 300px de gaveta é animação que ninguém vê; e rolar sobre a mesa
  inteira é decisão de quem for dono da camada visual, não do painel de conversa.
- **Consequência imediata:** o `dice-box` sai do `ChatPanel` do cliente. A dependência pode
  permanecer no repositório, desligada, até o mod existir.

## 5. Requisitos funcionais

> Blocos de dezena: 001–009 identidade e badge; 010–019 barra superior e pesquisa; 020–029 log e
> leitura; 030–039 escrita; 040–049 modo de rolagem; 050–059 dados favoritos; 060–069 janela de
> montagem; 070–079 alvo; 080–089 invalidação; 090–099 permissão e redação. Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-ACH-001** [MVP] A aba DEVE se registrar por `registerSidebarTab` (REQ-GAV-030) com
  `id: "chat"`, `group: "all"`, ícone próprio e rótulo por chave i18n, como primeira aba do grupo
  (REQ-GAV-003).
- **REQ-ACH-002** [MVP] A aba DEVE fornecer um badge do tipo **contador** (REQ-GAV-020) com o número
  de mensagens não lidas.
- **REQ-ACH-003** [MVP] Uma mensagem recebida enquanto a aba Chat NÃO está aberta DEVE incrementar o
  contador; mensagem recebida com a aba aberta NÃO DEVE incrementá-lo.
- **REQ-ACH-004** [MVP] Abrir a aba Chat DEVE zerar o contador (REQ-CHT-039), e o painel DEVE abrir
  com o log posicionado na **primeira mensagem não lida**, exibindo um marcador "N novas" imediatamente
  antes dela.
- **REQ-ACH-005** [MVP] O marcador "N novas" DEVE permanecer visível até que o usuário alcance o fim do
  log, e então desaparecer. Trocar de aba ou recolher a gaveta NÃO DEVE recriá-lo.
- **REQ-ACH-006** [MVP] Com a aba aberta e o log fora do fim, uma mensagem nova NÃO DEVE rolar o log
  automaticamente: o cliente DEVE exibir um aviso flutuante com a quantidade acumulada, que ao ser
  acionado leva ao fim do log.

### 5.2 Barra superior e pesquisa

- **REQ-ACH-010** [MVP] O painel DEVE exibir, no topo e para qualquer papel, uma barra fixa com um campo
  de pesquisa ocupando a largura disponível e um botão de mais ações ("⋯"). A barra NÃO DEVE exibir
  título textual da aba.
- **REQ-ACH-011** [MVP] Digitar na pesquisa DEVE consultar o **servidor** (REQ-CHT-036) e substituir o log
  pela lista de resultados, com autor, hora e trecho, destacando o termo; limpar o campo DEVE devolver o
  log ao vivo na posição em que estava.
- **REQ-ACH-012** [MVP] A pesquisa DEVE estar disponível para **todos os papéis**, e o servidor DEVE
  aplicar aos resultados o mesmo predicado de visibilidade do histórico (REQ-CHT-004), sem segunda regra.
- **REQ-ACH-013** [MVP] Acionar um resultado DEVE abrir uma **janela de contexto** (REQ-UIF-009) com a
  mensagem alvo destacada e as **5 mensagens visíveis** anteriores e posteriores, mais um controle "mais 5"
  para cada lado. A contagem DEVE considerar apenas mensagens visíveis ao usuário.
- **REQ-ACH-014** [MVP] DEVE existir no máximo **uma** janela de contexto por vez: acionar outro resultado
  reaproveita a mesma janela. O log ao vivo NÃO DEVE ser alterado enquanto ela estiver aberta.
- **REQ-ACH-015** [MVP] O botão "⋯" DEVE oferecer, para qualquer papel, o editor de **dados favoritos**
  (REQ-ACH-055) e, apenas para `role === GAMEMASTER`, exportar o log (REQ-CHT-037) e limpar o log
  (REQ-CHT-006).

### 5.3 Log e leitura

- **REQ-ACH-020** [MVP] O log DEVE ocupar toda a largura do painel e toda a altura que sobra entre a barra
  superior e a fileira de dados.
- **REQ-ACH-021** [MVP] Toda rolagem exibida DEVE mostrar, sem exigir interação, a fórmula, **os valores de
  cada dado** e o modificador aplicado, além do total (REQ-ROL-028..030).
- **REQ-ACH-022** [MVP] Rolagens filhas de um card (ataque, dano, cura) DEVEM ser exibidas dentro do card,
  cada uma com os valores dos dados e, quando houver, o grau de sucesso.
- **REQ-ACH-023** [MVP] Salvaguardas de alvos DEVEM ser exibidas uma por linha, com nome do alvo, grau de
  sucesso e os valores dos dados do teste; quando a magia for de save básico, cada linha DEVE exibir a
  consequência do grau.
- **REQ-ACH-024** [MVP] A seção de salvaguardas DEVE exibir no máximo **4** linhas, com um controle que
  expande para todas e recolhe de volta.
- **REQ-ACH-025** [MVP] Mensagens consecutivas do mesmo autor DEVEM ser agrupadas sem repetir o cabeçalho;
  cards, sussurros e mensagens invalidadas nunca são agrupados.
- **REQ-ACH-026** [MVP] O rascunho não enviado, a posição do log e o histórico de entrada DEVEM sobreviver
  à troca de aba (REQ-GAV-017), vivendo fora do componente do painel.

### 5.4 Escrita

- **REQ-ACH-030** [MVP] A caixa de escrita DEVE ocupar toda a largura do painel, ao lado apenas do botão de
  enviar; nenhum outro controle DEVE dividir a linha com ela.
- **REQ-ACH-031** [MVP] A caixa DEVE começar com uma linha e **crescer com o conteúdo** até 5 linhas,
  passando a rolar apenas depois disso. O texto de exemplo DEVE ser curto e não conter instruções.
- **REQ-ACH-032** [MVP] **Enter** DEVE enviar e **Shift+Enter** DEVE inserir quebra de linha. A instrução
  correspondente DEVE aparecer no tooltip do botão de enviar, não dentro do campo.
- **REQ-ACH-033** [MVP] A caixa DEVE aceitar os comandos de REQ-CHT-013 e roteá-los ao servidor sem executar
  RNG local (REQ-ROL-020/024).
- **REQ-ACH-034** [MVP] Enviar DEVE limpar a caixa e levar o log ao fim.

### 5.5 Modo de rolagem

- **REQ-ACH-040** [MVP] Abaixo da caixa, o painel DEVE exibir um seletor com os **quatro** roll modes
  (DEC-CHT-02), representados por **ícones desenhados** — NÃO DEVE usar emoji —, com indicação visual do
  modo ativo e texto de ajuda ao passar o ponteiro ou focar cada opção.
- **REQ-ACH-041** [MVP] O modo selecionado DEVE persistir por **mundo e usuário** no cliente
  (`localStorage`, DEC-UIF-10) e ser restaurado ao reabrir o mundo; NÃO DEVE ser enviado ao servidor como
  preferência.
- **REQ-ACH-042** [MVP] O modo selecionado DEVE ser aplicado a **todas** as rolagens originadas nesta aba,
  na ficha, em cards e na janela de montagem — inclusive `/roll` (reescrita de REQ-CHT-017, §12).
- **REQ-ACH-043** [MVP] Um comando que **nomeia** o modo (`/gmroll`, `/blindroll`, `/selfroll`) DEVE
  prevalecer sobre o seletor **apenas na mensagem em que foi digitado**, sem alterar o seletor.
- **REQ-ACH-044** [MVP] Um favorito com modo travado (REQ-ACH-052) DEVE prevalecer sobre o seletor e exibir
  o ícone do seu modo no próprio botão.
- **REQ-ACH-045** [MVP] O seletor NÃO DEVE alterar a visibilidade de mensagens de texto: texto sem comando
  continua sendo mensagem pública, e privado por texto é `/w` (REQ-CHT-014).

### 5.6 Dados favoritos

- **REQ-ACH-050** [MVP] Acima da caixa de escrita, o painel DEVE exibir uma fileira com **três** dados
  favoritos e um quarto botão que abre a janela de montagem (REQ-ACH-060).
- **REQ-ACH-051** [MVP] Um favorito DEVE conter rótulo, fórmula em texto e modo; acioná-lo DEVE enviar a
  rolagem ao servidor imediatamente, sem diálogo intermediário.
- **REQ-ACH-052** [MVP] O modo de um favorito DEVE ser "segue o seletor" (padrão) ou **travado** em um dos
  quatro roll modes.
- **REQ-ACH-053** [MVP] Favoritos DEVEM ser gravados **no cliente**, com escopo de **mundo + usuário**,
  identificado pelo id do mundo e não pelo endereço do servidor. NÃO DEVEM ser enviados ao servidor nem
  gerar Document.
- **REQ-ACH-054** [MVP] No MVP, a fórmula de um favorito DEVE conter apenas termos de dado e números
  (REQ-ROL-001..013); referência a atributo (`@`, ou nome declarado) NÃO DEVE ser aceita, e a tentativa DEVE
  falhar com mensagem legível.
- **REQ-ACH-055** [MVP] O editor de favoritos DEVE abrir em janela flutuante pelo "⋯" e permitir alterar
  rótulo, fórmula e modo de cada um dos três.
- **REQ-ACH-056** [V2] A fórmula de um favorito DEVE aceitar **nomes de atributo declarados pelo sistema**
  (e, quando houver, por mods), resolvidos no servidor no instante do clique contra o ator do usuário —
  ou, para papel privilegiado sem ator, contra o token selecionado. O chat NÃO DEVE conhecer nome nenhum:
  a resolução é de REQ-ROL-014/015 sobre o vocabulário que o sistema declarar.
- **REQ-ACH-057** [MVP] Favoritos NÃO DEVEM ser macros (spec 14): não têm Document, permissão, hotbar nem
  execução de script.

### 5.7 Janela de montagem

- **REQ-ACH-060** [MVP] A janela de montagem DEVE permitir compor: quantidade de dados, faces, modificador,
  rótulo (REQ-ROL-013), vantagem/desvantagem, explosão (REQ-ROL-006) e manter maiores (REQ-ROL-004), e DEVE
  exibir a fórmula resultante antes de rolar.
- **REQ-ACH-061** [MVP] A janela NÃO DEVE oferecer escolha de roll mode; ela DEVE exibir em que modo a
  rolagem sairá, conforme o seletor do painel (DEC-ACH-06).
- **REQ-ACH-062** [MVP] A janela DEVE oferecer "salvar como favorito", criando um favorito com o rótulo e a
  fórmula montados e modo "segue o seletor".
- **REQ-ACH-063** [MVP] A janela DEVE ser janela flutuante do window manager (REQ-UIF-009) e NÃO DEVE
  alterar a largura da gaveta (REQ-GAV-012).

### 5.8 Alvo

- **REQ-ACH-070** [MVP] Uma rolagem de ataque PODE carregar um **alvo**; quando carregar, a mensagem DEVE
  exibir o nome do alvo e o **grau de sucesso** calculado pelo sistema (REQ-ROL-038/039).
- **REQ-ACH-071** [MVP] Sem alvo, a mensagem DEVE exibir apenas o total: o cliente NÃO DEVE apresentar grau
  de sucesso algum.
- **REQ-ACH-072** [MVP] O alvo gravado na mensagem DEVE ser um **retrato** (nome, e o valor de CA usado),
  nunca uma referência ao token; alterações posteriores no token NÃO DEVEM alterar a mensagem.
- **REQ-ACH-073** [MVP] O payload entregue a usuário sem papel privilegiado NÃO DEVE conter a CA do alvo
  (REQ-SEC-020); o grau, já calculado no servidor, DEVE ser entregue.
- **REQ-ACH-074** [MVP] Uma magia com salvaguarda PODE carregar vários alvos; um ataque carrega **um**.
  Sem alvos, o card DEVE exibir apenas o botão de rolar resistência, sem seção de salvaguardas.

### 5.9 Invalidação

- **REQ-ACH-080** [MVP] O painel NÃO DEVE oferecer deleção de mensagem. Toda moderação de mensagem
  individual DEVE ser feita por **invalidação** (reescrita de REQ-CHT-005, §12).
- **REQ-ACH-081** [MVP] Uma mensagem invalidada DEVE permanecer no log, na mesma posição, com apresentação
  atenuada e o valor riscado, e DEVE exibir quem a invalidou.
- **REQ-ACH-082** [MVP] Invalidar DEVE ser permitido a `role === GAMEMASTER` e ao **autor** da mensagem; a
  qualquer outro usuário o servidor DEVE recusar.
- **REQ-ACH-083** [MVP] Revalidar DEVE ser permitido ao Mestre sempre; ao autor, **apenas** se a invalidação
  tiver sido feita por ele mesmo. Invalidação feita pelo Mestre NÃO DEVE ser revertida pelo autor.
- **REQ-ACH-084** [MVP] A mensagem DEVE registrar quem invalidou e quando (`invalidatedBy`, `invalidatedAt`),
  e o registro DEVE sobreviver à revalidação como histórico da última operação.
- **REQ-ACH-085** [MVP] Invalidar NÃO DEVE desfazer efeito nenhum fora do log: dano aplicado, iniciativa
  lançada e efeitos criados permanecem, e nenhuma operação automática DEVE ser disparada.
- **REQ-ACH-086** [MVP] Invalidação DEVE ser persistida e propagada a todos os clientes elegíveis, como
  qualquer atualização de mensagem.

### 5.10 Permissão e redação

- **REQ-ACH-090** [MVP] Esconder um controle no cliente NÃO É proteção (REQ-GAV-034): exportar, limpar,
  revelar (REQ-CHT-045) e invalidar DEVEM ser verificados no servidor.
- **REQ-ACH-091** [MVP] A busca, a janela de contexto e o log DEVEM derivar visibilidade dos mesmos campos
  (`whisper`, `blind` — DEC-CHT-02/DEC-CHT-10); NÃO DEVE existir predicado próprio desta aba.
- **REQ-ACH-092** [MVP] Nenhum payload entregue a usuário não privilegiado DEVE conter dado que a tela
  esconde dele — em particular a CA do alvo (REQ-ACH-073) e o resultado de rolagem cega (REQ-ROL-032).

## 6. Requisitos não-funcionais

- **RNF-ACH-01** [MVP] Acionar um favorito DEVE emitir a rolagem sem abrir diálogo e sem bloquear a caixa
  de escrita.
- **RNF-ACH-02** [MVP] Abrir a aba com histórico extenso DEVE posicionar o log na primeira não lida sem
  carregar o histórico inteiro (paginação por cursor, DEC-CHT-06).
- **RNF-ACH-03** [MVP] O painel NÃO DEVE hospedar canvas de dados 3D nem carregar o código correspondente
  (DEC-ACH-12).
- **RNF-ACH-04** [MVP] Todo controle do painel DEVE ser operável por teclado com foco visível
  (REQ-UIF-064), incluindo o seletor de modo e os favoritos.

## 7. Onde cada coisa é gravada

| O quê                                   | Onde                             | Quem escreve | Referência               |
| --------------------------------------- | -------------------------------- | ------------ | ------------------------ |
| Dados favoritos (rótulo, fórmula, modo) | cliente, por **mundo + usuário** | o próprio    | REQ-ACH-053, DEC-UIF-10  |
| Modo de rolagem selecionado             | cliente, por **mundo + usuário** | o próprio    | REQ-ACH-041              |
| Rascunho, posição do log, histórico ↑↓  | cliente, em memória de sessão    | o próprio    | REQ-ACH-026, REQ-GAV-017 |
| Mensagens, rolagens e cards             | `chat_messages` no `world.db`    | servidor     | REQ-CHT-001              |
| Invalidação (quem, quando)              | na própria `ChatMessage`         | servidor     | REQ-ACH-084              |
| Alvo (retrato: nome + CA usada)         | na própria `ChatMessage`         | servidor     | REQ-ACH-072              |
| `open` / `activeTab` da gaveta          | cliente (`ClientUIPreferences`)  | o próprio    | REQ-GAV-014              |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "chat"`, grupo `all`, primeira do grupo, rótulo por chave i18n, ícone próprio
   (REQ-ACH-001).
2. **Badge** — contador de não lidas; acende com mensagem recebida de aba fechada e zera ao abrir a aba
   (REQ-ACH-002..004).
3. **Cabeçalho do painel** — barra com pesquisa e "⋯", sem título e sem ✕ (REQ-ACH-010).
4. **Estado vazio** — "Nenhuma mensagem ainda", com a dica de que se escreve abaixo ou se rola pelo dado
   favorito (REQ-ACH-020 c/ REQ-CHT-033).
5. **O que abre fora da gaveta** — janela de montagem, janela de contexto e editor de favoritos
   (DEC-ACH-01).
6. **Permissão de conteúdo** — visibilidade derivada de `whisper`/`blind` no servidor; escrita privilegiada
   (exportar, limpar, revelar) e invalidação verificadas no servidor (REQ-ACH-090..092).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), largura (REQ-GAV-012), gesto de recolher (DEC-GAV-03), contrato
  de badge (REQ-GAV-020..023), montagem só da aba ativa (REQ-GAV-017), fronteira de segurança (REQ-GAV-034).
- `09` — dona do conteúdo: modelo, tipos, comandos (REQ-CHT-013/014), visibilidade (REQ-CHT-004,
  DEC-CHT-02/DEC-CHT-10), log e paginação (REQ-CHT-033/034), busca (REQ-CHT-036), export (REQ-CHT-037),
  flush (REQ-CHT-006), badge (REQ-CHT-039), revelação (REQ-CHT-045..049).
- `08` — sintaxe e avaliação: REQ-ROL-004/006/013, `@attr` (REQ-ROL-014/015), `roll:request` (REQ-ROL-024),
  breakdown (REQ-ROL-028..030), modos (REQ-ROL-031..033), grau de sucesso (REQ-ROL-038/039).
- `11` — janelas flutuantes (REQ-UIF-009), teclado (REQ-UIF-064), fronteira de persistência (DEC-UIF-10).
- `14` — macros e hotbar: favorito **não** é macro (REQ-ACH-057).
- `21` — redação de payload por papel (REQ-SEC-020), que é o que sustenta REQ-ACH-073/092.
- `37` — decide o oposto quanto a janelas para a própria aba (DEC-CFG-04); as duas convivem sob §7 da 36.
- `06` — origem do alvo (seleção de token), cuja mecânica ainda não existe.

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-ACH-001 | Com a aba fechada chegam 3 mensagens: o ícone de Chat mostra "3"; abrir a aba zera o badge e o log abre na primeira das três, com o marcador "3 novas" acima dela.                                    |
| CA-ACH-002 | Com o Chat aberto e o log rolado para cima, chega mensagem: o log não se move, aparece o aviso "↓ 1 nova", e o badge do trilho não acende.                                                            |
| CA-ACH-003 | Digitar duas linhas com Shift+Enter faz a caixa crescer sem barra de rolagem; Enter envia e a caixa volta a uma linha.                                                                                |
| CA-ACH-004 | Com o seletor em "cega", digitar `/roll 1d20` produz rolagem cega; digitar `/gmroll 1d20` produz rolagem ao Mestre e o seletor continua em "cega".                                                    |
| CA-ACH-005 | Um favorito travado em "cega" rola cego com o seletor em "público", e exibe o ícone do modo no botão.                                                                                                 |
| CA-ACH-006 | Favoritos criados no mundo A não aparecem no mundo B; trocar o endereço de acesso do mundo A (LAN → túnel) mantém os favoritos; outro usuário no mesmo navegador vê os seus.                          |
| CA-ACH-007 | A janela de montagem compõe `2d20kh1+7`, mostra a fórmula, informa o modo do seletor e não oferece escolha de modo; "salvar como favorito" cria um favorito "segue o seletor".                        |
| CA-ACH-008 | Uma rolagem de dano exibe `2d4+4 → [3, 2] + 4` e o total sem nenhum clique; uma magia com 5 alvos mostra 4 salvaguardas com os dados de cada teste e "ver todas (5)".                                 |
| CA-ACH-009 | Ataque com alvo selecionado exibe nome e "Sucesso Crítico" para todos; o payload recebido pelo jogador não contém a CA; sem alvo, a mesma rolagem não exibe grau algum.                               |
| CA-ACH-010 | O jogador invalida a própria rolagem e a revalida; o Mestre invalida a mesma rolagem e o botão de revalidar some para o jogador; a mensagem nunca sai do log, e o dano já aplicado continua aplicado. |
| CA-ACH-011 | Um jogador pesquisa "alavanca": encontra a própria mensagem e não encontra o sussurro que o Mestre mandou a outro jogador; o Mestre, pesquisando o mesmo termo, encontra os dois.                     |
| CA-ACH-012 | Acionar um resultado abre a janela de contexto com ±5 mensagens visíveis; "mais 5 acima" amplia; abrir outro resultado reaproveita a mesma janela; o log ao vivo continua onde estava.                |
| CA-ACH-013 | Nenhum canvas de dados 3D é montado pelo painel, e o código do `dice-box` não é carregado ao abrir a aba.                                                                                             |

## 11. Questões em aberto

- **Q-ACH-01** — Quem declara o **vocabulário nomeado** de REQ-ACH-056: a spec 15 (contrato de sistema) ou
  cada sistema livremente? E o nome é chave i18n ou identificador estável? Decisão da `15`.
- **Q-ACH-02** — Invalidar um **card** com rolagens filhas invalida as filhas junto, ou cada uma é
  invalidada por si? A pergunta prática: uma salvaguarda invalidada dentro de um card válido.
- **Q-ACH-03** — O **export** do log (REQ-CHT-037) inclui mensagens invalidadas e a marca de invalidação?
  A posição provável é sim — o export é o mesmo registro histórico.
- **Q-ACH-04** — Favorito cuja fórmula deixou de ser válida (o usuário editou errado, ou um sistema
  mudou): o botão fica desabilitado com motivo, ou falha ao clicar?

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio (`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `09` | **REQ-CHT-005** deixa de ser deleção de mensagem e passa a ser **invalidação** (DEC-ACH-08). **REQ-CHT-017** perde a exceção "`/roll` sempre público": o seletor manda em todas as rolagens (DEC-ACH-04). Entram **REQ-CHT-050** (busca para todos, com o filtro do histórico) e **REQ-CHT-051** (consulta de contexto ao redor de uma mensagem). |
| `36` | **REQ-GAV-022** e **DEC-GAV-06** ganham redação explícita: quem não altera o badge é **o trilho**; a spec-filha pode alterá-lo, e a do Chat zera ao abrir a aba.                                                                                                                                                                                  |
| `13` | Nada muda: o som de notificação de chat continua no canal de interface (REQ-AUD-015/016) e seu interruptor mora na aba Configurações (REQ-CFG-021).                                                                                                                                                                                               |

## 13. Referências

- Protótipo decidido: `packages/client/prototypes/chat-tab.prototype.html` (variantes 1–4 no histórico do arquivo).
- Grill de 2026-08-16 (sessão de spec-filha da 36).
- Implementação atual do chat no cliente (`packages/client/src/components/chat/`) e no servidor
  (`packages/server/src/chat/chat-handler.ts`), que esta spec passa a definir como alvo.
