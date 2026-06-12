# Foundry VTT — Motor de Dados, Sintaxe de Rolagem e Chat

> Documento de pesquisa para o projeto Fusion VTT.
> Clean-room: nenhum código proprietário do Foundry foi copiado. Comportamentos e APIs foram
> estudados a partir de documentação pública (Knowledge Base, API docs, artigos oficiais, issues
> públicos no GitHub). Trechos de sistemas open-source (pf2e, dnd5e — licença Apache 2.0 / OGL)
> são citados com atribuição quando usados como exemplo concreto.

---

## 1. Visão Geral do Motor de Dados

O Foundry VTT mantém um motor de dados autônomo no namespace `foundry.dice` (v12+). Esse módulo
é responsável por:

1. **Parsing** — transformar uma string de fórmula em uma árvore de termos (AST) usando a
   biblioteca **Peggy** (parser-generator, substitui regex manual desde a v12).
2. **Avaliação** — percorrer a árvore, realizando sorteios aleatórios ou substituindo valores
   determinísticos.
3. **Serialização** — converter resultados em JSON para persistência em documentos `ChatMessage`.

O gerador de números aleatórios é um **Mersenne Twister** (MT19937), com semente reiniciada por
sessão de usuário. A partir da v12, o usuário ou desenvolvedor pode substituir o método de
fulfillment por meio de `CONFIG.Dice.fulfillment.methods`, habilitando serviços externos, dados
Bluetooth físicos (GoDice, Pixel Dice) ou input manual.

---

## 2. Hierarquia de Termos (RollTerm)

Todo fragmento de uma fórmula de roll é representado por uma subclasse de `RollTerm`.

### 2.1 Hierarquia Completa (v14)

```
RollTerm (abstrata)
├── DiceTerm (abstrata — não-determinística)
│   ├── Die          — dado de N faces (denominação "d")
│   ├── Coin         — moeda, 2 faces (denominação "c")
│   └── FateDie      — dado Fate/Fudge (+/−/blank, denominação "f")
├── NumericTerm      — número literal, determinístico
├── OperatorTerm     — operador matemático (+, −, *, /)
├── ParentheticalTerm — expressão entre parênteses (recursivamente avaliada)
├── PoolTerm         — pool de múltiplos rolls avaliados em conjunto
├── FunctionTerm     — chamada de função matemática (floor, ceil, etc.)
└── StringTerm       — token de string não-numérico
```

### 2.2 Estrutura de DiceTermResult

Cada face rolada gera um objeto `DiceTermResult` com os seguintes campos:

| Campo       | Tipo    | Descrição                                                    |
|-------------|---------|--------------------------------------------------------------|
| `result`    | number  | Valor numérico rolado                                        |
| `active`    | boolean | Se este resultado contribui para o total                     |
| `count`     | number  | Valor contável (para cs/cf — substitui `result` na soma)     |
| `success`   | boolean | Marcado como sucesso (cs)                                    |
| `failure`   | boolean | Marcado como falha (cf)                                      |
| `discarded` | boolean | Descartado por keep/drop                                     |
| `rerolled`  | boolean | Rerrolado (r/rr)                                             |
| `exploded`  | boolean | Veio de uma explosão (x/xo)                                  |

### 2.3 Die — Classe Principal

A classe `Die` é a mais utilizada. Aceita `number` (quantidade), `faces` (lados), `modifiers`
(array de strings) e `results` (resultados pré-computados). O campo `DENOMINATION = "d"` é
usado pelo parser para mapear o token `d` na gramática.

---

## 3. Sintaxe Completa de Fórmulas de Roll

### 3.1 Formato Básico

```
NdX
```

- `N` — quantidade de dados (inteiro ≥ 0)
- `d` — separador obrigatório
- `X` — faces (inteiro ≥ 1), podendo ser qualquer valor: d4, d6, d8, d10, d12, d20, d100

Exemplos: `1d20`, `4d6`, `1d100`, `3d12`

### 3.2 Operadores Matemáticos

Operadores combinam termos em expressões aritméticas:

| Operador | Semântica         |
|----------|-------------------|
| `+`      | Adição            |
| `-`      | Subtração         |
| `*`      | Multiplicação     |
| `/`      | Divisão           |

