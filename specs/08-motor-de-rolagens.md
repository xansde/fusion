# 08 — Motor de Rolagens

- **Título:** Motor de Rolagens
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/05-foundry-dice-chat.md` (sintaxe completa de fórmulas, hierarquia de termos, roll modes, inline rolls, dados 3D, arquitetura de chat cards)
  - `docs/research/15-vtt-opensource-e-bibliotecas.md` (bibliotecas @dice-roller/rpg-dice-roller v5.5.1, @3d-dice/dice-box, comparativo de parsers)

---

## Objetivo

Especificar o motor de rolagens do Fusion: a sintaxe de fórmulas suportada, a arquitetura de parsing/execução, o protocolo de autoridade do servidor (RNG anti-cheat), o resultado estruturado para renderização rica no chat, os modos de visibilidade (roll modes), a API para sistemas de jogo registrarem fórmulas derivadas e interceptarem rolagens, a integração de dados 3D animados e os mecanismos de auditoria/fairness. Esta spec define **como uma rolagem nasce, executa e é exibida**. Ela NÃO define o protocolo de transporte das mensagens de chat (ver `04-rede-e-sincronizacao.md`) nem a renderização do chat log (ver `09-chat-e-mensagens.md`).

---

## Escopo

### O que inclui

- Sintaxe de fórmulas: notação base `NdX`, modificadores, funções, pools, roll data `@attr`, inline rolls `[[...]]` e deferred rolls `[[/r ...]]`.
- Parsing em `packages/shared` — AST fortemente tipada, portável para servidor e cliente.
- Execução autoritativa **no servidor** — RNG nunca exposto ao cliente.
- Estrutura do resultado (`RollResult`) serializado em JSON para persistência em `ChatMessage.rolls`.
- Roll modes: public, gmroll, blindroll, selfroll — controle de visibilidade.
- Rerolls com histórico vinculado à mensagem original.
- API de sistemas: registro de fórmulas derivadas, interceptores (`RollHook`), `DegreeOfSuccess`.
- Integração de dados 3D `@3d-dice/dice-box` — client-side, sincronizada com resultado do servidor, toggle por usuário.
- Fairness: seed rastreável, log de rolagens por mundo, consulta do histórico pelo GM.

### O que NÃO inclui

- Protocolo socket.io de envio/recebimento de mensagens de rolagem — ver `04-rede-e-sincronizacao.md`.
- Renderização do chat log e cards HTML — ver `09-chat-e-mensagens.md`.
- Regras específicas de cada sistema (fórmulas de dano do PF2e, etc.) — ver `15-api-de-sistemas.md`, `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`.
- Dados físicos externos (GoDice, Pixel Dice, Bluetooth) — [V2].
- Serviço externo de entropia (dddice, random.org) — [V2].

---

## Conceitos e terminologia

- **Fórmula:** string de entrada que descreve a rolagem, ex.: `"1d20 + @abilities.str.mod"`.
- **Roll Data:** objeto de contexto passado junto com a fórmula para resolver referências `@caminho`. Tipicamente derivado do `Actor` ativo.
- **AST (Abstract Syntax Tree):** árvore de `RollNode` produzida pelo parser a partir da fórmula. Definida em `packages/shared`, portável para ambos os lados.
- **RollTerm:** nó da AST já instanciado e pronto para avaliação. Tipos: `DiceTerm`, `NumericTerm`, `OperatorTerm`, `ParentheticalTerm`, `PoolTerm`, `FunctionTerm`.
- **RollResult:** resultado serializado de uma rolagem avaliada — inclui total, breakdown por termo, dados individuais e metadados para render rico.
- **Roll Mode:** visibilidade da rolagem no chat: `public`, `gmroll`, `blindroll`, `selfroll`.
- **Inline Roll:** `[[fórmula]]` — avaliado imediatamente ao processar o texto; resultado embutido como número clicável.
- **Deferred Roll:** `[[/r fórmula]]` — botão clicável no HTML; nova rolagem executada ao clicar.
- **RollHook:** callback registrado por um sistema que pode modificar a fórmula ou o resultado antes/depois da avaliação (ex.: MAP do PF2e, bônus de circunstância).
- **DegreeOfSuccess:** identificador de resultado qualitativo calculado por um sistema a partir do total da rolagem contra uma DC. Contrato **genérico** na `packages/system-api` (cada sistema define seu conjunto de graus). A `systems/engine-2e` fornece o conjunto de 4 graus (`criticalSuccess`/`success`/`failure`/`criticalFailure`, regra ±10 e nat 1/20) usado por PF2e/SF2e; o Etmos usa um conjunto binário (`success`/`failure`) com margens.
- **RNG autoritativo:** o gerador de números aleatórios executa exclusivamente no servidor; clientes nunca recebem seeds nem podem influenciar o resultado.
- **Seed de auditoria:** valor numérico associado a cada rolagem no log do servidor, permitindo rastreabilidade do resultado.

---

## Decisões

### D1 — Parsing em `packages/shared`; execução exclusiva no servidor

**Decisão:** o parser de fórmulas reside em `packages/shared` e produz uma AST serializable em JSON. A **avaliação** (geração de números aleatórios) ocorre apenas em `packages/server`.

**Racional:** colocar o parser em `shared` permite que o cliente valide e formate a fórmula antes de enviá-la (feedback de erro imediato, preview de `[[...]]` inline), sem expor o RNG. O servidor revalida a AST recebida e a executa; o cliente jamais executa dados aleatórios localmente para fins de resultado canônico. Isso elimina a superfície de cheat onde um cliente modificaria o resultado.

**Alternativas rejeitadas:**
- **Execução no cliente:** rejeitada por ser inauditável e trivialmente exploitável.
- **Execução no servidor com fórmula string bruta:** possível, mas exigiria parsear duas vezes (uma no cliente para validação, uma no servidor para execução). A AST serializada é mais eficiente e previne injeção de fórmulas malformadas que passariam pela validação de string mas falhariam no parse.

### D2 — Usar `@dice-roller/rpg-dice-roller` como núcleo de parsing, com camada própria sobre ele

**Decisão:** usar `@dice-roller/rpg-dice-roller` v5.5.1 (MIT) como biblioteca de parsing e avaliação de notações-base (`NdX`, modificadores, pools, funções). Construir sobre ela uma camada própria (`FusionRoller`) que: (a) adiciona suporte a `@attr` via substituição pré-parse, (b) adiciona inline rolls `[[...]]` e deferred rolls `[[/r ...]]`, (c) expõe a AST como `FusionRollAST` tipada e (d) integra o sistema de `RollHook`.

**Racional:** `@dice-roller/rpg-dice-roller` cobre robustamente as notações-base do hobby (`NdX`, `kh`, `dl`, `x`, `r`, `cs`, `cf`, `min`, `max`, pools, `dF`, funções `floor`/`ceil`/`round`/`abs`) e exporta AST, eliminando a necessidade de escrever um parser do zero. A camada `FusionRoller` isola o projeto da API da biblioteca e adiciona as extensões necessárias sem forkar o upstream.

**Alternativas rejeitadas:**
- **Parser próprio com Peggy (gramática PEG):** máximo controle, mas custo de implementação e manutenção alto. Candidato a [V2] se a biblioteca mostrar limitações graves.
- **Nearley.js:** alternativa a Peggy, mesma lógica de rejeição.
- **Substituir completamente pela biblioteca sem camada própria:** a API da biblioteca não suporta `@attr` nem hooks de sistema; acoplamento direto dificultaria extensões.

### D3 — Servidor como árbitro do RNG; seed rastreável por rolagem

**Decisão:** o servidor usa `crypto.getRandomValues` (Node.js 22+, via `globalThis.crypto`) como fonte de entropia para todas as rolagens. Cada rolagem recebe um `seed` de 32 bits derivado de `crypto.randomBytes(4)`, registrado no `RollAuditLog`. O seed **não** é enviado ao cliente em tempo real; o GM pode consultá-lo via API de auditoria após a sessão.

**Racional:** `crypto.getRandomValues` é CSPRNG, aprovado para uso em jogos onde a previsibilidade seria exploitável. Registrar o seed permite que o GM audite rolagens suspeitas sem expor o mecanismo ao jogador. Usar Mersenne Twister (como o Foundry) seria mais rápido mas criptograficamente fraco.

**Alternativas rejeitadas:**
- **`Math.random()`:** não-criptográfico e seedable externamente; rejeitado.
- **Serviço externo de entropia (random.org, dddice):** introduz dependência de rede e latência; reservado para [V2] como opção opt-in.

### D4 — Resultado estruturado `RollResult` com AST completa serializada

**Decisão:** o resultado de uma rolagem não é apenas o número final (`total`). O servidor persiste e transmite um `RollResult` completo, incluindo: fórmula original, fórmula expandida (com `@attr` resolvidos), array de `RollTermResult` (um por termo da AST, com sub-resultados por dado), total e metadados (`rollMode`, `speaker`, `flavor`, `timestamp`). Este objeto é armazenado em `ChatMessage.rolls[]` e é suficiente para que o cliente renderize qualquer nível de detalhe sem precisar reavalar a rolagem.

**Racional:** um resultado rico permite: (a) tooltip com breakdown individual de cada dado, (b) destaques visuais de crítico/fumble, (c) rerolls rastreáveis (cada reroll é um novo `RollResult` vinculado ao anterior via `rerollOf`), (d) sistemas calcularem `DegreeOfSuccess` a partir do total sem reexecutar a fórmula.

### D5 — Roll modes mapeados em campos de visibilidade do `ChatMessage`

**Decisão:** os quatro modos de rolagem são implementados como restrições no campo `whisper[]` e flag `blind` do `ChatMessage` (ver `09-chat-e-mensagens.md`), seguindo a mesma lógica do Foundry. O `RollResult` em si não tem informação de visibilidade — ela está no envelope da mensagem.

| Modo | `whisper` | `blind` |
|------|-----------|---------|
| `public` | `[]` | `false` |
| `gmroll` | `[gm_ids...]` | `false` |
| `blindroll` | `[gm_ids...]` | `true` |
| `selfroll` | `[author_id]` | `false` |

### D6 — Dados 3D via `@3d-dice/dice-box`, client-side, sincronizados

**Decisão:** a integração de dados 3D usa `@3d-dice/dice-box` (MIT, BabylonJS + AmmoJS, Web Workers + OffscreenCanvas). O fluxo é: servidor executa o roll → envia `RollResult` ao cliente → cliente exibe animação 3D sincronizada com os valores do resultado (não rola novamente). Toggle por usuário nas preferências. Desativado por padrão no MVP; ativável via configuração.

**Racional:** `@3d-dice/dice-box` roda em Web Worker + OffscreenCanvas — não bloqueia o thread principal do canvas PIXI.js. É integrável com `@dice-roller/rpg-dice-roller` via `@3d-dice/dice-parser-interface`. O cliente nunca usa o resultado da animação como canônico — apenas como visualização.

**Alternativas rejeitadas:**
- **Three.js + cannon-es (estilo Dice So Nice):** mais código a manter; `@3d-dice/dice-box` já encapsula esse stack.
- **Babylon.js direto:** `@3d-dice/dice-box` já usa Babylon internamente; duplicar a dependência seria ineficiente.

### D7 — `DegreeOfSuccess` como contrato genérico da `packages/system-api`, não do core

**Decisão:** o cálculo de graus de sucesso não faz parte do motor de rolagens core. O tipo `DegreeOfSuccess` na `packages/system-api` é **genérico**: um identificador de grau (string) cujo **conjunto de valores é definido por cada sistema de jogo**, não um enum fixo. É responsabilidade do sistema registrar uma função `computeDegreeOfSuccess(total: number, dc: number, context: RollContext): DegreeOfSuccess` e incluí-la na configuração do sistema. O `RollResult` pode carregar um campo opcional `degreeOfSuccess` preenchido pelo sistema após a avaliação, via `RollHook` de pós-processamento. A `systems/engine-2e` fornece um **helper** que produz o conjunto de 4 graus (`criticalSuccess`/`success`/`failure`/`criticalFailure`) com a regra ±10 e ajuste nat 1/20, reutilizado por PF2e e SF2e.

**Racional:** a lógica de graus de sucesso é radicalmente diferente entre sistemas (PF2e/SF2e têm a regra ±10 para crítico — providos pelo helper da engine-2e; o Etmos usa sucesso binário com margens conforme SRD, definindo seu próprio conjunto). Fixar um enum de 4 graus na API genérica excluiria sistemas com conjuntos diferentes; centralizar a lógica no core criaria um motor opinionado.

---

## Requisitos funcionais

### Sintaxe de fórmulas — notações suportadas

**REQ-ROL-001** [MVP] O motor DEVE suportar a notação básica `NdX` onde `N` é a quantidade (inteiro ≥ 0) e `X` é o número de faces (inteiro ≥ 1), ex.: `1d20`, `4d6`, `1d100`.

**REQ-ROL-002** [MVP] O motor DEVE suportar operadores aritméticos `+`, `-`, `*`, `/` entre termos, respeitando precedência padrão e parênteses, ex.: `1d20 + 5`, `(1d8 + 4) * 2`.

**REQ-ROL-003** [MVP] O motor DEVE suportar dados dinâmicos via parênteses: `1d(1d20)` (faces determinadas por outro dado), `(2d4)d8` (quantidade determinada por outro dado).

**REQ-ROL-004** [MVP] O motor DEVE suportar os modificadores de keep/drop: `kh[N]` (keep highest), `kl[N]` (keep lowest), `dh[N]` (drop highest), `dl[N]` (drop lowest), com alias `k` para `kh` e `d` para `dl`. Exemplo: `4d6k3`, `4d6dl1`.

**REQ-ROL-005** [MVP] O motor DEVE suportar reroll: `r[comp][N]` (rerola uma vez se condição satisfeita) e `rr[comp][N]` (rerola recursivamente). Comparadores: `=`, `>`, `>=`, `<`, `<=`; sem comparador assume `=1`. Exemplo: `1d20r1`, `4d6rr<3`.

**REQ-ROL-006** [MVP] O motor DEVE suportar exploding: `x[comp][N]` (explode ilimitado) e `xo[comp][N]` (explode uma vez). Sem comparador, explode no valor máximo. Exemplo: `3d6x`, `6d10xo10`.

**REQ-ROL-007** [MVP] O motor DEVE suportar mínimo/máximo de resultado por dado: `min[N]` e `max[N]`. Exemplo: `4d10min2`, `4d10max8`.

**REQ-ROL-008** [MVP] O motor DEVE suportar contagem de sucessos e margem: `cs[comp][N]` (conta sucessos), `cf[comp][N]` (conta falhas), `even` (pares), `odd` (ímpares), `df[comp][N]` (deduz falhas), `sf[comp][N]` (subtrai valor de falha), `ms[comp][N]` (Margin of Success — retorna `soma − threshold` para `>` e `>=`, ou `threshold − soma` para `<` e `<=`). Exemplo: `10d20cs>10`, `3d6ms10`.

**REQ-ROL-009** [MVP] O motor DEVE suportar dados especiais: dado Fate/Fudge `NdF` (+1/0/-1) e moeda `Ndc` (cara/coroa).

**REQ-ROL-010** [MVP] O motor DEVE suportar Dice Pools com `{expr1, expr2, ...}[mod]` onde `mod` pode ser `kh`, `kl`, `dh`, `dl`, `cs`, `cf`. Exemplo: `{4d6, 3d8}kh`.

**REQ-ROL-011** [MVP] O motor DEVE suportar funções matemáticas em fórmulas: `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)`. Exemplo: `floor((2d6+4)/2)`.

**REQ-ROL-012** [MVP] O motor DEVE suportar rótulos de dados (flavor) via `[label]` após a expressão de dado: `2d6[slashing]+1d8[fire]`. O label aparece no breakdown do resultado.

**REQ-ROL-013** [MVP] O motor DEVE suportar nota de roll via `# texto` no final da fórmula: `1d20 + 5 # Ataque corpo a corpo`. O texto é armazenado em `RollResult.flavor`.

