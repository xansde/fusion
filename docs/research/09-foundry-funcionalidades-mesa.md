# Funcionalidades de Mesa: Combate, Journal, Tabelas, Áudio, Macros, Cartas

> Pesquisa clean-room sobre o Foundry VTT (versões 12–14) para servir de insumo ao design do Fusion VTT.
> Nenhum trecho de código proprietário do Foundry foi copiado. Código de repositórios open-source (ex.: foundryvtt/pf2e, Apache-2.0 ou MIT) é citado em pequenos trechos com atribuição explícita.
> Data de pesquisa: 2026-06-11. Versão de referência principal: Foundry VTT v14 (build 14.358/14.359, stable abril 2026).

---

## 1. Combat Tracker

### 1.1 Modelo de Dados de Encontro

O Foundry representa cada encontro como um documento `Combat` persistido no banco do mundo. Um `Combat` contém uma coleção de `Combatant` embedded. As principais propriedades de estado são:

- `round` — contador de rodada (começa em 1 quando o combate é iniciado)
- `turn` — índice do combatente ativo na lista ordenada
- `started` — bool que indica se o encontro já foi iniciado
- `current` / `previous` — snapshots do estado { round, turn, tokenId } para detectar mudanças

Múltiplos encontros podem existir simultaneamente no mesmo mundo, cada um vinculado a uma cena. A partir do v13, encontros são **unlinked** por padrão — o mesmo encontro é visível em todas as cenas (útil quando os combatentes atravessam portais entre cenas).

### 1.2 Combatant

Cada `Combatant` mantém:

- Referência ao `Token` e ao `Actor` correspondente
- `initiative` — valor numérico (null antes de rolar)
- `defeated` — flag booleana
- `hidden` — flag que oculta o combatente dos jogadores

Os jogadores podem atualizar propriedades do sistema em seus próprios Combatants a partir do v13.

### 1.3 Iniciativa

A iniciativa é um número puro; a **fórmula** de rolagem é definida pelo sistema via `Combat#rollInitiative`. Operações disponíveis:

| Operação                     | Descrição                              |
| ---------------------------- | -------------------------------------- |
| Roll Initiative (individual) | Rola para um combatente específico     |
| Roll All                     | Rola para todos sem valor              |
| Roll NPCs                    | Rola apenas para combatentes não-PC    |
| Set Initiative               | Define manualmente sem rolar           |
| Reset All                    | Limpa todos os valores para re-rolagem |

A ordem na fila (`turns`) é gerada por `setupTurns()`, que ordena por `initiative` (descendente). Em caso de empate, a ordem é determinada pelo sistema (pode ser desempatada por atributo secundário definido pelo sistema, como Destreza no PF2e).

#### Iniciativa no PF2e (Remaster)

No sistema PF2e oficial do Foundry, a iniciativa pode ser rolada usando diferentes perícias além de Percepção — isso é definido no tracker como "statistic" do combatente. O módulo da comunidade _PF2e Avoid Notice_ exibe automaticamente resultados de furtividade versus os DCs de Percepção dos combatentes ao iniciar o encontro. Starfinder 2e segue lógica similar (Perception ou outras skills).

### 1.4 Turnos e Rodadas

Controles disponíveis no tracker:

| Controle       | Efeito                                            |
| -------------- | ------------------------------------------------- |
| Begin Combat   | Inicia o encontro, salta para rodada 1 turno 1    |
| Next Turn      | Avança para o próximo combatente                  |
| Previous Turn  | Retrocede ao combatente anterior                  |
| Next Round     | Incrementa rodada, volta ao primeiro combatente   |
| Previous Round | Decrementa rodada                                 |
| End Turn       | Disponível para o jogador ativo; avança o tracker |
| End Combat     | Finaliza o encontro (requer confirmação)          |

### 1.5 Combatentes Derrotados

O botão "Mark Defeated" seta `defeated: true` no combatante e aplica o ícone de caveira sobre o token. A configuração **Skip Defeated** no tracker faz com que combatentes derrotados sejam pulados automaticamente na progressão de turnos.

### 1.6 Visibilidade de NPCs