Exemplo: `/roll 1d20 / 2 + 10` — divide o resultado do d20 por 2 e adiciona 10.

### 3.3 Parênteses e Parenthetical Terms

Parênteses estabelecem precedência aritmética padrão. Além disso, permitem que o conteúdo seja
um roll dinâmico:

- `/roll (1d8+4) * 2` — soma 4 ao d8, depois multiplica por 2
- `/roll 1d(1d20)` — número de faces do dado determinado por um d20
- `/roll (2d4)d8` — quantidade de d8s determinada por 2d4
- `/roll (1d20*2)d(1d10)` — composição dinâmica dupla

A avaliação é recursiva: o conteúdo interno é avaliado primeiro, e o resultado numérico substitui
o parenthetical antes do outer roll ser construído.

### 3.4 Dados com Rótulo (Flavor)

Adicionar `[label]` após uma expressão de dados marca aquele grupo com um rótulo descritivo,
útil em tooltips e cards de dano:

```
/roll 2d6[slashing]+1d8[fire damage]
```

Rótulos aparecem na exibição detalhada da rolagem.

### 3.5 Rótulo de Roll Completo

Adicionar `# texto` ao final de um comando de roll adiciona uma nota descritiva à mensagem:

```
/r 1d20 + 2 # Ataque com espada
```

### 3.6 Roll Data — Referência a Atributos via `@`

A sintaxe `@caminho.de.dado` permite substituir valores do objeto de dados do ator/token na
fórmula. O motor chama `Roll.replaceFormulaData(formula, data)` antes do parsing:

```
/roll 1d20 + @abilities.str.mod
/roll @dmg.base + @prof
```

O dado é capturado automaticamente do token controlado no momento da rolagem. Sistemas podem
passar objetos de dados customizados via `new Roll(formula, data)`.

---

## 4. Modificadores de Dados (Dice Modifiers)

Modificadores são sufixos acrescentados ao token de dado. O parsing usa `MODIFIER_REGEXP` para
extrair e aplicar modificadores em sequência após o sorteio básico.

### 4.1 Keep / Drop

| Modificador | Alias | Comportamento                                          | Exemplo         |
|-------------|-------|--------------------------------------------------------|-----------------|
| `kh[N]`     | `k`   | Mantém os N maiores (padrão: 1)                        | `4d6k3`         |
| `kl[N]`     |       | Mantém os N menores (padrão: 1)                        | `4d6kl1`        |
| `dl[N]`     | `d`   | Descarta os N menores (padrão: 1)                      | `4d6d1`         |
| `dh[N]`     |       | Descarta os N maiores (padrão: 1)                      | `4d6dh1`        |

Os resultados descartados ficam com `active: false` e `discarded: true` no array `results`.

### 4.2 Reroll

| Modificador    | Comportamento                                                          | Exemplo        |
|----------------|------------------------------------------------------------------------|----------------|
| `r[comp][N]`   | Rerola uma vez se o resultado atender à condição                       | `1d20r1`       |
| `rr[comp][N]`  | Rerola recursivamente enquanto a condição for satisfeita               | `1d20rr<3`     |

Comparadores válidos: `=`, `>`, `>=`, `<`, `<=`. Sem comparador, assume `=` com o valor mínimo
de 1.

Exemplos: `20d20r1` (rerola 1s uma vez), `20d20r<3` (rerola menores que 3 uma vez).

O resultado rerrolado fica marcado com `rerolled: true`.

### 4.3 Exploding (Explode)

| Modificador   | Comportamento                                                             | Exemplo       |
|---------------|---------------------------------------------------------------------------|---------------|
| `x[comp][N]`  | Explode — sorteio adicional ilimitado quando condição é satisfeita        | `3d6x`        |
| `xo[comp][N]` | Explode Once — sorteio adicional uma única vez                            | `6d10xo10`    |
| `x[N]=val`    | Explode com cap numérico (máximo de N explosões por dado)                 | `6d10x5=10`   |
| `xp[comp]`    | Penetrating — explode com -1 aplicado a cada dado adicional (HackMaster)  | `5d6xp`       |

Sem comparador, a explosão ocorre no valor máximo do dado. Os dados adicionais ficam marcados
com `exploded: true`.

### 4.4 Mínimo / Máximo de Resultado