### Roll Data — referências a atributos

**REQ-ROL-014** [MVP] O motor DEVE suportar a sintaxe `@caminho.de.atributo` em fórmulas, onde `caminho` é um caminho de propriedade com ponto sobre o objeto `rollData` fornecido. Exemplo: `1d20 + @abilities.str.mod`, `@dmgDice + @proficiencyBonus`.

**REQ-ROL-015** [MVP] A substituição de `@attr` DEVE ocorrer no servidor antes do parsing, usando a função `FusionRoller.replaceFormulaData(formula: string, data: RollData): string`. Referências não resolvidas DEVEM substituir por `0` e gerar warning no `RollResult.warnings[]`.

**REQ-ROL-016** [MVP] O `RollData` passado para uma rolagem de `Actor` DEVE ser derivado do snapshot atual do documento `Actor` no banco no momento da rolagem — nunca dos dados enviados pelo cliente (anti-cheat: o cliente não pode inflar atributos).

### Inline Rolls e Deferred Rolls

**REQ-ROL-017** [MVP] O motor DEVE reconhecer a sintaxe `[[fórmula]]` em campos de texto (chat, journal, descrições de item). Ao processar o texto, o servidor avalia a fórmula e substitui `[[fórmula]]` por um span HTML clicável com o total e tooltip de breakdown.

