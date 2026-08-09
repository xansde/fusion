# 28 — Hub do Jogador

- **Título:** Hub do Jogador (System Window, board de missões, comitiva)
- **Status:** draft v0.1
- **Data:** 2026-08-09
- **Baseada em:**
  - `docs/design/referencias/04-system-window-interativo.html` — linguagem visual (Isekai-Companion)
  - `docs/design/prototipo-log-missoes.html` — protótipo funcional do board, insumo da issue #90
  - `docs/design/handoff-system-window-client.md` — o que já existe no client e por quê
  - `02-modelo-de-dados.md` — `Note` com ownership próprio (REQ-DOC-056..060)
  - `34-mapa-de-regiao.md` — POIs, Console de Revelação, propagação
  - `11-ui-framework-e-fichas.md` — window manager, escala de z-index (REQ-UIF-008)

> **[V2] no escopo global** do Fusion: nenhuma capacidade desta spec entra na definição de
> sessão completa de `00-visao-e-escopo.md` (REQ-ESC-007). As tags [MVP] abaixo marcam o
> **núcleo interno do Hub** — o que precisa existir para o Hub ser utilizável — na mesma
> convenção que `18-sistema-sf2e.md` e `19-sistema-etmos.md` já usam para os sistemas [V2].

---

## Objetivo

Definir o **Hub do jogador**: a camada diegética que flutua sobre a mesa e responde, sem
sair do jogo, às três perguntas que o jogador faz o tempo todo — _o que estamos fazendo_
(Missões), _como está o grupo_ (Comitiva) e _onde estamos_ (Mapa).

O Hub não é uma tela nova nem um segundo aplicativo: é um **host de painéis** sobre o
canvas, com uma linguagem visual própria, e um contrato de revelação que reusa o ownership
dos Documents existentes em vez de criar um sistema paralelo de visibilidade.

---

## Escopo

### O que inclui

- A **moldura** (System Window): chrome, registros de cor, e as regras de camada e foco.
- A **barra de comando** no rodapé, os atalhos de teclado e o contrato de badge.
- A **Notificação do Sistema**: fila, teto, tempo de vida e quem pode emitir.
- O **painel de Missões**: board por jogador, três estados de revelação, objetivos
  liberados um a um, e a costura missão ↔ lugar.
- O **painel de Comitiva**: estado vital dos personagens da mesa, no recorte que o
  ownership permite.
- O **painel de Mapa**: o Hub como host do mapa de região (`34`) e do minimapa (`32`).
- O **contrato de painel**: o que um painel precisa declarar para viver no Hub.

### O que NÃO inclui

- **O relógio de missão** (contagem regressiva com frente e beat obrigatório): é do
  **Motor de Campanha (`33`)**, não daqui. Ver DEC-HUB-08.
- **A ficha de personagem** — é `11`. O painel de Comitiva mostra estado, não edita.
- **O modelo de mapa** (cena de região, POIs, câmera, LOD) — é `34`; o Hub só hospeda.
- **A redação de visibilidade em si** — é do servidor (`04`, `05`, `21`). O Hub consome o
  payload já redigido e nunca decide visibilidade na tela.
- **Autoria de campanha** (criar missões em lote, gerar ganchos): `33`.
- **Chat, diário e rolagens** — têm janelas próprias no shell (`09`, `12`, `11`), fora do Hub.

---

## Conceitos e terminologia

| Termo                      | Definição                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Hub**                    | A camada de overlay sobre o canvas que hospeda os painéis diegéticos. Um host, não uma tela.                |
| **System Window**          | A moldura visual dos painéis do Hub: 4 cantos em L, scanlines, título em caixa alta.                        |
| **Painel**                 | Uma superfície registrada no Hub, com rótulo, atalho e conteúdo próprio. Ex.: Missões, Comitiva, Mapa.      |
| **Barra de comando**       | A faixa fixa no rodapé que lista os painéis e seus atalhos.                                                 |
| **Notificação do Sistema** | Mensagem efêmera no topo da tela, em quatro registros (`system`/`rumour`/`good`/`bad`).                     |
| **Registro (de cor)**      | O tom de uma notificação ou moldura, que comunica a natureza do evento sem depender de texto.               |
| **Missão**                 | Unidade de objetivo narrativo, com um **gancho** (o texto público) e **objetivos** liberados em ordem.      |
| **Gancho**                 | O texto que o jogador lê quando a missão está publicada.                                                    |
| **Boato**                  | Texto alternativo, escrito à mão, que o jogador recebe quando a missão está em estado de rumor.             |
| **Estado de revelação**    | Por jogador e por missão: ○ oculto · **?** rumor · ● publicada. São os mesmos três de `Note` (REQ-DOC-057). |
| **Matriz de revelação**    | A visão do GM: missões nas linhas, jogadores nas colunas, o estado em cada célula.                          |
| **Comitiva**               | O conjunto de personagens jogadores ativos na mesa.                                                         |