| Modificador | Comportamento                                                       | Exemplo       |
|-------------|---------------------------------------------------------------------|---------------|
| `min[N]`    | Substitui qualquer resultado abaixo de N por N                      | `4d10min2`    |
| `max[N]`    | Substitui qualquer resultado acima de N por N                       | `4d10max8`    |

### 4.5 Contagem de Sucessos e Falhas

| Modificador    | Comportamento                                                         | Exemplo              |
|----------------|-----------------------------------------------------------------------|----------------------|
| `cs[comp][N]`  | Conta dados que atendem à condição como sucessos; total = contagem   | `10d20cs>10`         |
| `cf[comp][N]`  | Conta dados que falham na condição; total = contagem de falhas        | `10d20cf=1`          |
| `even`         | Conta resultados pares como sucessos                                  | `3d6even`            |
| `odd`          | Conta resultados ímpares como sucessos                                | `3d6odd`             |
| `df[comp][N]`  | Deduct Failures — subtrai 1 por falha do total de sucessos            | `5d10cs>=6df=1`      |
| `sf[comp][N]`  | Subtract Failures — subtrai o valor do dado do total por falha        | `3d6sf<3`            |
| `ms[comp][N]`  | Margin of Success — retorna total − threshold (ou threshold − total)  | `3d6ms10`            |

Observações sobre `ms`:
- Com `>` ou `>=`: margem = soma − threshold
- Com `<` ou `<=`: margem = threshold − soma

### 4.6 Dados Especiais

| Sintaxe | Tipo         | Comportamento                                                       |
|---------|--------------|---------------------------------------------------------------------|
| `Ndc`   | Coin (moeda) | Cara (1) ou coroa (0); por padrão conta caras como sucessos         |
| `Ndf`   | Fate Die     | Faces: +1, 0, -1 (dados Fate/Fudge)                                |

Modificadores de coin: `cc[N]` conta cara (1) ou coroa (0) como sucesso conforme especificado.

---

## 5. Dice Pools (PoolTerm)

Pools permitem avaliar múltiplos grupos de dados e combinar/filtrar resultados do conjunto
completo. A sintaxe usa chaves `{}` com expressões separadas por vírgulas:

```
{expressão1, expressão2, ...}[modificador]
```

Exemplos:
- `{4d6, 3d8, 2d10}kh` — mantém o maior resultado entre os três grupos
- `{1d20, 10}kh + 5` — implementa "Reliable Talent" do D&D 5e (maior entre d20 e 10, +5)
- `{6d6, 5d8, 4d10, 3d12}cs>15` — conta quantos grupos ultrapassam 15

Modificadores aplicáveis a pools: `kh`, `kl`, `dh`, `dl`, `cs`, `cf`.

O `PoolTerm` avalia cada expressão interna como um `Roll` independente. O total final é a soma
dos valores dos rolls "ativos" (kept) dentro do pool.

`PoolTerm.fromRolls(rolls)` permite construir um pool a partir de objetos `Roll` já avaliados.

---

## 6. Funções Matemáticas em Fórmulas

As fórmulas suportam funções via `FunctionTerm`. O Foundry expõe o objeto `Math` padrão do
JavaScript em um ambiente seguro (Math Proxy). Funções documentadas para uso em fórmulas:

| Função     | Comportamento                               | Exemplo              |
|------------|---------------------------------------------|----------------------|
| `floor(x)` | Arredonda para baixo                        | `floor(3d6 / 2)`     |
| `ceil(x)`  | Arredonda para cima                         | `ceil(1d8 / 3)`      |
| `round(x)` | Arredonda para o inteiro mais próximo       | `round(2d10 / 4)`    |
| `abs(x)`   | Valor absoluto                              | `abs(5d6 - 20)`      |

O Math Proxy do Foundry acrescenta funções extras (`clamp`, `mix`, `normalizeDegrees`, etc.)
principalmente para uso interno de geometria de canvas, mas as quatro acima são as relevantes
para fórmulas de rolagem de dados.

---

## 7. Rolls Inline e Deferred Rolls

### 7.1 Inline Roll Imediato: `[[fórmula]]`

Quando `[[expressão]]` aparece em qualquer campo de texto (chat, journal, item description,
macro), o Foundry avalia a expressão imediatamente e renderiza o resultado como um span clicável
com tooltip mostrando o breakdown completo:

