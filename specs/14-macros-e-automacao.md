# 14 — Macros e Automação

**Status:** draft v0.1
**Data:** 2026-06-11
**Baseada em:**

- `docs/research/09-foundry-funcionalidades-mesa.md` — seções 6 (Macros), 7 (Game Time), 8 (Scene Regions)
- `docs/research/91-fusion-security-threat-model.md` — seção 6 (Sandbox de Macros), seção 4 (XSS/Enrichers)

---

## Objetivo

Especificar o sistema de macros, hotbar do usuário, ações rápidas data-driven, controle de tempo de jogo/calendário, regiões de cena com behaviors, e automações de rotina (aplicar dano/cura em massa, toggle de condições). O objetivo é oferecer poder de automação crescente — do simples (chat macros, ações rápidas) ao avançado (script macros do GM) — sem nunca comprometer a segurança do servidor ou da máquina do GM.

---

## Escopo

### Inclui

- Macro de chat (texto + inline rolls) com execução via hotbar e chat command — **[MVP]**
- Hotbar por usuário: 10 slots × 5 páginas, drag-and-drop de macros/itens/ações — **[MVP]**
- Ações rápidas data-driven registradas pela System API (ex.: roll Strike, aplicar dano, toggle condição) — **[MVP]**
- Game time básico: relógio de jogo, avanço manual pelo GM, eventos de tempo para sistemas — **[MVP parcial]**
- Calendário simples por mundo (configuração de nome do calendário, períodos de tempo) — **[V2]**
- Script macros do GM em sandbox isolada — **[V2]**
- Scene Regions com behaviors (teleport, macro trigger, status) — modelo conceitual — **[V2]**
- Automação de rotina via UI: aplicar dano/cura em massa no tracker, toggle de condições — **[MVP]**

### Não inclui

- Carregamento de módulos de terceiros em runtime (é [V2] global — ver `01-arquitetura-geral.md`)
- Motor de regras de automação visual (node graph, behaviour tree) — sem previsão de data
- Execução de macros de script por jogadores — restrito ao GM em todas as versões
- Calendário astronômico com cálculos de lua/sol para todos os sistemas — detalhes de sistema ficam em `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`
- Integração com ferramentas externas (Discord bots, OBS, etc.) — sem previsão

---

## Conceitos e Terminologia

**Macro** — documento persistido no mundo que encapsula uma ação reutilizável. Dois tipos: `chat` e `script`.

**Chat Macro** — produz uma mensagem de chat com suporte a texto livre, markdown leve sanitizado (mesma allowlist de `09-chat-e-mensagens.md` REQ-CHT-030) e inline rolls (ex.: `[[1d20+5]]`). Executável por qualquer usuário com permissão de leitura. Para UI rica em macros, usar o `CardData` declarativo de `09-chat-e-mensagens.md` D-CHT-03 — não HTML arbitrário.

**Script Macro** — executa código TypeScript/JavaScript em sandbox isolada. Disponível apenas para o GM. Recebe contexto serializado (actor, token, targets, scene) e retorna comandos estruturados para o servidor executar.

**Hotbar** — barra de ação persistida por usuário, com 10 slots visíveis e 5 páginas (50 slots totais). Cada slot referencia uma macro, uma ação rápida, ou um item utilizável.

**QuickAction** — ação rápida data-driven registrada pela System API. Declarativa: descreve o que fazer (ex.: `roll:strike`, `apply:damage`, `toggle:condition`) sem código JS arbitrário. É o mecanismo recomendado para automações de sistemas.

**WorldTime** — contador interno de segundos desde a época do mundo, persistido no documento `World`. É a âncora de tempo usada por sistemas para calcular duração de efeitos.

**Calendar** — camada de apresentação sobre `WorldTime`. Mapeia segundos para dias/meses/anos em um calendário configurado pelo GM.

**SceneRegion** — área geométrica em uma cena (polígono, retângulo, elipse) com lista de behaviors ativados por eventos de token.

**RegionBehavior** — handler associado a uma `SceneRegion` que executa uma ação quando um evento ocorre (ex.: token entra, turno começa).

**ExecuteAsGM** — mecanismo de delegação de privilégio: o servidor executa uma ação com autoridade de GM a pedido de um cliente com menor privilégio, após validação de schema e permissão server-side.

---

## Decisões

### DEC-MAC-01: Script macros restritas ao GM e executadas em sandbox no servidor

**Decisão:** Script macros não executam no browser do usuário. Elas são enviadas ao servidor, executadas em `isolated-vm` (V8 Isolates reais) com whitelist de APIs, timeout de 10 s e log obrigatório.

**Alternativas rejeitadas:**

