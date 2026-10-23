# Contribuindo com o Fusion

Obrigado por ajudar. Este guia cobre o que você precisa no primeiro dia. As regras completas do projeto estão no [`CLAUDE.md`](CLAUDE.md) e no [README](README.md).

> **Este repositório é público.** Nunca commite segredo, token, `.env`, dado de mundo real (cópia de data-dir, banco `.sqlite`) nem material com copyright (ver "Regras inegociáveis").

## Regras inegociáveis

- **Clean-room.** Nunca copie código, assets ou textos proprietários do Foundry VTT. Estudar o comportamento e a documentação pública é permitido. O repositório `foundryvtt/pf2e` (Apache-2.0) pode servir de referência, **com atribuição** no comentário.
- **`docs/etmos-fontes/` jamais vai para repositório remoto.** É material com copyright da Editora Balde Galáctico, de uso privado do grupo (já está no `.gitignore`). Se o diretório aparecer no seu `git status`, pare e avise.
- **Sem arte ou ícones da Paizo** nos packs. Use placeholders ou ícones de licença livre.
- **O servidor é autoritativo.** Rolagens executam no servidor e toda validação de permissão acontece no servidor. Não mova decisão de regra para o client.

## Pré-requisitos

| Ferramenta | Versão                            |
| ---------- | --------------------------------- |
| Node.js    | 22+                               |
| pnpm       | 11+                               |
| git        | recente, com suporte a submódulos |

O `pnpm install` compila `better-sqlite3`, então é preciso toolchain C++ (no Windows, o Visual Studio Build Tools; no Linux, `build-essential`).

### Acesso ao satélite privado

A ficha e os sistemas PF2e/SF2e vivem no repositório **privado** `xansde/fusion-systems-2e`, que entra aqui como submódulo em `external/fusion-systems-2e/`. Para clonar você precisa **aceitar o convite de colaborador** dele no GitHub e estar autenticado (`gh auth login` ou credencial do Git).

## Primeiro dia

```bash
git clone --recurse-submodules https://github.com/xansde/fusion.git
cd fusion
git checkout alfa/app

# se external/fusion-systems-2e aparecer vazio (clone sem --recurse-submodules,
# ou depois de trocar de branch):
git submodule update --init

pnpm install
pnpm build          # ordem topológica: shared → system-api → systems → client → server
node packages/server/dist/index.js serve
```

O servidor sobe em `http://localhost:33000` (porta default). No primeiro uso, abra `/setup` para o assistente. Para abrir um mundo existente direto: `node packages/server/dist/index.js serve --world <slug>`. Outras opções (`--port`, `--data-dir`, `--no-open`) estão no README.

Para desenvolver o client com HMR: `pnpm --filter @fusion/client dev`.

Dica: depois de trocar de branch ou de puxar mudanças que mexam no submódulo, rode `git submodule update --init` de novo.

## Fluxo de branch e PR

O core tem duas linhas de branches. **Colaboradores trabalham só na linha `alfa/app`.**

1. `git fetch origin` (sempre — nunca parta do seu checkout local, que pode estar centenas de commits atrás).
2. Crie a branch a partir de `origin/alfa/app`: `git switch -c feat/minha-mudanca origin/alfa/app`.
3. Faça a mudança, com teste. Commits pequenos.
4. Rode os gates (abaixo) e abra o **PR para `alfa/app`**.
5. Review e merge seguem o combinado com o Alexandre.

Regras de branch:

- **`beta/app` e `stable/app`**: promoção (`alfa→beta`, `beta→stable`) é exclusiva do Alexandre. Ninguém faz push direto nelas.
- **`main` e `build/app`** (a linha do mapa/hub) **não recebem trabalho de colaborador**. Não abra PR nem faça push nelas.
- **Sem `git push --force`** em branch compartilhada e **sem `--no-verify`**: se um hook falhar, corrija a causa.
- Abra uma issue antes de mudanças não triviais; alinhar o desenho antes evita retrabalho.

### Commits e PRs

- **Conventional commits**: tipo em inglês, descrição em pt-BR. Ex.: `feat: adiciona rolagem de iniciativa em grupo`, `fix: corrige redação de token escondido`. Tipos: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.
- **PRs pequenos e revisáveis.** Um diff gigante não recebe review de verdade.
- PR de UI segue [`docs/design/PROCESSO-UI.md`](docs/design/PROCESSO-UI.md): lente de protótipo na revisão, roteiro `tutorial-e2e` com prints olhados, print protótipo × tela no PR, smoke como GM e como player.

## Gates

Rode antes de abrir o PR (é o que o CI cobra):

