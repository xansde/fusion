# Evidência viva — Onda 4b, fixer rodada 2 (achado C7)

Refaz a evidência "Vivo"/"Olhado" pedida pela revisão adversarial r1 (`revisao-adversarial-r1.md`,
achado C7): as fotos de `evidencia-viva.md` são de 18:44–18:55, **antes** do fixer r1 e do fixer r2
(N2). Esta lane reproduz do zero, no pin ATUAL (satélite `8203bae`, core apontando pra ele),
com um ator **limpo** (não o "Novo Ator" usado antes, que já vinha contaminado por uma
construção Animist anterior — Barbarian fantasma + Knock já resolvido fora de um level-up real,
achado registrado na rodada 1).

## Setup

- Worktree: `scratchpad/wt-d`, branch `ficha3/o4b`. Core em `bb7fe458` (repina o satélite),
  satélite em `8203bae` (fix do N2: `handleLevelUp` chama `materializeApparitionSpells`).
- `pnpm build` já rodado antes desta lane (ver seção de verificação do `fix-r2.md`) — sem
  rebuild extra aqui, só reuso do `packages/client/dist` e `packages/server/dist` já verdes.
- Data-dir: `scratchpad/data-o4b` (mesmo da rodada 1; mundo `teste_xande`, original em
  `~/.fusion` intocado).
- Ator: `Fixer_o4b_r2`, criado do zero via `scratchpad/seed-o4b-r2-actor.js` — clone do "Novo
  Ator" **sem** classe/features/spellcasting (ancestralidade Elfo, antecedente Advogado
  preservados só para não quebrar campos do sistema), nível 1, `build.choices` sem
  `classLevel`. Servidor reiniciado depois do seed pra ler o dado fresco.
- Servidor: `node packages/server/dist/cli/index.js serve --port 33045 --data-dir
  scratchpad/data-o4b --world teste_xande --no-open`, PID 5056 — boot saudável, encerrado com
  `taskkill //PID 5056 //F` ao final (`netstat` confirma sem LISTENING na 33045 depois).
- Browser: Playwright real (`playwright-cli -s=o4br2`), sessão de Mestre (login "Gamemaster",
  sem senha).

## O que foi provado (achado C7)

1. **Ator limpo, nível 1, sem classe.** Print `prints/r2-03-ficha-aberta.png`.
2. **Escolher classe Animist** dá 2 slots "Sintonia de Aparição". Print
   `prints/r2-04-animist-escolhido.png`.
3. **Antes de escolher aparição, a aba Magias só tem "divine Spells" e "Foco"** (sem
   "Apparition Spells"). Print `prints/r2-05-magias-antes.png`.
4. **C2 — escolher a 1ª aparição (Crafter in the Vault) e, SEM reabrir a ficha, a aba
   "Apparition Spells" já mostra o Patamar 1.** Cliquei "Sintonia de Aparição" → "Crafter in
   the Vault" → Confirmar → fui direto na aba Magias → "Apparition Spells": Truque "Sigilo"
   e "Patamar 1: 1/1 usos hoje — Mending" já listados, sem fechar/reabrir a janela da ficha em
   momento algum. Prints `prints/r2-07-C2-rank1-sem-reabrir.png` e
   `prints/r2-08-C2-aba-apparition-spells.png`.
5. **N2 — subir de nível 1→2→3 pelo botão "Subir de nível" (sem reabrir a ficha) já traz o
   Patamar 2 (Knock) na hora.** Cliquei "Subir de nível" duas vezes seguidas (permanecendo na
   mesma aba Magias/Apparition Spells o tempo todo) e o Patamar 2 apareceu com "Knock" e
   "Repertório completo neste patamar" — sem qualquer reload/reabertura. Prints
   `prints/r2-09-N2-nv3-sem-reabrir.png` e `prints/r2-10-N2-knock-visible-full.png`.
6. **Dado do servidor bate com a UI.** Query direta em `world.db` (ator `Fixer_o4b_r2`, depois
   do teste): `system.level.value = 3`; `items[]` tem os 4 `spell` esperados (`Sigil`,
   `Mending`, `Traveling Workshop`, `Knock`); a entry `Apparition Spells` tem `slots["0"]`,
   `["1"]` e `["2"]` preenchidos.

**Conclusão:** C2 (fixer r1) e N2 (fixer r2) se comportam ao vivo, com servidor e browser
reais, exatamente como os testes automatizados (`apparitionSpellcasting.test.ts`,
`planColumn-levelup-apparition.test.ts`) preveem — nenhum dos dois exige reabrir a ficha.

## Comandos e verificação

| Passo | Resultado |
| --- | --- |
| Seed do ator limpo (`seed-o4b-r2-actor.js`) | verde — `Fixer_o4b_r2` criado |
| Boot do servidor (porta 33045) | verde — "Fusion server ready for connections" |
| Login GM (Gamemaster, sem senha) | verde |
| Escolher classe Animist | verde |
| Escolher 1ª aparição (Crafter in the Vault) → aba Magias sem reabrir | verde — Patamar 1 (C2) |
| Subir de nível 1→2→3 sem reabrir → Patamar 2 | verde — Knock (N2) |
| Query direta em `world.db` pós-teste | bate com a UI |
| Encerrar servidor (PID 5056) | confirmado, `netstat` sem listener na 33045 |

## Arquivos

- Prints: `scratchpad/ficha3-reports/o4b/prints/r2-00..10-*.png` (12 arquivos).
- Seed script: `scratchpad/seed-o4b-r2-actor.js` (fora da worktree, não versionado).
- Nenhum código de produção alterado nesta lane de evidência (só o fix do N2, commitado à
  parte — ver `fix-r2.md`).
