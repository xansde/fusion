# Separação de repositórios — design arquitetural

- **Status:** design v1 — decisão aprovada pelo Alexandre em 2026-08-23 (conversa de arquitetura)
- **Data:** 2026-08-23
- **Autor:** design da separação de repos (sessão de 23/08)
- **Escopo:** decomposição do monorepo em 3 repositórios (`fusion`, `fusion-systems-2e`, `fusion-avatar`), remoção do Etmos e do Fog da linha alfa, fronteira da ficha, integração do avatar, plano de fases.
- **Fontes normativas:** `specs/01-arquitetura-geral.md` (DEC-ARQ-01/05/06), `specs/11-ui-framework-e-fichas.md` (REQ-UIF-018/019), `specs/15-api-de-sistemas.md`, `specs/17/18/19`, `specs/07-visao-iluminacao-fog.md`, `specs/35-avatar-do-personagem.md`, `specs/37-configuracoes.md`, `specs/22-instalacao-e-distribuicao.md` + `docs/design/m6-distribuicao.md`.
- **Regra:** este documento **desenha**; não implementa. Onde contraria decisão antiga (DEC-ARQ-05), a mudança é explícita e vira emenda de spec na fase correspondente.

> **Princípio-guia.** A ficha é onde o trabalho dói e onde o ritmo é outro (curadoria de 27 classes, packs de 19 MB, decisões de regra). Ela passa a viver **com o sistema de jogo**, em repositório próprio, consumida pelo core como pacote versionado. O core (`fusion`) fica com a mesa: mapa, token, cena, chat, combate, gaveta, compêndio, assets, distribuição. Nada disso muda o modelo de runtime: **um processo, um executável** (DEC-ARQ-01 e M6 intactos).

---

## 0. Estado atual (levantado do repo em 2026-08-23, branch `alfa/app` @ 98e8006)

| Fato observado                                                                                                                                              | Evidência                                                                                       | Implicação                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A ficha **não** vive em `systems/` — vive no client: 68 arquivos PF2e + 17 Etmos                                                                            | `packages/client/src/{components,lib}/sheets/{pf2e,etmos}` + chat cards                         | separar a ficha = **extrair do client**, não mover pasta de sistema                                   |
| O mecanismo de plugin de ficha já existe                                                                                                                    | `sheetRegistry.ts` (REQ-UIF-018/019) + `registerPf2eSheets.ts`/`registerEtmosSheets.ts`         | a extração é mecânica; o contrato já está desenhado na spec 11                                        |
| As VMs da ficha dependem só de `@fusion/shared` + 3 pontos do core (`window-manager`, `sheetRegistry`, `i18n`)                                              | grep de imports em `lib/sheets/pf2e`                                                            | acoplamento baixo; a ficha fala com o servidor por protocolo, não importa as regras                   |
| `systems/pf2e` (regras) não é importado pelo client; só `@fusion/system-etmos` é (alias Vite, compositor puro)                                              | `packages/client/package.json` + `vite.config.ts`                                               | com o Etmos removido, o client não importa **nenhum** pacote de sistema diretamente                   |
| O avatar não existe na linha alfa — só a spec 35; o porte da `build/app` está parado em worktree (`feat/avatar-do-personagem-alfa`, ahead 2 / behind 63)    | `git ls-files` (só spec 35) + `git worktree list`                                               | o porte vira a **semente do repo próprio**, não um merge na alfa                                      |
| Etmos: ~86 arquivos em dirs próprios + ~54 arquivos que o citam (20 server, 22 client, 6 shared, 6 system-api) + 8 eventos `etmos:*` no protocolo           | grep em 2026-08-23                                                                              | remoção é grande porém mecânica; testes usam etmos como fixture e precisam trocar para stub/pf2e      |
| Fog: fog-store + fog-handlers no server, `shared/src/fog` (6 arq.), pipeline client (`vision-state` → `LightingRenderer` → `fog-state` → filtro TokenLayer) | `packages/server/src/fog`, `packages/shared/src/fog`, `packages/client/src/lib/canvas/vision`   | fog e render de visão/iluminação formam um bloco só no client; a fronteira da remoção é a §DEC-SEP-05 |
| `token:move` vive dentro de `vision-handlers.ts`, e walls/luzes/portas são embedded no Scene                                                                | header de `net/handlers/vision-handlers.ts`; D24/D25 de `docs/design/spec-41-token/decisoes.md` | a remoção do fog **não pode** levar `token:move` junto; walls/luzes/portas são dados que ficam        |
| Handlers Etmos hardcoded no servidor (`server/src/etmos`), acoplados a ownership/seq/roll-service                                                           | grep de imports                                                                                 | com o Etmos legado, o problema "ponto de extensão de handler de servidor" desaparece da pauta         |