**REQ-ROL-018** [MVP] O motor DEVE reconhecer a sintaxe `[[/r fórmula]]` e suas variantes de modo (`[[/gmroll fórmula]]`, `[[/blindroll fórmula]]`, `[[/selfroll fórmula]]`) como deferred rolls, gerando um botão HTML que, ao ser clicado, envia uma nova requisição de rolagem ao servidor com a fórmula e modo especificados.

**REQ-ROL-019** [MVP] Inline rolls `[[...]]` dentro de descrições de itens de compendium DEVEM ser renderizados como botões deferred no contexto de um chat card, pois o contexto do ator é desconhecido em tempo de edição.

### Comandos de chat para rolagem

**REQ-ROL-020** [MVP] O servidor DEVE reconhecer os seguintes prefixos no conteúdo de uma mensagem de chat para disparar rolagens:

| Prefixo(s) | Roll Mode |
|---|---|
| `/roll`, `/r`, `/publicroll`, `/pr` | `public` |
| `/gmroll`, `/gmr` | `gmroll` |
| `/blindroll`, `/broll`, `/br` | `blindroll` |
| `/selfroll`, `/sr` | `selfroll` |

### Parsing e AST

**REQ-ROL-021** [MVP] O parser `FusionParser` (em `packages/shared`) DEVE receber uma string de fórmula pré-processada (sem `@attr`) e retornar uma `FusionRollAST` — árvore de `RollNode` serializable em JSON, ou lançar `RollParseError` com posição do token inválido.

