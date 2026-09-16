# Inventário do Guerreiro (Fighter PF2e) — ferramentas e dados

O inventário em si **vive no vault Obsidian "Claude Seazone"**, em `Projects/fusion/guerreiro/`
(158 notas: 112 talentos, 17 habilidades, 21 mecanismos, 5 de conteúdo, mais índice, lacunas e
fontes). Aqui ficam só os geradores e os dados de entrada, para que qualquer recálculo seja
reproduzível — o gerador do inventário do Animista se perdeu no scratchpad da sessão, e esta pasta
existe para isso não se repetir.

Levantado em 2026-09-16, contra `alfa/app` + submodule `fusion-systems-2e` pin v0.1.1.

## O plano de tarefas

`tasks.md` (com `tasks-resumo.json` ao lado) é o plano de implementação derivado deste
inventário: sete fases cumulativas, decisões `D-G*`, contratos canônicos e uma ficha por tarefa.
Quem executa é a skill `/guerreiro`, sobre os scripts genéricos de `.claude/skills/_frentes/`;
o estado de execução vive em `estado.json`, escrito pelo `record.mjs`, e nunca à mão.

## Como recalcular

Depois de mudar o status de um mecanismo (em `dados/mecanismos-guerreiro.json`) ou de acrescentar
documentos:

```bash
cd docs/design/guerreiro
node tools/preprocess.cjs   # injeta EFFECT-SOURCE-ITEMS, normaliza campos, valida os IDs
node tools/gen.cjs          # reescreve as 129 notas de regra + as 21 de mecanismo no vault
node tools/lacunas.cjs      # refaz guerreiro-lacunas.md e carimba as notas compartilhadas
node tools/conteudo.cjs     # reescreve as 5 notas de cobertura de conteúdo
```

Os scripts leem os JSONs que estiverem **na mesma pasta deles** (`__dirname`), então mantenha
`tools/` e `dados/` juntos ou ajuste o caminho: hoje eles esperam rodar de uma pasta única. Para
recalcular a partir daqui, copie `dados/*` para dentro de `tools/` ou rode com os arquivos lado a
lado.

## O que é cada arquivo

| Arquivo                                                | O que é                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `dados/docs-feats-n1-6.json`, `docs-feats-n8-20.json`  | os 112 talentos, com os mecanismos que cada um exige e por quê                                               |
| `dados/docs-features.json`                             | a classe + as 16 habilidades (a entrada da classe traz a progressão 1–20 lida do pack)                       |
| `dados/mecanismos-guerreiro.json`                      | os 21 mecanismos novos do eixo marcial: regra, status, evidência `arquivo:linha`, o que falta, dependências  |
| `dados/mapa-mecanismos.json`                           | os 86 mecanismos herdados dos inventários do Alquimista e do Animista (fonte única do status, não duplicada) |
| `dados/fases.json`                                     | as 7 fases cumulativas — mudar a ordem aqui e rodar `lacunas.cjs` refaz o plano inteiro                      |
| `dados/capacidades-core.md`, `capacidades-satelite.md` | os dois levantamentos de código que fundamentam os status                                                    |
| `dados/conteudo.md`, `arquetipo.md`                    | cobertura de dado: armas, ações, condições, efeitos, arquétipo                                               |
| `dados/BRIEFING.md`                                    | o método e a régua de evidência usados no levantamento                                                       |
| `dados/uso-por-mecanismo.json`, `docs-derivados.json`  | saídas do `gen.cjs`, consumidas pelo `lacunas.cjs`                                                           |

## A régua

Um mecanismo só conta como **funciona** com código executando + gatilho real na UI + dado que
alimenta o fluxo. Tipo, enum, campo de schema, comentário, spec e teste sem chamador de produção
**não contam**. Toda afirmação de status tem evidência `arquivo:linha`.