O toggle **Set Hidden** oculta completamente o combatente dos jogadores no tracker (o GM continua vendo). O menu de configuração do Combatant fornece a mesma opção. Isso é combinado frequentemente com tokens ocultos no canvas. Uma extensão popular, _Combat Tracker Extensions_, adiciona recursos como ofuscação de nomes, ocultação seletiva por tipo (NPC vs PC), e grupos de iniciativa.

### 1.7 Hooks de Turno (API)

O sistema expõe quatro hooks principais que sistemas e módulos podem interceptar:

```
Hooks.on("combatStart",  (combat, updateData) => { ... })
Hooks.on("combatTurn",   (combat, updateData, updateOptions) => { ... })
Hooks.on("combatRound",  (combat, updateData, updateOptions) => { ... })
Hooks.on("combatTurnChange", (combat, prior, current) => { ... })
```

Métodos lifecycle protegidos para override em sistemas:

- `_onStartTurn(combatant)` / `_onEndTurn(combatant)` — lógica por turno
- `_onStartRound()` / `_onEndRound()` — lógica por rodada
- `_onEnter(combatant)` / `_onExit(combatant)` — entrada/saída de combatentes

Adicionalmente, regions de cena (v12+) disparam eventos `Token Starts Turn` e `Token Ends Turn` e `Token Starts Round` e `Token Ends Round`, permitindo automação geográfica de efeitos durante o combate.

### 1.8 Combat Turn Marker (v13+)

A partir do v13, um marcador visual automático ("combat turn marker") aparece sobre o token ativo no canvas. No v14, o design padrão é um "squared circle" laranja-amarelo com variante cinza opcional.

### 1.9 Configuração do Tracker

O GM pode configurar o tracker para rastrear um recurso específico do sistema (ex.: HP) exibido ao lado de cada combatente. Também é possível vincular combates entre cenas com **Link Combat**.

---

## 2. Journals (Diários)

### 2.1 Estrutura

O Journal usa uma hierarquia de dois documentos:

- **`JournalEntry`** — container; mantém metadados, permissões e a coleção de páginas
- **`JournalEntryPage`** — documento embedded; unidade de conteúdo individual

Gerenciado pela coleção `Journal` do mundo. A sheet de renderização usa `JournalSheet` (ApplicationV2 no v13+).

### 2.2 Tipos de Página

| Tipo      | Tecnologia                             | Notas                                               |
| --------- | -------------------------------------- | --------------------------------------------------- |
| **Text**  | ProseMirror (padrão) ou Markdown       | Editor colaborativo em tempo real                   |
| **Image** | Referência `src` (local ou URL)        | Hand-outs visuais                                   |
| **Video** | Referência `src` (local, URL, YouTube) | Streaming externo suportado                         |
| **PDF**   | Referência `src` (upload ou URL)       | PDFs com formulários têm comportamento imprevisível |

### 2.3 Autosave e Edição Colaborativa

O ProseMirror salva automaticamente a cada 60 segundos (configurável). Múltiplos usuários podem editar a mesma página simultaneamente com atualizações em tempo real.

### 2.4 Show to Players

O GM pode:

- **Show Players** (a partir do menu da entrada): abre a journal para todos os jogadores
- Em modo multipage: clique direito em uma página específica para exibi-la seletivamente

### 2.5 Links @UUID

Qualquer documento do Foundry pode ser referenciado com a sintaxe:

```
@UUID[DocumentType.ID]{Label Customizado}
@UUID[JournalEntry.abc123.JournalEntryPage.def456#subheading]{Ir para seção}
```

Links são criados arrastando documentos da sidebar para o editor. UUIDs são gerados automaticamente e são mais confiáveis que links por nome. Formatos suportados: atores, itens, journal entries, páginas, tabelas, cenas, etc.

### 2.6 Secret Blocks

Blocos `Secret` são criados via menu "Block → Secret" no editor ProseMirror. O conteúdo encapsulado é visível apenas para o GM e o Owner do documento. O botão **Reveal** ao lado do bloco permite que o GM o torne visível para jogadores que estejam atualmente visualizando a página. O estado de revelação é persistido (não apenas para a sessão atual).

### 2.7 Table of Contents

O dropdown **Level** nos títulos das páginas controla o nível de indentação no índice da sidebar. Páginas de nível 1 ficam no topo; subpáginas em níveis inferiores ficam indentadas. Isso cria uma hierarquia navegável em journals multi-página.

### 2.8 Map Notes