- _Execução no browser (Web Worker):_ isola o DOM mas permite `fetch()` livre; um GM desonesto poderia exfiltrar dados de jogadores; além disso a execução no cliente viola o princípio de servidor autoritativo.
- _`node:vm`:_ trivialmente escapável, documentação da própria Node.js recomenda não usar para código não confiável.
- _`vm2`:_ histórico de 20+ escapes conhecidos, foi abandonado pelo mantenedor em 2023 e ressuscitado com reputação comprometida; descartado conforme `91-fusion-security-threat-model.md` seção 6.2.
- _QuickJS WASM:_ isolamento forte mas suporte parcial a ES moderno e overhead de inicialização por execução; pode ser considerado como alternativa futura se `isolated-vm` causar problemas de build.

**Racional:** O servidor Fusion roda na máquina do GM; RCE no servidor é RCE no computador pessoal. O impacto é máximo. A decisão de restringir script macros ao GM e sandboxá-las server-side minimiza a superfície de ataque sem privar o GM de poder de automação.

---

### DEC-MAC-02: Ações rápidas (QuickActions) como primeiro mecanismo de automação para jogadores

**Decisão:** A System API expõe um registry de QuickActions tipadas. Jogadores podem adicionar essas ações à hotbar e executá-las. Elas são declarativas (não contêm código JS) e são validadas pelo servidor com Zod antes de executar.

**Alternativas rejeitadas:**

- _Macros de script para todos:_ inaceitável por segurança (ver DEC-MAC-01).
- _Sem automação para jogadores:_ regride a experiência para nível de VTT primitivo; jogadores não conseguem criar botões de "rolar Atletismo" sem o GM.

**Racional:** QuickActions cobrem 90% dos casos de uso de automação de jogadores (rolar perícias, aplicar dano, toggle de condições) sem abrir execução de código arbitrário. Sistemas registram as ações disponíveis; o motor as executa de forma controlada.

---

### DEC-MAC-03: WorldTime como contador simples de segundos; calendário é camada de apresentação separada

**Decisão:** `world.time` é um único `bigint` de segundos desde a época do mundo. O calendário (nomes de meses, semanas, dias intercalares) é configuração de display sem afetar o contador base.

**Alternativas rejeitadas:**

- _Armazenar diretamente "Dia 3 de Arodus, 4723 AR":_ acoplaria o motor ao sistema Golarion/PF2e; impossível para Etmos e SF2e sem forks.
- _Não implementar game time no MVP:_ duração de efeitos (ex.: "febre por 1 dia") é funcionalidade esperada mesmo em sessões básicas; sistemas precisam do contador para implementar timers.

**Racional:** O padrão do Foundry (`game.time.worldTime` em segundos) provou ser correto — sistemas e módulos da comunidade o adotaram universalmente. Replicar a mesma semântica facilita portabilidade de lógica de sistemas.

---

### DEC-MAC-04: Scene Regions como modelo conceitual [V2]; teleport e behaviors via events

**Decisão:** No MVP, regiões de cena não têm behaviors automáticos. A estrutura de dados `SceneRegion` é especificada e persistida mas behaviors (teleport, macro trigger, darkness adjust) são implementação [V2]. O modelo de events/behaviors é preferido a tiles com lógica hardcoded.

**Alternativas rejeitadas:**

- _Tiles com propriedades de teleport hardcoded:_ menos extensível; o design do Foundry v12+ evoluiu exatamente para sair desse modelo.
- _Adiar completamente a especificação:_ a estrutura de dados precisa ser definida agora para não criar migrações custosas.

---

### DEC-MAC-05: ExecuteAsGM como protocolo de delegação com validação obrigatória server-side

**Decisão:** O servidor expõe um conjunto fixo de operações registradas que podem ser solicitadas por clientes com menor privilégio (análogo ao socketlib). Cada operação tem schema Zod, revalidação de permissão do requester, e rate limit. Nunca há uma operação genérica "executar qualquer função como GM".

**Alternativas rejeitadas:**

- _Proxy genérico de mensagens:_ o vetor de privilege escalation documentado no `91-fusion-security-threat-model.md` seção 6.4 tornaria isso inaceitável.

---

### DEC-MAC-06: Hotbar com 5 páginas de 10 slots (50 total), atalhos de teclado 1–0

**Decisão:** Replicar ergonomia do Foundry (10 slots visíveis, teclas 1–9 e 0, 5 páginas) como MVP. Persistido por usuário no servidor.

**Alternativas rejeitadas:**

- _Hotbar configurável em número de slots:_ complexidade de UI desnecessária para MVP; pode ser adicionado em V2.

---

## Requisitos Funcionais

### Macros de Chat

**REQ-MAC-001** [MVP] O sistema deve suportar macros do tipo `chat` que, ao serem executadas, postam uma mensagem no chat do mundo ativo. O conteúdo da mensagem deve aceitar texto livre, markdown leve sanitizado (mesma allowlist de `09-chat-e-mensagens.md` REQ-CHT-030 — bold, italic, código inline, links http/https, listas) e inline roll expressions no formato `[[fórmula]]`. HTML arbitrário é proibido; macros que precisarem de UI rica devem usar o `CardData` declarativo (ver `09-chat-e-mensagens.md` D-CHT-03).