## 1. Decisões

### DEC-SEP-01 — Três repositórios: `fusion`, `fusion-systems-2e`, `fusion-avatar`

| Repo (`xansde/`)        | Conteúdo                                                                                                                                                                                                      | Integração com o core                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`fusion`** (core)     | mapa, token, cena, chat, combate, gaveta, compêndio, assets, auth, distribuição, `shared` + `system-api`, framework de ficha (windowManager, sheetRegistry, ficha genérica), `systems/stub`, `specs/` (todas) | —                                                                                                                 |
| **`fusion-systems-2e`** | `systems/{engine-2e,pf2e,sf2e}` + packs + **fichas PF2e** (extraídas do client) + `tools/{importer-pf2e,translate-packs}` (o pipeline que gera os packs; `vendor/`+`out/` saem do core)                       | pacotes npm por tag git (ver DEC-SEP-03)                                                                          |
| **`fusion-avatar`**     | criador LPC + atlas + boneco montável, semeado do porte (`feat/avatar-do-personagem-alfa` @ 5762dab)                                                                                                          | `@fusion/avatar` por tag; entrada na aba Configurações da gaveta + mount do canto da mesa (specs 35/37 emendadas) |

Não existe repo para o Etmos (ver DEC-SEP-04) nem repo separado para o importer (vai junto do conteúdo que ele gera).

### DEC-SEP-02 — A ficha vive com o sistema

A UI de ficha de cada sistema (componentes Svelte + VMs + chat cards) pertence ao repositório do sistema, não ao client do core. O core mantém o **framework** (windowManager, `sheetRegistry`, ficha genérica fallback de REQ-UIF-019) e resolve a ficha registrada pelo pacote do sistema. Racional: é na ficha que o ritmo de mudança e a dor estão (curadoria de classes, regras, packs); o core não deve rebuildar/re-CI a cada iteração de ficha.

### DEC-SEP-03 — Consumo por pacote npm via tag git; `.svelte` fonte; compilação junto (SUBSTITUÍDA por DEC-SEP-09)

> **Substituída na F4 (2026-08-24) pela DEC-SEP-09** — o mecanismo de dependência git abaixo provou-se estruturalmente quebrado num spike (pnpm não builda dep git sem `prepare`, e `workspace:*` interno do satélite não resolve fora de um workspace real). Texto original mantido como registro histórico.

- Os repos satélites publicam pacotes referenciados por tag git: `"@fusion/system-pf2e": "github:xansde/fusion-systems-2e#v0.1.0"`. Zero infra de registry (GitHub Packages exigiria escopo `@xansde/*` ou uma org).
- Os pacotes de ficha/avatar entregam `.svelte` **fonte**; o Vite do core compila tudo junto no build. **DEC-ARQ-06 preservada**: continua sem plugin dinâmico, e o executável único da M6 continua um artefato só.
- O core publica `@fusion/shared` e `@fusion/system-api` por tag para os satélites consumirem. Mudança que cruza o protocolo = 2 PRs com bump de tag — preço aceito; a F3 existe para conter o grosso das dores de ficha no repo 2e.
- Desenvolvimento lado a lado: `pnpm overrides` apontando para checkout local do satélite.

### DEC-SEP-04 — Etmos vira legado: removido da linha alfa

Decisão do Alexandre (2026-08-23): o Etmos sai de `alfa/beta/stable` e fica em espaço legado — vivo na linha `build/app` e no histórico. Sem repo próprio, sem ponto de extensão de handlers de servidor (o problema deixa de existir). A spec 19 permanece com banner de legado; `docs/etmos-fontes/` continua no `.gitignore` como guarda (a pasta segue no disco). Consequência aceita: mundo Etmos não abre em build da linha alfa — a mesa Etmos joga na `build/app`.

### DEC-SEP-05 — Fog arrancado do core; será refeito do zero

Decisão do Alexandre (2026-08-23): o fog sai da linha alfa para ser reconstruído do zero depois (a reconstrução é a spec 07 renascendo). Fronteira da remoção:

- **Sai:** `server/src/fog` + `fog-handlers` + eventos `fog:*` + `shared/src/fog` + pipeline de visão/fog/iluminação do client (`vision-state`, `fog-state`, `LightingRenderer`, filtro de visibilidade por visão no TokenLayer) + UI de percepção (ScenePerceptionDialog e gatilhos na aba Cenas).
- **Fica:** `token:move` (mora em `vision-handlers.ts` — cuidado cirúrgico), walls/luzes/portas como **dados** de cena com CRUD (a reconstrução vai consumi-los), campos de percepção no schema do Scene (inertes, para não invalidar cenas persistidas), e a migration 003 (`fog_exploration` fica dormente — cadeia de migrations não muda).
- Consequência aceita: jogador passa a ver o mapa inteiro e todos os tokens não-hidden (esconder volta a ser `hidden` por token, via redaction, que é outro mecanismo e fica).

