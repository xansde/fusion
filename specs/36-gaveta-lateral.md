# 36 — Gaveta Lateral

- **Título:** Gaveta lateral — trilho de abas só-ícone e o painel que ele abre
- **Status:** draft v0.2 (grill concluído em 2026-08-15; specs-filhas a escrever)
- **Data:** 2026-08-15
- **Baseada em:**
  - `11-ui-framework-e-fichas.md` — REQ-UIF-001/002 (shell: sidebar à direita, com tabs, colapsável, estado persistido por usuário — DEC-UIF-10).
  - Protótipo aprovado **C** — `packages/client/prototypes/sidebar-rail.prototype.html?variant=C` ("abas físicas à esquerda da gaveta, movem juntas"), 2026-08-15.
  - `AppSidebar.svelte` atual (5 abas em texto corrido, estado só em memória) — o que esta spec substitui.

> **Spec-mãe.** Esta spec é dona do **contêiner** (trilho, gaveta, registro e ordem
> das abas, estado, atalhos, permissão de exibição). O **conteúdo** de cada aba é uma
> spec-filha, uma por aba (ver §8), que cita a área dona do conteúdo (chat → 09,
> combate → 10, compêndio → 16…). Esta spec nunca redefine um requisito de área:
> cita.

---

## 1. Objetivo

Dar ao usuário acesso de um clique a cada painel do jogo sem tirar o mapa da tela:
um trilho vertical de ícones sempre visível na borda direita, que abre uma gaveta
com o painel escolhido e se move junto com ela.

## 2. Escopo

### 2.1 Inclui

- O trilho de abas (ícones, ordem, agrupamento por papel, badges, tooltip, atalhos).
- A gaveta (abrir/recolher, largura, o que persiste e onde).
- O registro de abas (quem pode registrar, visibilidade por papel).
- O contrato mínimo que uma spec-filha de aba precisa cumprir.

### 2.2 Não inclui

- Conteúdo de qualquer aba → specs-filhas (§8).
- Existência da sidebar no shell e a política de persistência de preferências → `11-ui-framework-e-fichas.md` (REQ-UIF-001/002, DEC-UIF-10) — esta spec só concretiza.
- Matriz de permissões → `05-usuarios-e-permissoes.md` (esta spec só consome o papel).
- Adaptação a tablet/toque → `23-acessibilidade-e-dispositivos.md`.

## 3. Conceitos e terminologia

| Conceito            | Definição                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Gaveta** (drawer) | O painel lateral direito que abre e recolhe. Substitui o termo "sidebar" desta área em diante; "sidebar" da spec 11 é a mesma região. |
| **Trilho** (rail)   | A coluna vertical de abas só-ícone, sempre visível, encostada à **esquerda** da gaveta e que se move com ela.                         |
| **Aba** (tab)       | Um item do trilho; abre exatamente um painel na gaveta. Cada aba é uma feature com spec própria.                                      |
| **Painel**          | O conteúdo renderizado dentro da gaveta para a aba ativa.                                                                             |
| **Grupo GM**        | Subconjunto de abas visível apenas para papel privilegiado, agrupado à parte no trilho.                                               |
| **Contatos**        | Aba de atores dos jogadores (novo nome do antigo "Atores"). Definição precisa na spec-filha — ver Q-GAV-01.                           |
| **NPCs**            | Aba do GM com o diretório de atores não-jogadores. Definição precisa na spec-filha — ver Q-GAV-01.                                    |

## 4. Decisões

### DEC-GAV-01 — Sete abas no MVP, agrupadas por papel

> **Emendada por DEC-GAV-09** (2026-08-15): Configurações saiu do grupo GM e virou um
> terceiro bloco, ancorado no rodapé. A lista abaixo já reflete a emenda.

As abas do MVP são, na ordem do trilho (de cima para baixo):

- **Todos os usuários:** Chat, Contatos, Combate, Compêndio.
- **Grupo GM** (só papel privilegiado — `isRolePrivileged`, spec 05): NPCs, Cenas.
- **Rodapé do trilho** (todos os usuários): Configurações.

