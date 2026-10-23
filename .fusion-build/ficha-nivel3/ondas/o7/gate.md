# Gate de integração — Onda 7 (Aceite não-circular: molde, comparador, roteiro e2e)

**Worktree:** `.../scratchpad/wt-c`
**Core branch:** `ficha3/o7` — sha `80472647` (já estava pushado antes do gate; `origin/ficha3/o7` == HEAD, nada novo a enviar)
**Satélite branch:** `external/fusion-systems-2e` `ficha3/o7` — sha `b5990b9f` (branch **nova** no remoto — não existia; pushada agora)
**Pin:** confirmado antes do gate — `git ls-tree HEAD external/fusion-systems-2e` no core já apontava exatamente para `b5990b9f` (HEAD do satélite, herdado do merge de PR #150 na Onda 7a). Sem commit de pin necessário.

## Comandos (comparados ao baseline `ficha3-reports/o0/baseline.md`, cruzado com `ficha3-reports/o7a/gate.md`)

| Comando | Exit | Resultado | Comparação |
|---|---|---|---|
| `pnpm build` | 0 | verde (todos os pacotes, incluindo `packages/client`) | sem baseline formal; verde |
| `pnpm typecheck` | 0 | `COMPLETED 1613 FILES 0 ERRORS 24 WARNINGS` | baseline: exit 0 sem falhas — igual (warnings pré-existentes de a11y/svelte, não bloqueantes) |
| `pnpm lint` | 0 | 1 warning pré-existente (`no-unused-disable` em `pregen-parity.test.ts`) | verde |
| `pnpm lint:boundaries` | 0 | `no dependency violations found` (5049 módulos) | verde |
| `pnpm format:check` | 1 | 2 arquivos com estilo diferente: `.claude/skills/tutorial-e2e/roteiros/{alq-f2-02-equipment-effects,ficha-nivel3}.spec.ts` | **não é regressão** — ambos são ferramenta de sessão local, não rastreados pelo git (`git ls-files` confirma: não versionados; `.claude/` some do `git status`). Nunca entram em commit/CI. |
| `pnpm test` (suíte completa, `vitest --workspace`) | 1 | **2 arquivos falharam, 23 testes falharam** de 8392 (453 arquivos), 397s. 1 "Timeout calling onTaskUpdate" (flakiness de infra conhecida) | baseline (o0): 3 arquivos/25 testes. **Idêntico ao gate da Onda 7a** (mesmos 2 arquivos, mesmas 23 assinaturas de falha) — ver detalhe abaixo. Nenhuma regressão. |
| `pnpm spec:report` | 0 | `cobertura [MVP] com teste: 719 (piso 719)` — nenhum arquivo gerado mudou | nada para commitar |

## Detalhe do `pnpm test`

Comparei linha a linha com `ficha3-reports/o7a/test.log` (gate anterior, já validado como "sem regressão"):

- `actionCategories.test.ts` (1 teste) — mesma falha: "every top-level vendor action folder maps to a display group".
- `pregen-parity.test.ts` (22 testes) — **exatamente o mesmo conjunto** de divergências pré-existentes: 3 de chassis (`has pregens to compare against`, Alchemist, Gunslinger), 2 de HP do Commander (L3/L5), e 17 de "skill increase ceiling" (Alchemist, Animist, Commander, Druid, Exemplar, Guardian, Gunslinger, Inventor, Investigator, Necromancer, Oracle, Psychic, Runesmith, Summoner, Swashbuckler, Thaumaturge, Witch) — todas com a assinatura `NEW divergence against the official pregen sheet — <Classe>/skillIncreaseCeiling: ... expected undefined to be defined` — dívida já registrada no baseline da Onda 0 e re-confirmada sem mudança no gate da Onda 7a.
- `traitNames.sync.test.ts` — continua verde (já havia virado verde na Onda 7a).

Nenhum arquivo novo ficou vermelho; nenhuma mensagem de falha mudou de conteúdo. Não houve mudança de código de produção nesta lane (T7.3 só adicionou um `.html` de documentação em `docs/design/ficha-nivel3/onda7/`), então não havia expectativa de mexer nesse resultado — confirmado.

**Conclusão: nenhuma regressão nova.** Nada para consertar.

## `spec:report`

Rodou limpo, sem diff a commitar (mesmo piso de cobertura `719/719` do gate anterior).

## Trabalho já entregue nesta onda (antes deste gate mecânico)

- **T7.1** — molde de referência das 29 fichas (mergeado na Onda 7a).
- **T7.2** — comparador molde × ficha gerada (mergeado na Onda 7a).
- **T7.3** — roteiro `tutorial-e2e` da criação nível 1-3 (commit `80472647`, nesta worktree): Bard humano, Arquétipo Livre, Acrobat Dedication no nível 2, 23 prints olhados um a um. Achado de produto registrado como issue (não corrigido, fora do escopo do gate): `xansde/fusion#254` — Actor recém-criado via "Criar usuário" não aparece em "Na mesa" sem reload.

## Pendências para issue

Nenhuma pendência nova gerada por este gate mecânico. Persistem, como dívida já conhecida e sem mudança:
- `pregen-parity.test.ts` — 17 classes com `skillIncreaseCeiling` sem entrada em `KNOWN_DIVERGENCES` (issue a abrir por quem for dono do teste, fora do escopo deste gate — mesma conclusão do gate da Onda 7a).
- `xansde/fusion#254` (já aberta por T7.3): Contacts — Actor recém-criado via "Criar usuário" não aparece em "Na mesa" sem reload.

## Shas finais

- Core `ficha3/o7`: `80472647` — já em `origin` antes deste gate (nenhum push novo necessário).
- Satélite `ficha3/o7`: `b5990b9f` — branch nova pushada para `origin/ficha3/o7` neste gate (`https://github.com/xansde/fusion-systems-2e/pull/new/ficha3/o7`, nenhum PR aberto por este gate mecânico).
