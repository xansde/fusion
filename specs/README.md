# Fusion — Especificações

Fusion é um VTT (virtual tabletop) web próprio, inspirado no comportamento do Foundry VTT, construído em **clean-room** (nenhum código proprietário do Foundry é copiado). Motor próprio com API de sistemas própria; servidor local na máquina do GM; jogadores conectam pelo navegador. Sistemas-alvo iniciais: **Pathfinder 2e (remaster)**, **Starfinder 2e** e **Etmos RPG**.

Estas specs foram geradas a partir da pesquisa em [`docs/research/`](../docs/research/) (21 documentos) e revisadas por revisão adversarial multi-agente em 2026-06-11.

## Como ler

- Comece por `00-visao-e-escopo.md`, depois `01-arquitetura-geral.md` e `27-roadmap-e-milestones.md`.
- Requisitos são numerados `REQ-<ÁREA>-NNN` e marcados **[MVP]** ou **[V2]**.
- **A spec é a definição do objetivo.** Se o comportamento não a cumpre, ou a spec está
  desatualizada, ou a funcionalidade não foi cumprida corretamente — nunca "é assim mesmo".
- O formato das specs (o que é uma spec, níveis, identificadores, anatomia) está em
  [`CONVENCOES.md`](CONVENCOES.md), e a parte mecânica dele é verificada por
  `tools/spec-lint` no `pnpm test`.
- Quem foi conferir cada requisito está em [`RASTREABILIDADE.md`](RASTREABILIDADE.md)
  (gerado por `pnpm spec:report`): código e teste citam o id do requisito, e o relatório
  lê essas citações de volta.
- **MVP global**: o grupo joga uma sessão de PF2e com mapa+grid, tokens com movimento, visão/iluminação/fog básicos, fichas funcionais, rolagens automatizadas básicas, chat e combat tracker.

## Índice