**REQ-MAC-002** [MVP] Ao executar uma macro de chat, inline rolls presentes no conteúdo devem ser avaliados pelo motor de rolagens do servidor (ver `08-motor-de-rolagens.md`) e o resultado deve ser incorporado à mensagem antes do envio ao chat.

**REQ-MAC-003** [MVP] Macros devem ser documentos persistidos no banco do mundo, com os campos: `id`, `name`, `type` (`"chat"` | `"script"`), `content` (string), `img` (path de ícone), `ownerId`, `permissions` (mapa de userId → nível de permissão).

**REQ-MAC-004** [MVP] Qualquer usuário autenticado com permissão `Observer` ou superior em uma macro de chat deve poder executá-la.

**REQ-MAC-005** [MVP] Macros devem ser executáveis via: (a) clique no slot da hotbar; (b) atalho de teclado do slot (teclas 1–0 para slots 1–10 da página ativa); (c) comando de chat `/macro <NomeDaMacro>`; (d) botão "Executar" na janela de edição da macro.

**REQ-MAC-006** [MVP] A janela de edição de macro deve exibir: campo de nome, campo de conteúdo (textarea), seletor de tipo (chat/script), seletor de ícone, e botão "Executar".

### Macros de Script

**REQ-MAC-007** [V2] O sistema deve suportar macros do tipo `script` executáveis apenas por usuários com papel `GM`.

**REQ-MAC-008** [V2] A execução de uma macro de script deve ocorrer no servidor, dentro de um isolate `isolated-vm` com as seguintes restrições:

- Sem acesso a `fs`, `net`, `child_process`, `process` ou qualquer módulo Node nativo.
- API disponível: subconjunto da Fusion API (Document CRUD com as permissões do GM, roll, chat.send, ui.notification).
- Timeout de 10 segundos; exceções e timeouts encerram o isolate e reportam erro no chat do GM.
- Profundidade máxima de call stack: 200.

**REQ-MAC-009** [V2] Antes de iniciar o isolate, o servidor deve logar: usuário solicitante, timestamp, `id` da macro e os primeiros 500 caracteres do conteúdo da macro.

**REQ-MAC-010** [V2] O contexto injetado no isolate deve ser um snapshot serializado (não referências vivas) contendo: `actor` (dados do token selecionado), `token` (posição e estado do token), `targets` (array de tokens alvo selecionados), `scene` (id e nome da cena ativa), `user` (id e papel do usuário executante).

**REQ-MAC-011** [V2] Macros de script não devem ser executáveis por usuários não-GM, mesmo que a macro tenha permissão de leitura para o usuário. A validação deve ocorrer no servidor antes de qualquer execução.

### Hotbar

**REQ-MAC-012** [MVP] Cada usuário deve ter uma hotbar pessoal com 5 páginas de 10 slots cada (50 slots totais). A hotbar deve ser persistida no servidor associada ao `UserId`.

**REQ-MAC-013** [MVP] Slots da hotbar devem aceitar três tipos de conteúdo: (a) referência a `Macro` (por `macroId`); (b) referência a uma `QuickAction` registrada pela system API; (c) referência a um `Item` utilizável do actor do usuário.

**REQ-MAC-014** [MVP] O usuário deve poder arrastar documentos do tipo Macro, Item, ou QuickAction da UI para um slot da hotbar. Arrastar para um slot ocupado deve substituir o conteúdo após confirmação.

**REQ-MAC-015** [MVP] As teclas 1–9 e 0 do teclado devem executar os slots 1–10 da página ativa da hotbar, respectivamente. Este atalho só deve estar ativo quando nenhum campo de texto estiver em foco.

**REQ-MAC-016** [MVP] O usuário deve poder navegar entre páginas da hotbar clicando em indicadores de página na UI (5 indicadores). A página ativa deve ser preservada entre recarregamentos de sessão.

**REQ-MAC-017** [MVP] Clicar com o botão direito em um slot da hotbar deve abrir um menu contextual com as opções: "Editar macro", "Remover do slot", "Executar".

**REQ-MAC-018** [MVP] O GM deve poder visualizar e editar a hotbar de qualquer usuário fazendo login com aquele usuário ou via painel de administração (ver `05-usuarios-e-permissoes.md`).

### Ações Rápidas (QuickActions)

**REQ-MAC-019** [MVP] A System API deve expor um método `registerQuickAction(definition: QuickActionDef)` que permite a sistemas registrarem ações reutilizáveis no registry global de QuickActions.

**REQ-MAC-020** [MVP] Uma `QuickActionDef` deve conter: `id` (string único), `systemId` (id do sistema), `name` (string i18n), `icon` (path), `description` (string i18n), `schema` (ZodSchema para validação dos parâmetros), `handler` (função server-side tipada que recebe contexto + parâmetros validados).