Qualquer `JournalEntry` pode ser "pinada" em uma cena como uma `MapNote` (bandeira roxa). Ao clicar na nota, a journal é aberta. A visibilidade da nota segue as permissões da journal entry e o estado da névoa de guerra.

### 2.9 Permissões

Quatro níveis de permissão por usuário: `None` (oculto), `Limited` (apenas pin visível no mapa), `Observer` (leitura), `Owner` (edição completa).

---

## 3. Roll Tables (Tabelas Aleatórias)

### 3.1 Modelo de Dados

- **`RollTable`** — documento principal; propriedades: `formula` (fórmula de dados), `replacement` (bool), `displayRoll` (bool), coleção `results`
- **`TableResult`** — embedded; propriedades: `type` (0=Text, 1=Document, 2=Compendium), `range` ([min, max]), `weight` (default 1), `drawn` (bool), `documentCollection`, `documentId`

Acessado globalmente via `game.tables`.

### 3.2 Tipos de Resultado

| Tipo               | Comportamento                                                             |
| ------------------ | ------------------------------------------------------------------------- |
| **Text (0)**       | Exibe string ou HTML no chat                                              |
| **Document (1)**   | Referencia documento do mundo (Actor, Item, RollTable, etc.)              |
| **Compendium (2)** | Referencia documento em compendium pack; carregado apenas ao ser sorteado |

### 3.3 Draw com/sem Replacement

- **Com replacement** (`replacement: true`): resultados podem ser sorteados múltiplas vezes; o campo `drawn` é ignorado
- **Sem replacement** (`replacement: false`): ao ser sorteado, `drawn: true` é marcado e o resultado fica indisponível; a tabela pode ser reiniciada com `RollTable#reset()`, voltando todos os `drawn` para `false`

Sobreposição de ranges: quando ranges sobrepostos ocorrem, todos os resultados sobrepostos são considerados sorteados.

### 3.4 Pesos e Normalização

`weight` determina a frequência relativa de um resultado. O botão **Normalize Weights** auto-gera a fórmula de dados adequada (`1dN`) com base nos pesos somados. Resultados com peso maior ocupam ranges maiores.

### 3.5 Tabelas Aninhadas

Ao definir um resultado como `Document` apontando para outra `RollTable`, uma rolagem na tabela filho é automaticamente realizada quando aquele resultado é sorteado. Isso permite geradores procedurais em cadeia (ex.: "baú contém: [rola na tabela de tesouros]"). Textos descritivos podem ser inseridos antes/depois das subtabelas usando ranges correspondentes.

### 3.6 Permissões e Acesso

Jogadores com permissão `Limited` ou superior podem visualizar tabelas. Apenas GM/Assistente gerenciam pastas. Tabelas podem ser importadas de compendiums.

---

## 4. Playlists e Áudio

### 4.1 Arquitetura

Playlists são documentos `Playlist` contendo `PlaylistSound` embedded. O servidor gerencia o estado de reprodução e transmite comandos `play` para todos os clientes conectados quando uma playlist é ativada. Formatos suportados: `.flac`, `.mp3`, `.wav`, `.ogg`, `.webm`, `.opus`.

### 4.2 Modos de Reprodução

| Modo                | Comportamento                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **Sequential**      | Reproduz sons um após outro em ordem                                                            |
| **Shuffle**         | Reproduz um por vez em ordem aleatória                                                          |
| **Simultaneous**    | Reproduz todos os sons ao mesmo tempo                                                           |
| **Soundboard Only** | Não permite reprodução da playlist como um todo; apenas triggering manual de faixas individuais |

### 4.3 Fade

Tanto a playlist quanto faixas individuais têm configuração de **fade duration** em milissegundos. Os tempos de fade da playlist e da faixa são **combinados** (somados) para criar efeitos de transição cumulativos. O fade é aplicado ao iniciar e ao parar a reprodução.

### 4.4 Canais de Volume

O sistema mantém três canais distintos com controles master **por cliente** (não afetam outros usuários):

| Canal              | Conteúdo                                  |
| ------------------ | ----------------------------------------- |
| **Playlists**      | Músicas e sons sequenciais/simultâneos    |
| **Ambient Sounds** | Sons espaciais colocados nas cenas        |
| **Interface**      | Sons de UI (chat, rolagem de dados, etc.) |

