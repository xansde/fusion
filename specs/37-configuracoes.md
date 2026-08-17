# 37 — Configurações

- **Título:** Configurações — a aba onde se vê e se muda o que é configurável
- **Status:** draft v0.1 (grill concluído em 2026-08-15)
- **Data:** 2026-08-15
- **Baseada em:**
  - `36-gaveta-lateral.md` — spec-mãe; §7 fixa o contrato que esta filha cumpre.
  - `05-usuarios-e-permissoes.md` — REQ-USR-008/009 (permissões), REQ-USR-025..031 (administração de usuários), que hoje não têm nenhuma tela.
  - `15-api-de-sistemas.md` — DEC-SYS-08 e REQ-SYS-047: o motor de settings declaradas, que existe e nunca teve volante.
  - `13-audio-e-playlists.md` — REQ-AUD-015/016 e DEC-AUD-02: os três canais de volume, já decididos como locais.
  - Protótipo `packages/client/prototypes/settings-tab.prototype.html` — variante 4 (índice → seção), aprovada em 2026-08-15 sem os ícones.

> **Spec-filha da 36.** Esta spec é dona do **conteúdo** da aba Configurações. Ela não
> define largura, posição, gesto de recolher nem persistência de `open`/`activeTab` —
> tudo isso é da 36. Onde toca área alheia (usuários, permissões, settings de sistema,
> áudio), ela **cita**: nunca redefine.

---

## 1. Objetivo

Dar um lugar único, dentro do jogo, para ver e mudar o que é configurável — separando
com clareza o que é do aparelho de quem joga (som) do que é da mesa inteira (regras
variantes, permissões, usuários, mods).

## 2. Escopo

### 2.1 Inclui

- As seções da aba, o que cada uma mostra e quem as vê.
- A navegação interna da aba (índice → seção).
- A régua de **onde cada valor é gravado** e quem pode escrevê-lo.
- O lugar dos mods na tela, antes de existir um único mod.

### 2.2 Não inclui

- O contêiner (trilho, gaveta, estado, badge, largura) → `36-gaveta-lateral.md`.
- **Configuração de servidor e instalação** — porta, atalho de desktop, túnel,
  auto-update, Admin Key → `22-instalacao-e-distribuicao.md`,
  `24-operacao-backups-telemetria.md` e o wizard `/setup` (DEC-CFG-02).
- **O que é um mod**, seus pontos de registro e o carregamento → spec futura da API de
  Mods; REQ-ESC-012 mantém plugin dinâmico fora do MVP.
- O **motor** de settings — declaração, schema, escopo, `get`/`set` → `15-api-de-sistemas.md`
  (DEC-SYS-08, REQ-SYS-047). Esta spec só o renderiza.
- Canais de áudio, volume final e playback → `13-audio-e-playlists.md`.
- Semântica de papéis, ownership e as regras de administração de usuários →
  `05-usuarios-e-permissoes.md`.
- O modelo das regras variantes de PF2e → `17-sistema-pf2e.md` e
  `30-multiclasse-por-niveis.md` (esta spec decide **onde se opera**, não como derivam).

## 3. Conceitos e terminologia

| Conceito              | Definição                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seção**             | Um assunto configurável da aba (ex.: Mundo). Uma seção por tela: o painel mostra o índice ou uma seção, nunca as duas.                             |
| **Índice**            | A tela inicial da aba: a lista das seções que o usuário pode abrir.                                                                                |
| **Setting declarada** | Valor declarado por um sistema (e, no futuro, por um mod) com chave, escopo, schema e default — REQ-SYS-047. A aba renderiza; não conhece a chave. |
| **Preferência local** | Valor que vive no dispositivo de quem joga e nunca vai ao servidor (DEC-UIF-10, DEC-AUD-02).                                                       |
| **Regra variante**    | Regra opcional de campanha que muda a derivação de todos os personagens da mesa (arquétipo livre, multiclasse por nível).                          |
| **Mod**               | Pacote opcional, desligável por mundo, que acrescenta painéis, camadas ou regras. Definido pela spec futura da API de Mods; aqui só tem endereço.  |

## 4. Decisões

### DEC-CFG-01 — A aba é a casa da configuração do jogo, e a casa dos mods nasce nela

A aba reúne o que se configura no jogo: preferências de quem joga, regras da mesa,
permissões, usuários e mods. A seção **Mods existe desde o MVP**, mesmo sem nenhum mod
existir — o endereço é fixado agora para que a API de Mods, quando vier, encontre lugar
pronto em vez de negociar espaço na tela.