**REQ-ROL-022** [MVP] A `FusionRollAST` DEVE ser serializable (JSON.stringify/parse) sem perda de informação, para tráfego no envelope de rede (ver `04-rede-e-sincronizacao.md`).

**REQ-ROL-023** [MVP] O cliente DEVE poder chamar `FusionParser.parse(formula)` para validação e preview antes de enviar ao servidor — sem acesso ao RNG. Um parse bem-sucedido NÃO implica avaliação.

### Execução no servidor

**REQ-ROL-024** [MVP] O servidor DEVE expor o endpoint socket.io `roll:request` que recebe `{ formula: string, rollData?: RollData, mode: RollMode, flavor?: string, speaker: SpeakerRef }` e retorna (via ack) um `RollResult` ou `RollError`.

**REQ-ROL-025** [MVP] Toda avaliação de dados no servidor DEVE usar `crypto.getRandomValues` como fonte de entropia. O uso de `Math.random()` é proibido no caminho de execução de rolagens.

**REQ-ROL-026** [MVP] O servidor DEVE registrar cada rolagem no `RollAuditLog` com: `rollId`, `worldId`, `userId`, `actorId?`, `formula`, `expandedFormula`, `result` (total), `seed`, `timestamp`. O `seed` NÃO é incluído no `RollResult` enviado ao cliente.

