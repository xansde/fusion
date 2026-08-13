# Quadro de Missões — desenho aprovado (2026-08-11)

> **Estado: IMPLEMENTADO em 2026-08-12.** O desenho abaixo foi fechado com o
> dono em 2026-08-11 e construído no dia seguinte: página de journal com
> ownership próprio (`packages/shared/src/journal.ts`), leitura de missão
> (`quest.ts`), quatro ops `journal:*`, redação nos quatro caminhos de emissão,
> e o painel **Missões** do Hub (`QuestPanel.svelte` + `QuestAuthoring.svelte`),
> com o primeiro editor de texto rico do Fusion.
>
> A spec normativa é `specs/28-hub-do-jogador.md` (DEC-HUB-01..10,
> REQ-HUB-021..042). Este documento **não substitui** a spec: registra o que
> ficou decidido naquela conversa e que a spec ainda não dizia — as **etapas
> nomeadas** e a **descrição por etapa**.
>
> **O que mudou do desenho para o construído**, por decisão do dono em
> 2026-08-12: o vínculo com POI é **por etapa**, além de por missão, e é
> opcional nos dois níveis (REQ-HUB-038 reescrito). Etapas diferentes podem
> apontar para lugares diferentes — ou para o mesmo, ou para nenhum.

## O que foi decidido

### 1. A missão é UM documento com pedaços, não vários documentos costurados

Uma `JournalEntry` cujas páginas são o gancho, o boato e cada etapa, **cada uma
com ownership próprio**. É o que DEC-HUB-04 já assumia; o que faltava era a
confirmação do dono, que veio: a missão precisa ser uma coisa só na tela em que
o GM escreve.

Depende de **Q-JRN-003** (spec 12) resolver por **sobrescrita** — o ownership da
página manda sobre o da entry. Se um dia resolver por herança, DEC-HUB-04 reabre
e o desenho abaixo cai junto.

### 2. As etapas têm NOME LIVRE, escrito pelo GM

Não existe lista de etapas válidas no código, nem rótulo fixo do tipo
"Objetivo 1/2/3". O **nome da etapa é o título da página**, e o painel monta a
lista a partir das páginas que existem, na ordem delas.

Renomear uma etapa no meio da campanha **não perde a revelação**: o estado mora
no `ownership` da página, não no título.

### 3. Cada etapa pode ter descrição, e ela é opcional

A descrição é o **corpo da página** — editor completo (TipTap: negrito, listas,
`@UUID` para o pino do mapa ou para um NPC), não um campo de texto simples.

Etapa sem corpo vira uma linha de checklist e não mostra o expansor. A maioria
vai ser assim na prática ("Falar com o xerife"), e cobrar um parágrafo por item
mataria a ergonomia.

### 4. A descrição segue a MESMA revelação do nome

Não existe "vê o título mas não o texto": a página é uma peça só. Entregar o
nome sem o conteúdo é criar **outra etapa** com o texto que o jogador pode ler —
o mesmo raciocínio de DEC-HUB-05 (o boato é texto escrito, não recorte
automático do gancho, porque o formato do recorte conta o que existe por trás).

### 5. A nota privada do GM cabe na mesma estrutura

Uma etapa com ownership só de GM é uma página que nenhum jogador recebe
("lembrar: a coisa na neblina é a mãe, não o filhote"). Não precisa de campo
novo — é o mesmo mecanismo com outro destinatário. Tela dedicada para isso ficou
fora do escopo.

### 6. Etapa concluída fica riscada no lugar

Não some da lista nem migra para um bloco "feito" no rodapé. O rastro do que já
foi feito é o que faz o quadro parecer diário e não mural.

## Como fica na tela

### Autoria (GM)

```
┌ ─                                                        ─ ┐
    CÃES DA ESTRADA                              ✎ editando

    Gancho    O gado de Godford some há três luas. O xerife
              paga 40 po por cabeça de lobo — mas ninguém
              viu lobo nenhum.

    Boato     Dizem que a estrada de Godford anda comendo
              gente.

    ETAPAS                                        + nova etapa

    ⠿  1  Pista do curral            [✎] [👁 revelar] [✓]
    ⠿  2  A coisa na neblina         [✎] [👁 revelar] [✓]
    ⠿  3  Voltar e cobrar do xerife  [✎] [👁 revelar] [ ]

    Lugares   📍 Ruínas de Godford        [desvincular]
              + vincular pino do mapa
└ ─                                                        ─ ┘
```