| #   | Spec                                                                 | Tema                                            |
| --- | -------------------------------------------------------------------- | ----------------------------------------------- |
| 00  | [Visão e Escopo](00-visao-e-escopo.md)                               | Por quê, objetivos, não-objetivos, princípios   |
| 01  | [Arquitetura Geral](01-arquitetura-geral.md)                         | Componentes, processos, boot, configuração      |
| 02  | [Modelo de Dados](02-modelo-de-dados.md)                             | Documents, schemas, ownership, CRUD             |
| 03  | [Persistência e Mundos](03-persistencia-e-mundos.md)                 | SQLite, layout em disco, export/import          |
| 04  | [Rede e Sincronização](04-rede-e-sincronizacao.md)                   | Protocolo WS, autoridade, reconexão, presença   |
| 05  | [Usuários e Permissões](05-usuarios-e-permissoes.md)                 | Roles, matriz de permissões, login              |
| 06  | [Canvas e Renderização](06-canvas-e-renderizacao.md)                 | PIXI, camadas, grid, tokens, templates          |
| 07  | [Visão, Iluminação e Fog](07-visao-iluminacao-fog.md)                | Walls, visibility polygon, luzes, fog of war    |
| 08  | [Motor de Rolagens](08-motor-de-rolagens.md)                         | Sintaxe, RNG no servidor, roll modes, dados 3D  |
| 09  | [Chat e Mensagens](09-chat-e-mensagens.md)                           | Mensagens, comandos, chat cards declarativos    |
| 10  | [Combate e Iniciativa](10-combate-e-iniciativa.md)                   | Encounters, iniciativa por sistema, turnos      |
| 11  | [UI Framework e Fichas](11-ui-framework-e-fichas.md)                 | Window manager, sheets Svelte, theming, i18n    |
| 12  | [Journal, Tabelas e Cartas](12-journal-tabelas-cartas.md)            | Journals, @links, roll tables                   |
| 13  | [Áudio e Playlists](13-audio-e-playlists.md)                         | Playlists, canais, ambient sounds               |
| 14  | [Macros e Automação](14-macros-e-automacao.md)                       | Macros, hotbar, ações declarativas, game time   |
| 15  | [API de Sistemas](15-api-de-sistemas.md)                             | Contrato engine↔sistema, motor de modifiers     |
| 16  | [Compendiums e Importação](16-compendiums-e-importacao.md)           | Packs, browser, importer pf2e                   |
| 17  | [Sistema Pathfinder 2e](17-sistema-pf2e.md)                          | Engine 2e, automação, fichas, cobertura         |
| 18  | [Sistema Starfinder 2e](18-sistema-sf2e.md)                          | Deltas sobre a engine 2e                        |
| 19  | [Sistema Etmos](19-sistema-etmos.md)                                 | Compositor de magias, Partículas, Marcos        |
| 20  | [Assets e Mídia](20-assets-e-midia.md)                               | Upload, storage, serving, browser de assets     |
| 21  | [Segurança](21-seguranca.md)                                         | Threat model, auth, sanitização, exposição      |
| 22  | [Instalação e Distribuição](22-instalacao-e-distribuicao.md)         | Executável, setup, auto-update, túneis          |
| 23  | [Acessibilidade e Dispositivos](23-acessibilidade-e-dispositivos.md) | A11y, tablets/touch                             |
| 24  | [Operação, Backups e Telemetria](24-operacao-backups-telemetria.md)  | Backups, logs, diagnóstico                      |
| 25  | [Testes e Qualidade](25-testes-e-qualidade.md)                       | Pirâmide de testes, golden tests 2e, CI         |
| 26  | [Licenças e Legal](26-licencas-e-legal.md)                           | Clean-room, ORC/OGL, marcas, Etmos              |
| 27  | [Roadmap e Milestones](27-roadmap-e-milestones.md)                   | Fases, dependências, definition of done         |
| 28  | [Hub do Jogador](28-hub-do-jogador.md)                               | System Window, missões, comitiva, mapa          |
| 29  | [Pets, Companions e Familiars](29-pets-companions-familiars.md)      | Familiars, animal companions, pets, mounts      |
| 30  | [Multiclasse por Níveis](30-multiclasse-por-niveis.md)               | Regra variante: níveis de classe divididos      |
| 31  | [Base Canônica de Conteúdo](31-base-canonica-de-conteudo.md)         | Segunda fonte, eixos de sub-escolha, portões    |
| 32  | [Minimapa Tático](32-minimapa-tatico.md)                             | Overview da cena ativa, navegação de câmera     |
| 34  | [Mapa de Região](34-mapa-de-regiao.md)                               | Exploração em km, POIs reveláveis, overlays     |
| 35  | [Avatar do Personagem](35-avatar-do-personagem.md)                   | Boneco LPC montável, canto da mesa, acervo pin  |
| 36  | [Gaveta Lateral](36-gaveta-lateral.md)                               | Trilho só-ícone, gaveta, registro de abas (mãe) |

## Níveis

Os documentos desta pasta não são todos da mesma espécie (ver [`CONVENCOES.md`](CONVENCOES.md) §3):

| Nível       | Quais      | Papel                                                                 |
| ----------- | ---------- | --------------------------------------------------------------------- |
| **Charter** | `00`, `27` | Por quê, para quem, linhas vermelhas; fases e ordem de entrega.       |
| **Área**    | `01`–`26`  | O sistema fatiado por subsistema. Nível default.                      |
| **Recorte** | `28`+      | Feature que atravessa várias áreas; cita as áreas, nunca as redefine. |

## Registro de áreas (prefixos)

Cada spec é dona de **exatamente uma área**, e cada área tem **exatamente uma spec dona**.
Só a dona define ids daquela área — as demais citam. Esta tabela é a fonte de verdade lida
pelo `tools/spec-lint`; alterá-la sem mover os requisitos correspondentes quebra o teste.

<!-- prefixos:start -->