- **Racional:** "onde eu configuro isso?" precisa ter uma resposta só. E endereço vazio
  reservado custa uma seção; endereço inexistente custa uma renegociação de layout no
  dia em que o primeiro mod chegar.

### DEC-CFG-02 — Configuração de servidor fica fora da aba, inclusive o estado

Porta, atalho de desktop, túnel, auto-update e Admin Key **não** aparecem na aba — nem
para operar, nem para ler estado. Continuam no wizard `/setup` e nas specs 22/24.

- **Racional:** as rotas `/admin/*` são guardadas por credencial própria (Admin Key
  Argon2id, token emitido por `/admin/login`, com lockout em banco separado do
  `world.db`). `role === GAMEMASTER` **não é** credencial de admin. Trazer isso para
  dentro do jogo obrigaria a aba a pedir uma segunda credencial ou a afrouxar o gate —
  e essas configurações são anteriores ao mundo, com dono próprio nas specs 22 e 24.
- **Alternativa rejeitada:** _mostrar o estado da conexão (LAN/túnel) em leitura, com
  link para o `/setup`_ — resolveria o caso real de ligar o túnel no meio da sessão,
  mas exigiria um caminho de leitura autorizado pelo login de mundo só para isso.

### DEC-CFG-03 — A aba fica no grupo de todos, ancorada no rodapé do trilho

Configurações sai do grupo GM (onde DEC-GAV-01 a havia posto) e passa ao grupo `all`,
ancorada no **rodapé** do trilho, separada dos dois grupos. O conteúdo varia por papel.

- **Racional:** o jogador precisa de um lugar para o próprio som; se a aba fosse só do
  GM, "configuração" teria dois endereços diferentes conforme o papel. Ancorar no pé
  mantém a posição idêntica nas duas telas — o princípio de memória motora de
  DEC-GAV-01 — sem empurrar o grupo GM para baixo.
- **O que isso muda na 36:** DEC-GAV-01, REQ-GAV-003, REQ-GAV-004 e CA-GAV-001 passam a
  descrever três blocos (grupo de todos, grupo GM, rodapé); o grupo GM fica com NPCs e
  Cenas. Emenda registrada no mesmo PR (§12).

### DEC-CFG-04 — Índice → seção, dentro da gaveta; nada abre janela flutuante

A aba abre num **índice** de seções; escolher uma entra nela, com um "‹" no cabeçalho
para voltar. Tudo acontece dentro dos 300px: **nenhuma tela desta aba abre janela
flutuante**, e nenhum componente exige duas dimensões — a matriz de permissões de
REQ-USR-008 é renderizada como **uma linha por permissão**, nunca como tabela.

- **Racional:** a gaveta não estica (DEC-GAV-04) e a alternativa de mandar tudo para
  janela flutuante transformaria "mudar o volume" numa janela. O drill-in cresce sem
  limite — cada seção nova é uma linha no índice — e mantém uma coluna só.
- **Alternativas rejeitadas:** _acordeão com todas as seções empilhadas_ (a aba vira um
  rolo assim que mods declararem settings); _segmentos no topo_ (os rótulos não cabem
  quando as seções passam de quatro).

### DEC-CFG-05 — Cinco seções, com corte por papel na entrada

| Seção                   | Quem vê       |
| ----------------------- | ------------- |
| **Minhas preferências** | todos         |
| **Mundo**               | só GAMEMASTER |
| **Permissões**          | só GAMEMASTER |
| **Usuários**            | só GAMEMASTER |
| **Mods**                | só GAMEMASTER |

O jogador abre a aba e vê um índice com **uma** entrada. **Mods não aparece para o
jogador** nem em leitura.

- **Racional:** o jogador não decide o que a mesa usa, e uma lista de mods que ele não
  pode mudar só levanta perguntas para o GM responder. Índice de um item é honesto:
  mostra que existe exatamente uma coisa que é dele.

### DEC-CFG-06 — Minhas preferências é 100% local; sem idioma e sem tema no MVP

Tudo que a seção grava fica no dispositivo (`localStorage`), nada vai ao servidor.
**Idioma e tema não existem como controle**: o motor de i18n fica fixo em pt-BR e não há
sistema de temas.

