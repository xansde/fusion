# Fusion

VTT (virtual tabletop) web próprio, construído em **clean-room** e inspirado no comportamento do Foundry VTT. O servidor roda na máquina do GM; os jogadores conectam pelo navegador.

Sistemas de jogo suportados: **Pathfinder 2e (remaster)**, **Starfinder 2e** e **Etmos RPG**.

## Onde está o código

| Branch      | O que é                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `main`      | Espelho publicável da `build/app`. É o que um `git clone` entrega — sempre a versão íntegra e executável.      |
| `build/app` | **Branch de integração.** Todo trabalho parte dela e volta para ela por PR. É onde o desenvolvimento acontece. |

Para **rodar** o projeto, `main` basta. Para **contribuir**, parta de `build/app` (ver [CONTRIBUTING.md](CONTRIBUTING.md)).

## Instalando em uma máquina nova

### Pré-requisitos

| Ferramenta | Versão exigida | Como conferir |
| ---------- | -------------- | ------------- |
| Node.js    | 22 ou superior | `node -v`     |
| pnpm       | 11 ou superior | `pnpm -v`     |

São as mesmas versões que o CI usa (`.github/workflows/ci.yml`), e estão declaradas em `engines` no `package.json`. Se o `pnpm` não estiver instalado: `corepack enable && corepack prepare pnpm@11 --activate`.

O `pnpm install` compila dependências nativas (`better-sqlite3`), então é preciso ter um toolchain C++ disponível:

- **Windows**: "Desktop development with C++" do Visual Studio Build Tools.
- **Linux**: `build-essential` (Debian/Ubuntu) ou equivalente.
- **macOS**: `xcode-select --install`.

### Os quatro comandos

```bash
git clone https://github.com/xansde/fusion.git
cd fusion
pnpm install
pnpm build          # ordem topológica: shared → system-api → systems → client → server
```

O `pnpm build` compila os quatro pacotes e os quatro sistemas de jogo. Não há passo de geração de conteúdo: os compêndios (`systems/*/packs/`) são versionados e já vêm no clone.

### Criando o primeiro mundo

```bash
node packages/server/dist/cli/index.js world create meu_mundo --system pf2e --title "Minha Campanha"
```

O `--system` é **obrigatório** — os ids válidos são `pf2e`, `sf2e`, `etmos` e `stub`.

O comando imprime uma **senha de GM gerada aleatoriamente, mostrada uma única vez e impossível de recuperar depois**. Guarde-a antes de fechar o terminal. Para escolher a sua, passe `--gm-password <senha>`.

### Subindo o servidor

```bash
node packages/server/dist/cli/index.js serve --world meu_mundo
```

O mundo fica em `http://localhost:33000/world/meu_mundo`, e os jogadores entram pelo mesmo endereço na rede local (trocando `localhost` pelo IP da máquina do GM). Sem `--world`, o servidor sobe no assistente de configuração em `http://localhost:33000/setup`, que abre sozinho no navegador na primeira execução.

Para expor a mesa pela internet sem configurar roteador, `--tunnel` levanta um Cloudflare quick tunnel e imprime a URL pública (baixa o `cloudflared` na primeira vez).

### Onde ficam os dados

O diretório de dados guarda mundos, usuários e backups. O padrão depende do sistema operacional:

| SO      | Caminho padrão                               |
| ------- | -------------------------------------------- |
| Windows | `%USERPROFILE%\Documents\FusionVTT`          |
| macOS   | `~/Documents/FusionVTT`                      |
| Linux   | `$XDG_DATA_HOME/FusionVTT`, ou `~/FusionVTT` |

Se já existir um `~/.fusion` de uma versão anterior, ele continua sendo usado (fallback legado). Qualquer comando aceita `--data-dir <path>` para apontar outro lugar — é assim que se roda um servidor de teste sem tocar no mundo em jogo.

**Levar a campanha para outro PC** é copiar esse diretório: o mundo vive nele, não no repositório.

## CLI do servidor

O binário é `packages/server/dist/cli/index.js` (o `packages/server/dist/index.js` reexporta o mesmo CLI).

```
fusion serve                            Sobe o servidor
  --port <n>                            Porta TCP (default: 33000)
  --data-dir <path>                     Diretório de dados
  --world <slug>                        Abre este mundo no boot
  --log-level <level>                   trace|debug|info|warn|error|fatal|silent
  --tunnel                              Expõe o servidor via Cloudflare quick tunnel
  --no-open                             Não abre o assistente de setup no navegador

fusion world list                       Lista os mundos do diretório de dados
fusion world create <slug> --system <id>
  --title <text>                        Título legível (default: o slug)
  --gm-password <pwd>                   Senha do GM (default: gerada e impressa uma vez)
fusion world backup <slug>              Backup manual de um mundo
fusion user add <world> <name>          Cria um usuário no mundo
```

Todo comando aceita `--help`.

## Desenvolvimento

O client tem dev server com HMR. Ele **não substitui o servidor** — precisa dos dois rodando:

```bash
# terminal 1 — servidor de regras (autoritativo)
node packages/server/dist/cli/index.js serve --world meu_mundo

# terminal 2 — client com HMR
pnpm --filter @fusion/client dev
```

O Vite sobe em `http://localhost:5173` e faz proxy de `/api` e `/socket.io` para a porta 33000. Abra o `5173` no navegador, não o `33000`.

> **Rodando mais de um servidor na mesma máquina**: a porta 33000 com o data-dir padrão é "a mesa ao vivo". Um servidor de teste apontando para lá derruba a sessão em andamento sem aviso. Para testar, use sempre uma porta livre (`--port 33021`) **e** um `--data-dir` descartável.