### DEC-SEP-06 — Avatar: repositório próprio, integrado no padrão Waybuilder

O avatar nunca entra na alfa por merge — nasce como repo `fusion-avatar` a partir do porte existente, e o core o consome como pacote (mesmo padrão de "repo externo consumido por artefato" do Waybuilder, que segue sendo fonte de conteúdo do pipeline no `fusion-systems-2e`). Entrada de UI: **aba Configurações da gaveta** (não mais botão na ficha — corta a dependência ficha→avatar). O "behind 63" da worktree deixa de importar: só o ponto de integração precisa da alfa atual.

### DEC-SEP-07 — Specs ficam todas no core

Fonte única e gate `spec:report` no `fusion`. REQs implementados nos satélites são marcados como cobertos externamente no relatório (ajuste no spec-lint na F4); o CI de cada satélite roda os próprios testes.

### DEC-SEP-08 — Trilho `alfa→beta→stable` só no core

Os satélites versionam por tag semver; não ganham trilho triplo. Promoção no core continua ato humano.

### DEC-SEP-09 — Consumo por git submodule pinado por tag (substitui DEC-SEP-03)

Decisão tomada por spike com evidência antes da F4 (2026-08-23/24): o mecanismo original da DEC-SEP-03 — dependência git `github:xansde/fusion-systems-2e#v0.1.0&path:systems/pf2e` consumida via pnpm — está **estruturalmente quebrado**. pnpm não builda uma dependência git sem um hook `prepare`, e pior: `workspace:*` interno do satélite (`system-api` → `shared`, e todo pacote do satélite → `system-api`) dá `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` fora de um workspace pnpm real — uma dependência git baixada não é um workspace, então nenhum `workspace:*` dentro dela resolve.

**Mecanismo adotado:** o satélite entra no workspace pnpm do core como **git submodule pinado por tag**, em `external/fusion-systems-2e/`, e o `pnpm-workspace.yaml` do core passa a listar `external/fusion-systems-2e/{systems,sheets,tools}/*` ao lado dos seus próprios `packages/*`, `systems/stub`, `tools/*`. Assim:

- `workspace:*` resolve nos dois sentidos (o core enxerga `@fusion/system-pf2e`/`@fusion/sheets-pf2e` como pacotes do próprio workspace; os pacotes do satélite enxergam `@fusion/shared`/`@fusion/system-api` do core do mesmo jeito).
- O core continua buildando **um executável só** (DEC-ARQ-01/06 intactas): `pnpm build` topológico builda `shared` → `system-api` → `engine-2e`/`system-pf2e`/`system-sf2e` → `sheets-pf2e` → `server`/`client`, e o Vite do client compila os `.svelte` do submodule junto — sem plugin dinâmico, sem segundo processo.
- Bump de versão do satélite = trocar o pin do submodule (`git -C external/fusion-systems-2e checkout v0.x.y` + commit no core) — não republicar nada.
- O satélite roda seu **próprio CI**, "sozinho": clona o core raso no sha/tag pinado (`core-ref.txt`) e monta o mesmo overlay de workspace via `scripts/setup-core.sh`, provando-se contra a forma real de consumo sem depender do core rodar seu CI.

**Validado no spike e na F4 em si:** `pnpm install` limpo linka `@fusion/shared`/`@fusion/system-api` de verdade nos pacotes do submodule; `pnpm build`/`typecheck`/`test`/`lint:boundaries` passam na raiz do core com o submodule montado — ver PR da F4 para os números.

**Achado colateral do CI standalone do satélite** (documentado em `scripts/setup-core.sh` do repo `fusion-systems-2e`): montar o core via **symlink** para o checkout do satélite (em vez de cópia) quebra a linkagem de dependências do pnpm 11 — o linker do workspace resolve o realpath de cada pacote para decidir se ele pertence ao workspace, e um symlink cujo realpath cai fora da raiz do workspace é reconhecido para `pnpm --filter`/scripts mas silenciosamente pulado para linking (nenhum `node_modules/@fusion/*` é criado). Isso não afeta o mecanismo real desta decisão — um git submodule é um diretório real dentro da árvore do core, não um symlink — mas vale registrado porque quase foi confundido com um problema do mecanismo em si.