| Prefixo     | Spec dona                                 | Área                               |
| ----------- | ----------------------------------------- | ---------------------------------- |
| `REQ-ESC-`  | [00](00-visao-e-escopo.md)                | Visão, escopo e linhas vermelhas   |
| `REQ-ARQ-`  | [01](01-arquitetura-geral.md)             | Arquitetura geral                  |
| `REQ-DOC-`  | [02](02-modelo-de-dados.md)               | Documents e modelo de dados        |
| `REQ-PER-`  | [03](03-persistencia-e-mundos.md)         | Persistência e mundos              |
| `REQ-NET-`  | [04](04-rede-e-sincronizacao.md)          | Rede e sincronização               |
| `REQ-USR-`  | [05](05-usuarios-e-permissoes.md)         | Usuários e permissões              |
| `REQ-CNV-`  | [06](06-canvas-e-renderizacao.md)         | Canvas e renderização              |
| `REQ-VIS-`  | [07](07-visao-iluminacao-fog.md)          | Visão, iluminação e fog            |
| `REQ-ROL-`  | [08](08-motor-de-rolagens.md)             | Motor de rolagens                  |
| `REQ-CHT-`  | [09](09-chat-e-mensagens.md)              | Chat e mensagens                   |
| `REQ-CBT-`  | [10](10-combate-e-iniciativa.md)          | Combate e iniciativa               |
| `REQ-UIF-`  | [11](11-ui-framework-e-fichas.md)         | UI framework e fichas              |
| `REQ-JRN-`  | [12](12-journal-tabelas-cartas.md)        | Journal, tabelas e cartas          |
| `REQ-AUD-`  | [13](13-audio-e-playlists.md)             | Áudio e playlists                  |
| `REQ-MAC-`  | [14](14-macros-e-automacao.md)            | Macros e automação                 |
| `REQ-SYS-`  | [15](15-api-de-sistemas.md)               | API de sistemas                    |
| `REQ-CMP-`  | [16](16-compendiums-e-importacao.md)      | Compendiums e importação           |
| `REQ-PF2-`  | [17](17-sistema-pf2e.md)                  | Sistema Pathfinder 2e              |
| `REQ-SF2-`  | [18](18-sistema-sf2e.md)                  | Sistema Starfinder 2e              |
| `REQ-ETM-`  | [19](19-sistema-etmos.md)                 | Sistema Etmos                      |
| `REQ-AST-`  | [20](20-assets-e-midia.md)                | Assets e mídia                     |
| `REQ-SEC-`  | [21](21-seguranca.md)                     | Segurança                          |
| `REQ-DST-`  | [22](22-instalacao-e-distribuicao.md)     | Instalação e distribuição          |
| `REQ-A11-`  | [23](23-acessibilidade-e-dispositivos.md) | Acessibilidade e dispositivos      |
| `REQ-OPS-`  | [24](24-operacao-backups-telemetria.md)   | Operação, backups e telemetria     |
| `REQ-TST-`  | [25](25-testes-e-qualidade.md)            | Testes e qualidade                 |
| `REQ-LEG-`  | [26](26-licencas-e-legal.md)              | Licenças e legal                   |
| `REQ-ROD-`  | [27](27-roadmap-e-milestones.md)          | Roadmap e milestones               |
| `REQ-HUB-`  | [28](28-hub-do-jogador.md)                | Hub do jogador                     |
| `REQ-PET-`  | [29](29-pets-companions-familiars.md)     | Pets, companions e familiars       |
| `REQ-MCL-`  | [30](30-multiclasse-por-niveis.md)        | Multiclasse por níveis             |
| `REQ-BC-`   | [31](31-base-canonica-de-conteudo.md)     | Base canônica de conteúdo          |
| `REQ-MMT-`  | [32](32-minimapa-tatico.md)               | Minimapa tático                    |
| `REQ-MREG-` | [34](34-mapa-de-regiao.md)                | Mapa de região                     |
| `REQ-AVT-`  | [35](35-avatar-do-personagem.md)          | Avatar do personagem               |
| `REQ-GAV-`  | [36](36-gaveta-lateral.md)                | Gaveta lateral (spec-mãe das abas) |
| `REQ-CFG-`  | [37](37-configuracoes.md)                 | Configurações (aba da gaveta)      |

<!-- prefixos:end -->

Número reservado e ainda não escrito: **33** (Motor de Campanha — relógios de missão, frentes, autoria).

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