**REQ-MAC-021** [MVP] Quando um slot da hotbar contendo uma QuickAction é executado, o cliente deve enviar ao servidor: `{ actionId, params, actorId?, tokenId?, targetIds? }`. O servidor deve: (a) localizar o handler registrado; (b) validar `params` com o schema Zod da ação; (c) verificar que o usuário tem permissão para operar sobre os documentos referenciados; (d) executar o handler; (e) fazer broadcast do resultado via socket.io (ver `04-rede-e-sincronizacao.md`).

**REQ-MAC-022** [MVP] O sistema PF2e (ver `17-sistema-pf2e.md`) deve registrar as seguintes QuickActions de exemplo como referência: `pf2e:roll-check` (rolar perícia/ataque), `pf2e:apply-damage` (aplicar dano ao actor alvo), `pf2e:apply-healing` (aplicar cura), `pf2e:toggle-condition` (ativar/desativar condição PF2e), `pf2e:roll-initiative` (rolar iniciativa para o actor).

**REQ-MAC-023** [MVP] Caso o handler de uma QuickAction falhe na validação Zod, o servidor deve retornar um erro estruturado ao cliente solicitante sem fazer broadcast. O erro deve exibir uma notificação de falha na UI do usuário.

**REQ-MAC-024** [MVP] QuickActions devem ser listáveis e pesquisáveis via Macro Directory para que o usuário as encontre e arraste para a hotbar.

### Macro Directory

**REQ-MAC-025** [MVP] O Macro Directory deve listar todas as macros do mundo com as quais o usuário tem pelo menos permissão `Observer`, organizadas em pastas criadas pelo GM.

**REQ-MAC-026** [MVP] O GM deve poder criar, renomear e remover pastas no Macro Directory.

**REQ-MAC-027** [MVP] Macros devem suportar exportação para JSON e importação de JSON pelo GM.

**REQ-MAC-028** [MVP] Uma macro pode ser arrastada do Macro Directory diretamente para a hotbar ou para o canvas de chat.

### Game Time

**REQ-MAC-029** [MVP] O servidor deve manter um campo `worldTime: bigint` (segundos desde a época) no documento `World`. Valor inicial: 0. Persiste entre sessões.

**REQ-MAC-030** [MVP] O GM deve poder avançar ou recuar o `worldTime` manualmente via controles na UI (campo numérico + botões de incremento por segundo, minuto, hora, dia). A alteração deve ser difundida a todos os clientes conectados via socket event `world:time-update`.

**REQ-MAC-031** [MVP] Sistemas devem poder registrar listeners de tempo via `SystemAPI.onTimeChange(callback: (newTime: bigint, delta: bigint) => void)`. O callback é invocado no servidor a cada alteração de `worldTime`. Uso típico: expirar efeitos com duração baseada em tempo.

**REQ-MAC-032** [MVP] O cliente deve exibir o `worldTime` como relógio de jogo em uma área configurável da UI (painel de controle do GM ou HUD). O formato de exibição padrão deve ser `DD:HH:MM:SS` calculado a partir do `worldTime` em segundos.

**REQ-MAC-033** [V2] O mundo deve suportar configuração de calendário: nome do calendário, duração do dia em segundos, lista de meses (com nome e número de dias), lista de dias da semana. Essa configuração é usada pela camada de display para converter `worldTime` em data legível no calendário do mundo.

**REQ-MAC-034** [V2] O calendário deve exibir a data atual do mundo no formato configurado, atualizado em tempo real ao alterar `worldTime`. O GM deve poder avançar dias inteiros usando o calendário visual.

**REQ-MAC-035** [V2] Presets de calendário devem incluir: genérico (gregoriano), Golarion (padrão PF2e), Drift Calendar (SF2e) e Calendário do Mundo de Etmos (a ser especificado em `19-sistema-etmos.md`). Presets são apenas valores iniciais de configuração, totalmente editáveis pelo GM.

### Automação de Rotina (UI)

**REQ-MAC-036** [MVP] O Combat Tracker (ver `10-combate-e-iniciativa.md`) deve expor ações de automação em massa: "Aplicar dano a selecionados", "Aplicar cura a selecionados", "Marcar derrotados". Essas ações usam QuickActions internamente.

**REQ-MAC-037** [MVP] O painel de condições de um token deve permitir toggle de condições via clique direto. A alteração deve ser executada server-side como QuickAction e replicada a todos os clientes.

**REQ-MAC-038** [MVP] O GM deve poder arrastar uma rolagem de dano do chat para um token no canvas para aplicar o dano automaticamente. O servidor calcula a aplicação usando a lógica do sistema ativo (ver `15-api-de-sistemas.md`) e persiste a alteração de HP.

**REQ-MAC-039** [MVP] Toda automação de rotina deve gerar uma mensagem de log no chat (opcional, configurável pelo GM): "10 de dano cortante aplicado a Goblin Guerreiro".

