# Onda 6b — Evidência de fecho (gatilho de UI para criar personagem)

Worktree: `wt-o0` (core branch `ficha3/o6b`; satélite `external/fusion-systems-2e` branch `ficha3/o6b`).

SHAs finais (fim da revisão adversarial r1 + lane de evidência viva final, já pushados):

- Core: `cba97bf58e37d14624c0151f1976e2a33ddc509b`
- Satélite: `66c3a3f137de2ef1a71ea73adc494011ea4a9574`
- Pin do core aponta exatamente para o HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e`).

## 1. Linha da tabela da seção 3 do `execucao.md`

| Onda | Mecânico | Vivo | Olhado |
|---|---|---|---|
| **6b** | Gate deste fecho (SHA `cba97bf5`/`66c3a3f`, worktree `wt-o0`): `pnpm build` EXIT 0; `pnpm typecheck` EXIT 0 (`COMPLETED 1612 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS`, idêntico ao baseline/Onda 6); `pnpm lint` EXIT 0 (0 erros, 1 warning pré-existente em `pregen-parity.test.ts`, mesmo da Onda 6); `pnpm lint:boundaries` EXIT 0 (`no dependency violations found`, 5038 módulos/12147 deps); `pnpm format:check` EXIT 0 (`All matched files use Prettier code style!`); `pnpm spec:report` EXIT 0 (`cobertura [MVP] com teste: 710 (piso 710)`, igual à Onda 6, nada novo para commitar); testes das tarefas da onda — `player-character-create.test.ts` (17 testes) + `user-add.test.ts` (2 testes) = 19/19 verdes (17.18s, `@fusion/server`); `ContactsPanel.test.ts` 21/21 verdes (6.87s, `@fusion/client`); `planVM.test.ts` (satélite, describe "several class traits" do fix C3) 394/394 verdes (4.65s) — total 434/434 testes afetados verdes. Suíte completa: ver `../ficha3-reports/o6b/gate.md` (rodada num SHA anterior desta mesma onda, sem regressão vs. baseline da Onda 0/Onda 6) — **suíte completa oficial desta rodada é a do CI do PR** (seção 6 abaixo). | Servidor real (porta 33020) + mundo isolado (`data-o6b`, cópia de `teste_xande`) + dois papéis de browser reais (Playwright): Mestre cria usuário `JogadorO6b` pela UI real (Configurações → Usuários) → `AuthService.createUser` grava, na mesma transação, um Actor `character` em branco (`ownership={"default":0,"<playerId>":3}`, `flags.fusion.playerId`) → o dono abre a própria ficha pela coluna Plano (Contatos) e sobe DOIS personagens de nível 1 a 3 pelo gatilho real: um Mago (Elfo Ancestral/Erudito, 18 items) e um Guerreiro (Anão da Forja/Combatente, 17 items, criado via `fusion user add` — C2). Achou e reverificou o defeito C3 (talento multi-classe com aviso falso de "classe errada") antes/depois do fix `66c3a3f`. Reverificado nesta mesma onda (lane de evidência viva final) linha a linha contra o `world.db` via `better-sqlite3` somente-leitura, sem subir servidor novo. | 17 prints em `prints/` (5 comprimidos ~30% para ficar sob 500 KB, sem perda de legibilidade do que provam), GM e Player, ambos os papéis: `01`-`03` Mestre cria o usuário pela UI real; `04` Actor nasce em branco (builder "Escolha uma classe"); `05`-`09` Mago sobe de nível 1 a 3 (aba Magias com o aviso falso C3 antes do fix); `10`-`11` Player loga e vê só o próprio personagem em Contatos; `12` ficha própria nível 3; `13`-`14` segundo personagem (Guerreiro, criado via CLI `fusion user add`) sobe a nível 3; `15`-`17` recheck pós-fix C3 sem o aviso falso. Todos os 17 olhados nesta onda (lane original + lane de evidência viva final), 6 deles reabertos e conferidos linha a linha contra o `world.db` na lane final. |

## 2. Prints — uma linha do que cada um prova

- `01-gm-logado-hub.png` — MestreO6b autenticado no Hub → papel GM ativo na sessão que gerou a evidência viva.
- `02-gm-criar-usuario-form.png` — formulário Configurações → Usuários → Criar usuário preenchido para `JogadorO6b` → prova de que o gatilho é essa tela, não um botão novo.
- `03-gm-usuario-jogadoro6b-criado.png` — lista de Usuários mostra Gamemaster/MestreO6b/Tobias/**JogadorO6b** → usuário criado, confirmado depois contra a tabela `users` do `world.db`.
- `04-ficha-jogadoro6b-em-branco.png` — ficha nível 1 recém-nascida, "Escolha uma classe para começar" → prova de que o Actor nasceu em branco na mesma transação (REQ-USR-025), confirmado contra `ownership`/`flags.fusion.playerId` no `world.db`.
- `05-nivel1-plano-completo.png` — coluna Plano do Mago com nível 1 completo (Ancestralidade Elfo Ancestral, Antecedente Erudito) → builder guiado funcionando pelo gatilho real.
- `06-nivel1-completo-todos-slots.png` — todos os slots de nível 1 preenchidos → prova de progressão sem erro de validação do servidor.
- `07-nivel2-completo.png` — nível 2 completo → progressão multi-nível funcionando.
- `08-nivel3-completo-plano.png` — nível 3 completo (classFeatures Wizard: School of Unified Magical Theory, Spell Blending, Wizard Spellcasting, Arcane Bond) → personagem 1 finalizado nível 1→3.
- `09-nivel3-aba-magias-mago.png` — aba Magias do Mago nível 3 com o talento "Familiar" mostrando o aviso falso "É talento de classe Magus e você não tem níveis de Magus" (defeito C3, capturado ANTES do fix) → evidência viva do achado C3.
- `10-player-logado-hub.png` — JogadorO6b autenticado, badge Jogador → papel Player ativo, sessão distinta do Mestre.
- `11-player-contatos-so-o-proprio.png` — aba Contatos do jogador mostra só `JogadorO6b (você)` em "Na mesa 1" → prova de UI da redação por ownership.
- `12-player-ficha-propria-nivel3.png` — jogador abre a própria ficha nível 3 (builder completo, EDITAR ativo) → prova de que o dono edita o próprio personagem criado pelo gatilho real.
- `13-jogadorgmcriado-nivel3-guerreiro.png` — segundo personagem (Guerreiro, Anão da Forja/Combatente), dono `JogadorGMCriado`, criado via `fusion user add --role PLAYER` (CLI, C2) → prova de que o gatilho tem dois caminhos de entrada (UI e CLI) e ambos criam o Actor.
- `14-jogadorgmcriado-nivel3-idiomas-completos.png` — Guerreiro nível 3 com idiomas/talentos completos (Dwarven Weapon Familiarity, Vicious Swing, Dueling Parry, Experienced Tracker, Incredible Initiative) → personagem 2 finalizado nível 1→3.
- `15-recheck-familiar-sem-aviso-falso.png` — mesmo personagem (Mago nv3), reaberto após o fix C3: talento "Familiar" sem o aviso vermelho falso.
- `16-recheck-magias-sem-aviso.png` — aba Magias inteira sem aviso residual pós-fix.
- `17-recheck-familiar-scroll-sem-aviso.png` — scroll completo da aba confirmando "Cantrip Expansion" também sem aviso falso pós-fix `66c3a3f` → prova visual antes/depois do C3.

## 3. Veredito da revisão adversarial (e re-verificações)

- **Rodada 1** (`revisao-adversarial.md`): levantou C1 (importante, prova excessiva no texto do T6.5/tasks.md sobre os 4 caminhos de redação), C2 (importante, `fusion user add` via CLI não criava o Actor — só a rota de UI/API funcionava), C3 (importante, `checkSlotRequirement` marcava talento multi-classe como "classe errada" olhando só o primeiro trait). Revisões complementares sem achado bloqueante: `revisao-costura-seguranca.md`, `revisao-dado-importer.md`, `revisao-regra-pf2e.md`, `revisao-testes-contratos.md`.
- **Fixer r1** (`fix-r1.md`): os três achados corrigidos — C2 em `20edd60d` (`runUserAdd` passa a delegar a `AuthService.createUser`), C3 no satélite `66c3a3f` (`checkSlotRequirement` usa `filter`/`!includes(classSlug)` em vez do primeiro trait), C1 em `ee0d801c` + `82231a7e` (prettier). Gate completo (build/typecheck/lint/lint:boundaries/format:check/spec:report) verde, sem regressão vs. baseline da Onda 0.
- **Rodada 1 de reverificação** (`revisao-adversarial-r1.md`): C1, C2 e C3 confirmados **FECHADOS** — C1 pelo texto corrigido citando a issue `xansde/fusion#240`; C2 por `user-add.test.ts` 2/2 verde contra o dist recompilado; C3 por `planVM.test.ts` describe "several class traits" 4/4 verde e ausência de outro ponto com a mesma lógica de "primeiro trait" no satélite (issue de rastreio `xansde/fusion-systems-2e#129` aberta). Ataque ao diff do conserto não achou regressão nem achado novo. **Veredito: APROVADA.**
- **Lane de evidência viva final** (`evidencia-viva-final.md`): reverificou os 6 prints mais relevantes linha a linha contra o `world.db` (tabelas `users`/`actors`), confirmou o defeito e a correção do C3 nos prints antes/depois, e corrigiu uma imprecisão de id de actor do relatório anterior (sem mudar a conclusão). Corrigiu também `docs/design/ficha-nivel3/gate-runbook.md` §5, que ainda descrevia o estado pré-T6.5 (workaround de reaproveitar atores) — reescrito para apontar o gatilho real.
- **PODE MERGEAR: SIM** — confirmado pelo orquestrador que disparou este fecho ("a revisão adversarial passou (zero bloqueante/importante aberto)"), e reconfirmado pela leitura direta dos relatórios acima nesta passada de fecho.

