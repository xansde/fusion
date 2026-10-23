# Gate de integração — Onda 6b (gatilho de UI para criar personagem)

Worktree: `wt-d` (core `ficha3/o6b`; satélite `external/fusion-systems-2e` branch `ficha3/o6b`).

## SHAs finais

- Core (`xansde/fusion`, `ficha3/o6b`): `d848ce086b31b5e0f5a3cf6baa1b94b715f2b827` — pushado.
- Satélite (`xansde/fusion-systems-2e`, `ficha3/o6b`): `5a939039536c3033dd4824ec3902709c96023137` — pushado
  nesta lane (branch não existia no remoto até este gate). Mesmo commit do `main` do satélite
  (PR #117 já mergeado) — nenhum código de sistema tocado pela T6.5, só teste no core.
- Pin do core aponta exatamente para esse SHA do satélite (`git ls-tree HEAD external/fusion-systems-2e`
  confere).

## Trabalho da lane (já feito e commitado antes deste gate)

T6.5: investigação encontrou que o gatilho de UI pedido já existe (REQ-USR-025 + REQ-CFG-051a +
REQ-NPC-055a + fluxo Contatos) e que criar um botão novo violaria decisão fechada. A lane fechou
a lacuna de PROVA automatizada (2 arquivos de teste, nenhum código de produção), commit único
`d848ce08`. Detalhe: `../ficha3-reports/o6b/T6.5-criar-personagem.md`.

## Comandos do gate (comparado ao baseline `../ficha3-reports/o0/baseline.md`, capturado na Onda 0)

| Comando | Resultado | Baseline (Onda 0) | Veredito |
|---|---|---|---|
| `pnpm build` | exit 0, verde (topológico completo, inclui client) | não capturado no baseline (typecheck 0/test apenas) | OK |
| `pnpm typecheck` | exit 0, sem falhas | exit 0, sem falhas | igual — OK |
| `pnpm lint` | exit 0 | não capturado | OK |
| `pnpm lint:boundaries` | exit 0 | não capturado | OK |
| `pnpm format:check` | exit 0 | não capturado | OK |
| `pnpm test` (suíte completa) | exit 1 — **2 arquivos falharam, 23 testes falharam** (de 8199, 445 arquivos), 581s + 1 "Unhandled Error: onTaskUpdate" (flakiness de infra conhecida) | exit 1 — **3 arquivos falharam, 25 testes falharam** (de 8003, 438 arquivos) | **sem regressão** — ver detalhe abaixo |
| `pnpm spec:report` | exit 0 — `cobertura [MVP] com teste: 710 (piso 710)` | citado no relatório T6.5 como 710/710 (piso, sem regressão) | igual — OK, nada gerado para commitar |

### Detalhe da comparação de testes

Baseline (Onda 0) tinha 3 arquivos vermelhos:
1. `client/.../traitNames.sync.test.ts` — 2 testes (TRAIT_NAMES_PT desatualizado, issue #59)
2. `sheets-pf2e/.../actionCategories.test.ts` — 1 teste (vendor folder sem display group)
3. `sheets-pf2e/.../pregen-parity.test.ts` — 22 testes (CLASSES_WITHOUT_PREGEN + divergências
   HP/attacks de Alchemist/Gunslinger/Commander)

Gate desta onda (o6b): 2 arquivos vermelhos:
1. `actionCategories.test.ts` — 1 teste, **mesma causa** do baseline (vendor folder sem grupo) —
   OK, dívida pré-existente inalterada.
2. `pregen-parity.test.ts` — 22 testes, mesma contagem do baseline, mas com detalhamento
   diferente (inclui agora `skillIncreaseCeiling` para 17 classes + HP Commander L3/L5 + 3 de
   chassis/pregens). São classes novas/refeitas por ondas anteriores já mergeadas em `alfa/app`
   (leva de 14+2 classes, incluindo as 29 curadas) — dívida de dado documentada no próprio teste
   (`KNOWN_DIVERGENCES`), não código tocado por esta lane.
3. `traitNames.sync.test.ts` **não aparece mais como falha** — melhora (TRAIT_NAMES_PT foi
   atualizado por lane anterior já presente na branch base desta onda), não regressão.

**Confirmação de que não é regressão desta lane:** o único commit desta onda (`d848ce08`) toca
só 2 arquivos de teste (`player-character-create.test.ts`, `ContactsPanel.test.ts`) — nenhuma
linha de código de produção, nenhum arquivo de `sheets-pf2e`. `pregen-parity.test.ts` e
`actionCategories.test.ts` são de outro pacote (`sheets-pf2e`), fora do escopo tocado. As
falhas já existiam no pai desta branch (`origin/alfa/app` na altura do merge-base
`2386ef57`, PR #234) — dívida de dado de ondas anteriores (leva de classes), não desta lane.

Nota: `origin/alfa/app` já avançou para `c9be8544` (PR #235, onda paralela `ficha3/o4`) durante
esta execução — não rebaseado nesta lane por não fazer parte do escopo do gate da o6b (regra:
não tocar trabalho de onda alheia).

## Conclusão

Sem regressão nova introduzida pela Onda 6b. Gate **PASSA**. Nada de `spec:report` para
commitar (saída idêntica: 710/710, sem diff em arquivo).

## Pendências para issue

Nenhuma nova desta lane. As de T6.5 (fallback de título vazio no card de Contatos, cosmético)
já registradas no relatório da lane, sem ação necessária — decisão de escopo.
