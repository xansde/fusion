# Fusion

VTT (virtual tabletop) web próprio, construído em **clean-room** e inspirado no comportamento do Foundry VTT. O servidor roda na máquina do GM; os jogadores conectam pelo navegador.

Sistemas de jogo suportados: **Pathfinder 2e (remaster)**, **Starfinder 2e** e **Etmos RPG**.

## Pré-requisitos

| Ferramenta | Versão |
| ---------- | ------ |
| Node.js    | 22+    |
| pnpm       | 11+    |

O `pnpm install` compila dependências nativas (`better-sqlite3`), então é preciso ter um toolchain de build C++ disponível — no Windows, o que vem com o Visual Studio Build Tools; no Linux, `build-essential`.

## Rodando

```bash
pnpm install
pnpm build          # ordem topológica: shared → system-api → systems → client → server
node packages/server/dist/index.js serve
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
  engine-2e/    Núcleo de regras 2e, compartilhado entre PF2e e SF2e
  pf2e/  sf2e/  etmos/  stub/
tools/
  importer-pf2e/  translate-packs/  release/  boundary-test/
specs/          Especificações (fonte de verdade — índice em specs/README.md)
docs/research/  Pesquisa que fundamenta as specs
```

### Resolução de `@fusion/shared`

Cada pacote resolve `@fusion/shared` de um jeito, por design:

| Pacote          | Estratégia                      | Motivo                                                |
| --------------- | ------------------------------- | ----------------------------------------------------- |
| `system-api`    | `paths` → `shared/src/index.ts` | compila junto com shared; não depende de build prévio |
| `server`        | `node_modules` → `shared/dist/` | precisa de ESM real com extensões `.js` (NodeNext)    |
| `client`        | alias do Vite                   | Vite resolve TypeScript direto; `noEmit: true`        |
| `boundary-test` | `paths` → `shared/src/index.ts` | ferramenta de análise, não emite                      |

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

A licença cobre o **código** deste repositório. Conteúdo de sistemas de jogo tem regime próprio: regras de Pathfinder 2e e Starfinder 2e são publicadas pela Paizo sob suas próprias licenças, e o material do Etmos RPG pertence à Editora Balde Galáctico. Ver `specs/26-licencas-e-legal.md`.
