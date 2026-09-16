# Inventário do Guerreiro (Fighter PF2e) no Fusion — briefing comum

## O que é este trabalho

Levantamento talento×mecanismo do **Guerreiro (Fighter, PF2e remaster)** no Fusion — o mesmo
tratamento já feito para o Alquimista e o Animista (notas no vault Obsidian "Claude Seazone",
`Projects/fusion/alquimista/` e `Projects/fusion/animista/`).

Para cada documento de regra (talento, habilidade de classe, arquétipo, categoria de conteúdo)
queremos saber: **quais mecanismos de VTT ele exige** para funcionar de verdade, e **se cada um
desses mecanismos existe hoje no código**.

Repos (todos já clonados na máquina):
- core: `C:/Users/xansd/pessoal/fusion` (branch `alfa/app`)
- satélite (submodule): `C:/Users/xansd/pessoal/fusion/external/fusion-systems-2e` (pin v0.1.1)

## Régua de evidência — NÃO NEGOCIÁVEL

Um mecanismo só conta como **existe** se houver **código executando de verdade** + **gatilho real
na UI** (botão/ação que o usuário clica) + **dado que alimenta o fluxo**.

NÃO contam como evidência: tipo TypeScript, enum, campo de schema, comentário, TODO, spec em
`specs/`, teste sem chamador de produção, função exportada que ninguém chama.

Status possíveis:
- `funciona` — ponta a ponta, com gatilho na UI
- `parcial` — existe parte (e a nota diz EXATAMENTE o que falta)
- `ausente` — não existe

**Toda afirmação de status precisa de evidência `arquivo:linha`** (caminho relativo à raiz do core,
incluindo o prefixo `external/fusion-systems-2e/` quando for no satélite). Se você não achou, diga
"não encontrei" — NUNCA infira que funciona a partir do nome de um arquivo, de um tipo ou de uma spec.

## Vocabulário canônico de mecanismos

`C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/e9048d8b-adde-4cd6-99d3-106e12410ded/scratchpad/gue/catalogo-mecanismos.md`
tem os **86 mecanismos já catalogados** (IDs canônicos, status e evidência) pelos inventários do
Alquimista e do Animista. **Use esses IDs sempre que servirem** — a fonte única do status é a nota
existente, não recriamos mecanismo com outro nome.

Mecanismos **novos do eixo marcial** já batizados por esta sessão (use exatamente estes IDs):

| ID | O que é |
|---|---|
| `WEAPON-STRIKE` | Strike com arma equipada ponta a ponta: escolher alvo, rolar contra a CA dele, aplicar o resultado |
| `MAP-TRACK` | Contagem do penalidade de ataque múltiplo no turno (incremento automático, reset no início do turno) e strikes que declaradamente não contam para o MAP |
| `MANEUVER` | Manobras básicas (Trip, Grapple, Shove, Disarm, Reposition, Escape): rolagem contra CD do alvo com efeito por grau de sucesso |
| `OFF-GUARD-POS` | Off-guard derivado de posição (flanqueio) ou imposto por efeito, e o -2 na CA do alvo entrando na rolagem |
| `SHIELD-BLOCK` | Reação de bloquear com escudo: dureza, PV do escudo, limiar de quebra |
| `RAISE-SHIELD` | Erguer o escudo: bônus de CA que dura até o começo do próximo turno |
| `CRIT-SPEC` | Efeito de especialização crítica por grupo de arma no acerto crítico |
| `MULTI-TARGET-STRIKE` | Um ataque que atinge vários alvos, ou vários Strikes empacotados numa ação |
| `REACTION-TRIGGER` | O servidor detectar o gatilho e OFERECER a reação ao jogador na hora certa |
| `TEMP-HP` | Pontos de vida temporários |
| `WEAPON-GROUP` | Grupo de arma / trait de arma como seletor de regra (ex.: proficiência só com um grupo) |
| `DEADLY-FATAL` | Dados extras de dano no crítico vindos de traits de arma (deadly, fatal) |

Se precisar de um mecanismo que não está em nenhuma das duas listas, crie um ID novo com prefixo
`NEW-` (ex.: `NEW-COVER`) e **explique em uma linha por que nenhum existente serve**. Seja econômico:
mecanismo demais é tão ruim quanto de menos.

## Fonte dos dados de regra

Os documentos do Guerreiro já foram extraídos dos packs publicados para JSON, na mesma pasta:
- `fighter-feats.json` — 112 talentos de classe (pt-BR 112/112)
- `fighter-features.json` — 16 habilidades de classe
- `fighter-class.json` — o item de classe (progressão, proficiências)
- `referencias-uuid.json` — o que os textos referenciam (ações, condições, efeitos), com contagem

Campos de cada documento: `name`, `name_pt`, `level`, `actionType` (action/reaction/free/passive),
`actions`, `traits`, `prereq`, `rules` (rule elements do vendor, kebab-case), `rulesFull` (JSON
completo de cada rule element), `unconverted` (rule elements que o importador NÃO converteu),
`uuids` (referências), `text` (descrição em texto puro).

Contexto que já é fato verificado nesta sessão (não precisa reconferir):
- A classe Fighter **está publicada** no pin v0.1.1 (`classes-core`), com 16 class features e 112
  talentos, e **pt-BR 100%** — ao contrário do Alquimista/Animista, que nem estão no pin.
- O motor de rule elements (`external/fusion-systems-2e/systems/engine-2e/src/effectsEngine.ts:140-180`)
  trata só 5 tipos: `rollOption`, `flatModifier`, `note`, `toggleCondition`, `iwr`. Qualquer outro é
  logado e ignorado.
- `applyDamagePipeline` (`external/fusion-systems-2e/systems/pf2e/src/actions/damage.ts:119`) existe,
  é testado e **não tem chamador de produção**.