- **Racional:** o jogador vê só o que opera; o GM vê o mesmo trilho do jogador mais o
  seu grupo, então a posição de cada ícone é a mesma nas duas telas (memória motora
  compartilhada na mesa) — e é por isso que Configurações, que os dois papéis usam,
  não podia ficar no grupo GM. "Atores" vira **Contatos** para o jogador porque a lista dele
  não é o diretório de documentos — é quem ele conhece; o diretório completo de
  não-jogadores é aba própria do GM (**NPCs**).
- **O que isso muda na spec 11:** REQ-UIF-002 lista Items, Journal e Settings como abas MVP.
  Items e Journal **não** ganham aba nesta gaveta no MVP (itens vivem na ficha; o
  diário tem porta pelo Hub — spec 28); o slot de registro continua existindo
  (REQ-UIF-002 segue válido para "o slot existe"), e a lista efetiva do MVP passa a ser
  a desta decisão. Registrar a divergência na spec 11 no mesmo PR.

### DEC-GAV-02 — Estado da gaveta é preferência local; primeiro acesso depende do papel

`open` (aberta/recolhida) e `activeTab` persistem **no cliente**, por usuário e
dispositivo (`localStorage`), nunca como documento do servidor — é a aplicação direta
de DEC-UIF-10, sem exceção nova.

- **Primeiro acesso** (nenhuma preferência salva): jogador nasce com a gaveta aberta em
  **Chat**; GM nasce aberta em **Cenas**. Depois disso vale o que o usuário deixou.
- **Aba salva que o usuário não pode mais ver** (perdeu o papel, dispositivo
  compartilhado): cai para **Chat**, sem aviso.
- **Racional:** ergonomia local não é estado de mundo; e o GM abre o mundo para
  preparar (Cenas), o jogador para conversar (Chat).

### DEC-GAV-03 — Um único gesto de recolher: o ícone da aba ativa

- Clicar em um ícone do trilho abre a gaveta naquela aba (se já aberta, só troca a aba).
- Clicar no ícone da **aba ativa** recolhe a gaveta. É o único controle de recolher.
- **Não existe** chevron/botão de recolher no trilho, nem ✕ no cabeçalho do painel
  (o cabeçalho é da spec-filha, para ações da própria aba). `Esc` não fecha a gaveta
  (já é o cancelamento de ferramentas do canvas e de diálogos).
- Recolhida, o trilho permanece na borda direita, com badges visíveis.
- **Racional:** um gesto, um lugar — o dedo já está no ícone; controles redundantes
  custam linha de título e ensinam dois hábitos para a mesma coisa. Substitui o botão
  `❯`/`☰` do `AppSidebar` atual.

### DEC-GAV-04 — Uma largura fixa para todas as abas, sem redimensionamento

A gaveta tem **uma única largura**, igual para todas as abas, definida por token de
tema (`--fusion-sidebar-width` = **300px** de painel + **44px** de trilho, os valores do
protótipo C) e **não redimensionável** pelo
usuário. Trocar de aba nunca altera o tamanho da gaveta.

- Aba que precise de mais espaço (preview lado a lado, ficha) **não estica a gaveta**:
  abre janela flutuante do window manager (spec 11, REQ-UIF-009+). A gaveta é lista e
  painel; a janela é detalhe.
- **Racional:** o mapa por baixo fica parado ao trocar de aba; zero estado de layout a
  persistir além de `open`/`activeTab`; e as specs-filhas projetam para uma largura
  conhecida em vez de "cabe em qualquer coisa".

### DEC-GAV-05 — Sem atalhos de teclado no MVP

O trilho não tem atalhos globais (`Alt+N` do protótipo fica de fora). A operação por
teclado é a genérica de REQ-UIF-064 (Tab/Enter/Espaço sobre os botões do trilho).
Atalhos, se vierem, entram como decisão nova [V2] e por posição, não por letra.

- **Racional:** o foco vive no chat; atalho global é superfície de colisão que ninguém
  pediu ainda.

### DEC-GAV-06 — Contrato de badge do trilho: dois tipos, decididos pela aba

O trilho oferece a cada aba **um** badge, de um de dois tipos, e nada além disso:

- **Contador** (número; `99+` acima de 99): "coisas novas que você não viu" — chat
  não-lido (REQ-CHT-039) e futuros convites/pedidos.
- **Ponto de estado** (sem número): "algo está acontecendo" — combate ativo, e no futuro
  "é a sua vez".