**REQ-ROL-027** [MVP] Após avaliação, o servidor DEVE criar um documento `ChatMessage` com `rolls: [RollResult.toJSON()]` e fazer broadcast de acordo com o `mode` da rolagem (ver Decisão D5 e `09-chat-e-mensagens.md`).

### Estrutura do RollResult

**REQ-ROL-028** [MVP] O `RollResult` DEVE conter os campos mínimos: `rollId`, `formula`, `expandedFormula`, `total`, `terms` (array de `RollTermResult`), `flavor`, `rollMode`, `timestamp`, `warnings[]`, e campo opcional `degreeOfSuccess`.

**REQ-ROL-029** [MVP] Cada `RollTermResult` para um `DiceTerm` DEVE incluir: `type`, `number`, `faces`, `modifiers`, e `results[]` — array de `DiceResult` com campos `result`, `active`, `discarded`, `rerolled`, `exploded`, `success`, `failure`.

**REQ-ROL-030** [MVP] O `RollResult` serializado DEVE ser suficiente para reconstruir o breakdown completo no cliente sem nova comunicação com o servidor.

### Roll Modes — visibilidade

**REQ-ROL-031** [MVP] O servidor DEVE aplicar o roll mode ao `ChatMessage` gerado conforme a tabela na Decisão D5. Um cliente que não está na lista `whisper` (e não é GM no modo `blindroll`) DEVE receber a mensagem com `rolls: []` e `content` omitido ou substituído por placeholder de rolagem privada.

**REQ-ROL-032** [MVP] No modo `blindroll`, o jogador originador DEVE ver no chat uma indicação de que realizou uma rolagem cega (ex.: "Você realizou uma rolagem cega"), sem ver o resultado. Apenas GMs recebem o `RollResult` completo.

**REQ-ROL-033** [MVP] No modo `gmroll`, tanto o jogador originador quanto todos os GMs DEVEM receber o `RollResult` completo. Outros jogadores veem apenas que o usuário realizou uma rolagem privada.

### Rerolls

**REQ-ROL-034** [MVP] O servidor DEVE suportar uma operação `roll:reroll` que aceita `{ originalRollId: string, keepOriginal?: boolean }` e cria um novo `RollResult` com campo `rerollOf: originalRollId`. O `ChatMessage` original DEVE ser atualizado para linkar ao reroll.

**REQ-ROL-035** [V2] O sistema DEVE poder especificar políticas de reroll via `RollHook` (ex.: PF2e Hero Point — reroll keeping second result; Etmos — rerolar dado mais baixo).

### API de sistemas

**REQ-ROL-036** [MVP] A `packages/system-api` DEVE expor a interface `RollHook` com dois pontos de interceptação:
- `preRoll(context: RollContext): RollContext | Promise<RollContext>` — modifica fórmula, rollData ou mode antes da avaliação.
- `postRoll(result: RollResult, context: RollContext): RollResult | Promise<RollResult>` — modifica ou anota o resultado após avaliação (ex.: calcular `degreeOfSuccess`, adicionar penalidades de MAP).

**REQ-ROL-037** [MVP] Sistemas DEVEM poder registrar `RollHook`s com prioridade numérica. Hooks de maior prioridade executam primeiro. Hooks de sistemas distintos não devem conflitar (cada sistema registra apenas seus próprios hooks).

**REQ-ROL-038** [MVP] A `packages/system-api` DEVE expor a função `computeDegreeOfSuccess(total: number, dc: number, context: RollContext): DegreeOfSuccess` como interface contratual que cada sistema implementa e registra.

**REQ-ROL-039** [MVP] O tipo `DegreeOfSuccess` em `packages/system-api` DEVE ser **genérico** (um identificador de grau, ex.: `string`): cada sistema define o **conjunto** de graus que usa, não há enum fixo na API. A `systems/engine-2e` DEVE fornecer o helper que produz o conjunto de 4 graus (`criticalSuccess`/`success`/`failure`/`criticalFailure`) com a regra ±10 e ajuste nat 1/20, reutilizado por PF2e e SF2e. Sistemas com outros conjuntos (ex.: Etmos, sucesso binário `success`/`failure` com margens) definem o seu próprio.

**REQ-ROL-040** [MVP] Sistemas DEVEM poder registrar fórmulas derivadas nomeadas via `RollRegistry.register(systemId, name, formulaTemplate)` para reutilização em itens e fichas, ex.: `pf2e.strikeWeaponDamage = "@weapon.damage.dice + @weapon.damage.modifier"`.

