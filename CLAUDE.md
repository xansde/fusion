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