- O badge aparece **sempre que existir**, inclusive na aba ativa e aberta; a gaveta
  recolhida não o esconde. **O trilho nunca altera badge nenhum por conta própria**:
  quem zera o contador ou apaga o ponto de estado é sempre a regra da spec-filha — que
  pode, sim, decidir que abrir a aba marca como lido (é o que a 38 decide para o Chat,
  DEC-ACH-11).
- **Quem acende** é a spec-filha (o chat é dono da regra de não-lido; o combate, da de
  "ativo"); esta spec só fixa tipo, posição no canto do ícone e sobrevivência à gaveta
  recolhida.
- Sem som, sem piscar, sem animação de entrada além de aparecer.

### DEC-GAV-07 — Abas são o ponto de extensão dos mods; o núcleo registra as sete pelo mesmo caminho

- Existe um **registro de abas** no cliente (`registerSidebarTab({ id, icon, label,
group: "all" | "gm", component, badge })`). As 7 abas do jogo base (DEC-GAV-01) são
  registradas **por esse mesmo registro**, não por `{#if}` no componente — se o núcleo
  não consegue registrar uma aba pelo caminho público, o caminho está errado. É isso que
  REQ-UIF-002 chama de "slot".
- **Mods são a única forma de adicionar abas** além das do núcleo. Sistemas de jogo
  (spec 15) **não** registram abas por enquanto — fica como decisão futura.
- O registro é [MVP]; **carregar um mod** é [V2] (REQ-ESC-012 veta plugin dinâmico no
  MVP) e é assunto da spec-filha de Configurações/Mods. Esta spec só garante que, no dia
  em que um mod carregar, adicionar uma aba é uma chamada e nada mais.
- Aba de mod entra **depois** das abas do núcleo, dentro do grupo que declarou; a ordem
  do núcleo é fixa. Aba com `group: "gm"` é escondida no cliente por
  `isRolePrivileged`, mas quem protege o **dado** é a área dona (spec 05) — o trilho
  não é fronteira de segurança.
- **Racional:** modularidade máxima com o menor contrato: um objeto, uma chamada. O
  núcleo ser o primeiro cliente do registro é o que impede a API de apodrecer.

### DEC-GAV-08 — Tela estreita: o trilho não muda, a gaveta ocupa o resto

- O trilho é o mesmo em qualquer tela (44px, alvo de toque de REQ-UIF-063). Ele
  substitui o "FAB/swipe" que REQ-UIF-062 e a spec 23 previam para a sidebar em tablet.
- Em viewport estreita (limiar a fixar em REQ; ponto de partida **900px**), a gaveta
  aberta ocupa **toda a largura restante** em vez dos 300px, por cima do mapa; recolher
  (DEC-GAV-03) devolve o mapa. Sem gesto de arrastar da borda, sem modo separado.
- **Racional:** um mecanismo só; em tela pequena a escolha é binária — ou mapa, ou
  painel.

### DEC-GAV-09 — Configurações é de todos e mora no rodapé do trilho

Substitui, em DEC-GAV-01, a classificação de **Configurações** como aba do grupo GM: ela
passa ao grupo `all` e é ancorada no **rodapé** do trilho, separada visualmente dos dois
grupos. O conteúdo varia por papel — o jogador vê apenas as próprias preferências, e o
GM vê também mundo, permissões, usuários e mods (spec 37).

- **Racional:** o jogador precisa de um lugar para o próprio som e para o que os mods
  ativos expuserem a ele; com a aba no grupo GM, "onde eu configuro" teria dois
  endereços diferentes conforme o papel. O rodapé mantém a posição idêntica nas duas
  telas — o princípio de DEC-GAV-01 — sem empurrar o grupo GM para baixo, e é o lugar
  onde a engrenagem é procurada.
- **Alternativa rejeitada:** _manter a aba só-GM e pôr as preferências do jogador num
  menu do usuário no header_ — preserva esta spec intacta, ao custo de espalhar
  configuração por dois lugares e de o GM ter as próprias preferências separadas das
  do mundo.

## 5. Requisitos funcionais

> Blocos de dezena por tema: 001–009 trilho e abas; 010–019 gaveta e estado; 020–029
> badges; 030–039 registro e mods; 040–049 telas estreitas e teclado. Lacunas são
> reserva, não erro.