**REQ-ROL-041** [V2] A system API DEVE suportar `RollTable` como fonte de resultado para fórmulas especiais (ex.: tabelas de crítico do Etmos). Ver `12-journal-tabelas-cartas.md`.

### Dados 3D

**REQ-ROL-042** [MVP] O cliente DEVE incluir a biblioteca `@3d-dice/dice-box` como opcional. A integração só é inicializada se o usuário tiver a preferência `dice3d.enabled: true`.

**REQ-ROL-043** [MVP] Ao receber um `RollResult` do servidor (via `ChatMessage` broadcast), o cliente DEVE verificar se dados 3D estão habilitados. Se sim, DEVE chamar `DiceBox.roll(notation, { results: rollResult.terms })` para exibir animação sincronizada com os valores reais do resultado, sem re-avaliar dados.

**REQ-ROL-044** [MVP] A animação 3D DEVE usar o callback `DiceBox.onRollComplete` para sinalizar ao chat renderer que pode exibir o `ChatMessage`. O chat DEVE aguardar o fim da animação antes de mostrar o resultado no log, quando dados 3D estiverem habilitados.

**REQ-ROL-045** [MVP] Usuários DEVEM poder ativar/desativar dados 3D individualmente em `Settings > Preferências > Dados 3D`. A preferência é armazenada em `UserSettings.dice3d` no banco do servidor.

**REQ-ROL-046** [V2] O cliente DEVE suportar temas de dados 3D customizados via `DiceBox.theme`. Sistemas poderão registrar temas default (ex.: tema sci-fi para SF2e).

### Fairness e auditoria

**REQ-ROL-047** [MVP] O servidor DEVE manter um `RollAuditLog` persistente (tabela SQLite `roll_audit_log` no `world.db`) com os campos: `roll_id`, `world_id`, `user_id`, `actor_id`, `formula`, `expanded_formula`, `total`, `seed`, `created_at`.

**REQ-ROL-048** [V2] GMs DEVEM poder consultar o `RollAuditLog` via endpoint REST `GET /api/world/:worldId/roll-audit?userId=&from=&to=&limit=` com filtros por usuário e intervalo de tempo.

**REQ-ROL-049** [MVP] O `seed` de cada rolagem DEVE ser visível apenas na resposta da API de auditoria (para GMs). O campo `seed` NUNCA deve aparecer em `RollResult` enviado via socket.io.

**REQ-ROL-050** [V2] O sistema DEVE suportar modo "rolagem verificável" onde o GM pode compartilhar publicamente o `seed` de uma rolagem para que jogadores confiram o resultado usando a função de avaliação determinística do servidor.

---

## Requisitos não-funcionais

**REQ-ROL-051** [MVP] O tempo de processamento de uma rolagem no servidor (parse + evaluate + persist + broadcast) DEVE ser inferior a **50 ms** para fórmulas comuns (até 20 dados) em hardware de GM doméstico (CPU single-core ~2 GHz).

**REQ-ROL-052** [MVP] O parser DEVE rejeitar fórmulas que produziriam mais de **10.000 resultados individuais de dado** por avaliação (proteção contra DoS via `100000d20`). O limite DEVE ser configurável em `config.roll.maxDicePerRoll`.

**REQ-ROL-053** [MVP] O parser DEVE ter timeout de **100 ms** para prevenir loops infinitos em fórmulas com recursão via parênteses dinâmicos aninhados.

**REQ-ROL-054** [V2] O `RollAuditLog` DEVE ser purgável: o GM pode apagar entradas com mais de N dias via operação administrativa. Por padrão, logs são mantidos por 90 dias.

**REQ-ROL-055** [MVP] A integração de dados 3D DEVE ser lazy-loaded — o bundle do `@3d-dice/dice-box` (< 1 MB) DEVE ser carregado somente quando `dice3d.enabled: true`, para não penalizar o tempo de carregamento inicial do cliente.

---

## Modelo de dados

