# Auditoria adversarial — leitura fria / executabilidade (2026-09-20)

Sessão sem contexto prévio, só os 3 docs + `git`/leitura. Objetivo: achar onde a execução trava.

## Método

1. Simulação passo a passo da Onda 0 (T0.1–T0.5), Onda 1 (T1.1–T1.7) e Onda 2 (T2.1–T2.5).
2. Checagem de existência real de todo caminho de arquivo citado nos 3 docs.
3. Checagem do grafo de dependências entre ondas.
4. Checagem de acionabilidade dos gates/provas de entrega.
5. Checagem de risco destrutivo/irreversível na Onda 0.

## Onda 0 — simulação

- **T0.1** (merge `feat/classes-necromancer-runesmith` no `main` do satélite `external/fusion-systems-2e`):
  repo/branch estão claros e a branch existe (`origin/feat/classes-necromancer-runesmith`, 88 arquivos,
  +165.261/-1.752 vs `main`). **PORÉM**: o submodule está clonado **shallow**
  (`git rev-parse --is-shallow-repository` → `true`). Testei o merge de verdade
  (`git merge feat/classes-necromancer-runesmith --no-commit --no-ff` a partir de `main`) e o resultado
  foi **`fatal: refusing to merge unrelated histories`** — `git merge-base main
  feat/classes-necromancer-runesmith` não resolve nada (exit 1, sem saída) porque o clone local não tem
  profundidade suficiente para enxergar o ancestral comum. Nenhum dos 3 documentos menciona isso. Um
  executor seguindo o texto ao pé da letra vai bater nesse erro na PRIMEIRA tarefa da fatia inteira, e o
  atalho óbvio-mas-errado (`git merge --allow-unrelated-histories`) produziria um merge estruturalmente
  errado (as duas branches TÊM história comum real, só não está no clone local). O fix correto é
  `git fetch --unshallow` (ou aumentar depth) antes do merge — não está escrito em lugar nenhum.
- **T0.2** (guard `KNOWN_CLASS_TRAITS`): arquivo e símbolo existem
  (`sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2050`, usado em `2012` e `2233`). Comando/arquivo claros,
  mas "re-aplicar o guard" pressupõe que T0.1 já rodou — nenhum problema adicional aqui além do herdado
  de T0.1.
- **T0.3** (converter 2.541 `GrantItem`): "onde: `tools/importer-pf2e/`" é **ambíguo por design de
  repo**: existem DOIS diretórios com esse nome — um **untracked na raiz do core**
  (`tools/importer-pf2e/{vendor,out,analysis,samples,node_modules}`, sem `src/`, é só dado — o vendor
  clone do foundryvtt/pf2e mora aqui) e outro **tracked no satélite**
  (`external/fusion-systems-2e/tools/importer-pf2e/{src,README.md,analysis,samples}`, é o código). A
  distinção só é explicada em T5.0 (Onda 5), não nas Ondas 0/1 onde a ambiguidade aparece primeiro. Um
  executor sem essa leitura cruzada pode procurar/gerar código no lugar errado.
- **T0.4** (validador de integridade): mesmo caminho ambíguo de T0.3; sem problema adicional.
- **T0.5** (novo pin do submodule + build): mecânico, claro, sem achados.

## Onda 1 — simulação

Todas as 15 tarefas apontam para o mesmo arquivo/símbolo real
(`CLASS_CHOICE_SLOT_OPTIONS` em `planVM.ts:2094`, hoje com as 12 entradas descritas — conferido linha a
linha, bate exatamente com o plano). Lane única faz sentido (edição concorrente no mesmo objeto).
T1.5 (Necromancer `fatalMethod`) já vem marcada como incerta no próprio doc — comportamento correto
(condicional documentada, não promessa vazia). Nenhum bloqueante aqui; a única lacuna é que o gate da
onda ("teste que percorre as 27 entradas") pressupõe T0.1 resolvido — herda o mesmo risco.

## Onda 2 — simulação

`schema-primitives.ts:223` existe e é exatamente o `SpellSlotSchema` descrito (`value/max/prepared[]`,
sem `spellsKnown`) — confirma o buraco relatado. `SpellPickerDialog.svelte` existe no caminho citado.
Tarefas claras, arquivos corretos. Nenhum achado novo além do que os docs já assumem corretamente.