```
Dano: [[2d6+4]] pontos
```

O resultado é exibido inline como um número formatado.

### 7.2 Deferred Roll (Botão): `[[/r fórmula]]`

A sintaxe `[[/r fórmula]]` (ou com qualquer comando de roll) cria um **botão clicável** em vez
de avaliar imediatamente. Quando qualquer usuário clica, um novo roll é realizado com aquela
fórmula no modo especificado:

```
Clique para rolar: [[/r 1d20 + @str.mod]]
[[/gmroll 1d6]] dano secreto
[[/blindroll 1d20]] rolagem cega
```

O botão herda o rótulo da fórmula ou do flavor text fornecido. Deferred rolls são comuns em
itens de compendium (ex.: pf2e usa extensivamente para strike damage e spell saves).

### 7.3 Sintaxe Alternativa no Chat

No chat, um roll pode ser prefixado diretamente sem os colchetes duplos:
- `/r 1d20` ou `/roll 1d20` — roll público
- `/gmr 1d20` ou `/gmroll 1d20` — roll privado para o GM
- `/br 1d20` ou `/blindroll 1d20` — roll cego (GM vê, jogador não vê)
- `/sr 1d20` ou `/selfroll 1d20` — roll visível apenas para o próprio usuário
- `/pr 1d20` ou `/publicroll 1d20` — forçadamente público

---

## 8. Roll Modes (Modos de Visibilidade)

O Foundry define quatro modos de rolagem em `CONST.DICE_ROLL_MODES`:

| Constante | Valor string   | Comportamento no ChatMessage                          |
|-----------|----------------|-------------------------------------------------------|
| `PUBLIC`  | `"publicroll"` | `whisper: []`, `blind: false` — visível a todos       |
| `PRIVATE` | `"gmroll"`     | `whisper: [gm_ids]`, `blind: false` — jogador + GMs  |
| `BLIND`   | `"blindroll"`  | `whisper: [gm_ids]`, `blind: true` — só GMs veem      |
| `SELF`    | `"selfroll"`   | `whisper: [author_id]`, `blind: false` — só o autor   |

O dropdown no chat configura o modo padrão para **rolls automatizados** (por sistemas, módulos e
macros). Comandos `/roll` digitados manualmente sempre produzem roll público, independente do
dropdown. O método estático `ChatMessage.applyRollMode(data, mode)` transforma um objeto de dados
de ChatMessage aplicando o modo correto.

---

## 9. Classe Roll — API

### 9.1 Construtor

```typescript
new Roll(formula: string, data?: object, options?: RollOptions)
```

- `formula` — expressão textual (ex.: `"2d6 + @str.mod"`)
- `data` — objeto de substituição para variáveis `@` (ex.: `{ str: { mod: 3 } }`)
- `options` — opções extras (maximize, minimize, flavor, etc.)

### 9.2 Propriedades Principais

| Propriedade       | Tipo              | Descrição                                         |
|-------------------|-------------------|---------------------------------------------------|
| `formula`         | string            | Expressão compilada a partir dos termos           |
| `terms`           | RollTerm[]        | Array de termos parseados                         |
| `data`            | object            | Dados originais para substituição de variáveis    |
| `total`           | number            | Total numérico após avaliação                     |
| `result`          | string            | Expressão aritmética com os valores rolados       |
| `isDeterministic` | boolean           | True se não há termos aleatórios                  |

### 9.3 Métodos de Avaliação

| Método                         | Tipo         | Descrição                                              |
|--------------------------------|--------------|--------------------------------------------------------|
| `evaluate(options?)`           | Async        | Avalia o roll; suporta `maximize`, `minimize`          |
| `evaluateSync(options?)`       | Sync         | Avaliação síncrona; `strict: true` lança erro se não-determinístico |
| `clone()`                      | —            | Cópia não-avaliada com mesma fórmula e dados           |
| `alter(multiply, add)`         | —            | Modifica contagem de dados (`alter(2, 0)` dobra dados) |
| `reroll(options?)`             | —            | Nova instância com mesma fórmula/dados                 |
| `toMessage(messageData, opts)` | —            | Cria e salva um `ChatMessage` com este roll            |
| `toAnchor(options?)`           | —            | Cria elemento `<a>` de inline roll para HTML           |
| `toJSON()`                     | —            | Serializa para JSON                                    |