---

## Decisões

### DEC-HUB-01 — O Hub é um host de painéis, não uma tela

O Hub monta como camada sobre o canvas (`HubLayer`), com pass-through: a camada não
intercepta ponteiro, só as superfícies dentro dela interceptam. Um painel é registrado com
rótulo, atalho e conteúdo; o Hub não conhece o interior de nenhum.

**Racional:** o protótipo é uma página inteira e por isso sempre tem um painel aberto. No
Fusion o jogador está jogando no canvas — o Hub nasce fechado e não pode roubar o clique.
Um host genérico também é o que permite que `32` (minimapa) se hospede aqui sem que o Hub
saiba o que é um minimapa (DEC-MMT-04).

### DEC-HUB-02 — Revelar é mexer em ownership, nunca em uma tabela paralela

Publicar uma missão para um jogador é um update de `ownership` no documento da missão. Não
existe coleção `missoes_visiveis`, nem flag de visibilidade própria do Hub.

**Racional:** é a mesma decisão que `Note` já tomou (REQ-DOC-056). Dois mecanismos de
visibilidade convivendo é como nasce o vazamento: um deles é esquecido em algum caminho de
emissão. O Fusion já tem quatro caminhos a cobrir (snapshot, broadcast, replay de delta,
eco do ack) — dobrar isso por conveniência de UI é trocar um dia de trabalho por uma classe
inteira de bug.

### DEC-HUB-03 — Três estados, os mesmos do mapa

○ `none` (oculto, não enviado) · **?** `limited` (rumor, payload redigido) · ● `observer`+
(publicada, payload completo). A semântica é a de REQ-DOC-057, aplicada a missão.

**Racional:** o jogador já aprende esses três estados no mapa. Um segundo vocabulário para
a mesma ideia é custo de aprendizado sem contrapartida — e a costura missão↔POI
(DEC-HUB-07) fica trivial quando os dois lados têm os mesmos degraus.

### DEC-HUB-04 — Missão não é Document novo no núcleo do Hub

Uma missão é uma `JournalEntry` cujas páginas carregam o gancho, o boato e os objetivos,
cada uma com ownership próprio. O Hub lê e escreve esses documentos; não introduz tipo novo
no catálogo de `02`.

**Racional:** o catálogo de Documents é deliberadamente enxuto (`02`), e cada tipo novo
custa schema, migração, redação e permissão. Journal já tem página, ownership e @UUID
(REQ-JRN-002, REQ-JRN-017) — que é exatamente a forma de uma missão. Se o Motor de Campanha
(`33`) precisar de um `Quest` de primeira classe para relógios e frentes, ele o introduz
com o custo justificado pelo que só ele faz; o Hub continua funcionando por cima.

### DEC-HUB-05 — O boato é texto escrito, não redação automática do gancho

O estado de rumor entrega um texto próprio, autorado. O servidor não gera resumo, não corta
o gancho, não substitui nomes.

**Racional:** redigir automaticamente vaza estrutura — o tamanho do texto cortado, os campos
que sobraram e a própria forma do recorte contam ao jogador que existe algo ali e o formato
do que existe. "Dizem que a estrada de Godford anda comendo gente" é uma informação
diferente do gancho, não uma versão menor dele. Custo aceito: o GM escreve duas vezes; sem
boato escrito, a missão simplesmente não tem estado de rumor.

### DEC-HUB-06 — Objetivos são liberados um a um, sem republicar a missão

Cada objetivo tem seu próprio estado de revelação, independente do estado da missão. Liberar
o objetivo 3 não toca no 1, no 2 nem no gancho.

**Racional:** é o que faz o board parecer diário e não mural. Também evita o padrão em que o
GM reescreve o texto inteiro para acrescentar uma linha, perdendo o histórico do que o
jogador já tinha lido.