### 5.1 Trilho e abas

- **REQ-GAV-001** [MVP] O trilho DEVE ser uma coluna vertical de botões **só-ícone**,
  encostada à esquerda da gaveta e movendo-se com ela: com a gaveta aberta a ordem
  visual é `[trilho][painel]` na borda direita; recolhida, o trilho fica na borda
  direita da tela. Nenhum rótulo textual é renderizado no trilho.
- **REQ-GAV-002** [MVP] Cada botão do trilho DEVE expor o nome da aba por `aria-label`
  e por tooltip ao passar o ponteiro/focar; o tooltip é o único texto do trilho.
- **REQ-GAV-003** [MVP] O trilho DEVE renderizar as abas do usuário na ordem de
  DEC-GAV-01, em três blocos: primeiro o grupo de todos (Chat, Contatos, Combate,
  Compêndio); em seguida, separado visualmente, o grupo GM (NPCs, Cenas); e ancorada no
  rodapé do trilho, a aba Configurações (DEC-GAV-09). Abas registradas por mods
  (REQ-GAV-031) entram ao fim do seu grupo, nunca no rodapé.
- **REQ-GAV-004** [MVP] Abas do grupo GM NÃO DEVEM ser renderizadas para usuário cujo
  papel não seja privilegiado (`isRolePrivileged`, spec 05); a posição das abas do
  grupo de todos e da aba de rodapé DEVE ser a mesma para qualquer papel.
- **REQ-GAV-005** [MVP] A aba ativa com a gaveta aberta DEVE ser visualmente contínua
  com o painel (sem borda entre o botão e a gaveta — a "aba física" do protótipo C);
  com a gaveta recolhida nenhuma aba é exibida como ativa.

### 5.2 Gaveta e estado

- **REQ-GAV-010** [MVP] Clicar em uma aba com a gaveta recolhida DEVE abri-la
  naquela aba; com a gaveta aberta em outra aba, DEVE trocar de aba sem alterar
  tamanho nem posição da gaveta.
- **REQ-GAV-011** [MVP] Clicar na aba **ativa** com a gaveta aberta DEVE recolher a
  gaveta. NÃO DEVE existir outro controle de recolher (nem chevron no trilho, nem ✕
  no painel), e `Esc` NÃO DEVE recolher a gaveta.
- **REQ-GAV-012** [MVP] A gaveta DEVE ter largura fixa de **300px** de painel mais
  **44px** de trilho, definida por token de tema, igual para todas as abas e não
  redimensionável pelo usuário. Trocar de aba NÃO DEVE alterar a largura.
- **REQ-GAV-013** [MVP] A gaveta DEVE ficar sobreposta ao canvas (não reserva
  espaço de layout), abaixo do header e acima do canvas na pilha de z do shell
  (REQ-UIF-008); o trilho recebe eventos de ponteiro mesmo com a gaveta recolhida.
- **REQ-GAV-014** [MVP] `open` e `activeTab` DEVEM persistir no cliente por
  usuário e dispositivo (`ClientUIPreferences`, DEC-UIF-10) e ser restaurados ao
  recarregar; nenhum dos dois é enviado ao servidor.
- **REQ-GAV-015** [MVP] Sem preferência salva, o primeiro acesso DEVE abrir a gaveta
  em **Cenas** para papel privilegiado e em **Chat** para os demais.
- **REQ-GAV-016** [MVP] Se `activeTab` salvo nomear uma aba que o usuário não pode
  ver (não registrada, ou de grupo GM sem papel), a gaveta DEVE abrir em **Chat**
  sem aviso.
- **REQ-GAV-017** [MVP] O painel da aba ativa é o único montado; trocar de aba
  desmonta o painel anterior. Estado que precise sobreviver à troca (rascunho de
  mensagem, filtro de busca) é responsabilidade da spec-filha, fora do componente.

### 5.3 Badges

- **REQ-GAV-020** [MVP] O trilho DEVE oferecer a cada aba **um** badge, de um de dois
  tipos: **contador** (inteiro ≥ 1, exibido como `99+` acima de 99) ou **ponto de
  estado** (booleano, sem número). Uma aba não pode ter os dois.