### 9.4 Métodos Estáticos

| Método                              | Descrição                                                  |
|-------------------------------------|------------------------------------------------------------|
| `Roll.create(formula, data, opts)`  | Factory que usa a classe de Roll configurada               |
| `Roll.fromJSON(json)`               | Reconstrói Roll a partir de string JSON                    |
| `Roll.fromData(data)`               | Reconstrói Roll a partir de objeto de dados                |
| `Roll.fromTerms(terms, opts)`       | Constrói Roll a partir de array de RollTerms               |
| `Roll.parse(formula, data)`         | Retorna array de RollTerms sem avaliar                     |
| `Roll.replaceFormulaData(f, d, o)`  | Substitui `@attr` com valores de `d` na fórmula `f`       |
| `Roll.registerResult(method, d, r)` | Registra resultado externo no RollResolver ativo           |

### 9.5 Parser Peggy (v12+)

O Foundry adotou **Peggy** como parser de gramática para substituir o parsing por regex customizado.
Isso produz uma AST tipada de `RollParseNode` antes de instanciar os termos. Os tipos de nó
incluem: `DiceRollParseNode`, `NumericRollParseNode`, `PoolRollParseNode`,
`ParentheticalRollParseNode`, `FunctionRollParseNode`, `FlavorRollParseNode`, `StringParseNode`.

O método `Roll.parse()` invoca a gramática compilada (`RollGrammar`) e retorna os termos
prontos para avaliação.

---

## 10. RollResolver — Fulfillment Externo (v12+)

A partir da v12, o Foundry incorporou suporte a **fulfillment externo** de dados — anteriormente
disponível apenas via módulo "Unfulfilled Rolls". O fluxo:

1. Usuário configura métodos em `CONFIG.Dice.fulfillment.methods`, cada método com:
   - `label` — nome exibível
   - `icon` — ícone opcional
   - `interactive` — se exige input do usuário
   - `handler(term, result?)` — função de fulfillment não-interativo

2. Quando um roll é avaliado com método interativo, o Foundry abre um `RollResolver` (aplicação
   UI) aguardando resultados externos.

3. O módulo/serviço externo chama `Roll.registerResult(method, denomination, result)` para
   preencher cada dado conforme o usuário rola fisicamente ou o serviço Bluetooth retorna.

4. Após todos os dados satisfeitos, o `RollResolver` fecha e o roll é completado.

Casos de uso: dados físicos com NFC/Bluetooth (GoDice, Pixel Dice), entrada manual, serviço de
entropia externo (lava lamp, radiação cósmica de fundo).

---

## 11. Sistema de Chat

### 11.1 Estrutura do Documento ChatMessage

O `ChatMessage` é um Document do Foundry com o seguinte schema (v14):

| Campo       | Tipo         | Descrição                                                      |
|-------------|--------------|----------------------------------------------------------------|
| `_id`       | DocumentId   | Identificador único                                            |
| `author`    | ForeignDoc   | Referência ao User autor                                       |
| `blind`     | Boolean      | Se o conteúdo está oculto para não-destinatários               |
| `content`   | HTML         | Conteúdo HTML principal da mensagem                            |
| `emote`     | Boolean      | Se é uma mensagem de emote                                     |
| `flavor`    | HTML         | Texto de sabor (flavor text) — exibido acima do roll           |
| `rolls`     | Array(JSON)  | Rolls serializados em JSON                                     |
| `sound`     | FilePath     | Som reproduzido com a mensagem                                 |
| `speaker`   | SchemaField  | Objeto com `scene`, `actor`, `token`, `alias`                  |
| `style`     | Number       | Estilo de exibição (veja CHAT_MESSAGE_STYLES)                  |
| `timestamp` | Number       | Unix timestamp de criação                                      |
| `title`     | String       | Título opcional                                                |
| `type`      | DocumentType | Tipo de documento (substitui uso antigo de type como estilo)   |
| `whisper`   | Array(Ref)   | Array de User IDs destinatários                                |
| `flags`     | Object       | Namespace de dados arbitrários por sistema/módulo              |

### 11.2 Chat Message Styles (CHAT_MESSAGE_STYLES)

