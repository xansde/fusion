# Fusion — Especificações

Fusion é um VTT (virtual tabletop) web próprio, inspirado no comportamento do Foundry VTT, construído em **clean-room** (nenhum código proprietário do Foundry é copiado). Motor próprio com API de sistemas própria; servidor local na máquina do GM; jogadores conectam pelo navegador. Sistemas-alvo iniciais: **Pathfinder 2e (remaster)**, **Starfinder 2e** e **Etmos RPG**.

Estas specs foram geradas a partir da pesquisa em [`docs/research/`](../docs/research/) (21 documentos) e revisadas por revisão adversarial multi-agente em 2026-06-11.

## Como ler

- Comece por `00-visao-e-escopo.md`, depois `01-arquitetura-geral.md` e `27-roadmap-e-milestones.md`.
- Requisitos são numerados `REQ-<PREFIXO>-NNN` e marcados **[MVP]** ou **[V2]**.
- **MVP global**: o grupo joga uma sessão de PF2e com mapa+grid, tokens com movimento, visão/iluminação/fog básicos, fichas funcionais, rolagens automatizadas básicas, chat e combat tracker.

## Índice

| #   | Spec                                                                 | Tema                                           |
| --- | -------------------------------------------------------------------- | ---------------------------------------------- |
| 00  | [Visão e Escopo](00-visao-e-escopo.md)                               | Por quê, objetivos, não-objetivos, princípios  |
| 01  | [Arquitetura Geral](01-arquitetura-geral.md)                         | Componentes, processos, boot, configuração     |
| 02  | [Modelo de Dados](02-modelo-de-dados.md)                             | Documents, schemas, ownership, CRUD            |
| 03  | [Persistência e Mundos](03-persistencia-e-mundos.md)                 | SQLite, layout em disco, export/import         |
| 04  | [Rede e Sincronização](04-rede-e-sincronizacao.md)                   | Protocolo WS, autoridade, reconexão, presença  |
| 05  | [Usuários e Permissões](05-usuarios-e-permissoes.md)                 | Roles, matriz de permissões, login             |
| 06  | [Canvas e Renderização](06-canvas-e-renderizacao.md)                 | PIXI, camadas, grid, tokens, templates         |
| 07  | [Visão, Iluminação e Fog](07-visao-iluminacao-fog.md)                | Walls, visibility polygon, luzes, fog of war   |
| 08  | [Motor de Rolagens](08-motor-de-rolagens.md)                         | Sintaxe, RNG no servidor, roll modes, dados 3D |
| 09  | [Chat e Mensagens](09-chat-e-mensagens.md)                           | Mensagens, comandos, chat cards declarativos   |
| 10  | [Combate e Iniciativa](10-combate-e-iniciativa.md)                   | Encounters, iniciativa por sistema, turnos     |
| 11  | [UI Framework e Fichas](11-ui-framework-e-fichas.md)                 | Window manager, sheets Svelte, theming, i18n   |
| 12  | [Journal, Tabelas e Cartas](12-journal-tabelas-cartas.md)            | Journals, @links, roll tables                  |
| 13  | [Áudio e Playlists](13-audio-e-playlists.md)                         | Playlists, canais, ambient sounds              |
| 14  | [Macros e Automação](14-macros-e-automacao.md)                       | Macros, hotbar, ações declarativas, game time  |
| 15  | [API de Sistemas](15-api-de-sistemas.md)                             | Contrato engine↔sistema, motor de modifiers    |
| 16  | [Compendiums e Importação](16-compendiums-e-importacao.md)           | Packs, browser, importer pf2e                  |
| 17  | [Sistema Pathfinder 2e](17-sistema-pf2e.md)                          | Engine 2e, automação, fichas, cobertura        |
| 18  | [Sistema Starfinder 2e](18-sistema-sf2e.md)                          | Deltas sobre a engine 2e                       |
| 19  | [Sistema Etmos](19-sistema-etmos.md)                                 | Compositor de magias, Partículas, Marcos       |
| 20  | [Assets e Mídia](20-assets-e-midia.md)                               | Upload, storage, serving, browser de assets    |
| 21  | [Segurança](21-seguranca.md)                                         | Threat model, auth, sanitização, exposição     |
| 22  | [Instalação e Distribuição](22-instalacao-e-distribuicao.md)         | Executável, setup, auto-update, túneis         |
| 23  | [Acessibilidade e Dispositivos](23-acessibilidade-e-dispositivos.md) | A11y, tablets/touch                            |
| 24  | [Operação, Backups e Telemetria](24-operacao-backups-telemetria.md)  | Backups, logs, diagnóstico                     |
| 25  | [Testes e Qualidade](25-testes-e-qualidade.md)                       | Pirâmide de testes, golden tests 2e, CI        |
| 26  | [Licenças e Legal](26-licencas-e-legal.md)                           | Clean-room, ORC/OGL, marcas, Etmos             |
| 27  | [Roadmap e Milestones](27-roadmap-e-milestones.md)                   | Fases, dependências, definition of done        |
| 29  | [Pets, Companions e Familiars](29-pets-companions-familiars.md)      | Familiars, animal companions, pets, mounts     |
| 30  | [Multiclasse por Níveis](30-multiclasse-por-niveis.md)               | Regra variante: níveis de classe divididos     |
| 31  | [Base Canônica de Conteúdo](31-base-canonica-de-conteudo.md)         | Segunda fonte, eixos de sub-escolha, portões   |
| 32  | [Minimapa Tático](32-minimapa-tatico.md)                             | Overview da cena ativa, navegação de câmera    |
| 34  | [Mapa de Região](34-mapa-de-regiao.md)                               | Exploração em km, POIs reveláveis, overlays    |

## Stack fixada

| Camada           | Escolha                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| Linguagem        | TypeScript estrito, Node.js 22+, monorepo pnpm                                    |
| Servidor         | Fastify + socket.io v4 (servidor autoritativo)                                    |
| Persistência     | better-sqlite3 (um `world.db` por mundo, WAL)                                     |
| Cliente          | Svelte 5 (Runes) + Vite                                                           |
| Canvas           | PIXI.js v8 (WebGPU → fallback WebGL)                                              |
| Rolagens         | @dice-roller/rpg-dice-roller + camada própria; RNG no servidor; @3d-dice/dice-box |
| Visão/Fog        | Visibility polygon próprio + clipper2-ts; honeycomb-grid para hex                 |
| Rich text        | TipTap                                                                            |
| Áudio            | Howler.js                                                                         |
| Desktop (fase 2) | Tauri v2                                                                          |

## Monorepo (planejado)

```
packages/server      packages/client      packages/shared
packages/system-api  systems/engine-2e    systems/pf2e
systems/sf2e         systems/etmos        tools/importer-pf2e
```

`systems/engine-2e` é o núcleo de regras compartilhado entre PF2e e SF2e. Porta default do servidor: **33000**.
