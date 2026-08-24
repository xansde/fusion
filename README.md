# Fusion

VTT (virtual tabletop) web próprio, construído em **clean-room** e inspirado no comportamento do Foundry VTT. O servidor roda na máquina do GM; os jogadores conectam pelo navegador.

Sistemas de jogo suportados: **Pathfinder 2e (remaster)** e **Starfinder 2e**. (Etmos RPG: legado, vive na linha `build/app`.)

## Pré-requisitos

| Ferramenta | Versão |
| ---------- | ------ |
| Node.js    | 22+    |
| pnpm       | 11+    |

O `pnpm install` compila dependências nativas (`better-sqlite3`), então é preciso ter um toolchain de build C++ disponível — no Windows, o que vem com o Visual Studio Build Tools; no Linux, `build-essential`.

## Rodando

`external/fusion-systems-2e` é um git submodule (F4, DEC-SEP-09) — `git clone` sozinho não o traz. Depois de clonar (ou a qualquer momento em que ele apareça vazio):

```bash
git submodule update --init
```

```bash
pnpm install
pnpm build          # ordem topológica: shared → system-api → systems → client → server
node packages/server/dist/index.js serve
```

Para dar bump no ponto do submodule (nova tag do `fusion-systems-2e`):

```bash
cd external/fusion-systems-2e
git fetch --tags
git checkout v0.x.y
cd ../..
git add external/fusion-systems-2e
git commit -m "chore: bump fusion-systems-2e para v0.x.y"
```

O servidor sobe em `http://localhost:33000`. No primeiro uso, abra `/setup` para o assistente de configuração.

Para abrir um mundo já existente direto no boot:

```bash
node packages/server/dist/index.js serve --world <slug>
```

O mundo fica disponível em `http://localhost:33000/world/<slug>`.

### CLI do servidor

```
fusion serve                  Sobe o servidor
  --port <n>                  Porta TCP (default: 33000)
  --data-dir <path>           Diretório de dados
  --world <slug>              Abre este mundo no boot
  --tunnel                    Expõe o servidor via Cloudflare quick tunnel
  --no-open                   Não abre o assistente de setup no navegador

fusion world list             Lista os mundos do diretório de dados
fusion world create <slug>    Cria um mundo
fusion world backup <slug>    Backup manual de um mundo
fusion user add <world> <name>
```

### Desenvolvimento

O client tem dev server com HMR:

```bash
pnpm --filter @fusion/client dev
```

## Verificação

Os mesmos gates que o CI aplica:

```bash
pnpm typecheck        # tsc + svelte-check
pnpm lint             # eslint (strictTypeChecked)
pnpm format:check     # prettier
pnpm test             # vitest (~3.7k testes)
pnpm lint:boundaries  # dependency-cruiser (fronteiras entre pacotes)
```

## Estrutura

```
packages/
  shared/       Tipos, schemas Zod e protocolo compartilhados
  system-api/   Contrato que um sistema de jogo implementa
  server/       Fastify + socket.io + better-sqlite3 (autoritativo)
  client/       Svelte 5 (Runes) + Vite + PIXI.js v8
systems/
  stub/         Sistema de referência mínimo, fica no core
tools/
  release/  boundary-test/  spec-lint/
external/
  fusion-systems-2e/   Submodule (F4, DEC-SEP-09) — repo xansde/fusion-systems-2e
    systems/             engine-2e/  pf2e/  sf2e/
    sheets/              pf2e/ (@fusion/sheets-pf2e — a ficha PF2e, consumida pelo client)
    tools/               importer-pf2e/  translate-packs/
specs/          Especificações (fonte de verdade — índice em specs/README.md)
docs/research/  Pesquisa que fundamenta as specs
```

`systems/{pf2e,sf2e}`, os packs, a ficha PF2e e `tools/{importer-pf2e,translate-packs}` vivem no repo satélite `fusion-systems-2e` (F4, DEC-SEP-09) — consumido aqui como git submodule pinado por tag, não por cópia. O satélite tem CI próprio (clona este repo raso no ref pinado e monta o mesmo overlay de workspace — ver `scripts/setup-core.sh` e `README.md`/`AGENTS.md` de lá).

### Resolução de `@fusion/shared`

Cada pacote resolve `@fusion/shared` de um jeito, por design:

| Pacote                         | Estratégia                                               | Motivo                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-api`                   | `paths` → `shared/src/index.ts`                          | compila junto com shared; não depende de build prévio                                                                                               |
| `server`                       | `node_modules` → `shared/dist/`                          | precisa de ESM real com extensões `.js` (NodeNext)                                                                                                  |
| `client`                       | alias do Vite                                            | Vite resolve TypeScript direto; `noEmit: true`                                                                                                      |
| `boundary-test`                | `paths` → `shared/src/index.ts`                          | ferramenta de análise, não emite                                                                                                                    |
| `external/fusion-systems-2e/*` | `node_modules` (workspace do submodule) → `shared/dist/` | mesmo mecanismo do `server` — o submodule entra no workspace pnpm do core (F4, DEC-SEP-09) e `@fusion/shared` builda antes dele na ordem topológica |

Por isso `@fusion/shared` **sempre** builda antes de `@fusion/server` — o `pnpm build` da raiz garante isso via ordem topológica do pnpm.

## Arquitetura, em uma frase

O servidor é autoritativo: rolagens são executadas nele (anti-cheat) e toda validação de permissão acontece nele. O client nunca é fonte de verdade sobre regras.

## Regras do projeto

- **Clean-room**: nunca copiar código, assets ou textos proprietários do Foundry VTT. Estudar comportamento e documentação pública é permitido. Código do repositório open-source `foundryvtt/pf2e` (Apache-2.0) pode ser usado como referência, com atribuição.
- Arte e ícones da Paizo não entram nos packs — usar placeholders ou ícones de licença livre.
- Material de terceiros com copyright fica fora do repositório (ver `.gitignore`).

## Contribuindo

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE).

A licença cobre o **código** deste repositório. Conteúdo de sistemas de jogo tem regime próprio: regras de Pathfinder 2e e Starfinder 2e são publicadas pela Paizo sob suas próprias licenças. (O material do Etmos RPG, de propriedade da Editora Balde Galáctico, pertence ao sistema legado — ver nota acima.) Ver `specs/26-licencas-e-legal.md`.