- **Racional:** aplica DEC-UIF-10 e DEC-AUD-02 sem exceção — o que sobrou depois de
  tirar idioma e tema é ergonomia de aparelho (o volume no fone não é o volume na TV da
  sala). Sem servidor, a seção não precisa de rede, de permissão nem de documento.
- **Consequência:** o campo `preferences` de REQ-USR-003 continua existindo no modelo e
  segue **sem UI** no MVP; `locale` não é oferecido a ninguém.

### DEC-CFG-07 — A seção Mundo é renderizador puro do que o sistema declarou

A seção Mundo lista exatamente as settings de escopo `world` que o **sistema ativo**
declarou por REQ-SYS-047, renderizadas a partir do schema declarado. A aba **não
conhece nenhum sistema**: não há "if pf2e" em lugar nenhum dela.

- **Racional:** é o que impede a aba de virar o depósito de casos particulares. O
  sistema declara, a aba desenha; trocar de sistema troca a seção inteira sem tocar
  nesta spec.
- **Fora:** renomear o mundo não entra — a operação não existe (o `slug` é a pasta,
  fixado na criação) e criá-la é trabalho de outra spec.

### DEC-CFG-08 — Arquétipo livre e multiclasse por nível são setting de mundo, não campo do ator

As duas regras variantes deixam de morar em `system.build` do personagem e passam a ser
**settings de mundo**, declaradas pelo sistema PF2e e operadas só nesta aba. Saem da
ficha: o jogador não as liga mais.

- **Migração:** ao abrir um mundo pela primeira vez depois da mudança, se **qualquer**
  ator tiver a regra gravada como ligada, a setting do mundo nasce ligada; em seguida o
  campo é removido dos atores. Ninguém perde build montada.
- **Racional:** regra variante é decisão da campanha, não de um personagem. Ter o
  toggle na ficha significava que dois personagens da mesma mesa podiam derivar sob
  regras diferentes.
- **O que isso substitui:** a DEC-MCL-01 rejeitou explicitamente "flag por mundo, fora
  do ator", com o argumento de que a ficha precisa ser interpretável isolada (é
  exportada e importada). Essa decisão **cai**, de olho aberto: uma ficha exportada
  passa a depender das regras do mundo que a abrir. A spec 30 registra a decisão nova e
  reescreve REQ-MCL-001 e REQ-MCL-004 no mesmo PR (§12).

### DEC-CFG-09 — Escrita imediata; confirmação só quando desligar invalida build

Todo controle grava no ato, sem botão "salvar". A **única** confirmação da aba é ao
**desligar** uma regra variante que deixa personagens com escolhas ilegítimas — e ela
diz o número ("3 personagens têm talentos que dependem de arquétipo livre"). Ligar
nunca confirma.

- **Racional:** confirmação em tudo vira reflexo, e reflexo não protege. Ligar só
  concede; desligar é o único gesto que tira algo de alguém.

### DEC-CFG-10 — Só o Mestre escreve o que é da mesa; a aba não é fronteira de segurança

Toda escrita das seções Mundo, Permissões, Usuários e Mods exige `role === GAMEMASTER`
**verificada no servidor**. Esconder a seção no cliente é conveniência, não proteção
(REQ-GAV-034).

- **Racional:** REQ-USR-030 já restringe administração de usuários ao GAMEMASTER; o
  resto da aba segue o mesmo nível em vez de inventar um segundo.