## Caminhos de arquivo — checagem geral

Todos os caminhos citados nos 3 docs que testei existem exatamente onde dito:
`planVM.ts` (linhas 2050/2094/1442/2008/5181 conferem), `choiceSetInventory.ts` (linhas de deity
conferem), `schema-primitives.ts:223`, `SpellPickerDialog.svelte`, `KineticGateDialog.svelte`,
`PlanColumn.svelte`, migration `010_dec_mc_01_ancient_elf.ts`, `disabled-rules.mjs` — todos batem.
Único par ambíguo: os dois `tools/importer-pf2e/` (ver T0.3 acima).
Commit do vendor pinado (`98cb84fa48c8de2048c0b62456e4604bd836bd1a`, 2026-08-23) confere exatamente
contra o clone local em `tools/importer-pf2e/vendor/pf2e` (mensagem e data batem).

## Grafo de dependências

Consistente. O0 serial bloqueando tudo está correto (todas as ondas 1-6 citam `⇠ T0.5`). O3 dependendo
de T1.4 (Summoner `eidolon` cabeado em T1.4) está certo. Não achei tarefa dependendo de algo que
nenhuma tarefa produz, nem ciclo.

## Gates e provas de entrega

Os gates da Onda 0/1/2 são objetivamente verificáveis (contagem de `GrantItem` não resolvível = 0,
teste percorrendo as 27 entradas, criação de personagem viva + print). Não achei gate vago nas ondas
auditadas.

## Risco destrutivo/irreversível na Onda 0

- **Achado principal**: ver T0.1 acima — o erro de "unrelated histories" empurra um executor apressado
  para `--allow-unrelated-histories`, que É destrutivo/errado aqui (cria merge sem base real, pode
  duplicar/perder histórico do submodule). Falta uma frase explícita: "antes do merge, `git fetch
  --unshallow` no submodule".
- Fora isso, T0.1 já é "merge direto no `main` do satélite" sem menção a PR — o resto do repo (core)
  tem regra dura de nunca push direto em main sem instrução literal; como o plano.md é a própria
  instrução literal do Alexandre (decisão 6: "Integração — alfa/app"), não classifico isso como
  bloqueante, mas nenhum dos 3 docs versiona esse passo como PR revisável no satélite — inconsistente
  com a disciplina "PR por onda" que a própria execucao.md exige para o CORE.
- Não achei outro comando destrutivo (`reset --hard`, `push --force`, etc.) prescrito em nenhuma das
  ondas simuladas.

## Achados (ordem de gravidade)

BLOQUEANTE — Onda 0, T0.1 (submodule `external/fusion-systems-2e`) — merge falha de cara com "refusing
to merge unrelated histories" porque o clone é shallow; nenhum doc menciona `git fetch --unshallow`,
risco real de um executor usar `--allow-unrelated-histories` (destrutivo/errado).

IMPORTANTE — Onda 0/1, T0.3/T0.4 — "onde: tools/importer-pf2e/" é ambíguo: há dois diretórios com esse
nome (dado untracked no core vs. código tracked no satélite); a explicação só aparece em T5.0 (Onda 5),
tarde demais para quem executa a Onda 0.

IMPORTANTE — Onda 0, gate ("importar um mundo e criar um Monk") — nenhum comando de "importar mundo"
foi encontrado no repo por grep; o gate pressupõe conhecimento operacional não documentado nos 3 docs.

MENOR — Onda 0, T0.1 — merge direto no `main` do satélite sem passo de PR, inconsistente com a
disciplina "PR por onda" que os mesmos documentos exigem para o core.

MENOR — nenhum outro caminho de arquivo, número ou linha citado nos 3 docs divergiu do que existe no
repo (todos conferidos: planVM.ts, choiceSetInventory.ts, schema-primitives.ts, SpellPickerDialog,
migration 010, disabled-rules.mjs, commit do vendor).

**Veredito:** precisa de 1 correção bloqueante (documentar `git fetch --unshallow` antes de T0.1, com
aviso explícito contra `--allow-unrelated-histories`) antes de ser executável como está.