| Constante | Comportamento                                                         |
|-----------|-----------------------------------------------------------------------|
| `OTHER`   | Mensagem sem categoria especial (padrão para rolls e system messages) |
| `OOC`     | Out-of-Character — contornada na cor do jogador                       |
| `IC`      | In-Character — falada pelo personagem associado                       |
| `EMOTE`   | Emote do personagem ("Nome faz X")                                    |

**Nota histórica:** Em versões anteriores (v9/v10), existia `CHAT_MESSAGE_TYPES` com os valores
`ROLL`, `OOC`, `IC`, `EMOTE`, `WHISPER`, `OTHER` como enum numérico. Isso foi depreciado e
substituído por `CHAT_MESSAGE_STYLES` (apenas estilo visual) + campo `rolls` separado para
dados. Em v12+, o campo `style` é um número; o campo legado `type` como discriminador de roll
foi eliminado.

### 11.3 Comandos de Chat

| Comando(s)                          | Modo       | Descrição                                    |
|-------------------------------------|------------|----------------------------------------------|
| `/roll`, `/r`, `/publicroll`, `/pr` | PUBLIC     | Roll visível a todos                         |
| `/gmroll`, `/gmr`                   | PRIVATE    | Roll visível ao GM e ao jogador               |
| `/blindroll`, `/broll`, `/br`       | BLIND      | Roll visível apenas ao GM                    |
| `/selfroll`, `/sr`                  | SELF       | Roll visível apenas ao autor                 |
| `/ic`                               | —          | Mensagem in-character (requer token)         |
| `/ooc`                              | —          | Mensagem out-of-character                    |
| `/emote`, `/em`, `/me`              | —          | Emote do personagem selecionado              |
| `/whisper [alvo], /w [alvo]`        | —          | Mensagem privada para usuário(s) específico(s)|

Para `/whisper`, os alvos são especificados como `[NomeUsuario]` ou múltiplos separados por
vírgula: `/w [João, Maria] mensagem`. Palavras-chave especiais: `gm` (todos os GMs), `players`
(todos os não-GMs).

### 11.4 Speaker — Resolução de Identidade

O campo `speaker` identifica quem está falando no chat. É resolvido por
`ChatMessage.getSpeaker(options)`:

```typescript
static getSpeaker(options?: {
  actor?: Actor;
  token?: TokenDocument;
  scene?: Scene;
  alias?: string;
}): ChatSpeakerData
```

**Ordem de resolução (prioridade decrescente):**
1. Token controlado no momento (primeiro token controlado)
2. Actor associado ao usuário (se nenhum token estiver controlado)
3. Opções explicitamente passadas (`actor`, `token`, `scene`, `alias`)
4. Fallback: nome do usuário

O `alias` retornado pelo accessor `ChatMessage#alias` pode ser o nome do Token (em mensagens
IC/roll) ou o nome do User (em OOC/whisper). O `alias` é exibido como remetente no log de chat.

---

## 12. Chat Cards com Botões Interativos

Sistemas complexos como `pf2e` e `dnd5e` extendem `ChatMessage` para criar "chat cards" — mensagens
HTML ricas com botões para ações contextuais pós-roll.

### 12.1 Arquitetura do Chat Card

O padrão estabelecido pelo ecossistema Foundry segue estes passos:

1. **Criação:** O sistema chama `roll.toMessage(messageData)` ou `ChatMessage.create(data)`
   passando HTML customizado em `content`, com botões marcados por atributos `data-action`.

2. **Renderização:** O hook `renderChatMessage(message, html, data)` é disparado para cada
   mensagem renderizada no log. Sistemas e módulos registram listeners neste hook para
   adicionar interatividade ao HTML.

3. **Event Delegation:** O padrão preferido é registrar um único listener no elemento pai
   (o chat log ou o card inteiro) e detectar cliques via `data-action`:

   ```javascript
   // Padrão de event delegation em sistemas
   Hooks.on("renderChatMessage", (message, html) => {
     html.on("click", "[data-action]", event => {
       const action = event.currentTarget.dataset.action;
       // dispatch por action type
     });
   });
   ```

4. **Dados no Card:** Metadados necessários para ações são embutidos como `data-*` attributes no
   HTML ou armazenados em `message.flags.sistema.*` para persistência após reload.

