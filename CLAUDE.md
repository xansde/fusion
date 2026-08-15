# Fusion

VTT (virtual tabletop) web próprio, inspirado no comportamento do Foundry VTT, construído em **clean-room**. Servidor local na máquina do GM; jogadores conectam pelo navegador. Sistemas-alvo: Pathfinder 2e (remaster), Starfinder 2e e Etmos RPG.

## Regras inegociáveis

- **Clean-room**: NUNCA copiar código, assets ou textos proprietários do Foundry VTT. Estudar comportamento e docs públicas é permitido. Código do repo open-source `foundryvtt/pf2e` (Apache-2.0) pode ser usado como referência com atribuição.
- **`docs/etmos-fontes/` jamais vai para repositório remoto** (material com copyright da Editora Balde Galáctico; já está no `.gitignore`). Uso privado do grupo.
- Arte/ícones da Paizo são proibidos nos packs importados — usar placeholders/ícones livres.

## Fonte de verdade

- `specs/` — especificações completas (índice em `specs/README.md`). Implementação segue as specs.
- `docs/research/` — pesquisa que fundamenta as specs (21 docs sobre Foundry, PF2e, SF2e, Etmos, licenças, bibliotecas).

## Branches (modelo alfa → beta → stable, desde 2026-08-15)

- **`alfa/app`** — desenvolvimento e experimentação: é onde rodam os testes e onde se espera que tudo quebre. Toda branch de trabalho parte dela (`git fetch origin` antes; nunca do checkout local) e volta para ela por PR.
- **`beta/app`** — onde o Alexandre testa antes de promover: recebe merge de `alfa/app` quando um conjunto está íntegro (suíte verde + teste ao vivo).
- **`stable/app`** — o app de verdade, pronto para jogo: só recebe merge de `beta/app` depois de validado na mesa. Nunca recebe trabalho direto.
- **`build/app`** — linha do **Mario**: ele segue trabalhando nela com as atualizações que ELE quer. Não é integração nossa, não apagar, não mergear nela sem combinar; `alfa/app` nasceu dela em 13/08. **`main`** é o espelho publicável e só recebe merge com instrução literal do Alexandre.
- Nascimento: `stable/app` = `beta/app` = estado pré-mapa de `build/app` (`ab4966f`, 02/08) + os fixes do r24 (#67, #70, #74, #75, #91, #92, antecedente-perícias) cherry-pickados; `alfa/app` = ponta de `build/app` em 13/08 (toda a onda de mapa/hub/quest board a partir de 07/08 vive só ali).
- Promoção é sempre ato humano (merge `alfa→beta` e `beta→stable`); nada de push direto em `beta`/`stable`.

## Setup e execução (o passo a passo verificado está no README)

```bash
pnpm install && pnpm build                                   # Node 22+, pnpm 11+
node packages/server/dist/cli/index.js world create <slug> --system pf2e   # --system é obrigatório
node packages/server/dist/cli/index.js serve --world <slug>
```

- O binário do CLI é `packages/server/dist/cli/index.js` (`dist/index.js` reexporta o mesmo CLI).
- Ids de sistema válidos: `pf2e`, `sf2e`, `etmos`, `stub`.
- `world create` imprime a senha do GM **uma única vez** e ela não é recuperável — capturar na hora ou passar `--gm-password`.
- Dev do client exige os dois processos no ar: `serve` na 33000 + `pnpm --filter @fusion/client dev` (Vite na 5173, com proxy de `/api` e `/socket.io`). Abrir a 5173, não a 33000.
- Os packs (`systems/*/packs/`) são versionados: não há passo de geração de conteúdo depois do clone.

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
- **Nunca hardcode porta em teste.** Os arquivos rodam em paralelo, então literal colide (EADDRINUSE) e derruba o CI sem defeito nenhum no código. Use `packages/server/src/__tests__/helpers/ports.ts`: `reserveFreePort()` para bootar, `listeningPort()` para nomear a porta em asserção/payload, `holdPort()` quando o teste exigir duas portas distintas. Bootar em `port: 0` **não** funciona: `boot()` injeta `currentPort: config.port` nas rotas admin antes do `listen()`, e o servidor passa a dar 409 contra a própria porta.
- **`fusion serve` manual (fora de teste) na porta default 33000 + `--data-dir` padrão (`~/.fusion`) é "o mundo ao vivo".** Sessões/worktrees Claude Code diferentes rodando ao mesmo tempo (dev, verificação, exploração) não têm como se coordenar entre si — cada uma só enxerga seus próprios processos. Se uma sessão sobe `fusion serve` na porta 33000 apontando pro `~/.fusion` compartilhado enquanto outra está com um mundo real em jogo/túnel público ali, a segunda derruba a primeira sem aviso (visto em 2026-08-08, sessão do túnel do mundo Isekai caindo duas vezes por causa de uma verificação em outra worktree). Regra: **serve de teste/exploração usa porta não-default (33001+, ou `reserveFreePort()`) e `--data-dir` isolado da worktree** (scratchpad/`.fusion-x`); só o servidor que é de fato "a mesa rodando agora" fica no 33000+`~/.fusion`, e mesmo esse — se for exposto por túnel público durante uma sessão de jogo real — é mais seguro subir numa porta não-default para não competir com o hábito comum de outras sessões testarem em 33000.

## Resolução de @fusion/shared entre pacotes (decisão arquitetural)

Cada pacote resolve `@fusion/shared` de forma diferente por design:

| Pacote          | Estratégia                      | Motivo                                                    |
| --------------- | ------------------------------- | --------------------------------------------------------- |
| `system-api`    | `paths` → `shared/src/index.ts` | compila junto com shared; sem dependência de build prévia |
| `server`        | `node_modules` → `shared/dist/` | precisa de ESM real com `.js` extensions (NodeNext)       |
| `client`        | Vite alias                      | Vite resolve TypeScript diretamente; `noEmit: true`       |
| `boundary-test` | `paths` → `shared/src/index.ts` | ferramenta de análise, não emite                          |

Ordem de build obrigatória: `@fusion/shared` antes de `@fusion/server`. O script `pnpm build` no root garante isso via `-r` (topological order do pnpm workspaces).
