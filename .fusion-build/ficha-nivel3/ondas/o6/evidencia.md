# Onda 6 — Evidência de fecho (o jogador cria o próprio personagem)

Worktree: `wt-o0` (core branch `ficha3/o6`; satélite `external/fusion-systems-2e` branch `ficha3/o6`).

SHAs finais (fim do fixer r2 + revisão adversarial r2, já pushados):

- Core: `10ebb270d654f1257ca8927cd4ce2baae24745bd`
- Satélite: `3939aa12252000a82de3fbeb2dc518481cf1f482`
- Pin do core aponta exatamente para o HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e`).

## 1. Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **6** | `pnpm build` EXIT 0; `pnpm typecheck` EXIT 0 (0 erros, 24 warnings svelte a11y/state pré-existentes, idêntico ao baseline); `pnpm lint` EXIT 0 (0 erros, 1 warning pré-existente em `pregen-parity.test.ts`); `pnpm lint:boundaries` EXIT 0 (0 violações, 5032 módulos/12132 deps); `pnpm format:check` EXIT 0; `pnpm spec:report` EXIT 0 (cobertura [MVP] com teste: 710, piso 710); testes das tarefas da onda: `build-validation.test.ts` 28/28 verdes, `player-character-create.test.ts` 14/14 + `embedded-item-actor.test.ts` 10/10 + `documents.test.ts` 70/70 (94/94 verdes, 17.36s) — teste de servidor prova que jogador editando/criando ator alheio é **recusado pelo servidor** (`PERMISSION_DENIED`), não só escondido no client. Suíte completa: ver `gate.md` (rodada no SHA anterior `93639fa4`/`18c6b7f7`, sem regressão) — **suíte completa oficial desta rodada é a do CI do PR** (seção 5 abaixo). | Protocolo socket.io real contra servidor + mundo isolado (`data-o6`, cópia de `teste_xande`), lido direto do `world.db`: (1) JogadorO6 cria o PRÓPRIO personagem via `doc:create` com `ownership:{default:3}` forjado → servidor ignora o forjado e grava `ownership={"default":0,"SY4qE4XZ2C3GPDtl":3}` (força `{creator:OWNER}`); (2) JogadorO6 edita o próprio personagem (`xp:5`) → `ok:true`; (3) JogadorO6B tenta editar o personagem do JogadorO6 → `ok:false, code:"PERMISSION_DENIED", "No OWNER access to Actor/tpwJyMWRQGr5s4aW"`; (4) edição concorrente Mestre×Jogador: Mestre edita bio (v3→v4) sem `expectedVersion`, Jogador edita `xp` com versão defasada → `STALE_WRITE`, recarrega (v4) e reenvia → `ok:true` v5, e o `world.db` final tem `xp:42` **e** `biography.value` do Mestre juntos no mesmo documento (nenhuma edição perdida). Saída bruta: `live-check-output.log` (mantida em `ficha3-reports/o6/`, não copiada para cá por não ser `.md`/print). `characterId: tpwJyMWRQGr5s4aW`, mundo `teste_xande` isolado. | 8 prints em `prints/`, GM e Player, ambos os papéis: `01`/`02` login dos dois papéis no Hub; `03` aba Contatos do jogador mostrando o próprio personagem; `04` jogador abre a própria ficha (builder completo, EDITAR ativo); `05` Mestre vê o personagem do jogador em Contatos; `06` Mestre abre a mesma ficha (acesso privilegiado); `07` bio editada pelo Mestre refletida na ficha; `08` JogadorO6B **não vê** o personagem alheio ("Você ainda não tem personagem nesta mesa") — reforça na UI a recusa do servidor. Cada print foi reaberto e conferido nesta passada de fecho (não só listado), ver `evidencia-viva-final.md`. |

## 2. Prints — uma linha do que cada um prova

- `01-gm-logado-hub.png` — MestreO6 autenticado no Hub, painel de Mapa/Cenas visível → papel GM ativo na sessão que gerou a evidência viva.
- `02-jogador-logado-hub.png` — JogadorO6 autenticado, badge "Jogador", painel de Chat → papel Player ativo, sessão distinta da do Mestre.
- `03-jogador-contatos-personagem-proprio.png` — o jogador vê, na própria aba Contatos, o personagem que ele mesmo criou ("Na mesa 1"), tag "você" + "conectado" → prova de UI de que o `doc:create` do próprio personagem funcionou.
- `04-jogador-ficha-aberta.png` — o jogador abre a própria ficha (builder completo: Ancestralidade/Linhagem/Antecedente/Classe, botão EDITAR ativo) → prova de que o dono edita o próprio personagem.
- `05-mestre-contatos-ve-personagem-do-jogador.png` — o Mestre vê o personagem do jogador junto aos demais atores da mesa ("Na mesa 3") → prova de visibilidade privilegiada do GM.
- `06-mestre-abre-ficha-do-jogador.png` — o Mestre abre a mesma ficha do personagem do jogador com acesso privilegiado → prova de que o GM pode operar sobre o personagem de qualquer jogador.
- `07-mestre-ficha-bio-editada-pelo-mestre.png` — a aba Bio mostra o resumo estruturado após a edição do Mestre → prova visual do cenário de concorrência T6.4 (edição do Mestre refletida na ficha).
- `08-jogadorB-nao-ve-personagem-alheio.png` — um segundo jogador (JogadorO6B) não vê o personagem do primeiro ("Você ainda não tem personagem nesta mesa") → reforço de UI da recusa `PERMISSION_DENIED` do servidor.

## 3. Veredito da revisão adversarial (e re-verificações)

- **Rodada 1** (`revisao-adversarial.md` + `revisao-adversarial-r1.md`): achados C1-C9 levantados sobre a lane T6.1-T6.4; C2/C3/C4/C5/C6/C9 confirmados e corrigidos pelo fixer r1 (`fix-r1.md`, commits `c3354f4d`, `1d98e0b2`, `837682ff`, `ed775b43`).
- **Rodada 2** (`revisao-adversarial-r1.md` reprocessada → 2 achados importantes reabertos: C4 — item embutido com slot ilegal sem `choice` associada passava; N1 — nenhum limite de nível de talento vs. nível do slot restou após a remoção do check antigo do C2). Ambos corrigidos pelo fixer r2 (`fix-r2.md`, satélite `3939aa1`, core `10ebb270`), com teste unitário (`build-validation.test.ts`) e de integração na porta real (`player-character-create.test.ts`) provando vermelho→verde.
- **Rodada 2, veredito final** (`revisao-adversarial-r2.md`): sonda `probe-r2` confirma C4 e N1 **FECHADOS** contra o `dist` recompilado. Ataque ao diff do conserto não achou falso positivo no fluxo real do client (picker sempre mais estrito que a validação; itens concedidos não carregam `flags.fusion.build`; sub-slots/dedicação/talento de perícia passam conforme o Player Core). Dois achados **menores** (não bloqueantes): M1 (`buildLevel` confia em flag do cliente com fallback pro nível do slot — impacto baixo, item forjado fica fora do build do mesmo jeito que um item sem flag) e M2 (teste do C4 não asserta explicitamente "nada persistiu", embora a leitura do código mostre que a recusa sai antes do `store.update`). **Conclusão da r2: nada bloqueante nem importante ficou aberto.**
- Revisões complementares sem achado bloqueante: `revisao-costura-seguranca.md` (higiene do diff, pin do submodule, T6.4 sem janela nova), `revisao-dado-importer.md`, `revisao-regra-pf2e.md`, `revisao-testes-contratos.md`.
- **PODE MERGEAR: SIM** — confirmado pelo orquestrador que disparou este fecho ("a revisão adversarial passou (zero bloqueante/importante aberto)"), e reconfirmado pela leitura direta dos relatórios acima nesta passada de fecho.

## 4. Pendências (com issue)

1. **`xansde/fusion#233`** — ownership do eidolon (companheiro do Summoner) quando a Onda 3 landar em `alfa/app` (hoje não existe modelo de ator companheiro novo nesta base — só o familiar pré-existente r17-P1, que já está correto). https://github.com/xansde/fusion/issues/233
2. **`xansde/fusion-systems-2e#109`** — `validateCharacterBuild` não cobre contagem de perícias treinadas por classe/nível (falta fonte central do orçamento de perícias por classe). https://github.com/xansde/fusion-systems-2e/issues/109
3. **`xansde/fusion-systems-2e#116`** (nova, criada no fecho) — `validateCharacterBuild` é no-op completo (incluindo `checkItemSlots`, r2) para personagem sem `system.build` ("modo manual r9"); o personagem auto-criado pelo REQ-USR-025 nasce nesse estado, mas o client real sempre inicializa `system.build` no primeiro passo do builder guiado, então a janela real de exposição é pequena. Achado durante o fixer r2, fora do escopo dos achados C4/N1 que motivaram a rodada. https://github.com/xansde/fusion-systems-2e/issues/116

