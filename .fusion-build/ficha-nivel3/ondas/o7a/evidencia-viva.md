# Evidência viva — Onda 7a (molde das 29 fichas + comparador, adiantados)

Worktree: `wt-d` (core, branch `ficha3/o7a`) + `external/fusion-systems-2e` (satélite, branch `ficha3/o7a`).
Sem servidor — o próprio orquestrador autorizou esse recorte para a 7a: "prova mecânica + print/trecho do molde".

## O que já estava pronto (commit anterior, HEAD desta lane)

- Core `8f56ce16` — traz `docs/design/ficha-nivel3/molde/{README-molde.md, character-templates.json,
  exemplo-preenchido-fighter.json}` para o repo e corrige a lacuna do Commander (28→29 classes no
  molde).
- Satélite `f7a113f7` — `sheets/pf2e/src/lib/sheets/pf2e/__tests__/{character-comparator.test.ts,
  helpers/moldeComparator.ts}`: o comparador em si.

Esta lane não precisou escrever código novo — T7.1 e T7.2 já estavam implementados e commitados.
O trabalho aqui foi **rodar de verdade** e fotografar a prova, nível a nível.

## Nível 1 — Mecânico

```
cd external/fusion-systems-2e/sheets/pf2e
npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts --reporter=verbose
```

Resultado: **7/7 testes verdes**, três describe blocks:

1. `comparador — molde do Alexandre (character-templates.json)`
   - `cobre as 29 classes × 3 níveis (87 células), sem perder nenhuma no caminho` — confirma
     29 classes (8 do lote 1 + 21 do lote 2, Commander incluso) × 3 níveis = **87 células**.
   - `não afirma divergência zero por vacuidade: reporta quantas células estão pendentes vs.
     comparadas` — hoje **87 pendentes / 0 comparadas** (T7.4, preenchimento manual do
     Alexandre, ainda não rodou), cada uma com `pendingReason` registrado — o tally é honesto,
     não finge divergência zero por o molde estar vazio.
   - `divergência zero nas células que JÁ estão preenchidas (nenhum falso verde)` — passa
     trivialmente hoje (zero comparadas), mas é o mesmo teste que vai cobrar de verdade assim
     que o T7.4 preencher.
2. `comparador — exemplo próprio (regra do livro, não do pack): Fighter` — fixture
   `exemplo-preenchido-fighter.json`, preenchida pela lane anterior a partir do Player Core
   Remaster (Ratfolk/Aeronaut Fighter), NÃO do pack:
   - HP de classe (10) bate com a tabela do livro.
   - Ranks de proficiência nos níveis 1 e 3 batem (nível 3: Vontade sobe pra Expert por
     "Bravery", nenhuma outra proficiência muda entre 1 e 3) — **exemplo verde de verdade**,
     construído pelo `classBuildHarness` real (builder), não copiado do pack.
3. `comparador — detecta divergência de verdade (não é sempre [])` — meta-teste: injeta um
   valor errado (Vontade Expert no nível 1, que é Treinado) e confirma que o comparador acusa
   exatamente 1 divergência (`saves.will: expected=2, actual=1`). Prova que a ferramenta não é
   vácua — ela FALHA quando deveria falhar.

Saída bruta (trecho):
```
✓ comparador — molde do Alexandre (character-templates.json) > cobre as 29 classes × 3 níveis (87 células), sem perder nenhuma no caminho
✓ comparador — molde do Alexandre (character-templates.json) > não afirma divergência zero por vacuidade: reporta quantas células estão pendentes vs. comparadas
✓ comparador — molde do Alexandre (character-templates.json) > divergência zero nas células que JÁ estão preenchidas (nenhum falso verde)
✓ comparador — exemplo próprio (regra do livro, não do pack): Fighter > HP de classe (antes de ancestralidade/Constituição) bate com a tabela do Player Core Remaster
✓ comparador — exemplo próprio (regra do livro, não do pack): Fighter > nível 1 — ranks de proficiência batem com o livro (Ratfolk/Aeronaut, ficha real)
✓ comparador — exemplo próprio (regra do livro, não do pack): Fighter > nível 3 — ranks de proficiência batem com o livro (Ratfolk/Aeronaut, ficha real)
✓ comparador — detecta divergência de verdade (não é sempre []) > um valor errado no fixture produz exatamente uma divergência reportada

Test Files  1 passed (1)
     Tests  7 passed (7)
```

## Nível 2 — Vivo

Não aplicável a este recorte (a 7a é a prova de ferramenta+molde, não uma ficha de personagem
num mundo — isso é o roteiro `tutorial-e2e` que "fica na Onda 7", conforme o pedido). A tabela da
`execucao.md` §3, linha 7, já marca "Vivo" como `—` para a Onda 7 inteira; o teste do comparador
constrói a personagem pelo `classBuildHarness` (caminho real do builder, dentro do processo de
teste) — é o mais perto de "vivo" que faz sentido sem servidor.

## Nível 3 — Olhado

Sem servidor/browser do jogo (autorizado pelo orquestrador para a 7a: "prova mecânica +
print/trecho do molde"). Print via `playwright-cli` servindo os arquivos do molde por
`python -m http.server` (arquivos locais, sem alterar nada em produção) — `file://` é bloqueado
pelo browser, então usei um servidor estático efêmero na porta 8899, encerrado ao final.

- `prints/01-molde-character-templates-abre.png` — abre `character-templates.json` no browser;
  mostra `metadata.chassis_common` (Human/Scholar, atributos propostos, todos com "— editar") e o
  início do `batch_1` (Fighter) com `hp`/`ac`/`saves`/`proficiencies` **todos `null`** — prova
  visual de que o molde não vem pré-preenchido com dado derivado (regra não-circular #48) e que
  o arquivo é legível/navegável.
- `prints/02-exemplo-fighter-legivel.png` — abre `exemplo-preenchido-fighter.json`; mostra o
  `_readme` explicando a separação do molde do Alexandre, e os níveis 1/3 preenchidos com
  `proficiency_ranks` reais e notas citando a regra do livro (Bravery, Expert em armas
  simples/marcial/desarmado etc.) — prova visual do "exemplo verde".

Cada print foi olhado (Read na imagem) antes de entrar aqui.

## Runbook

`docs/design/ficha-nivel3/gate-runbook.md` não precisou de correção — o recorte desta lane não
subiu servidor do jogo (autorizado explicitamente), então nada do runbook (que cobre exatamente
o fluxo de servidor+mundo+browser) foi exercitado ou contradito.

## Defeitos encontrados

Nenhum. O comparador roda, o tally é honesto (87 pendentes, 0 falso-verde), o exemplo Fighter
bate com o livro, e o meta-teste prova que a ferramenta detecta divergência de verdade.

## Pendências para issue

Nenhuma pendência NOVA encontrada por esta lane. A pendência conhecida (T7.4 — Alexandre precisa
preencher as 87 células à mão lendo o Player Core Remaster) já está registrada em `tasks.md`
como tarefa de dono explícito (`Alexandre`), não uma issue de bug — não abri issue para isso.

## Processos e portas

- `python -m http.server 8899` (servidor estático efêmero, só para o browser conseguir abrir os
  `.json` do molde — nunca o servidor do jogo) — encerrado via `taskkill //PID 14216 //F` ao
  final; `netstat` confirma sem `LISTENING` residual.
- Nenhum processo do Fusion (`packages/server`) foi subido nesta lane.