```bash
pnpm build
pnpm typecheck
pnpm format:check
pnpm lint
pnpm lint:boundaries
pnpm test
```

`pnpm format` e `pnpm lint --fix` corrigem a maior parte do que `format:check` e `lint` apontam. O ESLint roda com `strictTypeChecked`: evite `!` e casts largos; estreite o tipo de verdade.

### Testes direcionados

A suíte inteira é grande (~3,7 mil testes). Durante o desenvolvimento rode só o que você mexeu e deixe a suíte completa para o fim:

```bash
pnpm test --project server --project server-isolated        # só o server
pnpm exec vitest run --workspace vitest.workspace.ts <caminho/do/arquivo.test.ts>
```

Ao escrever teste:

- Teste comportamento, não implementação. Código de produção novo (funcionalidade, correção, endpoint, regra) entra com teste.
- Os testes do server rodam em pool `forks` com `maxForks 4` (o `better-sqlite3` quebra em worker threads). Saída não-zero com `Timeout calling "onTaskUpdate"` **sem nenhum teste falhando** é instabilidade do vitest sob carga: rode o arquivo isolado antes de tratar como regressão.
- Arquivo de teste do server que troca registro de módulo, usa `vi.mock`/`vi.doMock` ou processo filho vai na lista de `packages/server/vitest.isolation.ts` (o teste `isolation-list` falha se faltar). Para processo filho use `helpers/run-cli.ts`, nunca `spawnSync`.
- **Nunca hardcode porta em teste** — os arquivos rodam em paralelo e o literal colide (`EADDRINUSE`). Use os helpers em `packages/server/src/__tests__/helpers/ports.ts`: `reserveFreePort()` para bootar, `listeningPort()` para nomear a porta em asserção, `holdPort()` quando precisar de duas portas distintas. Bootar em `port: 0` não funciona.

## Onde está a verdade

- [`specs/`](specs/README.md) — especificações; a implementação segue as specs. Se divergir, discuta a spec, não esconda a divergência no código. Requisitos são citados como `REQ-<PREFIXO>-NNN`.
- `docs/research/` — pesquisa que fundamenta as specs.
- [`docs/design/PROCESSO-UI.md`](docs/design/PROCESSO-UI.md) — processo de PR de UI.

Pontos que o review cobra:

- **Redação de visibilidade** (tokens escondidos, roll modes) usa sempre `packages/server/src/net/redaction.ts` e `isRolePrivileged` de `documents/ownership.ts`. Não duplique predicados nem lógica de strip.
- **Sistemas de jogo são pacotes compilados** do monorepo; não há plugin dinâmico no MVP.
- **Join de conteúdo de compêndio é sempre por nome normalizado** — `slug` não existe nos dados.
- Código, comentários e identificadores em **inglês**; docs e specs em **pt-BR**.

## Mudança que cruza core e satélite

Se a mudança toca `external/fusion-systems-2e` (ficha, sistemas, packs, importadores):

1. Abra o PR no **satélite** `xansde/fusion-systems-2e` (para a `main` dele) — veja o `CONTRIBUTING.md` de lá.
2. Depois do merge, abra um PR **no core, para `alfa/app`**, que só sobe o pin do submódulo:

```bash
cd external/fusion-systems-2e
git fetch --tags origin
git checkout <tag-ou-commit-do-satelite>   # ex.: v0.3.9
cd ../..
git add external/fusion-systems-2e
git commit -m "chore: sobe fusion-systems-2e para <tag-ou-commit>"
```

O mesmo vale para o pacote de avatar (`xansde/fusion-avatar`): PR na `main` dele, depois bump da tag no core.

## Usando Claude Code neste repo

O [`CLAUDE.md`](CLAUDE.md) é carregado automaticamente pelo Claude Code e traz as regras inegociáveis, o fluxo de branches, a stack e as convenções acima — o agente já parte dele. Pontos de atenção:

- `.claude/skills/` contém skills compartilhadas do projeto (versionadas). Configuração **pessoal** (`.claude/settings.local.json`, worktrees, `launch.json`) não se commita.
- `.fusion-build/` guarda o material de planejamento e rodadas do projeto: não adicione nele saídas locais, dados de mundo ou cópias de data-dir (partes dele já estão no `.gitignore`).
- `.e2e-visual/` (saída do `tutorial-e2e`, com prints) e `test-results/` são ignorados — não force o add.
- Revise o que o agente commitou: `git status` limpo de arquivos soltos (`*.yaml`, `*.png` de debug) antes do PR.

## Reportando bugs

Inclua: o que você esperava, o que aconteceu, como reproduzir e o sistema de jogo/mundo envolvido. O log do servidor sai em JSON estruturado no stdout e ajuda muito.