Cada canal tem um slider master no sidebar de Playlists. Além disso, o volume por faixa é um multiplicador sobre o volume master.

### 4.5 Preloading

Sons podem ser pré-carregados (push do buffer de áudio para todos os clientes antes da reprodução) para garantir starts sincronizados.

### 4.6 Looping

Faixas podem ser configuradas para loop contínuo. Nota arquitetural: há uma lacuna audível entre loops (limitação de implementação) — módulos da comunidade como _The Sound of Silence_ resolvem com crossfade interno.

### 4.7 Ambient Sounds (Sons Ambientes no Canvas)

Ambient Sounds são instâncias de `AmbientSound` no canvas (`SoundsLayer`). Configuração:

- **Radius** — raio em unidades da grid
- **Volume Easing** — redução gradual de volume com a distância do token ao ponto de origem
- **Constrained by Walls** — paredes bloqueiam a propagação do som
- **Darkness Activation** — faixas de nível de escuridão (0–1) que ativam/desativam o som

Sons ambientes tocam em loop contínuo para tokens dentro do raio. A prévia pode ser feita tratando o cursor como um token. O volume é controlado pelo slider "Ambient Sounds" no sidebar, individualmente por cliente.

### 4.8 Scene-Linked Audio

Cenas podem ter uma playlist vinculada que inicia automaticamente quando a cena é ativada.

### 4.9 Módulos Relevantes

- **Playlist Enchantment / Playlist Enhancer** — controles adicionais e UI aprimorada
- **The Sound of Silence** — fade curves logarítmicas/equal-power, crossfade entre loops, gaps configuráveis

---

## 5. Cards (Sistema de Cartas)

### 5.1 Tipos de Stack

| Tipo     | Propósito                           | Operações Disponíveis             |
| -------- | ----------------------------------- | --------------------------------- |
| **Deck** | Coleção fonte de cartas             | Criar carta, Shuffle, Deal, Reset |
| **Hand** | Mão de um jogador específico        | Draw, Play, Pass                  |
| **Pile** | Pilha de cartas jogadas/descartadas | Pass, Shuffle, Reset              |

### 5.2 Modelo de Dados (Card)

Cada `Card` (embedded em `CardStack`) contém:

- `type` (padrão `base`, extensível pelo sistema)
- `suit` — naipe/categoria
- `value` — valor numérico para ordenação/lógica
- `width`, `height`, `rotation` — dimensões em pixels
- `faces[]` — array de faces com `name`, `img`, `text`
- `back` — imagem de verso com texto

### 5.3 Operações Principais

**Deal**: A GM abre um diálogo especificando quantidade, stacks destinatários, modo de draw (Top/Bottom/Random) e se as cartas são viradas face-down. Cada carta distribuída é marcada como `drawn` no Deck.

**Draw**: Origem em uma Hand; o jogador especifica o Deck fonte e a quantidade. Modos: Top, Bottom, Random.

**Pass**: Transfere múltiplas cartas entre piles/hands com quantidade e orientação configuráveis.

**Play**: Move uma carta individual de uma Hand para uma Pile (ou outra Hand).

**Shuffle**: Randomiza a ordem dentro de um Deck ou Pile, afetando a sequência de Draw.

**Reset**: Retorna todas as cartas de uma Pile ao Deck de origem.

### 5.4 Permissões

- `Limited`: stack visível apenas no diretório
- `Observer`: acesso de leitura (vê frente das cartas em stacks públicos)
- `Owner`: permissão completa, incluindo visibilidade das faces de cartas em Hands próprias

### 5.5 Import/Export e Persistência

Stacks suportam export/import JSON via context menu. Decks pré-definidos (baralho de 52 cartas em temas Dark/Light) estão incluídos. Stacks podem ser armazenados em Compendiums para reutilização entre mundos.

### 5.6 Extensibilidade

O sistema aceita `DocumentSheet` customizado para UIs especializadas. O módulo _Complete Card Management (CCM)_ adiciona interação com cartas diretamente no canvas (layer de cartas), com flip, rotação e associação de cartas a regiões.

---

## 6. Macros

### 6.1 Tipos

**Chat Macro**: Posta mensagens pré-definidas no chat. Suporta fórmulas de dados (ex.: `/r 1d20`), formatação HTML e links de documentos. Todos os usuários podem executar chat macros por padrão.