### DEC-HUB-07 — O vínculo missão → lugar é declarado pelo GM, e a propagação é sugerida, nunca automática

Uma missão PODE apontar para um ou mais POIs. Ao mudar o estado de revelação da missão, o
Hub **propõe** o mesmo degrau para os POIs vinculados, em uma ação confirmável de um clique
— e nunca rebaixa quem já viu.

**Racional:** no protótipo a propagação é automática e parece mágica boa, até o caso em que
o GM quer dar o boato sem entregar a localização — que é metade do valor de um boato.
Automático demais tira do GM a decisão que ele foi ali tomar. A ação de um clique preserva a
ergonomia sem transformar conveniência em regra. Nunca rebaixar é a mesma regra do `todos ▸`
do Console de Revelação (REQ-MREG-007).

### DEC-HUB-08 — O relógio de missão é do Motor de Campanha, não do Hub

Contagem regressiva, "frentes" e o beat obrigatório quando o relógio fecha ficam na spec
`33`. O Hub exibe o relógio de uma missão se ele existir, como dado somente-leitura.

**Racional:** relógio que avança implica um motor de tempo com gatilhos e consequências —
isso é regra de campanha, não de interface. Colocar aqui criaria um segundo lugar onde o
tempo da campanha corre, e dois relógios discordam mais cedo do que se imagina. O Hub sendo
só a vitrine mantém a fronteira: `33` decide, `28` mostra.

### DEC-HUB-09 — Toda notificação nasce de um evento já redigido pelo servidor

Um emissor de notificação não tem canal próprio: ele reage a um evento que passou por
`packages/server/src/net/redaction.ts` e `isRolePrivileged`. Se o jogador não recebeu o
evento, ele não recebe a notificação.

**Racional:** notificação é o vetor mais fácil de vazamento porque parece cosmética. "O
Comedor revelou o Santuário" contado a quem não vê o Santuário entrega o Santuário. Emissor
com canal paralelo é a forma mais direta de furar quatro caminhos de redação de uma vez.

### DEC-HUB-10 — A matriz do GM é a visão de conjunto; a revelação in loco é a ação

A matriz missão × jogador é a leitura ("quem sabe o quê"). A **ação** de revelar mora
também no item — na linha da missão e no pino do POI — e custa um clique, sem abrir a
matriz.

