# Fusion

VTT (virtual tabletop) web próprio, inspirado no comportamento do Foundry VTT, construído em **clean-room**. Servidor local na máquina do GM; jogadores conectam pelo navegador. Sistemas-alvo: Pathfinder 2e (remaster), Starfinder 2e e Etmos RPG.

## Regras inegociáveis

- **Clean-room**: NUNCA copiar código, assets ou textos proprietários do Foundry VTT. Estudar comportamento e docs públicas é permitido. Código do repo open-source `foundryvtt/pf2e` (Apache-2.0) pode ser usado como referência com atribuição.
- **`docs/etmos-fontes/` jamais vai para repositório remoto** (material com copyright da Editora Balde Galáctico; já está no `.gitignore`). Uso privado do grupo.
- Arte/ícones da Paizo são proibidos nos packs importados — usar placeholders/ícones livres.

## Fonte de verdade

- `specs/` — especificações completas (índice em `specs/README.md`). Implementação segue as specs.
- `docs/research/` — pesquisa que fundamenta as specs (21 docs sobre Foundry, PF2e, SF2e, Etmos, licenças, bibliotecas).

## Stack

TypeScript estrito · Node.js 22+ · monorepo pnpm · Fastify + socket.io v4 (servidor autoritativo) · better-sqlite3 · Svelte 5 (Runes) + Vite · PIXI.js v8 · @dice-roller/rpg-dice-roller (RNG no servidor) · @3d-dice/dice-box · clipper2-ts + honeycomb-grid · TipTap · Howler.js · Tauri v2 (fase 2).

Monorepo planejado: `packages/{server,client,shared,system-api}` + `systems/{engine-2e,pf2e,sf2e,etmos}` + `tools/importer-pf2e`. `systems/engine-2e` é o núcleo de regras 2e compartilhado entre PF2e e SF2e. Porta default: 33000.

## Convenções

- Código, comentários e identificadores em inglês; docs/specs em pt-BR.
- Conventional commits (feat:, fix:, refactor:, docs:, chore:, test:).
- Requisitos das specs: `REQ-<PREFIXO>-NNN`, tags [MVP]/[V2].
- Sistemas de jogo são pacotes compilados no monorepo (sem plugins dinâmicos no MVP).
- Rolagens sempre executam no servidor (anti-cheat); toda validação de permissão é no servidor.
- Redação de visibilidade (hidden tokens, hidden tiles, secret doors, roll modes) usa SEMPRE `packages/server/src/net/redaction.ts` + `isRolePrivileged` de `documents/ownership.ts` — nunca duplicar predicados/strip. São **quatro** caminhos de emissão a cobrir: snapshot, broadcast, replay de delta e o eco do ack.
- Os schemas de documento do servidor (`packages/server/src/documents/types.ts`) usam `.extend()` sem `.passthrough()`: **campo não declarado é apagado silenciosamente em toda escrita**. Ao adicionar campo ao `@fusion/shared`, declarar também no schema do servidor — e **importando o schema compartilhado**, nunca uma segunda cópia. Foi assim que `grid` sumiu de toda cena por rodadas (ver `docs/lessons.md`). Ainda descartados hoje: `initialView`, `thumb`, `navName`, `playlistId`, `journalId`.
- Testes do server: pool forks/maxForks 4 (better-sqlite3 crasha em worker_threads). Saída não-zero com "Timeout calling onTaskUpdate" sem teste falhando = flakiness de infra do vitest sob carga; re-rodar o arquivo isolado antes de tratar como regressão.

## Resolução de @fusion/shared entre pacotes (decisão arquitetural)

Cada pacote resolve `@fusion/shared` de forma diferente por design:

| Pacote          | Estratégia                      | Motivo                                                    |
| --------------- | ------------------------------- | --------------------------------------------------------- |
| `system-api`    | `paths` → `shared/src/index.ts` | compila junto com shared; sem dependência de build prévia |
| `server`        | `node_modules` → `shared/dist/` | precisa de ESM real com `.js` extensions (NodeNext)       |
| `client`        | Vite alias                      | Vite resolve TypeScript diretamente; `noEmit: true`       |
| `boundary-test` | `paths` → `shared/src/index.ts` | ferramenta de análise, não emite                          |

Ordem de build obrigatória: `@fusion/shared` antes de `@fusion/server`. O script `pnpm build` no root garante isso via `-r` (topological order do pnpm workspaces).