**Script Macro**: Executa JavaScript arbitrário usando a API completa do Foundry. Pode consumir recursos de personagem, rolar checks, toggle de condições, alterar aparência de tokens, etc. Requer permissão `MACRO_SCRIPT` (controlada pelo GM em Game Settings).

### 6.2 Hotbar

- Exibe 10 macros por vez, com **5 páginas** (50 macros no total)
- Atalhos de teclado: teclas 1–9 e 0 para os slots correspondentes
- Cada usuário mantém sua própria hotbar personalizada
- GMs podem configurar a hotbar de jogadores fazendo login como aquele usuário

### 6.3 Métodos de Execução

1. Clique no hotbar / atalho de teclado
2. Comando de chat: `/macro NomeDaMacro`
3. Botão Execute na janela de configuração da macro
4. Via chat com argumentos: `/macro Attack a Victim! manualVictim=Bob`

### 6.4 Variáveis de Contexto (Script Macros)

Variáveis disponíveis automaticamente:

| Variável                   | Conteúdo                              |
| -------------------------- | ------------------------------------- |
| `token`                    | Token selecionado                     |
| `actor`                    | Actor do token selecionado            |
| `canvas.tokens.controlled` | Array de todos os tokens selecionados |
| `scope`                    | Objeto contendo argumentos passados   |

Argumentos passados via `/macro` ou programaticamente ficam acessíveis via `scope.argName` ou diretamente como variáveis.

### 6.5 Permissões de Execução

Macros seguem as permissões padrão de documentos. A configuração "Configure Ownership" permite ao GM controlar acesso por usuário. A API respeita as permissões do usuário que executa (um jogador não pode, via macro, deletar um NPC que não tem permissão de Owner).

### 6.6 Execução como Outro Usuário

Via **socketlib** (módulo de biblioteca), é possível executar uma função no cliente de outro usuário ou no cliente do GM. Isso resolve o caso de uso de "executar macro com privilégios de GM a partir de ação do jogador" de forma controlada.

### 6.7 Macro Directory

Macros ficam organizadas em pastas no Macro Directory. É possível criar uma `RollTable` automaticamente a partir das macros de uma pasta (para seleção aleatória). Macros podem ser exportadas para compendiums e importadas de compendiums/JSON.

---

## 7. Game Time e Calendário

### 7.1 Sistema Nativo

O Foundry VTT mantém um `game.time.worldTime` — timestamp em segundos desde a época do mundo. Sistemas podem avançar/recuar o tempo programaticamente. Não há UI nativa de calendário — apenas a API de tempo subjacente.

### 7.2 Simple Calendar (Módulo Padrão de Facto)

O **Simple Calendar** (vigoren) é o módulo de calendário de referência da comunidade, com dezenas de milhares de instalações. Suporta:

- Calendários customizados (meses, semanas, dias intercalares)
- Presets incluídos para Gregoriano, Greyhawk, Eberron, Exandria, Golarian (PF2e), Forgotten Realms, etc.
- Integração com `game.time.worldTime` para sincronização
- API pública amplamente adotada por outros módulos

**Simple Calendar Reborn** é um fork mantido para compatibilidade com Foundry v13+, com migração de dados do Simple Calendar original.

**Seasons and Stars** é uma alternativa mais nova para v13+ com bridge de compatibilidade com a API do Simple Calendar.

---

## 8. Scene Regions (Regiões de Cena)

Introduzidas no v12 e expandidas no v13/v14. Regiões definem áreas interativas no mapa com **comportamentos** (behaviors) que são ativados por eventos.

### 8.1 Formas

| Forma     | Descrição                              |
| --------- | -------------------------------------- |
| Rectangle | Retângulo (ALT para quadrado perfeito) |
| Ellipse   | Elipse (ALT para círculo perfeito)     |
| Polygon   | Polígono de múltiplos pontos           |

Formas podem ser **holes** (geometria negativa que remove áreas). Cada forma aceita um **elevation range** para permitir que tokens passem acima ou abaixo. Uma região pode conter múltiplas formas com comportamentos compartilhados.

### 8.2 Comportamentos

**Contínuos** (sempre ativos quando habilitados):