- **Nota de implementação:** o predicado do servidor hoje é `isRolePrivileged`, que
  inclui o papel `ASSISTANT_GM`. O papel foi extinto por decisão de 2026-08-15 (issue
  #133) e esta spec já é escrita sem ele; enquanto a issue não roda, a escrita das
  seções de mesa **DEVE** ser guardada explicitamente por GAMEMASTER e não por
  `isRolePrivileged`.

## 5. Requisitos funcionais

> Blocos de dezena: 001–009 identidade e índice; 010–019 navegação; 020–029 Minhas
> preferências; 030–039 Mundo; 040–049 Permissões; 050–059 Usuários; 060–069 Mods;
> 070–079 permissão; 080–089 aplicação e estados vazios. Lacunas são reserva.

### 5.1 Identidade e índice

- **REQ-CFG-001** [MVP] A aba DEVE se registrar por `registerSidebarTab`
  (REQ-GAV-030) com `id: "settings"`, `group: "all"`, ícone próprio e rótulo por chave
  i18n; ela DEVE ser ancorada no rodapé do trilho, abaixo dos dois grupos.
- **REQ-CFG-002** [MVP] A aba NÃO DEVE usar badge — nem contador nem ponto de estado
  (DEC-GAV-06 permite; esta aba declara que não usa).
- **REQ-CFG-003** [MVP] Ao abrir, a aba DEVE mostrar o **índice** das seções que o
  usuário pode ver (DEC-CFG-05), uma por linha, com título e uma linha de descrição.
- **REQ-CFG-004** [MVP] O índice NÃO DEVE exibir ícone por seção: cada linha é título +
  descrição + indicador de avanço.
- **REQ-CFG-005** [MVP] Usuário sem papel privilegiado DEVE ver no índice exatamente
  uma entrada: **Minhas preferências**.

### 5.2 Navegação interna

- **REQ-CFG-010** [MVP] Escolher uma seção DEVE substituir o índice pelo conteúdo dela
  dentro da mesma gaveta, sem alterar largura (REQ-GAV-012) e sem abrir janela.
- **REQ-CFG-011** [MVP] Dentro de uma seção, o cabeçalho do painel DEVE exibir um
  controle "voltar" e o nome da seção; voltar retorna ao índice. NÃO DEVE existir ✕ nem
  qualquer outro controle de recolher (DEC-GAV-03).
- **REQ-CFG-012** [MVP] Recolher a gaveta e reabrir a aba DEVE voltar ao **índice**, não
  à última seção aberta; a seção corrente não persiste.
- **REQ-CFG-013** [MVP] Nenhuma interação desta aba DEVE abrir janela flutuante
  (REQ-UIF-009); todo conteúdo é renderizado em **uma coluna** dentro da gaveta.

### 5.3 Minhas preferências

- **REQ-CFG-020** [MVP] A seção DEVE hospedar os controles dos três canais de volume
  definidos em REQ-AUD-015 (`music`, `environment`, `interface`), gravados no
  `localStorage` conforme REQ-AUD-016; a aba NÃO DEVE enviar volume ao servidor.
- **REQ-CFG-021** [MVP] A seção DEVE oferecer as preferências de notificação do
  cliente (no mínimo: som ao receber mensagem de chat; aviso quando for o turno do
  usuário), gravadas no dispositivo.
- **REQ-CFG-022** [MVP] Toda preferência desta seção DEVE ser gravada exclusivamente
  no cliente (DEC-UIF-10); nenhuma DEVE gerar operação de rede ou Document.
- **REQ-CFG-023** [MVP] A seção NÃO DEVE oferecer seleção de idioma nem de tema.
- **REQ-CFG-024** [MVP] Preferências declaradas por um mod ativo DEVEM aparecer nesta
  seção quando seu escopo for de cliente, identificadas com o nome do mod de origem, e
  DEVEM desaparecer quando o mod for desligado. [V2] enquanto não houver mods.
- **REQ-CFG-025** [MVP] A seção DEVE oferecer um controle de exibição de **nome** dos
  tokens na cena, gravado exclusivamente no cliente (REQ-TOK-074); ligar ou desligar
  NÃO DEVE alterar o payload emitido pelo servidor (REQ-TOK-075, REQ-TOK-076).
- **REQ-CFG-026** [MVP] A seção DEVE oferecer um controle de exibição de **barras**
  (vida e demais atributos) dos tokens na cena, gravado exclusivamente no cliente
  (REQ-TOK-074); ligar ou desligar NÃO DEVE alterar o payload emitido pelo servidor
  (REQ-TOK-075, REQ-TOK-076).

  > **Emenda de 2026-08-17** — obrigada pela `41-token.md` §12 (REQ-TOK-074). As duas
  > preferências de exibição de nome e barras na cena são ergonomia local do aparelho
  > (DEC-UIF-10), na mesma régua dos volumes de REQ-CFG-020..023: gravadas no
  > `localStorage`, nunca em Document, nunca geram operação de rede (REQ-CFG-022).

### 5.4 Mundo

- **REQ-CFG-030** [MVP] A seção DEVE listar exatamente as settings de escopo `world`
  declaradas pelo sistema ativo (REQ-SYS-047), renderizando cada uma a partir do schema
  declarado (booleano → alternador; enum → seleção; número → campo numérico).
- **REQ-CFG-031** [MVP] A aba NÃO DEVE conter conhecimento de nenhum sistema de jogo:
  nenhuma chave de setting, rótulo ou regra específica de PF2e, SF2e ou Etmos DEVE
  aparecer no código da aba.
- **REQ-CFG-032** [MVP] As regras variantes **arquétipo livre** e **multiclasse por
  nível** DEVEM ser settings de escopo `world` declaradas pelo sistema PF2e, e esta
  seção DEVE ser a única superfície de escrita delas (DEC-CFG-08).
- **REQ-CFG-033** [MVP] A ficha de personagem NÃO DEVE oferecer controle para nenhuma
  regra variante; o campo correspondente em `system.build` deixa de ser escrito
  (reescrita de REQ-MCL-001/004 pela spec 30).
- **REQ-CFG-034** [MVP] Ao abrir um mundo cujos atores ainda carreguem uma regra
  variante gravada, o servidor DEVE ligar a setting de mundo correspondente se
  **qualquer** ator a tiver ligada, e então remover o campo dos atores. A migração roda
  uma vez por mundo e DEVE ser registrada em log.
- **REQ-CFG-035** [MVP] Mudar uma setting de mundo DEVE re-derivar os personagens
  afetados e propagar o resultado a todos os clientes conectados pelos caminhos
  normais de sincronização, sem exigir recarga da página.
- **REQ-CFG-036** [MVP] A seção DEVE hospedar o controle de **numeração de peças do
  mesmo ator** ("Esqueleto 1..6" vs. mesmo nome para todas), como setting de escopo
  `world` declarada pelo sistema ativo (REQ-TOK-064); a régua de escrita e persistência
  desta setting é a mesma de REQ-CFG-030/071 — `Setting` (REQ-DOC-018), só GAMEMASTER.

  > **Emenda de 2026-08-17** — obrigada pela `41-token.md` §12 (DEC-TOK-16,
  > REQ-TOK-064/065). O Mestre escolhe, nesta seção, se peças do mesmo ator nascem
  > numeradas; a numeração é o valor inicial do rótulo da peça, não um campo separado, e
  > o contador nunca reaproveita número de peça removida (REQ-TOK-065) — comportamento
  > do motor, não desta aba.

### 5.5 Permissões

- **REQ-CFG-040** [MVP] A seção DEVE listar as permissões configuráveis de REQ-USR-008,
  **uma por linha**, com o papel mínimo em um seletor (REQ-USR-009). NÃO DEVE ser
  renderizada como matriz bidimensional.
- **REQ-CFG-041** [MVP] Cada linha DEVE exibir o nome legível da permissão e, quando o
  valor diferir do default do produto, uma marca de "alterado".
- **REQ-CFG-042** [MVP] A escrita DEVE ser validada no servidor contra o predicado de
  REQ-CFG-070; recusa DEVE manter o valor anterior na tela.

### 5.6 Usuários

- **REQ-CFG-050** [MVP] A seção DEVE listar os usuários do mundo com nome, papel, cor e
  estado de conexão (REQ-USR-031), um por linha, em uma coluna.
- **REQ-CFG-051** [MVP] A seção DEVE oferecer as ações de REQ-USR-025 a REQ-USR-029:
  criar usuário, editar (nome, papel, cor, avatar, ativo), resetar senha, desativar e
  desconectar (kick). Criar um usuário de papel não privilegiado DEVE criar junto um
  **personagem em branco** associado a ele, com o usuário como `OWNER` (REQ-USR-025,
  REQ-USR-025a, DEC-NPC-02) — é um efeito da ação de criar, não um segundo gesto que o
  GM precise acionar.

  > **Emenda de 2026-08-16** — obrigada pela `42` §12 (DEC-NPC-02). A aba NPCs não oferece
  > o subtipo `character` na criação (REQ-NPC-044, CA-NPC-007) e a aba Contatos deixou de
  > criar ator (DEC-CTT-01); esta seção é o único lugar do produto onde personagem de
  > jogador nasce.

- **REQ-CFG-051a** [MVP] O personagem criado junto com o usuário NÃO DEVE abrir ficha nem
  janela flutuante e NÃO DEVE tirar o GM da gaveta (REQ-CFG-013); a seção DEVE apenas
  confirmar a criação do usuário. A seção NÃO DEVE oferecer criar, editar ou excluir
  personagem como ação própria — nem para quem já tem um (REQ-NPC-055a, Q-NPC-06).
- **REQ-CFG-052** [MVP] Editar um usuário DEVE acontecer **dentro da gaveta**, como
  formulário de campos empilhados na própria seção, e não em janela flutuante.
- **REQ-CFG-053** [MVP] A senha gerada por um reset (REQ-USR-027) DEVE ser exibida uma
  única vez, com ação de copiar, e NÃO DEVE ser recuperável depois de sair da tela.
- **REQ-CFG-054** [MVP] Desconectar e desativar DEVEM pedir confirmação nominal ("Tirar
  <nome> da mesa?"), por serem ações imediatas sobre outra pessoa.

### 5.7 Mods

- **REQ-CFG-060** [MVP] A seção Mods DEVE existir no índice do GAMEMASTER mesmo sem
  nenhum mod instalado, exibindo o estado vazio de REQ-CFG-081.
- **REQ-CFG-061** [MVP] A seção NÃO DEVE ser exibida a usuário sem papel privilegiado,
  nem em leitura.
- **REQ-CFG-062** [V2] Com a API de Mods disponível, a seção DEVE listar os mods
  instalados com nome, descrição curta e versão, e permitir **ligar e desligar cada um
  por mundo**; o efeito de ligar ou desligar é definido pela spec da API de Mods, não
  por esta.
- **REQ-CFG-063** [V2] A seção DEVE oferecer a instalação de um mod pela via que a API
  de Mods definir; enquanto REQ-ESC-012 mantiver carga dinâmica fora do MVP, o controle
  DEVE aparecer desabilitado, com o motivo legível.
- **REQ-CFG-064** [MVP] Esta spec NÃO DEVE definir o que é um mod, seus pontos de
  registro, seu manifesto ou seu ciclo de vida — só o endereço na tela (DEC-CFG-01).

### 5.8 Permissão de escrita

- **REQ-CFG-070** [MVP] Toda escrita originada nas seções Mundo, Permissões, Usuários e
  Mods DEVE ser verificada no servidor exigindo `role === GAMEMASTER`; o cliente
  esconder a seção NÃO É a proteção (REQ-GAV-034).
- **REQ-CFG-071** [MVP] Settings de escopo `world` DEVEM ser persistidas como
  `Setting` (REQ-DOC-018), com chave namespaceada pelo sistema ou mod que a declarou.
- **REQ-CFG-072** [MVP] A seção Minhas preferências NÃO DEVE ter predicado de servidor,
  porque nada nela sai do dispositivo (DEC-CFG-06).
- **REQ-CFG-073** [MVP] Uma escrita recusada pelo servidor DEVE reverter o controle ao
  valor anterior e exibir o motivo; a aba NÃO DEVE assumir sucesso otimista em setting
  de mundo.

### 5.9 Aplicação, confirmação e estados vazios

- **REQ-CFG-080** [MVP] Todo controle DEVE aplicar no ato, sem botão de salvar. Campos
  de texto aplicam ao perder o foco.
- **REQ-CFG-081** [MVP] Cada seção DEVE ter estado vazio próprio, com uma frase que
  explique a ausência: Mundo sem settings declaradas ("o sistema ativo não tem regras
  configuráveis"), Mods sem mods ("nenhum mod instalado neste mundo").
- **REQ-CFG-082** [MVP] Desligar uma regra variante que deixe personagens com escolhas
  ilegítimas DEVE pedir confirmação exibindo **quantos** personagens são afetados;
  ligar NÃO DEVE pedir confirmação.
- **REQ-CFG-083** [MVP] Nenhum outro controle da aba DEVE abrir confirmação, exceto as
  ações nominais de REQ-CFG-054.

## 6. Requisitos não-funcionais

- **RNF-CFG-01** [MVP] Abrir a aba e navegar entre índice e seções NÃO DEVE emitir
  operação de rede quando o usuário só visita Minhas preferências.
- **RNF-CFG-02** [MVP] A aba DEVE renderizar qualquer setting declarada sem alteração de
  código: acrescentar uma setting a um sistema NÃO DEVE exigir tocar nesta aba.
- **RNF-CFG-03** [MVP] Todo controle DEVE ser operável por teclado pela navegação
  genérica (REQ-UIF-064), com foco visível.

## 7. Onde cada coisa é gravada

| O quê                                           | Onde                                   | Quem escreve | Referência                   |
| ----------------------------------------------- | -------------------------------------- | ------------ | ---------------------------- |
| Volume dos três canais                          | `localStorage` do cliente              | o próprio    | REQ-AUD-016, DEC-AUD-02      |
| Notificações (som de chat, aviso de turno)      | `localStorage` do cliente              | o próprio    | DEC-CFG-06, DEC-UIF-10       |
| Exibição de nome/barras de token na cena        | `localStorage` do cliente              | o próprio    | REQ-CFG-025/026, REQ-TOK-074 |
| Settings declaradas com escopo `world`          | `Setting` (chave namespaceada)         | GAMEMASTER   | REQ-CFG-071, REQ-SYS-047     |
| Regras variantes (arquétipo livre, multiclasse) | `Setting` de mundo                     | GAMEMASTER   | DEC-CFG-08                   |
| Numeração de peças do mesmo ator                | `Setting` de mundo                     | GAMEMASTER   | REQ-CFG-036, DEC-TOK-16      |
| Permissões (papel mínimo por ação)              | conforme `05-usuarios-e-permissoes.md` | GAMEMASTER   | REQ-USR-008/009              |
| Usuários                                        | tabela `users` do mundo                | GAMEMASTER   | REQ-USR-025..031             |
| Personagem que nasce com o usuário              | Document `Actor` (subtipo `character`) | GAMEMASTER   | REQ-USR-025a, DEC-NPC-02     |
| Mods ligados/desligados                         | a definir pela spec da API de Mods     | GAMEMASTER   | REQ-CFG-062 [V2]             |

Settings declaradas com escopo `user` (permitidas por REQ-SYS-047) **não têm casa nesta
aba** enquanto Minhas preferências for 100% local — ver Q-CFG-01.

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "settings"`, grupo `all`, ancorada no rodapé do trilho, rótulo
   por chave i18n, ícone próprio (REQ-CFG-001).
2. **Badge** — não usa (REQ-CFG-002).
3. **Cabeçalho do painel** — no índice, o nome da aba; dentro de uma seção, "voltar" +
   nome da seção. Sem ✕ (REQ-CFG-011).
4. **Estado vazio** — por seção, com frase que explica a ausência (REQ-CFG-081).
5. **O que abre fora da gaveta** — **nada** (REQ-CFG-013).
6. **Permissão de conteúdo** — `role === GAMEMASTER` no servidor para tudo que é da
   mesa (REQ-CFG-070); Minhas preferências não tem predicado porque não sai do
   dispositivo (REQ-CFG-072).

## 9. Dependências (specs irmãs)

- `36` — contêiner, registro de abas (REQ-GAV-030), largura (REQ-GAV-012), gesto de
  recolher (DEC-GAV-03), badge (DEC-GAV-06), fronteira de segurança (REQ-GAV-034).
- `05` — REQ-USR-008/009 (permissões), REQ-USR-025..031 (usuários), REQ-USR-025a..025d (o
  personagem que nasce com o usuário), REQ-USR-030 (o limite de papel), REQ-USR-003 (o
  campo `preferences`, que segue sem UI).
- `42` — DEC-NPC-02: a aba NPCs não cria personagem de jogador (REQ-NPC-044), e por isso a
  criação vive na seção Usuários desta aba (REQ-NPC-055a); excluir personagem de jogador
  segue sem tela em lugar nenhum (REQ-NPC-055, Q-NPC-06).
- `15` — DEC-SYS-08 e REQ-SYS-047: a aba é a UI do motor de settings, não um segundo motor.
- `13` — REQ-AUD-015/016 e DEC-AUD-02: os canais de volume e sua persistência local.
- `11` — DEC-UIF-10 (fronteira de persistência), REQ-UIF-009 (janelas, que esta aba não
  usa), REQ-UIF-064 (teclado).
- `02` — REQ-DOC-018 (`Setting` como Document primário).
- `30` — DEC-MCL-01 é substituída (§12); REQ-MCL-001 e REQ-MCL-004 reescritos.
- `00` — REQ-ESC-012 mantém carga dinâmica de mod fora do MVP.
- `22`/`24` — donas da configuração de servidor, que esta aba não toca (DEC-CFG-02).
- `41` — REQ-TOK-064 (numeração de peças do mesmo ator, setting de mundo, DEC-TOK-16) e
  REQ-TOK-074..076 (preferências de exibição de nome/barras na cena, DEC-TOK-11):
  hospedadas nesta spec (REQ-CFG-036 e REQ-CFG-025/026).

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA-CFG-001 | Jogador abre a aba e vê um índice com uma única entrada, "Minhas preferências"; não há nada de Mundo, Permissões, Usuários ou Mods na tela nem no DOM.                                     |
| CA-CFG-002 | GM abre a aba e vê cinco entradas; entrar em Mundo troca o conteúdo da gaveta sem mudar a largura; "voltar" retorna ao índice; recolher e reabrir volta ao índice.                         |
| CA-CFG-003 | Nenhuma interação da aba abre janela flutuante — inclusive editar usuário e alterar permissões.                                                                                            |
| CA-CFG-004 | Ajustar o volume de `music` grava em `localStorage` e não emite nenhuma operação de rede; recarregar mantém o valor; entrar de outro navegador mostra o default.                           |
| CA-CFG-005 | Com sistema PF2e ativo, a seção Mundo lista arquétipo livre e multiclasse por nível; trocando para um sistema sem settings de mundo declaradas, a seção mostra o estado vazio.             |
| CA-CFG-006 | A ficha de personagem não tem nenhum controle de regra variante; ligar arquétipo livre na aba re-deriva os personagens da mesa e os clientes conectados veem o novo slot sem recarregar.   |
| CA-CFG-007 | Mundo com um ator que tinha `freeArchetype: true`: ao abrir depois da migração, a setting de mundo está ligada e o campo sumiu do ator; a build do personagem continua válida.             |
| CA-CFG-008 | Desligar arquétipo livre com 3 personagens dependentes abre confirmação dizendo "3"; cancelar não grava nada; ligar de novo não abre confirmação.                                          |
| CA-CFG-009 | Uma escrita de setting de mundo forjada por socket de jogador é recusada pelo servidor, e o valor no banco não muda.                                                                       |
| CA-CFG-010 | Sem nenhum mod instalado, o GM vê a seção Mods com o estado vazio e o controle de instalar desabilitado com motivo; o jogador não vê a seção.                                              |
| CA-CFG-011 | Uma setting nova declarada por um sistema aparece na seção Mundo sem nenhuma alteração no código da aba.                                                                                   |
| CA-CFG-012 | O GM cria um usuário `PLAYER` na seção Usuários: nenhuma janela abre, o GM continua na gaveta, e o jogador entra no mundo já com um personagem em branco do qual é `OWNER` (REQ-USR-025a). |

## 11. Questões em aberto

- **Q-CFG-01** — Settings declaradas com escopo `user` (REQ-SYS-047 as permite) não têm
  onde aparecer, já que Minhas preferências é 100% local. Quando um sistema declarar a
  primeira, ela vira preferência local, ganha uma casa nova, ou o escopo `user` é
  removido da spec 15? Decisão da `15`.
- **Q-CFG-02** — Renomear um mundo não existe como operação. Se vier a existir, entra
  nesta aba ou fica no `/setup` com o resto da administração?
- **Q-CFG-03** — Quem computa a contagem de personagens afetados de REQ-CFG-082: o
  servidor (que tem todos os atores) ou o cliente do GM (que só tem o que enxerga)? O
  número precisa ser o real, e o GM enxerga tudo — mas a conta não pode custar uma
  varredura completa a cada abertura da seção.

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `36` | DEC-GAV-01, REQ-GAV-003, REQ-GAV-004 e CA-GAV-001: Configurações sai do grupo GM, vira grupo `all` ancorado no rodapé; o grupo GM fica com NPCs e Cenas. §8 aponta para esta spec. |
| `30` | DEC-MCL-01 substituída por decisão nova (flag por mundo, que ela havia rejeitado); REQ-MCL-001 e REQ-MCL-004 reescritos: o toggle sai da ficha e do `system.build`.                |
| `13` | REQ-AUD-015 diz que os sliders de canal ficam "na sidebar de áudio", que não existe no trilho das sete abas; passam a viver aqui (REQ-CFG-020).                                    |
| `02` | A questão Q4 (fronteira `Setting` de cliente × mundo) fica respondida para este caso: preferência de cliente não vira Document; setting declarada de escopo `world` vira.          |
| `15` | REQ-SYS-047 ganha `requiresConfirmOnDisable?` e `countAffectedActors?` na forma pública de `SettingDefinition`, para servir REQ-CFG-082; `countAffectedActors` é server-only.      |

## 13. Referências

- Protótipo aprovado: `packages/client/prototypes/settings-tab.prototype.html` (variante 4, sem ícones).
- Grill de 2026-08-15 (sessão de spec-filha da 36).
- Issue #133 — extinção do papel `ASSISTANT_GM`, decidida neste mesmo grill.