```typescript
// packages/shared/src/rolls/types.ts

/** Resultado de um dado individual */
export interface DiceResult {
  result: number;
  active: boolean;       // contribui para o total
  discarded?: boolean;
  rerolled?: boolean;
  exploded?: boolean;
  success?: boolean;     // cs modifier
  failure?: boolean;     // cf modifier
}

/** Resultado de um termo da AST após avaliação */
export interface RollTermResult {
  type: 'dice' | 'numeric' | 'operator' | 'parenthetical' | 'pool' | 'function';
  expression: string;    // representação string do termo
  total: number;
  flavor?: string;       // label [...]
  // presentes apenas para type === 'dice'
  number?: number;
  faces?: number;
  modifiers?: string[];
  results?: DiceResult[];
  // presentes apenas para type === 'pool'
  rolls?: RollTermResult[][];
}

/** Resultado completo de uma rolagem avaliada */
export interface RollResult {
  rollId: string;
  formula: string;          // fórmula original com @attr
  expandedFormula: string;  // fórmula após substituição de @attr
  total: number;
  terms: RollTermResult[];
  flavor?: string;          // texto após #
  rollMode: RollMode;
  timestamp: number;
  warnings: string[];       // @attr não resolvidos, etc.
  rerollOf?: string;        // rollId do roll original se este for um reroll
  degreeOfSuccess?: DegreeOfSuccess; // preenchido por RollHook do sistema
}

/** Modos de visibilidade de rolagem — definido uma única vez em packages/shared e importado onde necessário */
export type RollMode = 'public' | 'gmroll' | 'blindroll' | 'selfroll';

/** Contexto passado para RollHooks */
export interface RollContext {
  formula: string;
  rollData: Record<string, unknown>;
  mode: RollMode;
  flavor?: string;
  speaker: SpeakerRef;
  actorId?: string;
  itemId?: string;
  systemData?: Record<string, unknown>; // dados arbitrários do sistema
}

/** Referência ao falante da rolagem */
export interface SpeakerRef {
  sceneId?: string;
  actorId?: string;
  tokenId?: string;
  alias: string;
}

// packages/system-api/src/rolls.ts

// Contrato genérico: o conjunto de graus é definido por cada sistema, não fixo na API.
// A systems/engine-2e exporta o conjunto de 4 graus PF2e/SF2e como helper (ver 17/18);
// o Etmos define um conjunto binário próprio (ver 19).
export type DegreeOfSuccess = string;

export interface RollHook {
  priority: number;
  preRoll?: (context: RollContext) => RollContext | Promise<RollContext>;
  postRoll?: (result: RollResult, context: RollContext) => RollResult | Promise<RollResult>;
}

export interface RollRegistry {
  register(systemId: string, name: string, formulaTemplate: string): void;
  resolve(systemId: string, name: string): string | undefined;
  registerHook(systemId: string, hook: RollHook): void;
  computeDegreeOfSuccess?: (total: number, dc: number, context: RollContext) => DegreeOfSuccess;
}

// packages/server/src/rolls/audit.ts (não exportado para shared)
export interface RollAuditEntry {
  roll_id: string;
  world_id: string;
  user_id: string;
  actor_id: string | null;
  formula: string;
  expanded_formula: string;
  total: number;
  seed: number;      // NUNCA enviado ao cliente via socket
  created_at: number;
}
```

---

## API e eventos

### Eventos socket.io (namespace `/world/:worldId`)

| Evento | Direção | Payload | Descrição |
|--------|---------|---------|-----------|
| `roll:request` | Cliente → Servidor | `{ formula, rollData?, mode, flavor?, speaker }` | Solicita avaliação de uma rolagem |
| `roll:result` | Servidor → Cliente(s) | `RollResult` (sem `seed`) | Broadcast via `ChatMessage`; visibilidade por roll mode |
| `roll:error` | Servidor → Cliente | `{ code, message, formula }` | Fórmula inválida ou limite excedido |
| `roll:reroll` | Cliente → Servidor | `{ originalRollId, keepOriginal? }` | Solicita reroll de uma rolagem existente |

### Endpoints REST (auditoria — apenas GMs)

| Método | Path | Descrição |
|--------|------|-----------|
| `GET` | `/api/world/:id/roll-audit` | Lista entradas do audit log; filtros: `userId`, `from`, `to`, `limit` (max 500) |
| `DELETE` | `/api/world/:id/roll-audit` | Purga entradas com `created_at < cutoffDate`; body: `{ days: number }` |

### FusionRoller — API pública (packages/shared)

```typescript
// Parsing — executável em ambos os lados
FusionParser.parse(formula: string): FusionRollAST
FusionParser.validate(formula: string): { valid: boolean; error?: string }
FusionRoller.replaceFormulaData(formula: string, data: Record<string, unknown>): string

// Execução — apenas no servidor (packages/server)
FusionRoller.evaluate(ast: FusionRollAST, context: RollContext): Promise<RollResult>
```

---

## Dependências

- `02-modelo-de-dados.md` — estrutura de `ChatMessage` e campo `rolls[]`
- `03-persistencia-e-mundos.md` — tabela `roll_audit_log` no `world.db`
- `04-rede-e-sincronizacao.md` — envelope de transporte para `roll:request` / `roll:result`
- `05-usuarios-e-permissoes.md` — verificação de permissão antes de executar rolagem; acesso à API de auditoria restrito a GMs
- `09-chat-e-mensagens.md` — criação do `ChatMessage` com resultado, roll modes, chat cards com botões
- `11-ui-framework-e-fichas.md` — fichas usam `RollRegistry` para fórmulas derivadas e disparam `roll:request`
- `15-api-de-sistemas.md` — interface completa de `RollHook`, `RollRegistry` e `DegreeOfSuccess` como contratos da system API
- `17-sistema-pf2e.md` — uso de `preRoll` para MAP, `postRoll` para degree of success PF2e
- `18-sistema-sf2e.md` — derivações de SF2e sobre o mesmo contrato
- `19-sistema-etmos.md` — notações específicas do Etmos (2d6+Atributo, rolagem de oposição)

---

## Critérios de aceitação