| Behavior              | Efeito                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| Adjust Darkness Level | Exclui a área da Iluminação Global, com nível de escuridão configurável |
| Suppress Weather      | Previne renderização de clima dentro da região                          |
| Modify Movement Cost  | Multiplica o custo de movimento (0–5 em incrementos de 0.25)            |

**Baseados em Eventos** (triggados por eventos específicos):

| Behavior               | Efeito                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Display Scrolling Text | Texto animado colorido (opcional: apenas para GM)                            |
| Execute Macro          | Executa macro especificada; recebe behavior, event, region, scene como dados |
| Execute Script         | Similar ao Execute Macro mas executa arquivo de script                       |
| Pause Game             | Pausa o jogo para jogadores não-GM ao entrar na região                       |
| Teleport Token         | Transporta o token para outra região (mesma ou outra cena)                   |
| Toggle Behavior        | Habilita/desabilita behaviors vinculados baseado nos eventos de trigger      |

### 8.3 Eventos Disponíveis

```
Region Boundary Changed    Token Enters           Token Starts Turn
Behavior Status Changed    Token Exits            Token Ends Turn
Behavior Activated         Token Moves In         Token Starts Round
Behavior Deactivated       Token Moves Out        Token Ends Round
Behavior Viewed            Token Moves Within
Behavior Unviewed          Token Animates In / Out
```

### 8.4 Teleport Token (detalhes)

- Requer UUID de outra Scene Region como destino
- No v13+: múltiplos destinos suportados (`destinations[]`); usuário pode escolher se "choice is allowed" e destinos revelados; senão, destino é escolhido aleatoriamente
- Destino pode estar em outra cena

### 8.5 Ephemeral Tokens (v14)

Regiões podem spawnar tokens com parâmetro `{create: false}` para gerar tokens temporários (não persistidos no banco).

### 8.6 Visibilidade das Regiões

- Layer-only: visível apenas no Region layer ativo
- Always visible to GM
- Always visible to everyone

---

## 9. Scene Levels (v14 — Multi-Nível)

O **Scene Levels** é o recurso principal do v14 (released abril 2026), considerado a finalização de um item histórico do roadmap do Foundry desde 2018.

### 9.1 Conceito

Empilhamento vertical de múltiplas imagens ("levels") dentro de uma única cena, cada uma em uma elevação definida. Mantém visão, movimento, combate e carregamento fluido entre andares sem trocar de cena.

### 9.2 Capacidades

- Tiles, luzes, paredes e sons colocados uma vez e marcados como visíveis em múltiplos andares
- Grounds de andares inferiores visíveis de andares superiores
- Tokens categorizados por nível no sidebar de Placeables
- Indicadores de nível na navegação de cena (pip indicators)
- Campo Level no Token Configuration dialog
- Persistência do último nível visualizado ao retornar à cena

---

## 10. Módulos da Comunidade — "Features Esperadas"

A seguir, um inventário dos módulos que se tornaram expectativa padrão dos usuários de VTT moderno, essenciais para informar o design do Fusion.

### 10.1 Bibliotecas de Infraestrutura

| Módulo                            | Propósito                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **lib-wrapper**                   | Gerencia monkey-patching de forma segura, detecta conflitos entre módulos, aplica wrappers em cadeia com prioridades (LISTENER → WRAPPER → MIXED → OVERRIDE). Usado como dependência por dezenas de módulos. |
| **socketlib**                     | Abstrai comunicação websocket entre clients; permite executar funções no client do GM, de outro jogador, de todos os GMs, ou de uma lista de jogadores. Resolve problemas de permissão de forma controlada.  |
| **libWrapper** dependency pattern | Prática esperada: módulos declaram dependências em `module.json`; o gerenciador de módulos do Foundry valida antes de ativar.                                                                                |

### 10.2 Dados e Rolagens

| Módulo                | Propósito                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dice So Nice!**     | 3D dice com física realista, sons, temas customizáveis, per-die/per-actor appearance, API para custom dice 3D, efeitos em nat20, advantage, etc. Considerado praticamente obrigatório por grande parte da comunidade. |
| **Dice Tray**         | Interface simplificada de construção de fórmulas de dados na tela                                                                                                                                                     |
| **Better Rolltables** | UI avançada para RollTables, draw em bulk, loot generation                                                                                                                                                            |

### 10.3 Combate e Automação

