# 04 — Q-RDM-01: Disponibilidade dos Dados SF2e

> Gerado em: 2026-06-12
> Agente: SF2E-CHECK
> Questão: Os dados abertos do Starfinder 2e estão disponíveis para importação no Fusion?

---

## Veredito: DISPONÍVEL — dados completos, abertos, no mesmo repo do PF2e

Os dados do Starfinder Second Edition estão **totalmente integrados ao repositório `foundryvtt/pf2e`**, sob licença Apache 2.0, prontos para uso. Não há repositório separado nem barreira de acesso. O clone `vendor/pf2e` já contém **4.073 documentos SF2e** em `packs/sf2e/`.

---

## 1. Onde estão os dados

| Artefato                | Localização no repo               |
| ----------------------- | --------------------------------- |
| Manifesto do sistema    | `system.sf2e.json` (raiz do repo) |
| Todos os packs de dados | `packs/sf2e/` (30 subcategorias)  |
| Changelog SF2e          | `CHANGELOG (SF2E).md`             |
| Redirects de UUID       | `build/uuid-redirects/sf2e.json`  |

O sistema SF2e é um **modo alternativo do mesmo codebase PF2e** — a Paizo e a Foundry VTT autorizaram o projeto comunitário a manter ambos no mesmo repositório. A versão atual no vendor é **sf2e 1.2.0** (Foundry v14, verificado em 14.363).

---

## 2. Contagem de documentos por pack

Total: **4.073 documentos** (excluindo `_folders.json`).

| Pack                              | Documentos |
| --------------------------------- | ---------- |
| feats                             | 1.703      |
| equipment                         | 538        |
| heritages                         | 285        |
| alien-core-bestiary               | 247        |
| feat-effects                      | 168        |
| spells                            | 159        |
| actions                           | 141        |
| backgrounds                       | 131        |
| class-features                    | 119        |
| tales-from-the-vast-bestiary      | 95         |
| starfinder-society-bestiary       | 76         |
| ancestries                        | 48         |
| rulebook-bestiaries               | 46         |
| ancestry-features                 | 45         |
| bestiary-ability-glossary-srd     | 41         |
| guilt-of-the-grave-world-bestiary | 38         |
| bestiary-effects                  | 37         |
| spell-effects                     | 35         |
| deities                           | 27         |
| iconics                           | 24         |
| standalone-adventure-bestiary     | 21         |
| starfinder-society-boons          | 15         |
| equipment-effects                 | 14         |
| classes                           | 6          |
| paizo-pregens                     | 6          |
| journals                          | 4          |
| conditions                        | 3          |
| other-effects                     | 1          |
| macros                            | 1          |

Classes disponíveis: `envoy`, `mystic`, `operative`, `solarian`, `soldier`, `witchwarper`.
Ancestrais: 48 entradas cobrindo Android, Astrazoan, Barathu, Brenneri, Dragonkin, Elebrian, Formian, Goblin, Human, entre outras raças exclusivas SF.

---

## 3. Licença

O repositório `foundryvtt/pf2e` usa **Apache License 2.0** para o código e conteúdo de dados abertos. O conteúdo de regras publicado pela Paizo é distribuído sob **ORC (Open RPG Creative License)** — o mesmo regime que governa o PF2e desde 2023. Isso garante que os dados podem ser lidos, transformados e redistribuídos desde que a atribuição seja mantida.

Não há paywall, DRM ou restrição de acesso aos JSONs do repositório público.

---

## 4. Estado do projeto e maturidade

- **Versões publicadas**: 18 releases documentados (0.0.2 → 1.2.0), indicando projeto maduro e ativo.
- **Repositório oficial**: `https://github.com/foundryvtt/pf2e` (não é fork nem repositório separado).
- **Parceria oficial**: Paizo Inc. + Foundry Gaming LLC reconhecem o projeto comunitário SF2e For Foundry VTT.
- **Módulo legado**: `TikaelSol/sf2e-anachronism` foi arquivado; mantedores redirecionam para o repo principal.
- **Foundry**: suporte exclusivo a v14+ na versão 1.x; versão 0.0.x cobre v13.

---

## 5. Estrutura dos documentos SF2e vs. PF2e

Os documentos SF2e em `packs/sf2e/` seguem **exatamente o mesmo schema JSON** dos packs PF2e em `packs/pf2e/`. O importer atual (que já lê `packs/pf2e/`) pode reutilizar os mesmos parsers com mudança mínima no path de entrada. Diferenças a considerar:

| Aspecto                                  | PF2e                  | SF2e                         | Impacto no importer                            |
| ---------------------------------------- | --------------------- | ---------------------------- | ---------------------------------------------- |
| Schema de `feat`                         | igual                 | igual                        | zero                                           |
| Schema de `npc` (bestiary)               | igual                 | igual                        | zero                                           |
| Schema de `equipment`                    | igual                 | igual                        | zero                                           |
| Classes                                  | `packs/pf2e/classes/` | `packs/sf2e/classes/`        | trocar path                                    |
| Ancestrais SF-exclusivos                 | n/a                   | ~30 raças novas              | dados novos, schema igual                      |
| Traits SF-específicos (`robot`, `alien`) | ausentes              | presentes                    | parser de traits precisa de allowlist ampliada |
| Augmentations (cybernetics)              | ausentes              | em `equipment` com `Bulk: 0` | nenhuma extensão de schema necessária          |

---

## 6. Implicação para o Milestone M4

**M4 NÃO precisa deslizar.** Os dados SF2e estão presentes, abertos e no mesmo vendor clone já existente no projeto. O importer não precisa de nova dependência — apenas de uma segunda rota de entrada apontando para `packs/sf2e/` em vez de `packs/pf2e/`.

O que o importer precisa estender para suportar SF2e:

1. **Rota de seleção de sistema**: parâmetro `--system sf2e|pf2e` para selecionar o diretório base de packs.
2. **Trait allowlist**: expandir o mapa de traits para incluir traits SF-exclusivos (`robot`, `alien`, `technological`, `radioactive`, `powered`, etc.). Esses traits já existem nos JSONs — o importer só precisa não rejeitá-los.
3. **Classes SF**: os 6 arquivos de classe SF2e têm estrutura idêntica às classes PF2e; nenhuma extensão de schema é necessária.
4. **Verificação de packs de equipment**: o campo `compendiumSources` em alguns itens SF tem chaves próprias (já corrigido no changelog 1.2.0); validar que o importer tolera fontes desconhecidas sem falhar.

---

## 7. Conclusão

Os dados Starfinder 2e estão **completamente disponíveis** no clone `vendor/pf2e` já presente no projeto, sob licença Apache 2.0 + ORC, sem custo adicional e sem nova dependência. O importer PF2e precisará de extensão mínima (seleção de path e ampliação da allowlist de traits) para suportar SF2e — não é necessário criar infraestrutura nova. **M4 pode prosseguir conforme planejado.**