### Scene Regions (Modelo de Dados)

**REQ-MAC-040** [V2] Uma `SceneRegion` deve ser um documento embedded na `Scene`, com os campos: `id`, `name`, `shapes` (array de `RegionShape`), `behaviors` (array de `RegionBehavior`), `elevation` (`{ min: number, max: number }`), `visibility` (`"gm"` | `"all"`).

**REQ-MAC-041** [V2] `RegionShape` deve suportar três tipos: `rectangle` (`{ x, y, width, height }`), `ellipse` (`{ x, y, radiusX, radiusY }`), `polygon` (`{ points: [x,y][] }`). Cada shape pode ter `hole: boolean` para subtração de área.

**REQ-MAC-042** [V2] Os tipos de `RegionBehavior` a implementar são: `teleport-token` (destino: `{ regionId, sceneId }`), `execute-macro` (referência a `macroId`), `toggle-darkness` (nível de escuridão local), `modify-movement-cost` (multiplicador 0–5), `pause-game`, `display-text` (texto animado).

**REQ-MAC-043** [V2] Cada `RegionBehavior` deve definir a lista de eventos que o ativam. Os eventos suportados são: `token-enter`, `token-exit`, `token-move-within`, `token-start-turn`, `token-end-turn`, `round-start`, `round-end`.

**REQ-MAC-044** [V2] Quando um token se move e o servidor detecta que ele cruzou o limite de uma `SceneRegion`, o servidor deve disparar os behaviors correspondentes aos eventos `token-enter` / `token-exit` para todos os behaviors habilitados da região.

**REQ-MAC-045** [V2] A ferramenta de Scene Regions deve permitir ao GM criar, editar e deletar regiões diretamente no canvas usando as ferramentas de forma (retângulo, elipse, polígono). A UI deve exibir regiões como overlays coloridos semi-transparentes sobre o mapa.

### ExecuteAsGM

**REQ-MAC-046** [MVP] O servidor deve expor um mecanismo de delegação de privilégio `executeAsGM` para um conjunto fixo de operações registradas. O mecanismo deve validar: (a) identidade e autenticação do requester; (b) schema Zod do payload; (c) permissões do requester sobre os documentos afetados.

**REQ-MAC-047** [MVP] O rate limit para chamadas `executeAsGM` deve ser de no máximo 30 chamadas por usuário por minuto. Exceder o limite retorna erro `429` sem executar a ação.

**REQ-MAC-048** [MVP] Não deve existir operação `executeAsGM` genérica que aceite código arbitrário. Cada operação registrada deve ter um `handlerId` específico e schema Zod explícito.

---

## Requisitos Não-Funcionais

**REQ-MAC-NF-001** A execução de uma macro de chat (incluindo rolagem de dados) deve completar em menos de 200 ms do clique do usuário até a mensagem aparecer no chat.

**REQ-MAC-NF-002** O spawn de um `isolated-vm` isolate para script macro deve completar em menos de 500 ms. Timeout máximo de execução: 10 s. Após timeout, o processo principal não deve ser afetado.

**REQ-MAC-NF-003** O estado da hotbar (página ativa, conteúdo dos slots) deve ser carregado junto com a sessão do usuário em menos de 100 ms adicionais ao carregamento do mundo.

**REQ-MAC-NF-004** Alterações em `worldTime` devem ser difundidas a todos os clientes em menos de 50 ms (via socket.io broadcast direto, sem round-trip de banco necessário para o broadcast).

**REQ-MAC-NF-005** O processamento de behaviors de `SceneRegion` disparados por movimento de token deve completar antes do próximo frame de movimento ser processado (< 16 ms para operações síncronas simples; operações assíncronas em fila separada sem bloquear o movimento).

**REQ-MAC-NF-006** Toda execução de macro de script deve ser registrada no log estruturado do servidor com nível `info`, incluindo: `userId`, `macroId`, `macroName`, timestamp, primeiros 500 chars do `content`, resultado (`success` | `error`), duração em ms.

**REQ-MAC-NF-007** O sistema de macros não deve introduzir dependências que comprometam a portabilidade do build (Linux/macOS/Windows). Em particular, `isolated-vm` usa bindings nativos — o processo de build deve documentar os requisitos de compilação e prover binários pré-compilados para as três plataformas-alvo.

---

## Modelo de Dados