### Executável standalone

Para distribuir o servidor a quem não tem Node instalado, `pnpm build:release` empacota tudo num binário único (Node SEA) em `dist-release/fusion-server-<versão>-<plataforma>-<arch>[.exe]`, e `pnpm smoke:release` confere o artefato.

> ⚠️ **O comando falha hoje** (verificado em 13/08/2026): o `.exe` é gerado com ~157,6 MB e a fase 7/8 aborta por estourar o teto de 150 MB da `REQ-DST-046`. O binário fica em `dist-release/` e é utilizável, mas o build sai com código de erro — não dá para usar em release automatizada até o tamanho baixar (comprimir os assets do client ou adotar o fallback zip-portable previsto no design DA-04).

Enquanto isso, o caminho suportado para outra máquina é o clone + `pnpm build` descrito acima.

## Verificação

Os mesmos gates que o CI aplica, na mesma ordem:

```bash
pnpm build
pnpm typecheck        # tsc + svelte-check
pnpm format:check     # prettier
pnpm lint             # eslint (strictTypeChecked)
pnpm lint:boundaries  # dependency-cruiser (fronteiras entre pacotes)
pnpm test             # vitest (~3.7k testes)
```

`pnpm format` e `pnpm lint --fix` corrigem a maior parte do que os dois primeiros apontam.

### Um passo a mais antes do `pnpm test`

Num clone recém-feito, `pnpm test` termina com **uma** falha esperada:

```
FAIL client src/lib/sheets/pf2e/__tests__/pregen-parity.test.ts
Error: ENOENT: no such file or directory, scandir '…/tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics'
```

Esse teste (o gate da issue #48) confere nossa derivação de personagem contra as **fichas pregeradas oficiais da Paizo** — dado que não produzimos e que **não pode ser commitado**. Ele vive num clone esparso e gitignorado do repositório `foundryvtt/pf2e`. O CI faz esse passo sozinho; na sua máquina, uma vez:

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/foundryvtt/pf2e tools/importer-pf2e/vendor/pf2e
git -C tools/importer-pf2e/vendor/pf2e sparse-checkout set packs/pf2e/iconics
```

São ~12 MB (o sparse checkout evita clonar o sistema inteiro). Todo o resto da suíte — 322 dos 324 arquivos — passa sem nenhum passo extra.

## O que o repositório contém, e o que fica de fora

Tudo que o Fusion precisa **para rodar e para jogar** está versionado: os 26 compêndios (`systems/*/packs/`, ~5.900 documentos entre PF2e, SF2e e Etmos), os overlays de tradução pt-BR, os assets do dado 3D e o catálogo de avatares (via dependência npm pinada). Depois do `pnpm build` não há nenhum passo de geração de conteúdo.

Fica **fora** do repositório, de propósito:

| O quê                                                    | Por quê                                           | Precisa dele quando                                                                               |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `tools/importer-pf2e/vendor/`                            | conteúdo da Paizo, não redistribuível             | rodar `pregen-parity.test.ts`, ou reimportar os packs do zero                                     |
| `tools/importer-pf2e/out/`, `tools/translate-packs/out/` | intermediários do pipeline, regeneráveis          | regenerar packs — e nesse caso precisam ser **frescos**: um `out/` velho reverte o enriquecimento |
| `docs/etmos-fontes/`                                     | material com copyright da Editora Balde Galáctico | trabalhar no sistema Etmos (uso privado do grupo)                                                 |

Nada disso é necessário para instalar, buildar e jogar.

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
  importer-pf2e/  translate-packs/  release/  boundary-test/  spec-lint/
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

## Documentação

As specs são a **definição do objetivo**: se o comportamento não cumpre uma spec, ou a spec está desatualizada, ou a funcionalidade não foi cumprida corretamente. Por onde entrar:

| Documento                                              | O que é                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| [`specs/README.md`](specs/README.md)                   | Índice das specs e o registro de áreas (`REQ-<ÁREA>-NNN`)          |
| [`specs/CONVENCOES.md`](specs/CONVENCOES.md)           | O metamodelo: o que é uma spec, níveis, ids, anatomia              |
| [`specs/RASTREABILIDADE.md`](specs/RASTREABILIDADE.md) | Quem foi conferir cada requisito [MVP] — gerado, não editado à mão |
| [`specs/RESUMO.md`](specs/RESUMO.md)                   | Resumo executivo de cada spec, para leitura corrida                |
| [`docs/primeira-sessao.md`](docs/primeira-sessao.md)   | Roteiro de uma primeira sessão de jogo, do zero à mesa             |
| [`docs/research/`](docs/research/)                     | Os 21 documentos de pesquisa que fundamentam as specs              |
| [`docs/lessons.md`](docs/lessons.md)                   | Lições aprendidas na implementação (erros que não devem voltar)    |

Código e teste citam o id do requisito que atendem (`// REQ-VIS-020: ...`), e é dessas citações que sai o relatório de rastreabilidade:

```bash
pnpm spec:report      # regenera specs/RASTREABILIDADE.md e sobe o piso de cobertura
```

A integridade dos ids (único, resolvível, área com dona, tag de roadmap, decisão canônica) é verificada pelo `tools/spec-lint` dentro do `pnpm test` — spec quebrada derruba o CI como código quebrado derruba.

## Contribuindo

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE).

A licença cobre o **código** deste repositório. Conteúdo de sistemas de jogo tem regime próprio: regras de Pathfinder 2e e Starfinder 2e são publicadas pela Paizo sob suas próprias licenças, e o material do Etmos RPG pertence à Editora Balde Galáctico. Ver `specs/26-licencas-e-legal.md`.