DEC-SEP-03 fica **substituída** por esta decisão; o texto original permanece acima como registro histórico do que foi tentado e por quê não funcionou.

## 2. Fases

Cada fase termina em estado estável, com PR contra `alfa/app` (F2 empilhada sobre F1). Merge é sempre ato humano.

| Fase      | Entrega                                                                                                                                                                                                                                                                                        | Definition of done                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **F1** ✅ | Remover Etmos da linha alfa (dirs etmos, 8 eventos de protocolo, deps/alias, testes re-fixturados p/ stub ou pf2e, spec 19 com banner, CLAUDE.md/README)                                                                                                                                       | suíte completa verde; `spec:report` regenerado; nenhum import/`etmos:*` restante fora de menção histórica em spec/doc  |
| **F2** ✅ | Remover Fog conforme fronteira da DEC-SEP-05 (empilhada sobre F1)                                                                                                                                                                                                                              | suíte verde; `token:move` e CRUD de walls/luzes/portas intactos; cenas persistidas continuam abrindo                   |
| **F3** ✅ | Fronteira da ficha dentro do core: mover os 68 arquivos PF2e p/ `packages/client/src/systems/pf2e/`, chat cards via registry (padrão `conditionRegistry`/`footprintRegistry`), regra nova no dependency-cruiser                                                                                | CI atual prova a fronteira: core não importa ficha de sistema fora do entry point registrado                           |
| **F4** ✅ | Extrair `fusion-systems-2e` (histórico não preservado por `filter-repo` — o repo satélite nasceu semeado, não migrado; ver PR): regras + fichas + packs + importer; core consome via **git submodule pinado por tag** (DEC-SEP-09, substitui a publicação por tag de pacote npm da DEC-SEP-03) | build+suíte verdes nos dois repos; `spec:report` com cobertura externa mantendo o piso; emenda DEC-ARQ-05 + DEC-SEP-09 |
| **F5**    | Criar `fusion-avatar` do porte 5762dab; integração no core (seção na aba Configurações + canto da mesa via `@fusion/avatar`); emendas specs 35/37                                                                                                                                              | avatar funcional na mesa a partir do pacote; sem botão na ficha                                                        |

## 3. Emendas de spec (aplicadas na fase que as motiva)

| Spec                 | Emenda                                                                                   | Fase  |
| -------------------- | ---------------------------------------------------------------------------------------- | ----- |
| 19 (Etmos)           | banner de legado; REQ-ETM não exigível na linha alfa                                     | F1    |
| 07 (Visão/Fog)       | banner "será refeita do zero"; REQ-VIS de fog/visão sem implementação na linha alfa      | F2    |
| 01 (DEC-ARQ-05)      | monorepo → core + satélites por tag; fronteira `shared` continua no centro               | F4    |
| 11 (fichas)          | ficha de sistema é pacote registrado via `sheetRegistry`; core mantém fallback genérico  | F3/F4 |
| 15 (API de sistemas) | nota: sistemas entregam ficha junto; sem handlers de servidor por sistema (Etmos legado) | F4    |
| 17/18                | nota "onde vive": repo `fusion-systems-2e`                                               | F4    |
| 35 (Avatar)          | entrada pela aba Configurações (não pela ficha); "onde vive": repo `fusion-avatar`       | F5    |
| 37 (Configurações)   | seção Avatar na aba                                                                      | F5    |
| 26 (Licenças)        | nota: packs ORC no repo 2e; Etmos legado                                                 | F4    |

## 4. Consequências aceitas (registradas com o OK do Alexandre em 2026-08-23)

1. Mundo Etmos não abre em build da linha alfa; a mesa Etmos usa a linha `build/app` (legado).
2. Sem fog: jogador vê o mapa inteiro e tokens não-hidden até a reconstrução da spec 07.
3. Mudança que cruza protocolo (ficha ↔ shared) vira 2 PRs com bump de tag.
4. A remoção chega a `beta`/`stable` pela promoção humana normal, nunca por push direto.
5. CI do core deixa de rodar os testes de ficha/regras 2e a partir da F4 — o repo 2e precisa de CI próprio desde o dia 1.

## 5. Questões em aberto

- **Q-SEP-01** — Walls/luzes/portas ficaram como dados com CRUD (DEC-SEP-05). Se o Alexandre preferir arrancar também, vira uma F2b (o bloqueio é `token:move` e as cenas persistidas).
- **Q-SEP-02** — Nome e fronteira exata do pacote do avatar (`@fusion/avatar`): o que é componente de core (mount do canto da mesa) vs. pacote.
- **Q-SEP-03** — Momento do primeiro bump público de `@fusion/shared` (tag v0.x) — na F4, junto da extração.