| Módulo                               | Propósito                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monk's Active Tiles**              | Triggers em tiles do canvas: teleporte, abrir portas, esconder tokens, exibir mensagens, reproduzir sons, alterar elevação. Suporte a Levels 3D. Alternativa/complemento às Scene Regions nativas. |
| **Combat Tracker Extensions**        | Ocultação de nomes/iniciativa por tipo, ordem inversa, grupos, iniciativa de grupo, fases de combate customizadas                                                                                  |
| **Simultaneous Combat System (SCS)** | Modo de combate simultâneo (todos agem ao mesmo tempo)                                                                                                                                             |
| **Card Deck Initiative**             | Usa deck de cartas para determinar iniciativa                                                                                                                                                      |

### 10.4 UI e QoL (Quality of Life)

| Módulo               | Propósito                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Simple Calendar**  | Calendário de mundo customizável; se tornou o padrão de facto para timekeeping; API pública usada por outros módulos |
| **Monk's Token Bar** | Barra de recursos de tokens alternativa                                                                              |
| **PopOut!**          | Permite abrir sheets/journals em janelas separadas do browser                                                        |
| **Token Action HUD** | HUD contextual de ações do token selecionado                                                                         |

### 10.5 Áudio

| Módulo                              | Propósito                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **The Sound of Silence**            | Fade curves logarítmicas/equal-power para fades perceptivamente lineares, crossfade interno entre loops, gaps configuráveis entre faixas |
| **Playlist Enchantment / Enhancer** | UI de playlist aprimorada, controles adicionais                                                                                          |

### 10.6 Níveis e Espaço 3D

| Módulo                     | Propósito                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Levels (módulo legado)** | Predecessor ao Scene Levels nativo; empilhamento de andares antes do v14. Módulos como Complete Card Management adicionaram suporte a ele. |
| **Levels 3D Preview**      | Modo de preview 3D experimental; Monk's Active Tiles adicionou suporte a ele                                                               |

### 10.7 Journals e Documentos

| Módulo                     | Propósito                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| **Journals Like a Script** | Permite scripts embutidos em journals                                                            |
| **Journal Shortcuts**      | Links clicáveis em journals que ativam cenas, mostram imagens a jogadores, abrem outras journals |

---

## 11. Tabela de Expectativas de Usuários para Fusion

Com base nos módulos acima, segue uma síntese do que um usuário moderno de VTT espera em qualquer plataforma:

| Categoria         | Expectativa                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Combate           | Tracker com múltiplos encontros, skip defeated, visibilidade de NPC, hooks por turno/rodada, combat turn marker visual |
| Iniciativa        | Fórmula definida pelo sistema, suporte a roll por tipo de skill (PF2e), manual override, reordenação por drag          |
| Rolagens          | 3D dice animados (Dice So Nice-equivalente), áudio de rolagem, temas customizáveis                                     |
| Journal           | Múltiplos tipos de página, secret blocks, @UUID links, show to players, colaboração simultânea, map notes, PDF support |
| Tabelas           | Draw com e sem replacement, pesos, tabelas aninhadas, integração com compendiums                                       |
| Áudio             | Playlist com 4 modos, fade configurável, 3 canais com volume por cliente, ambient sounds espaciais, scene-linked audio |
| Cards             | Deck/hand/pile, deal/draw/pass/shuffle/recall, multi-face cards, permissões granulares                                 |
| Macros            | Chat e script, hotbar de 50 slots em 5 páginas, execute como GM via socket, variáveis de contexto                      |
| Calendário        | Calendário customizável com API pública (Simple Calendar-compatível)                                                   |
| Regiões           | Shapes polimórficos, teleport, execute macro, modify movement, pause game, darkness adjust, múltiplos eventos          |
| Módulos/Extensões | Sistema de módulos com gerenciamento de dependências e detecção de conflitos                                           |

---

## 12. Implicações Arquiteturais para o Fusion

1. **Combat como documento persistido**: o encontro deve ser um document first-class, não estado volátil em memória. Suporte a múltiplos encontros simultâneos desde o início.

2. **Iniciativa desacoplada do sistema base**: o documento `Combat` apenas armazena um número; a fórmula e a lógica de desempate ficam no sistema (PF2e, SF2e, Etmos) via override de método.

3. **Journal com ProseMirror ou equivalente**: editor rico com secret blocks, @UUID enrichers e colaboração em tempo real são expectativas não-negociáveis.