### 12.2 Tipos de Botões Comuns (Ecossistema pf2e/dnd5e)

| Botão               | Função                                                        |
|---------------------|---------------------------------------------------------------|
| Aplicar Dano        | Aplica resultado de dano ao token selecionado                 |
| Metade do Dano      | Aplica dano reduzido (save bem-sucedido)                      |
| Rolar Save          | Cria novo roll de saving throw a partir do card do ataque     |
| Aplicar Efeito      | Adiciona efeito (status effect, condição) ao ator             |
| Critico / Falha     | Indicadores visuais de critical hit/fumble com ações extras   |

O sistema `dnd5e` implementa os botões como **custom HTML elements** (Web Components) ao invés de
buttons tradicionais, encapsulando lógica complexa de application de dano, efeitos e targets AC.

### 12.3 Flags do Sistema

`ChatMessage.flags.sistema` é o namespace onde sistemas armazenam dados serializados:

```javascript
// Criando mensagem com flags
ChatMessage.create({
  content: htmlContent,
  flags: {
    minhasistema: {
      itemId: item.id,
      attackTotal: rollTotal,
      targets: targetIds
    }
  }
});
```

Flags sobrevivem a reloads e são acessíveis em qualquer cliente que receba a mensagem.

---

## 13. Chat Bubbles

Mensagens in-character (`/ic`) e emotes (`/emote`) de tokens posicionados em cena geram
**chat bubbles** — balões visuais exibidos acima do token na cena. O comportamento inclui:

- Exibição temporária do texto acima do sprite do token
- Opção de mover a câmera (pan) para o token falante
- Configurável nas settings do mundo: duração, estilo

---

## 14. Dados 3D — Dice So Nice e Alternativas

### 14.1 Dice So Nice

**Dice So Nice** é o módulo padrão de facto do ecossistema Foundry para dados 3D animados.
Tecnologia:
- **Three.js** — renderização 3D
- **cannon-es** — física de corpos rígidos
- **Proton** — sistema de partículas

Funciona interceptando rolls antes de exibir o resultado no chat. Enquanto a animação física dos
dados rola na tela, o resultado já existe matematicamente mas é ocultado. O módulo expõe uma API
para developers:

- Hook `diceSoNiceRollStart` — disparado quando uma animação de dados começa
- Hook `diceSoNiceRollComplete` — disparado quando a animação termina

Systems e módulos podem chamar `game.dice3d.showForRoll(roll)` para acionar a animação de dados
para um roll específico.

Baseado no "Online 3D Dice Roller" de Anton Natarov (domínio público).

### 14.2 dddice

Serviço externo que sincroniza dados 3D entre múltiplas plataformas (Foundry, D&D Beyond, site
próprio). Tem módulo oficial para Foundry.

### 14.3 Alternativas Open-Source para um VTT Próprio

Para o projeto Fusion, opções viáveis de dados 3D open-source:

| Biblioteca      | Licença    | Notas                                                          |
|-----------------|------------|----------------------------------------------------------------|
| **Three.js**    | MIT        | Mesma usada pelo DSN; grande ecossistema                       |
| **Babylon.js**  | Apache 2.0 | Mais performático; usado pelo D&D Beyond; física nativa melhor |
| **cannon-es**   | MIT        | Fork mantido do cannon.js; física de rígidos                   |
| **rapier.js**   | Apache 2.0 | Motor de física em Rust/WASM; muito mais performático          |

A D&D Beyond migrou de Three.js para Babylon.js para os dados digitais. Para um VTT novo,
Babylon.js + rapier.js seria a combinação com melhor custo/benefício.

---

## 15. Considerações para Implementação no Fusion

### 15.1 Motor de Parsing

Replicar a abordagem Peggy (PEG parser) para a sintaxe de fórmula é a escolha mais robusta.
Alternatives:
- **nearley.js** — grammar mais expressiva, licença MIT
- **PEG.js / Peggy** — mesma biblioteca usada pelo Foundry, MIT license
- **Parser manual recursivo** — mais simples, suficiente para o subset básico

### 15.2 Design da Sintaxe Própria

O Fusion pode adotar a mesma sintaxe do Foundry (exceto código) como baseline, dado que:
- A sintaxe é baseada em notação de dados padrão do hobby (NdX, kh, dl, x, r)
- Não é IP proprietário do Foundry — é convenção da comunidade
- Isso garante familiaridade para GMs e jogadores

