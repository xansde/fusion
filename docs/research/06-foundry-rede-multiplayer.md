# Rede, Sincronização e Multiplayer do Foundry VTT

> Pesquisa de referência para o projeto Fusion — abordagem clean-room.
> Descreve comportamento observado, conceitos e formatos públicos. Nenhum trecho
> de código proprietário do Foundry foi copiado.

---

## Sumário

1. [Arquitetura geral do servidor](#1-arquitetura-geral-do-servidor)
2. [Camada de transporte: Socket.io → WebSocket nativo](#2-camada-de-transporte-socketio--websocket-nativo)
3. [Protocolo de CRUD de documentos](#3-protocolo-de-crud-de-documentos)
4. [Eventos de sistema e módulo (custom events)](#4-eventos-de-sistema-e-módulo-custom-events)
5. [Roles de usuário e matriz de permissões](#5-roles-de-usuário-e-matriz-de-permissões)
6. [Sessões, presença e cursores ao vivo](#6-sessões-presença-e-cursores-ao-vivo)
7. [Pings no mapa e controle de câmera](#7-pings-no-mapa-e-controle-de-câmera)
8. [Concorrência, reconexão e estado offline](#8-concorrência-reconexão-e-estado-offline)
9. [Áudio e vídeo integrado (A/V)](#9-áudio-e-vídeo-integrado-av)
10. [Persistência de dados: NeDB → LevelDB](#10-persistência-de-dados-nedb--leveldb)
11. [Hosting, NAT e limitações conhecidas](#11-hosting-nat-e-limitações-conhecidas)
12. [Soluções da comunidade para problemas de hosting](#12-soluções-da-comunidade-para-problemas-de-hosting)
13. [Referências de desempenho e escala](#13-referências-de-desempenho-e-escala)
14. [Fontes](#14-fontes)

---

## 1. Arquitetura geral do servidor

O Foundry VTT é executado como uma aplicação **Node.js** que serve ao mesmo tempo:

- Requisições HTTP/HTTPS estáticas (assets, páginas);
- Um endpoint WebSocket persistente para sincronização de estado em tempo real;
- Opcionalmente, a aplicação Electron embute o mesmo servidor para uso local.

### Porta e configuração

O arquivo `options.json` (na pasta de dados do usuário) controla o comportamento de rede. Os campos relevantes:

| Campo         | Tipo    | Descrição                                            |
| ------------- | ------- | ---------------------------------------------------- |
| `port`        | integer | Porta TCP de escuta (padrão 30000)                   |
| `hostname`    | string  | Hostname customizado para links de convite           |
| `routePrefix` | string  | Sub-caminho (ex: `demo` → `http://host:30000/demo/`) |
| `proxySSL`    | boolean | Indica que roda atrás de reverse proxy com SSL       |
| `proxyPort`   | integer | Porta exposta pelo proxy (para links corretos)       |
| `upnp`        | boolean | Configura port-forwarding automático via UPnP        |
| `sslKey`      | string  | Caminho para chave SSL (HTTPS direto)                |
| `sslCert`     | string  | Caminho para certificado SSL                         |
| `dataPath`    | string  | Diretório de dados customizado                       |
| `awsConfig`   | string  | Caminho para config de S3/AWS                        |

A partir do **v14**, foi adicionado suporte para o servidor escutar em um **Unix domain socket** em vez de porta TCP, via variável de ambiente `FOUNDRY_UNIX_SOCKET`. Quando definido, o Foundry faz bind no socket em vez da porta TCP — útil para reverse proxy local (nginx/caddy via socket), com menor overhead e isolamento de rede. Se ambos estiverem configurados, o socket tem precedência.

### Autenticação de administrador

Existe um **Admin Access Key** separado das senhas de usuário, que protege a tela de setup (instalação de sistemas, mundos, etc.). Esse key é armazenado como hash em `admin.txt` na pasta de configuração. Não é o mesmo mecanismo das senhas de usuário de mundo.

---

## 2. Camada de transporte: Socket.io → WebSocket nativo

### Histórico (até v11)

O Foundry usou **socket.io v4** como biblioteca de transporte WebSocket. A conexão ficava exposta em `game.socket` no cliente, e pacotes podiam emitir e receber eventos diretamente via essa API.

### Mudança planejada (v12+)

A partir do planejamento da v12 (issue #9776), a equipe do Foundry documentou como objetivo a **depreciação do socket.io** em favor da interface nativa `WebSocket` do browser. Isso envolve:

- Remoção da dependência do socket.io como abstração;
- Migração para a API `WebSocket` nativa do browser;
- Exploração de envio de dados em formato binário em vez de JSON comprimido.

**Importante**: a migração foi identificada como objetivo de longo prazo, não entregue integralmente na v12 estável. A v12 entregou o _buffering de atualizações de socket_ (ver seção 8), enquanto a migração completa para WebSocket nativo permanece em andamento nas versões subsequentes.

Na prática, `game.socket` ainda é referenciado na documentação v14 como do tipo `Socket<DefaultEventsMap, DefaultEventsMap>`, indicando que a interface socket.io ainda está presente em alguma forma na API pública.

### Configuração de proxy

Para funcionar corretamente atrás de um reverse proxy, o WebSocket requer headers específicos:

- **Nginx**: headers `Upgrade` e `Connection` devem ser repassados;
- **Apache**: requer módulo `mod_proxy_wstunnel`;
- **Caddy**: suporte nativo a WebSocket, com provisionamento SSL automático via Let's Encrypt.

---

## 3. Protocolo de CRUD de documentos

### Modelo Document

Toda entidade de jogo (Actor, Item, Scene, JournalEntry, ChatMessage, Token etc.) é uma subclasse de `Document`. O sistema usa uma hierarquia de documentos com suporte a documentos embutidos (_embedded documents_), como `Item` dentro de `Actor`.

### Fluxo de uma operação de update

O ciclo de um `Document.update()` segue estas etapas (comportamento observado na API pública):

1. **Cliente emite** um pedido de modificação via socket, contendo apenas o **diff** (delta mínimo) em relação ao estado atual. O método `_updateDiff()` computa uma cópia mutável do estado fonte, aplica as mudanças e registra as diferenças.

2. **Servidor recebe** a requisição, executa validação e verificação de permissões, e aplica as mudanças ao banco de dados (LevelDB desde v11).

3. **Servidor faz broadcast** da mudança confirmada para **todos os clientes conectados** (incluindo o originador).

4. **Clientes recebem** a atualização e disparam os hooks correspondentes (`updateDocument`, `updateActor`, `updateToken`, etc.).

### Operações disponíveis

| Método estático                     | Descrição                              |
| ----------------------------------- | -------------------------------------- |
| `Document.create(data)`             | Cria um ou múltiplos documentos        |
| `Document.updateDocuments(updates)` | Atualiza múltiplos documentos por diff |
| `Document.deleteDocuments(ids)`     | Remove documentos por array de IDs     |

### Hooks disparados em todos os clientes

Após cada operação de CRUD, hooks são disparados globalmente em todos os clientes conectados:

- `createDocument` / `create{Type}` (ex: `createActor`)
- `updateDocument` / `update{Type}`
- `deleteDocument` / `delete{Type}`

Esses hooks recebem o documento modificado, os dados de mudança e o contexto da operação.

### Lifecycle hooks client-side

Antes da operação atingir o banco, hooks de pré-operação permitem cancelamento:

- `_preCreate()`, `_preUpdate()`, `_preDelete()` — individuais, no cliente que iniciou
- `_preCreateOperation()`, `_preUpdateOperation()`, `_preDeleteOperation()` — por lote

Retornar `false` de qualquer hook de pré-operação cancela a operação completamente.

### SocketInterface e DocumentSocketRequest

A classe `SocketInterface` (no namespace `foundry.helpers`) é a abstração de baixo nível que padroniza o despacho de mensagens. Seu único método público é:

```
SocketInterface.dispatch(eventName: string, request: object | DocumentSocketRequest): Promise<SocketResponse>
```

O padrão distingue o cliente originador (recebe um _acknowledgement_) de todos os demais (recebem _broadcast_). Isso permite encapsular a transação completa em uma única `Promise` no lado do originador.

A interface `SocketRequest` contém dois campos opcionais:

- `broadcast?: boolean` — se a mensagem deve ser distribuída para múltiplos receptores
- `options?: object` — configurações adicionais da comunicação

### Modelo de autoridade: servidor como árbitro

O servidor Node.js é o árbitro final de todas as modificações de documento. O fluxo é:

```
Cliente → [socket] → Servidor
                    ↓ validação de permissão + schema
                    ↓ escrita no banco (LevelDB)
                    ↓ broadcast para todos os clientes
```

Não há "optimistic update" documentado publicamente — o cliente aguarda a confirmação do servidor antes de a mudança se tornar canônica. Mudanças concorrentes de múltiplos clientes no mesmo documento seguem uma política de **last-writer-wins** implícita, determinada pela ordem de chegada no servidor.

---

## 4. Eventos de sistema e módulo (custom events)

### Registro de namespace de socket

Para que um módulo ou sistema possa emitir e receber eventos customizados via socket, ele deve declarar `"socket": true` no manifest (`module.json` / `system.json`). Isso solicita ao servidor um namespace dedicado para o pacote.

### Nomenclatura obrigatória de eventos

Todos os eventos de socket de um pacote devem usar o prefixo:

- `module.{nome-do-modulo}` para módulos
- `system.{id-do-sistema}` para sistemas

Exemplo: um módulo chamado `meu-modulo` só pode emitir e receber o evento `module.meu-modulo`.

**Limitação**: cada pacote tem direito a exatamente um nome de evento. Para múltiplas operações dentro do mesmo pacote, o padrão recomendado é usar um objeto como payload, com um campo `type` e um campo `payload`:

```javascript
// Padrão recomendado para múltiplas operações num único evento
game.socket.emit("module.meu-modulo", { type: "minhaOperacao", payload: { ... } });
```

### CONFIG.queries — alternativa com controle de permissão

Uma alternativa mais estruturada ao `socket.emit` direto é o sistema `CONFIG.queries`. Queries são handlers registrados que:

1. São registrados com prefixo do pacote: `CONFIG.queries["meu-modulo.minhaQuery"] = async (data, { timeout }) => { ... }`
2. Possuem controle de permissão embutido (a permissão `QUERY_USER` controla quem pode disparar queries)
3. Retornam dados JSON-serializáveis de volta ao cliente solicitante
4. Dois queries são nativos do core: `dialog` e `confirmTeleportToken`

Queries não são eventos de broadcast — são do tipo request/response com um único respondente.

### socketlib — biblioteca da comunidade (open-source)

A biblioteca `socketlib` (disponível em https://foundryvtt.com/packages/socketlib) é um wrapper open-source que abstrai os sockets nativos do Foundry e fornece:

| Função                                         | Comportamento                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `socket.executeAsGM(fn, ...args)`              | Executa a função em exatamente um GM conectado; retorna o valor via `Promise` |
| `socket.executeForEveryone(fn, ...args)`       | Executa em todos os clientes; resolve após envio, sem aguardar retorno        |
| `socket.executeForOthers(fn, ...args)`         | Igual, excluindo o cliente local                                              |
| `socket.executeAsUser(userId, fn, ...args)`    | Executa em um usuário específico; falha se não conectado                      |
| `socket.executeForUsers(userIds, fn, ...args)` | Executa em uma lista de usuários por ID                                       |
| `socket.executeForAllGMs(fn, ...args)`         | Executa em todos os GMs conectados                                            |

**Pré-requisito**: funções devem ser registradas via `socket.register(nome, fn)` em **todos** os clientes antes de poder ser chamadas remotamente. O módulo inicializa no hook `socketlib.ready`.

O padrão `executeAsGM` é a solução padrão da comunidade para o problema de _privilege escalation_ legítima: quando um jogador precisa que uma operação seja executada com permissão de GM (ex: deduzir HP de um inimigo após ataque), o cliente do jogador solicita ao cliente do GM que execute a operação, sem expor a operação diretamente ao servidor sem validação.

---

## 5. Roles de usuário e matriz de permissões

### Roles (papéis)

O Foundry define cinco roles, com valores numéricos em ordem crescente de permissão:

| Role         | Valor | Descrição                                                  |
| ------------ | ----- | ---------------------------------------------------------- |
| `NONE`       | 0     | Usuário bloqueado — não pode entrar no jogo                |
| `PLAYER`     | 1     | Jogador padrão com funcionalidades básicas                 |
| `TRUSTED`    | 2     | Jogador com permissões avançadas opcionais                 |
| `ASSISTANT`  | 3     | Mestre assistente — controle de jogo mas sem administração |
| `GAMEMASTER` | 4     | Controle administrativo total sobre o Mundo                |

A distinção entre `ASSISTANT` e `GAMEMASTER` é que o ASSISTANT não pode alterar roles de usuário nem configurações globais do Mundo.

### Permissões configuráveis (`USER_PERMISSIONS`)

Além das capacidades fixas por role, existe uma **matriz de permissões configurável** que o GM pode ajustar no menu "Permission Configuration". Cada permissão tem um `defaultRole` (role mínimo que a tem por padrão) e um flag `disableGM` (se GMs são isentos da checagem).

Lista completa de permissões (Foundry VTT v14):

| Permissão         | defaultRole   | Descrição                                    |
| ----------------- | ------------- | -------------------------------------------- |
| `ACTOR_CREATE`    | 3 (ASSISTANT) | Criar novos Atores                           |
| `BROADCAST_AUDIO` | 2 (TRUSTED)   | Transmitir áudio via A/V                     |
| `BROADCAST_VIDEO` | 2 (TRUSTED)   | Transmitir vídeo via A/V                     |
| `CARDS_CREATE`    | 3 (ASSISTANT) | Criar novos Baralhos de cartas               |
| `DRAWING_CREATE`  | 2 (TRUSTED)   | Criar desenhos no canvas                     |
| `FILES_BROWSE`    | 2 (TRUSTED)   | Navegar no navegador de arquivos             |
| `FILES_UPLOAD`    | 3 (ASSISTANT) | Fazer upload de arquivos para o servidor     |
| `ITEM_CREATE`     | 3 (ASSISTANT) | Criar novos Itens                            |
| `JOURNAL_CREATE`  | 2 (TRUSTED)   | Criar entradas de diário                     |
| `MACRO_SCRIPT`    | 1 (PLAYER)    | Executar macros de script                    |
| `MANUAL_ROLLS`    | 2 (TRUSTED)   | Inserir resultados de dados manualmente      |
| `MESSAGE_WHISPER` | 1 (PLAYER)    | Enviar mensagens privadas (whisper)          |
| `NOTE_CREATE`     | 2 (TRUSTED)   | Criar notas no canvas                        |
| `PING_CANVAS`     | 1 (PLAYER)    | Pingar localização no mapa                   |
| `PLAYLIST_CREATE` | 3 (ASSISTANT) | Criar playlists de áudio                     |
| `QUERY_USER`      | 1 (PLAYER)    | Usar o sistema de queries de socket          |
| `REGION_CREATE`   | 1 (PLAYER)    | Criar regiões de cena                        |
| `SETTINGS_MODIFY` | 3 (ASSISTANT) | Modificar configurações do cliente           |
| `SHOW_CURSOR`     | 1 (PLAYER)    | Exibir cursor ao vivo para outros usuários   |
| `SHOW_RULER`      | 1 (PLAYER)    | Exibir régua de medição para outros usuários |
| `TOKEN_CONFIGURE` | 2 (TRUSTED)   | Configurar tokens                            |
| `TOKEN_CREATE`    | 3 (ASSISTANT) | Criar tokens no canvas                       |
| `TOKEN_DELETE`    | 3 (ASSISTANT) | Deletar tokens do canvas                     |
| `WALL_DOORS`      | 1 (PLAYER)    | Interagir com portas                         |

O GM pode modificar o `defaultRole` de qualquer permissão para tornar o ambiente mais restrito ou mais permissivo.

### Permissões de ownership de documentos

Além das permissões de role, cada documento individual tem um nível de _ownership_ por usuário:

| Nível      | Valor | Descrição                           |
| ---------- | ----- | ----------------------------------- |
| `NONE`     | 0     | Normalmente impede visibilidade     |
| `LIMITED`  | 1     | Acesso básico com conteúdo limitado |
| `OBSERVER` | 2     | Acesso de leitura completo          |
| `OWNER`    | 3     | Leitura e modificação completas     |

GMs sempre têm `OWNER` implícito sobre todos os documentos. O objeto de permissão de um documento usa `userId` como chave e valor numérico como nível; a chave `"default"` define o nível padrão para todos os usuários não listados explicitamente.

---

## 6. Sessões, presença e cursores ao vivo

### Autenticação por mundo

O Foundry **não tem contas globais** — cada Mundo tem sua própria lista de usuários. O processo de login é:

1. O usuário acessa a URL do servidor (ex: `http://host:30000`)
2. Seleciona seu nome de usuário e digita a senha (se configurada)
3. Recebe um token de sessão que identifica o usuário durante a conexão WebSocket

Senhas de usuário são armazenadas como hashes — a partir da v0.8.7, o sistema migrou de "access keys" informais para senhas hasheadas propriamente ditas. Senhas de usuário NÃO são criptograficamente seguras para reutilização em outros serviços.

### Presença e usuários conectados

A coleção `game.users` contém todos os documentos `User` do Mundo. O `game.userId` identifica o usuário atual. A propriedade `game.user` retorna o `User` conectado.

Usuários têm um estado de "ativo" que reflete se estão conectados. Mudanças no estado de presença são comunicadas via socket para todos os clientes, permitindo que a interface mostre quais jogadores estão online.

### Cursores ao vivo

Jogadores com a permissão `SHOW_CURSOR` têm seus movimentos de cursor transmitidos em tempo real para os demais usuários na mesma cena. Cada usuário tem uma cor associada (configurável) que identifica visualmente seu cursor e régua de medição.

A permissão `SHOW_RULER` controla se a régua de medição (drag de distância) é visível para outros.

### Pausa do jogo

O GM pode pausar e despauzar o jogo via `game.togglePause()`. O método aceita `{ broadcast: boolean, userId: string }` — quando `broadcast: true`, o estado de pausa é transmitido para todos os clientes conectados.

---

## 7. Pings no mapa e controle de câmera

### Tipos de ping

O Foundry implementa três tipos nativos de ping no canvas:

| Tipo             | Ativação                          | Comportamento                                  |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| **Basic Ping**   | Click prolongado                  | Círculo pulsante na cor do usuário             |
| **Warning Ping** | Alt + Click                       | Triângulo vermelho pulsante                    |
| **Drag Ping**    | Shift + Click (GM/ASSISTANT only) | Círculo com seta; força pan de câmera de todos |

Usuários que estão na mesma cena mas vendo outra área veem uma **seta pulsante na borda da UI** indicando a direção do ping.

### Força pan (pull de jogadores)

O **Drag Ping** é exclusivo de GMs e ASSISTANTs. Quando ativado, **move a câmera de todos os usuários na cena** para centralizar na localização do ping. Isso é o mecanismo de "force pan" ou "pull de câmera" — o GM pode direcionar a atenção de todos para um ponto específico do mapa.

A permissão `PING_CANVAS` controla quem pode pingar (padrão: PLAYER). O tipo "Drag" que força pan é restrito por role (ASSISTANT mínimo).

---

## 8. Concorrência, reconexão e estado offline

### Concorrência: last-writer-wins

O Foundry não implementa controle de concorrência otimista documentado publicamente. O modelo é essencialmente **last-writer-wins**: múltiplas atualizações concorrentes no mesmo campo de um documento resultam na última a chegar ao servidor prevalecendo. Para operações de baixa frequência (como editar uma ficha de personagem), isso é aceitável. Para operações de alta frequência (movimento de token), o canal de socket provê ordenação FIFO no servidor.

### Buffering de atualizações no carregamento

Um problema identificado e corrigido na v12 (release 12.318) foi a **janela de perda de atualizações** durante o carregamento da página: atualizações que chegavam via socket entre o `DOMContentLoaded` e o evento `game.ready` (quando o estado inicial é estabelecido) podiam ser descartadas.

A solução implementada foi um **buffer de atualizações de socket** que captura todas as atualizações recebidas antes de `game.ready` e as aplica em ordem assim que o jogo é inicializado, garantindo que nenhuma mudança seja perdida nessa janela.

### Reconexão

O Foundry não tem um sistema robusto de reconexão automática documentado publicamente. Comportamentos observados pela comunidade quando a conexão cai:

- A interface pode parecer funcional mas operações como upload de arquivo falham silenciosamente;
- Ao reconectar, o usuário é redirecionado para a tela de login;
- O servidor trata reconexões como novas sessões — recarregamento completo do estado;
- Módulos de terceiros como `connection-monitor` monitoram e notificam desconexões.

A issue #4770 (aberta em 2020, ainda não totalmente resolvida) documenta a necessidade de melhorar a experiência de re-estabelecimento da conexão WebSocket, sugerindo que o reconhecimento automático de estado ainda é uma área de melhoria no Foundry.

### Latência

A partir da v13 (milestone v13 Prototype 1, issue #11132), o Foundry implementou um indicador nativo de latência por usuário. A medição usa o endpoint WebSocket já estabelecido (não HTTP/fetch separado), medindo o tempo de ida e volta (_round-trip time_) para o servidor. Isso permite ao GM identificar jogadores com conexão lenta ou instável diretamente na interface.

---

## 9. Áudio e vídeo integrado (A/V)

### Arquitetura padrão: WebRTC P2P (mesh)

O mecanismo nativo de A/V do Foundry usa **WebRTC peer-to-peer** em topologia mesh, implementado via a biblioteca open-source **simple-peer**. Nesse modelo:

- Cada usuário envia seu stream de áudio/vídeo **diretamente para todos os outros participantes**;
- Com N participantes, há `N * (N-1)` conexões unidirecionais;
- Para 8 usuários: 56 conexões totais;
- O servidor Foundry atua apenas como **servidor de sinalização** (troca de SDP e ICE candidates), não como relay de mídia.

### Componentes de arquitetura A/V

| Componente    | Função                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| `AVMaster`    | Controller principal; gerencia lifecycle das conexões WebRTC e coordena com o servidor |
| `AVConfig`    | FormApplication para seleção de dispositivos e configuração de relay                   |
| `CameraViews` | UI sidebar que renderiza o dock de câmeras                                             |

### Requisitos obrigatórios

**SSL é mandatório para A/V**: browsers modernos restringem acesso a microfone/câmera a origens seguras (HTTPS). Localhost é exceção permitida para testes.

Adicionalmente, portas UDP precisam estar abertas para o tráfego WebRTC. A configuração de STUN/TURN é feita no menu `AVConfig`.

### Limitações do modelo mesh

O modelo P2P mesh tem limitações severas de escala:

- Bandwidth de upload cresce linearmente com o número de participantes;
- Com 7 jogadores + 1 GM, a carga de upload de cada usuário já é significativa;
- Bugs conhecidos ("black screens", streams congelando) em grupos maiores que ~6-8 pessoas;
- A biblioteca `simple-peer` tem bugs reportados que a equipe do Foundry não conseguiu resolver (dependência de terceiro).

### Providers alternativos

O sistema de A/V é **plugável via módulos**. Providers oficialmente suportados:

#### LiveKit (recomendado pela comunidade)

LiveKit usa arquitetura **SFU (Selective Forwarding Unit)**:

- Cada usuário envia seu stream **uma única vez** ao servidor LiveKit;
- O servidor distribui para os demais — drasticamente menos bandwidth por cliente;
- Requer um servidor LiveKit separado (self-hosted ou cloud).

Configuração do cliente:

- LiveKit Server: URL do servidor (ex: `rtc.example.com`)
- API Key + Secret Key para autenticação

Portas necessárias no servidor LiveKit:

| Porta/Protocolo | Uso                         |
| --------------- | --------------------------- |
| 7880/TCP        | Signaling HTTP              |
| 7881/TCP        | Signaling TLS               |
| 3478/UDP        | TURN (STUN)                 |
| 443/UDP         | TURN sobre TLS              |
| 50000-60000/UDP | Tráfego de mídia (RTP/RTCP) |

Funcionalidades extras do LiveKit AVClient:

- Breakout Rooms (dividir o grupo);
- Adaptive Streaming (reduz qualidade dinamicamente conforme bandwidth);
- Opus DTX (reduz bandwidth de áudio em silêncio);
- Indicador de qualidade de conexão;
- Web client externo para dispositivos separados/mobile.

#### Jitsi (depreciado)

O módulo oficial Jitsi (`jitsirtc`) foi marcado como depreciado. Jitsi também usa um servidor de relay que elimina a necessidade de P2P direto, com menor requisito de CPU/bandwidth que o mesh, mas foi superado pelo LiveKit em recursos e manutenção.

### Opções de hospedagem do LiveKit

| Opção             | Custo             | Observações                                   |
| ----------------- | ----------------- | --------------------------------------------- |
| Self-hosted (VPS) | ~$5-10/mês        | Requer portas UDP abertas; Docker recomendado |
| LiveKit Cloud     | Gratuito limitado | Minutos/bandwidth mensais limitados           |
| At the Tavern     | $5+/mês (Patreon) | Cluster multi-região                          |
| The Forge         | Incluído          | Sem configuração necessária                   |

---

## 10. Persistência de dados: NeDB → LevelDB

### Histórico

Até a v10, o Foundry usava **NeDB** para persistência de documentos — um banco de dados NoSQL embutido que armazenava dados em arquivos de texto legíveis como JSON. NeDB foi abandonado pelo mantenedor original e apresentava vulnerabilidades de segurança.

### Migração para LevelDB (v11)

Na v11, o Foundry migrou para **ClassicLevel**, uma implementação de **LevelDB** do Google. Diferenças fundamentais:

| Aspecto              | NeDB                            | LevelDB                        |
| -------------------- | ------------------------------- | ------------------------------ |
| Formato em disco     | Arquivos de texto JSON legíveis | Arquivos binários (SSTables)   |
| Edição manual        | Possível com editor de texto    | Requer ferramentas específicas |
| Performance          | Limitada                        | Alta (I/O otimizado)           |
| Documentos embutidos | Update completo do pai          | Update parcial via sublevels   |
| Manutenção           | Abandonado                      | Ativo (Google)                 |

### Implicações para a arquitetura de multiplayer

A migração para LevelDB criou novos desafios de concorrência:

- LevelDB usa **locks exclusivos** — apenas um processo pode acessar o banco de um Mundo por vez;
- Isso impede rodar múltiplas instâncias do Foundry com mundos compartilhados;
- A Forge (provedor de hosting) enfrentou esse problema com múltiplos Mundos no mesmo servidor e implementou uma solução com **rave-level** (wrapper com sistema de eleição de líder via Unix socket).

### Formato de distribuição de compêndios

Compêndios de sistemas como o PF2e são distribuídos em formato LevelDB. O CLI oficial do Foundry (`foundryvtt-cli`) permite desempacotar LevelDB em JSON/YAML para versionamento em git.

---

## 11. Hosting, NAT e limitações conhecidas

### Modelo de hosting

| Opção                                       | Prós                       | Contras                                                                                                   |
| ------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Self-hosted (residencial)**               | Gratuito; controle total   | Requer port-forwarding; ISP com IP dinâmico; upload limitado; disponível apenas quando o app está rodando |
| **Self-hosted (VPS/cloud)**                 | Sempre online; IP fixo     | Custo mensal; setup técnico                                                                               |
| **Partner hosted** (The Forge, Molten etc.) | Setup simples; suporte; HA | Custo; customização limitada                                                                              |

### Requisitos mínimos de servidor (Node.js dedicado)

- OS: Linux com glibc 2.28+ / Windows / macOS
- Node.js: versão 20+ (22 recomendado; 23+ incompatível)
- vCPU: 1 mínimo (2 recomendado)
- RAM: 2GB mínimo (4GB recomendado)
- Storage: 1GB mínimo
- Upload: **1.5 MB/s (12 Mbps)** recomendado; 6 Mbps mínimo com S3

### Problema de NAT

O principal obstáculo para hosting residencial é o **NAT (Network Address Translation)**, especialmente:

- **Carrier-Grade NAT (CG-NAT)**: ISPs que compartilham um único IP público entre múltiplos clientes. Port-forwarding não funciona nesse cenário.
- **IPv6-only**: algumas configurações residenciais modernas.

### Problema de bandwidth para assets

O servidor Foundry atua como distribuidor de todos os assets (imagens, áudio, vídeo de cenas) para todos os jogadores conectados. Com mundos ricos em mídia e múltiplos jogadores, o upload residencial é o gargalo principal.

**Solução**: integração com **AWS S3** (ou S3-compatible como DigitalOcean Spaces). Quando configurado, o Foundry serve assets diretamente do S3 para os clientes, sem passar pelo upload do host. Reduz drasticamente o uso de bandwidth do servidor.

---

## 12. Soluções da comunidade para problemas de hosting

### Reverse proxy com Nginx/Apache/Caddy

Todos os três principais reverse proxies são documentados na wiki oficial. Caddy é o recomendado modernamente por provisionar SSL automático via Let's Encrypt.

Requisitos comuns para WebSocket:

- Nginx: headers `Upgrade: websocket` e `Connection: Upgrade` devem ser repassados
- Apache: módulo `mod_proxy_wstunnel` obrigatório

### Cloudflare Tunnel

Para hosts sem IP público (CG-NAT), o **Cloudflare Tunnel** (antes chamado Argo Tunnel) cria um túnel criptografado de saída da máquina local para a rede da Cloudflare:

- Elimina necessidade de port-forwarding
- Providencia domínio HTTPS gratuito
- **Limitação**: WebRTC A/V **não funciona** através de Cloudflare Tunnel — a mídia P2P/SFU requer conexão direta ou servidor LiveKit separado
- Adequado para o tráfego de dados do Foundry (WebSocket + HTTP)

### SSH Reverse Tunnel / ngrok / Pinggy

Para acesso temporário, ferramentas como Pinggy criam túneis SSH reversos que expõem a porta local com uma URL pública:

- Conexão iniciada de dentro da rede, contornando CG-NAT e firewalls
- Adequado para sessões ad-hoc sem servidor cloud

### Unix socket + reverse proxy local (v14)

A partir da v14, para hosting em VPS com reverse proxy na mesma máquina, usar `FOUNDRY_UNIX_SOCKET` oferece:

- Menor overhead que TCP loopback
- Maior segurança (Foundry não exposto diretamente na rede)
- Compatível com Nginx, Caddy, Traefik

### S3 para assets

Com `awsConfig` configurado no `options.json`, todos os assets são servidos diretamente do S3 para os clientes:

- Elimina gargalo de upload residencial
- Funciona com qualquer provedor S3-compatible (MinIO, DigitalOcean Spaces, Backblaze B2)
- Requer configuração de CORS no bucket S3

### CDN com Cloudflare

Para assets estáticos, Cloudflare pode ser configurado como CDN na frente do servidor Foundry, cacheando assets próximos dos jogadores. Combinado com S3, elimina praticamente toda a carga de bandwidth do host para assets.

---

## 13. Referências de desempenho e escala

### Número de jogadores

Não existe limite técnico documentado de jogadores concorrentes. Os limites práticos são:

- **Bandwidth de upload** do host (para assets + socket updates)
- **CPU** para processamento de socket e LevelDB I/O
- **A/V**: o gargalo mais severo é o modelo mesh — 7-8 usuários de vídeo é o limite prático com P2P; com LiveKit SFU, grupos maiores são viáveis

### Observações da comunidade (Forge forums)

Para uma sessão com 1 GM + 7 jogadores (8 total) com vídeo ativo no modelo mesh:

- 42 conexões WebRTC bidirecionais entre os participantes
- Instabilidades frequentes (telas pretas, streams congelando)
- Recomendação: usar LiveKit para grupos acima de 4-5 pessoas

### Melhorias de performance v14

O Foundry v14 documentou "melhorias de desempenho de 3% a 25%" para operações comumente realizadas, resultantes de refatorações em componentes críticos da arquitetura interna.

---

## 14. Fontes

- [Sockets | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/sockets)
- [Network Configuration | DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/2.3-network-configuration)
- [A/V Integration | DeepWiki](https://deepwiki.com/foundryvtt/foundryvtt/7-av-integration)
- [socketlib | Foundry Virtual Tabletop](https://foundryvtt.com/packages/socketlib)
- [GitHub - farling42/foundryvtt-socketlib](https://github.com/farling42/foundryvtt-socketlib)
- [SocketInterface v13 API](https://foundryvtt.com/api/classes/foundry.helpers.SocketInterface.html)
- [SocketInterface v10 API](https://foundryvtt.com/api/v10/classes/client.SocketInterface.html)
- [SocketRequest v13 API](https://foundryvtt.com/api/interfaces/foundry.types.SocketRequest.html)
- [Users and Permissions | Foundry Virtual Tabletop](https://foundryvtt.com/article/users/)
- [USER_ROLES v14 API](https://foundryvtt.com/api/variables/CONST.USER_ROLES.html)
- [USER_PERMISSIONS v13 API](https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html)
- [Document v14 API](https://foundryvtt.com/api/classes/foundry.abstract.Document.html)
- [hookEvents v14 API](https://foundryvtt.com/api/modules/hookEvents.html)
- [Audio/Video Chat Integration | Foundry Virtual Tabletop](https://foundryvtt.com/article/audio-video/)
- [LiveKit AVClient | Foundry Virtual Tabletop](https://foundryvtt.com/packages/avclient-livekit)
- [Pings | Foundry Virtual Tabletop](https://foundryvtt.com/article/pings/)
- [Application Configuration | Foundry Virtual Tabletop](https://foundryvtt.com/article/configuration/)
- [Minimum Requirements | Foundry Virtual Tabletop](https://foundryvtt.com/article/requirements/)
- [Hosting Options Guide | Foundry Virtual Tabletop](https://foundryvtt.com/article/hosting/)
- [V12 Data Architecture Investments · Issue #9776](https://github.com/foundryvtt/foundryvtt/issues/9776)
- [Display user latency · Issue #11132](https://github.com/foundryvtt/foundryvtt/issues/11132)
- [Improve WebSocket reconnection · Issue #4770](https://github.com/foundryvtt/foundryvtt/issues/4770)
- [Unix socket listener · Issue #9170](https://github.com/foundryvtt/foundryvtt/issues/9170)
- [Deprecate Access Keys · Issue #4462](https://github.com/foundryvtt/foundryvtt/issues/4462)
- [Migrate NEDB to LevelDB · Issue #5065](https://github.com/foundryvtt/foundryvtt/issues/5065)
- [Version 11 LevelDB Packs | Foundry Virtual Tabletop](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Version 12 Feature Preview | Foundry Virtual Tabletop](https://foundryvtt.com/article/v12-preview/)
- [Release 12.318 | Foundry Virtual Tabletop](https://foundryvtt.com/releases/12.318)
- [The Forge - Multiple Levels of Challenge (LevelDB migration)](https://blog.forge-vtt.com/multiple-levels-of-challenge/)
- [Self-Hosting LiveKit on Linux | Community Wiki](https://foundryvtt.wiki/en/setup/hosting/Self-Hosting-LiveKit-Audio-Video-Server-on-Existing-Linux-Setup)
- [Recommended number of users - The Forge forums](https://forums.forge-vtt.com/t/recommended-number-of-users/11530)
- [CONFIG.queries v14 API](https://foundryvtt.com/api/variables/CONFIG.queries.html)
- [Using Permissions in Foundry | Community Wiki](https://foundryvtt.wiki/en/development/guides/permissions)
- [S3 File Storage Integration | Foundry Virtual Tabletop](https://foundryvtt.com/article/aws-s3/)
- [GitHub - bekriebel/fvtt-module-avclient-livekit](https://github.com/bekriebel/fvtt-module-avclient-livekit)
- [Installing LiveKit on Self Hosted Foundry - Wiki](https://github.com/bekriebel/fvtt-module-avclient-livekit/wiki/Installing-LiveKit-on-an-Existing-Self-Hosted-Foundry-Server)
- [Foundry VTT Self Hosting Guide - Pinggy](https://pinggy.io/blog/foundry_vtt/)
- [Simplifying Foundry VTT Hosting with Secure Tunnels - DEV Community](https://dev.to/lightningdev123/simplifying-foundry-vtt-hosting-with-secure-tunnels-5h4c)
