# Fusion

VTT (virtual tabletop) web próprio, inspirado no comportamento do Foundry VTT, construído em **clean-room**. Servidor local na máquina do GM; jogadores conectam pelo navegador. Sistemas-alvo: Pathfinder 2e (remaster), Starfinder 2e e Etmos RPG.

## Regras inegociáveis

- **Clean-room**: NUNCA copiar código, assets ou textos proprietários do Foundry VTT. Estudar comportamento e docs públicas é permitido. Código do repo open-source `foundryvtt/pf2e` (Apache-2.0) pode ser usado como referência com atribuição.
- **`docs/etmos-fontes/` jamais vai para repositório remoto** (material com copyright da Editora Balde Galáctico; já está no `.gitignore`). Uso privado do grupo.
- Arte/ícones da Paizo são proibidos nos packs importados — usar placeholders/ícones livres.

## Fonte de verdade

- `specs/` — especificações completas (índice em `specs/README.md`). Implementação segue as specs.
- `docs/research/` — pesquisa que fundamenta as specs (21 docs sobre Foundry, PF2e, SF2e, Etmos, licenças, bibliotecas).

## Branches

**Duas linhas paralelas**, sem relação de ancestralidade entre elas: divergiram do estado pré-mapa (`ab4966f`, 02/08) e não convergem. Nenhum merge entre as duas acontece sem instrução explícita do Alexandre.

### Linha geral do projeto — `build/app` e `main`

- **`build/app`** é a branch de integração de uso geral, e é onde vive a onda de mapa/hub/quest board (a partir de 07/08). Não apagar, não mergear nela, não trabalhar nela sem combinar.
- **`main`** é o espelho publicável, alimentado por `build/app`. Push nela exige instrução literal do Alexandre.

### Linha pessoal do Alexandre — `alfa/app`, `beta/app`, `stable/app`

**Não são o fluxo oficial do projeto e não são de uso geral: só o Alexandre opera nelas.** Estado pré-mapa (sem a onda de mapa/hub) + os fixes do r24 (#67, #70, #74, #75, #91, #92, antecedente-perícias) cherry-pickados.

- **`alfa/app`** — onde o trabalho entra e onde se espera que quebre. Toda branch de trabalho parte dela (`git fetch origin` antes; nunca do checkout local) e volta por PR.
- **`beta/app`** — onde o Alexandre testa antes de promover: recebe merge de `alfa/app` com a suíte verde.
- **`stable/app`** — o app pronto para jogo: só recebe merge de `beta/app` depois de validado na mesa. Nunca recebe trabalho direto.
- Promoção (`alfa→beta`, `beta→stable`) é sempre ato humano; nada de push direto em `beta`/`stable`.

## Stack

TypeScript estrito · Node.js 22+ · monorepo pnpm · Fastify + socket.io v4 (servidor autoritativo) · better-sqlite3 · Svelte 5 (Runes) + Vite · PIXI.js v8 · @dice-roller/rpg-dice-roller (RNG no servidor) · @3d-dice/dice-box · clipper2-ts + honeycomb-grid · TipTap · Howler.js · Tauri v2 (fase 2).

Monorepo planejado: `packages/{server,client,shared,system-api}` + `systems/{engine-2e,pf2e,sf2e,etmos}` + `tools/importer-pf2e`. `systems/engine-2e` é o núcleo de regras 2e compartilhado entre PF2e e SF2e. Porta default: 33000.

## Convenções

- Código, comentários e identificadores em inglês; docs/specs em pt-BR.
- Conventional commits (feat:, fix:, refactor:, docs:, chore:, test:).
- Requisitos das specs: `REQ-<PREFIXO>-NNN`, tags [MVP]/[V2].
- Sistemas de jogo são pacotes compilados no monorepo (sem plugins dinâmicos no MVP).
- Rolagens sempre executam no servidor (anti-cheat); toda validação de permissão é no servidor.
- Redação de visibilidade (hidden tokens, roll modes) usa SEMPRE `packages/server/src/net/redaction.ts` + `isRolePrivileged` de `documents/ownership.ts` — nunca duplicar predicados/strip.
- Testes do server: pool forks/maxForks 4 (better-sqlite3 crasha em worker_threads). Saída não-zero com "Timeout calling onTaskUpdate" sem teste falhando = flakiness de infra do vitest sob carga; re-rodar o arquivo isolado antes de tratar como regressão.
- **Nunca hardcode porta em teste.** Os arquivos rodam em paralelo, então literal colide (EADDRINUSE) e derruba o CI sem defeito nenhum no código. Use `packages/server/src/__tests__/helpers/ports.ts`: `reserveFreePort()` para bootar, `listeningPort()` para nomear a porta em asserção/payload, `holdPort()` quando o teste exigir duas portas distintas. Bootar em `port: 0` **não** funciona: `boot()` injeta `currentPort: config.port` nas rotas admin antes do `listen()`, e o servidor passa a dar 409 contra a própria porta.

## Resolução de @fusion/shared entre pacotes (decisão arquitetural)

Cada pacote resolve `@fusion/shared` de forma diferente por design:

| Pacote          | Estratégia                      | Motivo                                                    |
| --------------- | ------------------------------- | --------------------------------------------------------- |
| `system-api`    | `paths` → `shared/src/index.ts` | compila junto com shared; sem dependência de build prévia |
| `server`        | `node_modules` → `shared/dist/` | precisa de ESM real com `.js` extensions (NodeNext)       |
| `client`        | Vite alias                      | Vite resolve TypeScript diretamente; `noEmit: true`       |
| `boundary-test` | `paths` → `shared/src/index.ts` | ferramenta de análise, não emite                          |

Ordem de build obrigatória: `@fusion/shared` antes de `@fusion/server`. O script `pnpm build` no root garante isso via `-r` (topological order do pnpm workspaces).