4. **Áudio sincronizado via server broadcast**: o servidor deve ser a fonte de verdade do estado de playback; clientes apenas reproduzem. Volume é sempre client-side.

5. **Roll Tables com draw sem replacement nativo**: o modelo `drawn: boolean` por resultado + método `reset()` é simples e eficiente.

6. **Cards como sistema isolado**: implementar Deck/Hand/Pile como tipos de stack do mesmo documento base.

7. **Scene Regions como sistema de behaviors**: arquitetura baseada em events + behaviors é mais flexível que tiles hardcoded; permite extensão pelo sistema e módulos.

8. **Macro system = sandbox JS**: o sistema de macros nativo é um REPL JavaScript completo. Para o Fusion, pode-se usar um modelo similar mas com sandbox controlada (ex.: QuickJS ou vm2 embeds).

9. **Biblioteca de socket abstraída**: replicar o padrão socketlib (registerFunction → executeAs[GM|User|All]) para habilitar módulos Fusion a agirem com privilégios delegados de forma segura.

10. **Dice So Nice como expectativa**: a ausência de 3D dice vai ser notada pelos usuários. Priorizar um renderer 3D de dados (Three.js/Cannon.js) ou pelo menos um sistema extensível por API.

---

## Fontes

- [Combat Encounters — Foundry VTT Knowledge Base](https://foundryvtt.com/article/combat/)
- [Combat API (v14) — Foundry VTT API Docs](https://foundryvtt.com/api/classes/foundry.documents.Combat.html)
- [Journal Entries — Foundry VTT Knowledge Base](https://foundryvtt.com/article/journal/)
- [Journal Entries Architecture — DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/4.1-journal-entries)
- [Rollable Tables — Foundry VTT Knowledge Base](https://foundryvtt.com/article/roll-tables/)
- [Rollable Tables Architecture — DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/4.4-rollable-tables)
- [Playlists — Foundry VTT Knowledge Base](https://foundryvtt.com/article/playlists/)
- [Playlists and Audio Architecture — DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/4.6-playlists-and-audio)
- [Ambient Sound — Foundry VTT Knowledge Base](https://foundryvtt.com/article/ambient-sound/)
- [Cards — Foundry VTT Knowledge Base](https://foundryvtt.com/article/cards/)
- [Card System Architecture — DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/4.5-card-system)
- [Macros — Foundry VTT Knowledge Base](https://foundryvtt.com/article/macros/)
- [Scene Regions — Foundry VTT Knowledge Base](https://foundryvtt.com/article/scene-regions/)
- [Release 14.358 — Foundry VTT](https://foundryvtt.com/releases/14.358)
- [Foundry VTT v14 Released — foundryvtt.store](https://www.foundryvtt.store/news/2026-04-01-foundry-vtt-v14)
- [lib-wrapper — GitHub (ruipin/fvtt-lib-wrapper)](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib — Foundry VTT Packages](https://foundryvtt.com/packages/socketlib)
- [Dice So Nice! — Foundry VTT Packages](https://foundryvtt.com/packages/dice-so-nice/)
- [Simple Calendar — Foundry VTT Packages](https://foundryvtt.com/packages/foundryvtt-simple-calendar)
- [Simple Calendar — GitHub (vigoren/foundryvtt-simple-calendar)](https://github.com/vigoren/foundryvtt-simple-calendar)
- [Seasons and Stars — GitHub (rayners/fvtt-seasons-and-stars)](https://github.com/rayners/fvtt-seasons-and-stars)
- [Monk's Active Tiles — Foundry VTT Packages](https://foundryvtt.com/packages/monks-active-tiles/)
- [Combat Tracker Extensions — Foundry VTT Packages](https://foundryvtt.com/packages/combat-tracker-extensions)
- [Better Rolltables — Foundry VTT Packages](https://foundryvtt.com/packages/better-rolltables/)
- [The Sound of Silence — GitHub (GnollStack)](https://github.com/GnollStack/The-Sound-of-Silence)
- [Library Modules — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/library-modules)
- [Sockets — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/sockets)
- [Audio — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/audio)
- [Time and Calendar — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/time)
- [PF2e system — GitHub (foundryvtt/pf2e)](https://github.com/foundryvtt/pf2e)
