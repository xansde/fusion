# Arquétipo do Guerreiro (Fighter Archetype) — o que existe, o que falta

## O que existe hoje no pin publicado (v0.1.1)

`external/fusion-systems-2e/systems/pf2e/packs/feats-core/documents.json` tem **1807** talentos.
Confirmado por busca direta (Python, campo `system.traits.value`):

- **Zero** ocorrências do nome "Fighter Dedication" no pack.
- **6** talentos com o trait `dedication` no total, e nenhum é do Guerreiro: `Alchemist Dedication`,
  `Avenger Dedication`, `Bloodrager Dedication`, `Rogue Dedication`, `Runelord Dedication`,
  `Vindicator Dedication` (bate exatamente com o que o briefing já sabia).
- 116 talentos têm o trait `archetype`, mas nenhum tem o trait `fighter` simultaneamente — os
  116 documentos de arquétipo com trait `dedication`/`archetype` presentes cobrem outras classes.

**Conclusão direta: o arquétipo do Guerreiro não está publicado.** Um personagem não-Guerreiro
não consegue pegar `Fighter Dedication` nem nenhum talento subsequente da cadeia hoje.

## Existe extração local do vendor — e ela é mais completa do que o esperado

O submodule (`external/fusion-systems-2e/tools/importer-pf2e/`) **não tem** pasta `out/` (só
`analysis/`, `samples/`, `src/`, `README.md`) — busca por "Fighter Dedication" nesses três
diretórios: zero hits.

Mas o **core** (`C:/Users/xansd/pessoal/fusion/tools/importer-pf2e/out/feats/`) tem uma extração
completa do vendor com **5987 talentos** (todas as classes, todos os arquétipos), em três estágios
(`raw.json`, `normalized.json`, `transformed.json` — datados de 10/08/2026). `transformed.json` já
está no formato de documento do Fusion (mesma forma de `fighter-features.json`: `rules` convertidas
por tipo, `flags.fusion.unconvertedRules`, sem pack ainda).

Cruzando por pré-requisito de texto ("Fighter Dedication", "Basic Maneuver" etc.), os **6 talentos
do arquétipo do Guerreiro (remaster) estão todos lá**, com conversão de regra quase limpa (só 3
rule elements não convertidos no total, todos ChoiceSets de escolha de atributo/perícia):

| Talento | Nível | `unconvertedRules` |
|---|---|---|
| Fighter Dedication | 2 | 2 |
| Basic Maneuver | 4 | 1 |
| Fighter Resiliency | 4 | 0 |
| Reactive Striker | 4 | 0 |
| Advanced Maneuver | 6 | 0 |
| Diverse Weapon Expert | 12 | 0 |

Nenhum dos 6 tem campo `name_pt` — zero tradução pt-BR. Nenhum está em pack nenhum publicado
(nem no core, nem no submodule) — é saída crua do importador, parada no meio do pipeline.

## O que falta para publicar

**6 de 6 talentos do arquétipo do Guerreiro ficam de fora hoje** — 100%. O trabalho de extração e
conversão de regra já existe (não é preciso reprocessar o vendor), mas falta: (1) mover de
`tools/importer-pf2e/out/` para o pipeline de curadoria/publish do submodule, (2) tradução pt-BR
completa (0/6 hoje), (3) resolver os mesmos ChoiceSets "pendente" que já afetam a classe base
(Fighter Dedication escolhe atributo do Class DC + perícia; Advanced Maneuver/Basic Maneuver
concedem talento de Guerreiro dinamicamente — mesmo gap de `Combat Flexibility`, ver
`docs-features.json`).