1. A fórmula `4d6k3 + @abilities.str.mod # Teste de força` é enviada via `roll:request` com `rollData = { abilities: { str: { mod: 3 } } }`. O servidor retorna um `RollResult` com `expandedFormula = "4d6k3 + 3"`, `total` correto (soma dos 3 maiores + 3), `terms[0].results` com exatamente 4 entradas (uma marcada `discarded: true`), `flavor = "Teste de força"`. O `seed` está no `RollAuditLog` e ausente no `RollResult`.

2. Uma rolagem no modo `blindroll` resulta em: GM recebe `RollResult` completo; jogador originador recebe mensagem de chat sem `rolls[]` e com placeholder; outros jogadores recebem mensagem vaga sem resultado.

3. O parser rejeita `100001d6` com `RollParseError` indicando que o limite de dados foi excedido.

4. Um `RollHook` do sistema PF2e registrado em `postRoll` com `priority: 10` recebe o `RollResult` de um ataque, compara `total` com `dc` passado em `systemData`, e retorna o resultado com `degreeOfSuccess` preenchido. O campo aparece no `RollResult` persistido no `ChatMessage`.

5. Com dados 3D habilitados, ao receber o broadcast de um `RollResult` de `3d6`, o cliente exibe a animação 3D dos dados com os valores `[2, 5, 1]` (reais do servidor) e só então renderiza o `ChatMessage` no log.

6. O GM acessa `GET /api/world/:id/roll-audit?userId=X&limit=20` e recebe as 20 rolagens mais recentes do usuário X, incluindo `seed` de cada uma, sem que esse campo apareça no chat log.

7. A fórmula `[[/r 1d20 + @str.mod]]` em uma descrição de item de compendium renderiza como botão HTML. Ao clicar, o cliente envia `roll:request` com a fórmula e o `rollData` do token atualmente controlado.

---

## Questões em aberto

1. **Seed de auditoria vs. reprodutibilidade:** o CSPRNG com `seed` de 32 bits é rastreável mas não determinístico a partir do seed (sem implementar o RNG manualmente). Para "rolagem verificável" ([V2]), precisaremos de um RNG seedable — provavelmente xoshiro256** ou Mulberry32 com seed gerado por `crypto.randomBytes`. Definir antes de implementar [V2].

2. **RollData snapshots:** quando o Roll Data é capturado do `Actor` no banco, o snapshot é do momento do request. Se o GM editar um atributo do ator durante a resolução de um hook async, o snapshot pode estar desatualizado. Precisamos definir a semântica exata: o snapshot é tirado no início do `preRoll` e imutável durante toda a pipeline?

3. **Rolagens de oposição (Etmos):** o sistema Etmos pode exigir rolagens simultâneas de dois atores e comparação imediata de resultados. O protocolo atual não suporta "roll batch correlacionado". Ver `19-sistema-etmos.md` — pode exigir um evento `roll:opposed` dedicado.

4. **Rerolls com visibilidade diferente do original:** se uma rolagem `blindroll` for rerrolada como `public` (ex.: o GM resolve uma situação de forma aberta), qual mensagem original aparece no log dos jogadores? Definir a política de reroll cross-mode.

5. **Suporte da biblioteca a modificadores avançados:** verificar se `@dice-roller/rpg-dice-roller` suporta nativamente `4d6!!` (compound exploding — soma de explosões em um único resultado por dado) e `ms[comp][N]` (Margin of Success). Confirmar no teste de integração inicial; se não suportados, implementar na camada `FusionRoller`.

6. **Limite de pools:** pools com muitas expressões (`{100d6, 100d8, ...}`) podem ser lentos. Definir limite de expressões por pool (sugestão: 20) e documentar.

7. **Dados 3D em mobile/tablet:** `@3d-dice/dice-box` usa OffscreenCanvas — verificar suporte em Safari/iOS antes de ativar como padrão. Ver `23-acessibilidade-e-dispositivos.md`.

---

## Referências

- `docs/research/05-foundry-dice-chat.md` — sintaxe completa, roll modes, inline rolls, dados 3D, Dice So Nice
- `docs/research/15-vtt-opensource-e-bibliotecas.md` — @dice-roller/rpg-dice-roller, @3d-dice/dice-box, comparativo de parsers
- [@dice-roller/rpg-dice-roller (GitHub)](https://github.com/dice-roller/rpg-dice-roller)
- [@3d-dice/dice-box (GitHub)](https://github.com/3d-dice/dice-box)
- [Dice Modifiers | Foundry VTT KB](https://foundryvtt.com/article/dice-modifiers/)
- [Basic Dice | Foundry VTT KB](https://foundryvtt.com/article/dice/)
- [Advanced Dice | Foundry VTT KB](https://foundryvtt.com/article/dice-advanced/)
- [DICE_ROLL_MODES | Foundry VTT API](https://foundryvtt.com/api/variables/CONST.DICE_ROLL_MODES.html)
- [Deferred inline rolls issue #5758](https://github.com/foundryvtt/foundryvtt/issues/5758)