## 4. Pendências (com issue)

Nenhuma pendência **nova** desta onda. As duas já conhecidas seguem abertas e checadas nesta passada (`gh issue view`, ambas `state: OPEN`):

1. **`xansde/fusion#240`** — conflito de specs 05×39 (REQ-USR-025a `ownership.default=none` × REQ-CTT-014 "Na mesa mostra todos a todos") + predicado de redação de Actor `character` divergente entre os 4 caminhos do REQ-NET-096 (snapshot vs. broadcast/replay/eco). Decisão de produto pendente do Alexandre, não corte de escopo desta onda. https://github.com/xansde/fusion/issues/240
2. **`xansde/fusion-systems-2e#129`** — registro de rastreio do achado C3 (`checkSlotRequirement` só olhava o primeiro trait de classe de um classFeat multi-classe); já resolvido no mesmo commit `66c3a3f` que a abriu, issue mantida só como rastreio histórico. https://github.com/xansde/fusion-systems-2e/issues/129

Observação sem issue (cosmética, registrada no T6.5, decisão de escopo): personagem 100% em branco (sem classe escolhida) mostra fallback de título vazio no card de Contatos — REQ-CTT-023 é satisfeito (não há identificação de sistema disponível ainda), o resultado visual é só uma linha em branco até o jogador escolher classe. Não bloqueia o fluxo; criar UI nova para cobrir isso violaria REQ-CFG-051a/REQ-NPC-055a.