- **REQ-GAV-021** [MVP] O badge DEVE ser renderizado no canto do ícone sempre que
  seu valor existir — inclusive na aba ativa e aberta e com a gaveta recolhida.
- **REQ-GAV-022** [MVP] O **trilho** NÃO DEVE alterar o valor de nenhum badge ao abrir
  a aba, trocar de aba ou recolher a gaveta: contador e ponto de estado só mudam quando
  a **spec-filha** muda o store. A filha PODE definir que abrir a aba marca o conteúdo
  como lido — é o que a 38 faz para o Chat (REQ-ACH-004, com REQ-CHT-039).
- **REQ-GAV-023** [MVP] O valor do badge é fornecido pela aba (store reativo no
  registro, REQ-GAV-030); o trilho NÃO DEVE conter regra de negócio de nenhum badge
  (a regra de não-lido é REQ-CHT-039; a de combate ativo é da spec 10).
- **REQ-GAV-024** [MVP] Badge NÃO DEVE emitir som, piscar ou animar além de aparecer
  e desaparecer.

### 5.4 Registro de abas e mods

- **REQ-GAV-030** [MVP] DEVE existir um registro de abas no cliente com a forma
  `registerSidebarTab({ id, icon, label, group, component, badge? })`, onde `id` é
  único, `label` é chave i18n, `group ∈ {"all","gm"}`, `component` é o componente
  Svelte do painel e `badge` é um store reativo de `number | boolean | null`. As
  sete abas de DEC-GAV-01 DEVEM ser registradas por essa mesma chamada.
- **REQ-GAV-031** [V2] Um mod carregado DEVE poder registrar abas pela mesma chamada
  de REQ-GAV-030 e nada mais; a aba entra ao fim do grupo declarado. Carregar mods é
  assunto da spec-filha de Configurações/Mods (REQ-ESC-012 mantém plugin dinâmico
  fora do MVP).
- **REQ-GAV-032** [MVP] Sistemas de jogo (spec 15) NÃO DEVEM registrar abas no MVP.
- **REQ-GAV-033** [MVP] Registrar `id` já existente DEVE falhar com erro explícito;
  o registro NÃO DEVE substituir abas silenciosamente.
- **REQ-GAV-034** [MVP] O trilho esconder uma aba de grupo GM NÃO é fronteira de
  segurança: todo dado exibido por um painel DEVE ser protegido no servidor pelo
  predicado da área dona (spec 05); a spec-filha DEVE nomear esse predicado.

### 5.5 Telas estreitas e teclado

- **REQ-GAV-040** [MVP] Em viewport com largura abaixo de **900px**, a gaveta aberta
  DEVE ocupar toda a largura restante à esquerda do trilho, por cima do canvas; o
  trilho mantém 44px e o gesto de recolher de REQ-GAV-011. Substitui, para a
  gaveta, o FAB/swipe de REQ-UIF-062 e da spec 23.
- **REQ-GAV-041** [MVP] Os botões do trilho DEVEM ser operáveis por teclado pela
  navegação genérica (Tab/Enter/Espaço — REQ-UIF-064) e ter foco visível. NÃO DEVEM
  existir atalhos globais para as abas no MVP.

## 6. Requisitos não-funcionais

- **RNF-GAV-01** [MVP] Abrir, recolher e trocar de aba DEVEM completar sem re-render
  do shell nem do canvas: a gaveta é sobreposição, e o canvas não recebe resize ao
  abrir/recolher.
- **RNF-GAV-02** [MVP] Montar o trilho NÃO DEVE carregar o código de painel de aba
  não ativa (import dinâmico por aba).

## 7. Contrato da spec-filha

Toda spec de aba (§8) DEVE definir, no mínimo — e NÃO DEVE definir largura, posição,
gesto de recolher ou persistência de `open`/`activeTab`, que são desta spec:

1. **Identidade** — `id`, ícone, chave i18n do rótulo, grupo (`all`/`gm`).
2. **Badge** — se usa; tipo (contador ou ponto de estado); regra que acende/apaga,
   citando o requisito da área dona.
3. **Cabeçalho do painel** — título e ações próprias que ficam nele (não há ✕).
4. **Estado vazio** — o que o painel mostra quando não há conteúdo.
5. **O que abre fora da gaveta** — quais interações abrem janela flutuante (spec 11)
   em vez de crescer o painel (DEC-GAV-04).