Extensões específicas para pf2e/Starfinder podem ser adicionadas (ex.: `d20+X >= DC` para
cálculo de degree of success inline).

### 15.3 Arquitetura de Chat

- Documentos `ChatMessage` devem ser sincronizados via WebSocket para todos os clientes
- Roll modes mapeiam diretamente em campos de visibilidade (`whisper[]`, `blind`)
- Chat cards devem ser HTML renderizado no servidor ou template-engine no cliente
- Flags de sistema devem ter namespace isolado por sistema de jogo

### 15.4 Dados 3D

Não é requisito MVP, mas é expectativa do ecossistema. Estratégia sugerida:
- MVP: notação de resultado apenas (texto)
- v1.1: integração com Dice So Nice via iFrame ou módulo isolado
- v2.0: implementação própria com Three.js/Babylon.js

---

## Fontes

- [Dice Modifiers | Foundry Virtual Tabletop (KB)](https://foundryvtt.com/article/dice-modifiers/)
- [Basic Dice | Foundry Virtual Tabletop (KB)](https://foundryvtt.com/article/dice/)
- [Advanced Dice | Foundry Virtual Tabletop (KB)](https://foundryvtt.com/article/dice-advanced/)
- [Chat Messages | Foundry Virtual Tabletop (KB)](https://foundryvtt.com/article/chat/)
- [Roll | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.dice.Roll.html)
- [RollTerm | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.dice.terms.RollTerm.html)
- [DiceTerm | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.dice.terms.DiceTerm.html)
- [Die | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.dice.terms.Die.html)
- [PoolTerm | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.dice.terms.PoolTerm.html)
- [foundry.dice module | Foundry VTT API v14](https://foundryvtt.com/api/modules/foundry.dice.html)
- [ChatMessage | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.documents.ChatMessage.html)
- [CHAT_MESSAGE_STYLES | Foundry VTT API v12](https://foundryvtt.com/api/v12/enums/foundry.CONST.CHAT_MESSAGE_STYLES.html)
- [CHAT_MESSAGE_TYPES | Foundry VTT API v10 (depreciado)](https://foundryvtt.com/api/v10/enums/foundry.CONST.CHAT_MESSAGE_TYPES.html)
- [DICE_ROLL_MODES | Foundry VTT API v10](https://foundryvtt.com/api/v10/enums/foundry.CONST.DICE_ROLL_MODES.html)
- [DICE_ROLL_MODES | Foundry VTT API v13](https://foundryvtt.com/api/variables/CONST.DICE_ROLL_MODES.html)
- [RollResolver | Foundry VTT API v14](https://foundryvtt.com/api/classes/foundry.applications.dice.RollResolver.html)
- [renderChatMessage hook | Foundry VTT API v12](https://foundryvtt.com/api/v12/functions/hookEvents.renderChatMessage.html)
- [Dice Rolling V3 issue #8573 (Async Rolls, Peggy, Unfulfilled Rolls)](https://github.com/foundryvtt/foundryvtt/issues/8573)
- [Adopt Peggy issue #9773](https://github.com/foundryvtt/foundryvtt/issues/9773)
- [Unfulfilled Rolls — Absorb into core issue #9775](https://github.com/foundryvtt/foundryvtt/issues/9775)
- [Chat and Messaging | DeepWiki dnd5e](https://deepwiki.com/foundryvtt/dnd5e/4.2-chat-and-messaging)
- [Dice So Nice! — GitLab (Simone Ricciardi)](https://gitlab.com/riccisi/foundryvtt-dice-so-nice)
- [Dice So Nice! — Foundry VTT packages](https://foundryvtt.com/packages/dice-so-nice/)
- [dddice — Foundry VTT packages](https://foundryvtt.com/packages/dddice)
- [Math extensions | Foundry VTT API v13](https://foundryvtt.com/api/modules/primitives.Math.html)
- [Deferred inline rolls issue #5758](https://github.com/foundryvtt/foundryvtt/issues/5758)
- [Roll Formulas — dnd5e wiki (Apache 2.0)](https://github.com/foundryvtt/dnd5e/wiki/Roll-Formulas)