```typescript
// ── Macro ──────────────────────────────────────────────────────────────────

type MacroType = "chat" | "script";

interface MacroDocument {
  id: string; // UUID v4
  name: string; // max 256 chars
  type: MacroType;
  content: string; // conteúdo da macro; max 65536 chars
  img: string; // path do ícone (relativo a assets/)
  ownerId: string; // userId do criador
  permissions: Record<string, PermissionLevel>; // userId → nivel
  folder?: string; // id da pasta no Macro Directory
  sort: number; // ordenação dentro da pasta
  flags: Record<string, unknown>; // extensível por sistemas
}

// ── Hotbar ─────────────────────────────────────────────────────────────────

type HotbarSlotContent =
  | { type: "macro"; macroId: string }
  | { type: "quick-action"; actionId: string; params?: Record<string, unknown> }
  | { type: "item"; actorId: string; itemId: string }
  | null;

interface HotbarState {
  userId: string;
  activePage: number; // 0–4
  slots: HotbarSlotContent[]; // 50 elementos (índices 0–49); [page*10 + slot]
}

// ── QuickAction ────────────────────────────────────────────────────────────

import type { ZodSchema } from "zod";

interface QuickActionDef<TParams = unknown> {
  id: string; // ex.: "pf2e:roll-check"
  systemId: string; // ex.: "pf2e"
  name: string; // chave i18n
  icon: string; // path do ícone
  description: string; // chave i18n
  schema: ZodSchema<TParams>;
  /**
   * Handler executado no servidor.
   * Retorna uma lista de DocumentOperation que o servidor aplica autoritativamente.
   */
  handler: (ctx: QuickActionContext, params: TParams) => Promise<DocumentOperation[]>;
}

interface QuickActionContext {
  userId: string;
  actorId?: string;
  tokenId?: string;
  targetIds?: string[];
  sceneId?: string;
  worldTime: bigint;
}

type DocumentOperation =
  | { op: "update"; collection: string; id: string; data: Record<string, unknown> }
  | { op: "create"; collection: string; data: Record<string, unknown> }
  | { op: "delete"; collection: string; id: string }
  | { op: "chat-message"; data: ChatMessageData };

// ── WorldTime e Calendar ───────────────────────────────────────────────────

interface WorldTimeConfig {
  value: bigint; // segundos desde época; persiste em world.db
  dayLengthSeconds: number; // padrão: 86400
}

interface CalendarConfig {
  // [V2]
  id: string;
  name: string;
  dayLengthSeconds: number;
  months: CalendarMonth[];
  weekdays: string[];
  yearOffset: number; // ano do tick 0 no calendário
}

interface CalendarMonth {
  name: string;
  days: number;
  intercalary?: boolean;
}

// ── SceneRegion ────────────────────────────────────────────────────────────

type RegionShapeType = "rectangle" | "ellipse" | "polygon";

interface RegionShape {
  type: RegionShapeType;
  // rectangle
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // ellipse
  radiusX?: number;
  radiusY?: number;
  // polygon
  points?: [number, number][];
  hole: boolean;
}

type RegionEventType =
  | "token-enter"
  | "token-exit"
  | "token-move-within"
  | "token-start-turn"
  | "token-end-turn"
  | "round-start"
  | "round-end";

type RegionBehaviorType =
  | "teleport-token"
  | "execute-macro"
  | "toggle-darkness"
  | "modify-movement-cost"
  | "pause-game"
  | "display-text";

interface RegionBehavior {
  id: string;
  type: RegionBehaviorType;
  events: RegionEventType[];
  enabled: boolean;
  config: Record<string, unknown>; // específico por tipo (validado por Zod)
}

interface SceneRegion {
  id: string;
  name: string;
  shapes: RegionShape[];
  behaviors: RegionBehavior[];
  elevation: { min: number; max: number };
  visibility: "gm" | "all";
  flags: Record<string, unknown>;
}
```

---

## API e Eventos

### Endpoints REST

| Método   | Path                                   | Descrição                                             |
| -------- | -------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/macros`                          | Lista macros acessíveis ao usuário autenticado        |
| `POST`   | `/api/macros`                          | Cria macro (GM ou usuário com permissão)              |
| `PATCH`  | `/api/macros/:id`                      | Edita macro (Owner ou GM)                             |
| `DELETE` | `/api/macros/:id`                      | Remove macro (Owner ou GM)                            |
| `POST`   | `/api/macros/:id/execute`              | Executa macro (verifica tipo e permissão server-side) |
| `GET`    | `/api/hotbar`                          | Retorna hotbar do usuário autenticado                 |
| `PUT`    | `/api/hotbar`                          | Persiste estado completo da hotbar                    |
| `POST`   | `/api/quick-actions/:actionId/execute` | Executa QuickAction com payload                       |
| `GET`    | `/api/world/time`                      | Retorna `worldTime` atual                             |
| `PATCH`  | `/api/world/time`                      | Altera `worldTime` (apenas GM)                        |
| `GET`    | `/api/world/calendar`                  | Retorna configuração de calendário (V2)               |
| `PUT`    | `/api/world/calendar`                  | Atualiza calendário (apenas GM) (V2)                  |

### Eventos Socket.io

| Evento                      | Direção            | Payload                                                | Descrição                                                        |
| --------------------------- | ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `macro:execute`             | cliente → servidor | `{ macroId, context? }`                                | Solicita execução de macro                                       |
| `macro:result`              | servidor → cliente | `{ macroId, output, error? }`                          | Resultado da execução (para o executor)                          |
| `quick-action:execute`      | cliente → servidor | `{ actionId, params, actorId?, tokenId?, targetIds? }` | Executa QuickAction                                              |
| `world:time-update`         | servidor → todos   | `{ worldTime: string, delta: string }`                 | Broadcast de alteração de tempo (bigint serializado como string) |
| `execute-as-gm:request`     | cliente → servidor | `{ handlerId, payload, requesterId }`                  | Solicita delegação de privilégio                                 |
| `execute-as-gm:result`      | servidor → cliente | `{ handlerId, result?, error? }`                       | Resultado da operação delegada                                   |
| `region:behavior-triggered` | servidor → todos   | `{ regionId, behaviorId, event, tokenId }`             | Behavior de região disparado (V2)                                |

### System API — Registro de QuickActions e Listeners de Tempo

```typescript
// Em packages/system-api/src/index.ts