6. **Permissão de conteúdo** — o predicado do servidor que protege o dado
   (REQ-GAV-034).

### 7.1 Critérios de aceitação

| ID         | Critério                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA-GAV-001 | Jogador logado vê no trilho exatamente Chat, Contatos, Combate e Compêndio nessa ordem, sem texto, mais Configurações ancorada no rodapé; GM vê os mesmos na mesma posição, com NPCs e Cenas no bloco intermediário.                                                           |
| CA-GAV-002 | Primeiro acesso sem preferência: jogador abre em Chat, GM abre em Cenas; após trocar para Compêndio e recarregar, a gaveta volta aberta em Compêndio; recolher e recarregar volta recolhida.                                                                                   |
| CA-GAV-003 | GM salva `activeTab = "scenes"` no dispositivo; usuário sem papel privilegiado entra no mesmo navegador: a gaveta abre em Chat, sem erro.                                                                                                                                      |
| CA-GAV-004 | Com a gaveta aberta em Chat, clicar em Combate troca o painel sem mudar a largura; clicar em Combate de novo recolhe; `Esc` não recolhe; não existe chevron nem ✕.                                                                                                             |
| CA-GAV-005 | Duas mensagens chegam com a gaveta recolhida → contador "2" no ícone de Chat; abrir Chat zera o contador pela regra da spec-filha (REQ-ACH-004), e o trilho não faz nada sozinho; combate iniciado → ponto de estado em Combate, visível com Combate aberto, some ao encerrar. |
| CA-GAV-006 | Registrar uma aba de teste `group: "gm"` via `registerSidebarTab` faz o ícone aparecer ao fim do grupo GM para o GM e não aparecer para o jogador; registrar o mesmo `id` de novo lança erro.                                                                                  |
| CA-GAV-007 | Em viewport de 800px, abrir a gaveta cobre toda a largura à esquerda do trilho; recolher devolve o mapa; o trilho continua com 44px.                                                                                                                                           |
| CA-GAV-008 | Trilho navegável por Tab com foco visível; Enter/Espaço abre e recolhe como o clique; nenhum atalho `Alt+N` responde.                                                                                                                                                          |

## 8. Specs-filhas (uma por aba)

| Aba           | Spec-filha                | Área dona do conteúdo citada          |
| ------------- | ------------------------- | ------------------------------------- |
| Chat          | [38](38-aba-chat.md)      | 09 (rolagens: 08)                     |
| Contatos      | _a criar_                 | 02/05/11                              |
| Combate       | [40](40-aba-combate.md)   | 10                                    |
| Compêndio     | _a criar_                 | 16                                    |
| NPCs          | [42](42-aba-npcs.md)      | 02/05/11 (compêndio: 16)              |
| Cenas         | _a criar_                 | 06/11                                 |
| Configurações | [37](37-configuracoes.md) | 05/15/13 (mods: [V2] por REQ-ESC-012) |

## 9. Dependências (specs irmãs)

Recorte que atravessa 11, 05, 23, 09, 10, 00 e não contraria nenhuma:

- `11` — REQ-UIF-001/002 (região e existência da sidebar; esta spec concretiza),
  REQ-UIF-008 (pilha de z), REQ-UIF-009 (janelas flutuantes para o que não cabe),
  REQ-UIF-062/063/064 (tablet, alvo de toque, teclado), DEC-UIF-10 (onde persiste).
- `05` — `isRolePrivileged` para o grupo GM; o predicado de dado é sempre da área dona.
- `23` — o trilho substitui o FAB/swipe da sidebar em tablet (REQ-GAV-040).
- `09` — REQ-CHT-039 é a regra do contador de Chat; esta spec só o exibe.
- `10` — a regra de "combate ativo" do ponto de estado é da spec 10.
- `00` — REQ-ESC-012 mantém carga de mod fora do MVP; o registro (REQ-GAV-030) é o
  ponto de extensão que ela vai usar.

## 10. Questões em aberto

- **Q-GAV-01** — O que exatamente é um "Contato" e o que separa a aba NPCs dela: **é conteúdo, decide-se na spec-filha de Contatos/NPCs**, não aqui.