### Jogador com a missão publicada, etapa expandida

```
┌ ─                                                        ─ ┐
    MISSÕES                                          2 ativas

    ● CÃES DA ESTRADA
      O gado de Godford some há três luas. O xerife paga
      40 po por cabeça de lobo — mas ninguém viu lobo nenhum.

      [✓] Pista do curral                                  ▾
      [ ] A coisa na neblina                               ▴
          │
          │  As pegadas afundam demais para lobo. Seguem
          │  para o norte, entram na neblina que não sai
          │  do vale desde a primeira lua — e não voltam.
          │
          │  📍 Ruínas de Godford
          │
                                    📍 rastrear no mapa
└ ─                                                        ─ ┘
```

A etapa 3 não aparece porque **não chega ao cliente dele** — não é `v-if` na
tela, é ausência de payload (REQ-HUB-022).

### Jogador que só tem o boato

```
┌ ─                                                        ─ ┐
    MISSÕES                                          0 ativas

    Nenhuma missão ainda.

    ─────────────────────────────────────────────────────────

    ? BOATOS
      · "Dizem que a estrada de Godford anda comendo gente."
└ ─                                                        ─ ┘
```

### Matriz de revelação (GM)

```
┌ ─                                                        ─ ┐
    REVELAÇÃO                              ○ oculto  ? rumor
                                           ● publicada
                        Tobias   Comedor   Íris
    CÃES DA ESTRADA        ●        ?       ○      [todos ▸]
      Pista do curral      ✓        ·       ·
      A coisa na neblina   ●        ○       ○
      Voltar e cobrar      ○        ○       ○

    O SINO QUE NÃO TOCA    ●        ●       ?      [todos ▸]
└ ─                                                        ─ ┘
```

`[todos ▸]` leva a mesa ao próximo degrau a partir de quem está mais atrás e
**nunca rebaixa** quem já viu (REQ-HUB-031).

## O que está gravado por baixo

```
JournalEntry  "Cães da Estrada"
  flags.fusion.hub.pois  = [ uuid do pino Ruínas de Godford ]
  flags.fusion.hub.done  = false
  │
  ├─ page "Gancho"                    ownership: {tobias: observer}
  ├─ page "Boato"                     ownership: {comedor: observer}
  ├─ page "Pista do curral"           ownership: {tobias: observer}
  │    flags.fusion.hub.done = true
  ├─ page "A coisa na neblina"        ownership: {tobias: observer}
  └─ page "Voltar e cobrar do xerife" ownership: {default: none}
```

## O que ficou decidido, e o que continua aberto

- **Q-HUB-04 — RESOLVIDA (2026-08-12): conclusão de etapa é da mesa.** Gravada
  como um booleano em `flags.fusion.hub.done` da página, não como mapa de quem
  marcou. Campanha com objetivo secreto individual resolve com uma etapa
  revelada só àquele jogador — mecanismo que já existe.
- **Q-JRN-003 — RESOLVIDA (2026-08-12): sobrescrita, com herança como
  fallback.** Ver `specs/12-journal-tabelas-cartas.md`.
- **Reordenar etapa** preservando revelação continua `[V2]` (REQ-HUB-037): a
  ordem é o campo `sort` da página e o painel a respeita, mas arrastar para
  reordenar não foi construído.
- Q-HUB-02, Q-HUB-03 e Q-HUB-05 continuam abertas e não bloqueiam nada.

## Pré-requisito técnico — resolvido

`JournalEntrySchema.pages` era `z.array(z.record(z.string(), z.unknown()))` no
servidor: página sem schema e **sem ownership tipado**, portanto impossível de
redigir. Agora é `z.array(JournalEntryPageSchema)`, importando o schema
compartilhado (nunca uma segunda cópia — `.extend()` sem `.passthrough()` apaga
em silêncio o que não conhece). A redação por espectador ficou em
`net/redaction.ts` (`redactJournalForViewer` + `emitJournalOp`), o mesmo
desenho que o pino de mapa já tinha, aplicado a `JournalEntryPage`.