interface SystemAPI {
  /** Registra uma QuickAction no registry global */
  registerQuickAction<TParams>(def: QuickActionDef<TParams>): void;

  /** Remove QuickAction do registry (útil em testes) */
  unregisterQuickAction(actionId: string): void;

  /** Registra listener de mudança de worldTime */
  onTimeChange(callback: (newTime: bigint, delta: bigint) => void): () => void;

  /** Registra operação delegável via executeAsGM */
  registerExecuteAsGM<TPayload>(
    handlerId: string,
    schema: ZodSchema<TPayload>,
    handler: (payload: TPayload, requesterId: string) => Promise<unknown>,
  ): void;
}
```

---

## Dependências

- **`08-motor-de-rolagens.md`** — inline rolls em chat macros são avaliados pelo motor de rolagens; as rolagens executam no servidor.
- **`09-chat-e-mensagens.md`** — resultado de macros de chat é postado como `ChatMessage`; o sistema de enrichers do chat processa `[[rolls]]` e `@UUID`.
- **`04-rede-e-sincronizacao.md`** — todos os eventos de socket desta spec usam o protocolo e as garantias de entrega definidos nessa spec; `executeAsGM` usa o canal autenticado de WS.
- **`05-usuarios-e-permissoes.md`** — permissões de macros, validação de papel GM para script macros, sistema de permissions por documento.
- **`10-combate-e-iniciativa.md`** — automações de rotina (dano em massa, toggle condição) interagem com o Combat Tracker; eventos `token-start-turn` / `token-end-turn` das SceneRegions são originados pelo ciclo de combate.
- **`15-api-de-sistemas.md`** — QuickActions são registradas pela System API; o campo `handler` de uma QuickAction recebe DocumentOperations que usam a infraestrutura de documentos do sistema.
- **`21-seguranca.md`** — sandbox de script macros, sanitização de conteúdo de chat macros (DOMPurify + sanitize-html), validação de payloads Zod, rate limiting de executeAsGM.
- **`02-modelo-de-dados.md`** — `MacroDocument` é um Document de primeira classe com as semânticas de permissão padrão.
- **`03-persistencia-e-mundos.md`** — macros, hotbars e WorldTime persistem no `world.db` (SQLite) do mundo ativo.

---

## Critérios de Aceitação

**CA-MAC-01** [MVP] Um jogador pode criar uma macro de chat com o conteúdo `"Ataco com minha espada! [[1d20+5]] para acertar, [[1d8+3]] de dano."`, adicioná-la à hotbar, pressionar o atalho de teclado correspondente e ver a mensagem com os resultados das rolagens aparecer no chat de todos os usuários conectados em menos de 200 ms.

**CA-MAC-02** [MVP] Uma QuickAction `pf2e:apply-damage` executada com `{ amount: 15, actorId: "xxx", targetIds: ["yyy"] }` por um jogador sem permissão Owner sobre `yyy` deve ser rejeitada pelo servidor com erro de permissão sem alterar nenhum dado.

**CA-MAC-03** [MVP] Ao arrastar uma QuickAction de "Rolar Atletismo" para o slot 3 da hotbar, fechar o navegador e reabrir a sessão, o slot 3 deve continuar com a QuickAction corretamente carregada.

**CA-MAC-04** [MVP] O GM avança o `worldTime` em 8 horas (28800 segundos). O relógio de jogo na UI atualiza para todos os clientes em menos de 50 ms. O sistema PF2e recebe o callback `onTimeChange` e expira os efeitos com duração ≤ 8 horas.

**CA-MAC-05** [MVP] Arrastar uma rolagem de dano de `[[2d6+4]] = 14` do chat para um token com 30 HP no canvas aplica 14 de dano, deixando o token com 16 HP. Uma mensagem de log aparece no chat: "14 de dano aplicado a Goblin Guerreiro (30 → 16 HP)".

**CA-MAC-06** [V2] Uma macro de script do GM que chama `actor.update({ "system.attributes.hp.value": 0 })` dentro do isolate atualiza corretamente o HP do actor no banco. Tentar acessar `process.env` dentro do isolate lança `ReferenceError: process is not defined` e a execução é abortada sem crashar o servidor.

**CA-MAC-07** [V2] Uma `SceneRegion` com behavior `teleport-token` configurada para o evento `token-enter` teleporta o token para a região de destino quando um token entra na área. O GM recebe log "Behavior 'teleport-token' disparado por token X na região Y".

**CA-MAC-08** [MVP] Um jogador não-GM que tenta executar uma macro do tipo `script` recebe um erro HTTP 403 do servidor. Nenhuma execução ocorre.

**CA-MAC-09** [MVP] Chamar `executeAsGM` com payload malformado (`amount: "cem"` em vez de número) retorna erro `400 ZodError` sem executar o handler, sem alterar dados, e sem logar como execução bem-sucedida.

**CA-MAC-10** [MVP] Pressionar a tecla `3` quando o chat está em foco não dispara o slot 3 da hotbar. Pressionar a tecla `3` quando nenhum campo de texto está em foco dispara o slot 3 corretamente.

---

## Questões em Aberto

1. **Isolamento de QuickActions entre sistemas:** se PF2e e SF2e registrarem uma QuickAction com o mesmo `id`, qual tem precedência? Precisamos de namespace obrigatório no formato `<systemId>:<actionId>` com validação no registro.

2. **Persistência de hotbar para slots de item:** itens na hotbar são referenciados por `actorId + itemId`. Se o actor for destruído ou o item removido, o slot fica inválido. Qual o comportamento: mostrar slot vazio com ícone de erro, remover silenciosamente, ou manter e reportar o erro ao executar?

3. **Limite de conteúdo de macro de script:** 65 536 chars é suficiente para scripts de GM? Sistemas como PF2e têm macros de comunidade com centenas de linhas. Avaliar se 128 KB é mais adequado sem comprometer a performance do isolate.

4. **CalendarConfig para Etmos:** a especificação do calendário de Etmos precisa ser fornecida pela Editora Balde Galáctico ou pode ser inferida dos docs de pesquisa locais? Nenhum doc de research menciona especificidades de calendário Etmos — registrado como questão para `19-sistema-etmos.md`.

5. **Calendário de Drift (SF2e):** o "Drift Calendar" de SF2e (referência à viagem via Drift) tem dias padrão? Requer pesquisa específica no material de SF2e.

6. **Compatibilidade de API de calendário com Simple Calendar:** dada a adoção massiva do Simple Calendar no ecossistema Foundry (e seu fork Simple Calendar Reborn para v13+), faz sentido implementar a API pública do Simple Calendar no Fusion para facilitar portabilidade de sistemas? Decisão de alcance a ser tomada antes de [V2].

7. **Execução de macro via Scene Region [V2]:** quando um behavior `execute-macro` dispara uma macro de script, o contexto de execução deve ser o GM (pois regiões são configuradas pelo GM) mas o event trigger pode ser um token de jogador. Como auditar essa execução? O log deve registrar tanto o userId do jogador que triggou quanto o fato de que a execução foi via region behavior.

8. **Ephemeral tokens em Scene Regions:** o Foundry v14 introduziu tokens efêmeros (não persistidos) criados por regiões. O Fusion vai suportar isso? Define quando no roadmap.

9. **Múltiplas páginas de hotbar em mobile:** com viewport estreito, navegar entre 5 páginas pode ser difícil. Definir comportamento em `23-acessibilidade-e-dispositivos.md`.

---

## Referências

- `docs/research/09-foundry-funcionalidades-mesa.md` — seções 6, 7, 8 (Macros, Game Time, Scene Regions)
- `docs/research/91-fusion-security-threat-model.md` — seção 6 (Sandbox), seção 4.3 (Enrichers e XSS)
- Foundry VTT — [Macros Knowledge Base](https://foundryvtt.com/article/macros/)
- Foundry VTT — [Scene Regions Knowledge Base](https://foundryvtt.com/article/scene-regions/)
- Foundry VTT — [Time and Calendar (Community Wiki)](https://foundryvtt.wiki/en/development/api/time)
- Simple Calendar — [GitHub (vigoren/foundryvtt-simple-calendar)](https://github.com/vigoren/foundryvtt-simple-calendar)
- isolated-vm — [GitHub (laverdet/isolated-vm)](https://github.com/laverdet/isolated-vm)
- socketlib — [Foundry VTT Packages](https://foundryvtt.com/packages/socketlib)
- OWASP WebSocket Security Cheat Sheet
- Ver também: `08-motor-de-rolagens.md`, `09-chat-e-mensagens.md`, `15-api-de-sistemas.md`, `21-seguranca.md`