Nenhuma pendência nova além dessas três. A lacuna de UI "sem botão criar personagem" (`DEC-CTT-01`) é decisão de produto já registrada desde a Onda 0 — não gera issue.

## 5. Gate local do fecho (sem suíte completa) + CI

Rodado nesta passada de fecho, no HEAD atual (`10ebb270`/`3939aa1`), superando o `gate.md` anterior (que era do SHA pré-fixer-r2):

| Comando | Resultado |
|---|---|
| `pnpm build` | EXIT 0 |
| `pnpm typecheck` | EXIT 0 — `COMPLETED 1612 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` (client) + server sem erro |
| `pnpm lint` | EXIT 0 — 0 erros, 1 warning pré-existente (`no-console` eslint-disable não usado em `pregen-parity.test.ts`) |
| `pnpm lint:boundaries` | EXIT 0 — `no dependency violations found (5032 modules, 12132 dependencies cruised)` |
| `pnpm format:check` | EXIT 0 — `All matched files use Prettier code style!` |
| `pnpm spec:report` | EXIT 0 — `cobertura [MVP] com teste: 710 (piso 710)` |
| `vitest run systems/pf2e/src/__tests__/build-validation.test.ts` (satélite) | 28/28 testes verdes, 1.79s |
| `vitest run packages/server/src/__tests__/{player-character-create,embedded-item-actor,documents}.test.ts` (core) | 3 arquivos, 94/94 testes verdes, 17.36s |
| `git status --short` (core e submodule) | limpo (só resíduo pré-existente `tools/importer-pf2e/` untracked, de onda anterior) |

Suíte completa: `ficha3-reports/o6/gate.md` (rodada no SHA `93639fa4`/`18c6b7f7`, antes do fixer r2 — 2 arquivos falhos/23 testes falhos, **subconjunto idêntico ao baseline confirmado sem regressão pela Onda 1**; o fixer r2 não tocou nenhum arquivo coberto por essas 23 falhas pré-existentes — `pregen-parity`/`actionCategories`) + CI do PR (link/números preenchidos após o passo 5 deste fecho, ver seção 6 abaixo).

## 6. CI e PRs

Preenchido após a abertura/atualização dos PRs e `gh pr checks --watch` (ver corpo do relatório `fecho.md`).

## Conclusão

Onda 6 (o jogador cria o próprio personagem) com os três requisitos provados nos três níveis exigidos por `execucao.md` §3 — mecânico, vivo, olhado — sem achado bloqueante nem importante em aberto na revisão adversarial (2 rodadas), e as três pendências conhecidas já registradas como issue no repo certo.