## 5. Gate local do fecho (sem suíte completa) + CI

Rodado nesta passada de fecho, no HEAD atual (`cba97bf5`/`66c3a3f`), na worktree `wt-o0`:

| Comando | Resultado |
|---|---|
| `pnpm build` | EXIT 0 (log: `gate-build.log`) |
| `pnpm typecheck` | EXIT 0 — `COMPLETED 1612 FILES 0 ERRORS 24 WARNINGS 6 FILES_WITH_PROBLEMS` (log: `gate-typecheck.log`) |
| `pnpm lint` | EXIT 0 — 0 erros, 1 warning pré-existente (`no-console` eslint-disable não usado em `pregen-parity.test.ts`, log: `gate-lint.log`) |
| `pnpm lint:boundaries` | EXIT 0 — `no dependency violations found (5038 modules, 12147 dependencies cruised)` (log: `gate-lint-boundaries.log`) |
| `pnpm format:check` | EXIT 0 — `All matched files use Prettier code style!` (log: `gate-format-check.log`) |
| `pnpm spec:report` | EXIT 0 — `cobertura [MVP] com teste: 710 (piso 710)`, nada gerado para commitar (log: `gate-spec-report.log`) |
| `vitest run src/__tests__/player-character-create.test.ts src/__tests__/cli/user-add.test.ts` (`@fusion/server`) | 2 arquivos, 19/19 testes verdes, 17.18s (log: `gate-test-server.log`) |
| `vitest run src/components/contacts/__tests__/ContactsPanel.test.ts` (`@fusion/client`) | 1 arquivo, 21/21 testes verdes, 6.87s (log: `gate-test-client.log`) |
| `vitest run .../planVM.test.ts` (satélite, via vitest workspace da raiz) | 1 arquivo, 394/394 testes verdes, 4.65s (log: `gate-test-satellite-planvm.log`) |
| `git status --porcelain` (core e submodule) | limpo (só resíduo pré-existente `tools/importer-pf2e/` untracked, herdado de onda anterior) |

Suíte completa: `../ficha3-reports/o6b/gate.md` (rodada num SHA anterior desta mesma onda, antes da correção final do runbook — mesmo padrão de falhas pré-existentes do baseline da Onda 0/Onda 6: `actionCategories.test.ts` 1 teste e `pregen-parity.test.ts` ~22 testes, dívida de dado documentada em `KNOWN_DIVERGENCES`, fora do escopo tocado por esta onda) + CI do PR (números preenchidos após a abertura dos PRs, seção 6 abaixo).

## 6. CI e PRs

Preenchido após a abertura dos PRs e `gh pr checks --watch` — ver corpo do relatório `fecho.md` para os números finais e links.

## Conclusão

Onda 6b (gatilho de UI para criar personagem) com os três requisitos provados nos três níveis exigidos por `execucao.md` §3 — mecânico, vivo, olhado — sem achado bloqueante nem importante em aberto na revisão adversarial (rodada 1 + reverificação + lane de evidência viva final), e as duas pendências conhecidas já registradas como issue no repo certo, confirmadas abertas nesta passada.