**Racional:** a matriz é confortável em 6 × 2 e vira planilha em 30 × 5 (pergunta 5 da issue
#90). Resolver isso alargando a tabela é perder duas vezes: continua ruim e fica cara de
renderizar. Separar leitura de ação faz a matriz escalar por filtro e paginação — enquanto o
gesto que o GM repete cem vezes por sessão não depende dela.

---

## Requisitos funcionais

### Camada e moldura

- **REQ-HUB-001** [MVP] O Hub DEVE montar como camada única sobre o canvas, com
  pass-through de ponteiro: a camada NÃO DEVE interceptar eventos, e apenas as superfícies
  de painel dentro dela DEVEM recebê-los.
- **REQ-HUB-002** [MVP] O Hub DEVE nascer **fechado** ao entrar na mesa: nenhum painel
  aberto até uma ação do usuário.
- **REQ-HUB-003** [MVP] Todo painel DEVE usar a moldura System Window: quatro cantos em L
  fora da caixa de borda, título em caixa alta e um dos quatro registros de cor
  (`system`, `rumour`, `good`, `bad`).
- **REQ-HUB-004** [MVP] A camada do Hub e a pilha de notificações DEVEM ocupar níveis
  distintos e declarados da escala de z-index unificada (REQ-UIF-008). A pilha de
  notificações NÃO DEVE montar dentro da camada do Hub.
- **REQ-HUB-005** [MVP] Os tokens de estilo do Hub DEVEM viver em namespace próprio e NÃO
  DEVEM redefinir nenhum token do shell.
- **REQ-HUB-006** [V2] O painel aberto DEVE ser persistido por usuário e restaurado ao
  reabrir a mesa.

### Barra de comando e atalhos

- **REQ-HUB-007** [MVP] O Hub DEVE exibir uma barra de comando fixa no rodapé, listando os
  painéis registrados com rótulo e a tecla de atalho.
- **REQ-HUB-008** [MVP] Exatamente **um** painel DEVE estar aberto por vez; acionar o
  painel já aberto DEVE fechá-lo.
- **REQ-HUB-009** [MVP] `Escape` DEVE dispensar a notificação visível e, não havendo
  notificação, fechar o painel aberto.
- **REQ-HUB-010** [MVP] Atalhos de painel NÃO DEVEM disparar enquanto o foco estiver em um
  alvo digitável, incluindo elementos `contenteditable` (o chat e o diário usam editor
  rich text). `Escape` DEVE atravessar o alvo digitável.
- **REQ-HUB-011** [MVP] Atalhos NÃO DEVEM disparar com `Ctrl`, `Cmd` ou `Alt`; DEVEM
  disparar com `Shift`.
- **REQ-HUB-012** [MVP] A barra DEVE suportar **badge** numérico por painel, alimentado
  pelo próprio painel, e o número DEVE respeitar o recorte de visibilidade do usuário.
- **REQ-HUB-013** [MVP] O painel ativo DEVE ser controlável por fora da barra (macro,
  mudança de cena, link do chat), e não apenas por clique ou tecla.
- **REQ-HUB-014** [V2] O Hub PODE oferecer atalho de zoom (`+`/`-`/`0`) quando o painel
  aberto for o Mapa, sem acrescentar item à barra de comando.

### Notificação do Sistema

- **REQ-HUB-015** [MVP] O Hub DEVE exibir notificações em uma pilha no topo da tela, em um
  dos quatro registros de cor.
- **REQ-HUB-016** [MVP] A pilha DEVE ter teto de exibição simultânea; notificação excedente
  DEVE **esperar em fila**, nunca ser descartada.
- **REQ-HUB-017** [MVP] O tempo de vida de uma notificação DEVE ser contado a partir do
  momento em que ela fica **visível**, não de quando entra na fila.
- **REQ-HUB-018** [MVP] O vencimento DEVE ser decidido pelo estado da fila, NÃO pelo fim de
  uma animação — indicadores de progresso são decorativos.
- **REQ-HUB-019** [MVP] Toda notificação DEVE derivar de um evento já entregue ao cliente
  pelos canais normais, redigido no servidor (DEC-HUB-09). NÃO DEVE existir canal de
  notificação paralelo à redação.
- **REQ-HUB-020** [MVP] O usuário DEVE poder dispensar uma notificação manualmente.

### Painel de Missões — leitura do jogador

- **REQ-HUB-021** [MVP] O painel de Missões DEVE listar as missões visíveis ao usuário,
  separando **publicadas** de **boatos**.
- **REQ-HUB-022** [MVP] Missão em estado oculto para o usuário NÃO DEVE chegar ao cliente
  dele — nem redigida, nem como contagem, nem como espaço vazio na lista.
- **REQ-HUB-023** [MVP] Missão em estado de rumor DEVE exibir o **boato**, e NÃO DEVE expor
  gancho, objetivos, vínculos de lugar ou qualquer campo do estado publicado.
- **REQ-HUB-024** [MVP] Missão publicada DEVE exibir gancho e os objetivos já liberados
  para aquele usuário, na ordem definida pelo GM.
- **REQ-HUB-025** [MVP] O painel DEVE distinguir visualmente objetivo **concluído** de
  objetivo **em aberto**.
- **REQ-HUB-026** [MVP] A lista DEVE atualizar em tempo real quando o GM muda uma
  revelação, sem recarregar a mesa.
- **REQ-HUB-027** [V2] O painel PODE exibir o relógio de uma missão quando o Motor de
  Campanha (`33`) o fornecer, como dado somente-leitura.

### Painel de Missões — autoria e revelação (GM)

- **REQ-HUB-028** [MVP] O GM DEVE dispor da **matriz de revelação**: missões nas linhas,
  jogadores nas colunas, o estado de cada par legível de relance.
- **REQ-HUB-029** [MVP] Cada célula da matriz DEVE permitir mudar o estado daquele jogador
  naquela missão, e a mudança DEVE ser um update de `ownership` do documento (DEC-HUB-02).
- **REQ-HUB-030** [MVP] A revelação DEVE estar disponível também **fora** da matriz, na
  própria linha da missão, com um clique (DEC-HUB-10).
- **REQ-HUB-031** [MVP] O GM DEVE dispor da ação **todos**, que leva a mesa ao próximo
  degrau a partir de quem está mais atrás e NUNCA rebaixa quem já está adiante.
- **REQ-HUB-032** [MVP] O GM DEVE poder liberar um objetivo individualmente, sem alterar o
  estado da missão nem o dos demais objetivos (DEC-HUB-06).
- **REQ-HUB-033** [MVP] O GM DEVE dispor da prévia **"ver como \<jogador\>"**, que
  apresenta o painel exatamente como aquele jogador o vê.
- **REQ-HUB-034** [MVP] Marcar uma missão como concluída DEVE ser privilégio de GM e DEVE
  ser reversível.
- **REQ-HUB-035** [MVP] Concluir uma missão NÃO DEVE alterar estados de revelação: uma
  missão concluída continua visível a quem a via.
- **REQ-HUB-036** [V2] A matriz DEVE suportar filtro e paginação quando o número de
  missões ativas passar do que cabe em uma tela.
- **REQ-HUB-037** [V2] O GM PODE reordenar objetivos de uma missão sem perder o estado de
  revelação de cada um.

### Missão e lugar

- **REQ-HUB-038** [MVP] Uma missão DEVE poder declarar vínculo com um ou mais POIs
  (REQ-MREG-005).
- **REQ-HUB-039** [MVP] Ao mudar o estado de revelação de uma missão vinculada, o Hub DEVE
  **oferecer** o mesmo degrau para os POIs vinculados em uma ação de um clique — e NÃO DEVE
  aplicá-lo automaticamente (DEC-HUB-07).
- **REQ-HUB-040** [MVP] A propagação oferecida NUNCA DEVE rebaixar o estado de um POI para
  um jogador que já o via em degrau superior.
- **REQ-HUB-041** [MVP] Missão publicada com POI vinculado e visível DEVE oferecer
  **rastrear no mapa**: abre o painel de Mapa e leva a câmera até o marcador.
- **REQ-HUB-042** [MVP] O vínculo NÃO DEVE ser exposto ao jogador que vê a missão apenas
  como boato.

### Painel de Comitiva

- **REQ-HUB-043** [MVP] O painel de Comitiva DEVE listar os personagens jogadores ativos na
  mesa, um por membro.
- **REQ-HUB-044** [MVP] Cada membro DEVE exibir, no mínimo: nome, retrato, pontos de vida e
  as condições ativas do sistema em uso.
- **REQ-HUB-045** [MVP] O recorte do que cada usuário vê de cada membro DEVE vir do
  ownership do Actor, redigido no servidor — o painel NÃO DEVE decidir visibilidade na tela.
- **REQ-HUB-046** [MVP] O membro DEVE ser expansível para detalhe sem sair do painel.
- **REQ-HUB-047** [MVP] O painel DEVE refletir mudanças de estado em tempo real (dano,
  cura, condição aplicada ou removida).
- **REQ-HUB-048** [MVP] O painel NÃO DEVE permitir edição de ficha; ações de edição DEVEM
  abrir a ficha (`11`).
- **REQ-HUB-049** [V2] Recursos com contador do sistema (ex.: Pontos de Foco em PF2e) DEVEM
  ser exibidos como pips, com máximo derivado da ficha.
- **REQ-HUB-050** [V2] O painel PODE listar companions e familiars ativos (`29`) agrupados
  sob o personagem a que pertencem.

### Painel de Mapa

- **REQ-HUB-051** [MVP] O painel de Mapa DEVE hospedar o mapa de região definido em `34`,
  sem reimplementar câmera, LOD ou revelação.
- **REQ-HUB-052** [MVP] O Console de Revelação (REQ-MREG-007) DEVE estar disponível dentro
  do painel para o GM, com o mesmo comportamento que tem no canvas.
- **REQ-HUB-053** [V2] O minimapa tático (`32`) DEVE poder montar como superfície do Hub
  (DEC-MMT-04) sem ocupar o slot de painel do Mapa.

### Contrato de painel

- **REQ-HUB-054** [MVP] Um painel DEVE declarar ao Hub: identificador, rótulo, tecla de
  atalho, e se está disponível para o papel do usuário.
- **REQ-HUB-055** [MVP] O Hub NÃO DEVE exibir na barra painel indisponível para o papel do
  usuário — nem desabilitado, nem oculto por CSS.
- **REQ-HUB-056** [MVP] Dois painéis NÃO DEVEM registrar a mesma tecla de atalho; o
  conflito DEVE falhar no registro, não em tempo de uso.
- **REQ-HUB-057** [V2] Um sistema de jogo DEVE poder registrar painel próprio pela API de
  sistemas (`15`), sem alteração no core do Hub.

---

## Requisitos não-funcionais

- **RNF-HUB-01** [MVP] Abrir ou fechar um painel NÃO DEVE causar recálculo de layout do
  canvas nem queda de quadro perceptível.
- **RNF-HUB-02** [MVP] A lógica do Hub que merece teste (fila de notificação, decisão de
  teclado, catálogo de painéis, cálculo de badge) DEVE viver em módulos testáveis fora dos
  componentes de UI — o cliente roda os testes sem montar componente.
- **RNF-HUB-03** [MVP] O Hub DEVE ser operável por teclado de ponta a ponta, e a moldura
  DEVE expor rótulo acessível para leitor de tela (`23`).
- **RNF-HUB-04** [MVP] O Hub NÃO DEVE depender de API restrita a contexto seguro: jogadores
  entram por IP de LAN em `http://`, onde essas APIs são indefinidas.
- **RNF-HUB-05** [MVP] Nenhum estado do Hub DEVE ser fonte de verdade: recarregar a mesa
  DEVE reconstruir tudo a partir do snapshot do servidor.
- **RNF-HUB-06** [V2] A matriz de revelação DEVE permanecer utilizável com 30 missões e 6
  jogadores.

---

## Modelo de dados

O Hub **não introduz Document novo** (DEC-HUB-04). Uma missão é uma `JournalEntry` com
páginas, e o estado por jogador é o `ownership` de cada peça:

| Peça                | Documento                        | Quem vê o quê                                           |
| ------------------- | -------------------------------- | ------------------------------------------------------- |
| Gancho              | `JournalEntryPage` (`text`)      | `observer`+ para quem tem a missão publicada            |
| Boato               | `JournalEntryPage` (`text`)      | `observer`+ para quem tem a missão como rumor           |
| Objetivo _n_        | `JournalEntryPage` (`text`)      | ownership próprio, liberado um a um (DEC-HUB-06)        |
| Vínculo com o lugar | `flags.fusion.hub.pois: UUID[]`  | redigido junto com a página que o carrega (REQ-HUB-042) |
| Conclusão           | `flags.fusion.hub.done: boolean` | acompanha a visibilidade da missão                      |

Duas consequências que não são negociáveis:

1. O estado "oculto" é **ausência de payload**, não um campo `hidden` que o cliente
   respeita. Missão oculta não chega ao cliente do jogador (REQ-HUB-022).
2. Como o Hub escreve `flags.fusion.hub.*`, esses campos precisam existir nos schemas de
   documento do servidor — schema que não declara o campo **apaga o campo em toda escrita**,
   silenciosamente. É o defeito que já sumiu com `grid` de toda cena (ver `docs/lessons.md`).

---

## Dependências

| Spec | O que o Hub consome                                                              |
| ---- | -------------------------------------------------------------------------------- |
| `02` | Ownership de documento e de embedded; `Note` com ownership próprio (REQ-DOC-056) |
| `04` | Entrega em tempo real das mudanças de revelação                                  |
| `05` | Papéis e matriz de permissão que decidem o que cada usuário recebe               |
| `11` | Window manager, escala de z-index (REQ-UIF-008), tema e i18n                     |
| `12` | `JournalEntry`/`JournalEntryPage` e @UUID (REQ-JRN-002, REQ-JRN-017)             |
| `21` | Redação no servidor — o Hub nunca implementa a sua                               |
| `23` | Teclado, leitor de tela e alvos de toque                                         |
| `34` | Mapa de região, POIs e Console de Revelação (REQ-MREG-005..009)                  |

Dependem **do Hub**: `32` (o minimapa monta como superfície do Hub, DEC-MMT-04) e `33`, que
usa o Hub como vitrine de relógios e frentes.

**Ponto de atenção:** o modelo desta spec assume que o `ownership` de uma
`JournalEntryPage` **sobrescreve** o da `JournalEntry` pai — que é a suposição registrada,
mas ainda não decidida, em Q-JRN-003. Se `12` resolver por herança, o gancho e o boato não
podem ser páginas da mesma entry, e DEC-HUB-04 precisa ser reaberta.

---

## Critérios de aceitação

- **CA-HUB-001** Com o Hub fechado, arrastar um token pelo canvas funciona sem nenhuma
  interferência da camada.
- **CA-HUB-002** `Q` abre Missões, `Q` de novo fecha; com o cursor no chat, digitar
  "quero" não abre nada.
- **CA-HUB-003** Cinco notificações disparadas de uma vez: três aparecem, duas esperam, e
  as cinco são exibidas — nenhuma some.
- **CA-HUB-004** Uma notificação que entra na fila enquanto o navegador está em segundo
  plano expira pelo tempo de exibição, não pelo tempo em fila.
- **CA-HUB-005** Um jogador com a missão oculta não recebe nada dela no payload — verificável
  por inspeção do socket, não por inspeção da tela.
- **CA-HUB-006** O jogador com rumor lê o boato e não encontra, em nenhum campo entregue, o
  gancho, os objetivos ou o POI vinculado.
- **CA-HUB-007** O GM libera o objetivo 3; o cliente do jogador passa a mostrar o objetivo 3
  e continua sem o 4, sem recarregar a mesa.
- **CA-HUB-008** `todos ▸` em uma missão com um jogador em rumor e outro em publicada leva o
  primeiro a publicada e deixa o segundo intocado.
- **CA-HUB-009** Revelar a missão como rumor oferece o mesmo degrau para o POI vinculado; ao
  recusar a oferta, o POI permanece oculto e a missão fica como rumor.
- **CA-HUB-010** "Ver como \<jogador\>" reproduz o painel daquele jogador, incluindo a
  ausência das missões ocultas.
- **CA-HUB-011** Concluir e desconcluir uma missão não altera nenhum estado de revelação.
- **CA-HUB-012** O painel de Comitiva mostra a condição aplicada em combate em menos de um
  segundo, para todos os que têm permissão de ver aquele Actor.
- **CA-HUB-013** Um jogador acessando por `http://<ip-da-lan>:33000` usa o Hub inteiro sem
  erro de console.
- **CA-HUB-014** Dois painéis declarando a mesma tecla falham no registro, com mensagem que
  nomeia os dois.

---

## Questões em aberto

- **Q-HUB-01** O gancho e o boato são duas páginas da mesma `JournalEntry` ou dois campos de
  uma página com redação por campo? A resposta depende de Q-JRN-003 (`12`).
- **Q-HUB-02** Quando o GM edita o gancho de uma missão já publicada, o jogador recebe algum
  sinal de "isto mudou", ou a mudança é silenciosa?
- **Q-HUB-03** Missão concluída sai da lista principal após algum tempo, ou fica para sempre
  em uma seção de arquivo? O protótipo não decide.
- **Q-HUB-04** Objetivo tem estado de conclusão **por jogador** ou é da mesa? O protótipo
  assume da mesa; campanhas com objetivos secretos individuais pediriam por jogador.
- **Q-HUB-05** O badge de Missões conta missões ativas ou novidades desde a última abertura?
  A segunda opção exige guardar "última leitura" por usuário.
- **Q-HUB-06** Um painel registrado por sistema de jogo (REQ-HUB-057) pode declarar atalho,
  ou o core reserva as teclas e o sistema recebe uma faixa própria?

---

## Referências

- `docs/design/referencias/04-system-window-interativo.html` — linguagem visual de origem.
- `docs/design/prototipo-log-missoes.html` — board, matriz de revelação, Comitiva e mapa,
  interativos, com toggle de papel.
- `docs/design/handoff-system-window-client.md` — estado do porte para o client Svelte, as
  decisões de teclado e de fila já tomadas, e o andaime a remover.
- `docs/design/fluxo-autoria-campanha.html` §C/§D — mock original do log de missões.
- `docs/design/mapa-isekai.md` — as quatro escalas de mapa e a regra "o mundo escala, a
  interface não".
- Issue #90 — o protótipo como insumo e as cinco perguntas que esta spec responde
  (DEC-HUB-01, DEC-HUB-05, REQ-HUB-034, DEC-HUB-08, DEC-HUB-10).
- Issue #76 — camada de overlay do Hub e a escala de z-index unificada.
